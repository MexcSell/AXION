/**
 * Phase A, A1: the scripted FAKE executor that drives the trajectory recorder. A harness under test/ only: no process, no network, no model, no tool runs.
 * It does what a real executor would do before each step (decide with the c94 request decider and the c95 caps checker, through the shared
 * server/src/trajectory/decide.ts), runs nothing, and hands what it decided and what a (pretend) tool reported to the recorder.
 * Pattern: test/c95/fake-executor.ts.
 */
import { createHash } from 'node:crypto';
import { TrajectoryRecorder, type BuiltTrajectory } from '../../src/trajectory/recorder.ts';
import { decideStep, outcomeOf } from '../../src/trajectory/decide.ts';
import { newRunCounters, recordRunStep } from '../../src/jobs/run-caps.ts';
import { execProfileSha256 } from '../../src/exec-profile/hash.ts';
import type { RunCaps, RunClassBreaker, RunCounters } from '../../../shared/contracts/src/index.ts';
import { FIXTURE_CAPS, RUN_START, fixtureProfile, type TrajFixture } from './trajectory-fixtures.ts';

export const sha = (s: string) => createHash('sha256').update(s).digest('hex');
export const STATE_A = 'a'.repeat(64);
export const iso = (ms: number) => new Date(Date.parse(RUN_START) + ms).toISOString();

export interface Ran { built: BuiltTrajectory; profile: ReturnType<typeof fixtureProfile> | null; results: Record<number, unknown> }

export function runFixture(f: TrajFixture, o: { tenantId?: string; runId?: string; piiFields?: string[]; taskClass?: string; jobRef?: string } = {}): Ran {
  const tenantId = o.tenantId ?? 'a1-tenant';
  const runId = o.runId ?? `RUN-${f.id}`;
  const profile = f.profile ? fixtureProfile() : null;
  const caps: RunCaps | null = f.caps === null ? null : { ...FIXTURE_CAPS, ...f.caps };
  const breaker: RunClassBreaker = { taskClass: o.taskClass ?? 'web-research', stage: f.stage, maxConsecutiveFailures: f.breaker };
  const rec = new TrajectoryRecorder({ tenantId, runId, jobRef: o.jobRef ?? `job-${f.id}`, taskClass: o.taskClass ?? 'web-research', startedAt: RUN_START, profileSha256: profile ? execProfileSha256(profile) : null, caps, breaker: { stage: f.stage, maxConsecutiveFailures: f.breaker }, piiFields: o.piiFields });
  let counters: RunCounters = newRunCounters(0);
  const results: Record<number, unknown> = {};
  let lastEnd = 0;
  for (const [i, s] of f.steps.entries()) {
    const at = s.at ?? i * 1000;
    const est = s.est ?? [0, 0];
    const inputs = { halted: !!s.halted, estMoneyMicros: est[0], estTokens: est[1], fencingToken: (s.fencing ?? [1, 1])[0], currentFencingToken: (s.fencing ?? [1, 1])[1] };
    const { decision, proposal } = decideStep({ profile, caps, breaker, counters }, { tool: s.tool, args: s.args, atMs: at, inputs });
    const executed = (decision.profile === null || decision.profile.allowed) && decision.caps.action === 'continue';
    const ok = executed ? (s.ok ?? true) : null;
    const tokens = executed ? (s.tokens ?? null) : null;
    const toolCostMicros = executed ? (s.cost ?? null) : null;
    const result = executed ? { n: i + 1, ok } : undefined;
    if (executed) {
      counters = recordRunStep(counters, proposal, outcomeOf({ ok: ok!, tokens, toolCostMicros }, inputs));
      results[i + 1] = result;
    }
    rec.addStep({
      modelRequestHash: sha(`model request ${runId} ${i + 1}`), tool: s.tool, args: s.args, inputs, decision, executed, ok, result,
      approvalId: s.approvalId ?? null, credentialHandleId: s.credentialHandleId ?? null, startedAt: iso(at), endedAt: iso(at + 400), tokens, toolCostMicros,
    });
    lastEnd = at + 400;
    if (decision.caps.action === 'stop') break; // a caps stop ends the run; that step is the last one recorded
  }
  const endedAt = iso(lastEnd + 100);
  const built = rec.finish({ endedAt, finalClaim: f.claim, envCheck: f.env === 'match' ? { runId, checkedAt: endedAt, expectedState: STATE_A, observedState: STATE_A } : null });
  return { built, profile, results };
}
