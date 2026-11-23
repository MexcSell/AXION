import { describe, it, expect } from 'vitest';
import {
  MARGIN_PROBE_A, MARGIN_PROBE_B, REGRESSION_BUDGET, MIN_ITEMS_PER_CLASS, MAX_ATTEMPTS_PER_PROBE_A,
  checkAttemptCap, skillGate, type GateInput, type ClassScores, type ScoreSet,
} from '../src/evolution/skill-gate.ts';

// c91 (R5-5): the promotion gate on hand-made score tables. This tests the gate, not any skill.
const CLASSES = ['build', 'fix', 'review'];
const scores = (mean: number | Record<string, number>, n = MIN_ITEMS_PER_CLASS): ClassScores =>
  Object.fromEntries(CLASSES.map((c) => [c, { n, mean: typeof mean === 'number' ? mean : mean[c] }]));
const set = (prefix: string, cand: number | Record<string, number>, inc: number | Record<string, number>, n = MIN_ITEMS_PER_CLASS): ScoreSet =>
  ({ taskIds: [`${prefix}1`, `${prefix}2`, `${prefix}3`], candidate: scores(cand, n), incumbent: scores(inc, n) });
const base = (over: Partial<GateInput> = {}): GateInput => ({
  candidate: { id: 'cand', evidenceTaskIds: ['e1', 'e2'], contract: 'When X, do Y; observable: Z.' },
  probeA: set('a', 0.7, 0.6), probeB: set('b', 0.7, 0.6), replay: set('r', 0.62, 0.6), probeAAttempts: 1, ...over,
});
const codes = (i: GateInput) => skillGate(i).reasons.map((r) => r.code);

describe('skillGate', () => {
  it('admits a clean gain', () => {
    const d = skillGate(base());
    expect(d.verdict).toBe('admit');
    expect(d.reasons.map((r) => r.code)).toEqual(['all_checks_passed']);
    expect(d.metrics.gainA).toBeCloseTo(0.1, 9);
  });
  it('refuses when probe A gain is not above the margin (boundary: exactly at margin refuses)', () => {
    expect(codes(base({ probeA: set('a', 0.6 + MARGIN_PROBE_A, 0.6) }))).toContain('probe_a_gain_too_small');
    expect(skillGate(base({ probeA: set('a', 0.6 + MARGIN_PROBE_A + 0.01, 0.6) })).verdict).toBe('admit');
  });
  it('refuses when probe B gain is not above the margin (boundary)', () => {
    expect(codes(base({ probeB: set('b', 0.6 + MARGIN_PROBE_B, 0.6) }))).toContain('probe_b_gain_too_small');
  });
  it('refuses an overfit candidate: gain on A only', () => {
    const d = skillGate(base({ probeB: set('b', 0.6, 0.6) }));
    expect(d.verdict).toBe('refuse');
    expect(d.reasons.map((r) => r.code)).toEqual(['probe_b_gain_too_small']);
  });
  it('allows a loss exactly at the regression budget, refuses beyond it', () => {
    const at = { build: 0.6 - REGRESSION_BUDGET, fix: 0.7, review: 0.7 };
    expect(skillGate(base({ replay: set('r', at, 0.6) })).verdict).toBe('admit');
    const over = { build: 0.6 - REGRESSION_BUDGET - 0.01, fix: 0.7, review: 0.7 };
    const d = skillGate(base({ replay: set('r', over, 0.6) }));
    expect(d.verdict).toBe('refuse');
    expect(d.reasons.find((r) => r.code === 'replay_regression')?.classes).toEqual(['build']);
  });
  it('a big gain elsewhere does not buy back a class that regressed', () => {
    const d = skillGate(base({ replay: set('r', { build: 0.3, fix: 0.95, review: 0.95 }, 0.6) }));
    expect(d.verdict).toBe('refuse');
  });
  it.each([['probeA', 'a1'], ['probeB', 'b2'], ['replay', 'r3']])('refuses evidence that overlaps %s', (_n, id) => {
    const d = skillGate(base({ candidate: { id: 'c', evidenceTaskIds: ['e1', id], contract: 'ok' } }));
    expect(d.verdict).toBe('refuse');
    const r = d.reasons.find((x) => x.code === 'evidence_leakage');
    expect(r?.taskIds).toEqual([id]);
  });
  it('not enough evidence: a probe class one item under the minimum', () => {
    const small = set('a', 0.7, 0.6); small.candidate.fix.n = MIN_ITEMS_PER_CLASS - 1;
    const d = skillGate(base({ probeA: small }));
    expect(d.verdict).toBe('not_enough_evidence');
    expect(d.reasons.map((r) => r.code)).toContain('probe_a_too_small');
  });
  it('exactly the minimum is enough', () => {
    expect(skillGate(base()).verdict).toBe('admit');
  });
  it('not enough evidence: the incumbent side is the small one', () => {
    const small = set('b', 0.7, 0.6); small.incumbent.review.n = 1;
    expect(skillGate(base({ probeB: small })).verdict).toBe('not_enough_evidence');
  });
  it('not enough evidence: a class missing from replay or probe B', () => {
    const noClass = set('r', 0.62, 0.6); delete noClass.candidate.fix; delete noClass.incumbent.fix;
    expect(codes(base({ replay: noClass }))).toContain('replay_too_small');
    const arms = set('b', 0.7, 0.6); delete arms.candidate.fix;
    expect(codes(base({ probeB: arms }))).toContain('probe_b_too_small');
  });
  it('leakage outranks too-small: verdict refuse, both reasons listed', () => {
    const small = set('a', 0.7, 0.6); small.candidate.fix.n = 1;
    const d = skillGate(base({ probeA: small, candidate: { id: 'c', evidenceTaskIds: ['b1'], contract: 'ok' } }));
    expect(d.verdict).toBe('refuse');
    expect(d.reasons.map((r) => r.code)).toEqual(expect.arrayContaining(['evidence_leakage', 'probe_a_too_small']));
  });
  it('lists every failing reason together', () => {
    const d = skillGate(base({ probeA: set('a', 0.6, 0.6), probeB: set('b', 0.6, 0.6), replay: set('r', 0.3, 0.6),
      candidate: { id: 'c', evidenceTaskIds: ['r1'], contract: 'ok' } }));
    expect(d.reasons.map((r) => r.code).sort()).toEqual(['evidence_leakage', 'probe_a_gain_too_small', 'probe_b_gain_too_small', 'replay_regression']);
  });
  it('refuses an empty contract and an empty evidence list', () => {
    expect(codes(base({ candidate: { id: 'c', evidenceTaskIds: ['e1'], contract: '   ' } }))).toContain('contract_missing');
    expect(codes(base({ candidate: { id: 'c', evidenceTaskIds: [], contract: 'ok' } }))).toContain('evidence_missing');
  });
  it('refuses malformed scores instead of computing on them', () => {
    const bad = set('a', 0.7, 0.6); bad.candidate.build.mean = NaN;
    expect(codes(base({ probeA: bad }))).toContain('invalid_scores');
    const out = set('a', 1.2, 0.6);
    expect(codes(base({ probeA: out }))).toContain('invalid_scores');
  });
  it('is pure: the input is not changed and the same input gives the same decision', () => {
    const i = base(); const snap = JSON.stringify(i);
    expect(skillGate(i)).toEqual(skillGate(i));
    expect(JSON.stringify(i)).toBe(snap);
  });
});

describe('repeated-candidate cap', () => {
  it('allows attempts up to the cap and requires a refresh after it', () => {
    expect(checkAttemptCap(MAX_ATTEMPTS_PER_PROBE_A)).toEqual({ ok: true, remaining: 0 });
    expect(checkAttemptCap(MAX_ATTEMPTS_PER_PROBE_A + 1)).toEqual({ ok: false, remaining: 0 });
    expect(checkAttemptCap(1).remaining).toBe(MAX_ATTEMPTS_PER_PROBE_A - 1);
  });
  it('rejects a bad count', () => {
    expect(() => checkAttemptCap(0)).toThrow(RangeError);
    expect(() => checkAttemptCap(1.5)).toThrow(RangeError);
  });
  it('the gate refuses past the cap, even for an otherwise clean candidate', () => {
    expect(codes(base({ probeAAttempts: MAX_ATTEMPTS_PER_PROBE_A + 1 }))).toContain('probe_a_attempts_exhausted');
    expect(skillGate(base({ probeAAttempts: MAX_ATTEMPTS_PER_PROBE_A })).verdict).toBe('admit');
  });
});
