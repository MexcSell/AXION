import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeTestApp, withAdmin, Browser, type TestApp } from './helpers.ts';
const BRIEF = { goal: 'Take over the task', acceptance: ['The result is attached'], capabilities: [{ kind: 'read' }], escalation: 'Ask the mission owner when unsure' }; // c51: a reassignment always carries a brief

// Improvement cycle 6: GET /api/v1/departments — scoping (visibility, tenant, deleted, DEMO missions, simulated tasks) and
// the last org change following a newly applied revision. Agents do not execute yet: passed/failed are system-only task
// states, so fixture histories are written with direct SQL (as in cycles 2 and 3); the org revision goes through POST /agents.
let t: TestApp;
let A: Browser; // administrator Luca
let M: Browser; // member Mina
let K: Browser; // member Kenji
let adminId = '', minaId = '', kenjiId = '';
let n = 0;
const q = (sql: string, p: unknown[] = []) => t.pool.query(sql, p);

async function mission(id: string, owner: string, o: { shared?: boolean; demo?: boolean; tenant?: string; status?: string } = {}) {
  await q(`insert into missions(id, tenant_id, owner_id, shared, status, demo) values ($1,$2,$3,$4,$5,$6)`, [id, o.tenant ?? 't-1', owner, o.shared ?? false, o.status ?? 'running', o.demo ?? false]);
  await q(`insert into mission_revisions(mission_id, revision, title, kind, priority, text, created_by) values ($1,1,$1,'data','normal','x',$2)`, [id, owner]);
}
/** An instance of an agent in a mission (simulated on DEMO missions, as the staffing simulation does). */
async function instance(missionId: string, agentId: string, o: { tenant?: string; ended?: boolean; simulated?: boolean } = {}) {
  await q(`insert into agent_instances(id, tenant_id, mission_id, agent_id, agent_version_id, simulated, ended_at)
           select $1, $2, $3, d.id, d.active_version_id, coalesce($5, (select demo from missions where id=$3)), case when $6 then now() end from agent_definitions d where d.id=$4`,
  [`${missionId}:${agentId}`, o.tenant ?? 't-1', missionId, agentId, o.simulated ?? null, o.ended ?? false]);
}
/** A task owned by an agent's instance; a finished one gets one finished attempt per `attempts` and a task.stateChanged event. */
async function task(id: string, missionId: string, agentId: string, status: string, o: { attempts?: number; hoursAgo?: number; simulated?: boolean; tenant?: string } = {}) {
  await q(`insert into tasks(id, tenant_id, mission_id, title, status, owner_agent, owner_instance_id, simulated, created_at) values ($1,$2,$3,'A task',$4,$5,$6,$7, now() - $8 * interval '1 hour')`,
    [id, o.tenant ?? 't-1', missionId, status, agentId, `${missionId}:${agentId}`, o.simulated ?? false, (o.hoursAgo ?? 1) + (o.attempts ?? 1) + 1]);
  if (status === 'passed' || status === 'failed') {
    for (let i = 1; i <= (o.attempts ?? 1); i++) {
      // attempts end at the task's finish time (cycle 3's finish time is the later of the last state move and the last attempt)
      const h = (o.hoursAgo ?? 1) + (o.attempts ?? 1) - i;
      await q(`insert into task_attempts(task_id, attempt_no, started_at, finished_at, result) values ($1,$2, now() - ($3 + 0.5) * interval '1 hour', now() - $3 * interval '1 hour', $4)`, [id, i, h, status]);
    }
    await q(`insert into events(tenant_id, type, mission_id, seq, subject_kind, subject_id, audience, payload, occurred_at)
             values ($1,'task.stateChanged',$2,$3,'task',$4,'mission',$5, now() - $6 * interval '1 hour')`,
    [o.tenant ?? 't-1', missionId, 900000 + n++, id, JSON.stringify({ taskId: id, from: 'running', to: status }), o.hoursAgo ?? 1]);
  }
}
async function depts(b: Browser, qs = '') {
  const r = await b.req('GET', '/departments' + qs);
  expect(r.status).toBe(200);
  return { body: r.body, by: Object.fromEntries((r.body.departments as any[]).map((d) => [d.name, d])) as Record<string, any> };
}

beforeAll(async () => {
  t = await makeTestApp({ staffingStepMs: 3_600_000, conversationSimMs: 3_600_000, demoSeed: false });
  const w = await withAdmin(t.app);
  A = w.admin; adminId = w.adminId;
  const m = await w.member('Mina'); M = m.b; minaId = m.id;
  const k = await w.member('Kenji'); K = k.b; kenjiId = k.id;
});
afterAll(async () => { await t?.close(); });

describe('access and shape', () => {
  it('anonymous is 401; an unknown window or includeDemo is 400', async () => {
    expect((await new Browser(t.app).req('GET', '/departments')).status).toBe(401);
    expect((await A.req('GET', '/departments?window=1y')).status).toBe(400);
    expect((await A.req('GET', '/departments?includeDemo=yes')).status).toBe(400);
  });
  it('a fresh database: 30d, DEMO excluded, departments from the catalog, heads from the latest revision, nothing staffed', async () => {
    const { body, by } = await depts(M);
    expect(body).toMatchObject({ window: '30d', includeDemo: false });
    expect(new Date(body.to).getTime() - new Date(body.from).getTime()).toBe(30 * 86_400_000);
    expect(Object.keys(by).sort()).toEqual(['Engineering', 'Executive', 'Governance', 'Knowledge', 'Operations', 'QA', 'R&D']);
    expect(by.Executive).toMatchObject({ headAgentId: 'gm', memberIds: ['gm'] });
    // Engineering: coder-01, integrator-01, browser-01 and designer-01 report to the GM; browser-01 has the most members under it
    expect(by.Engineering.headAgentId).toBe('browser-01');
    expect(by.Engineering.gmReports.sort()).toEqual(['browser-01', 'coder-01', 'designer-01', 'integrator-01']);
    expect(by.Engineering.memberIds).toContain('site-upwork');
    for (const d of Object.values(by)) {
      expect(d).toMatchObject({ staffedAgents: 0, activeMissions: 0, openTasks: { running: 0, waiting: 0, failed: 0 }, outcomes: { passed: 0, failed: 0, retried: 0, n: 0 } });
      // the seeded revision 1 placed every member; the GM reports to nobody, so Executive (only the GM) has no line
      if (d.name === 'Executive') expect(d.lastOrgChange).toBeNull(); else expect(d.lastOrgChange).toMatchObject({ revision: 1 });
    }
    expect((await depts(M, '?window=7d')).body.window).toBe('7d');
  });
});

describe('scoping', () => {
  beforeAll(async () => {
    // P: the admin's private mission — coder-01 (Engineering) staffed, one running task, two finished tasks
    await mission('P', adminId);
    await instance('P', 'coder-01');
    await task('P1', 'P', 'coder-01', 'running');
    await task('P2', 'P', 'coder-01', 'passed');
    await task('P3', 'P', 'coder-01', 'failed', { attempts: 2 });
    // S: Kenji's shared mission — ops-01 and planner-01 (Operations) staffed, one waiting task, one passed
    await mission('S', kenjiId, { shared: true, status: 'waiting_approval' });
    await instance('S', 'ops-01');
    await instance('S', 'planner-01');
    await task('S1', 'S', 'ops-01', 'waiting_user');
    await task('S2', 'S', 'planner-01', 'passed');
    // K: Kenji's private mission — tester-01 (QA)
    await mission('K', kenjiId);
    await instance('K', 'tester-01');
    await task('K1', 'K', 'tester-01', 'passed');
    // DEMO mission, shared: simulated instances and tasks of Engineering and QA
    await mission('DM', adminId, { shared: true, demo: true });
    await instance('DM', 'integrator-01');
    await instance('DM', 'tester-01');
    await task('DM1', 'DM', 'integrator-01', 'running', { simulated: true });
    await task('DM2', 'DM', 'tester-01', 'passed', { simulated: true });
    // a simulated task on a real shared mission (owner Mina) — not evidence unless includeDemo
    await mission('R', minaId, { shared: true, status: 'completed' });
    await instance('R', 'mentor-01');
    await task('R1', 'R', 'mentor-01', 'passed', { simulated: true });
    await task('R2', 'R', 'mentor-01', 'failed');
    // a deleted shared mission: never counted
    await mission('X', kenjiId, { shared: true });
    await instance('X', 'security-01');
    await task('X1', 'X', 'security-01', 'passed');
    await q(`update missions set deleted_at=now() where id='X'`);
    // an ended instance on an active mission: not staffed
    await instance('S', 'comms-01', { ended: true });
    // another tenant's shared mission staffing a t-1 agent: never counted
    await q(`insert into tenants(id,name) values ('t-2','Other')`);
    await q(`insert into users(id,tenant_id,name,name_key,pass_hash,role,status) values ('u-x','t-2','X','x','h','admin','approved')`);
    await mission('O', 'u-x', { shared: true, tenant: 't-2' });
    await instance('O', 'knowledge-01', { tenant: 't-2' });
    await task('O1', 'O', 'knowledge-01', 'running', { tenant: 't-2' });
    await task('O2', 'O', 'knowledge-01', 'passed', { tenant: 't-2' });
  });

  it('the administrator counts every mission of the tenant (DEMO and deleted excluded)', async () => {
    const { by } = await depts(A);
    expect(by.Engineering).toMatchObject({ staffedAgents: 1, activeMissions: 1, openTasks: { running: 1, waiting: 0, failed: 1 }, outcomes: { passed: 1, failed: 1, retried: 1, n: 2 } });
    expect(by.Operations).toMatchObject({ staffedAgents: 2, activeMissions: 1, openTasks: { running: 0, waiting: 1, failed: 0 }, outcomes: { passed: 1, failed: 0, retried: 0, n: 1 } });
    expect(by.QA).toMatchObject({ staffedAgents: 1, activeMissions: 1, outcomes: { passed: 1, failed: 1, retried: 0, n: 2 } }); // tester-01 on K (K1); mentor-01's failed R2 (R is completed: not staffed, not open)
    expect(by.QA.openTasks).toEqual({ running: 0, waiting: 0, failed: 0 });
    expect(by.Governance).toMatchObject({ staffedAgents: 0, outcomes: { n: 0 } });
    expect(by.Knowledge).toMatchObject({ staffedAgents: 0, activeMissions: 0, openTasks: { running: 0 }, outcomes: { n: 0 } });
  });

  it("a member does not count a private mission's instances or tasks (visibility)", async () => {
    const mina = await depts(M);
    expect(mina.by.Engineering).toMatchObject({ staffedAgents: 0, activeMissions: 0, openTasks: { running: 0, waiting: 0, failed: 0 }, outcomes: { n: 0 } });
    expect(mina.by.Operations).toMatchObject({ staffedAgents: 2, activeMissions: 1, openTasks: { waiting: 1 }, outcomes: { passed: 1, n: 1 } }); // shared S
    expect(mina.by.QA).toMatchObject({ staffedAgents: 0, activeMissions: 0, outcomes: { failed: 1, n: 1 } }); // her own R; not Kenji's private K
    const kenji = await depts(K);
    expect(kenji.by.QA).toMatchObject({ staffedAgents: 1, activeMissions: 1, outcomes: { passed: 1, failed: 1, n: 2 } });
    expect(kenji.by.Engineering).toMatchObject({ staffedAgents: 0, outcomes: { n: 0 } });
  });

  it('another tenant is excluded, even when its mission is shared and staffs the same agents', async () => {
    for (const b of [A, M, K]) expect((await depts(b)).by.Knowledge).toMatchObject({ staffedAgents: 0, openTasks: { running: 0 }, outcomes: { n: 0 } });
  });

  it('DEMO missions and simulated tasks only with includeDemo=1', async () => {
    const { body, by } = await depts(M, '?includeDemo=1');
    expect(body.includeDemo).toBe(true);
    expect(by.Engineering).toMatchObject({ staffedAgents: 1, activeMissions: 1, openTasks: { running: 1 } }); // integrator-01 on DM
    expect(by.QA).toMatchObject({ staffedAgents: 1, activeMissions: 1, outcomes: { passed: 2, failed: 1, n: 3 } }); // DM2 + simulated R1 + R2
    expect(by.QA.evidence).toMatch(/DEMO included/);
    expect((await depts(M)).by.QA.outcomes).toMatchObject({ passed: 0, failed: 1, n: 1 });
  });

  it('the window decides outcomes: a task finished 10 days ago is in 30d, not in 7d', async () => {
    await task('S3', 'S', 'ops-01', 'passed', { hoursAgo: 240 });
    expect((await depts(M)).by.Operations.outcomes).toMatchObject({ passed: 2, n: 2 });
    expect((await depts(M, '?window=7d')).by.Operations.outcomes).toMatchObject({ passed: 1, n: 1 });
  });
});

describe('last org change', () => {
  it('follows a newly applied org revision (POST /agents), only for the department whose line changed', async () => {
    const before = await depts(M);
    expect(before.by.Engineering.lastOrgChange.revision).toBe(1);
    const r = await A.req('POST', '/agents', { name: 'Data-Eng-01', role: 'Data engineer', dept: 'Engineering', duty: 'Data pipelines (c06 test)', model: 'claude-sonnet-5-5', managerId: 'coder-01' }, { 'idempotency-key': 'c06-agent-1' });
    expect(r.status).toBe(201);
    const after = await depts(M);
    expect(after.by.Engineering.lastOrgChange.revision).toBe(2);
    expect(after.by.Engineering.memberIds).toContain('data-eng-01');
    expect(new Date(after.by.Engineering.lastOrgChange.at).getTime()).toBeGreaterThanOrEqual(new Date(before.by.Engineering.lastOrgChange.at).getTime());
    for (const d of ['Operations', 'QA', 'R&D']) expect(after.by[d].lastOrgChange.revision).toBe(1);
    expect(after.by.Executive.lastOrgChange).toBeNull();
  });
  it('a new agent reporting to the GM in a new department makes it a department with that head', async () => {
    const r = await A.req('POST', '/agents', { name: 'Legal-01', role: 'Counsel', dept: 'Legal', duty: 'Contracts review (c06 test)', model: 'claude-sonnet-5-5' }, { 'idempotency-key': 'c06-agent-2' });
    expect(r.status).toBe(201);
    const { by } = await depts(K);
    expect(by.Legal).toMatchObject({ headAgentId: 'legal-01', gmReports: ['legal-01'], memberIds: ['legal-01'], lastOrgChange: { revision: 3 } });
    expect(by.Engineering.lastOrgChange.revision).toBe(2);
  });
});

describe('fix round: outcomes count against the owner at the time (as cycle 3)', () => {
  const eng = async () => (await depts(A)).by;
  it('a failed task reassigned to another department stays counted against the original department', async () => {
    await mission('F', adminId);
    await instance('F', 'coder-01'); // Engineering
    await instance('F', 'ops-01'); // Operations
    await task('F1', 'F', 'coder-01', 'failed', { hoursAgo: 2 });
    const before = await eng();
    const r = await A.req('POST', '/tasks/F1/reassign', { toInstanceId: 'F:ops-01', brief: BRIEF }, { 'idempotency-key': 'c06-fix-re' });
    expect(r.status).toBe(200);
    const after = await eng();
    expect(after.Engineering.outcomes).toEqual(before.Engineering.outcomes); // the failure stays in Engineering
    expect(after.Operations.outcomes).toEqual(before.Operations.outcomes); // never moves to the receiving department
    expect(after.Operations.openTasks.failed).toBe(before.Operations.openTasks.failed + 1); // open work does move: it is Ops' task now
    expect(after.Engineering.openTasks.failed).toBe(before.Engineering.openTasks.failed - 1);
  });
  it('a retry by the new owner counts for the new department; the original failure stays where it happened', async () => {
    const before = await eng();
    const r = await A.req('POST', '/tasks/F1/retry', {}, { 'idempotency-key': 'c06-fix-rt' });
    expect(r.status).toBe(200);
    // the system runs the retry and it passes (passed is a system-only state: written directly, as everywhere in these
    // tests; task_attempts is append-only, so the retry's placeholder attempt stays as the route wrote it — it is the new owner's)
    await q(`update tasks set status = 'passed' where id = 'F1'`);
    await q(`insert into events(tenant_id, type, mission_id, seq, subject_kind, subject_id, audience, payload, occurred_at)
             values ('t-1','task.stateChanged','F',$1,'task','F1','mission',$2, now() - interval '10 minutes')`, [990000, JSON.stringify({ taskId: 'F1', from: 'running', to: 'passed' })]);
    const after = await eng();
    expect(after.Operations.outcomes).toEqual({ ...before.Operations.outcomes, passed: before.Operations.outcomes.passed + 1, n: before.Operations.outcomes.n + 1 });
    expect(after.Engineering.outcomes).toEqual(before.Engineering.outcomes); // still one failure, not erased by the later pass
    expect(after.Engineering.outcomes.failed).toBeGreaterThanOrEqual(1);
  });
  it('a member with includeDemo=1 still cannot count a private DEMO mission', async () => {
    await mission('PD', kenjiId, { demo: true });
    await instance('PD', 'security-01'); // Governance
    expect((await depts(M, '?includeDemo=1')).by.Governance).toMatchObject({ staffedAgents: 0, activeMissions: 0 });
    expect((await depts(K, '?includeDemo=1')).by.Governance).toMatchObject({ staffedAgents: 1, activeMissions: 1 });
    expect((await depts(K)).by.Governance).toMatchObject({ staffedAgents: 0 });
  });
});
