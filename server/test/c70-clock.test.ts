import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { makeTestApp, withAdmin, type Browser, type TestApp } from './helpers.ts';
import { requestApproval } from '../src/approvals/service.ts';
import { tx } from '../src/db.ts';

// Improvement cycle 70 (H11b): the last app-clock bounds. Same method as c54's clock-bounds.test.ts: the application clock is skewed
// one hour into the past while the request runs; rows are written with the database clock. A route that bounds, compares or writes a
// time with `new Date()` / `Date.now()` is wrong by that hour.
let t: TestApp;
let A: Browser;
const q = (sql: string, p: unknown[] = []) => t.pool.query(sql, p);
const SKEW = 3_600_000;
async function skewed<T>(fn: () => Promise<T>, by = SKEW): Promise<T> {
  vi.useFakeTimers({ toFake: ['Date'], now: Date.now() - by });
  try { return await fn(); } finally { vi.useRealTimers(); }
}
afterEach(() => { vi.useRealTimers(); });
let k = 0;
const issue = (b: Record<string, unknown>) => A.req('POST', '/site-grants', b, { 'idempotency-key': 'c70-' + k++ });

beforeAll(async () => {
  t = await makeTestApp({ staffingStepMs: 3_600_000, conversationSimMs: 3_600_000, demoSeed: false });
  const w = await withAdmin(t.app);
  A = w.admin;
  await q(`insert into missions(id, tenant_id, owner_id, shared, status, demo) values ('M-c70','t-1',$1,true,'completed',false)`, [w.adminId]);
  await q(`insert into mission_revisions(mission_id, revision, title, kind, priority, text, created_by) values ('M-c70',1,'M-c70','data','normal','x',$1)`, [w.adminId]);
  await q(`insert into agent_instances(id, tenant_id, mission_id, agent_id, agent_version_id, simulated) select 'M-c70:coder-01','t-1','M-c70',d.id,d.active_version_id,false from agent_definitions d where d.id='coder-01'`);
  await q(`insert into tasks(id, tenant_id, mission_id, title, status, owner_agent, owner_instance_id, simulated, created_at) values ('T-c70','t-1','M-c70','T','passed','coder-01','M-c70:coder-01',false, now())`);
  await q(`insert into task_attempts(task_id, attempt_no, started_at, finished_at, result) values ('T-c70',1, now(), now(), 'passed')`);
  await q(`insert into events(tenant_id, type, mission_id, seq, subject_kind, subject_id, audience, payload, occurred_at) values ('t-1','task.stateChanged','M-c70',710001,'task','T-c70','mission',$1, now())`, [JSON.stringify({ taskId: 'T-c70', from: 'running', to: 'passed' })]);
});
afterAll(async () => { await t?.close(); });

describe('H11b: agent reliability window end is the database clock', () => {
  it('GET /agents counts a task that finished a moment ago although the app clock is an hour behind', async () => {
    const r = await skewed(() => A.req('GET', '/agents'));
    expect(r.status).toBe(200);
    const a = (r.body.agents as any[]).find((x) => x.id === 'coder-01');
    expect(a.reliability.n).toBe(1);
  });
});

describe('H11b: site grants write and compare with the database clock', () => {
  const exp = (ms: number) => new Date(Date.now() + ms).toISOString();
  it('an expiry that is already past by the database clock is refused although the app clock is an hour behind', async () => {
    const past = exp(-30 * 60_000); // computed with the real clock: 30 minutes ago
    const r = await skewed(() => issue({ origin: 'https://past.example.com', missionId: 'M-c70', capabilities: ['read'], expiresAt: past }));
    expect(r.status).toBe(422);
    expect((await q(`select 1 from site_grants where exact_origin='https://past.example.com'`)).rowCount).toBe(0);
  });
  it('the 30-day cap is measured from the database clock', async () => {
    const edge = exp(30 * 86_400_000 - 10 * 60_000); // 10 minutes inside the cap by the real clock; 70 minutes outside it by a clock 1 h behind
    const r = await skewed(() => issue({ origin: 'https://cap.example.com', missionId: 'M-c70', capabilities: ['read'], expiresAt: edge }));
    expect(r.status).toBe(201);
  });
  it('issued_at is written by the database clock', async () => {
    const r = await skewed(() => issue({ origin: 'https://issued.example.com', missionId: 'M-c70', capabilities: ['read'], expiresAt: exp(2 * 3_600_000) }));
    expect(r.status).toBe(201);
    const row = (await q(`select abs(extract(epoch from (issued_at - now()))) as d from site_grants where exact_origin='https://issued.example.com'`)).rows[0];
    expect(Number(row.d)).toBeLessThan(60);
    expect(Math.abs(new Date(r.body.grant.issuedAt).getTime() - Date.now())).toBeLessThan(60_000);
  });
  it('the listed state is judged by the database clock: a grant that expired 30 minutes ago is expired, not active', async () => {
    await q(`insert into site_grants(id, tenant_id, mission_id, exact_origin, capabilities, issued_by, issued_at, expires_at) select 'SG-${'A'.repeat(32)}','t-1','M-c70','https://stale.example.com','{read}',id, now() - interval '2 hours', now() - interval '30 minutes' from users limit 1`);
    const r = await skewed(() => A.req('GET', '/site-grants'));
    expect((r.body.grants as any[]).find((g) => g.origin === 'https://stale.example.com').state).toBe('expired');
  });
});

describe('H11b: the approval expiry figures come from the database clock', () => {
  it('GET /approvals reports minutes to expiry by the database clock (60 min, not 120) when the app clock is an hour behind', async () => {
    await tx(t.app.db, (c) => requestApproval(c, { tenantId: 't-1', missionId: 'M-c70', agentId: 'release-01', kind: 'submit_form', title: 'T', detail: 'd', payload: { x: 1 }, expiresInMin: 60 } as any));
    const r = await skewed(() => A.req('GET', '/approvals'));
    expect(r.status).toBe(200);
    const a = (r.body.approvals as any[]).find((x) => x.missionId === 'M-c70');
    expect(a.expiresMin).toBeGreaterThanOrEqual(59);
    expect(a.expiresMin).toBeLessThanOrEqual(60);
  });
});
