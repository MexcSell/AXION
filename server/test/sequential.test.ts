import { describe, it, expect } from 'vitest';
import { sequence, update, readout, initialState, armHalfWidth, RHO, MIN_PER_ARM, type Observation } from '../src/company/sequential.ts';

const mk = (arm: 'before' | 'after', outcome: 0 | 1, k: number): Observation[] => Array.from({ length: k }, () => ({ arm, outcome }));
const interleave = (a: Observation[], b: Observation[]) => a.flatMap((x, i) => [x, b[i]]);

describe('c90 sequential confidence sequence', () => {
  it('hand-checked: rho and the n=10 arm half-width', () => {
    // L = ln(80) = 4.38203; 2L = 8.76405; ln(1+2L) = ln(9.76405) = 2.27858; rho = 12.5 / 11.04263 = 1.13196
    expect(RHO).toBeCloseTo(1.1320, 3);
    // n=10: v=2.5; (v+rho)=3.63196; ln(3.63196/1.13196)=1.1658; +8.76405 = 9.9299; sqrt(3.63196*9.9299)=6.0054; /10
    expect(armHalfWidth(10)).toBeCloseTo(0.60054, 3);
  });
  it('hand-checked small case: 10 vs 10, all 1 after, all 0 before', () => {
    const steps = sequence(interleave(mk('before', 0, 10), mk('after', 1, 10)));
    const last = steps[steps.length - 1], h = armHalfWidth(10);
    expect(last.status).toBe('ok');
    // after arm: mean 1 -> [1-h,1]; before arm: mean 0 -> [0,h]; diff [1-2h, 1]
    expect(last.lower).toBeCloseTo(1 - 2 * h, 10);
    expect(last.upper).toBeCloseTo(1, 10);
    expect(last.zeroExcluded).toBe(false); // 1 - 2*0.6005 < 0: still inside, at n=10
  });
  it('not enough evidence below the minimum, no bounds', () => {
    const steps = sequence(interleave(mk('before', 1, 9), mk('after', 0, 9)));
    for (const s of steps) { expect(s.status).toBe('not_enough_evidence'); expect(s.lower).toBeNull(); expect(s.upper).toBeNull(); expect(s.zeroExcluded).toBe(false); }
  });
  it('one arm empty: never enough evidence', () => {
    const steps = sequence(mk('after', 1, 500));
    expect(steps.every((s) => s.status === 'not_enough_evidence')).toBe(true);
  });
  it('all 0 in both arms: bounds contain 0 and stay in [-1, 1]', () => {
    const steps = sequence(interleave(mk('before', 0, 300), mk('after', 0, 300)));
    for (const s of steps.filter((x) => x.status === 'ok')) { expect(s.lower!).toBeLessThanOrEqual(0); expect(s.upper!).toBeGreaterThanOrEqual(0); expect(s.lower!).toBeGreaterThanOrEqual(-1); expect(s.upper!).toBeLessThanOrEqual(1); }
  });
  it('all 1 after, all 0 before: eventually excludes zero', () => {
    const steps = sequence(interleave(mk('before', 0, 100), mk('after', 1, 100)));
    expect(steps[steps.length - 1].zeroExcluded).toBe(true);
    expect(steps[steps.length - 1].lower!).toBeGreaterThan(0);
  });
  it('bounds are monotone (running intersection): lower never falls, upper never rises, once ok', () => {
    let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const obs: Observation[] = [];
    for (let i = 0; i < 400; i++) obs.push({ arm: i % 2 ? 'after' : 'before', outcome: rnd() < 0.4 ? 1 : 0 });
    const ok = sequence(obs).filter((s) => s.status === 'ok');
    for (let i = 1; i < ok.length; i++) { expect(ok[i].lower!).toBeGreaterThanOrEqual(ok[i - 1].lower! - 1e-12); expect(ok[i].upper!).toBeLessThanOrEqual(ok[i - 1].upper! + 1e-12); }
  });
  it('update does not mutate its input; bad input throws', () => {
    const s0 = initialState(); const s1 = update(s0, { arm: 'after', outcome: 1 });
    expect(s0.after.n).toBe(0); expect(s1.after.n).toBe(1);
    expect(() => update(s0, { arm: 'x' as never, outcome: 1 })).toThrow();
    expect(() => update(s0, { arm: 'after', outcome: 2 as never })).toThrow();
    expect(readout(s0).status).toBe('not_enough_evidence');
    expect(MIN_PER_ARM).toBe(10);
  });

  it('same bounds for any arrival order at equal counts (unequal and bursty)', () => {
    const bef = [...mk('before', 1, 12), ...mk('before', 0, 18)], aft = [...mk('after', 1, 20), ...mk('after', 0, 10)];
    const orders: Observation[][] = [
      interleave(bef, aft),
      [...bef, ...aft],
      [...aft, ...bef],
      [...bef.slice(0, 5), ...aft.slice(0, 25), ...bef.slice(5), ...aft.slice(25)],
    ];
    const finals = orders.map((o) => sequence(o)[o.length - 1]);
    for (const f of finals) { expect(f.lower).toBeCloseTo(finals[0].lower!, 12); expect(f.upper).toBeCloseTo(finals[0].upper!, 12); }
    // bursty: 30 after before any before-arm observation, then before: not enough evidence until both arms reach 10
    const early = sequence([...aft, ...bef]);
    expect(early[29].status).toBe('not_enough_evidence');
  });
  it('bounds stay inside [-1, 1] in the extremes', () => {
    for (const [b, a] of [[1, 0], [0, 1], [1, 1], [0, 0]] as const) {
      for (const st of sequence(interleave(mk('before', b, 60), mk('after', a, 60))).filter((x) => x.status === 'ok')) {
        expect(st.lower!).toBeGreaterThanOrEqual(-1); expect(st.upper!).toBeLessThanOrEqual(1);
      }
    }
  });
  it('covers the true difference at every look under a real effect (small fixed-seed sim)', () => {
    let seed = 20260123; const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    let misses = 0; const streams = 300;
    for (let k = 0; k < streams; k++) {
      const obs: Observation[] = [];
      for (let i = 0; i < 150; i++) { obs.push({ arm: 'before', outcome: rnd() < 0.3 ? 1 : 0 }); obs.push({ arm: 'after', outcome: rnd() < 0.5 ? 1 : 0 }); }
      if (sequence(obs).some((x) => x.status === 'ok' && !(x.lower! <= 0.2 && 0.2 <= x.upper!))) misses++;
    }
    expect(misses / streams).toBeLessThanOrEqual(0.05 + 2 * Math.sqrt(0.05 * 0.95 / streams));
  });
});
