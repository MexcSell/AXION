/**
 * Phase A (A1): the replay verifier. Given a recorded run (read back from the database or built in memory), it feeds the recorded inputs of every step back through the SAME
 * deterministic deciders the executor used (server/src/trajectory/decide.ts: the c94 request decider and the c95 caps checker) and compares what they answer with what was recorded.
 * Pure: no I/O, no clock, nothing executes, no model is called. It shows that the recorded decisions follow from the recorded inputs and the profile and caps; it does NOT show
 * that a model would act the same way (R6-3 risk).
 *
 * What is fed back per step: the (redacted) arguments, the recorded inputs (halt flag, estimates, fencing tokens), the time since the run started, and the outcome of the steps that ran
 * before it (success, actual cost or tokens, or the estimate where the actual is unknown). What is compared: the profile decision, the caps decision, whether the step ran, and the
 * content-addressed policy decision id. Recorded tool results, when the caller still has them, are checked against the stored result hash.
 */
import type { ExecProfile } from '../../../shared/contracts/src/exec-profile.ts';
import type { StoredRun, StoredStep } from '../../../shared/contracts/src/index.ts';
import { newRunCounters, recordRunStep } from '../jobs/run-caps.ts';
import { execProfileSha256 } from '../exec-profile/hash.ts';
import { canonical } from '../approvals/service.ts';
import { decideStep, isExecuted, outcomeOf } from './decide.ts';
import { policyDecisionIdOf, resultHashOf } from './chain.ts';

export interface ReplayInput { run: StoredRun; steps: readonly StoredStep[]; profile: ExecProfile | null; /** recorded tool results by seq, when the caller kept them */ results?: Record<number, unknown> }
export interface ReplayMismatch { seq: number; field: 'profile' | 'caps' | 'executed' | 'policy_decision_id'; recorded: unknown; replayed: unknown }
export interface ReplayResult {
  ok: boolean;
  steps: number;
  /** steps whose every recorded decision was reproduced */
  reproduced: number;
  mismatches: ReplayMismatch[];
  resultMismatches: { seq: number; recorded: string | null; replayed: string }[];
  /** the profile given is not the one the run recorded (different hash), or one is missing */
  profileMismatch: boolean;
  /**
   * Steps that did not reproduce AND had arguments changed by redaction or bounding (redactions > 0, or a truncation marker). The executor decided on the raw arguments; replay
   * only has the stored ones, so for these the mismatch may be the redaction, not a wrong decision. They still count as failures (replay fails closed); this only says where to look.
   */
  redactedSteps: number[];
}

export function replayTrajectory(i: ReplayInput): ReplayResult {
  const { run, steps } = i;
  const profileMismatch = run.profileSha256 !== (i.profile ? execProfileSha256(i.profile) : null);
  const breaker = { taskClass: run.taskClass, stage: run.breaker.stage, maxConsecutiveFailures: run.breaker.maxConsecutiveFailures };
  const t0 = Date.parse(run.startedAt);
  let counters = newRunCounters(0);
  const mismatches: ReplayMismatch[] = [];
  const bad = new Set<number>();
  for (const s of steps) {
    const { decision, proposal } = decideStep({ profile: i.profile, caps: run.caps, breaker, counters }, { tool: s.tool, args: s.args, atMs: Date.parse(s.startedAt) - t0, inputs: s.inputs });
    const flag = (field: ReplayMismatch['field'], recorded: unknown, replayed: unknown) => { mismatches.push({ seq: s.seq, field, recorded, replayed }); bad.add(s.seq); };
    if (canonical(decision.profile) !== canonical(s.decision.profile)) flag('profile', s.decision.profile, decision.profile);
    if (canonical(decision.caps) !== canonical(s.decision.caps)) flag('caps', s.decision.caps, decision.caps);
    if (isExecuted(decision) !== s.executed) flag('executed', s.executed, isExecuted(decision));
    const id = policyDecisionIdOf(s.tool, s.args, s.inputs, decision);
    if (id !== s.policyDecisionId) flag('policy_decision_id', s.policyDecisionId, id);
    // the counters move on what was RECORDED as having run, as the executor's did
    if (s.executed && s.ok !== null) counters = recordRunStep(counters, proposal, outcomeOf({ ok: s.ok, toolCostMicros: s.toolCostMicros, tokens: s.tokens }, s.inputs));
  }
  const resultMismatches: ReplayResult['resultMismatches'] = [];
  for (const s of steps) {
    const r = i.results?.[s.seq];
    if (r === undefined) continue;
    const h = resultHashOf(r);
    if (h !== s.resultHash) resultMismatches.push({ seq: s.seq, recorded: s.resultHash, replayed: h });
  }
  const changed = (s: StoredStep) => s.redactions > 0 || JSON.stringify(s.args ?? null).includes('[truncated');
  const redactedSteps = steps.filter((s) => bad.has(s.seq) && changed(s)).map((s) => s.seq);
  return { ok: mismatches.length === 0 && resultMismatches.length === 0 && !profileMismatch, steps: steps.length, reproduced: steps.length - bad.size, mismatches, resultMismatches, profileMismatch, redactedSteps };
}
