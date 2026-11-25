/**
 * Phase A (A1, R6-3 first slice): the run trajectory record. One append-only record per run: ordered steps, each hashed into a chain, the final claim, the
 * environment-state check and the totals. NOTHING EXECUTES: today the only writer is a scripted fake executor in the tests; no run, no model and no tool exist.
 *
 * Honest numbers (rules written before any fixture ran, see server/test/phaseA/trajectory-fixtures.ts):
 *  - COST is over the steps that actually ran. Every one has a cost (zero is a cost): "known", the sum. Any one lacks it: "unknown", never the partial sum as the
 *    total; the sum of the known costs is kept apart as a labelled lower bound. No step ran: "unknown".
 *  - CLAIM: a success claim is "verified" only with an environment-state record that belongs to this run, is not older than the run, and whose two states match.
 *    Otherwise it is "claimed, not verified". A claim of failure, or none, claims nothing.
 * Hashing lives in server/src/trajectory/chain.ts (node:crypto is not allowed in this folder: the web project typechecks it).
 */
import type { RunCaps } from './run-caps.ts';

export const TRAJECTORY_VERSION = 1 as const;
export const FINAL_CLAIMS = ['success', 'failure', 'none'] as const;
export type FinalClaim = (typeof FINAL_CLAIMS)[number];

/** What the executor reported it checked in the world after the run: the state it expected and the state it observed (hashes of a state description). */
export interface EnvCheck { runId: string; checkedAt: string; expectedState: string; observedState: string }

/** The two decisions recorded for every step. `profile` is null when the tool makes no request the c94 decider judges. */
export interface StepDecision {
  profile: { allowed: boolean; reason: string } | null;
  caps: { action: 'continue' | 'stop'; reason: string | null };
}
/** The inputs the decisions were made from that are not in the arguments; replay feeds them back. */
export interface StepInputs { halted: boolean; estMoneyMicros: number; estTokens: number; fencingToken: number; currentFencingToken: number }

export interface StoredStep {
  seq: number;
  modelRequestHash: string | null;
  tool: string;
  /** redacted before it was hashed and stored */
  args: unknown;
  /** how many values the redaction replaced */
  redactions: number;
  inputs: StepInputs;
  decision: StepDecision;
  policyDecisionId: string;
  executed: boolean;
  ok: boolean | null;
  resultHash: string | null;
  approvalId: string | null;
  credentialHandleId: string | null;
  startedAt: string;
  endedAt: string;
  tokens: number | null;
  toolCostMicros: number | null;
  prevHash: string;
  stepHash: string;
}

export const COST_STATUSES = ['known', 'unknown'] as const;
export type CostStatus = (typeof COST_STATUSES)[number];
export interface RunCost { status: CostStatus; micros: number | null; lowerBound: number; missing: number }

export interface StoredRun {
  tenantId: string;
  id: string;
  jobRef: string | null;
  taskClass: string;
  startedAt: string;
  endedAt: string;
  finalClaim: FinalClaim;
  envCheck: unknown | null;
  stepCount: number;
  tokensTotal: number | null;
  costStatus: CostStatus;
  costMicros: number | null;
  costLowerBoundMicros: number;
  costMissingSteps: number;
  profileSha256: string | null;
  caps: RunCaps | null;
  breaker: { stage: 0 | 1 | 2 | 3; maxConsecutiveFailures: number };
  headHash: string;
  runDigest: string;
}

/** Cost and tokens of a run, over the EXECUTED steps only. Pure. */
export function trajectoryCost(steps: readonly { executed: boolean; toolCostMicros: number | null; tokens: number | null }[]): { cost: RunCost; tokens: number | null } {
  const ran = steps.filter((s) => s.executed);
  let sum = 0, missing = 0, tokens = 0, tokensMissing = 0;
  for (const s of ran) {
    if (s.toolCostMicros === null || s.toolCostMicros === undefined) missing++; else sum += s.toolCostMicros;
    if (s.tokens === null || s.tokens === undefined) tokensMissing++; else tokens += s.tokens;
  }
  const known = ran.length > 0 && missing === 0;
  return { cost: { status: known ? 'known' : 'unknown', micros: known ? sum : null, lowerBound: sum, missing }, tokens: ran.length > 0 && tokensMissing === 0 ? tokens : null };
}

export const CLAIM_LABELS = ['verified', 'claimed_not_verified', 'no_success_claimed'] as const;
export type ClaimLabel = (typeof CLAIM_LABELS)[number];
export const CLAIM_REASONS = ['no_record', 'not_this_run', 'before_run', 'malformed', 'state_differs'] as const;
export type ClaimReason = (typeof CLAIM_REASONS)[number];
export const CLAIM_TEXT: Record<ClaimLabel, string> = { verified: 'verified', claimed_not_verified: 'claimed, not verified', no_success_claimed: 'no success claimed' };
const HEX64 = /^[0-9a-f]{64}$/;

/** Pure. A success claim is only as good as the environment-state record behind it. */
export function claimOf(run: { id: string; startedAt: string; finalClaim: FinalClaim | string; envCheck: unknown }): { label: ClaimLabel; reason: ClaimReason | null; text: string } {
  const out = (label: ClaimLabel, reason: ClaimReason | null) => ({ label, reason, text: CLAIM_TEXT[label] });
  if (run.finalClaim !== 'success') return out('no_success_claimed', null);
  const e = run.envCheck;
  if (e === null || e === undefined) return out('claimed_not_verified', 'no_record');
  if (typeof e !== 'object' || Array.isArray(e)) return out('claimed_not_verified', 'malformed');
  const r = e as Record<string, unknown>;
  if (typeof r.runId !== 'string' || typeof r.checkedAt !== 'string' || typeof r.expectedState !== 'string' || typeof r.observedState !== 'string') return out('claimed_not_verified', 'malformed');
  const at = /^\d{4}-\d\d-\d\dT/.test(r.checkedAt) ? Date.parse(r.checkedAt) : Number.NaN;
  if (!HEX64.test(r.expectedState) || !HEX64.test(r.observedState) || Number.isNaN(at)) return out('claimed_not_verified', 'malformed');
  if (r.runId !== run.id) return out('claimed_not_verified', 'not_this_run');
  if (at < Date.parse(run.startedAt)) return out('claimed_not_verified', 'before_run');
  if (r.expectedState !== r.observedState) return out('claimed_not_verified', 'state_differs');
  return out('verified', null);
}

export const CHAIN_STATUSES = ['verified', 'unanchored', 'broken'] as const;
export type ChainStatus = (typeof CHAIN_STATUSES)[number];
export const CHAIN_REASONS = ['seq_gap', 'seq_duplicate', 'prev_hash_mismatch', 'step_hash_mismatch', 'step_count_mismatch', 'head_mismatch', 'run_digest_mismatch', 'anchor_mismatch', 'anchor_missing'] as const;
export type ChainReason = (typeof CHAIN_REASONS)[number];
/** `unchecked`: the chain was already broken before the anchor was compared (the anchor row exists, but it was not needed to find the fault). */
export const ANCHOR_STATES = ['ok', 'missing', 'mismatch', 'unchecked'] as const;
export type AnchorState = (typeof ANCHOR_STATES)[number];
/** `firstBadSeq` is the step where the fault shows (null when it is a fault of the run row or of the anchor, not of one step). */
export interface ChainCheck { ok: boolean; status: ChainStatus; checked: number; firstBadSeq: number | null; reason: ChainReason | null; anchor: AnchorState }

// ---- the read routes (administrators only) ------------------------------------------------------------------------------------------------
export interface TrajectoryCostDto { status: CostStatus; micros: number | null; knownSumMicros: number; missingSteps: number; text: string }
export interface TrajectoryRunDto {
  id: string;
  jobRef: string | null;
  taskClass: string;
  startedAt: string;
  endedAt: string;
  finalClaim: FinalClaim;
  claim: { label: ClaimLabel; reason: ClaimReason | null; text: string };
  steps: number;
  executedSteps: number;
  tokens: number | null;
  cost: TrajectoryCostDto;
  profileSha256: string | null;
  caps: RunCaps | null;
  headHash: string;
  recordedAt: string;
}
export interface TrajectoryStepDto {
  seq: number;
  modelRequestHash: string | null;
  tool: string;
  args: unknown;
  redactions: number;
  decision: StepDecision;
  policyDecisionId: string;
  executed: boolean;
  ok: boolean | null;
  resultHash: string | null;
  approvalId: string | null;
  credentialHandleId: string | null;
  startedAt: string;
  endedAt: string;
  tokens: number | null;
  toolCostMicros: number | null;
  stepHash: string;
}
export interface TrajectoryListDto { runs: TrajectoryRunDto[] }
export interface TrajectoryDetailDto { run: TrajectoryRunDto; envCheck: unknown | null; steps: TrajectoryStepDto[]; chain: ChainCheck }
export const TRAJECTORY_LIST_MAX = 200;
