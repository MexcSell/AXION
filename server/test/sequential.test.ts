import { describe, it, expect } from 'vitest';
import { sequence, update, readout, initialState, armHalfWidth, RHO, MIN_PER_ARM, type Observation } from '../src/company/sequential.ts';

const mk = (arm: 'before' | 'after', outcome: 0 | 1, k: number): Observation[] => Array.from({ length: k }, () => ({ arm, outcome }));
const interleave = (a: Observation[], b: Observation[]) => a.flatMap((x, i) => [x, b[i]]);

describe('c90 sequential confidence sequence', () => {
  it('hand-checked: rho and the n=10 arm half-width', () => {
    // L = ln(40) = 3.688879; 2L = 7.377759; ln(1+2L) = ln(8.377759) = 2.125; rho = 12.5 / 9.5028 = 1.3154
    expect(RHO).toBeCloseTo(1.3154, 3);
    // n=10: v=2.5; (v+rho)=3.8154; ln(3.8154/1.3154)=1.0651; +7.377759 = 8.4429; sqrt(3.8154*8.4429)=5.6757; /10
    expect(armHalfWidth(10)).toBeCloseTo(0.56757, 3);
  });
  it('hand-checked small case: 10 vs 10, all 1 after, all 0 before', () => {
    const steps = sequence(interleave(mk('before', 0, 10), mk('after', 1, 10)));
    const last = steps[steps.length - 1], h = armHalfWidth(10);
    expect(last.status).toBe('ok');
    // after arm: mean 1 -> [1-h,1]; before arm: mean 0 -> [0,h]; diff [1-2h, 1]
    expect(last.lower).toBeCloseTo(1 - 2 * h, 10);
    expect(last.upper).toBeCloseTo(1, 10);
    expect(last.zeroExcluded).toBe(false); // 1 - 2*0.5676 < 0: still inside, at n=10
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
});
