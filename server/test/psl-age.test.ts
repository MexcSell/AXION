// c73 (P4c): the public suffix snapshot's age is shown in System Operations health and warned about past 90 days.
// The age is the difference between the manifest's list date and the DATABASE date (never the app clock); a refresh stays a
// reviewed commit with a new manifest, there is no route that refreshes the list.
import { describe, it, expect, afterAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { makeTestApp, withAdmin, type TestApp } from './helpers.ts';
import { pslVersionDate, pslSnapshotHealth, readPslHealth, PSL_WARN_AFTER_DAYS } from '../src/grants/psl-age.ts';

const manifest = JSON.parse(readFileSync(new URL('../src/grants/public_suffix_list.manifest.json', import.meta.url), 'utf8')) as { listVersion: string };
let t: TestApp | undefined;
let admin: Awaited<ReturnType<typeof withAdmin>> | undefined; // one admin sign-in per app (a second one waits for device approval)
const adminOf = async (x: TestApp) => (admin ??= await withAdmin(x.app));
afterAll(async () => { await t?.close(); });

describe('PSL snapshot age (c73, P4c)', () => {
  it('reads the date from the manifest list version, and refuses a malformed one', () => {
    expect(pslVersionDate('2026-11-21_04-33-45_UTC')).toBe('2026-11-21');
    expect(pslVersionDate(manifest.listVersion)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    for (const bad of ['', 'latest', '2026-13-40_00-00-00_UTC', '2026-11-21', '21-11-2026_04-33-45_UTC']) expect(() => pslVersionDate(bad), bad).toThrow(/list version/i);
  });
  it('warns strictly past 90 days (90 is still fine) and never for a young or future snapshot', () => {
    expect(PSL_WARN_AFTER_DAYS).toBe(90);
    const h = (age: number) => pslSnapshotHealth({ listVersion: '2026-11-21_04-33-45_UTC', ageDays: age, rules: 10000 });
    expect(h(0).stale).toBe(false);
    expect(h(90).stale).toBe(false);
    expect(h(91).stale).toBe(true);
    expect(h(400).stale).toBe(true);
    expect(h(-3).stale).toBe(false);
    expect(h(91)).toMatchObject({ date: '2026-11-21', warnAfterDays: 90, ageDays: 91, rules: 10000, listVersion: '2026-11-21_04-33-45_UTC' });
  });
  it('computes the age in SQL from the database date, so a date N days before the database date is exactly N days old', async () => {
    t = await makeTestApp();
    for (const n of [0, 1, 90, 91, 200]) {
      const d = (await t.pool.query(`select to_char((now() at time zone 'utc')::date - $1::int, 'YYYY-MM-DD') as d`, [n])).rows[0].d as string;
      const h = await readPslHealth(t.pool, `${d}_00-00-00_UTC`);
      expect(h.ageDays, `age of ${d}`).toBe(n);
      expect(h.stale, `stale at ${n}`).toBe(n > 90);
    }
  });
  it('GET /operations/health carries the snapshot date, age and warning (admins only, no extra route to refresh it)', async () => {
    t = t ?? await makeTestApp();
    const A = await adminOf(t);
    const r = await A.admin.req('GET', '/operations/health');
    expect(r.status).toBe(200);
    const p = r.body.publicSuffix;
    expect(p.listVersion).toBe(manifest.listVersion);
    expect(p.date).toBe(pslVersionDate(manifest.listVersion));
    expect(p.warnAfterDays).toBe(90);
    expect(Number.isInteger(p.ageDays)).toBe(true);
    expect(p.stale).toBe(p.ageDays > 90);
    expect(p.rules).toBeGreaterThan(8000);
    for (const [m, u] of [['POST', '/operations/public-suffix/refresh'], ['PUT', '/operations/public-suffix'], ['POST', '/operations/public-suffix']] as const) expect((await A.admin.req(m, u, {})).status, `${m} ${u}`).toBe(404);
  });
  it('a failed read of the snapshot age leaves the health read intact (publicSuffix null, db and the rest still reported)', async () => {
    t = t ?? await makeTestApp();
    const A = await adminOf(t);
    const real = t.app.db.query.bind(t.app.db);
    const spy = vi.spyOn(t.app.db, 'query').mockImplementation(((q: unknown, ...a: unknown[]) => (typeof q === 'string' && q.includes('at time zone') ? Promise.reject(new Error('boom')) : (real as (...x: unknown[]) => unknown)(q, ...a))) as never);
    try {
      const r = await A.admin.req('GET', '/operations/health');
      expect(r.status).toBe(200);
      expect(r.body.publicSuffix).toBeNull();
      expect(r.body.db.status).toBe('up');
    } finally { spy.mockRestore(); }
  });
});
