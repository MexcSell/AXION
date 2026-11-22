import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeTestApp, withAdmin, Browser, type TestApp } from './helpers.ts';
import { PROCESS_KEYS } from '../../shared/contracts/src/index.ts';

/**
 * Improvement cycle 69, item 4 (route): GET /api/v1/company/process. Access, shape, visibility, exclusion of DEMO and simulated rows, and exact
 * values from real rows (the hand computation is in the comments). A GET only: this lane adds no write route.
 */
let t: TestApp;
let A: Browser, M: Browser;
let adminId = '';
const q = (sql: string, p: unknown[] = []) => t.pool.query(sql, p);
let seq = 0;
async function mission(id: string, owner: string, o: { shared?: boolean; demo?: boolean } = {}) {
  await q(`insert into missions(id, tenant_id, owner_id, shared, status, demo) values ($1,'t-1',$2,$3,'running',$4)`, [id, owner, o.shared ?? false, o.demo ?? false]);
  await q(`insert into mission_revisions(mission_id, revision, title, kind, priority, text, created_by) values ($1,1,$1,'data','normal','x',$2)`, [id, owner]);
}
async function instance(m: string, agent: string) {
  await q(`insert into agent_instances(id, tenant_id, mission_id, agent_id, agent_version_id, simulated) select $1,'t-1',$2,d.id,d.active_version_id,false from agent_definitions d where d.id=$3`, [`${m}:${agent}`, m, agent]);
}
async function task(id: string, m: string, agent: string, status: string, o: { simulated?: boolean } = {}) {
  await q(`insert into tasks(id, tenant_id, mission_id, title, status, owner_agent, owner_instance_id, simulated, created_at) values ($1,'t-1',$2,'T',$3,$4,$5,$6, now() - interval '40 days')`, [id, m, status, agent, `${m}:${agent}`, o.simulated ?? false]);
  await q(`insert into task_attempts(task_id, attempt_no, started_at, finished_at, result) values ($1,1, now() - interval '50 days', now() - interval '49 days', $2)`, [id, status]);
}
/** a review written `days` ago; the verdict decides whether it needs evidence (the database requires it for accepted) */
const review = (id: string, m: string, taskId: string, agent: string, verdict: string, days: number, rubric = '[{"criterion":"c","result":"pass"}]') => q(
  `insert into task_reviews(id, tenant_id, mission_id, task_id, attempt_id, reviewer_id, reviewer_kind, reviewer_model_family, producer_id, producer_kind, producer_model_family, principal_id, rubric, verdict, evidence, created_at)
   values ($1,'t-1',$2,$3,(select id from task_attempts where task_id=$3 order by attempt_no desc limit 1),'rev-x','agent','fam-b',$4,'agent','fam-a','owner-x',$5,$6,$7, now() - ($8 || ' days')::interval)`,
  [id, m, taskId, `${m}:${agent}`, rubric, verdict, verdict === 'accepted' ? '[{"kind":"note","id":"n"}]' : '[]', String(days)]);
const proc = async (b: Browser, qs = '') => { const r = await b.req('GET', '/company/process' + qs); expect(r.status, JSON.stringify(r.body)).toBe(200); return r.body; };
const cell = (body: any, key: string) => body.cells.find((c: any) => c.key === `process.${key}`);

beforeAll(async () => {
  t = await makeTestApp({ staffingStepMs: 3_600_000, conversationSimMs: 3_600_000, demoSeed: false });
  const w = await withAdmin(t.app);
  A = w.admin; adminId = w.adminId;
  const m = await w.member('Mina'); M = m.b;
});
afterAll(async () => { await t?.close(); });

describe('access and shape', () => {
  it('anonymous is 401; an unknown window, an unknown parameter and an unknown department are refused', async () => {
    expect((await new Browser(t.app).req('GET', '/company/process')).status).toBe(401);
    expect((await A.req('GET', '/company/process?window=1y')).status).toBe(400);
    expect((await A.req('GET', '/company/process?includeDemo=1')).status).toBe(400);
    expect((await A.req('GET', '/company/process?department=Nowhere')).status).toBe(404);
  });
  it('a fresh database: the seven cells in order, nothing invented, and no write route for it', async () => {
    const b = await proc(M);
    expect(b.window).toBe('30d');
    expect(new Date(b.to).getTime() - new Date(b.from).getTime()).toBe(30 * 86_400_000);
    expect(b.cells.map((c: any) => c.key)).toEqual(PROCESS_KEYS.map((k) => `process.${k}`));
    expect(b.departments).toContain('Engineering');
    for (const c of b.cells) {
      if (c.state === 'unmeasured') expect([c.value, c.n], c.key).toEqual([null, null]);
      else expect([c.value, c.state, c.evidence.startsWith(`not enough evidence (n = ${c.n})`)], c.key).toEqual([null, 'none', true]);
    }
    expect(Object.keys(b)).not.toContain('score');
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) expect((await A.req(m, '/company/process', {})).status, m).toBeGreaterThanOrEqual(400);
  });
  it('7d and 90d are accepted and the department filter is echoed', async () => {
    expect((await proc(M, '?window=7d')).window).toBe('7d');
    const b = await proc(M, '?window=90d&department=Engineering');
    expect([b.window, b.department]).toEqual(['90d', 'Engineering']);
  });
});

describe('exact values from real rows, DB time, visibility', () => {
  beforeAll(async () => {
    // Shared mission S (everyone sees it): coder-01 (Engineering) owns S1..S5.
    //   S1 accepted 10 d ago, S2 changes_requested 9 d ago (a criterion failed), S3 rejected 8 d ago, S4 accepted 7 d ago, S5 (status passed) has no review.
    //   Window 30d: first reviews in it = S1 S2 S3 S4 = 4, returned = S2 S3 = 2, so 50.0. Open = S5 = 1. First-pass: S1 S4 accepted first time = 2 of 4 = 50.0.
    await mission('S', adminId, { shared: true });
    await instance('S', 'coder-01');
    for (let i = 1; i <= 5; i++) await task(`S${i}`, 'S', 'coder-01', 'passed');
    await review('TR-S1', 'S', 'S1', 'coder-01', 'accepted', 10);
    await review('TR-S2', 'S', 'S2', 'coder-01', 'changes_requested', 9, '[{"criterion":"c","result":"fail"}]');
    await review('TR-S3', 'S', 'S3', 'coder-01', 'rejected', 8);
    await review('TR-S4', 'S', 'S4', 'coder-01', 'accepted', 7);
    // Hidden things: a private mission of the administrator (the member must not see it), a DEMO mission, and a simulated task on S
    await mission('P', adminId);
    await instance('P', 'coder-01');
    for (let i = 1; i <= 3; i++) { await task(`P${i}`, 'P', 'coder-01', 'passed'); await review(`TR-P${i}`, 'P', `P${i}`, 'coder-01', 'rejected', 5); }
    await mission('D', adminId, { shared: true, demo: true });
    await instance('D', 'coder-01');
    for (let i = 1; i <= 3; i++) { await task(`D${i}`, 'D', 'coder-01', 'passed'); await review(`TR-D${i}`, 'D', `D${i}`, 'coder-01', 'rejected', 5); }
    await task('SX', 'S', 'coder-01', 'passed', { simulated: true });
    await review('TR-SX', 'S', 'SX', 'coder-01', 'rejected', 5);
  });
  it('a member sees only the shared mission: 4 tasks, 2 returned = 50, open 1; the cause breakdown is a failed criterion and no recorded cause', async () => {
    const b = await proc(M);
    expect(cell(b, 'rework_rate')).toMatchObject({ value: 50, n: 4, state: 'ok', open: { n: 1 } });
    expect(cell(b, 'rework_rate').breakdown).toEqual([{ label: 'a criterion failed (no failure tag)', n: 1 }, { label: 'no recorded cause', n: 1 }]);
    expect(cell(b, 'first_pass_acceptance')).toMatchObject({ value: 50, n: 4, open: { n: 1 } });
  });
  it('the administrator sees the private mission too (3 more rejected tasks: 2 + 3 = 5 of 7 = 71.4); DEMO and simulated rows are never counted for anyone', async () => {
    const b = await proc(A);
    expect(cell(b, 'rework_rate')).toMatchObject({ value: 71.4, n: 7 });
  });
  it('the department filter follows the owning agent: Engineering has them, QA has none', async () => {
    expect(cell(await proc(A, '?department=Engineering'), 'rework_rate')).toMatchObject({ n: 7 });
    expect(cell(await proc(A, '?department=QA'), 'rework_rate')).toMatchObject({ value: null, n: 0 });
  });
  it('7 days is a different cohort: for the member, S4 was written 7 days before the read, so it is just outside, and nothing is inside: n = 0. The administrator also sees P (5 days old): 3 of 3 returned = 100', async () => {
    expect(cell(await proc(M, '?window=7d'), 'rework_rate')).toMatchObject({ value: null, state: 'none', n: 0 });
    expect(cell(await proc(A, '?window=7d'), 'rework_rate')).toMatchObject({ value: 100, n: 3 });
  });
});

describe('hand-off wait and duplicate delegation from real rows (DB time)', () => {
  beforeAll(async () => {
    // Mission H: four tasks delegated 3 days ago; the first attempt of each started 1, 2, 4 and 10 hours later; a fifth has no attempt yet.
    await mission('H', adminId, { shared: true });
    await instance('H', 'coder-01');
    await instance('H', 'tester-01').catch(() => undefined);
    const waits = [1, 2, 4, 10];
    for (let i = 0; i < 5; i++) {
      const id = `H${i}`;
      await q(`insert into tasks(id, tenant_id, mission_id, title, status, owner_agent, owner_instance_id, created_at) values ($1,'t-1','H','T','ready','coder-01','H:coder-01', now() - interval '4 days')`, [id]);
      await q(`insert into mission_delegations(mission_id, from_instance, to_instance, edge_kind, task_id, at) values ('H','H:coder-01','H:coder-01','delegated',$1, now() - interval '3 days')`, [id]);
      if (i < 4) await q(`insert into task_attempts(task_id, attempt_no, started_at) values ($1,1, now() - interval '3 days' + ($2 || ' hours')::interval)`, [id, String(waits[i])]);
    }
    // briefs: two with the same goal in H (one with different case and spacing), one different
    for (const g of ['Write the report', '  write   THE report ', 'Review it']) {
      await q(`insert into delegation_briefs(tenant_id, mission_id, from_id, from_kind, to_instance, to_agent, brief, sha256, depth, created_by) values ('t-1','H','u','user','H:coder-01','coder-01',$1::jsonb,$2,1,'u')`, [JSON.stringify({ goal: g }), `${++seq}`.padStart(64, '0')]);
    }
  });
  it('waits 1, 2, 4, 10 hours: median 3, p90 10 (nearest rank, the 4th of 4); the fifth delegation has no attempt and is open, not averaged', async () => {
    expect(cell(await proc(A), 'handoff_wait_h')).toMatchObject({ value: 3, p90: 10, n: 4, unit: 'h', open: { n: 1 } });
  });
  it('2 of 3 delegations share a normalised goal: 66.7', async () => {
    expect(cell(await proc(A), 'duplicate_delegation')).toMatchObject({ value: 66.7, n: 3 });
  });
});
