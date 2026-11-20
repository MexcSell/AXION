import { describe, it, expect, afterEach } from 'vitest';
import { makeTestApp, withAdmin, type TestApp } from './helpers.ts';
import { seedDemo, clearDemo } from '../src/seed/demo.ts';
import { MISSIONS, FIXTURE_OWNERS } from '../../web/src/data/missions.ts';

let t: TestApp;
afterEach(async () => { await t.close(); });

describe('demo seed', () => {
  it('loads the fixture missions as demo rows owned by the first admin, keeps shared, adds approvals; clear removes only demo rows', async () => {
    t = await makeTestApp({ staffingStepMs: 60_000 });
    const A = await withAdmin(t.app);
    const mina = await A.member('Mina');
    const r = await seedDemo(t.app.db, 't-1', A.adminId);
    expect(r.missions).toBe(MISSIONS.length);
    const again = await seedDemo(t.app.db, 't-1', A.adminId);
    expect(again.missions).toBe(0); // idempotent
    const all = (await A.admin.req('GET', '/missions')).body.missions;
    expect(all).toHaveLength(MISSIONS.length);
    expect(all.every((m: any) => m.demo === true && m.ownerId === A.adminId)).toBe(true);
    const m126 = all.find((m: any) => m.id === 'M-126');
    const fx = MISSIONS.find((m) => m.id === 'M-126')!;
    expect(m126).toMatchObject({ title: fx.title, status: fx.status, progress: fx.progress, shared: FIXTURE_OWNERS['M-126']?.shared ?? false });
    const sharedIds = MISSIONS.filter((m) => FIXTURE_OWNERS[m.id]?.shared).map((m) => m.id).sort();
    expect((await mina.b.req('GET', '/missions')).body.missions.map((m: any) => m.id).sort()).toEqual(sharedIds);
    const approvals = (await A.admin.req('GET', '/approvals')).body.approvals;
    expect(approvals.length).toBe(MISSIONS.reduce((s, m) => s + m.pendingApprovals, 0));
    expect(approvals.find((a: any) => a.id === 'APR-M-128-1')).toBeTruthy();
    expect(Math.min(...approvals.map((a: any) => a.expiresMin))).toBeGreaterThan(6 * 24 * 60); // DEMO approvals don't vanish an hour after the owner signs in
    // a real mission survives clear
    await A.admin.req('POST', '/missions', { text: 'Real one', files: [], shared: false }, { 'idempotency-key': 'real-1' });
    await clearDemo(t.app.db, 't-1');
    const left = (await A.admin.req('GET', '/missions')).body.missions;
    expect(left).toHaveLength(1);
    expect((await A.admin.req('GET', '/approvals')).body.approvals).toEqual([]);
  });

  it('runs automatically when the first admin registers (DEMO_SEED)', async () => {
    t = await makeTestApp({ staffingStepMs: 60_000, demoSeed: true });
    const A = await withAdmin(t.app);
    const t0 = Date.now();
    let n = 0;
    while (Date.now() - t0 < 3000) { n = (await A.admin.req('GET', '/missions')).body.missions.length; if (n) break; await new Promise((r) => setTimeout(r, 50)); }
    expect(n).toBe(MISSIONS.length);
  });
});

describe('demo clear after a decision', () => {
  it('removes demo missions even when one of their approvals was decided (append-only decisions cascade)', async () => {
    t = await makeTestApp({ staffingStepMs: 60_000 });
    const A = await withAdmin(t.app);
    await seedDemo(t.app.db, 't-1', A.adminId);
    const ap = (await A.admin.req('GET', '/approvals')).body.approvals[0];
    expect((await A.admin.req('POST', `/approvals/${ap.id}/decision`, { decision: 'approved', digest: ap.digest })).status).toBe(200);
    const r = await clearDemo(t.app.db, 't-1');
    expect(r.missions).toBe(MISSIONS.length);
    expect((await t.pool.query('select count(*)::int n from approval_decisions')).rows[0].n).toBe(0);
    await expect(t.pool.query('delete from approval_decisions')).resolves.toBeTruthy(); // nothing left to delete
  });
});
