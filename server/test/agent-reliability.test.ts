import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeTestApp, withAdmin, Browser, type TestApp } from './helpers.ts';

// Improvement cycle 3: `reliability` on GET /agents and GET /agents/:id — scoping (visibility, tenant, deleted, DEMO), the
// finish-time rule and list/detail equality. passed/failed are system-only task states (nothing executes yet), so the
// fixture histories are written with direct SQL; reassignments go through the real API (POST /tasks/:id/reassign).
let t: TestApp;
let A: Browser; // administrator Luca
let M: Browser; // member Mina (owns the private mission P)
let K: Browser; // member Kenji (owns the shared mission S)
let adminId = '', minaId = '', kenjiId = '';
let n = 0;
const key = () => ({ 'idempotency-key': 'rel-' + n++ });
const q = (sql: string, p: unknown[] = []) => t.pool.query(sql, p);

async function mission(id: string, owner: string, o: { shared?: boolean; demo?: boolean; tenant?: string } = {}) {
  await q(`insert into missions(id, tenant_id, owner_id, shared, status, demo) values ($1,$2,$3,$4,'running',$5)`, [id, o.tenant ?? 't-1', owner, o.shared ?? false, o.demo ?? false]);
  await q(`insert into mission_revisions(mission_id, revision, title, kind, priority, text, created_by) values ($1,1,$1,'data','normal','x',$2)`, [id, owner]);
}
/** An instance of a (t-1) agent in a mission; the GM instance is the lead, the others report to it. */
async function instance(missionId: string, agentId: string, tenant = 't-1') {
  await q(`insert into agent_instances(id, tenant_id, mission_id, agent_id, agent_version_id, manager_instance_id, simulated)
           select $1, $2, $3, d.id, d.active_version_id, $4, (select demo from missions where id=$3) from agent_definitions d where d.id=$5`,
  [`${missionId}:${agentId}`, tenant, missionId, agentId === 'gm' ? null : `${missionId}:gm`, agentId]);
}
/** A task owned by an instance, with `attempts` finished attempts (the last one `hoursAgo`). */
async function task(id: string, missionId: string, agentId: string, status: string, o: { attempts?: number; hoursAgo?: number; simulated?: boolean; tenant?: string; createdDaysAgo?: number } = {}) {
  await q(`insert into tasks(id, tenant_id, mission_id, title, status, owner_agent, owner_instance_id, simulated, created_at)
           values ($1,$2,$3,'A task',$4,$5,$6,$7, now() - $8 * interval '1 day')`,
  [id, o.tenant ?? 't-1', missionId, status, agentId, `${missionId}:${agentId}`, o.simulated ?? false, o.createdDaysAgo ?? 0]);
  for (let i = 1; i <= (o.attempts ?? 1); i++) {
    await q(`insert into task_attempts(task_id, attempt_no, started_at, finished_at, result) values ($1,$2, now() - ($3 + 1) * interval '1 hour', now() - $3 * interval '1 hour', $4)`,
      [id, i, (o.hoursAgo ?? 1) + (o.attempts ?? 1) - i, i < (o.attempts ?? 1) ? 'failed' : status]);
  }
}
async function agents(b: Browser, qs = '') {
  const r = await b.req('GET', '/agents' + qs);
  expect(r.status).toBe(200);
  return Object.fromEntries((r.body.agents as any[]).map((a) => [a.id, a])) as Record<string, any>;
}
const relOf = async (b: Browser, id: string, qs = '') => (await agents(b, qs))[id].reliability;

beforeAll(async () => {
  t = await makeTestApp({ staffingStepMs: 3_600_000, conversationSimMs: 3_600_000, demoSeed: false });
  const w = await withAdmin(t.app);
  A = w.admin; adminId = w.adminId;
  const m = await w.member('Mina'); M = m.b; minaId = m.id;
  const k = await w.member('Kenji'); K = k.b; kenjiId = k.id;
});
afterAll(async () => { await t?.close(); });

describe('shape and parameters', () => {
  it('every agent carries reliability; a fresh database has no evidence', async () => {
    const all = await agents(M);
    expect(Object.keys(all).length).toBeGreaterThan(20);
    for (const a of Object.values(all)) {
      expect(a.reliability).toEqual({ value: null, n: 0, window: '90d', includesSimulated: false,
        evidence: 'not enough evidence (0 of 5) · no finished tasks · last 90 days · from missions you can see' });
    }
    expect((await A.req('GET', '/agents/coder-01')).body.agent.reliability).toMatchObject({ value: null, n: 0 });
  });
  it('an unknown includeSimulated value is 400; anonymous is 401', async () => {
    expect((await A.req('GET', '/agents?includeSimulated=yes')).status).toBe(400);
    expect((await A.req('GET', '/agents/coder-01?includeSimulated=2')).status).toBe(400);
    expect((await new Browser(t.app).req('GET', '/agents')).status).toBe(401);
  });
  it('a newly created agent comes back with an empty reliability', async () => {
    const r = await A.req('POST', '/agents', { name: 'Archivist-01', role: 'archivist', dept: 'Operations', duty: 'Keeps the archive', model: 'm' }, key());
    expect(r.status).toBe(201);
    expect(r.body.agent.reliability).toMatchObject({ value: null, n: 0, window: '90d', includesSimulated: false });
  });
});

describe('measured from recorded tasks', () => {
  beforeAll(async () => {
    // P: Mina's private mission. Coder-01: 4 first-time passes, 1 failure; P6 is taken from Tester-01 (through the API) and passes at Coder-01.
    await mission('P', minaId);
    for (const a of ['gm', 'coder-01', 'tester-01']) await instance('P', a);
    for (const id of ['P1', 'P2', 'P3', 'P4']) await task(id, 'P', 'coder-01', 'passed');
    await task('P5', 'P', 'coder-01', 'failed');
    await task('P6', 'P', 'tester-01', 'failed');
    const r = await M.req('POST', '/tasks/P6/reassign', { toInstanceId: 'P:coder-01' }, key());
    expect(r.status).toBe(200);
    // after the handover Coder-01 makes its own (first) attempt and the system passes the task (nothing executes yet)
    await q(`insert into task_attempts(task_id, attempt_no, started_at, finished_at, result) values ('P6', 2, now(), now(), 'passed')`);
    await q(`update tasks set status='passed' where id='P6'`);
    // finish time = the later of the last move into the current state and the last attempt (review m4): P7's event is
    // 100 days old but its attempt finished 1 hour ago, so it counts; P11 has only old records, so it does not
    await task('P7', 'P', 'coder-01', 'failed', { createdDaysAgo: 120 });
    await q(`insert into events(tenant_id, type, mission_id, seq, subject_kind, subject_id, audience, payload, occurred_at)
             values ('t-1','task.stateChanged','P',10001,'task','P7','mission','{"taskId":"P7","from":"running","to":"failed","action":"fail"}', now() - interval '100 days')`);
    await task('P11', 'P', 'coder-01', 'failed', { createdDaysAgo: 120, hoursAgo: 100 * 24 });
    await q(`insert into events(tenant_id, type, mission_id, seq, subject_kind, subject_id, audience, payload, occurred_at)
             values ('t-1','task.stateChanged','P',10002,'task','P11','mission','{"taskId":"P11","from":"running","to":"failed","action":"fail"}', now() - interval '100 days')`);
    // no event and no attempt, created before the window: its finish can't be placed in the window
    await q(`insert into tasks(id, tenant_id, mission_id, title, status, owner_agent, owner_instance_id, created_at) values ('P8','t-1','P','t','passed','coder-01','P:coder-01', now() - interval '120 days')`);
    await task('P9', 'P', 'coder-01', 'canceled'); // a human stop: excluded
    await task('P10', 'P', 'coder-01', 'verifying'); // open: excluded

    // S: Kenji's shared mission. Coder-01: 1 first-time pass, 1 failure, 1 pass after a retry.
    await mission('S', kenjiId, { shared: true });
    for (const a of ['gm', 'coder-01']) await instance('S', a);
    await task('S1', 'S', 'coder-01', 'passed');
    await task('S2', 'S', 'coder-01', 'failed');
    await task('S3', 'S', 'coder-01', 'passed', { attempts: 2 });

    // D: a shared DEMO mission with simulated tasks: 3 failures at Coder-01
    await mission('D', adminId, { shared: true, demo: true });
    for (const a of ['gm', 'coder-01']) await instance('D', a);
    for (const id of ['D1', 'D2', 'D3']) await task(id, 'D', 'coder-01', 'failed', { simulated: true });
    // DP: the admin's PRIVATE DEMO mission: includeSimulated never reveals it to a member (review m7)
    await mission('DP', adminId, { demo: true });
    for (const a of ['gm', 'coder-01']) await instance('DP', a);
    for (const id of ['DP1', 'DP2']) await task(id, 'DP', 'coder-01', 'failed', { simulated: true });

    // X: deleted mission: never counts
    await mission('X', minaId, { shared: true });
    for (const a of ['gm', 'coder-01']) await instance('X', a);
    for (const id of ['X1', 'X2', 'X3', 'X4', 'X5']) await task(id, 'X', 'coder-01', 'failed');
    await q(`update missions set deleted_at=now() where id='X'`);

    // another tenant: a shared mission with an instance of the same agent id, 5 failures, and an audit row that names S1
    await q(`insert into tenants(id,name) values ('t-2','Other')`);
    await q(`insert into users(id,tenant_id,name,name_key,pass_hash,role,status) values ('u-x','t-2','X','x','h','admin','approved')`);
    await mission('O', 'u-x', { shared: true, tenant: 't-2' });
    for (const a of ['gm', 'coder-01']) await instance('O', a, 't-2');
    for (const id of ['O1', 'O2', 'O3', 'O4', 'O5']) await task(id, 'O', 'coder-01', 'failed', { tenant: 't-2' });
    await q(`insert into audit_events(tenant_id, actor, action, subject, result, correlation_id, detail) values ('t-2','u-x','task.reassign','S1','ok','c','{"fromInstanceId":"S:coder-01","toInstanceId":"S:gm"}')`);
    // a refused reassignment is not a reassignment
    await q(`insert into audit_events(tenant_id, actor, action, subject, result, correlation_id, detail) values ('t-1',$1,'task.reassign','S1','denied','c','{"fromInstanceId":"S:coder-01","toInstanceId":"S:gm"}')`, [kenjiId]);
  });

  it('an admin counts every visible real task of the tenant: 6 of 10 → 60', async () => {
    expect(await relOf(A, 'coder-01')).toEqual({ value: 60, n: 10, window: '90d', includesSimulated: false,
      evidence: '6 of 10 finished tasks passed first time · 1 retried · 3 failed · last 90 days · from missions you can see' });
  });
  it('the reassignment counts against the agent it left (Tester-01), from the API\'s recorded reassign', async () => {
    expect(await relOf(A, 'tester-01')).toMatchObject({ value: null, n: 1,
      evidence: 'not enough evidence (1 of 5) · 0 of 1 finished task passed first time · 1 reassigned away · last 90 days · from missions you can see' });
  });
  it('the owner of the private mission sees the same as the admin', async () => {
    expect(await relOf(M, 'coder-01')).toMatchObject({ value: 60, n: 10 });
    expect(await relOf(M, 'tester-01')).toMatchObject({ n: 1 });
  });
  it('a member does not count a private mission\'s tasks or its reassignments', async () => {
    expect(await relOf(K, 'coder-01')).toEqual({ value: null, n: 3, window: '90d', includesSimulated: false,
      evidence: 'not enough evidence (3 of 5) · 1 of 3 finished tasks passed first time · 1 retried · 1 failed · last 90 days · from missions you can see' });
    expect(await relOf(K, 'tester-01')).toMatchObject({ n: 0 });
  });
  it('simulated (DEMO) tasks only with includeSimulated=1, which the result says', async () => {
    expect(await relOf(A, 'coder-01', '?includeSimulated=1')).toMatchObject({ value: 40, n: 15, includesSimulated: true }); // 6 of 15 (D + DP)
    expect(await relOf(M, 'coder-01', '?includeSimulated=1')).toMatchObject({ value: 46, n: 13, includesSimulated: true }); // 6 of 13: D is shared, DP is private
    expect(await relOf(K, 'coder-01', '?includeSimulated=1')).toMatchObject({ value: 17, n: 6, includesSimulated: true }); // 1 of 6
    expect(await relOf(A, 'coder-01', '?includeSimulated=0')).toMatchObject({ n: 10, includesSimulated: false });
  });
  it('another tenant never counts (its tasks, nor its audit rows naming our task)', async () => {
    // exact per user: t-2's 5 failures (and its audit row naming S1) would change every one of these (review m7)
    for (const [b, n, value] of [[A, 15, 40], [M, 13, 46], [K, 6, 17]] as const) {
      const r = await relOf(b, 'coder-01', '?includeSimulated=1');
      expect(r).toMatchObject({ n, value });
      expect(r.evidence).not.toMatch(/reassigned away/);
    }
    expect(await relOf(K, 'coder-01')).toMatchObject({ n: 3, value: null });
  });
  it('a reassignment made later through the API moves the count (live source, no cache)', async () => {
    await task('S4', 'S', 'coder-01', 'failed');
    expect(await relOf(K, 'coder-01')).toMatchObject({ n: 4, value: null });
    const r = await K.req('POST', '/tasks/S4/reassign', { toInstanceId: 'S:gm' }, key());
    expect(r.status).toBe(200);
    // S4 failed under Coder-01: it stays one unreliable task for Coder-01 (now "reassigned away" instead of "failed").
    // The GM did not attempt it, so the failure is not the GM's (review I2): not counted, and its sentence says so.
    const k = await relOf(K, 'coder-01');
    expect(k).toMatchObject({ n: 4 });
    expect(k.evidence).toContain('1 reassigned away');
    expect(await relOf(K, 'gm')).toMatchObject({ n: 0, evidence: expect.stringContaining('1 taken over after failing elsewhere (not counted)') });
    // a person retries it at the GM (the retry's attempt belongs to the GM) and the system fails it again: now the GM's failure
    expect((await K.req('POST', '/tasks/S4/retry', undefined, key())).status).toBe(200);
    await q(`update tasks set status='failed' where id='S4'`);
    expect(await relOf(K, 'gm')).toMatchObject({ n: 1, evidence: expect.stringContaining('1 failed') });
    await task('S5', 'S', 'coder-01', 'passed');
    expect(await relOf(K, 'coder-01')).toMatchObject({ n: 5, value: 40 });
  });
  it('a task owned only by an agent id (no instance) is charged to that agent when reassigned away (audit fromAgent)', async () => {
    await q(`insert into tasks(id, tenant_id, mission_id, title, status, owner_agent) values ('S6','t-1','S','t','failed','tester-01')`);
    const r = await K.req('POST', '/tasks/S6/reassign', { toInstanceId: 'S:coder-01' }, key());
    expect(r.status).toBe(200);
    const k = await relOf(K, 'tester-01');
    expect(k).toMatchObject({ n: 1 });
    expect(k.evidence).toContain('1 reassigned away');
    // S6 failed under Tester-01; Coder-01 never attempted it, so it gets no failure (review I2)
    expect(await relOf(K, 'coder-01')).toMatchObject({ n: 5, value: 40 });
  });
  it('multiple reassignments through the API: Coder-01 → GM → Tester-01; each agent it left is charged once, the last owner only for its own attempt (m7)', async () => {
    await instance('S', 'tester-01');
    await task('S7', 'S', 'coder-01', 'failed');
    expect((await K.req('POST', '/tasks/S7/reassign', { toInstanceId: 'S:gm' }, key())).status).toBe(200);
    expect((await K.req('POST', '/tasks/S7/reassign', { toInstanceId: 'S:tester-01' }, key())).status).toBe(200);
    expect((await K.req('POST', '/tasks/S7/retry', undefined, key())).status).toBe(200); // attempt 2 (not started): Tester-01's
    await q(`update tasks set status='passed' where id='S7'`); // the system's pass
    expect(await relOf(K, 'coder-01')).toMatchObject({ n: 6, value: 33, evidence: expect.stringContaining('2 reassigned away') }); // S4, S7
    expect(await relOf(K, 'gm')).toMatchObject({ n: 2, evidence: expect.stringContaining('1 failed · 1 reassigned away') }); // S4 own failure, S7 left
    expect(await relOf(K, 'tester-01')).toMatchObject({ n: 2, evidence: 'not enough evidence (2 of 5) · 1 of 2 finished tasks passed first time · 1 reassigned away · last 90 days · from missions you can see' });
  });
  it('the value is identical between GET /agents and GET /agents/:id, for every agent, user and mode', async () => {
    for (const b of [A, M, K]) for (const qs of ['', '?includeSimulated=1']) {
      const list = await agents(b, qs);
      for (const [id, a] of Object.entries(list)) {
        const one = await b.req('GET', `/agents/${id}${qs}`);
        expect(one.status).toBe(200);
        expect(one.body.agent.reliability, `${id} ${qs}`).toEqual(a.reliability);
      }
    }
  });
});
