import { describe, it, expect } from 'vitest';
import { mulberry32 } from '../src/evolution/stats.ts';
import { standardise, SKILL_LEVEL_MIN_N } from '../../shared/contracts/src/index.ts';

/**
 * c72 fix round, F2: measured coverage of the adjusted-rate interval, on the independent reviewer's grid (fixed by the reviewer, not by the implementer):
 * true skill in {0.3, 3, -3, 5} with DELTA = [-1.5, -0.75, 0, 0.75, 1.5], crossed with 10 fixed designs (tasks per level), 20,000 repetitions per cell, 40 cells.
 * Truth = the mean of the true per-level pass rates over the levels the estimator USES. The gate (a level needs SKILL_LEVEL_MIN_N = 5 tasks) and the cap
 * (effective n never above the tasks used) were chosen BEFORE any measurement on this grid, once. Seed 4242 is the reviewer's; the confirmation seed 9100001 was
 * stated before the first run. A cell where no level reaches the gate is SKIPPED (no adjusted rate is shown), and the skip is reported.
 * On the unchanged estimator (238a791, no gate, no cap) the reviewer measured 17 of 40 cells below 95% (minimum 78.5%).
 */
const DELTA = [0, -1.5, -0.75, 0, 0.75, 1.5];
const sig = (z: number) => 1 / (1 + Math.exp(-z));
const DESIGNS: Record<string, Record<number, number>> = {
  'L3 n5': { 3: 5 }, 'L3 n10': { 3: 10 }, 'L3 n40': { 3: 40 }, 'L2,3 n20 each': { 2: 20, 3: 20 },
  'L1-5 n4 each': { 1: 4, 2: 4, 3: 4, 4: 4, 5: 4 }, 'L1-5 n8 each': { 1: 8, 2: 8, 3: 8, 4: 8, 5: 8 },
  'L1 n10 + L5 n1': { 1: 10, 5: 1 }, 'L1 n5,L3 n1,L5 n1': { 1: 5, 3: 1, 5: 1 }, 'L1 n20 + L5 n5': { 1: 20, 5: 5 }, 'L2 n5 + L4 n5': { 2: 5, 4: 5 },
};
const REPS = 20000;
export const SEEDS = { reviewer: 4242, confirm: 9100001 } as const;

export function grid(seed: number) {
  const rng = mulberry32(seed);
  const out: { skill: number; design: string; used: number[]; skipped: boolean; coverage: number | null }[] = [];
  for (const skill of [0.3, 3, -3, 5]) for (const [name, des] of Object.entries(DESIGNS)) {
    const lv = Object.keys(des).map(Number);
    const used = lv.filter((d) => des[d] >= SKILL_LEVEL_MIN_N);
    if (used.length === 0) { out.push({ skill, design: name, used, skipped: true, coverage: null }); continue; } // the estimator shows nothing: no coverage to claim
    const truth = used.reduce((s, d) => s + sig(skill - DELTA[d]), 0) / used.length;
    let cov = 0;
    for (let r = 0; r < REPS; r++) {
      const levels = lv.map((d) => { let x = 0; for (let i = 0; i < des[d]; i++) if (rng() < sig(skill - DELTA[d])) x++; return { d, n: des[d], x }; });
      const s = standardise(levels)!;
      if (s.lo <= truth && truth <= s.hi) cov++;
    }
    out.push({ skill, design: name, used, skipped: false, coverage: cov / REPS });
  }
  return out;
}

describe('measured coverage of the adjusted-rate interval (nominal 95%)', () => {
  for (const [name, seed] of Object.entries(SEEDS)) {
    it(`seed ${name} (${seed}): ${REPS} reps x 40 cells`, () => {
      const g = grid(seed);
      const ran = g.filter((c) => !c.skipped), cov = ran.map((c) => c.coverage!);
      console.log(`[c72 cov] ${name} seed ${seed}: cells ${g.length}, skipped (no level with ${SKILL_LEVEL_MIN_N} tasks) ${g.length - ran.length}, below 95%: ${cov.filter((x) => x < 0.95).length} of ${ran.length}, min ${(100 * Math.min(...cov)).toFixed(1)}%, mean ${(100 * cov.reduce((a, b) => a + b, 0) / cov.length).toFixed(1)}%`);
      for (const c of g) console.log(`[c72 cov]   ${name} skill ${c.skill} | ${c.design} | ${c.skipped ? 'SKIPPED' : `levels ${c.used.join(',')} coverage ${(100 * c.coverage!).toFixed(1)}%`}`);
      expect(g.length).toBe(40);
      // NOT MET at 95%: some cells stay below it after the gate (plain-Wilson discreteness at n = 10, and two-level mixes at extreme skill), so the interval is called NOMINAL 95%.
      // This floor is a regression guard on what was measured (minimum 86.1% on seed 4242, 86.7% on 9100001), not a claim of 95%.
      expect(Math.min(...cov)).toBeGreaterThanOrEqual(0.85);
      expect(cov.filter((x) => x < 0.95).length).toBeLessThanOrEqual(12);
      expect(g.filter((c) => c.skipped).map((c) => c.design)).toEqual(Array(4).fill('L1-5 n4 each')); // the only design with no gated level
    });
  }
});
