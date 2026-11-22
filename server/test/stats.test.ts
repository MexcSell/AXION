import { describe, it, expect } from 'vitest';
import { signTestTwoSided, tQuantile975, pairedMeanCI, passHatK, mulberry32, bootstrapMeanCI } from '../src/evolution/stats.js';

const r4 = (x: number | null) => Math.round((x as number) * 1e4) / 1e4;

describe('signTestTwoSided (exact binomial)', () => {
  it('n=10, 9 wins -> p = 0.0215', () => {
    const r = signTestTwoSided(9, 1);
    expect(r4(r.p)).toBe(0.0215);
    expect(r.n).toBe(10);
  });
  it('n=5, 5 wins -> p = 0.0625', () => { expect(signTestTwoSided(5, 0).p).toBe(0.0625); });
  it('is symmetric and caps at 1', () => {
    expect(signTestTwoSided(0, 5).p).toBe(0.0625);
    expect(signTestTwoSided(5, 5).p).toBe(1);
    expect(signTestTwoSided(1, 0).p).toBe(1);
  });
  it('n=0 (all ties) gives p=1', () => { expect(signTestTwoSided(0, 0)).toEqual({ n: 0, p: 1 }); });
  it('more known answers', () => {
    expect(r4(signTestTwoSided(8, 2).p)).toBe(0.1094);
    expect(r4(signTestTwoSided(7, 3).p)).toBe(0.3438);
    expect(r4(signTestTwoSided(20, 0).p)).toBe(0);
    expect(signTestTwoSided(20, 0).p).toBeCloseTo(2 / 2 ** 20, 12);
  });
  it('is exact for large n (no float overflow)', () => {
    const r = signTestTwoSided(600, 400);
    expect(r.p).toBeGreaterThan(2e-10);
    expect(r.p).toBeLessThan(3e-10);
  });
  it('rejects bad input', () => {
    expect(() => signTestTwoSided(-1, 2)).toThrow();
    expect(() => signTestTwoSided(1.5, 2)).toThrow();
  });
});

describe('t quantile and paired CI', () => {
  it('t(0.975) known values to 4 places', () => {
    expect(r4(tQuantile975(1))).toBe(12.7062);
    expect(r4(tQuantile975(4))).toBe(2.7764);
    expect(r4(tQuantile975(9))).toBe(2.2622);
    expect(r4(tQuantile975(29))).toBe(2.0452);
    expect(r4(tQuantile975(120))).toBe(1.9799);
  });
  it('95% CI of the mean: [1,2,3,4,5] -> 3 +/- 1.9600?', () => {
    // mean 3, sd sqrt(2.5), se = sqrt(0.5) = 0.70711, t(4)=2.7764 -> half 1.9632
    const ci = pairedMeanCI([1, 2, 3, 4, 5]);
    expect(r4(ci.mean)).toBe(3);
    expect(r4(ci.low)).toBe(1.0368);
    expect(r4(ci.high)).toBe(4.9632);
    expect(ci.df).toBe(4);
  });
  it('n<2 has no interval', () => { expect(pairedMeanCI([3])).toMatchObject({ mean: 3, low: null, high: null }); });
  it('zero variance collapses to the mean', () => { expect(pairedMeanCI([2, 2, 2])).toMatchObject({ mean: 2, low: 2, high: 2 }); });
});

describe('passHatK (tau-bench pass^k)', () => {
  // 3 cases, m=4 attempts: passes 4, 2, 0
  const att = [[true, true, true, true], [true, false, true, false], [false, false, false, false]];
  it('known values for k=1..4', () => {
    expect(r4(passHatK(att, 1))).toBe(r4((4 / 4 + 2 / 4 + 0) / 3)); // 0.5
    expect(r4(passHatK(att, 2))).toBe(r4((1 + 1 / 6 + 0) / 3)); // C(2,2)/C(4,2)=1/6
    expect(r4(passHatK(att, 3))).toBe(r4((1 + 0 + 0) / 3));
    expect(r4(passHatK(att, 4))).toBe(r4(1 / 3));
  });
  it('k above the attempts is null; empty is null', () => {
    expect(passHatK(att, 5)).toBeNull();
    expect(passHatK([], 1)).toBeNull();
  });
});

describe('seeded bootstrap', () => {
  it('mulberry32 is deterministic', () => {
    const a = mulberry32(42), b = mulberry32(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(mulberry32(42)()).not.toBe(mulberry32(43)());
  });
  it('same seed same interval; interval brackets the mean', () => {
    const d = [1, 3, 2, 5, 4, 6, 2, 3];
    const x = bootstrapMeanCI(d, 2000, 7), y = bootstrapMeanCI(d, 2000, 7);
    expect(x).toEqual(y);
    expect(x.low).toBeLessThanOrEqual(3.25);
    expect(x.high).toBeGreaterThanOrEqual(3.25);
  });
});
