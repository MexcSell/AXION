/**
 * c95 fixture design (R6-5 first slice). COMMITTED BEFORE the checker, the fake executor or any fixture was written or run.
 * An engineering control, not evidence: these scripts test the harness and the checker, not any agent. Nothing executes.
 *
 * The bound (shared/contracts/src/run-caps.ts, RUN_STOP_BOUND): a runaway is stopped after at most capSteps + 1 accepted steps,
 * and zero steps are accepted after a halt. Every number below (`capSteps`, `accepted`) was worked out BY HAND from the caps and
 * the script, never computed by checker code. The worked line sits next to each spec.
 *
 * Not covered by the bound: money or tokens overshoot INSIDE the one extra step (a step whose actual cost is far above its
 * estimate is only caught on the next step). Late billing reports. Real tools.
 *
 * Interleaving counts (hand-derived, multinomial n!/(a!b!...)):
 *   H3 = 3 workers x (begin, commit) + 1 halt event:   7!/(2!2!2!)      = 630
 *   H2 = 2 workers x 2 x (begin, commit) + 1 halt:     9!/(4!4!)         = 630
 *   R2 = 2 workers x (begin, commit) + 1 reclaim:      5!/(2!2!)         = 30
 *   C2 = 2 workers x (begin, commit), maxSteps = 1:    4!/(2!2!)         = 6
 *
 * If a spec turns out wrong after a run, the fix is a separate, visible commit named in the report.
 */
import type { RunCaps, RunClassBreaker, RunTaskStage } from '../../../shared/contracts/src/index.ts';

export type RunawayKind = 'infinite_loop' | 'repeated_failure' | 'spend_spike' | 'new_origin_per_step' | 'call_burst';

export interface ScriptedStep {
  tool: string;
  origin: string | null;
  /** ms since the run started */
  atMs: number;
  estMoneyMicros: number;
  estTokens: number;
  actualMoneyMicros: number;
  actualTokens: number;
  ok: boolean;
}

export interface FixtureSpec {
  id: string;
  kind: RunawayKind;
  stage: RunTaskStage;
  caps: RunCaps;
  breaker: RunClassBreaker;
  /** the i-th proposed step, i starting at 1 */
  script: (i: number) => ScriptedStep;
  /** hand-derived: steps the tightest cap allows, in actual terms */
  capSteps: number;
  /** hand-derived: exactly how many steps are accepted before the stop */
  accepted: number;
  reason: 'step_budget' | 'wall_time' | 'rate_limit' | 'origin_budget' | 'money_reserve' | 'token_reserve' | 'circuit_breaker';
  /** the worked derivation, in words */
  why: string;
}

/** The harness stops any run at this many proposals. Reaching it is a FAIL (the checker never stopped), so a broken checker cannot hang vitest. */
export const HARNESS_CEILING = 2000;
/** Halt injected after this many accepted steps, into every sequential fixture (0 = halted before the first step). */
export const HALT_AFTER = [0, 1, 2] as const;

const LOOSE: RunCaps = { maxSteps: 1000, maxWallMs: 3_600_000, maxToolCallsPerMinute: 1000, maxDistinctOrigins: 1000, reservedMoneyMicros: 1_000_000_000_000, reservedTokens: 1_000_000_000_000 };
const loose = (o: Partial<RunCaps>): RunCaps => ({ ...LOOSE, ...o });
const breaker = (stage: RunTaskStage, k = 1000): RunClassBreaker => ({ taskClass: 'fixture', stage, maxConsecutiveFailures: k });
const step = (i: number, o: Partial<ScriptedStep> = {}): ScriptedStep => ({
  tool: 'browse', origin: 'https://a.test', atMs: (i - 1) * 1000, estMoneyMicros: 1, estTokens: 1, actualMoneyMicros: 1, actualTokens: 1, ok: true, ...o,
});

const loop = (n: number): FixtureSpec => ({
  id: `loop-steps-${n}`, kind: 'infinite_loop', stage: 2, caps: loose({ maxSteps: n }), breaker: breaker(2), script: (i) => step(i),
  capSteps: n, accepted: n, reason: 'step_budget', why: `maxSteps ${n}: steps 1..${n} accepted (steps so far < ${n}); step ${n + 1} sees steps = ${n} and stops`,
});
const loopWall = (id: string, stepMs: number, wall: number, n: number): FixtureSpec => ({
  id, kind: 'infinite_loop', stage: 2, caps: loose({ maxWallMs: wall }), breaker: breaker(2), script: (i) => step(i, { atMs: (i - 1) * stepMs }),
  capSteps: n, accepted: n, reason: 'wall_time', why: `step i starts at ${stepMs}*(i-1) ms and is accepted while that is < ${wall}: ${n} steps; step ${n + 1} starts at ${n * stepMs} >= ${wall}`,
});
const failing = (k: number, stage: RunTaskStage): FixtureSpec => ({
  id: `fail-breaker-${k}-s${stage}`, kind: 'repeated_failure', stage, caps: loose({}), breaker: breaker(stage, k), script: (i) => step(i, { ok: false }),
  capSteps: k, accepted: k, reason: 'circuit_breaker', why: `every step fails; after ${k} failures in a row the next proposal is stopped: ${k} accepted`,
});
const money = (id: string, reserve: number, gen: (i: number) => Partial<ScriptedStep>, capSteps: number, accepted: number, why: string): FixtureSpec => ({
  id, kind: 'spend_spike', stage: 3, caps: loose({ reservedMoneyMicros: reserve }), breaker: breaker(3), script: (i) => step(i, gen(i)),
  capSteps, accepted, reason: 'money_reserve', why,
});
const tokens = (id: string, reserve: number, gen: (i: number) => Partial<ScriptedStep>, capSteps: number, accepted: number, why: string): FixtureSpec => ({
  id, kind: 'spend_spike', stage: 3, caps: loose({ reservedTokens: reserve }), breaker: breaker(3), script: (i) => step(i, gen(i)),
  capSteps, accepted, reason: 'token_reserve', why,
});
const origins = (m: number): FixtureSpec => ({
  id: `origins-${m}`, kind: 'new_origin_per_step', stage: 2, caps: loose({ maxDistinctOrigins: m }), breaker: breaker(2), script: (i) => step(i, { origin: `https://o${i}.test` }),
  capSteps: m, accepted: m, reason: 'origin_budget', why: `step i touches a new origin; the ${m} origins fit, step ${m + 1} would be origin number ${m + 1} > ${m}`,
});
const burst = (r: number): FixtureSpec => ({
  id: `burst-${r}-per-min`, kind: 'call_burst', stage: 2, caps: loose({ maxToolCallsPerMinute: r }), breaker: breaker(2), script: (i) => step(i, { atMs: (i - 1) * 100 }),
  capSteps: r, accepted: r, reason: 'rate_limit', why: `a call every 100 ms, so all calls fall in one 60 s window; ${r} fit, call ${r + 1} makes ${r + 1} > ${r}`,
});

export const SEQUENTIAL_FIXTURES: FixtureSpec[] = [
  // infinite loop: 5 step caps + 3 wall caps = 8
  loop(1), loop(3), loop(10), loop(50), loop(100),
  loopWall('loop-wall-1000x5', 1000, 5000, 5),
  loopWall('loop-wall-700x3000', 700, 3000, 5), // starts 0,700,1400,2100,2800 are < 3000; 3500 is not
  loopWall('loop-wall-at-1ms', 1000, 1, 1), // only the step at 0 ms starts before 1 ms
  // repeated failing call: 6
  failing(1, 2), failing(2, 2), failing(3, 3), failing(5, 2), failing(10, 3), failing(4, 3),
  // spend spike: 7
  money('spend-even-100-of-1000', 1000, () => ({ estMoneyMicros: 100, actualMoneyMicros: 100 }), 10, 10, 'est=actual=100, reserve 1000: after 10 steps used 1000; step 11 needs 1100 > 1000'),
  money('spend-announced-spike', 1000, (i) => (i === 4 ? { estMoneyMicros: 5000, actualMoneyMicros: 5000 } : { estMoneyMicros: 100, actualMoneyMicros: 100 }), 3, 3, 'steps 1-3 use 300; step 4 estimates 5000, 300+5000 > 1000, refused before it runs'),
  money('spend-hidden-spike', 1000, (i) => (i === 3 ? { estMoneyMicros: 100, actualMoneyMicros: 5000 } : { estMoneyMicros: 100, actualMoneyMicros: 100 }), 2, 3, 'step 3 estimates 100 but costs 5000 (the +1 case): accepted, used 5200; step 4 stopped. In actual terms the reserve allows 2 steps (200 used, step 3 truly costs 5000), so capSteps 2 and accepted 3 = capSteps + 1'),
  money('spend-doubling', 1000, (i) => ({ estMoneyMicros: 10 * 2 ** (i - 1), actualMoneyMicros: 10 * 2 ** (i - 1) }), 6, 6, 'costs 10,20,40,80,160,320 sum 630; step 7 costs 640, 630+640 > 1000'),
  money('spend-exactly-at-reserve', 1000, () => ({ estMoneyMicros: 250, actualMoneyMicros: 250 }), 4, 4, '4 steps of 250 reach exactly 1000, which is allowed (used+est <= reserve); step 5 would be 1250'),
  tokens('tokens-even-500-of-2000', 2000, () => ({ estTokens: 500, actualTokens: 500 }), 4, 4, '4 x 500 = 2000 exactly; step 5 would be 2500'),
  tokens('tokens-hidden-spike', 1000, (i) => (i === 2 ? { estTokens: 100, actualTokens: 4000 } : { estTokens: 100, actualTokens: 100 }), 1, 2, 'step 2 estimates 100 but uses 4000 (the +1 case): accepted, used 4100; step 3 stopped. In actual terms the reserve allows 1 step, so capSteps 1 and accepted 2 = capSteps + 1'),
  // new origin per step: 5
  origins(1), origins(2), origins(3), origins(5), origins(8),
  // call burst: 3
  burst(1), burst(5), burst(10),
];

export const THRESHOLDS = {
  /** (a) at least this many runaway fixtures, each stopped at or before capSteps + 1 */
  minRunaways: 25,
  /** (b) 100% of fixtures, including these interleaving counts, accept zero steps after a halt */
  interleavings: { H3: 630, H2: 630, R2: 30, C2: 6 },
} as const;
