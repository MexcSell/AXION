import { describe, it, expect } from 'vitest';
import { computeDimensions, FAILURE_MODE_DIMENSION, CONTEXT_LOSS_MODES, type DimInput } from '../src/company/dimensions.ts';
import { DIMENSION_KEYS, FAILURE_MODE_IDS } from '../../shared/contracts/src/index.ts';
import { windowOf } from '../src/company/scorecard.ts';

// Improvement cycle 46: the six-dimension read model, pure. Every fixture is written by hand; nothing touches a database.
const NOW = new Date('2026-11-21T12:00:00Z');
const H = 3_600_000, D = 24 * H;
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const W = windowOf('30d', NOW);
const empty = (): DimInput => ({ admin: true, agents: [], missions: [], instances: [], tasks: [], reviews: [], ledgers: [], approvals: [], delegations: [], briefs: [], grants: [], tags: [], lessons: [], playbooks: [], promotions: [], rollbacks: [], verdicts: [], orgRevisions: [], orgChanges: [] });
const run = (i: DimInput, dept: string | null = null, w: '7d' | '30d' | '90d' = '30d') => { const x = windowOf(w, NOW); return computeDimensions(i, { window: w, from: x.from, to: x.to, department: dept }); };
const cell = (r: ReturnType<typeof run>, key: string) => r.dimensions.flatMap((d) => d.cells).find((c) => c.key === key)!;

const AGENTS = [
  { id: 'a1', dept: 'Eng', role: 'coder', active: true }, { id: 'a2', dept: 'Eng', role: 'coder', active: true }, { id: 'a3', dept: 'Eng', role: 'tester', active: true },
  { id: 'b1', dept: 'Ops', role: 'runner', active: true },
];
const task = (id: string, owner: string, o: Partial<DimInput['tasks'][number]> = {}): DimInput['tasks'][number] => ({
  id, owner, status: 'passed', missionStatus: 'running', simulated: false, attempts: [ago(5 * D)], handovers: [], finishedAt: ago(4 * D), ...o,
});
const review = (taskId: string, o: Partial<DimInput['reviews'][number]> = {}): DimInput['reviews'][number] => ({
  taskId, missionId: 'M1', reviewerId: 'rev', reviewerKind: 'user', reviewerFamily: null, producerId: 'M1:a1', producerKind: 'agent', producerFamily: 'fam-a', principalId: 'owner',
  verdict: 'accepted', evidenceCount: 1, at: ago(3 * D), seq: 1, simulated: false, stale: false, ...o,
});
/** a company with missions M1 (Eng) and M2 (Ops) and enough rows for most cells */
function rich(): DimInput {
  const i = empty();
  i.agents = AGENTS;
  i.missions = [{ id: 'M1', demo: false }, { id: 'M2', demo: false }];
  i.instances = [{ missionId: 'M1', agentId: 'a1', simulated: false, at: ago(60 * D) }, { missionId: 'M2', agentId: 'b1', simulated: false, at: ago(60 * D) }];
  for (let k = 0; k < 6; k++) i.tasks.push(task(`t${k}`, k < 4 ? 'a1' : 'b1'));
  for (let k = 0; k < 4; k++) i.reviews.push(review(`t${k}`, { seq: k + 1, at: ago((3 + k * 0.1) * D) }));
  return i;
}

describe('every cell is a value with n and window, or "not enough evidence (n = k)"', () => {
  const sizes: [string, DimInput][] = [['empty', empty()], ['small', (() => { const i = rich(); i.tasks = i.tasks.slice(0, 2); i.reviews = i.reviews.slice(0, 2); return i; })()], ['large', rich()]];
  for (const [name, input] of sizes) {
    it(`${name} fixture: the rule holds for every cell, in every window and for every department`, () => {
      for (const w of ['7d', '30d', '90d'] as const) for (const dept of [null, 'Eng', 'Ops']) {
        const r = run(input, dept, w);
        expect(r.dimensions.map((d) => d.key)).toEqual([...DIMENSION_KEYS]);
        for (const c of r.dimensions.flatMap((d) => d.cells)) {
          if (c.state === 'hidden' || c.state === 'unmeasured') {
            expect([c.value, c.n, c.trend], c.key).toEqual([null, null, null]);
            expect(c.evidence, c.key).toMatch(c.state === 'hidden' ? /^hidden for your role/ : /^not measured/);
          } else if (c.value === null) {
            expect(c.state, c.key).toBe('none');
            expect(Number.isInteger(c.n) && c.n! >= 0, c.key).toBe(true);
            expect(c.evidence.startsWith(`not enough evidence (n = ${c.n})`), `${c.key}: ${c.evidence}`).toBe(true);
          } else {
            expect(c.state, c.key).toBe('ok');
            expect(c.n!, c.key).toBeGreaterThanOrEqual(c.minN);
            expect(c.evidence.length, c.key).toBeGreaterThan(10);
            expect(c.from && c.to, `${c.key} shows its window`).toBeTruthy();
          }
        }
      }
    });
  }
  it('the empty company has no value anywhere (unknown stays unknown) and no trend', () => {
    const cells = run(empty()).dimensions.flatMap((d) => d.cells);
    expect(cells.length).toBeGreaterThanOrEqual(15);
    expect(cells.every((c) => c.value === null && c.trend === null && (c.n === 0 || c.n === null))).toBe(true);
  });
  it('the large fixture produces at least one value', () => {
    expect(run(rich()).dimensions.flatMap((d) => d.cells).some((c) => c.value !== null)).toBe(true);
  });
  it('the not-measured cells are state "unmeasured" with n = null and the reason first, with no window', () => {
    const r = run(rich());
    for (const k of ['environmental.site_navigation', 'environmental.model_availability']) {
      const c = cell(r, k);
      expect([c.value, c.n, c.state, c.basis, c.from, c.to, c.trend]).toEqual([null, null, 'unmeasured', 'none', null, null, null]);
      expect(c.evidence).toMatch(/^not measured/);
    }
    expect(cell(r, 'environmental.site_navigation').evidence).toBe('not measured until Stage 7 (browser execution)');
    expect(cell(r, 'environmental.model_availability').evidence).toBe('not measured until Stage 7 (browser execution)');
  });
  it('Environmental holds only its two unmeasured cells; the context-loss cell lives under Cognitive (F1)', () => {
    const r = run(rich());
    expect(r.dimensions.find((d) => d.key === 'environmental')!.cells.map((c) => c.key)).toEqual(['environmental.site_navigation', 'environmental.model_availability']);
    expect(r.dimensions.find((d) => d.key === 'cognitive')!.cells.map((c) => c.key)).toContain('cognitive.context_loss');
    expect(cell(r, 'cognitive.context_loss').label).toBe('Context-loss failures (FM-1.4, FM-2.1)');
  });
});

describe('no aggregate across indicators (schema level)', () => {
  const FORBIDDEN = /^(score|total|overall|composite|index|rating|grade|average|mean|sum|rank|health|intelligence)$/i;
  const walk = (x: unknown, path: string, out: string[]) => {
    if (Array.isArray(x)) x.forEach((v, i) => walk(v, `${path}[${i}]`, out));
    else if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) { out.push(`${path}.${k}`); walk(v, `${path}.${k}`, out); }
  };
  it('the response has exactly the documented top-level, dimension and cell fields', () => {
    const r = run(rich());
    expect(Object.keys(r).sort()).toEqual(['department', 'departments', 'dimensions', 'from', 'previousFrom', 'previousTo', 'to', 'window']);
    for (const d of r.dimensions) {
      expect(Object.keys(d).sort()).toEqual(['cells', 'key', 'label']);
      for (const c of d.cells) expect(Object.keys(c).sort()).toEqual(['basis', 'evidence', 'from', 'key', 'label', 'minN', 'n', 'previous', 'scope', 'state', 'to', 'trend', 'unit', 'value']);
    }
  });
  it('no field anywhere is named like a score, total, mean or overall number', () => {
    const paths: string[] = [];
    walk(run(rich()), '', paths);
    expect(paths.filter((p) => FORBIDDEN.test(p.split('.').pop()!.replace(/\[\d+\]$/, '')))).toEqual([]);
  });
  it('a dimension has no value of its own: every dimension holds several independent cells', () => {
    for (const d of run(rich()).dimensions) { expect(d.cells.length).toBeGreaterThanOrEqual(1); expect('value' in d).toBe(false); }
  });
  it('changing one cell never changes another (cells share no hidden total)', () => {
    const a = run(rich());
    const j = rich(); j.promotions = [1, 2, 3].map(() => ({ agentId: 'a1', at: ago(D) }));
    const b = run(j);
    const diff = a.dimensions.flatMap((d) => d.cells).filter((c) => JSON.stringify(c) !== JSON.stringify(cell(b, c.key))).map((c) => c.key);
    expect(diff).toEqual(['evolutionary.promotions']);
  });
});

describe('simulated and DEMO rows change no value', () => {
  /** the same rich fixture plus a heap of simulated / DEMO rows of every kind */
  function polluted(): DimInput {
    const i = rich();
    i.missions.push({ id: 'DEMO1', demo: true });
    i.instances.push({ missionId: 'M1', agentId: 'a2', simulated: true, at: ago(60 * D) }, { missionId: 'DEMO1', agentId: 'a1', simulated: false, at: ago(60 * D) });
    for (let k = 0; k < 6; k++) {
      i.tasks.push(task(`s${k}`, 'a1', { simulated: true, status: k % 2 ? 'failed' : 'passed' }));
      i.reviews.push(review(`s${k}`, { simulated: true, seq: 50 + k }), review(`t${k % 4}`, { missionId: 'DEMO1', seq: 60 + k, at: ago(D) }));
      i.ledgers.push({ missionId: 'DEMO1', version: k + 1, body: { satisfied: false, looping: true, progressing: false }, at: ago(D), demo: true });
      i.approvals.push({ missionId: 'M1', createdAt: ago(3 * D), decidedAt: ago(2 * D), demo: true });
      i.delegations.push({ missionId: 'M1', toInstance: 'M1:a1', toAgent: 'a1', at: ago(D), simulated: true });
      i.briefs.push({ missionId: 'M1', toInstance: 'M1:a1', simulated: true, at: ago(10 * D) });
      i.tags.push({ taskId: `s${k}`, modeId: 'FM-1.4', at: ago(D) });
    }
    return i;
  }
  it('company level: byte-for-byte equal to the fixture without them', () => { expect(run(polluted())).toEqual(run(rich())); });
  it('department level: byte-for-byte equal as well', () => { for (const d of ['Eng', 'Ops']) expect(run(polluted(), d)).toEqual(run(rich(), d)); });
  it('the simulated rows would have changed values (the check is not vacuous)', () => {
    const p = polluted();
    p.missions = p.missions.map((m) => ({ ...m, demo: false }));
    p.tasks = p.tasks.map((t) => ({ ...t, simulated: false }));
    p.reviews = p.reviews.map((r) => ({ ...r, simulated: false }));
    p.ledgers = p.ledgers.map((l) => ({ ...l, demo: false }));
    p.approvals = p.approvals.map((a) => ({ ...a, demo: false }));
    p.delegations = p.delegations.map((d) => ({ ...d, simulated: false }));
    p.briefs = p.briefs.map((b) => ({ ...b, simulated: false }));
    expect(run(p)).not.toEqual(run(rich()));
  });
});

describe('evaluation verdict outcomes (c54 M1b)', () => {
  const v = (outcome: 'verified_better' | 'inconclusive' | 'worse', daysAgo: number, agentId = 'a1') => ({ agentId, outcome, at: ago(daysAgo * D) });
  it('counts evaluated proposals in the window by outcome; the value is the count of evaluated proposals, never a score', () => {
    const i = empty(); i.agents = AGENTS;
    i.verdicts = [v('verified_better', 2), v('inconclusive', 3), v('worse', 4), v('verified_better', 90)];
    const c = cell(run(i), 'evolutionary.verdict_outcomes');
    expect(c).toMatchObject({ value: 3, n: 3, state: 'ok', basis: 'window' });
    expect(c.evidence).toContain('1 verified better, 1 inconclusive, 1 worse');
  });
  it('fewer than MIN_N evaluated proposals: not enough evidence, value null with n', () => {
    const i = empty(); i.agents = AGENTS;
    i.verdicts = [v('verified_better', 2), v('worse', 3)];
    const c = cell(run(i), 'evolutionary.verdict_outcomes');
    expect([c.value, c.n, c.state]).toEqual([null, 2, 'none']);
    expect(c.evidence.startsWith('not enough evidence (n = 2)')).toBe(true);
  });
  it('a department sees only its own agents verdicts', () => {
    const i = empty(); i.agents = AGENTS;
    i.verdicts = [v('worse', 1), v('worse', 1), v('worse', 1), v('worse', 1, 'b1')];
    expect(cell(run(i, 'Eng'), 'evolutionary.verdict_outcomes').n).toBe(3);
    expect(cell(run(i, 'Ops'), 'evolutionary.verdict_outcomes').n).toBe(1);
  });
});

describe('review freshness (c54 M1c)', () => {
  it('a stale review is in the sample but never verifies', () => {
    const i = empty(); i.agents = AGENTS; i.missions = [{ id: 'M1', demo: false }];
    for (let k = 0; k < 4; k++) { i.tasks.push(task(`f${k}`, 'a1')); i.reviews.push(review(`f${k}`, { seq: k + 1, stale: k === 3 })); }
    expect(cell(run(i), 'cognitive.first_attempt_verified')).toMatchObject({ n: 4, value: 75 });
  });
});

describe('trend', () => {
  it('is null when the previous window is empty', () => {
    const i = rich();
    const c = cell(run(i), 'cognitive.first_attempt_verified');
    expect(c.value).not.toBeNull();
    expect(c.previous).toEqual({ value: null, n: 0 });
    expect(c.trend).toBeNull();
  });
  it('is null when the current window is empty', () => {
    const i = empty(); i.agents = AGENTS; i.missions = [{ id: 'M1', demo: false }];
    for (let k = 0; k < 4; k++) { i.tasks.push(task(`p${k}`, 'a1', { attempts: [ago(40 * D)], finishedAt: ago(40 * D) })); i.reviews.push(review(`p${k}`, { seq: k + 1, at: ago(40 * D) })); }
    const c = cell(run(i), 'cognitive.first_attempt_verified');
    expect(c.value).toBeNull();
    expect(c.previous.n).toBe(4);
    expect(c.trend).toBeNull();
  });
  it('is up / down / flat once both windows have a value', () => {
    const mk = (curOk: number, prevOk: number) => {
      const i = empty(); i.agents = AGENTS; i.missions = [{ id: 'M1', demo: false }];
      const add = (pre: string, ok: number, total: number, when: number) => { for (let k = 0; k < total; k++) { i.tasks.push(task(`${pre}${k}`, 'a1', { status: k < ok ? 'passed' : 'failed', attempts: [ago(when)], finishedAt: ago(when) })); i.reviews.push(review(`${pre}${k}`, { seq: k + 1, at: ago(when) })); } };
      add('c', curOk, 4, 3 * D); add('p', prevOk, 4, 40 * D);
      return cell(run(i), 'cognitive.first_attempt_verified');
    };
    expect(mk(4, 2).trend).toBe('up');
    expect(mk(2, 4).trend).toBe('down');
    expect(mk(3, 3).trend).toBe('flat');
    expect(mk(3, 3).previous).toEqual({ value: 75, n: 4 });
  });
  it('the previous window ends 1 ms before the current one starts', () => {
    const r = run(rich());
    expect(new Date(r.previousTo).getTime()).toBe(new Date(r.from).getTime() - 1);
    expect(new Date(r.to).getTime() - new Date(r.from).getTime()).toBe(new Date(r.previousTo).getTime() - new Date(r.previousFrom).getTime());
  });
});

describe('cells', () => {
  it('first-attempt review: a task with two attempts, a failed task and a self-review are not counted as verified', () => {
    const i = rich();
    i.tasks.push(task('two', 'a1', { attempts: [ago(5 * D), ago(4 * D)] }), task('bad', 'a1', { status: 'failed' }));
    i.reviews.push(review('two', { seq: 20 }), review('bad', { seq: 21 }));
    const c = cell(run(i), 'cognitive.first_attempt_verified');
    expect(c.n).toBe(5); // the two-attempt task is outside the first-attempt sample
    expect(c.value).toBe(80); // 4 passed + accepted, 'bad' is failed
  });
  it('first-attempt review: the latest review of a task counts', () => {
    const i = rich();
    i.reviews.push(review('t0', { verdict: 'rejected', seq: 99, at: ago(2 * D) }));
    expect(cell(run(i), 'cognitive.first_attempt_verified').value).toBe(75);
  });
  it('stalled missions: three entries without progress flag a stall; a satisfied entry resets', () => {
    const i = empty(); i.missions = ['A', 'B', 'C'].map((id) => ({ id, demo: false }));
    const L = (m: string, v: number, body: Partial<{ satisfied: boolean; looping: boolean; progressing: boolean }>) => i.ledgers.push({ missionId: m, version: v, body: { satisfied: false, looping: false, progressing: true, ...body }, at: ago((10 - v) * H), demo: false });
    for (let v = 1; v <= 3; v++) L('A', v, { progressing: false });
    L('B', 1, { progressing: false }); L('B', 2, { progressing: false }); L('B', 3, { satisfied: true });
    L('C', 1, {});
    const c = cell(run(i), 'cognitive.stalled_missions');
    expect([c.n, c.value]).toEqual([3, 33.3]);
  });
  it('stalled missions: an entry outside the window leaves the mission out', () => {
    const i = empty(); i.missions = ['A', 'B', 'C'].map((id) => ({ id, demo: false }));
    for (const m of ['A', 'B', 'C']) i.ledgers.push({ missionId: m, version: 1, body: { satisfied: false, looping: true, progressing: false }, at: ago(100 * D), demo: false });
    expect(cell(run(i), 'cognitive.stalled_missions').n).toBe(0);
  });
  it('passed first time needs 5 outcomes (the reliability floor), not 3', () => {
    const i = empty(); i.agents = AGENTS;
    for (let k = 0; k < 4; k++) i.tasks.push(task(`x${k}`, 'a1'));
    expect(cell(run(i), 'capability.first_pass')).toMatchObject({ value: null, n: 4, minN: 5 });
    i.tasks.push(task('x4', 'a1', { attempts: [ago(5 * D), ago(4 * D)] }));
    expect(cell(run(i), 'capability.first_pass')).toMatchObject({ value: 80, n: 5 });
  });
  it('playbook items: latest version per agent as of the end date, per role in the evidence', () => {
    const i = empty(); i.agents = AGENTS;
    i.playbooks = [{ agentId: 'a1', version: 1, items: 1, at: ago(50 * D) }, { agentId: 'a1', version: 2, items: 3, at: ago(2 * D) }, { agentId: 'a3', version: 1, items: 2, at: ago(2 * D) }];
    const c = cell(run(i, 'Eng'), 'capability.playbook_items');
    expect([c.value, c.n, c.basis]).toEqual([5, 3, 'snapshot']);
    expect(c.evidence).toContain('coder 3');
    expect(c.evidence).toContain('tester 2');
    expect(cell(run(i, 'Ops'), 'capability.playbook_items').n).toBe(1);
    expect(cell(run(i, 'Eng'), 'capability.playbook_items').previous).toEqual({ value: 1, n: 3 }); // as of the previous end date: a1 had 1 item
  });
  it('site grants: a grant issued before the window but active during it is counted (F4)', () => {
    const i = empty(); i.missions = [{ id: 'M1', demo: false }];
    i.grants = [
      { missionId: 'M1', issuedAt: ago(60 * D), expiresAt: ago(-5 * D), revokedAt: null },   // issued before, still active
      { missionId: 'M1', issuedAt: ago(60 * D), expiresAt: ago(40 * D), revokedAt: null },  // expired before the window: not active in it
      { missionId: 'M1', issuedAt: ago(60 * D), expiresAt: ago(-5 * D), revokedAt: ago(45 * D) }, // revoked before the window
      { missionId: 'M1', issuedAt: ago(20 * D), expiresAt: ago(10 * D), revokedAt: null },  // active, then expired inside the window
      { missionId: 'M1', issuedAt: ago(20 * D), expiresAt: ago(-5 * D), revokedAt: ago(5 * D) }, // revoked inside the window
    ];
    const c = cell(run(i), 'capability.site_grants');
    expect([c.n, c.value]).toEqual([3, 1]);
    expect(c.label).toBe('Site grants active at the end');
    expect(c.evidence).toContain('active at some point in the window');
  });
  it('site grants: active, expired and revoked are counts; members see none', () => {
    const i = empty(); i.missions = [{ id: 'M1', demo: false }];
    i.grants = [
      { missionId: 'M1', issuedAt: ago(5 * D), expiresAt: ago(-D), revokedAt: null },
      { missionId: 'M1', issuedAt: ago(5 * D), expiresAt: ago(2 * D), revokedAt: null },
      { missionId: 'M1', issuedAt: ago(5 * D), expiresAt: ago(-D), revokedAt: ago(D) },
    ];
    const c = cell(run(i), 'capability.site_grants');
    expect([c.value, c.n]).toEqual([1, 3]);
    expect(c.evidence).toContain('1 active at the end, 1 expired and 1 revoked');
    expect(cell(run({ ...i, admin: false }), 'capability.site_grants')).toMatchObject({ value: null, n: null, state: 'hidden', scope: 'missions' });
  });
  it('context-loss tags: only failed or retried tasks that carry a confirmed tag are the sample', () => {
    const i = empty(); i.agents = AGENTS;
    for (let k = 0; k < 4; k++) i.tasks.push(task(`f${k}`, 'a1', { status: 'failed' }));
    i.tasks.push(task('untagged', 'a1', { status: 'failed' }), task('fine', 'a1'));
    i.tags = [{ taskId: 'f0', modeId: 'FM-1.4', at: ago(D) }, { taskId: 'f1', modeId: 'FM-3.2', at: ago(D) }, { taskId: 'f2', modeId: 'FM-2.1', at: ago(D) }, { taskId: 'f3', modeId: 'FM-1.1', at: ago(D) }, { taskId: 'fine', modeId: 'FM-1.4', at: ago(D) }];
    const c = cell(run(i), 'cognitive.context_loss');
    expect([c.n, c.value]).toEqual([4, 50]);
    expect(c.evidence).toContain('untagged failures are not counted');
    expect(c.evidence).toContain('context-loss');
  });
  it('context-loss tags: failures without any tag give null, never 0 %', () => {
    const i = empty(); i.agents = AGENTS;
    for (let k = 0; k < 6; k++) i.tasks.push(task(`f${k}`, 'a1', { status: 'failed' }));
    expect(cell(run(i), 'cognitive.context_loss')).toMatchObject({ value: null, n: 0 });
  });
  it('the failure-mode map covers all 14 modes exactly once; no MAST mode is environmental; the context-loss pair is reviewed', () => {
    expect(Object.keys(FAILURE_MODE_DIMENSION).sort()).toEqual([...FAILURE_MODE_IDS].sort());
    expect(Object.values(FAILURE_MODE_DIMENSION).every((d) => (DIMENSION_KEYS as readonly string[]).includes(d))).toBe(true);
    expect(Object.values(FAILURE_MODE_DIMENSION)).not.toContain('environmental');
    expect([...CONTEXT_LOSS_MODES]).toEqual(['FM-1.4', 'FM-2.1']);
  });
  it('briefed delegations: a delegation counts as briefed when its agent holds a real brief on that mission', () => {
    const i = empty(); i.agents = AGENTS; i.missions = [{ id: 'M1', demo: false }];
    for (let k = 0; k < 4; k++) i.delegations.push({ missionId: 'M1', toInstance: `M1:a${k % 2 + 1}`, toAgent: `a${k % 2 + 1}`, at: ago(D), simulated: false });
    i.briefs.push({ missionId: 'M1', toInstance: 'M1:a1', simulated: false, at: ago(10 * D) }, { missionId: 'M1', toInstance: 'M1:a2', simulated: true, at: ago(10 * D) });
    const c = cell(run(i), 'collective.briefed_delegations');
    expect([c.n, c.value]).toEqual([4, 50]);
  });
  it('cross-family reviews: agent-on-agent share, with the people-written count in the evidence', () => {
    const i = rich();
    i.reviews = [
      review('t0', { reviewerKind: 'agent', reviewerFamily: 'fam-b', seq: 1 }), review('t1', { seq: 2 }), review('t2', { seq: 3 }), review('t3', { reviewerKind: 'agent', reviewerFamily: 'fam-c', seq: 4 }),
    ];
    const c = cell(run(i), 'collective.cross_family_reviews');
    expect([c.n, c.value]).toEqual([4, 50]);
    expect(c.evidence).toContain('2 were written by a person');
  });
  it('approval decision time is a median in hours over decided approvals', () => {
    const i = empty(); i.missions = [{ id: 'M1', demo: false }];
    for (const h of [1, 2, 10]) i.approvals.push({ missionId: 'M1', createdAt: ago(3 * D), decidedAt: new Date(ago(3 * D).getTime() + h * H), demo: false });
    i.approvals.push({ missionId: 'M1', createdAt: ago(3 * D), decidedAt: null, demo: false });
    const c = cell(run(i), 'collective.approval_decision_h');
    expect([c.value, c.n, c.unit]).toEqual([2, 3, 'h']);
  });
  const lesson = (o: Partial<DimInput['lessons'][number]> = {}): DimInput['lessons'][number] => ({ agentId: 'a1', status: 'accepted', createdAt: ago(5 * D), decidedAt: ago(4 * D), acceptedInVersion: 1, withdrawnInVersion: null, ...o });
  it('knowledge: proposed, accepted share and rollback rate, from rows as recorded', () => {
    const i = empty(); i.agents = AGENTS;
    i.lessons = [lesson(), lesson(), lesson({ withdrawnInVersion: 2, status: 'superseded' }), lesson({ status: 'rejected', acceptedInVersion: null }), lesson({ status: 'proposed', decidedAt: null, acceptedInVersion: null }),
      lesson({ status: 'superseded', acceptedInVersion: null })]; // a duplicate closed by the system is no decision
    const r = run(i);
    expect(cell(r, 'knowledge.lessons_proposed')).toMatchObject({ value: 6, n: 6 });
    expect(cell(r, 'knowledge.lessons_accepted')).toMatchObject({ value: 75, n: 4 });
    expect(cell(r, 'knowledge.lessons_rolled_back')).toMatchObject({ value: 33.3, n: 3 });
  });
  it('knowledge: members get state "hidden" with n = null, never a count or "n = 0"', () => {
    const i = empty(); i.agents = AGENTS; i.admin = false;
    i.lessons = [lesson(), lesson(), lesson(), lesson()];
    for (const k of ['lessons_proposed', 'lessons_accepted', 'lessons_rolled_back']) expect(cell(run(i), `knowledge.${k}`)).toMatchObject({ value: null, n: null, state: 'hidden' });
    expect(cell(run(i), 'knowledge.lessons_proposed').evidence).toMatch(/^hidden for your role: lessons under review are visible to administrators only/);
  });
  it('evolutionary: promotions and rollbacks are counts; org revisions leave out the starting chart', () => {
    const i = empty(); i.agents = AGENTS;
    i.promotions = [1, 2, 3].map(() => ({ agentId: 'a1', at: ago(2 * D) }));
    i.rollbacks = [1, 2, 3, 4].map(() => ({ agentId: 'b1', at: ago(2 * D) }));
    i.orgRevisions = [{ seq: 1, at: ago(80 * D) }, { seq: 2, at: ago(3 * D) }, { seq: 3, at: ago(2 * D) }, { seq: 4, at: ago(D) }];
    i.orgChanges = [{ seq: 2, at: ago(3 * D), subordinateId: 'a1' }, { seq: 3, at: ago(2 * D), subordinateId: 'a2' }, { seq: 4, at: ago(D), subordinateId: 'b1' }, { seq: 4, at: ago(D), subordinateId: 'a3' }];
    const r = run(i), eng = run(i, 'Eng');
    expect(cell(r, 'evolutionary.promotions').value).toBe(3);
    expect(cell(r, 'evolutionary.rollbacks').value).toBe(4);
    expect(cell(r, 'evolutionary.org_revisions')).toMatchObject({ value: 3, n: 3 });
    expect(cell(eng, 'evolutionary.promotions').value).toBe(3);
    expect(cell(eng, 'evolutionary.rollbacks')).toMatchObject({ value: null, n: 0, state: 'none' });
    expect(cell(eng, 'evolutionary.org_revisions')).toMatchObject({ value: 3, n: 3 }); // rev 2, 3 and 4 each touched an Eng member
  });
});

describe('departments', () => {
  it('lists the departments of active agents, sorted, and a department filter only keeps its own rows', () => {
    const r = run(rich(), 'Eng');
    expect(r.departments).toEqual(['Eng', 'Ops']);
    expect(r.department).toBe('Eng');
    expect(cell(r, 'cognitive.first_attempt_verified')).toMatchObject({ n: 4, value: 100 });
    expect(cell(run(rich(), 'Ops'), 'cognitive.first_attempt_verified').n).toBe(0);
    expect(cell(run(rich()), 'cognitive.first_attempt_verified').n).toBe(4);
  });
  it('mission-scoped rows count for a department only through a real instance of one of its agents', () => {
    const i = rich();
    for (let v = 1; v <= 3; v++) i.ledgers.push({ missionId: 'M2', version: v, body: { satisfied: false, looping: false, progressing: false }, at: ago(D), demo: false });
    for (const m of ['M3', 'M4']) { i.missions.push({ id: m, demo: false }); i.ledgers.push({ missionId: m, version: 1, body: { satisfied: false, looping: false, progressing: true }, at: ago(D), demo: false }); }
    expect(cell(run(i, 'Ops'), 'cognitive.stalled_missions').n).toBe(1);
    expect(cell(run(i, 'Eng'), 'cognitive.stalled_missions').n).toBe(0);
    expect(cell(run(i), 'cognitive.stalled_missions')).toMatchObject({ n: 3, value: 33.3 });
  });
  it('a mission outside the visible list contributes nothing', () => {
    const i = empty(); i.missions = [{ id: 'M1', demo: false }];
    for (let v = 1; v <= 3; v++) i.ledgers.push({ missionId: 'HIDDEN', version: v, body: { satisfied: false, looping: true, progressing: false }, at: ago(D), demo: false });
    expect(cell(run(i), 'cognitive.stalled_missions').n).toBe(0);
  });
});

describe('one time base: a past window uses what was recorded by then (F3)', () => {
  it('a brief attached after the previous window does not make a previous delegation briefed', () => {
    const i = empty(); i.agents = AGENTS; i.missions = [{ id: 'M1', demo: false }];
    for (let k = 0; k < 4; k++) i.delegations.push({ missionId: 'M1', toInstance: 'M1:a1', toAgent: 'a1', at: ago(40 * D), simulated: false });
    i.briefs.push({ missionId: 'M1', toInstance: 'M1:a1', simulated: false, at: ago(2 * D) });
    const c = cell(run(i), 'collective.briefed_delegations');
    expect(c.previous).toEqual({ value: 0, n: 4 }); // no brief existed yet at the end of the previous window
  });
  it('a task retried after its review still counts as a first-attempt task in the window of that review', () => {
    const i = empty(); i.agents = AGENTS; i.missions = [{ id: 'M1', demo: false }];
    for (let k = 0; k < 4; k++) { i.tasks.push(task(`r${k}`, 'a1', { attempts: [ago(42 * D), ago(5 * D)] })); i.reviews.push(review(`r${k}`, { seq: k + 1, at: ago(40 * D) })); }
    const c = cell(run(i), 'cognitive.first_attempt_verified');
    expect(c.previous).toEqual({ value: 100, n: 4 });
  });
  it('a rollback that happened after the previous window does not lower the previous rollback rate', () => {
    const i = empty(); i.agents = AGENTS;
    i.lessons = [1, 2, 3].map(() => ({ agentId: 'a1', status: 'superseded', createdAt: ago(50 * D), decidedAt: ago(40 * D), acceptedInVersion: 1, withdrawnInVersion: 2 }));
    i.playbooks = [{ agentId: 'a1', version: 1, items: 3, at: ago(40 * D) }, { agentId: 'a1', version: 2, items: 0, at: ago(5 * D) }];
    expect(cell(run(i), 'knowledge.lessons_rolled_back').previous).toEqual({ value: 0, n: 3 });
  });
  it('an agent instance that joined a mission after the window does not place the mission in its department', () => {
    const i = empty(); i.agents = AGENTS; i.missions = ['A', 'B', 'C'].map((id) => ({ id, demo: false }));
    for (const m of ['A', 'B', 'C']) { i.instances.push({ missionId: m, agentId: 'a1', simulated: false, at: ago(2 * D) }); for (let v = 1; v <= 3; v++) i.ledgers.push({ missionId: m, version: v, body: { satisfied: false, looping: false, progressing: false }, at: ago(40 * D), demo: false }); }
    expect(cell(run(i, 'Eng'), 'cognitive.stalled_missions').previous.n).toBe(0);
  });
});

describe('wording and scope (F5, F6)', () => {
  it('each cell names its scope: mission-based cells say missions you can see, tenant-wide cells say company', () => {
    const r = run(rich());
    for (const k of ['cognitive.first_attempt_verified', 'capability.site_grants', 'collective.approval_decision_h']) expect(cell(r, k).scope, k).toBe('missions');
    for (const k of ['capability.playbook_items', 'knowledge.lessons_proposed', 'evolutionary.promotions', 'evolutionary.rollbacks', 'evolutionary.org_revisions']) expect(cell(r, k).scope, k).toBe('company');
  });
  it('approval time says how many requests had no decision by the end and are not in the median', () => {
    const i = empty(); i.missions = [{ id: 'M1', demo: false }];
    for (const h of [1, 2, 10]) i.approvals.push({ missionId: 'M1', createdAt: ago(3 * D), decidedAt: new Date(ago(3 * D).getTime() + h * H), demo: false });
    i.approvals.push({ missionId: 'M1', createdAt: ago(3 * D), decidedAt: null, demo: false }, { missionId: 'M1', createdAt: ago(2 * D), decidedAt: null, demo: false });
    const c = cell(run(i), 'collective.approval_decision_h');
    expect(c.evidence).toContain('2 approvals requested in the window had no decision by the end and are not in the median');
    const small = empty(); small.missions = i.missions; small.approvals = [i.approvals[3]];
    expect(cell(run(small), 'collective.approval_decision_h').evidence).toContain('1 approval requested in the window had no decision');
  });
});
