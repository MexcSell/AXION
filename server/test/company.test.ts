import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeTestApp, withAdmin, Browser, type TestApp } from './helpers.ts';

// Improvement cycle 2: GET /api/v1/company/scorecard — scoping (visibility, tenant, DEMO) and verified completions.
// Fixture histories are written with direct SQL (complete/fail are system-only actions; nothing executes yet).
let t: TestApp;
let A: Browser; // administrator
let M: Browser; // member Mina
let K: Browser; // member Kenji
let adminId = '', minaId = '', kenjiId = '';
let seq = 0;
const q = (sql: string, p: unknown[] = []) => t.pool.query(sql, p);

async function mission(id: string, owner: string, o: { shared?: boolean; demo?: boolean; tenant?: string } = {}) {
  await q(`insert into missions(id, tenant_id, owner_id, shared, status, demo) values ($1,$2,$3,$4,'running',$5)`, [id, o.tenant ?? 't-1', owner, o.shared ?? false, o.demo ?? false]);
  await q(`insert into mission_revisions(mission_id, revision, title, kind, priority, text, created_by) values ($1,1,$1,'data','normal','x',$2)`, [id, owner]);
  await q(`insert into mission_runs(mission_id, revision, status, started_at) values ($1,1,'running', now() - interval '5 hours')`, [id]);
}
async function step(id: string, from: string, to: string, hoursAgo: number, tenant = 't-1') {
  await q(`insert into events(tenant_id, type, mission_id, seq, subject_kind, subject_id, audience, payload, occurred_at)
           values ($1,'mission.stateChanged',$2,$3,'mission',$2,'mission',$4, now() - $5 * interval '1 hour')`,
  [tenant, id, ++seq, JSON.stringify({ from, to, action: 'x', by: 'system' }), hoursAgo]);
  await q(`update missions set status=$2 where id=$1`, [id, to]);
}
async function finished(id: string, owner: string, to: 'completed' | 'failed' | 'canceled', o: { shared?: boolean; demo?: boolean; tenant?: string } = {}) {
  await mission(id, owner, o);
  if (to === 'completed') { await step(id, 'running', 'verifying', 3, o.tenant); await step(id, 'verifying', 'completed', 1, o.tenant); }
  else await step(id, 'running', to, 1, o.tenant);
}
async function approval(missionId: string, decidedBy: string, decision: 'approved' | 'denied' = 'approved') {
  const id = 'APR-' + missionId;
  await q(`insert into approval_requests(id, tenant_id, mission_id, agent_id, kind, title, risk, action_digest, state, expires_at)
           values ($1,'t-1',$2,'gm','release','Release','R2','d',$3, now() + interval '1 day')`, [id, missionId, decision]);
  await q(`insert into approval_decisions(approval_id, decision, digest, decided_by, decided_at) values ($1,$2,'d',$3, now() - interval '2 hours')`, [id, decision, decidedBy]);
}
async function card(b: Browser, qs = '') {
  const r = await b.req('GET', '/company/scorecard' + qs);
  expect(r.status).toBe(200);
  const by = Object.fromEntries((r.body.rows as any[]).map((x) => [x.key, x]));
  return { body: r.body, by };
}

beforeAll(async () => {
  t = await makeTestApp({ staffingStepMs: 3_600_000, conversationSimMs: 3_600_000 });
  const w = await withAdmin(t.app);
  A = w.admin; adminId = w.adminId;
  const m = await w.member('Mina'); M = m.b; minaId = m.id;
  const k = await w.member('Kenji'); K = k.b; kenjiId = k.id;
});
afterAll(async () => { await t?.close(); });

describe('access and parameters', () => {
  it('anonymous is 401', async () => {
    expect((await new Browser(t.app).req('GET', '/company/scorecard')).status).toBe(401);
  });
  it('an unknown window or includeDemo value is 400', async () => {
    expect((await A.req('GET', '/company/scorecard?window=1y')).status).toBe(400);
    expect((await A.req('GET', '/company/scorecard?includeDemo=yes')).status).toBe(400);
  });
  it('a fresh database: defaults 30d / demo excluded, no evidence for any rate', async () => {
    const { body, by } = await card(M);
    expect(body).toMatchObject({ window: '30d', includeDemo: false });
    expect(new Date(body.to).getTime() - new Date(body.from).getTime()).toBe(30 * 86_400_000);
    expect(by.verified_success_rate).toMatchObject({ value: null, n: 0, state: 'none' });
    expect(by.finished).toMatchObject({ value: 0, n: 0 });
    expect((await card(M, '?window=7d')).body.window).toBe('7d');
  });
});

describe('scoping', () => {
  beforeAll(async () => {
    // Mina: 3 private finished missions (2 canceled, 1 completed + approved by the admin)
    await finished('M-201', minaId, 'canceled');
    await finished('M-202', minaId, 'canceled');
    await finished('M-203', minaId, 'completed');
    await approval('M-203', adminId);
    // Kenji: 1 private failed mission with a waiting interval and a recovered task; 1 shared completed (self-approved)
    await finished('M-204', kenjiId, 'failed');
    await step('M-204', 'failed', 'waiting_approval', 0.9); await step('M-204', 'waiting_approval', 'running', 0.5);
    await q(`insert into tasks(id, tenant_id, mission_id, title, status) values ('T-204','t-1','M-204','t','passed')`);
    await q(`insert into task_attempts(task_id, attempt_no, started_at, finished_at, result) values ('T-204',1,now()-interval '3 hours',now()-interval '2 hours','failed'),('T-204',2,now()-interval '1 hour',now(),'passed')`);
    await finished('M-205', kenjiId, 'completed', { shared: true });
    await approval('M-205', kenjiId);
    // a DEMO mission (the admin's, shared) that finished
    await finished('M-206', adminId, 'canceled', { demo: true, shared: true });
    // another tenant: an admin there, a shared finished mission with a waiting interval
    await q(`insert into tenants(id,name) values ('t-2','Other')`);
    await q(`insert into users(id,tenant_id,name,name_key,pass_hash,role,status) values ('u-x','t-2','X','x','h','admin','approved')`);
    await finished('M-207', 'u-x', 'completed', { shared: true, tenant: 't-2' });
    await step('M-207', 'completed', 'waiting_approval', 0.9, 't-2'); await step('M-207', 'waiting_approval', 'running', 0.5, 't-2');
    // a deleted mission never counts
    await finished('M-208', minaId, 'canceled');
    await q(`update missions set deleted_at=now() where id='M-208'`);
  });

  it('an admin sees all missions of the tenant (DEMO and other tenants excluded)', async () => {
    const { by } = await card(A);
    expect(by.finished).toMatchObject({ value: 5, n: 5 }); // M-201..205
    expect(by.started).toMatchObject({ value: 5 });
    expect(by.verified_success_rate).toMatchObject({ value: 20, n: 5, state: 'ok', evidence: '1 of 5 finished missions verified · 1 completed unverified' });
    expect(by.failure_rate).toMatchObject({ value: 60, n: 5 });
    expect(by.task_recovery_rate.n).toBe(1);
    expect(by.waiting_approval_median_h.n).toBe(1);
  });

  it('a member never counts a private mission they cannot see (also tasks and waiting intervals)', async () => {
    const mina = (await card(M)).by; // her 3 + Kenji's shared one
    expect(mina.finished).toMatchObject({ value: 4, n: 4 });
    expect(mina.verified_success_rate).toMatchObject({ value: 25, n: 4, evidence: '1 of 4 finished missions verified · 1 completed unverified' });
    expect(mina.task_recovery_rate.n).toBe(0);
    expect(mina.waiting_approval_median_h.n).toBe(0);
    const kenji = (await card(K)).by; // his 2 only
    expect(kenji.finished).toMatchObject({ value: 2, n: 2 });
    expect(kenji.verified_success_rate).toMatchObject({ value: null, state: 'none' });
    expect(kenji.completed_unverified).toMatchObject({ value: 1 }); // his own approval of his own mission is no verification
    expect(kenji.task_recovery_rate.n).toBe(1);
    expect(kenji.waiting_approval_median_h.n).toBe(1);
  });

  it('DEMO missions are excluded unless includeDemo=1', async () => {
    const on = await card(A, '?includeDemo=1');
    expect(on.body.includeDemo).toBe(true);
    expect(on.by.finished.value).toBe(6);
    expect((await card(M, '?includeDemo=1')).by.finished.value).toBe(5); // shared DEMO mission: visible to Mina too
    expect((await card(M)).by.finished.value).toBe(4);
  });

  it("another tenant's missions never count, even for its own shared missions", async () => {
    for (const b of [A, M, K]) {
      const { by } = await card(b, '?includeDemo=1&window=90d');
      expect(by.finished.value).toBeLessThanOrEqual(6);
      expect(by.waiting_approval_median_h.n).toBeLessThanOrEqual(1);
    }
    expect((await card(A, '?includeDemo=1&window=90d')).by.finished.value).toBe(6);
  });

  it('every task passed and a verifies delegation make a completion verified', async () => {
    await finished('M-209', minaId, 'completed');
    await q(`insert into agent_instances(id, tenant_id, mission_id, agent_id, agent_version_id)
             select 'M-209:' || a.id, 't-1', 'M-209', a.id, (select v.id from agent_versions v where v.agent_id=a.id order by v.created_at limit 1)
               from agent_definitions a where a.tenant_id='t-1' and a.id in ('gm', (select id from agent_definitions where tenant_id='t-1' and id <> 'gm' order by id limit 1))`);
    const other = (await q(`select agent_id from agent_instances where mission_id='M-209' and agent_id <> 'gm'`)).rows[0].agent_id as string;
    await q(`insert into tasks(id, tenant_id, mission_id, title, status) values ('T-209','t-1','M-209','t','passed')`);
    const before = (await card(M)).by.verified_success_rate;
    expect(before).toMatchObject({ n: 5, evidence: '1 of 5 finished missions verified · 2 completed unverified' });
    await q(`insert into mission_delegations(mission_id, from_instance, to_instance, edge_kind) values ('M-209',$1,'M-209:gm','verifies')`, ['M-209:' + other]);
    expect((await card(M)).by.verified_success_rate).toMatchObject({ value: 40, n: 5, evidence: '2 of 5 finished missions verified · 1 completed unverified' });
    // fix round m6: a simulated (fixture) task is not evidence, even when it passed
    await q(`update tasks set simulated=true where id='T-209'`);
    expect((await card(M)).by.verified_success_rate).toMatchObject({ value: 20, evidence: '1 of 5 finished missions verified · 2 completed unverified' });
  });
});
