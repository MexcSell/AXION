import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
vi.mock('../../src/agents/seed.ts', async (orig) => { const real = await orig<typeof import('../../src/agents/seed.ts')>(); const m = await import('./seedmock.ts'); return { ...real, seedCompany: (c: any, t: string) => (t === 't-1' ? real.seedCompany(c, t) : m.seedPrefixedCompany(c, t)) }; });
import { buildVisWorld, type VisWorld } from './vis-fixture.ts';
import { sweepGets, idGets, idWrites, type VViolation } from './vis.ts';
import { SEAMS } from './seam.ts';
import { attachVisSeams, LEAK, VIS_MUTANTS } from './vis-mutants.ts';
import { classify, VISIBILITY_ALLOWED, VISIBILITY_FINDINGS } from './vis-tables.ts';

/** Improvement cycle 87, item 6: seeded visibility leaks. Each runs the whole sweep in a fresh world and must produce an UNEXPLAINED violation (not excused by either table) on the intended route. */
let v: VisWorld;
beforeEach(async () => { v = await buildVisWorld(attachVisSeams); }, 120000);
afterEach(async () => { LEAK.on = false; LEAK.applied = 0; await v?.w.close(); });
const results: { id: string; killed: boolean; applied: number; first: string }[] = [];
describe('seeded visibility leaks', () => {
  for (const m of VIS_MUTANTS) {
    it(`${m.id} ${m.kind}: ${m.what}`, async () => {
      const seam = SEAMS.get(v.t.app)!; seam.applied = 0;
      // the nested leak copies the private mission's text; the text exists once the private mission does (stage b1)
      const armLeak = async () => { LEAK.text = 'Secret launch plan ' + [...v.markers].find(([, f]) => f === 'mission.text')![0]; LEAK.on = true; };
      const run = await sweepGets(v, { arm: async (s) => { if (s === 'a' && m.sql) seam.fn = m.sql; if (s === 'b1' && m.leak) await armLeak(); } });
      const vs: VViolation[] = [...run.violations];
      vs.push(...(await idGets(v)).violations, ...(await idWrites(v)).violations);
      seam.fn = null; LEAK.on = false;
      const c = classify(vs);
      const hits = c.unexplained.map((x) => `${x.relation} ${x.route}`);
      const intended = hits.some((h) => m.expect.test(h));
      const applied = m.leak ? LEAK.applied : seam.applied;
      results.push({ id: m.id, killed: c.unexplained.length > 0, applied, first: hits[0] ?? '' });
      expect(applied, `${m.id}: the fault was never applied, so a kill would mean nothing`).toBeGreaterThan(0);
      expect(VISIBILITY_ALLOWED.concat(VISIBILITY_FINDINGS as any).some((t) => m.expect.test(`${(t as any).relation} ${t.route}`)), `${m.id}: its intended route is excused by a table, so the table would hide the mutant`).toBe(false);
      expect(intended, `${m.id} SURVIVED or was caught by another check; unexplained: ${[...new Set(hits)].slice(0, 6).join(' | ') || 'none'}`).toBe(true);
    }, 240000);
  }
  it('kill rate', () => {
    console.log('VIS MUTANTS ' + JSON.stringify(results) + `\nKILLED ${results.filter((r) => r.killed).length}/${VIS_MUTANTS.length}`);
    expect(results.filter((r) => r.killed).length).toBe(VIS_MUTANTS.length);
  });
});
