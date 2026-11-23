import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
vi.mock('../../src/agents/seed.ts', async (orig) => { const real = await orig<typeof import('../../src/agents/seed.ts')>(); const m = await import('./seedmock.ts'); return { ...real, seedCompany: (c: any, t: string) => (t === 't-1' ? real.seedCompany(c, t) : m.seedPrefixedCompany(c, t)) }; });
import { tx } from '../../src/db.ts';
import { createNotification } from '../../src/notifications/routes.ts';
import { buildWorld, seedTenant, type World } from './fixture.ts';
import { freshSessions } from './isolation.ts';

/** Improvement cycle 81 (T1 items 2 and 3 of the c79 review): two tenants in one schema, as in c79. */
let w: World;
beforeAll(async () => { w = await buildWorld(); await seedTenant(w, w.A); await seedTenant(w, w.B); }, 120000);
afterAll(async () => { await w?.close(); });

describe('T1(2): GET /operations/health never returns a figure that counts another tenant\'s data', () => {
  it('with two tenants, no administrator gets db.sizeBytes, and tenant B\'s whole answer does not change when tenant A grows a lot', async () => {
    const A = await freshSessions(w.A), B = await freshSessions(w.B);
    const strip = (b: any) => JSON.stringify({ db: b.db, events: b.events });
    const before = await B.admin.req('GET', '/operations/health');
    expect(before.status).toBe(200);
    expect(before.body.db, 'db block present').toMatchObject({ status: 'up' });
    expect(before.body.db.sizeBytes, 'tenant B must not see a database-wide size').toBeUndefined();
    expect((await A.admin.req('GET', '/operations/health')).body.db.sizeBytes, 'nor tenant A').toBeUndefined();
    // tenant A grows by several megabytes of its own rows
    await w.pool.query(`create table if not exists c81_ballast(t text)`);
    await w.pool.query(`insert into c81_ballast select repeat(md5(g::text), 2000) from generate_series(1, 400) g`);
    for (let i = 0; i < 3; i++) await tx(w.A.app.db, (c) => createNotification(c, { tenantId: 't-1', severity: 'info', category: 'system', title: 'Grow ' + i, body: 'x'.repeat(5000) }));
    const after = await B.admin.req('GET', '/operations/health');
    expect(strip(after.body)).toBe(strip(before.body));
    expect(JSON.stringify(after.body)).not.toMatch(/sizeBytes/);
    await w.pool.query('drop table c81_ballast');
  });
});

describe('T1(3): acknowledging a notification needs a notification the caller can see', () => {
  const reads = async (ids: string[]) => (await w.pool.query('select tenant_id, user_id, notice_id from notification_reads where notice_id = any($1::text[]) order by 1,2,3', [ids])).rows;
  it('POST /notifications/:id/ack: a foreign id is 404 and stores nothing; a nonexistent id is 404 and stores nothing', async () => {
    const A = await freshSessions(w.A);
    for (const id of [w.B.ids.notification, 'n-99999999', 'zz-nothing']) {
      const r = await A.admin.req('POST', `/notifications/${id}/ack`);
      expect(r.status, id).toBe(404);
      expect(JSON.stringify(r.body)).not.toContain('ZQBRAVO');
    }
    expect(await reads([w.B.ids.notification, 'n-99999999', 'zz-nothing'])).toEqual([]);
  });
  it('a malformed id is still 400, and the caller\'s own notification can be acknowledged twice (idempotent)', async () => {
    const A = await freshSessions(w.A);
    expect((await A.admin.req('POST', '/notifications/bad id!/ack')).status).toBe(400);
    expect((await A.admin.req('POST', `/notifications/${w.A.ids.notification}/ack`)).status).toBe(200);
    expect((await A.admin.req('POST', `/notifications/${w.A.ids.notification}/ack`)).status).toBe(200);
    const rows = await reads([w.A.ids.notification]);
    expect(rows.filter((x) => x.user_id === w.A.ids.adminId)).toHaveLength(1);
  });
  it('a notification the caller may not see (an admins-only notice, asked by a member) is 404 for that member', async () => {
    const A = await freshSessions(w.A);
    const id = await tx(w.A.app.db, (c) => createNotification(c, { tenantId: 't-1', severity: 'info', category: 'system', title: 'Admins only', body: 'secret', adminsOnly: true }));
    const r = await A.member.req('POST', `/notifications/${id}/ack`);
    expect(r.status).toBe(404);
    expect((await reads([id]))).toEqual([]);
    expect((await A.admin.req('POST', `/notifications/${id}/ack`)).status).toBe(200);
  });
  it('POST /notifications/ack-all marks only the notifications visible to the caller', async () => {
    const A = await freshSessions(w.A);
    const adminsOnly = await tx(w.A.app.db, (c) => createNotification(c, { tenantId: 't-1', severity: 'info', category: 'system', title: 'Admins only 2', body: 'secret', adminsOnly: true }));
    const ids = [w.A.ids.notification, w.B.ids.notification, adminsOnly, 'n-99999998'];
    const r = await A.member.req('POST', '/notifications/ack-all', { ids });
    expect(r.status).toBe(200);
    const mine = (await reads(ids)).filter((x) => x.user_id === w.A.ids.memberId).map((x) => x.notice_id);
    expect(mine).toEqual([w.A.ids.notification]);
    expect((await reads([w.B.ids.notification, 'n-99999998'])), 'no orphan marker for a foreign or nonexistent id').toEqual([]);
    expect((await A.member.req('POST', '/notifications/ack-all', { ids })).status).toBe(200); // idempotent
    expect((await reads([w.A.ids.notification])).filter((x) => x.user_id === w.A.ids.memberId)).toHaveLength(1);
  });
});
