import { describe, it, expect } from 'vitest';
import { mulberry32 } from '../src/evolution/stats.ts';
import { compareSkill, compareRaw, standardise, type LevelCount } from '../../shared/contracts/src/index.ts';

/**
 * Improvement cycle 72, item 4 (threshold): a seeded simulation of the difficulty confound.
 *
 * Setup, FIXED BEFORE ANY TRIAL (and the two seeds too; the second was written before the first run, not chosen after seeing results):
 *  - One task class. A task at difficulty d succeeds with probability inverse-logit(skill - DELTA[d]), DELTA = [-1.5, -0.75, 0, 0.75, 1.5] for d = 1..5.
 *  - Primary case: agents A and B have EQUAL true skill (0.3). A is handed only easy tasks (levels 1 and 2, equally likely), B only hard ones (levels 4 and 5).
 *    40 finished tasks each. 1,000 seeded trials.
 *  - "Raw comparison calls A better": the 95% Wilson intervals of the raw rates do not overlap and A's rate is higher.
 *  - "Adjusted comparison calls them distinguishable": compareSkill (direct standardisation, shared levels only, interval overlap).
 *  - Thresholds: raw calls A better in at least 90% of trials; adjusted calls them distinguishable in at most 10%.
 * What it can and cannot show (also in the report). The estimator does not use DELTA, so the simulation is not tuned to it. But the PRIMARY case has no
 * shared difficulty level, and the estimator then refuses to compare ("indistinguishable"), which holds by construction. The extra cases below give the
 * two agents overlapping difficulty mixes, which is where the adjustment does real work, and add a true skill gap to show it can still tell agents apart.
 * The model also assumes skill is the same at every difficulty (additive on the logit scale); a real agent need not be like that.
 */
const DELTA = [0, -1.5, -0.75, 0, 0.75, 1.5];
const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));
const TRIALS = 1000;
export const SEEDS = { design: 720001, fresh: 9720101 } as const;

function draw(rng: () => number, skill: number, mix: readonly number[], n: number): LevelCount[] {
  const lv = new Map<number, LevelCount>();
  const cum: number[] = []; mix.reduce((s, w, i) => (cum[i] = s + w), 0);
  for (let i = 0; i < n; i++) {
    const u = rng() * cum[cum.length - 1];
    const d = cum.findIndex((c) => u < c) + 1;
    const l = lv.get(d) ?? { d, n: 0, x: 0 };
    l.n++; if (rng() < sigmoid(skill - DELTA[d])) l.x++;
    lv.set(d, l);
  }
  return [...lv.values()].sort((a, b) => a.d - b.d);
}

export interface Rates {
  rawBetter: number; rawDistinct: number; adjDistinct: number; trials: number;
  /** adjusted comparison outcomes by reason (they add up to 1): no shared level, under 5 outcomes on the shared levels, intervals overlap, intervals apart */
  noShared: number; tooFew: number; overlap: number; apart: number;
  /** each agent's OWN adjusted cell (over the levels it has, as the profile shows it): share of trials where the two cells' intervals do not overlap. NOT a valid comparison; reported because a reader of two profiles would do it. */
  ownCellsApart: number;
}
export function run(seed0: number, o: { skillA: number; skillB: number; mixA: readonly number[]; mixB: readonly number[]; n: number; delta?: number }): Rates {
  let rawBetter = 0, rawDistinct = 0, adjDistinct = 0, noShared = 0, tooFew = 0, overlap = 0, ownApart = 0;
  const saved = DELTA.slice();
  if (o.delta) for (let d = 1; d <= 5; d++) DELTA[d] = saved[d] * o.delta;
  try {
    for (let k = 0; k < TRIALS; k++) {
      const rng = mulberry32(seed0 + k);
      const a = draw(rng, o.skillA, o.mixA, o.n), b = draw(rng, o.skillB, o.mixB, o.n);
      const raw = compareRaw(a, b);
      if (raw.verdict === 'distinguishable') { rawDistinct++; if (raw.aHigher) rawBetter++; }
      const adj = compareSkill(a, b);
      if (adj.verdict === 'distinguishable') adjDistinct++;
      else if (adj.sharedLevels.length === 0) noShared++; else if (/Fewer than/.test(adj.reason)) tooFew++; else overlap++;
      const sa = standardise(a)!, sb = standardise(b)!;
      if (sa.hi < sb.lo || sb.hi < sa.lo) ownApart++;
    }
  } finally { for (let d = 1; d <= 5; d++) DELTA[d] = saved[d]; }
  return { rawBetter: rawBetter / TRIALS, rawDistinct: rawDistinct / TRIALS, adjDistinct: adjDistinct / TRIALS, trials: TRIALS, noShared: noShared / TRIALS, tooFew: tooFew / TRIALS, overlap: overlap / TRIALS, apart: adjDistinct / TRIALS, ownCellsApart: ownApart / TRIALS };
}
const EASY = [1, 1, 0, 0, 0], HARD = [0, 0, 0, 1, 1];
const A_MIX = [0.4, 0.3, 0.2, 0.1, 0], B_MIX = [0, 0.1, 0.2, 0.3, 0.4];
const fmt = (r: Rates) => `raw calls A better ${(100 * r.rawBetter).toFixed(1)}% | raw distinguishable ${(100 * r.rawDistinct).toFixed(1)}% | adjusted distinguishable ${(100 * r.adjDistinct).toFixed(1)}% | skipped: no shared level ${(100 * r.noShared).toFixed(1)}%, under 5 shared ${(100 * r.tooFew).toFixed(1)}%, overlap ${(100 * r.overlap).toFixed(1)}% | own-level cells apart ${(100 * r.ownCellsApart).toFixed(1)}%`;

describe('seeded simulation: easy tasks for A, hard tasks for B, equal true skill (threshold)', () => {
  for (const [name, seed] of Object.entries(SEEDS)) {
    it(`seed ${name} (${seed}): the raw comparison calls A better in at least 90% of ${TRIALS} trials; the adjusted one calls them distinguishable in at most 10%`, () => {
      const r = run(seed, { skillA: 0.3, skillB: 0.3, mixA: EASY, mixB: HARD, n: 40 });
      console.log(`[c72 sim] PRIMARY ${name} seed ${seed}: ${fmt(r)}`);
      expect(r.rawBetter).toBeGreaterThanOrEqual(0.9);
      expect(r.adjDistinct).toBeLessThanOrEqual(0.1);
      // honesty about HOW it passes: every trial is a refusal for lack of a shared level, and the two profile cells, each adjusted over its own levels only, are NOT comparable
      expect(r.noShared).toBe(1);
      expect(r.ownCellsApart).toBeGreaterThan(0.5); // reported: a reader comparing two such profiles would still see A as better
    });
  }

  it('RED proof: the same threshold fails for a method that does not adjust (the raw rule used as the adjusted one)', () => {
    const r = run(SEEDS.design, { skillA: 0.3, skillB: 0.3, mixA: EASY, mixB: HARD, n: 40 });
    expect(r.rawDistinct).toBeGreaterThan(0.1); // a raw comparison would call these equal agents distinguishable far more than 10% of the time
  });
});

describe('extra cases (reported, not part of the brief threshold): overlapping difficulty mixes', () => {
  for (const [name, seed] of Object.entries(SEEDS)) {
    it(`seed ${name}: equal skill, A mostly easy and B mostly hard with shared levels 2 to 4 (n = 60 each): adjusted false-positive rate stays at or below 10%`, () => {
      const r = run(seed, { skillA: 0.3, skillB: 0.3, mixA: A_MIX, mixB: B_MIX, n: 60 });
      console.log(`[c72 sim] OVERLAP equal skill ${name} seed ${seed}: ${fmt(r)}`);
      expect(r.adjDistinct).toBeLessThanOrEqual(0.1);
      expect(r.rawBetter).toBeGreaterThan(r.adjDistinct); // the adjustment removes false calls the raw rule makes
    });
    it(`seed ${name}: the same overlapping mixes with the difficulty effect doubled (the estimator never uses it): false-positive rate at or below 10%`, () => {
      const r = run(seed, { skillA: 0.3, skillB: 0.3, mixA: A_MIX, mixB: B_MIX, n: 60, delta: 2 });
      console.log(`[c72 sim] OVERLAP equal skill, difficulty effect x2, ${name} seed ${seed}: ${fmt(r)}`);
      expect(r.adjDistinct).toBeLessThanOrEqual(0.1);
    });
    it(`seed ${name}: with a real skill gap (B better by 1.0 and by 2.0 on the logit scale) the adjusted rule finds it more often than at equal skill (power is REPORTED, not claimed)`, () => {
      // Written first with "asserted above 50%" for the 1.0 gap. It measured 14.7% and 16.5%, so the claim was dropped and the number is reported: interval overlap is a conservative rule.
      const eq = run(seed, { skillA: 0.3, skillB: 0.3, mixA: A_MIX, mixB: B_MIX, n: 60 });
      const g1 = run(seed, { skillA: 0.3, skillB: 1.3, mixA: A_MIX, mixB: B_MIX, n: 60 });
      const g2 = run(seed, { skillA: 0.3, skillB: 2.3, mixA: A_MIX, mixB: B_MIX, n: 60 });
      console.log(`[c72 sim] OVERLAP power ${name} seed ${seed}: equal ${(100 * eq.adjDistinct).toFixed(1)}% | gap 1.0 ${(100 * g1.adjDistinct).toFixed(1)}% | gap 2.0 ${(100 * g2.adjDistinct).toFixed(1)}%`);
      expect(g1.adjDistinct).toBeGreaterThan(eq.adjDistinct);
      expect(g2.adjDistinct).toBeGreaterThan(g1.adjDistinct);
    });
  }
});
