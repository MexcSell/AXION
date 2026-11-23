import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
vi.mock('../../src/agents/seed.ts', async (orig) => { const real = await orig<typeof import('../../src/agents/seed.ts')>(); const m = await import('./seedmock.ts'); return { ...real, seedCompany: (c: any, t: string) => (t === 't-1' ? real.seedCompany(c, t) : m.seedPrefixedCompany(c, t)) }; });
import { ROUTES } from '../contracts/registry.ts';
import { buildWorld, seedTenant, type World } from './fixture.ts';
import { detect, getCases, snapshot, foreignGets, AT_REST_COVERAGE, GET_EXCEPTIONS, GLOBAL_ROUTES, ALLOWED_STATUS, freshSessions, type Violation } from './isolation.ts';
import { foreignWrites, writeRoutesWithIds, WRITE_CASES, WRITE_EXCEPTIONS, SELF_SCOPED_OK } from './writes.ts';

/**
 * Improvement cycle 79 (R4-4): tenant isolation on the real code. Two tenants in one schema (t-1 = A, t-b = B), the same features used in both,
 * a unique marker in every free-text field. The relations (MR1 invariance, MR3 marker absence, W write refusal) are this cycle's own
 * construction. Run in both directions, so each tenant is the viewer once. The mutants that prove these tests can fail are in mutants.test.ts.
 */
let w: World;
beforeAll(async () => { w = await buildWorld(); await seedTenant(w, w.A); await seedTenant(w, w.B); }, 120000);
afterAll(async () => { await w?.close(); });
const show = (v: Violation[]) => v.slice(0, 12).map((x) => `${x.relation} | ${x.where} | ${x.detail}`).join('\n');
const key = (m: string, u: string) => `${m} ${u.replace(/^\/api\/v1/, '')}`;

describe('route inventory for the isolation relations', () => {
  it('every GET route is covered by a generated case or is a listed exception; every exception names a real route', () => {
    const table = [...new Set(w.A.app.routeTable.filter((r) => r.method === 'GET').map((r) => key('GET', r.url)))].sort();
    const { cases, skipped } = getCases(w.A);
    const covered = new Set(cases.map((c) => c.key));
    expect(skipped, 'GET routes with no id source in the fixture').toEqual([]);
    expect(table.filter((k) => !covered.has(k) && !(k in GET_EXCEPTIONS)), 'GET routes neither covered nor excepted').toEqual([]);
    for (const k of [...Object.keys(GET_EXCEPTIONS), ...Object.keys(GLOBAL_ROUTES)]) expect(table, `${k} is not a registered route`).toContain(k);
    for (const [k, why] of Object.entries({ ...GET_EXCEPTIONS, ...GLOBAL_ROUTES })) expect(why.length, `${k}: the reason is too short`).toBeGreaterThan(40);
    console.log(`GET routes ${table.length}: covered ${covered.size}, excepted from the byte comparison ${Object.keys(GET_EXCEPTIONS).length}, global (still run through every relation) ${Object.keys(GLOBAL_ROUTES).length}; cases with query variants ${cases.length}`);
  });
  it('every write route with an id has a foreign-id case or a listed exception; nothing stale', () => {
    const rs = writeRoutesWithIds(w.A);
    expect(rs.filter((k) => !(k in WRITE_CASES) && !(k in WRITE_EXCEPTIONS)), 'write routes with an id and no case').toEqual([]);
    for (const k of [...Object.keys(WRITE_CASES), ...Object.keys(WRITE_EXCEPTIONS)]) expect(rs, `${k} is not a registered write route with an id`).toContain(k);
    for (const [k, why] of Object.entries(WRITE_EXCEPTIONS)) expect(why.length, `${k}: the reason is too short`).toBeGreaterThan(40);
    for (const k of Object.keys(SELF_SCOPED_OK)) expect(WRITE_CASES).toHaveProperty(k);
    const noId = w.A.app.routeTable.filter((r) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(r.method) && !r.url.includes(':')).map((r) => key(r.method, r.url));
    console.log(`write routes with an id ${rs.length}: cases ${Object.keys(WRITE_CASES).length}, exceptions ${Object.keys(WRITE_EXCEPTIONS).length}; write routes without an id (nothing foreign to send) ${noId.length}: ${[...new Set(noId)].join(', ')}`);
  });
  it('every generated case really answers (status policy), so a bad URL cannot make a relation vacuous', async () => {
    for (const t of [w.A, w.B]) {
      const snaps = await snapshot(await freshSessions(t), getCases(t).cases);
      const odd: string[] = [];
      for (const s of snaps) {
        if (s.who === 'waiting') { if (s.status !== 202) odd.push(`waiting ${s.label} ${s.status}`); continue; }
        if (s.status === 200) continue;
        const entry = ROUTES[s.key];
        if (s.who === 'member' && s.status === 403 && entry && 'v' in entry && entry.admin) continue; // an administrator-only route refuses a member
        if (s.key === 'GET /auth/wait' && s.status === 401) continue; // a signed-in session has no waiting login (the waiting person's session is run as `waiting`)
        if (ALLOWED_STATUS.some((a) => a.match(s.key, t) && a.statuses.includes(s.status))) continue;
        odd.push(`${s.who} ${s.label} ${s.status}`);
      }
      expect(odd, `tenant ${t.tag}`).toEqual([]);
    }
  });
});

describe('MR1 invariance and MR3 marker absence (GET routes, SSE, stored rows, OTLP export, foreign ids)', () => {
  for (const [viewer, other] of [['A', 'B'], ['B', 'A']] as const) {
    it(`tenant ${viewer} never sees tenant ${other}`, async () => {
      const t0 = Date.now();
      const r = await detect(w, w[viewer], w[other], viewer === 'A' ? 1 : 2);
      console.log(`${viewer} viewing ${other}: ${JSON.stringify(r.stats)} in ${Date.now() - t0} ms; markers planted in ${other}: ${w[other].markers.size}`);
      expect(show(r.violations)).toBe('');
    }, 180000);
  }
  it('the stored-row sweep covers every table that has a tenant_id column (and names the ones that do not)', async () => {
    const c = await AT_REST_COVERAGE(w);
    console.log(`at-rest sweep: ${c.swept.length} tables with tenant_id swept; ${c.notSwept.length} without a tenant_id column not swept: ${c.notSwept.join(', ')}`);
    expect(c.swept).toEqual(expect.arrayContaining(['audit_events', 'events', 'missions', 'notifications', 'users']));
  });
  it('the markers are really in the data the relations compare (non-vacuity of MR3)', async () => {
    const fields = new Set<string>([...w.B.markers.values()].map((f) => f.split('.')[0]));
    expect(w.B.markers.size).toBeGreaterThan(60);
    // each of B's markers is stored somewhere in B's own rows, read as B sees it (own responses + own tables)
    const own = (await snapshot(await freshSessions(w.B), getCases(w.B).cases)).map((s) => s.text).join('\n').toLowerCase();
    const missing = [...w.B.markers].filter(([m]) => !own.includes(m.toLowerCase())).map(([m, f]) => `${m} (${f})`);
    console.log(`marker fields: ${[...fields].sort().join(', ')}; not visible in B's own GET responses (stored, but no GET route shows them): ${missing.length}: ${missing.join(', ')}`);
    expect(missing.length, 'most markers must be readable by their own tenant, or MR3 proves little').toBeLessThan(w.B.markers.size * 0.4);
  });
});

describe('W: a tenant acting on the other tenant\'s ids on write routes', () => {
  for (const [viewer, other] of [['A', 'B'], ['B', 'A']] as const) {
    it(`tenant ${viewer} on tenant ${other}'s ids gets 404 or 403 and changes nothing`, async () => {
      const r = await foreignWrites(w, w[viewer], w[other]);
      const attempted = r.results.filter((x) => !x.skipped);
      console.log(`${viewer} -> ${other}: ${attempted.length} attempts, statuses ${JSON.stringify(attempted.reduce((a: Record<string, number>, x) => ({ ...a, [x.status]: (a[x.status] ?? 0) + 1 }), {}))}; skipped: ${r.results.filter((x) => x.skipped).map((x) => `${x.key} (${x.skipped})`).join('; ') || 'none'}`);
      expect(attempted.length).toBeGreaterThan(55);
      expect(show(r.violations)).toBe('');
    }, 180000);
  }
});
void foreignGets;
