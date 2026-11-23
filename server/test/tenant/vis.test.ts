import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
vi.mock('../../src/agents/seed.ts', async (orig) => { const real = await orig<typeof import('../../src/agents/seed.ts')>(); const m = await import('./seedmock.ts'); return { ...real, seedCompany: (c: any, t: string) => (t === 't-1' ? real.seedCompany(c, t) : m.seedPrefixedCompany(c, t)) }; });
import { ROUTES } from '../contracts/registry.ts';
import { buildVisWorld, type VisWorld } from './vis-fixture.ts';
import { sweepGets, idGets, idWrites, type Run, type VViolation } from './vis.ts';
import { classify, VISIBILITY_ALLOWED, VISIBILITY_FINDINGS } from './vis-tables.ts';
import { GET_EXCEPTIONS } from './isolation.ts';

/**
 * Improvement cycle 87: visibility inside ONE tenant. A member M against the PRIVATE mission of another member O. See vis.ts for the relations
 * (V1 invariance across the states a, b1, b2; V2 marker absence incl. the SSE stream; ID private id = nonexistent id) and vis-tables.ts for the two reviewed tables.
 */
let v: VisWorld; let run: Run; let ids: Awaited<ReturnType<typeof idGets>>; let idw: Awaited<ReturnType<typeof idWrites>>;
beforeAll(async () => { v = await buildVisWorld(); run = await sweepGets(v); ids = await idGets(v); idw = await idWrites(v); }, 300000);
afterAll(async () => { await v?.w.close(); });
const all = (): VViolation[] => [...run.violations, ...ids.violations, ...idw.violations];
const show = (vs: VViolation[]) => vs.slice(0, 12).map((x) => `${x.relation} | ${x.route} | ${x.who} | ${x.paths?.join(',') ?? ''} | ${x.detail.slice(0, 220)}`).join('\n');

describe('visibility sweep: M against the private mission of O', () => {
  it('route inventory: every GET route is swept, excepted with a reason, or an administrator-only route M is refused', () => {
    const table = [...new Set(v.t.app.routeTable.filter((r) => r.method === 'GET').map((r) => 'GET ' + r.url.replace(/^\/api\/v1/, '')))].sort();
    const swept = new Set(run.cases.map((c) => c.key));
    const missing = table.filter((k) => !swept.has(k) && !(k in GET_EXCEPTIONS));
    expect(missing, 'GET routes neither swept nor excepted').toEqual([]);
    const adminOnly = table.filter((k) => { const e = ROUTES[k]; return e && 'v' in e && e.admin; });
    console.log(`GET routes ${table.length}: swept ${swept.size} (${run.cases.length} cases with query variants; each as member, administrator and O, at 4 states); SSE stream ${'GET /events/stream' in GET_EXCEPTIONS ? 'checked by its own relation' : 'swept'}; administrator-only (the member gets 403, still compared) ${adminOnly.length}; ID relation: ${ids.tried.length} GET cases, ${idw.tried.length} write routes`);
  });
  it('the fixture is real: the markers are in the data O, the administrator and the streams read (non-vacuity of V2)', () => {
    expect(v.markers.size).toBeGreaterThan(25);
    expect(run.stats.sseAdminWithMarker, 'private events reach the administrator\'s stream').toBeGreaterThan(0);
    expect(run.stats.sseOwnerWithMarker, 'private events reach the owner\'s stream').toBeGreaterThan(0);
    expect(run.ownerSees.size, 'routes whose response carries a private marker for O').toBeGreaterThanOrEqual(4);
  });
  it('non-vacuity of V1: the administrator\'s responses really differ between the states, on every route that serves the private mission', () => {
    const changed = [...run.adminChanged.keys()].sort();
    const unchanged = [...new Set(run.cases.map((c) => c.key))].filter((k) => !run.adminChanged.has(k)).sort();
    console.log(`administrator's response changed between states on ${changed.length} routes: ${changed.join(', ')}\nunchanged (the fixture does not reach them, or the route is not about missions): ${unchanged.join(', ')}`);
    for (const k of ['GET /missions', 'GET /approvals', 'GET /attention', 'GET /notifications', 'GET /agent-instances', 'GET /company/scorecard', 'GET /departments', 'GET /review-capacity', 'GET /approvals/quality', 'GET /agents/:id/skills/compare', 'GET /site-grants']) expect(changed, k).toContain(k);
    expect(ids.adminServes.length, 'private-id routes the administrator is served').toBeGreaterThanOrEqual(12);
    expect(ids.adminSame, 'a private-id route where the administrator cannot tell a private id from a ghost id: the ID relation is vacuous there').toEqual([]);
  });
  it('every violation is BY-DESIGN (VISIBILITY_ALLOWED), a FINDING (VISIBILITY_FINDINGS), and no table entry is stale', () => {
    const c = classify(all());
    console.log(`violations ${all().length}: by design ${c.byDesign.length}, findings ${c.findings.length}, unexplained ${c.unexplained.length}\n${show(c.byDesign)}\n${show(c.findings)}`);
    expect(show(c.unexplained), 'a route in neither table').toBe('');
    expect(VISIBILITY_ALLOWED.filter((_, i) => !c.usedAllowed.has(i)).map((a) => a.route), 'stale VISIBILITY_ALLOWED entries (the difference is gone: remove them)').toEqual([]);
    expect(VISIBILITY_FINDINGS.filter((_, i) => !c.usedFindings.has(i)).map((f) => f.route), 'stale VISIBILITY_FINDINGS entries (the leak is fixed: remove them)').toEqual([]);
    for (const f of VISIBILITY_FINDINGS) { expect(f.backlog).toMatch(/^(TBD|[A-Z]+\d+[a-z]?)$/); expect(f.leaks.length).toBeGreaterThan(40); expect(f.fix.length).toBeGreaterThan(20); }
    for (const a of VISIBILITY_ALLOWED) { expect(a.citation).toMatch(/\.md:\d+|\.ts:\d+/); expect(a.reason.length).toBeGreaterThan(40); }
  });
  it('markers: nothing of the private mission appears in anything M receives (GET in every state, SSE, private ids), without exception', () => {
    expect(show(all().filter((x) => ['V2', 'SSE'].includes(x.relation) || /marker/.test(x.detail)))).toBe('');
  });
});
