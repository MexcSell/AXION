import { describe, it, expect } from 'vitest';
import type { RunCaps, RunClassBreaker, RunCounters, RunStepProposal, RunHaltState } from '../../shared/contracts/src/index.ts';
import { RUN_STOP_REASONS, stageNeedsCaps } from '../../shared/contracts/src/index.ts';
import { checkRunStep, latchStop, newRunCounters, recordRunStep } from '../src/jobs/run-caps.ts';

/** c95 unit tests: every stop reason, the boundaries (exactly at the cap) and the fencing token. An engineering control, not evidence. */
const CAPS: RunCaps = { maxSteps: 5, maxWallMs: 10_000, maxToolCallsPerMinute: 3, maxDistinctOrigins: 2, reservedMoneyMicros: 100, reservedTokens: 100 };
const BR: RunClassBreaker = { taskClass: 'c', stage: 2, maxConsecutiveFailures: 3 };
const STEP: RunStepProposal = { tool: 'browse', origin: 'https://a.test', atMs: 0, estMoneyMicros: 1, estTokens: 1, fencingToken: 7 };
const counters = (o: Partial<RunCounters> = {}): RunCounters => ({ ...newRunCounters(0), ...o });
const ask = (o: { caps?: unknown; breaker?: RunClassBreaker; counters?: RunCounters; step?: Partial<RunStepProposal>; halt?: RunHaltState; token?: number } = {}) =>
  checkRunStep({ caps: ('caps' in o ? o.caps : CAPS) as RunCaps, breaker: o.breaker ?? BR, counters: o.counters ?? counters(), step: { ...STEP, ...o.step }, halt: ('halt' in o ? o.halt : { halted: false }) as RunHaltState, currentFencingToken: o.token ?? 7 });
const reason = (d: ReturnType<typeof ask>) => (d.action === 'stop' ? d.reason : 'continue');

describe('boundaries: one below the cap continues, exactly at the cap stops (steps) or is allowed (reserves)', () => {
  it('steps', () => {
    expect(reason(ask({ counters: counters({ steps: 4 }) }))).toBe('continue');
    expect(reason(ask({ counters: counters({ steps: 5 }) }))).toBe('step_budget');
    expect(reason(ask({ counters: counters({ steps: 6 }) }))).toBe('step_budget');
  });
  it('wall time: stops when elapsed reaches the cap', () => {
    expect(reason(ask({ step: { atMs: 9_999 } }))).toBe('continue');
    expect(reason(ask({ step: { atMs: 10_000 } }))).toBe('wall_time');
  });
  it('tool calls per minute: 3 fit, the 4th stops; a call exactly 60 s old has left the window', () => {
    expect(reason(ask({ counters: counters({ callTimesMs: [1000, 2000], steps: 2 }), step: { atMs: 3000 } }))).toBe('continue');
    expect(reason(ask({ counters: counters({ callTimesMs: [1000, 2000, 2500], steps: 3 }), step: { atMs: 3000 } }))).toBe('rate_limit');
    const long = { ...CAPS, maxWallMs: 1_000_000 };
    expect(reason(ask({ caps: long, counters: counters({ callTimesMs: [1000, 2000, 2500], steps: 3 }), step: { atMs: 61_000 } }))).toBe('continue'); // 1000 is exactly 60 s old: out
    expect(reason(ask({ caps: long, counters: counters({ callTimesMs: [1000, 2000, 2500], steps: 3 }), step: { atMs: 60_999 } }))).toBe('rate_limit');
  });
  it('distinct origins: a known origin never counts, the 3rd new origin stops, a null origin counts for nothing', () => {
    const two = counters({ origins: ['https://a.test', 'https://b.test'], steps: 2 });
    expect(reason(ask({ counters: two, step: { origin: 'https://b.test' } }))).toBe('continue');
    expect(reason(ask({ counters: two, step: { origin: null } }))).toBe('continue');
    expect(reason(ask({ counters: two, step: { origin: 'https://c.test' } }))).toBe('origin_budget');
    expect(reason(ask({ counters: counters({ origins: ['https://a.test'], steps: 1 }), step: { origin: 'https://b.test' } }))).toBe('continue');
  });
  it('money and tokens: used + estimate exactly at the reserve is allowed, one over stops', () => {
    expect(reason(ask({ counters: counters({ moneyMicrosUsed: 99 }) }))).toBe('continue');
    expect(reason(ask({ counters: counters({ moneyMicrosUsed: 100 }) }))).toBe('money_reserve');
    expect(reason(ask({ step: { estMoneyMicros: 100 } }))).toBe('continue');
    expect(reason(ask({ step: { estMoneyMicros: 101 } }))).toBe('money_reserve');
    expect(reason(ask({ counters: counters({ tokensUsed: 99 }) }))).toBe('continue');
    expect(reason(ask({ counters: counters({ tokensUsed: 100 }) }))).toBe('token_reserve');
    expect(reason(ask({ step: { estTokens: 101 } }))).toBe('token_reserve');
  });
  it('circuit breaker: stops when the failures in a row reach the limit', () => {
    expect(reason(ask({ counters: counters({ consecutiveFailures: 2 }) }))).toBe('continue');
    expect(reason(ask({ counters: counters({ consecutiveFailures: 3 }) }))).toBe('circuit_breaker');
  });
  it('a cap of 0 allows nothing', () => {
    expect(reason(ask({ caps: { ...CAPS, maxSteps: 0 } }))).toBe('step_budget');
  });
});

describe('every stop is final', () => {
  it('a stop carries retry: false and a detail', () => {
    const d = ask({ counters: counters({ steps: 5 }) });
    expect(d).toMatchObject({ action: 'stop', retry: false });
    expect(d.action === 'stop' && d.detail.length).toBeGreaterThan(0);
  });
  it('the stop is latched: a rate stop does not become a continue 61 s later', () => {
    const full = counters({ callTimesMs: [1000, 2000, 2500], steps: 3 });
    const d = ask({ counters: full, step: { atMs: 3000 } });
    expect(reason(d)).toBe('rate_limit');
    const latched = latchStop(full, d);
    const long = { ...CAPS, maxWallMs: 1_000_000 };
    expect(reason(ask({ caps: long, counters: full, step: { atMs: 70_000 } }))).toBe('continue'); // without the latch the window has emptied
    expect(reason(ask({ caps: long, counters: latched, step: { atMs: 70_000 } }))).toBe('already_stopped');
  });
  it('the first stop reason is kept', () => {
    const a = latchStop(counters(), { action: 'stop', reason: 'step_budget', retry: false, detail: 'x' });
    expect(latchStop(a, { action: 'stop', reason: 'wall_time', retry: false, detail: 'y' }).stoppedBy).toBe('step_budget');
    expect(latchStop(counters(), { action: 'continue' }).stoppedBy).toBeNull();
  });
});

describe('halt', () => {
  it('after a halt every step is refused, even a step that would otherwise continue', () => {
    expect(reason(ask({ halt: { halted: true, reason: 'operator' } }))).toBe('halted');
    expect(reason(ask({ halt: { halted: true }, counters: counters({ steps: 99 }) }))).toBe('halted');
  });
  it('a halt flag that is not a boolean is refused, never read as "not halted"', () => {
    for (const h of [undefined, null, 'no', 0, {}] as unknown[]) expect(reason(ask({ halt: h as RunHaltState }))).not.toBe('continue');
  });
  it('halt and the token are independent: a halt with the right token is halted; a stale token with no halt is stale', () => {
    expect(reason(ask({ halt: { halted: true }, token: 7 }))).toBe('halted');
    expect(reason(ask({ halt: { halted: false }, token: 8 }))).toBe('stale_fencing_token');
  });
});

describe('fencing token (equality with the current token, as lease_token = $3 in the c45 store)', () => {
  it('equal continues; lower and higher are both stale', () => {
    expect(reason(ask({ step: { fencingToken: 7 }, token: 7 }))).toBe('continue');
    expect(reason(ask({ step: { fencingToken: 6 }, token: 7 }))).toBe('stale_fencing_token');
    expect(reason(ask({ step: { fencingToken: 8 }, token: 7 }))).toBe('stale_fencing_token');
  });
  it('a token that is not a safe non-negative integer is stale', () => {
    for (const t of [NaN, -1, 1.5, Infinity, 2 ** 53, '7' as unknown as number, undefined as unknown as number]) expect(reason(ask({ step: { fencingToken: t } }))).toBe('stale_fencing_token');
    expect(reason(ask({ token: NaN }))).toBe('stale_fencing_token');
  });
  it('token 0 is a valid token', () => {
    expect(reason(ask({ step: { fencingToken: 0 }, token: 0 }))).toBe('continue');
  });
});

describe('caps presence and shape', () => {
  it('stage 2 and 3 without caps are refused; stage 0 and 1 are not', () => {
    expect([0, 1, 2, 3].map((s) => stageNeedsCaps(s as 0))).toEqual([false, false, true, true]);
    for (const stage of [2, 3] as const) expect(reason(ask({ caps: null, breaker: { ...BR, stage } }))).toBe('caps_missing');
    for (const stage of [0, 1] as const) expect(reason(ask({ caps: null, breaker: { ...BR, stage } }))).toBe('continue');
  });
  it('partial caps count as no caps', () => {
    const { reservedTokens: _t, ...partial } = CAPS;
    expect(reason(ask({ caps: partial }))).toBe('caps_missing');
    expect(reason(ask({ caps: { ...CAPS, maxSteps: null } }))).toBe('caps_missing');
  });
  it('a cap that is present but NaN, negative, fractional or infinite is invalid, in every stage', () => {
    for (const bad of [NaN, -1, 1.5, Infinity, '5']) for (const stage of [0, 2] as const) expect(reason(ask({ caps: { ...CAPS, maxSteps: bad }, breaker: { ...BR, stage } }))).toBe('caps_invalid');
  });
  it('an unknown stage or a bad breaker threshold is refused', () => {
    expect(reason(ask({ breaker: { ...BR, stage: 4 as 3 } }))).toBe('bad_input');
    expect(reason(ask({ breaker: { ...BR, maxConsecutiveFailures: 0 } }))).toBe('bad_input');
    expect(reason(ask({ breaker: { ...BR, maxConsecutiveFailures: NaN } }))).toBe('bad_input');
  });
  it('malformed counters or steps are refused, not read as zero', () => {
    expect(reason(ask({ counters: counters({ steps: NaN }) }))).toBe('bad_input');
    expect(reason(ask({ counters: counters({ moneyMicrosUsed: -1 }) }))).toBe('bad_input');
    expect(reason(ask({ step: { estMoneyMicros: NaN } }))).toBe('bad_input');
    expect(reason(ask({ step: { estTokens: -5 } }))).toBe('bad_input');
    expect(reason(ask({ step: { tool: '' } }))).toBe('bad_input');
    expect(reason(ask({ step: { atMs: -1 } }))).toBe('bad_input');
    expect(reason(ask({ counters: counters({ startedAtMs: 500 }), step: { atMs: 100 } }))).toBe('bad_input');
  });
});

describe('recordRunStep', () => {
  it('uses actual cost, tracks origins once, resets failures on success and prunes old calls', () => {
    let c = newRunCounters(0);
    c = recordRunStep(c, { ...STEP, atMs: 0 }, { ok: false, actualMoneyMicros: 40, actualTokens: 5 });
    c = recordRunStep(c, { ...STEP, atMs: 1000 }, { ok: false, actualMoneyMicros: 70, actualTokens: 5 });
    expect(c).toMatchObject({ steps: 2, moneyMicrosUsed: 110, tokensUsed: 10, consecutiveFailures: 2, origins: ['https://a.test'] });
    c = recordRunStep(c, { ...STEP, atMs: 62_000, origin: null }, { ok: true, actualMoneyMicros: 0, actualTokens: 0 });
    expect(c.consecutiveFailures).toBe(0);
    expect(c.callTimesMs).toEqual([62_000]);
  });
  it('does not mutate its input', () => {
    const c = newRunCounters(0);
    recordRunStep(c, STEP, { ok: true, actualMoneyMicros: 1, actualTokens: 1 });
    expect(c).toEqual(newRunCounters(0));
  });
});

describe('the reason list', () => {
  it('every reason in the contract is produced by some test above (no dead reason)', () => {
    const seen = new Set<string>(['halted', 'stale_fencing_token', 'already_stopped', 'caps_missing', 'caps_invalid', 'bad_input', 'step_budget', 'wall_time', 'rate_limit', 'origin_budget', 'money_reserve', 'token_reserve', 'circuit_breaker']);
    expect([...RUN_STOP_REASONS].sort()).toEqual([...seen].sort());
  });
});
