import { describe, it, expect } from 'vitest';
import { verdict, EVALUATION_POLICY_V1 } from '../src/evolution/verdict.js';
import { verdictV2, EVALUATION_POLICY_V2, hashDataset, type CaseRuns, type VerdictV2Input } from '../src/evolution/verdict-v2.js';

const cases = [{ caseId: 'c1', input: { q: 1 }, expected: 'a' }, { caseId: 'c2', input: { q: 2 }, expected: 'b' }];
const SHA = hashDataset(cases);
const ids = (n: number) => Array.from({ length: n }, (_, i) => `c${i + 1}`);
const runs = (scores: number[], cost = 1, k = 1): CaseRuns[] =>
  scores.map((s, i) => ({ caseId: `c${i + 1}`, attempts: Array.from({ length: k }, () => ({ score: s as number | null, costUnits: cost })) }));
function mk(b: number[], c: number[], over: Partial<VerdictV2Input> = {}): VerdictV2Input {
  return {
    baseline: runs(b), candidate: runs(c),
    holdout: { datasetId: 'DS-H', split: 'holdout', frozenSha256: SHA, observedSha256: SHA },
    tunedOnDatasetIds: ['DS-D'],
    authorId: 'author', evaluatorId: 'evaluator',
    candidateModelFamily: 'claude', judgeModelFamily: 'gpt',
    ...over,
  };
}
const codes = (r: { refusals: { code: string }[] }) => r.refusals.map((x) => x.code);

describe('policy v2', () => {
  it('is a new frozen policy; v1 is untouched', () => {
    expect(EVALUATION_POLICY_V2.version).toBe(2);
    expect(Object.isFrozen(EVALUATION_POLICY_V2)).toBe(true);
    expect(EVALUATION_POLICY_V2.alpha).toBe(0.05);
    expect(EVALUATION_POLICY_V1.version).toBe(1);
  });
});

describe('outcomes', () => {
  it('12 clear wins -> verified_better (p=0.0005, CI above 0)', () => {
    const b = Array(12).fill(50), c = b.map((x, i) => x + 10 + (i % 3));
    const r = verdictV2(mk(b, c));
    expect(r.outcome).toBe('verified_better');
    expect(r.signTest.p).toBeLessThan(0.05);
    expect(r.ci.low).toBeGreaterThan(0);
    expect(r.refusals).toEqual([]);
  });
  it('a fixture v1 verifies but v2 calls inconclusive (not significant)', () => {
    // 12 cases: 7 big wins, 5 small losses -> mean +8, v1 margin ok and wins>losses; sign test p=0.77
    const b = Array(12).fill(50);
    const c = [70, 70, 70, 70, 70, 70, 70, 47, 47, 47, 47, 47].map((x) => x);
    const input = mk(b, c);
    const v1 = verdict({ baseline: b.map((s, i) => ({ caseId: `c${i + 1}`, score: s })), candidate: c.map((s, i) => ({ caseId: `c${i + 1}`, score: s })), baselineDatasetHash: 'h', candidateDatasetHash: 'h', authorId: 'a', evaluatorId: 'e' });
    expect(v1.verified).toBe(true);
    const r = verdictV2(input);
    expect(r.outcome).toBe('inconclusive');
    expect(r.signTest.p).toBeGreaterThanOrEqual(0.05);
    expect(r.reasons.join(' ')).toMatch(/not significant/);
  });
  it('5 straight wins is inconclusive: below the minimum (v1 verifies it)', () => {
    const b = [50, 50, 50, 50, 50], c = [80, 80, 80, 80, 80];
    expect(verdict({ baseline: b.map((s, i) => ({ caseId: `c${i + 1}`, score: s })), candidate: c.map((s, i) => ({ caseId: `c${i + 1}`, score: s })), baselineDatasetHash: 'h', candidateDatasetHash: 'h', authorId: 'a', evaluatorId: 'e' }).verified).toBe(true);
    const r = verdictV2(mk(b, c));
    expect(r.outcome).toBe('inconclusive');
    expect(r.reasons.join(' ')).toMatch(/needs 10/);
  });
  it('significantly worse -> not_better', () => {
    const b = Array(12).fill(60), c = Array(12).fill(40);
    expect(verdictV2(mk(b, c)).outcome).toBe('not_better');
  });
  it('significant but under the margin -> not_better, with the reason', () => {
    const b = Array(12).fill(50), c = Array(12).fill(52);
    const r = verdictV2(mk(b, c));
    expect(r.outcome).toBe('not_better');
    expect(r.reasons.join(' ')).toMatch(/margin/);
  });
  it('ties are excluded from the sign test', () => {
    const b = Array(14).fill(50), c = [...Array(10).fill(70), 50, 50, 50, 50];
    const r = verdictV2(mk(b, c));
    expect(r.signTest).toMatchObject({ wins: 10, losses: 0, ties: 4, n: 10 });
    expect(r.signTest.p).toBeCloseTo(2 / 1024, 6);
  });
  it('is deterministic', () => {
    const b = Array(12).fill(50), c = b.map((x, i) => x + 5 + i);
    expect(verdictV2(mk(b, c))).toEqual(verdictV2(mk(b, c)));
  });
});

describe('pass^k, cost', () => {
  it('pass^k for k=1..4 on a fixture with known values', () => {
    // case c1: 4/4 pass, c2: 2/4, c3: 0/4 (pass = score >= 70)
    const mkRun = (id: string, s: number[]): CaseRuns => ({ caseId: id, attempts: s.map((x) => ({ score: x, costUnits: 1 })) });
    const base: CaseRuns[] = [mkRun('c1', [90, 90, 90, 90]), mkRun('c2', [90, 10, 90, 10]), mkRun('c3', [0, 0, 0, 0])];
    const r = verdictV2(mk([], [], { baseline: base, candidate: base }));
    expect(r.passHatK.baseline.map((x) => (x === null ? null : Math.round(x * 1e4) / 1e4))).toEqual([0.5, 0.3889, 0.3333, 0.3333]);
    expect(r.passAt1.baseline).toBe(0.5);
    expect(r.k).toBe(4);
  });
  it('states "better but costlier" and never hides it', () => {
    const b = Array(12).fill(50), c = b.map((x, i) => x + 10 + (i % 3));
    const r = verdictV2(mk(b, c, { candidate: runs(c, 1.5) }));
    expect(r.outcome).toBe('verified_better');
    expect(r.cost).toMatchObject({ baselinePerCase: 1, candidatePerCase: 1.5, deltaPct: 50 });
    expect(r.notes.join(' ')).toMatch(/better but costlier by 50%/);
  });
});

describe('refusals', () => {
  const b = Array(12).fill(50), c = b.map((x) => x + 12);
  it('hash mismatch', () => {
    const r = verdictV2(mk(b, c, { holdout: { datasetId: 'DS-H', split: 'holdout', frozenSha256: SHA, observedSha256: 'f'.repeat(64) } }));
    expect(codes(r)).toContain('hash_mismatch');
    expect(r.outcome).toBe('inconclusive');
  });
  it('dev/holdout reuse', () => {
    const r = verdictV2(mk(b, c, { tunedOnDatasetIds: ['DS-D', 'DS-H'] }));
    expect(codes(r)).toContain('dev_holdout_reuse');
    expect(r.outcome).toBe('inconclusive');
  });
  it('self-judging (case and spacing insensitive)', () => {
    const r = verdictV2(mk(b, c, { judgeModelFamily: ' Claude ' }));
    expect(codes(r)).toContain('self_judging');
    expect(r.outcome).toBe('inconclusive');
  });
  it('a verdict must name a holdout dataset; a dev split is not one', () => {
    expect(codes(verdictV2(mk(b, c, { holdout: undefined as never })))).toContain('holdout_missing');
    expect(codes(verdictV2(mk(b, c, { holdout: { datasetId: 'DS-D2', split: 'dev', frozenSha256: SHA, observedSha256: SHA } })))).toContain('not_holdout');
  });
  it('an unfrozen holdout (no frozen hash) is refused', () => {
    expect(codes(verdictV2(mk(b, c, { holdout: { datasetId: 'DS-H', split: 'holdout', frozenSha256: null, observedSha256: SHA } })))).toContain('not_frozen');
  });
  it('evaluator = author, unequal attempt counts, unpaired cases', () => {
    expect(codes(verdictV2(mk(b, c, { evaluatorId: 'author' })))).toContain('evaluator_is_author');
    expect(codes(verdictV2(mk(b, c, { candidate: runs(c, 1, 2) })))).toContain('unequal_attempts');
  });
  it('unpaired cases and bad scores are refused with their codes', () => {
    expect(codes(verdictV2(mk(b, c, { candidate: runs(c).slice(1) })))).toContain('unpaired_cases');
    const bad = runs(c); bad[0] = { caseId: 'c1', attempts: [{ score: 150, costUnits: 1 }] };
    const r = verdictV2(mk(b, c, { candidate: bad }));
    expect(codes(r)).toContain('bad_scores');
    expect(r.outcome).toBe('inconclusive');
    const negCost = runs(c); negCost[0] = { caseId: 'c1', attempts: [{ score: 50, costUnits: -1 }] };
    expect(codes(verdictV2(mk(b, c, { candidate: negCost })))).toContain('bad_scores');
  });
  it('a clean input has no refusals', () => { expect(verdictV2(mk(b, c)).refusals).toEqual([]); });
});

describe('hashDataset', () => {
  it('is stable under case and key order, and changes with content', () => {
    const a = hashDataset([{ caseId: 'b', input: { y: 1, x: 2 }, expected: 1 }, { caseId: 'a', input: 1, expected: 2 }]);
    const b2 = hashDataset([{ caseId: 'a', input: 1, expected: 2 }, { caseId: 'b', input: { x: 2, y: 1 }, expected: 1 }]);
    expect(a).toBe(b2);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(hashDataset([{ caseId: 'a', input: 1, expected: 3 }])).not.toBe(hashDataset([{ caseId: 'a', input: 1, expected: 2 }]));
  });
});
