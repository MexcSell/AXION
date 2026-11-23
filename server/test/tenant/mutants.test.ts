import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
vi.mock('../../src/agents/seed.ts', async (orig) => { const real = await orig<typeof import('../../src/agents/seed.ts')>(); const m = await import('./seedmock.ts'); return { ...real, seedCompany: (c: any, t: string) => (t === 't-1' ? real.seedCompany(c, t) : m.seedPrefixedCompany(c, t)) }; });
import { buildWorld, seedTenant, type World } from './fixture.ts';
import { attachSeams, SEAMS, sharedCache } from './seam.ts';
import { swapTenant } from './swap.ts';
import { detect, DetectorInvalid, type Violation } from './isolation.ts';
import { foreignWrites } from './writes.ts';
import { MUTANTS } from './mutants.ts';

let w: World;
// a fresh pair of tenants per mutant: a mutant that lets a write through must not damage the next one
beforeEach(async () => { w = await buildWorld({ configureA: attachSeams, configureB: attachSeams }); await seedTenant(w, w.A); await seedTenant(w, w.B); }, 120000);
afterEach(async () => { await w?.close(); });

const results: { id: string; kind: string; killed: boolean; byIntended: boolean; applied: number; first: string; n: number }[] = [];
describe('seeded-leak mutants', () => {
  let round = 100;
  for (const m of MUTANTS) {
    it(`${m.id} ${m.kind}: ${m.what}`, async () => {
      const faulty = (m.on === 'A' ? w.A : w.B), view = m.viewer === 'A' ? w.A : w.B, other = view === w.A ? w.B : w.A;
      const seam = SEAMS.get(faulty.app)!;
      seam.applied = 0; sharedCache.clear();
      const arm = () => { if (m.sql) seam.fn = m.sql; if (m.header) seam.fromHeader = true; if (m.cache) { SEAMS.get(w.A.app)!.cacheOn = true; SEAMS.get(w.B.app)!.cacheOn = true; } };
      let violations: Violation[] = []; let thrown = '';
      try {
        const d = await detect(w, view, other, ++round, { arm });
        violations = d.violations;
        if (m.expect.test('WRITE')) violations.push(...(await foreignWrites(w, view, other, arm)).violations);
        if (m.expect.test('MR2')) violations.push(...(await swapTenant(w, view, other, arm)).violations);
      } catch (e) { if (e instanceof DetectorInvalid) throw e; thrown = (e as Error).message.slice(0, 160); }
      finally { seam.fn = null; seam.fromHeader = false; for (const t of [w.A, w.B]) SEAMS.get(t.app)!.cacheOn = false; sharedCache.clear(); }
      const applied = seam.applied;
      const hits = violations.map((v) => `${v.relation} ${v.where}`);
      const byIntended = hits.some((h) => m.expect.test(h));
      const killed = violations.length > 0 || thrown !== '';
      results.push({ id: m.id, kind: m.kind, killed, byIntended, applied: m.cache ? -1 : applied, first: hits[0] ?? thrown, n: violations.length });
      expect(m.cache || applied > 0, `${m.id}: the fault was never applied, so a "kill" would mean nothing`).toBe(true);
      expect(killed, `${m.id} SURVIVED: no relation noticed the seeded leak (applied ${applied} times)`).toBe(true);
      expect(byIntended, `${m.id} was caught, but not by the intended check (${m.expect}); first: ${hits.slice(0, 3).join(' | ') || thrown}`).toBe(true);
    }, 180000);
  }
  it('kill rate', () => {
    const k = results.filter((r) => r.killed).length;
    console.log('MUTANTS ' + JSON.stringify(results, null, 1) + `\nKILLED ${k}/${MUTANTS.length}`);
    expect(k).toBe(MUTANTS.length);
  });
});
