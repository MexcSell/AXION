import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeTestApp, withAdmin, Browser, type TestApp } from './helpers.ts';

// Improvement cycle 12: GET /company/throughput and the previous-period fields of /company/scorecard (route privacy).
let t: TestApp;
let A: Browser, M: Browser, K: Browser;
let adminId = '', minaId = '', kenjiId = '';
let seq = 0;
const q = (sql: string, p: unknown[] = []) => t.pool.query(sql, p);

async function finished(id: string, owner: string, daysAgo: number, o: { shared?: boolean; demo?: boolean; tenant?: string; to?: string } = {}) {
  await q(`insert into missions(id, tenant_id, owner_id, shared, status, demo) values ($1,$2,$3,$4,'running',$5)`, [id, o.tenant ?? 't-1', owner, o.shared ?? false, o.demo ?? false]);
  await q(`insert into mission_revisions(mission_id, revision, title, kind, priority, text, created_by) values ($1,1,$1,'data','normal','x',$2)`, [id, owner]);
  await q(`insert into mission_runs(mission_id, revision, status, started_at) values ($1,1,'running', now() - $2 * interval '1 day' - interval '1 hour')`, [id, daysAgo]);
  await q(`insert into events(tenant_id, type, mission_id, seq, subject_kind, subject_id, audience, payload, occurred_at)
           values ($1,'mission.stateChanged',$2,$3,'mission',$2,'mission',$4, now() - $5 * interval '1 day')`,
  [o.tenant ?? 't-1', id, ++seq, JSON.stringify({ from: 'running', to: o.to ?? 'canceled', action: 'x', by: 'system' }), daysAgo]);
}
const tp = async (b: Browser, qs = '') => { const r = await b.req('GET', '/company/throughput' + qs); expect(r.status).toBe(200); return r.body; };
const total = (b: any, k: 'started' | 'finished') => b.weeks.reduce((s: number, w: any) => s + w[k], 0);

beforeAll(async () => {
  t = await makeTestApp({ staffingStepMs: 3_600_000, conversationSimMs: 3_600_000 });
  const w = await withAdmin(t.app);
  A = w.admin; adminId = w.adminId;
  const m = await w.member('Mina'); M = m.b; minaId = m.id;
  const k = await w.member('Kenji'); K = k.b; kenjiId = k.id;
});
afterAll(async () => { await t?.close(); });

describe('throughput route', () => {
  it('anonymous is 401; bad weeks or includeDemo is 400', async () => {
    expect((await new Browser(t.app).req('GET', '/company/throughput')).status).toBe(401);
    for (const qs of ['?weeks=0', '?weeks=27', '?weeks=x', '?weeks=1.5', '?includeDemo=yes']) expect((await A.req('GET', '/company/throughput' + qs)).status).toBe(400);
  });
  it('a fresh database: 8 weeks of zeros, and the scorecard shows no trend on any row', async () => {
    const b = await tp(M);
    expect(b.weeks).toHaveLength(8);
    expect(total(b, 'started') + total(b, 'finished')).toBe(0);
    const sc = (await M.req('GET', '/company/scorecard')).body;
    expect(sc.rows.every((r: any) => r.trend === null)).toBe(true);
  });
  it('counts per week with the same visibility, DEMO and tenant rules as the scorecard', async () => {
    await finished('T-1', minaId, 1);                                  // Mina private, this week
    await finished('T-2', minaId, 9);                                  // Mina private, last week
    await finished('T-3', kenjiId, 2, { shared: true });               // Kenji shared, this week
    await finished('T-4', kenjiId, 3);                                 // Kenji private
    await finished('T-5', adminId, 2, { demo: true, shared: true });   // DEMO
    await q(`insert into tenants(id,name) values ('t-2','Other')`);
    await q(`insert into users(id,tenant_id,name,name_key,pass_hash,role,status) values ('u-x','t-2','X','x','h','admin','approved')`);
    await finished('T-6', 'u-x', 2, { shared: true, tenant: 't-2' });  // other tenant
    await finished('T-7', minaId, 2); await q(`update missions set deleted_at=now() where id='T-7'`);
    await finished('T-8', minaId, 400);                                // older than 8 weeks
    const mina = await tp(M);
    expect([total(mina, 'started'), total(mina, 'finished')]).toEqual([3, 3]); // T-1, T-2, T-3
    expect(mina.weeks[7]).toMatchObject({ started: 2, finished: 2 }); expect(mina.weeks[6]).toMatchObject({ started: 1, finished: 1 });
    const kenji = await tp(K);
    expect([total(kenji, 'started'), total(kenji, 'finished')]).toEqual([2, 2]); // T-3, T-4 (not Mina's private ones)
    const admin = await tp(A);
    expect(total(admin, 'started')).toBe(4); // T-1..T-4, no DEMO, no other tenant, no deleted
    expect(total(await tp(A, '?includeDemo=1'), 'started')).toBe(5);
    expect(total(await tp(M, '?weeks=26'), 'started')).toBe(3);
    expect((await tp(M, '?weeks=3')).weeks).toHaveLength(3);
  });
  it('the scorecard rows carry previous {value, n} and a trend that stays null below 3 samples', async () => {
    const sc = (await M.req('GET', '/company/scorecard?window=7d')).body;
    const fin = sc.rows.find((r: any) => r.key === 'finished');
    expect(fin).toMatchObject({ value: 2, previous: { n: 1 }, trend: null });
    // previous window never leaks private missions either: Kenji's T-4 (3 days ago) is not in Mina's counts
    const kenji = (await K.req('GET', '/company/scorecard?window=7d')).body.rows.find((r: any) => r.key === 'finished');
    expect(kenji).toMatchObject({ value: 2, previous: { n: 0 } });
  });
  it('a trend appears when both periods have 3 or more finished missions', async () => {
    for (let i = 0; i < 4; i++) await finished('P-' + i, minaId, 10 + i);  // previous 7d window (days 7-14)
    const fin = (await M.req('GET', '/company/scorecard?window=7d')).body.rows.find((r: any) => r.key === 'finished');
    expect(fin.previous.n).toBe(5);
    expect(fin.n).toBe(2);
    expect(fin.trend).toBeNull(); // current window still has only 2
    await finished('C-1', minaId, 1);
    const f2 = (await M.req('GET', '/company/scorecard?window=7d')).body.rows.find((r: any) => r.key === 'finished');
    expect(f2).toMatchObject({ value: 3, previous: { value: 5, n: 5 }, trend: 'down' });
  });
});
