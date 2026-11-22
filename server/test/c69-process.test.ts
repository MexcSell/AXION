import { describe, it, expect } from 'vitest';
import { computeProcess, type ProcInput } from '../src/company/process.ts';
import { PROCESS_KEYS, CHURN_MIN_TASKS } from '../../shared/contracts/src/index.ts';
import { windowOf } from '../src/company/scorecard.ts';

/**
 * Improvement cycle 69 (R3-5), item 1: the process-metric read model, pure. Every figure below was computed by hand from the fixture
 * and is asserted with exact equality. Nothing touches a database. The definitions are the brief's own (see c69-report.md).
 *
 * NOW = 2026-11-21T12:00Z, window 30d = [2026-10-22T12:00Z, NOW]. Previous window = the 30 days before it.
 */
const NOW = new Date('2026-11-21T12:00:00Z');
const H = 3_600_000, D = 24 * H;
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const empty = (): ProcInput => ({ agents: [], missions: [], tasks: [], reviews: [], tags: [], briefs: [], ownerHistory: [], handoffs: [] });
const run = (i: ProcInput, dept: string | null = null, w: '7d' | '30d' | '90d' = '30d') => { const x = windowOf(w, NOW); return computeProcess(i, { window: w, from: x.from, to: x.to, department: dept }); };
const cell = (r: ReturnType<typeof run>, key: string) => r.cells.find((c) => c.key === `process.${key}`)!;

const AGENTS = [{ id: 'a1', dept: 'Eng', active: true }, { id: 'a2', dept: 'Eng', active: true }, { id: 'b1', dept: 'Ops', active: true }];
const task = (id: string, owner: string, o: Partial<ProcInput['tasks'][number]> = {}): ProcInput['tasks'][number] => ({ id, missionId: 'M1', owner, status: 'passed', simulated: false, ...o });
let seq = 0;
const review = (taskId: string, verdict: string, at: Date, o: Partial<ProcInput['reviews'][number]> = {}): ProcInput['reviews'][number] =>
  ({ taskId, missionId: 'M1', verdict, at, seq: ++seq, stale: false, failedCriteria: 0, attemptNo: 1, simulated: false, ...o });

/** Reviews and tasks. See the hand computation in each test. */
function reviewFixture(): ProcInput {
  const i = empty();
  i.agents = AGENTS;
  i.missions = [{ id: 'M1', demo: false }, { id: 'M2', demo: false }];
  i.tasks = [
    task('t1', 'a1'), task('t2', 'a1'), task('t3', 'a1'), task('t4', 'a1'), task('t5', 'a1'), task('t6', 'a1'), task('t7', 'b1'), task('t8', 'a2'),
    task('tx', 'a1', { simulated: true }),
    task('t9', 'a1', { status: 'passed' }), task('t10', 'a1', { status: 'verifying' }), task('t11', 'a1', { status: 'running' }),
    task('p1', 'a1'), task('p2', 'a1'),
  ];
  i.reviews = [
    review('t1', 'accepted', ago(10 * D)),
    review('t2', 'changes_requested', ago(9 * D), { failedCriteria: 1 }), review('t2', 'accepted', ago(5 * D)),
    review('t3', 'rejected', ago(8 * D)),
    review('t4', 'changes_requested', ago(7 * D)),
    review('t5', 'changes_requested', ago(6 * D)),
    review('t6', 'accepted', ago(40 * D)), review('t6', 'accepted', ago(2 * D)),
    review('t7', 'accepted', ago(3 * D)),
    review('t8', 'accepted', ago(4 * D), { stale: true }),
    review('tx', 'rejected', ago(3 * D), { simulated: true }),
    review('p1', 'changes_requested', ago(45 * D)), review('p2', 'accepted', ago(50 * D)),
  ];
  i.tags = [
    { taskId: 't3', modeId: 'FM-1.1', at: ago(7 * D) },
    { taskId: 't4', modeId: 'FM-1.1', at: ago(6 * D) }, { taskId: 't4', modeId: 'FM-2.2', at: ago(6 * D) },
    { taskId: 't5', modeId: 'FM-3.1', at: new Date(NOW.getTime() + H) }, // confirmed AFTER the window end: not known then
  ];
  return i;
}

describe('process metrics: the model shape', () => {
  it('has exactly the seven cells, in order, each with n and a window or an explicit "not enough evidence"', () => {
    for (const input of [empty(), reviewFixture()]) for (const w of ['7d', '30d', '90d'] as const) {
      const r = run(input, null, w);
      expect(r.cells.map((c) => c.key)).toEqual(PROCESS_KEYS.map((k) => `process.${k}`));
      for (const c of r.cells) {
        if (c.state === 'unmeasured') { expect([c.value, c.n, c.trend], c.key).toEqual([null, null, null]); expect(c.evidence, c.key).toMatch(/^not measured/); }
        else if (c.value === null) { expect(c.state, c.key).toBe('none'); expect(c.evidence.startsWith(`not enough evidence (n = ${c.n})`), `${c.key}: ${c.evidence}`).toBe(true); }
        else { expect(c.state, c.key).toBe('ok'); expect(c.n!, c.key).toBeGreaterThanOrEqual(c.minN); expect(c.from && c.to, c.key).toBeTruthy(); }
      }
    }
  });
  it('cost and the approval decision time are unmeasured cells with the reason, never numbers', () => {
    const r = run(reviewFixture());
    expect(cell(r, 'cost')).toMatchObject({ value: null, n: null, state: 'unmeasured', evidence: expect.stringContaining('Stage 9') });
    expect(cell(r, 'approval_decision_h')).toMatchObject({ value: null, n: null, state: 'unmeasured', evidence: expect.stringContaining('not recomputed') });
  });
});

describe('return-for-rework rate (hand-computed)', () => {
  // Cohort = tasks whose FIRST review decision falls in the window: t1 t2 t3 t4 t5 t7 t8 (t6's first review is 40 days old; tx is simulated) = 7.
  // Returned (changes_requested or rejected on that first decision): t2 t3 t4 t5 = 4. 4/7 = 57.142857...% -> 57.1.
  // Open (finished or verifying, no review as of the end): t9 t10 = 2. t11 is still running: not open. Never in the denominator.
  // Causes of the 4: t2 no tag but a failed criterion; t3 FM-1.1; t4 two modes; t5 has no tag known at the end (its tag is confirmed later) and no failed criterion.
  it('whole company', () => {
    const c = cell(run(reviewFixture()), 'rework_rate');
    expect(c).toMatchObject({ value: 57.1, n: 7, unit: '%', state: 'ok', open: { n: 2 } });
    expect(c.breakdown).toEqual([{ label: 'FM-1.1', n: 1 }, { label: 'a criterion failed (no failure tag)', n: 1 }, { label: 'no recorded cause', n: 1 }, { label: 'several failure modes', n: 1 }]);
    expect(c.breakdown.reduce((s, b) => s + b.n, 0)).toBe(4);
    expect(c.evidence).toContain('4 of 7');
    expect(c.evidence).toContain('2 ');
  });
  it('Eng only: t1 t2 t3 t4 t5 t8 = 6 tasks, 4 returned = 66.7; Ops has one task, so not enough evidence', () => {
    expect(cell(run(reviewFixture(), 'Eng'), 'rework_rate')).toMatchObject({ value: 66.7, n: 6, open: { n: 2 } });
    expect(cell(run(reviewFixture(), 'Ops'), 'rework_rate')).toMatchObject({ value: null, n: 1, state: 'none', open: { n: 0 } });
  });
  it('previous window: t6 (accepted) p1 (returned) p2 (accepted) = 3 tasks, 1 returned = 33.3; so the trend is up', () => {
    expect(cell(run(reviewFixture()), 'rework_rate')).toMatchObject({ previous: { value: 33.3, n: 3 }, trend: 'up' });
  });
  it('a review exactly on the window edges counts (inclusive); one millisecond outside does not', () => {
    const w = windowOf('30d', NOW);
    const i = empty(); i.agents = AGENTS; i.missions = [{ id: 'M1', demo: false }];
    i.tasks = ['e1', 'e2', 'e3', 'e4', 'e5'].map((id) => task(id, 'a1'));
    i.reviews = [review('e1', 'rejected', w.from), review('e2', 'accepted', w.to), review('e3', 'accepted', new Date(w.from.getTime() + 1)), review('e4', 'rejected', new Date(w.from.getTime() - 1)), review('e5', 'accepted', ago(1 * D))];
    expect(cell(run(i), 'rework_rate')).toMatchObject({ n: 4, value: 25 }); // e1 e2 e3 e5; e4 is 1 ms early. 1 returned of 4
  });
  it('a demo mission, a simulated task or a mission the caller cannot see is never read', () => {
    const i = reviewFixture(); i.missions = [{ id: 'M1', demo: true }, { id: 'M2', demo: false }];
    expect(cell(run(i), 'rework_rate')).toMatchObject({ value: null, n: 0 });
    const j = reviewFixture(); j.missions = [{ id: 'M2', demo: false }];
    expect(cell(run(j), 'rework_rate')).toMatchObject({ value: null, n: 0, open: { n: 0 } });
  });
});

describe('first-pass acceptance (hand-computed)', () => {
  // Cohort = tasks with at least one review in the window: t1 t2 t3 t4 t5 t6 t7 t8 = 8 (t6 counts through its second review).
  // Accepted on attempt 1 = the FIRST review ever is accepted and not stale: t1, t6 (its first review is 40 days old), t7 = 3. t8's accepted review is stale (a later attempt): does not count.
  // 3/8 = 37.5%. t2 was accepted only on a later review, so it is not first-pass.
  it('whole company and Eng', () => {
    expect(cell(run(reviewFixture()), 'first_pass_acceptance')).toMatchObject({ value: 37.5, n: 8, open: { n: 2 } });
    // Eng: t1 t2 t3 t4 t5 t6 t8 = 7; first-pass t1 t6 = 2; 2/7 = 28.571 -> 28.6
    expect(cell(run(reviewFixture(), 'Eng'), 'first_pass_acceptance')).toMatchObject({ value: 28.6, n: 7 });
  });
  it('a stale first review never counts, even though it says accepted', () => {
    const i = reviewFixture(); i.reviews = i.reviews.map((r) => (r.taskId === 't1' ? { ...r, stale: true } : r));
    expect(cell(run(i), 'first_pass_acceptance')).toMatchObject({ value: 25, n: 8 }); // 2 of 8
  });
  it('F1: attempt 1 failed, a retry (attempt 2) passed and was accepted at the first review: NOT first-pass (accepted on attempt 1 only)', () => {
    const i = reviewFixture(); i.tasks.push(task('t13', 'a1'));
    i.reviews.push(review('t13', 'accepted', ago(3 * D), { attemptNo: 2 }));
    // cohort 9, first-pass still 3 (t1 t6 t7): t13 is in the denominator but not the numerator. 3/9 = 33.3
    expect(cell(run(i), 'first_pass_acceptance')).toMatchObject({ value: 33.3, n: 9 });
    // a review with no recorded attempt (null) cannot be shown to be attempt 1: not counted
    const j = reviewFixture(); j.tasks.push(task('t14', 'a1')); j.reviews.push(review('t14', 'accepted', ago(3 * D), { attemptNo: null }));
    expect(cell(run(j), 'first_pass_acceptance')).toMatchObject({ value: 33.3, n: 9 });
  });
  it('an unreviewed task is not in the denominator', () => {
    const i = reviewFixture(); i.tasks.push(task('t12', 'a1'), task('t13', 'a1'));
    expect(cell(run(i), 'first_pass_acceptance')).toMatchObject({ value: 37.5, n: 8, open: { n: 4 } });
  });
});

describe('duplicate delegation (hand-computed)', () => {
  // In-window, current (not superseded), real, with a goal: b1 b2 b3 b4 b7 = 5. b5 is 35 days old, b6 is superseded by b7, b8 is simulated, b9 has no goal.
  // Same mission and same normalised goal: b1 and b2 ("Fix the login bug" and "  fix   the LOGIN bug ") = 2 delegations in 1 repeated goal. b3 is the same text in ANOTHER mission: not a duplicate.
  // 2/5 = 40%.
  const brief = (id: string, missionId: string, toAgent: string, goal: string | null, at: Date, o: Partial<ProcInput['briefs'][number]> = {}): ProcInput['briefs'][number] => ({ id, missionId, toAgent, goal, at, supersedesId: null, simulated: false, ...o });
  function fx(): ProcInput {
    const i = empty(); i.agents = AGENTS; i.missions = [{ id: 'M1', demo: false }, { id: 'M2', demo: false }];
    i.briefs = [
      brief('b1', 'M1', 'a1', 'Fix the login bug', ago(5 * D)), brief('b2', 'M1', 'a2', '  fix   the LOGIN bug ', ago(4 * D)), brief('b3', 'M2', 'b1', 'Fix the login bug', ago(3 * D)),
      brief('b4', 'M1', 'a1', 'Write docs', ago(2 * D)), brief('b5', 'M1', 'a1', 'Write docs', ago(35 * D)),
      brief('b6', 'M1', 'a1', 'Review PR', ago(1 * D)), brief('b7', 'M1', 'a2', 'Review PR', ago(1 * D), { supersedesId: 'b6' }),
      brief('b8', 'M1', 'a1', 'Fix the login bug', ago(1 * D), { simulated: true }), brief('b9', 'M1', 'a1', null, ago(1 * D)),
    ];
    return i;
  }
  it('whole company: 2 of 5', () => {
    const c = cell(run(fx()), 'duplicate_delegation');
    expect(c).toMatchObject({ value: 40, n: 5, unit: '%', state: 'ok' });
    expect(c.evidence).toContain('2 of 5');
    expect(c.evidence).toContain('1 repeated goal');
  });
  it('Eng: b1 b2 b4 b7 = 4 delegations, 2 duplicates = 50; Ops has one, so not enough evidence', () => {
    expect(cell(run(fx(), 'Eng'), 'duplicate_delegation')).toMatchObject({ value: 50, n: 4 });
    expect(cell(run(fx(), 'Ops'), 'duplicate_delegation')).toMatchObject({ value: null, n: 1, state: 'none' });
  });
  it('three identical goals in one mission are 3 delegations in 1 repeated goal; a brief outside the window never pairs with one inside it', () => {
    const i = fx(); i.briefs.push({ id: 'b10', missionId: 'M1', toAgent: 'a1', goal: 'FIX THE LOGIN BUG', at: ago(1 * D), supersedesId: null, simulated: false });
    const c = cell(run(i), 'duplicate_delegation'); // 6 delegations, 3 in the group: 50
    expect(c).toMatchObject({ value: 50, n: 6 });
    expect(c.evidence).toContain('3 of 6');
    // b4 (2 days ago) and b5 (35 days ago) share a goal but b5 is outside the window: it is neither counted nor paired
    expect(cell(run(fx()), 'duplicate_delegation').n).toBe(5);
  });
});

describe('reassign churn (hand-computed; null below 20 tasks)', () => {
  // Owner changes after the first assignment, per task: consecutive history rows whose agent differs, ignoring rows with no agent.
  //   c1-c10: [a1, a1]  (an instance change with the same agent is not a reassign)  = 0 changes, ten tasks
  //   c11 [a1,a2] 1   c12 [a1,a2,a2] 1   c13 [a1,null,a2] 1   c14 [a1,a2] 1
  //   c15 c16 c17 [a1,a2,a1] 2 each         c18 [a1,a2,a1,a2] 3     c19 5 changes     c20 10 changes
  // Sorted: ten 0, four 1, three 2, one 3, one 5, one 10 (n = 20). Median = (0 + 1) / 2 = 0.5. p90 by nearest rank = the ceil(0.9 * 20) = 18th = 3.
  const chain = (id: string, agents: (string | null)[], start = ago(20 * D)): ProcInput['ownerHistory'] => agents.map((a, k) => ({ taskId: id, agentId: a, at: new Date(start.getTime() + k * H), seq: ++seq }));
  const alt = (n: number) => Array.from({ length: n + 1 }, (_, k) => (k % 2 ? 'a2' : 'a1'));
  function fx(): ProcInput {
    const i = empty(); i.agents = AGENTS; i.missions = [{ id: 'M1', demo: false }];
    const spec: [string, (string | null)[]][] = [];
    for (let k = 1; k <= 10; k++) spec.push([`c${k}`, ['a1', 'a1']]);
    spec.push(['c11', ['a1', 'a2']], ['c12', ['a1', 'a2', 'a2']], ['c13', ['a1', null, 'a2']], ['c14', ['a1', 'a2']]);
    for (const k of [15, 16, 17]) spec.push([`c${k}`, ['a1', 'a2', 'a1']]);
    spec.push(['c18', alt(3)], ['c19', alt(5)], ['c20', alt(10)]);
    for (const [id, agents] of spec) { i.tasks.push(task(id, 'a1', { status: 'running' })); i.ownerHistory.push(...chain(id, agents)); }
    return i;
  }
  it('20 tasks: median 0.5, p90 3', () => {
    const c = cell(run(fx()), 'reassign_churn');
    expect(CHURN_MIN_TASKS).toBe(20);
    expect(c).toMatchObject({ value: 0.5, p90: 3, n: 20, unit: 'count', state: 'ok' });
  });
  it('19 tasks: null, with the count shown; 20 tasks: a value', () => {
    const i = fx(); i.tasks = i.tasks.filter((t) => t.id !== 'c20'); i.ownerHistory = i.ownerHistory.filter((h) => h.taskId !== 'c20');
    expect(cell(run(i), 'reassign_churn')).toMatchObject({ value: null, p90: null, n: 19, state: 'none' });
    expect(cell(run(i), 'reassign_churn').evidence.startsWith('not enough evidence (n = 19)')).toBe(true);
  });
  it('a task first assigned before the window, a simulated task and a task of another department are not in the cohort', () => {
    const i = fx();
    i.tasks.push(task('old', 'a1', { status: 'running' }), task('sim', 'a1', { simulated: true, status: 'running' }), task('ops', 'b1', { status: 'running' }));
    i.ownerHistory.push(...chain('old', alt(4), ago(50 * D)), ...chain('sim', alt(4)), ...chain('ops', alt(4)));
    expect(cell(run(i), 'reassign_churn')).toMatchObject({ n: 21 }); // 20 + ops (whole company); old and sim are out
    expect(cell(run(i, 'Eng'), 'reassign_churn')).toMatchObject({ n: 20, value: 0.5, p90: 3 });
    expect(cell(run(i, 'Ops'), 'reassign_churn')).toMatchObject({ n: 1, value: null });
  });
});

describe('handoff wait (hand-computed; open hand-offs are reported, not averaged)', () => {
  // Delegations to a task in the window with their wait to the first attempt: Eng 2 h, 4 h, 6 h, 9 h; Ops 1 h. One Eng hand-off has no attempt yet (open). h6 is simulated, h7 is 40 days old.
  // Whole company (5 closed): sorted 1 2 4 6 9, median 4, p90 = the ceil(0.9 * 5) = 5th = 9.  Eng (4 closed): median (4 + 6) / 2 = 5, p90 = the 4th = 9.
  const hand = (missionId: string, toAgent: string, at: Date, waitHours: number | null, o: Partial<ProcInput['handoffs'][number]> = {}): ProcInput['handoffs'][number] =>
    ({ missionId, taskId: `T-${++seq}`, toAgent, at, waitSeconds: waitHours === null ? null : waitHours * 3600, simulated: false, ...o });
  function fx(): ProcInput {
    const i = empty(); i.agents = AGENTS; i.missions = [{ id: 'M1', demo: false }];
    i.handoffs = [hand('M1', 'a1', ago(10 * D), 2), hand('M1', 'a1', ago(9 * D), 4), hand('M1', 'a2', ago(8 * D), 6), hand('M1', 'a2', ago(7 * D), 9),
      hand('M1', 'a1', ago(1 * D), null), hand('M1', 'a1', ago(3 * D), 5, { simulated: true }), hand('M1', 'a1', ago(40 * D), 1), hand('M1', 'b1', ago(5 * D), 1)];
    return i;
  }
  it('whole company and Eng', () => {
    expect(cell(run(fx()), 'handoff_wait_h')).toMatchObject({ value: 4, p90: 9, n: 5, unit: 'h', state: 'ok', open: { n: 1 } });
    expect(cell(run(fx(), 'Eng'), 'handoff_wait_h')).toMatchObject({ value: 5, p90: 9, n: 4, open: { n: 1 } });
    expect(cell(run(fx(), 'Ops'), 'handoff_wait_h')).toMatchObject({ value: null, p90: null, n: 1, state: 'none', open: { n: 0 } });
  });
});
