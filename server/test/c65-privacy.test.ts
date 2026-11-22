import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeTestApp, withAdmin, type TestApp } from './helpers.ts';
import { ROUTES } from './contracts/registry.ts';
import { registeredRoutes } from './contracts/inventory.ts';
import { addAgent, decided, addApproval, type Fx } from './c65-fixtures.ts';

let t: TestApp; let f: Fx; let A: Awaited<ReturnType<typeof withAdmin>>; let M: { b: any; id: string };
const HOUR = 3_600_000;
beforeEach(async () => {
  t = await makeTestApp({ staffingStepMs: 60_000 });
  A = await withAdmin(t.app);
  M = await A.member('Mina');
  f = { pool: t.pool, mission: (await A.admin.req('POST', '/missions', { text: 'Send it.', files: [], shared: true }, { 'idempotency-key': 'c65p' + Date.now() })).body.mission.id as string };
  await addAgent(f, 'c65-ops-1', 'Operations');
});
afterEach(async () => { await t.close(); });
const seed = async (people: string[], n: number, prefix = 'P') => { for (let i = 0; i < n; i++) await decided(f, prefix + i, 'c65-ops-1', 5 * HOUR, (i + 1) * 60_000, people[i % people.length]); };
const body = async (who: any, q = '') => (await who.req('GET', '/review-capacity' + q));

describe('c65 item 5: privacy', () => {
  it('per-person rows: administrators get them, a member gets 403 FORBIDDEN, and nobody signed out gets in', async () => {
    await seed([A.adminId, M.id, 'u-third'], 6);
    const ok = await A.admin.req('GET', '/review-capacity/people');
    expect(ok.status).toBe(200);
    expect(ok.body.people.map((p: any) => p.userId).sort()).toEqual([A.adminId, M.id, 'u-third'].sort());
    expect(ok.body.people.every((p: any) => p.p50Ms === null && p.p95Ms === null)).toBe(true); // 2 decisions each: below the 20 floor for percentiles
    const no = await M.b.req('GET', '/review-capacity/people');
    expect(no.status).toBe(403); expect(no.body.error?.code ?? no.body.code).toBe('FORBIDDEN');
    expect(JSON.stringify(no.body)).not.toContain(A.adminId);
    const anon = await (await import('./helpers.ts')).Browser.prototype.req.call(new (await import('./helpers.ts')).Browser(t.app), 'GET', '/review-capacity/people');
    expect(anon.status).toBe(401);
  });
  it('a member never sees a person: no id, no name, no per-person field anywhere in the aggregate body', async () => {
    await seed([A.adminId, M.id, 'u-third'], 9);
    const r = await body(M.b);
    expect(r.status).toBe(200);
    const text = JSON.stringify(r.body);
    expect(text).not.toContain(A.adminId); expect(text).not.toContain(M.id); expect(text).not.toContain('u-third'); expect(text).not.toContain('Luca'); expect(text).not.toContain('Mina');
    expect(text).not.toMatch(/userId|decidedBy|"people":\[|approvers/);
    expect(r.body.review.total.people).toBe(3); // the count of distinct people is a number, never a list
  });
  it('c58 floor for a member: at least 5 items AND at least 3 distinct people, else the numbers are hidden (n stays visible)', async () => {
    await seed([A.adminId, M.id, 'u-third'], 4, 'F'); // 4 items, 3 people
    let c = (await body(M.b)).body.review.total;
    expect(c.shown).toBe(false); expect(c.n).toBe(4); expect(c.arrivalPerDay).toBeNull(); expect(c.openBacklog).toBeNull();
    await seed([A.adminId, M.id], 3, 'G'); // 7 items, still 3 people -> shown
    c = (await body(M.b)).body.review.total; expect(c.shown).toBe(true); expect(c.arrivalPerDay).toBeCloseTo(7 / 30, 9);
  });
  it('five items from only two people stay hidden for a member and visible for an administrator', async () => {
    await seed([A.adminId, M.id], 8, 'H');
    expect((await body(M.b)).body.review.total.shown).toBe(false);
    const adm = (await body(A.admin)).body.review.total; expect(adm.shown).toBe(true); expect(adm.arrivalPerDay).not.toBeNull();
  });
  it('a department cell hides on its own when it is under the floor, even if the total is shown', async () => {
    await addAgent(f, 'c65-fin-1', 'Finance');
    await seed([A.adminId, M.id, 'u-third'], 9, 'T');
    await decided(f, 'FIN0', 'c65-fin-1', 3 * HOUR, 60_000, A.adminId);
    const r = (await body(M.b)).body.review;
    expect(r.total.shown).toBe(true);
    expect(r.departments.find((d: any) => d.dept === 'Finance').shown).toBe(false);
    expect(r.departments.find((d: any) => d.dept === 'Operations').shown).toBe(true);
  });
  it('windows are fixed at 7, 30 and 90 days; anything else, and any sort or filter parameter, is refused (nothing to rank or difference with)', async () => {
    for (const w of [7, 30, 90]) expect((await body(M.b, `?windowDays=${w}`)).body.review.windowDays).toBe(w);
    for (const q of ['?windowDays=1', '?windowDays=14', '?windowDays=abc', '?sort=p95', '?sort=person', '?order=desc', '?userId=' + A.adminId, '?by=person'])
      expect((await body(M.b, q)).status, q).toBe(400);
    expect((await A.admin.req('GET', '/review-capacity/people?sort=n')).status).toBe(400);
  });
  it('admin people rows come in a fixed alphabetical order, not by load', async () => {
    await seed([M.id], 10, 'Z'); await seed([A.adminId], 2, 'Y');
    const names = (await A.admin.req('GET', '/review-capacity/people')).body.people.map((p: any) => p.name);
    expect(names).toEqual([...names].sort((a: string, b: string) => a.localeCompare(b)));
  });
  it('CONTRACT: no per-person route exists for non-admins: every /review-capacity route is the aggregate, or is marked admin in the registry', async () => {
    const routes = registeredRoutes(t.app.routeTable).filter((r) => r.includes('review-capacity'));
    expect(routes.sort()).toEqual(['GET /review-capacity', 'GET /review-capacity/people']);
    expect(Object.keys(ROUTES).filter((k) => k.includes('review-capacity') && !k.endsWith('/review-capacity')).every((k) => (ROUTES[k] as any).admin === true)).toBe(true);
    for (const r of routes) expect(r).not.toMatch(/:id|:user|rank|leaderboard|sort/i);
    // every non-GET method is absent (read model only)
    expect(registeredRoutes(t.app.routeTable).filter((r) => /review-capacity/.test(r) && !r.startsWith('GET '))).toEqual([]);
    // and the member really cannot reach the person route through a path trick
    for (const p of ['/review-capacity/people/', '/review-capacity/people?windowDays=7', '/review-capacity//people']) expect([403, 404], p).toContain((await M.b.req('GET', p)).status);
  });
});
