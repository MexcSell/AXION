import { describe, it, expect } from 'vitest';
import { splitCalibration, splitInterval, fiellerInterval, MIN_JUDGE_MARGIN, type Calibration } from '../src/evolution/judge-calibration.ts';

// c84 (E1e): the two remedies as pure functions. The split rule is documented above `splitCalibration`.
const tot = (c: Calibration) => c.tp + c.fn + c.tn + c.fp;

describe('splitCalibration', () => {
  it('halves each class (pilot floor, holdout the rest), conserves every count, and is deterministic', () => {
    const cal = { tp: 41, fn: 9, tn: 33, fp: 17 };
    const a = splitCalibration(cal), b = splitCalibration(cal);
    expect(a).toEqual(b);
    expect(a.pilot.tp + a.pilot.fn).toBe(25); expect(a.pilot.tn + a.pilot.fp).toBe(25);
    expect(a.pilot.tp + a.holdout.tp).toBe(41); expect(a.pilot.fn + a.holdout.fn).toBe(9);
    expect(a.pilot.tn + a.holdout.tn).toBe(33); expect(a.pilot.fp + a.holdout.fp).toBe(17);
    expect(tot(a.pilot) + tot(a.holdout)).toBe(100);
  });
  it('odd class sizes: the holdout gets the extra item', () => {
    const s = splitCalibration({ tp: 10, fn: 11, tn: 12, fp: 8 });
    expect(s.pilot.tp + s.pilot.fn).toBe(10); expect(s.holdout.tp + s.holdout.fn).toBe(11);
  });
  it('a class where all items agree stays all-agree in both halves', () => {
    const s = splitCalibration({ tp: 30, fn: 0, tn: 30, fp: 0 });
    expect(s.pilot).toEqual({ tp: 15, fn: 0, tn: 15, fp: 0 }); expect(s.holdout).toEqual({ tp: 15, fn: 0, tn: 15, fp: 0 });
  });
});

describe('splitInterval (remedy 1)', () => {
  const good: Calibration = { tp: 18, fn: 2, tn: 18, fp: 2 };
  it('an eligible judge gets an interval computed from the holdout labels only', () => {
    const r = splitInterval({ judgedPass: 120, n: 200, pilot: good, holdout: { tp: 12, fn: 8, tn: 12, fp: 8 } });
    const r2 = splitInterval({ judgedPass: 120, n: 200, pilot: { tp: 10, fn: 10, tn: 10, fp: 10 }, holdout: { tp: 12, fn: 8, tn: 12, fp: 8 } });
    expect(r.status).toBe('ok'); expect(r2.status).toBe('ineligible');
    // the pilot does not enter the interval: two eligible pilots give the same answer
    const r3 = splitInterval({ judgedPass: 120, n: 200, pilot: { tp: 20, fn: 0, tn: 20, fp: 0 }, holdout: { tp: 12, fn: 8, tn: 12, fp: 8 } });
    expect(r3.corrected).toEqual(r.corrected);
  });
  it('an ineligible judge gets no interval and no number at all (fail closed, never a wider guess)', () => {
    const r = splitInterval({ judgedPass: 50, n: 100, pilot: { tp: 12, fn: 8, tn: 11, fp: 9 }, holdout: good });
    expect(r.status).toBe('ineligible'); expect(r.corrected).toEqual({ rate: null, low: null, high: null }); expect(r.reason).toMatch(/not enough evidence/);
  });
  it('the pilot margin is checked against the policy floor', () => {
    expect(MIN_JUDGE_MARGIN).toBe(0.5);
    // adjusted margin = (13/22)+(13/22)-1 = 0.18 -> out; (19/22)+(19/22)-1 = 0.727 -> in
    expect(splitInterval({ judgedPass: 50, n: 100, pilot: { tp: 12, fn: 8, tn: 12, fp: 8 }, holdout: good }).status).toBe('ineligible');
    expect(splitInterval({ judgedPass: 50, n: 100, pilot: { tp: 18, fn: 2, tn: 18, fp: 2 }, holdout: good }).status).toBe('ok');
  });
  it('a holdout too small, or one on which the judge is no better than chance, gives no interval', () => {
    expect(splitInterval({ judgedPass: 50, n: 100, pilot: good, holdout: { tp: 4, fn: 3, tn: 12, fp: 8 } }).status).toBe('ineligible');
    expect(splitInterval({ judgedPass: 50, n: 100, pilot: good, holdout: { tp: 5, fn: 5, tn: 5, fp: 5 } }).status).toBe('ineligible');
  });
  it('a degenerate all-agree sample is eligible and gives a finite interval inside [0,1]', () => {
    const r = splitInterval({ judgedPass: 100, n: 100, pilot: { tp: 15, fn: 0, tn: 15, fp: 0 }, holdout: { tp: 15, fn: 0, tn: 15, fp: 0 } });
    expect(r.status).toBe('ok');
    for (const x of [r.corrected.rate, r.corrected.low, r.corrected.high]) { expect(Number.isFinite(x)).toBe(true); expect(x!).toBeGreaterThanOrEqual(0); expect(x!).toBeLessThanOrEqual(1); }
    expect(r.corrected.low!).toBeLessThanOrEqual(r.corrected.high!);
  });
});

describe('fiellerInterval (remedy 3)', () => {
  it('a margin whose confidence set includes 0 gives an unbounded result, no number', () => {
    for (const c of [{ tp: 11, fn: 9, tn: 10, fp: 10 }, { tp: 10, fn: 10, tn: 10, fp: 10 }, { tp: 0, fn: 20, tn: 0, fp: 20 }]) {
      const r = fiellerInterval({ judgedPass: 50, n: 100, calibration: c });
      expect(r.status).toBe('unbounded'); expect(r.corrected).toEqual({ rate: null, low: null, high: null }); expect(r.reason).toMatch(/includes 0|no corrected rate|not better than chance/);
    }
  });
  it('a clearly good judge gives a bounded interval that contains the point estimate and the closed form', () => {
    const r = fiellerInterval({ judgedPass: 120, n: 200, calibration: { tp: 45, fn: 5, tn: 40, fp: 10 } });
    expect(r.status).toBe('ok');
    expect(r.corrected.rate!).toBeCloseTo((0.6 + 0.8 - 1) / (0.8 + 0.9 - 1), 10);
    expect(r.corrected.low!).toBeLessThan(r.corrected.rate!); expect(r.corrected.high!).toBeGreaterThan(r.corrected.rate!);
  });
  it('the limits are exactly the points where the z-test of g(theta)=0 stops rejecting', () => {
    const c = { tp: 45, fn: 5, tn: 40, fp: 10 }, z = 1.959963984540054, n = 200, jp = 120;
    const r = fiellerInterval({ judgedPass: jp, n, calibration: c });
    const nT = n + z * z, pT = (jp + z * z / 2) / nT, q0 = 41 / 52, q1 = 46 / 52;
    const stat = (t: number) => { const g = pT - (1 - t) * (1 - q0) - t * q1; const v = pT * (1 - pT) / nT + (1 - t) ** 2 * q0 * (1 - q0) / 52 + t * t * q1 * (1 - q1) / 52; return Math.abs(g) / Math.sqrt(v); };
    expect(stat(r.corrected.low!)).toBeCloseTo(z, 6); expect(stat(r.corrected.high!)).toBeCloseTo(z, 6);
  });
  it('a degenerate all-agree sample is bounded, finite and inside [0,1]', () => {
    const r = fiellerInterval({ judgedPass: 100, n: 100, calibration: { tp: 30, fn: 0, tn: 30, fp: 0 } });
    expect(r.status).toBe('ok');
    for (const x of [r.corrected.rate, r.corrected.low, r.corrected.high]) { expect(Number.isFinite(x)).toBe(true); expect(x!).toBeGreaterThanOrEqual(0); expect(x!).toBeLessThanOrEqual(1); }
  });
  it('never returns NaN or an inverted interval over a sweep', () => {
    let s = 5; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    for (let i = 0; i < 3000; i++) {
      const n = 1 + Math.floor(rnd() * 300), m = () => Math.floor(rnd() * 60);
      const r = fiellerInterval({ judgedPass: Math.floor(rnd() * (n + 1)), n, calibration: { tp: m(), fn: m(), tn: m(), fp: m() } });
      if (r.status === 'ok') { expect(r.corrected.low!).toBeLessThanOrEqual(r.corrected.high!); for (const x of [r.corrected.low, r.corrected.high]) expect(Number.isFinite(x!)).toBe(true); }
      else expect(r.corrected.low).toBeNull();
    }
  });
});
