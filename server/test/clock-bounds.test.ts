import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { makeTestApp, withAdmin, type Browser, type TestApp } from './helpers.ts';
import { requestApproval } from '../src/approvals/service.ts';
import { tx } from '../src/db.ts';
import { FAILURE_TAXONOMY_VERSION } from '../../shared/contracts/src/index.ts';

// Improvement cycle 54 (H11): every window bound is the DATABASE clock (SQL now()), never the application clock. Each test skews the
// application clock one hour into the past for the duration of the request; rows are written with the database clock (`now()`), so a
// route that bounds a window with `new Date()` puts a row written a moment ago AFTER the window's end and misses it.
let t: TestApp;
let A: Browser;
const q = (sql: string, p: unknown[] = []) => t.pool.query(sql, p);
let seq = 0;
const SKEW = 3_600_000;
async function skewed<T>(fn: () => Promise<T>): Promise<T> {
  vi.useFakeTimers({ toFake: ['Date'], now: Date.now() - SKEW });
  try { return await fn(); } finally { vi.useRealTimers(); }
}
afterEach(() => { vi.useRealTimers(); });

async function mission(id: string, owner: string) {
  await q(`insert into missions(id, tenant_id, owner_id, shared, status, demo) values ($1,'t-1',$2,true,'completed',false)`, [id, owner]);
  await q(`insert into mission_revisions(mission_id, revision, title, kind, priority, text, created_by) values ($1,1,$1,'data','normal','x',$2)`, [id, owner]);
}
const event = (m: string, type: string, payload: unknown) => q(`insert into events(tenant_id, type, mission_id, seq, subject_kind, subject_id, audience, payload, occurred_at) values ('t-1',$1,$2,$3,'mission',$2,'mission',$4, now())`, [type, m, 700000 + seq++, JSON.stringify(payload)]);

beforeAll(async () => {
  t = await makeTestApp({ staffingStepMs: 3_600_000, conversationSimMs: 3_600_000, demoSeed: false });
  const w = await withAdmin(t.app);
  A = w.admin;
  await mission('M-clock', w.adminId);
  await event('M-clock', 'mission.stateChanged', { from: 'running', to: 'completed' });
  await q(`insert into agent_instances(id, tenant_id, mission_id, agent_id, agent_version_id, simulated) select 'M-clock:coder-01','t-1','M-clock',d.id,d.active_version_id,false from agent_definitions d where d.id='coder-01'`);
  await q(`insert into tasks(id, tenant_id, mission_id, title, status, owner_agent, owner_instance_id, simulated, created_at) values ('T-clock','t-1','M-clock','T','passed','coder-01','M-clock:coder-01',false, now() - interval '1 hour')`);
  await q(`insert into task_attempts(task_id, attempt_no, started_at, finished_at, result) values ('T-clock',1, now(), now(), 'passed')`);
  await event('M-clock', 'task.stateChanged', { taskId: 'T-clock', from: 'running', to: 'passed' });
  await q(`insert into failure_tags(id, tenant_id, mission_id, subject_kind, subject_id, taxonomy_version, mode_id, tagged_by, tagged_by_kind, status, decided_by, decided_at) values ('FT-clock','t-1','M-clock','task','T-clock',$1,'FM-1.1','u1','user','confirmed','u2', now())`, [FAILURE_TAXONOMY_VERSION]);
});
afterAll(async () => { await t?.close(); });

describe('window bounds come from the database clock', () => {
  it('GET /company/scorecard counts a mission that finished a moment ago although the app clock is an hour behind', async () => {
    const r = await skewed(() => A.req('GET', '/company/scorecard?window=7d'));
    expect(r.status).toBe(200);
    expect(r.body.rows.find((x: any) => x.key === 'finished').value).toBe(1);
  });
  it('GET /company/throughput counts it in the newest week', async () => {
    const r = await skewed(() => A.req('GET', '/company/throughput?weeks=2'));
    expect(r.status).toBe(200);
    expect(r.body.weeks.reduce((s: number, w: any) => s + w.finished, 0)).toBe(1);
  });
  it('GET /departments counts a task that finished a moment ago', async () => {
    const r = await skewed(() => A.req('GET', '/departments?window=7d'));
    expect(r.status).toBe(200);
    expect((r.body.departments as any[]).reduce((s, d) => s + d.outcomes.n, 0)).toBe(1);
  });
  it('GET /company/failure-modes counts a tag created a moment ago', async () => {
    const r = await skewed(() => A.req('GET', '/company/failure-modes?window=7d'));
    expect(r.status).toBe(200);
    expect(r.body.n).toBe(1);
  });
  it('GET /company/dimensions reports the database clock as the window end', async () => {
    const r = await skewed(() => A.req('GET', '/company/dimensions?window=7d'));
    expect(r.status).toBe(200);
    const now = Date.now(); // restored real clock
    expect(Math.abs(new Date(r.body.to).getTime() - now)).toBeLessThan(60_000);
  });
  it('every window answer reports its end as the database clock (not the app clock), one transaction instant', async () => {
    for (const url of ['/company/scorecard?window=7d', '/departments?window=7d', '/company/failure-modes?window=7d']) {
      const r = await skewed(() => A.req('GET', url));
      expect(Math.abs(new Date(r.body.to).getTime() - Date.now()), url).toBeLessThan(60_000);
    }
  });
  it('requestApproval stores createdAt and expiresAt from the database clock, exactly (millisecond truncation of the transaction now())', async () => {
    const got = await skewed(() => tx(t.app.db, async (c) => {
      const r = await requestApproval(c, { tenantId: 't-1', missionId: 'M-clock', agentId: 'release-01', kind: 'submit_form', title: 'T', detail: 'd', payload: { x: 1 }, expiresInMin: 60, createdAgoMin: 10 } as any);
      return (await c.query(`select id, created_at = date_trunc('milliseconds', now()) - interval '10 minutes' as created_ok, expires_at = date_trunc('milliseconds', now()) + interval '60 minutes' as exp_ok from approval_requests where id=$1`, [r.id])).rows[0];
    }));
    expect(got).toMatchObject({ created_ok: true, exp_ok: true });
  });
});

describe('independence() owner history', () => {
  it('a history without `current` refuses (fails closed), it is not read as current', async () => {
    const { independence } = await import('../src/tasks/reviews.ts');
    const who = { id: 'u1', kind: 'user' as const, name: 'U', modelFamily: null };
    const prod = { id: 'coder-01', kind: 'agent' as const, name: 'C', modelFamily: 'fam-a' };
    expect(independence(who, prod, 'owner-x', { rows: 1, actors: new Set<string>() } as any)).not.toBeNull();
    expect(independence(who, prod, 'owner-x', { rows: 1, current: true, actors: new Set<string>() })).toBeNull();
  });
});
