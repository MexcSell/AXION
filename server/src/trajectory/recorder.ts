/**
 * Phase A (A1): the trajectory recorder. `TrajectoryRecorder` is an in-memory builder (no database): the caller gives it each step as it happened, it redacts the arguments,
 * hashes the result, content-addresses the policy decision, links the step into the chain and, at the end, totals the run. `saveTrajectory` then writes the run, all its steps
 * and the audit anchor in ONE transaction (the tables are append-only, so a run is written once, finished). The only caller today is the test-only fake executor.
 * Nothing here starts a process, opens a browser, uses the network or calls a model.
 */
import type { Tx, Db } from '../db.ts';
import { audit } from '../audit.ts';
import { ApiError } from '../errors.ts';
import { redactArgs } from './redact.ts';
import { GENESIS, policyDecisionIdOf, resultHashOf, runDigestOf, stepHashOf, verifyTrajectory, type Anchor } from './chain.ts';
import { isExecuted } from './decide.ts';
import { FINAL_CLAIMS, claimOf, trajectoryCost, type ChainCheck, type FinalClaim, type RunCaps, type StepDecision, type StepInputs, type StoredRun, type StoredStep } from '../../../shared/contracts/src/index.ts';

export const MAX_STEPS = 5000;
const HEX64 = /^[0-9a-f]{64}$/;
const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
const isoMs = (v: unknown, what: string): string => {
  const t = typeof v === 'string' || typeof v === 'number' || v instanceof Date ? new Date(v).getTime() : Number.NaN;
  if (Number.isNaN(t)) throw new Error(`${what} is not a time`);
  return new Date(t).toISOString();
};
const idOrNull = (v: unknown, what: string): string | null => {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string' || v.length < 1 || v.length > 120) throw new Error(`${what} must be 1 to 120 characters or null`);
  return v;
};

export interface RecorderInit {
  tenantId: string; runId: string; jobRef: string | null; taskClass: string; startedAt: string;
  profileSha256: string | null; caps: RunCaps | null; breaker: { stage: 0 | 1 | 2 | 3; maxConsecutiveFailures: number };
  /** keys the caller knows hold personal data (see redact.ts) */
  piiFields?: readonly string[];
}
/** What the executor reports for one step. `result` is hashed and then dropped: results are untrusted content and are not stored. */
export interface StepInput {
  modelRequestHash: string | null; tool: string; args: unknown; inputs: StepInputs; decision: StepDecision;
  executed: boolean; ok: boolean | null; result?: unknown;
  approvalId: string | null; credentialHandleId: string | null; startedAt: string; endedAt: string;
  /** model tokens used by this step, or null when unknown. Only a step that ran can have them. */
  tokens: number | null;
  /** tool cost in micros, or null when the executor reported none ("unknown", never 0). Only a step that ran can have one. */
  toolCostMicros: number | null;
}
export interface BuiltTrajectory { run: StoredRun; steps: StoredStep[] }

export class TrajectoryRecorder {
  private steps: StoredStep[] = [];
  private done = false;
  private readonly startedAt: string;
  constructor(private readonly init: RecorderInit) {
    if (typeof init.runId !== 'string' || init.runId.length < 1 || init.runId.length > 120) throw new Error('run id must be 1 to 120 characters');
    if (typeof init.taskClass !== 'string' || init.taskClass.length < 1 || init.taskClass.length > 120) throw new Error('task class must be 1 to 120 characters');
    if (init.profileSha256 !== null && !HEX64.test(init.profileSha256)) throw new Error('profile hash must be 64 lower-case hex characters or null');
    this.startedAt = isoMs(init.startedAt, 'the run start');
  }

  addStep(i: StepInput): StoredStep {
    if (this.done) throw new Error('the run is finished');
    if (this.steps.length >= MAX_STEPS) throw new Error(`a run holds at most ${MAX_STEPS} steps`);
    if (typeof i.tool !== 'string' || i.tool.length < 1 || i.tool.length > 120) throw new Error('tool must be 1 to 120 characters');
    const startedAt = isoMs(i.startedAt, 'the step start'), endedAt = isoMs(i.endedAt, 'the step end');
    if (endedAt < startedAt) throw new Error('a step cannot end before it starts');
    if (startedAt < this.startedAt) throw new Error('a step cannot start before the run');
    const last = this.steps[this.steps.length - 1];
    if (last && startedAt < last.startedAt) throw new Error('steps are recorded in the order they started');
    if (i.modelRequestHash !== null && !(typeof i.modelRequestHash === 'string' && HEX64.test(i.modelRequestHash))) throw new Error('model request hash must be 64 lower-case hex characters or null');
    const inp = i.inputs;
    if (!inp || typeof inp.halted !== 'boolean' || !isCount(inp.estMoneyMicros) || !isCount(inp.estTokens) || !isCount(inp.fencingToken) || !isCount(inp.currentFencingToken)) throw new Error('step inputs are malformed');
    const d = i.decision;
    const okProfile = d && (d.profile === null || (typeof d.profile?.allowed === 'boolean' && typeof d.profile.reason === 'string'));
    const okCaps = d && d.caps && (d.caps.action === 'continue' || d.caps.action === 'stop') && (d.caps.reason === null || typeof d.caps.reason === 'string');
    if (!okProfile || !okCaps) throw new Error('step decision is malformed');
    if (i.tokens !== null && !isCount(i.tokens)) throw new Error('tokens must be a non-negative integer or null');
    if (i.toolCostMicros !== null && !isCount(i.toolCostMicros)) throw new Error('tool cost must be a non-negative integer (micros) or null');
    if (i.executed) {
      if (!isExecuted(d)) throw new Error('a step the decisions refused cannot be recorded as executed');
      if (typeof i.ok !== 'boolean') throw new Error('an executed step must say whether it succeeded');
    } else if (i.ok !== null || i.result !== undefined || i.tokens !== null || i.toolCostMicros !== null) {
      throw new Error('a step that did not run has no outcome, result, tokens or cost');
    } else if (isExecuted(d)) {
      throw new Error('a step the decisions allowed is recorded as not executed: record why (a stop or a denial) or run it');
    }
    const redacted = redactArgs(i.args, { piiFields: this.init.piiFields });
    const prevHash = last ? last.stepHash : GENESIS;
    const step: StoredStep = {
      seq: this.steps.length + 1, modelRequestHash: i.modelRequestHash, tool: i.tool, args: redacted.value, redactions: redacted.count, inputs: { ...inp }, decision: JSON.parse(JSON.stringify(d)),
      policyDecisionId: policyDecisionIdOf(i.tool, redacted.value, inp, d), executed: i.executed, ok: i.executed ? i.ok : null,
      resultHash: i.executed && i.result !== undefined ? resultHashOf(i.result) : null, approvalId: idOrNull(i.approvalId, 'approval id'), credentialHandleId: idOrNull(i.credentialHandleId, 'credential handle id'),
      startedAt, endedAt, tokens: i.tokens, toolCostMicros: i.toolCostMicros, prevHash, stepHash: '',
    };
    step.stepHash = stepHashOf(this.init.tenantId, this.init.runId, prevHash, step);
    this.steps.push(step);
    return step;
  }

  finish(f: { endedAt: string; finalClaim: FinalClaim; envCheck: unknown | null }): BuiltTrajectory {
    if (this.done) throw new Error('the run is finished');
    if (!(FINAL_CLAIMS as readonly string[]).includes(f.finalClaim)) throw new Error('unknown final claim');
    const endedAt = isoMs(f.endedAt, 'the run end');
    const last = this.steps[this.steps.length - 1];
    if (endedAt < this.startedAt || (last && endedAt < last.endedAt)) throw new Error('a run cannot end before its steps');
    const envCheck = f.envCheck === null || f.envCheck === undefined ? null : JSON.parse(JSON.stringify(f.envCheck));
    if (envCheck !== null && (typeof envCheck !== 'object' || Array.isArray(envCheck) || JSON.stringify(envCheck).length > 2000)) throw new Error('the environment-state record must be a small object or null');
    this.done = true;
    const { cost, tokens } = trajectoryCost(this.steps);
    const run: StoredRun = {
      tenantId: this.init.tenantId, id: this.init.runId, jobRef: this.init.jobRef ?? null, taskClass: this.init.taskClass, startedAt: this.startedAt, endedAt, finalClaim: f.finalClaim, envCheck,
      stepCount: this.steps.length, tokensTotal: tokens, costStatus: cost.status, costMicros: cost.micros, costLowerBoundMicros: cost.lowerBound, costMissingSteps: cost.missing,
      profileSha256: this.init.profileSha256, caps: this.init.caps ? { ...this.init.caps } : null, breaker: { ...this.init.breaker }, headHash: last ? last.stepHash : GENESIS, runDigest: '',
    };
    run.runDigest = runDigestOf(run);
    return { run, steps: this.steps.map((s) => ({ ...s })) };
  }
}

/** Write one finished run: the run row, every step and the audit anchor, in the caller's transaction. All or nothing. */
export async function saveTrajectory(c: Tx, tenantId: string, b: BuiltTrajectory, actor: string): Promise<void> {
  const r = b.run;
  if (r.tenantId !== tenantId) throw new ApiError('VALIDATION', 400, 'The run belongs to another tenant.');
  await c.query(
    `insert into run_trajectories(tenant_id, id, job_ref, task_class, started_at, ended_at, final_claim, env_check, step_count, tokens_total, cost_status, cost_micros, cost_lower_bound_micros, cost_missing_steps, profile_sha256, caps, breaker, head_hash, run_digest)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
    [tenantId, r.id, r.jobRef, r.taskClass, r.startedAt, r.endedAt, r.finalClaim, r.envCheck === null ? null : JSON.stringify(r.envCheck), r.stepCount, r.tokensTotal, r.costStatus, r.costMicros, r.costLowerBoundMicros, r.costMissingSteps,
      r.profileSha256, r.caps === null ? null : JSON.stringify(r.caps), JSON.stringify(r.breaker), r.headHash, r.runDigest]);
  for (const s of b.steps) {
    await c.query(
      `insert into trajectory_steps(tenant_id, run_id, seq, model_request_hash, tool, args, redactions, inputs, decision, policy_decision_id, executed, ok, result_hash, approval_id, credential_handle_id, started_at, ended_at, tokens, tool_cost_micros, prev_hash, step_hash)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
      [tenantId, r.id, s.seq, s.modelRequestHash, s.tool, JSON.stringify(s.args), s.redactions, JSON.stringify(s.inputs), JSON.stringify(s.decision), s.policyDecisionId, s.executed, s.ok, s.resultHash, s.approvalId, s.credentialHandleId,
        s.startedAt, s.endedAt, s.tokens, s.toolCostMicros, s.prevHash, s.stepHash]);
  }
  // The anchor. Its detail goes through audit's redact(), which drops any key that looks like a secret (hash, token, ...): the names below are chosen to survive it.
  await audit(c, { tenantId, actor, action: 'run.trajectory.recorded', subject: r.id, result: 'ok', correlationId: '',
    detail: { head: r.headHash, runDigest: r.runDigest, steps: r.stepCount, costStatus: r.costStatus, costMicros: r.costMicros, claim: r.finalClaim, claimLabel: claimOf(r).label } });
}

const AT = `'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`;
const ts = (col: string) => `to_char(${col} at time zone 'UTC', ${AT})`;
const bigOrNull = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export function runOf(r: Record<string, any>): StoredRun {
  return {
    tenantId: r.tenant_id, id: r.id, jobRef: r.job_ref, taskClass: r.task_class, startedAt: r.started_at, endedAt: r.ended_at, finalClaim: r.final_claim, envCheck: r.env_check ?? null, stepCount: Number(r.step_count),
    tokensTotal: bigOrNull(r.tokens_total), costStatus: r.cost_status, costMicros: bigOrNull(r.cost_micros), costLowerBoundMicros: Number(r.cost_lower_bound_micros), costMissingSteps: Number(r.cost_missing_steps),
    profileSha256: r.profile_sha256, caps: r.caps ?? null, breaker: r.breaker, headHash: r.head_hash, runDigest: r.run_digest,
  };
}
export function stepOf(r: Record<string, any>): StoredStep {
  return {
    seq: Number(r.seq), modelRequestHash: r.model_request_hash, tool: r.tool, args: r.args, redactions: Number(r.redactions), inputs: r.inputs, decision: r.decision, policyDecisionId: r.policy_decision_id, executed: r.executed, ok: r.ok,
    resultHash: r.result_hash, approvalId: r.approval_id, credentialHandleId: r.credential_handle_id, startedAt: r.started_at, endedAt: r.ended_at, tokens: bigOrNull(r.tokens), toolCostMicros: bigOrNull(r.tool_cost_micros),
    prevHash: r.prev_hash, stepHash: r.step_hash,
  };
}
export const RUN_COLUMNS = `tenant_id, id, job_ref, task_class, ${ts('started_at')} as started_at, ${ts('ended_at')} as ended_at, final_claim, env_check, step_count, tokens_total, cost_status, cost_micros, cost_lower_bound_micros, cost_missing_steps, profile_sha256, caps, breaker, head_hash, run_digest, ${ts('recorded_at')} as recorded_at`;
const STEP_COLUMNS = `seq, model_request_hash, tool, args, redactions, inputs, decision, policy_decision_id, executed, ok, result_hash, approval_id, credential_handle_id, ${ts('started_at')} as started_at, ${ts('ended_at')} as ended_at, tokens, tool_cost_micros, prev_hash, step_hash`;

/** The anchor row of a run: the EARLIEST `run.trajectory.recorded` row for it (only the server appends audit rows, and a run is recorded once). Anything unreadable is an anchor that cannot match. */
async function anchorOf(db: Db | Tx, tenantId: string, runId: string): Promise<Anchor | null> {
  const a = (await db.query(`select detail from audit_events where tenant_id=$1 and action='run.trajectory.recorded' and subject=$2 order by seq limit 1`, [tenantId, runId])).rows[0]?.detail;
  if (!a) return null;
  return { head: typeof a.head === 'string' ? a.head : '', runDigest: typeof a.runDigest === 'string' ? a.runDigest : '', steps: typeof a.steps === 'number' ? a.steps : -1 };
}

export async function loadTrajectory(db: Db | Tx, tenantId: string, id: string): Promise<{ run: StoredRun; recordedAt: string; steps: StoredStep[]; anchor: Anchor | null } | null> {
  const r = (await db.query(`select ${RUN_COLUMNS} from run_trajectories where tenant_id=$1 and id=$2`, [tenantId, id])).rows[0];
  if (!r) return null;
  const steps = (await db.query(`select ${STEP_COLUMNS} from trajectory_steps where tenant_id=$1 and run_id=$2 order by seq`, [tenantId, id])).rows.map(stepOf);
  return { run: runOf(r), recordedAt: r.recorded_at, steps, anchor: await anchorOf(db, tenantId, id) };
}

/** Read the run back from the database and check its chain against the audit anchor. null when there is no such run in this tenant. */
export async function verifyStoredTrajectory(db: Db | Tx, tenantId: string, id: string): Promise<ChainCheck | null> {
  const t = await loadTrajectory(db, tenantId, id);
  return t ? verifyTrajectory(t.run, t.steps, t.anchor) : null;
}
