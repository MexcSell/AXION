/**
 * Phase A (A1): the hash chain of a run trajectory and its verifier. Pure: no I/O, no clock. Nothing executes.
 *
 *   step hash   = sha256(canonical({v:1, tenantId, runId, prev, step}))  (canonical = keys sorted at every level, the same rule as the approval digests)
 *   prev        of step 1 is 64 zeros; of step n it is the hash of step n-1
 *   head        = the hash of the last step (64 zeros for a run with no steps)
 *   run digest  = sha256 over the run row's own fields, head and totals included
 *   anchor      = the audit log row `run.trajectory.recorded`, whose detail holds { head, runDigest, steps } (written in the same transaction as the run)
 *
 * `verifyTrajectory` walks the steps in order and reports the FIRST fault, in this order: seq, prev link, step hash (per step), then step count, head, run digest, anchor.
 * What each catches: an edited step (its hash), a re-hashed step (the next link), a deleted or inserted step (seq or count), a cut tail (count, head), an edited run row
 * (run digest), and a rewrite of the whole chain with every hash recomputed (only the anchor: it was written to another table, in the audit chain, at record time).
 * The step hash covers what is STORED (arguments after redaction), so a verifier reading rows back sees exactly what was hashed.
 */
import { createHash } from 'node:crypto';
import { canonical } from '../approvals/service.ts';
import type { ChainCheck, ChainReason, StepDecision, StepInputs, StoredRun, StoredStep } from '../../../shared/contracts/src/index.ts';

export const GENESIS = '0'.repeat(64);
export const sha256Hex = (s: string) => createHash('sha256').update(s).digest('hex');

/** The fields of a step the hash covers (everything except the two hashes themselves). */
function stepBody(s: StoredStep) {
  return {
    seq: s.seq, modelRequestHash: s.modelRequestHash ?? null, tool: s.tool, args: s.args ?? null, redactions: s.redactions, inputs: s.inputs, decision: s.decision, policyDecisionId: s.policyDecisionId,
    executed: s.executed, ok: s.ok ?? null, resultHash: s.resultHash ?? null, approvalId: s.approvalId ?? null, credentialHandleId: s.credentialHandleId ?? null,
    startedAt: s.startedAt, endedAt: s.endedAt, tokens: s.tokens ?? null, toolCostMicros: s.toolCostMicros ?? null,
  };
}
export const stepHashOf = (tenantId: string, runId: string, prev: string, s: StoredStep): string => sha256Hex(canonical({ v: 1, tenantId, runId, prev, step: stepBody(s) }));

export const runDigestOf = (r: StoredRun): string => sha256Hex(canonical({
  v: 1, tenantId: r.tenantId, id: r.id, jobRef: r.jobRef ?? null, taskClass: r.taskClass, startedAt: r.startedAt, endedAt: r.endedAt, finalClaim: r.finalClaim, envCheck: r.envCheck ?? null,
  stepCount: r.stepCount, tokensTotal: r.tokensTotal ?? null, costStatus: r.costStatus, costMicros: r.costMicros ?? null, costLowerBoundMicros: r.costLowerBoundMicros, costMissingSteps: r.costMissingSteps,
  profileSha256: r.profileSha256 ?? null, caps: r.caps ?? null, breaker: r.breaker, headHash: r.headHash,
}));

/** Content-addressed id of one policy decision: the tool, the (redacted) arguments, the recorded inputs and the two decisions. Replay recomputes it. */
export const policyDecisionIdOf = (tool: string, args: unknown, inputs: StepInputs, decision: StepDecision): string => 'pd-' + sha256Hex(canonical({ v: 1, tool, args: args ?? null, inputs, decision })).slice(0, 32);
export const resultHashOf = (result: unknown): string => sha256Hex(canonical({ v: 1, result: result ?? null }));

export interface Anchor { head: string; runDigest: string; steps: number }

export function verifyTrajectory(run: StoredRun, steps: readonly StoredStep[], anchor: Anchor | null): ChainCheck {
  const bad = (reason: ChainReason, firstBadSeq: number | null, checked: number): ChainCheck => ({ ok: false, status: 'broken', checked, firstBadSeq, reason, anchor: reason === 'anchor_mismatch' ? 'mismatch' : anchor === null ? 'missing' : 'unchecked' });
  let prev = GENESIS, i = 0;
  for (const s of steps) {
    const want = i + 1;
    if (s.seq !== want) return bad(s.seq > want ? 'seq_gap' : 'seq_duplicate', want, i);
    if (s.prevHash !== prev) return bad('prev_hash_mismatch', s.seq, i);
    if (stepHashOf(run.tenantId, run.id, prev, s) !== s.stepHash) return bad('step_hash_mismatch', s.seq, i);
    prev = s.stepHash; i++;
  }
  if (run.stepCount !== steps.length) return bad('step_count_mismatch', Math.min(run.stepCount, steps.length) + 1, i);
  if (run.headHash !== prev) return bad('head_mismatch', steps.length || null, i);
  const digest = runDigestOf(run);
  if (run.runDigest !== digest) return bad('run_digest_mismatch', null, i);
  if (anchor === null) return { ok: false, status: 'unanchored', checked: i, firstBadSeq: null, reason: 'anchor_missing', anchor: 'missing' };
  if (anchor.head !== prev || anchor.runDigest !== digest || anchor.steps !== steps.length) return bad('anchor_mismatch', null, i);
  return { ok: true, status: 'verified', checked: i, firstBadSeq: null, reason: null, anchor: 'ok' };
}
