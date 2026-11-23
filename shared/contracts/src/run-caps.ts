/**
 * Improvement cycle 95 (R6-5, first slice): per-run caps and the shapes the pure caps checker (server/src/jobs/run-caps.ts) uses.
 *
 * What this is: an ENGINEERING CONTROL, not evidence. The research (phase2/research-r6.md R6-5) found no source that measures how
 * well a kill switch or a budget cap works, and this slice does not measure it either. Nothing executes yet: no agent runs, no
 * model is called, nothing here is stored. The checker is pure and is tested against a fake executor of scripted runaways.
 * Out of scope on purpose: the halt-record table (a later lane; here the halt state is an input) and binding caps to the approval
 * digest (needs a digest version change, deferred).
 *
 * THE STOP BOUND (written and committed before any fixture ran; see RUN_STOP_BOUND):
 *   "capSteps" of a fixture is the number of steps its tightest cap allows, worked out by hand in the fixture spec.
 *   B1. A run is stopped after at most capSteps + 1 accepted steps. Steps are counted, never seconds.
 *   B2. The checker looks at a proposed step BEFORE it runs and counts that step's own estimate, so the +1 can only come from an
 *       estimate that was too low (actual cost above estimate, recorded after the step) or, for wall time, from a step that began
 *       before the deadline and ended after it.
 *   B3. After a halt is set, zero steps are accepted. This is checked at the moment a step takes effect, not only when it is
 *       admitted, because a step admitted before the halt can take effect after it.
 *   NOT covered: the money or token overshoot inside that one extra step (an actual cost far above its estimate is not bounded
 *   by this slice); real billing arriving late; anything about real tools. "Zero after halt" relies on the check and the effect
 *   being one atomic action, which the fake store models but this slice does not build.
 */

export const RUN_CAPS_VERSION = 1;

export const RUN_STOP_BOUND = {
  capPlusSteps: 1,
  text: 'Accepted steps <= capSteps + 1 (steps, not seconds); zero accepted steps after a halt, at the moment the step takes effect.',
} as const;

/** Task-class stage. Classes at stage 2 or 3 (they may act on the world) must have caps on every lease. */
export const RUN_TASK_STAGES = [0, 1, 2, 3] as const;
export type RunTaskStage = (typeof RUN_TASK_STAGES)[number];
export const stageNeedsCaps = (s: RunTaskStage): boolean => s === 2 || s === 3;

/** Per-run budgets. Every field is a safe non-negative integer. Money and tokens are amounts reserved BEFORE the run starts. */
export interface RunCaps {
  maxSteps: number;
  maxWallMs: number;
  maxToolCallsPerMinute: number;
  maxDistinctOrigins: number;
  reservedMoneyMicros: number;
  reservedTokens: number;
}
export const RUN_CAP_FIELDS = ['maxSteps', 'maxWallMs', 'maxToolCallsPerMinute', 'maxDistinctOrigins', 'reservedMoneyMicros', 'reservedTokens'] as const satisfies readonly (keyof RunCaps)[];

/** Per-class circuit breaker: this many failed steps in a row stop the run. The stage is part of the class setting. */
export interface RunClassBreaker {
  taskClass: string;
  stage: RunTaskStage;
  maxConsecutiveFailures: number;
}

/** What the run has used so far. `startedAtMs` and every time come from one clock (enforcement would supply database now()). */
export interface RunCounters {
  steps: number;
  startedAtMs: number;
  /** times of accepted calls, used for the per-minute rate (older than 60 s are dropped by recordRunStep) */
  callTimesMs: number[];
  origins: string[];
  moneyMicrosUsed: number;
  tokensUsed: number;
  consecutiveFailures: number;
  /** latched stop: once set every later proposal is refused, so a cap that frees up again (the rate window) is not a retry */
  stoppedBy: RunStopReason | null;
}

export interface RunStepProposal {
  tool: string;
  /** the origin the step would touch, or null for a step that touches none */
  origin: string | null;
  atMs: number;
  estMoneyMicros: number;
  estTokens: number;
  fencingToken: number;
}

/** The halt state is an input here; the halt-record table that would store it is a later lane. A halt sets only this flag. */
export interface RunHaltState { halted: boolean; reason?: string }

export const RUN_STOP_REASONS = [
  'halted', 'stale_fencing_token', 'already_stopped', 'caps_missing', 'caps_invalid', 'bad_input',
  'step_budget', 'wall_time', 'rate_limit', 'origin_budget', 'money_reserve', 'token_reserve', 'circuit_breaker',
] as const;
export type RunStopReason = (typeof RUN_STOP_REASONS)[number];

/** A stop is final: `retry` is always false. */
export type RunCapsDecision =
  | { action: 'continue' }
  | { action: 'stop'; reason: RunStopReason; retry: false; detail: string };

/** What a finished step reports back, so the counters can be updated with the ACTUAL cost. */
export interface RunStepOutcome { ok: boolean; actualMoneyMicros: number; actualTokens: number }
