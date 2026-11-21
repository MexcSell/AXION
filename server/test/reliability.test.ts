import { describe, it, expect } from 'vitest';
import { reliabilityOf, reliabilityWindow, type ReliabilityRow } from '../src/agents/reliability.ts';

// Improvement cycle 3 (brief web/docs/improve/cycles/c03-brief.md): the pure reliability function, classification by
// classification. Reliable = passed with one attempt and never reassigned away from the agent; unreliable = failed, passed
// after a retry, or reassigned away (charged to the agent it left); canceled and open tasks count for nobody; n < 5 → null.
const NOW = new Date('2026-11-21T12:00:00Z');
const H = 3_600_000;
const D = 24 * H;
const W = reliabilityWindow(NOW);
const at = (msAgo: number) => new Date(NOW.getTime() - msAgo);
let seq = 0;
const task = (o: Partial<ReliabilityRow>): ReliabilityRow => ({
  taskId: `T-${++seq}`, status: 'passed', owner: 'a', attempts: 1, simulated: false, finishedAt: at(H), takenFrom: [], ...o,
});
const many = (k: number, o: Partial<ReliabilityRow>) => Array.from({ length: k }, () => task(o));
const rel = (rows: ReliabilityRow[], agent = 'a', includeSimulated = false) => reliabilityOf(rows, { ...W, includeSimulated })(agent);

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
  it('a passed task with no recorded attempt (no retry ever recorded) is a first-time pass', () => {
    expect(rel(many(5, { attempts: 0 }))).toMatchObject({ value: 100, n: 5 });
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
