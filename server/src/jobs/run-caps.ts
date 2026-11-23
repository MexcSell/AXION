/**
 * Run budget and halt checker (c95, R6-5 first slice). Pure: no I/O, no clock, no database. An engineering control, not
 * evidence; nothing executes yet. Types and the written stop bound live in shared/contracts/src/run-caps.ts.
 *
 * It mirrors the c45 job-lease primitives without changing them: the fencing check is EQUALITY with the current token (as
 * `lease_token = $3` is in store.ts), so a lower or a higher token is stale; a halt is a flag only, like `requestCancel` on a
 * leased job, and does not touch the token; the two are independent, so each is checked on its own.
 *
 * Time is an input (`step.atMs`, `counters.startedAtMs`). A real enforcement must take both from the database clock (`now()`),
 * never from the app clock; this module never reads a clock.
 *
 * `checkRunStep` must be called BEFORE a step and again, atomically with the step taking effect, by whatever stores the effect:
 * a step admitted before a halt can take effect after it, and only the second check catches that.
 */
import {
  RUN_CAP_FIELDS, RUN_TASK_STAGES, stageNeedsCaps,
  type RunCaps, type RunCapsDecision, type RunClassBreaker, type RunCounters, type RunHaltState, type RunStepOutcome, type RunStepProposal, type RunStopReason,
} from '../../../shared/contracts/src/index.ts';

const WINDOW_MS = 60_000;
const isInt = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
const stop = (reason: RunStopReason, detail: string): RunCapsDecision => ({ action: 'stop', reason, retry: false, detail });

export const newRunCounters = (startedAtMs: number): RunCounters => ({ steps: 0, startedAtMs, callTimesMs: [], origins: [], moneyMicrosUsed: 0, tokensUsed: 0, consecutiveFailures: 0, stoppedBy: null });

/** Caps are usable only if every field is present. Present but not a safe non-negative integer is invalid, never "no cap". */
function capsState(c: unknown): { kind: 'missing' } | { kind: 'invalid'; field: string } | { kind: 'ok'; caps: RunCaps } {
  if (c === null || c === undefined || typeof c !== 'object') return { kind: 'missing' };
  const o = c as Record<string, unknown>;
  if (RUN_CAP_FIELDS.some((f) => o[f] === undefined || o[f] === null)) return { kind: 'missing' }; // partial caps count as no caps
  for (const f of RUN_CAP_FIELDS) if (!isInt(o[f])) return { kind: 'invalid', field: f };
  return { kind: 'ok', caps: o as unknown as RunCaps };
}

export interface CheckInput {
  caps: RunCaps | null | undefined;
  breaker: RunClassBreaker;
  counters: RunCounters;
  step: RunStepProposal;
  halt: RunHaltState;
  /** the lease's current fencing token (from the store) */
  currentFencingToken: number;
}

export function checkRunStep(a: CheckInput): RunCapsDecision {
  const { breaker, counters: c, step: s } = a;
  // 1. halt first: after a halt every step is refused, whatever else is true
  if (a.halt?.halted !== false) return a.halt?.halted === true ? stop('halted', a.halt.reason ?? 'halt set') : stop('bad_input', 'halt state is not a boolean flag');
  // 2. a stop is final: a cap that frees up again (the rate window) must not turn a stop into a retry
  if (c?.stoppedBy) return stop('already_stopped', `stopped earlier by ${c.stoppedBy}`);
  // 3. fencing: equal to the current token, or stale (a higher token is as unknown as a lower one)
  if (!isInt(s?.fencingToken) || !isInt(a.currentFencingToken)) return stop('stale_fencing_token', 'token is not a safe non-negative integer');
  if (s.fencingToken !== a.currentFencingToken) return stop('stale_fencing_token', `token ${s.fencingToken} is not the current ${a.currentFencingToken}`);
  // 4. class setting
  if (!(RUN_TASK_STAGES as readonly unknown[]).includes(breaker?.stage)) return stop('bad_input', 'unknown stage');
  if (!Number.isSafeInteger(breaker.maxConsecutiveFailures) || breaker.maxConsecutiveFailures < 1) return stop('bad_input', 'breaker threshold must be an integer >= 1');
  // 5. caps present and well formed
  const cs = capsState(a.caps);
  if (cs.kind === 'invalid') return stop('caps_invalid', `cap ${cs.field} is not a safe non-negative integer`);
  if (cs.kind === 'missing' && stageNeedsCaps(breaker.stage)) return stop('caps_missing', `stage ${breaker.stage} needs caps on every lease`);
  // 6. counters and step are well formed (a NaN would make every comparison false and never stop)
  if (!c || !isInt(c.steps) || !isInt(c.startedAtMs) || !isInt(c.moneyMicrosUsed) || !isInt(c.tokensUsed) || !isInt(c.consecutiveFailures) || !Array.isArray(c.callTimesMs) || !c.callTimesMs.every(isInt) || !Array.isArray(c.origins)) return stop('bad_input', 'counters are malformed');
  if (typeof s.tool !== 'string' || s.tool === '' || !(s.origin === null || (typeof s.origin === 'string' && s.origin !== '')) || !isInt(s.atMs) || !isInt(s.estMoneyMicros) || !isInt(s.estTokens) || s.atMs < c.startedAtMs) return stop('bad_input', 'step proposal is malformed');
  // 7. circuit breaker
  if (c.consecutiveFailures >= breaker.maxConsecutiveFailures) return stop('circuit_breaker', `${c.consecutiveFailures} failed steps in a row (limit ${breaker.maxConsecutiveFailures})`);
  if (cs.kind !== 'ok') return { action: 'continue' }; // stage 0 or 1 without caps: only halt, token and breaker apply
  // 8. caps; each counts THIS step's own estimate before it runs
  const k = cs.caps;
  if (c.steps + 1 > k.maxSteps) return stop('step_budget', `${c.steps} steps used of ${k.maxSteps}`);
  const elapsed = s.atMs - c.startedAtMs;
  if (elapsed >= k.maxWallMs) return stop('wall_time', `${elapsed} ms elapsed of ${k.maxWallMs}`);
  const inWindow = c.callTimesMs.filter((t) => t > s.atMs - WINDOW_MS && t <= s.atMs).length;
  if (inWindow + 1 > k.maxToolCallsPerMinute) return stop('rate_limit', `${inWindow} calls in the last minute, limit ${k.maxToolCallsPerMinute}`);
  if (s.origin !== null && !c.origins.includes(s.origin) && c.origins.length + 1 > k.maxDistinctOrigins) return stop('origin_budget', `${c.origins.length} origins used of ${k.maxDistinctOrigins}`);
  if (c.moneyMicrosUsed + s.estMoneyMicros > k.reservedMoneyMicros) return stop('money_reserve', `${c.moneyMicrosUsed} + ${s.estMoneyMicros} over the reserved ${k.reservedMoneyMicros}`);
  if (c.tokensUsed + s.estTokens > k.reservedTokens) return stop('token_reserve', `${c.tokensUsed} + ${s.estTokens} over the reserved ${k.reservedTokens}`);
  return { action: 'continue' };
}

/** Counters after an accepted step finished, using its ACTUAL cost. The call-time list keeps only the last minute. */
export function recordRunStep(c: RunCounters, s: RunStepProposal, o: RunStepOutcome): RunCounters {
  return {
    ...c,
    steps: c.steps + 1,
    callTimesMs: [...c.callTimesMs.filter((t) => t > s.atMs - WINDOW_MS), s.atMs],
    origins: s.origin !== null && !c.origins.includes(s.origin) ? [...c.origins, s.origin] : c.origins,
    moneyMicrosUsed: c.moneyMicrosUsed + o.actualMoneyMicros,
    tokensUsed: c.tokensUsed + o.actualTokens,
    consecutiveFailures: o.ok ? 0 : c.consecutiveFailures + 1,
  };
}

/** Latches a stop decision into the counters so that every later proposal is refused. */
export function latchStop(c: RunCounters, d: RunCapsDecision): RunCounters {
  return d.action === 'stop' && !c.stoppedBy ? { ...c, stoppedBy: d.reason } : c;
}
