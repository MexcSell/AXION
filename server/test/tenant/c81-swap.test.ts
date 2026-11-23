import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
vi.mock('../../src/agents/seed.ts', async (orig) => { const real = await orig<typeof import('../../src/agents/seed.ts')>(); const m = await import('./seedmock.ts'); return { ...real, seedCompany: (c: any, t: string) => (t === 't-1' ? real.seedCompany(c, t) : m.seedPrefixedCompany(c, t)) }; });
import { buildWorld, seedTenant, type World } from './fixture.ts';
import { swapTenant, swapCases, writeRoutes, SWAP_EXCEPTIONS } from './swap.ts';
import { getCases, type Violation } from './isolation.ts';

/** c81 item 6: MR2, the tenant-id swap, on the real code. Tenant A sends tenant B's id in the body, query and header. */
let w: World;
beforeAll(async () => { w = await buildWorld(); await seedTenant(w, w.A); await seedTenant(w, w.B); }, 120000);
afterAll(async () => { await w?.close(); });
const show = (v: Violation[]) => v.slice(0, 12).map((x) => `${x.relation} | ${x.where} | ${x.detail}`).join('\n');

describe('MR2 tenant-id swap', () => {
  it('every write route has a generated swap case or a listed exception, and nothing is stale', () => {
    const routes = writeRoutes(w.A), cases = swapCases();
    expect(routes.filter((k) => !(k in cases) && !(k in SWAP_EXCEPTIONS)), 'write routes with no swap case').toEqual([]);
    expect(Object.keys(cases).filter((k) => !routes.includes(k)), 'swap cases for routes that no longer exist').toEqual([]);
    expect(getCases(w.A).cases.length).toBeGreaterThanOrEqual(20);
    console.log(`MR2: ${routes.length} write routes (${Object.keys(cases).length} cases, ${Object.keys(SWAP_EXCEPTIONS).length} exceptions), ${getCases(w.A).cases.length} GET cases`);
  });
  it('tenant A with tenant B\'s id in body, query and header: the same answer as without, or 400, and B is unchanged', async () => {
    const r = await swapTenant(w, w.A, w.B);
    const writes = r.rows.filter((x) => x.kind === 'write'), gets = r.rows.filter((x) => x.kind === 'GET');
    const hist = (rs: typeof r.rows) => rs.reduce((a: Record<string, number>, x) => ({ ...a, [x.plain]: (a[x.plain] ?? 0) + 1 }), {});
    const rej = r.rows.flatMap((x) => Object.values(x.forged)).filter((s) => s === '400').length;
    console.log(`MR2: ${gets.length} GET cases x 3 forged variants, ${writes.length} write routes x 4 variants; plain statuses GET ${JSON.stringify(hist(gets))}, write ${JSON.stringify(hist(writes))}; forged requests refused with 400: ${rej}; unstable writes (compared by shape): ${writes.filter((x) => !x.stable).length}`);
    expect(writes.filter((x) => x.plain >= 200 && x.plain < 300).length, 'most write cases must really succeed plain, or the relation proves little').toBeGreaterThan(20);
    expect(show(r.violations)).toBe('');
  }, 240000);
});
