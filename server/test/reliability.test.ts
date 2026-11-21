import { describe, it, expect } from 'vitest';
import { reliabilityOf, reliabilityWindow, type ReliabilityRow } from '../src/agents/reliability.ts';

// Improvement cycle 3 (brief web/docs/improve/cycles/c03-brief.md), with the fix-round attribution rule (review I2): every
// outcome counts against the agent that owned the task when it happened. Reassigned away = one unreliable for the agent it
// left; the new owner is judged only on its own attempts after the handover. Reliable = passed with exactly one own
// attempt; canceled and open tasks count for nobody; a pass with no own recorded attempt is left out (m2); n < 5 → null.
const NOW = new Date('2026-11-21T12:00:00Z');
const H = 3_600_000;
const D = 24 * H;
const W = reliabilityWindow(NOW);
const at = (msAgo: number) => new Date(NOW.getTime() - msAgo);
let seq = 0;
type T = Omit<Partial<ReliabilityRow>, 'attempts'> & { attempts?: number | (Date | null)[]; takenFrom?: string[] };
/** Defaults: owner a, passed, one attempt 2 h ago, finished 1 h ago. `takenFrom` = handovers 3 h ago (before any attempt), task state 'ready'. */
const task = (o: T): ReliabilityRow => {
  const { attempts = 1, takenFrom = [], ...rest } = o;
  return {
    taskId: `T-${++seq}`, status: 'passed', owner: 'a', simulated: false, finishedAt: at(H),
    attempts: typeof attempts === 'number' ? Array.from({ length: attempts }, (_, i) => at(2 * H - i * 60_000)) : attempts,
    handovers: takenFrom.map((from, i) => ({ from, at: at(3 * H - i * 60_000), state: 'ready' })),
    ...rest,
  };
};
const many = (k: number, o: T) => Array.from({ length: k }, () => task(o));
const rel = (rows: ReliabilityRow[], agent = 'a', includeSimulated = false) => reliabilityOf(rows, { ...W, includeSimulated })(agent);
const SUFFIX = 'last 90 days · from missions you can see';

describe('window and shape', () => {
  it('the window is the last 90 days, inclusive at both ends', () => {
    expect(W.to.getTime() - W.from.getTime()).toBe(90 * D);
    expect(W.to.getTime()).toBe(NOW.getTime());
  });
  it('an agent without evidence: value null, n 0, window 90d, simulated not included, an honest sentence', () => {
    expect(rel([])).toEqual({ value: null, n: 0, window: '90d', includesSimulated: false,
      evidence: 'not enough evidence (0 of 5) · no finished tasks · last 90 days · from missions you can see' });
  });
});

describe('classifications', () => {
  it('first-time pass: reliable (5 of 5 → 100)', () => {
    expect(rel(many(5, {}))).toMatchObject({ value: 100, n: 5, evidence: '5 of 5 finished tasks passed first time · last 90 days · from missions you can see' });
  });
  it('a passed task with no recorded attempt is not a first-time pass: left out of n, and the sentence says so (m2)', () => {
    expect(rel([...many(5, {}), task({ attempts: 0 })])).toMatchObject({ value: 100, n: 5,
      evidence: `5 of 5 finished tasks passed first time · 1 passed with no recorded attempt of its own (not counted) · ${SUFFIX}` });
    expect(rel(many(5, { attempts: 0 }))).toMatchObject({ value: null, n: 0 });
  });
  it('retried pass: unreliable', () => {
    expect(rel([...many(4, {}), task({ attempts: 2 })])).toMatchObject({ value: 80, n: 5,
      evidence: '4 of 5 finished tasks passed first time · 1 retried · last 90 days · from missions you can see' });
  });
  it('failed: unreliable (also with one attempt)', () => {
    expect(rel([...many(3, {}), task({ status: 'failed' }), task({ status: 'failed', attempts: 3 })])).toMatchObject({ value: 60, n: 5,
      evidence: '3 of 5 finished tasks passed first time · 2 failed · last 90 days · from missions you can see' });
  });
  it('reassigned away: counts against the agent it left, even though it passed first time elsewhere', () => {
    const moved = task({ owner: 'b', takenFrom: ['a'] });
    expect(rel([...many(4, {}), moved])).toMatchObject({ value: 80, n: 5,
      evidence: '4 of 5 finished tasks passed first time · 1 reassigned away · last 90 days · from missions you can see' });
    // the agent that finished it first time and never lost it is credited
    expect(rel([moved, ...many(4, { owner: 'b' })], 'b')).toMatchObject({ value: 100, n: 5 });
  });
  it('A → B → A: one unreliable for A (not also reliable), one for B', () => {
    const back = task({ owner: 'a', takenFrom: ['a', 'b'] });
    expect(rel([back, ...many(4, {})])).toMatchObject({ value: 80, n: 5 });
    expect(rel([back], 'b')).toMatchObject({ value: null, n: 1 });
  });
  it('taken away twice from the same agent still counts once', () => {
    expect(rel([task({ owner: 'c', takenFrom: ['a', 'b', 'a'] })])).toMatchObject({ n: 1 });
  });
  it('reassigned away while the task is still open counts for nobody', () => {
    for (const status of ['created', 'ready', 'running', 'waiting_agent', 'waiting_user', 'verifying', 'retry_ready']) {
      const open = task({ owner: 'b', takenFrom: ['a'], status });
      expect(rel([open]).n).toBe(0);
      expect(rel([open], 'b').n).toBe(0);
    }
  });
  it('canceled is excluded from n for the owner and for agents it was taken from', () => {
    const rows = [...many(5, {}), task({ status: 'canceled' }), task({ status: 'canceled', owner: 'b', takenFrom: ['a'] })];
    expect(rel(rows)).toMatchObject({ value: 100, n: 5 });
    expect(rel(rows, 'b')).toMatchObject({ n: 0 });
  });
  it('a task without a final owner still counts against the agents it was taken from', () => {
    expect(rel([task({ owner: null, status: 'failed', takenFrom: ['a'] })])).toMatchObject({ n: 1 });
  });
  it('the value is a percentage with 0 decimals', () => {
    expect(rel([...many(4, {}), task({ status: 'failed' }), task({ attempts: 2 })]).value).toBe(67); // 4 / 6
    expect(rel([...many(2, {}), ...many(5, { status: 'failed' })]).value).toBe(29); // 2 / 7 = 28.57
  });
});

describe('attribution across handovers (fix round I2, m7): each outcome counts against the owner at that time', () => {
  // A attempted and failed 2 h ago; a person reassigned the failed task to B 90 min ago
  const handed = (o: T & { state?: string; handAt?: Date } = {}) => {
    const r = task({ owner: 'b', status: 'failed', attempts: [at(2 * H)], ...o });
    r.handovers = [{ from: 'a', at: o.handAt ?? at(1.5 * H), state: o.state ?? 'failed' }];
    return r;
  };
  it('reassigning a failed task never adds a failure to the receiving agent (it did not attempt it)', () => {
    const r = handed();
    expect(rel([r], 'a')).toMatchObject({ n: 1, evidence: `not enough evidence (1 of 5) · 0 of 1 finished task passed first time · 1 reassigned away · ${SUFFIX}` });
    expect(rel([r], 'b')).toEqual({ value: null, n: 0, window: '90d', includesSimulated: false,
      evidence: `not enough evidence (0 of 5) · no finished tasks · 1 taken over after failing elsewhere (not counted) · ${SUFFIX}` });
  });
  it('the new owner\'s first attempt after the handover is its first time: one own attempt + passed = reliable', () => {
    const r = handed({ status: 'passed', attempts: [at(2 * H), at(1 * H)] });
    expect(rel([r, ...many(4, { owner: 'b' })], 'b')).toMatchObject({ value: 100, n: 5 });
    expect(rel([r], 'a')).toMatchObject({ n: 1 });
  });
  it('a retry placeholder (not started yet, no time) belongs to the owner that runs it', () => {
    const r = handed({ status: 'passed', attempts: [at(2 * H), null] });
    expect(rel([r, ...many(4, { owner: 'b' })], 'b')).toMatchObject({ value: 100, n: 5 });
  });
  it('the new owner fails after its own attempt: failed for it', () => {
    expect(rel([handed({ attempts: [at(2 * H), at(1 * H)] })], 'b')).toMatchObject({ n: 1, evidence: `not enough evidence (1 of 5) · 0 of 1 finished task passed first time · 1 failed · ${SUFFIX}` });
  });
  it('two own attempts after the handover: retried for the new owner; earlier attempts are never charged to it', () => {
    expect(rel([handed({ status: 'passed', attempts: [at(2 * H), at(1.2 * H), at(1.1 * H)] })], 'b').evidence).toContain('1 retried');
    expect(rel([handed({ status: 'passed', attempts: [at(3 * H), at(2.5 * H), at(2 * H), at(1 * H)] })], 'b').evidence).toContain('1 of 1 finished task passed first time');
  });
  it('handed over while verifying and then passed without an own attempt: not counted for the new owner', () => {
    expect(rel([handed({ status: 'passed', state: 'verifying' })], 'b')).toMatchObject({ n: 0, evidence: expect.stringContaining('1 passed with no recorded attempt of its own (not counted)') });
  });
  it('handed over before it failed (it was not failed yet): the failure happened under the new owner', () => {
    expect(rel([handed({ state: 'verifying' })], 'b')).toMatchObject({ n: 1, evidence: expect.stringContaining('1 failed') });
  });
  it('multiple reassignments A → B → C: A and B each one "reassigned away"; C judged on its own attempts only', () => {
    const r = task({ owner: 'c', status: 'passed', attempts: [at(5 * H), at(4 * H), at(1 * H)] });
    r.handovers = [{ from: 'a', at: at(4.5 * H), state: 'failed' }, { from: 'b', at: at(3 * H), state: 'failed' }];
    expect(rel([r], 'a')).toMatchObject({ n: 1, evidence: expect.stringContaining('1 reassigned away') });
    expect(rel([r], 'b')).toMatchObject({ n: 1, evidence: expect.stringContaining('1 reassigned away') });
    expect(rel([r, ...many(4, { owner: 'c' })], 'c')).toMatchObject({ value: 100, n: 5 });
  });
  it('A → B → A: A is charged once (reassigned away), never also credited', () => {
    const r = task({ owner: 'a', status: 'passed', attempts: [at(1 * H)] });
    r.handovers = [{ from: 'a', at: at(4 * H), state: 'ready' }, { from: 'b', at: at(3 * H), state: 'ready' }];
    expect(rel([r], 'a')).toMatchObject({ n: 1, evidence: expect.stringContaining('0 of 1 finished task passed first time · 1 reassigned away') });
  });
});

describe('threshold', () => {
  it('n < 5 gives null and says how much evidence there is', () => {
    expect(rel([...many(3, {}), task({ status: 'failed' })])).toEqual({ value: null, n: 4, window: '90d', includesSimulated: false,
      evidence: 'not enough evidence (4 of 5) · 3 of 4 finished tasks passed first time · 1 failed · last 90 days · from missions you can see' });
  });
  it('n = 5 gives a value, also 0', () => {
    expect(rel(many(5, { status: 'failed' }))).toMatchObject({ value: 0, n: 5 });
  });
  it('the brief\'s example sentence', () => {
    const rows = [...many(4, {}), task({ attempts: 2 }), task({ owner: 'z', takenFrom: ['a'] })];
    expect(rel(rows).evidence).toBe('4 of 6 finished tasks passed first time · 1 retried · 1 reassigned away · last 90 days · from missions you can see');
  });
});

describe('window boundary', () => {
  it('a task finished exactly at the start or the end of the window counts; just outside does not', () => {
    const inside = [task({ finishedAt: new Date(W.from.getTime()) }), task({ finishedAt: new Date(W.to.getTime()) })];
    const outside = [task({ finishedAt: new Date(W.from.getTime() - 1) }), task({ finishedAt: new Date(W.to.getTime() + 1) })];
    expect(rel([...inside, ...outside, ...many(3, { finishedAt: at(30 * D) })])).toMatchObject({ n: 5, value: 100 });
  });
  it('a reassigned-away task is placed by its finish time too', () => {
    expect(rel([task({ owner: 'b', takenFrom: ['a'], finishedAt: at(91 * D) })]).n).toBe(0);
  });
});

describe('simulated (DEMO) tasks', () => {
  it('are excluded by default and included on request, which the result says', () => {
    const rows = [...many(3, {}), ...many(2, { simulated: true, status: 'failed' }), task({ simulated: true, owner: 'b', takenFrom: ['a'] })];
    expect(rel(rows)).toMatchObject({ value: null, n: 3, includesSimulated: false });
    const inc = rel(rows, 'a', true);
    expect(inc).toMatchObject({ value: 50, n: 6, includesSimulated: true });
    expect(inc.evidence).toBe('3 of 6 finished tasks passed first time · 2 failed · 1 reassigned away · last 90 days · from missions you can see · DEMO tasks included');
  });
});
