import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  verdict,
  detectableGain,
  EVALUATION_POLICY_V1,
  type VerdictInput,
} from '../src/evolution/verdict.js';

const ids = (n: number) => Array.from({ length: n }, (_, i) => `c${i + 1}`);
function mk(n: number, bScore: number, cScore: number, over: Partial<VerdictInput> = {}): VerdictInput {
  return {
    baseline: ids(n).map((caseId) => ({ caseId, score: bScore })),
    candidate: ids(n).map((caseId) => ({ caseId, score: cScore })),
    baselineDatasetHash: 'h1',
    candidateDatasetHash: 'h1',
    authorId: 'author',
    evaluatorId: 'evaluator',
    ...over,
  };
}
const P = EVALUATION_POLICY_V1;

describe('policy', () => {
  it('is versioned, frozen and records its source', () => {
    expect(P.version).toBe(1);
    expect(P.source).toBe('built-in');
    expect(Object.isFrozen(P)).toBe(true);
    expect(P.minCases).toBeGreaterThanOrEqual(3);
    expect(P.margin).toBeGreaterThan(0);
  });
  it('is echoed in the output with its source', () => {
    const r = verdict(mk(P.minCases, 50, 50 + P.margin + 1));
    expect(r.policy).toEqual({ version: 1, minCases: P.minCases, margin: P.margin, tieBand: P.tieBand, source: 'built-in' });
  });
  it('a custom policy keeps its stated source', () => {
    const r = verdict(mk(3, 50, 70, { policy: { version: 7, minCases: 3, margin: 2, tieBand: 0.5, source: 'admin:alice' } }));
    expect(r.policy.source).toBe('admin:alice');
    expect(r.policy.version).toBe(7);
  });
  it('refuses a policy set by the candidate author', () => {
    const r = verdict(mk(5, 10, 90, { policy: { version: 2, minCases: 1, margin: 0, tieBand: 0.5, source: 'author', setBy: 'author' } }));
    expect(r.verified).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/author.*policy|policy.*author/i);
  });
  it('refuses an invalid policy', () => {
    const r = verdict(mk(5, 10, 90, { policy: { version: 2, minCases: 0, margin: -1, tieBand: 0.5, source: 'x' } }));
    expect(r.verified).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/policy is invalid/i);
  });
});

describe('verified', () => {
  it('passes when every rule is met', () => {
    const r = verdict(mk(P.minCases, 50, 50 + P.margin + 5));
    expect(r.verified).toBe(true);
    expect(r.reasons).toEqual([]);
    expect(r.cases).toBe(P.minCases);
    expect(r.wins).toBe(P.minCases);
    expect(r.losses).toBe(0);
    expect(r.delta).toBeCloseTo(P.margin + 5);
  });
  it('reports baseline, candidate means', () => {
    const r = verdict(mk(4, 40, 60));
    expect(r.baselineMean).toBe(40);
    expect(r.candidateMean).toBe(60);
  });
});

describe('minimum cases', () => {
  it('n = minCases - 1 fails with a reason', () => {
    const r = verdict(mk(P.minCases - 1, 50, 90));
    expect(r.verified).toBe(false);
    expect(r.reasons.join(' ')).toContain(`${P.minCases - 1} case`);
    expect(r.reasons.join(' ')).toContain(`needs ${P.minCases}`);
  });
  it('n = minCases passes (boundary)', () => {
    expect(verdict(mk(P.minCases, 50, 90)).verified).toBe(true);
  });
  it('no cases at all is never verified', () => {
    const r = verdict(mk(0, 0, 0));
    expect(r.verified).toBe(false);
    expect(r.cases).toBe(0);
    expect(r.delta).toBeNull();
  });
});

describe('margin', () => {
  it('delta just under the margin fails', () => {
    const r = verdict(mk(5, 50, 50 + P.margin - 0.1));
    expect(r.verified).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/needs \+/);
  });
  it('delta exactly the margin passes', () => {
    expect(verdict(mk(5, 50, 50 + P.margin)).verified).toBe(true);
  });
  it('a negative delta fails and names the sign', () => {
    const r = verdict(mk(5, 60, 50));
    expect(r.verified).toBe(false);
    expect(r.reasons.join(' ')).toContain('-10.0 points');
  });
  it('mean delta can pass while the margin of a different policy fails', () => {
    const r = verdict(mk(5, 50, 58, { policy: { version: 3, minCases: 3, margin: 10, tieBand: 0.5, source: 'admin:bob' } }));
    expect(r.verified).toBe(false);
  });
});

describe('wins and losses', () => {
  it('losses equal to wins is allowed', () => {
    const base = mk(6, 50, 50);
    // three big wins (+30), three small losses (-10): mean +10 >= margin
    base.candidate = [80, 80, 80, 40, 40, 40].map((score, i) => ({ caseId: `c${i + 1}`, score }));
    const r = verdict(base);
    expect(r.wins).toBe(3);
    expect(r.losses).toBe(3);
    expect(r.verified).toBe(true);
  });
  it('more losses than wins fails even with a good mean', () => {
    const inp = mk(5, 50, 50);
    inp.candidate = [
      { caseId: 'c1', score: 100 },
      { caseId: 'c2', score: 49 },
      { caseId: 'c3', score: 49 },
      { caseId: 'c4', score: 49 },
      { caseId: 'c5', score: 49 },
    ];
    // mean = (50 - 4)/5 = 9.2 >= margin, wins 1, losses 4
    const r = verdict(inp);
    expect(r.delta).toBeGreaterThanOrEqual(P.margin);
    expect(r.wins).toBe(1);
    expect(r.losses).toBe(4);
    expect(r.verified).toBe(false);
    expect(r.reasons.join(' ')).toContain('lost 4 cases and won 1');
  });
  it('a difference inside the tie band is a tie', () => {
    const inp = mk(3, 50, 50);
    inp.candidate = [
      { caseId: 'c1', score: 50.5 },
      { caseId: 'c2', score: 49.5 },
      { caseId: 'c3', score: 50 },
    ];
    const r = verdict(inp);
    expect(r.ties).toBe(3);
    expect(r.wins + r.losses).toBe(0);
  });
  it('just outside the tie band counts', () => {
    const inp = mk(3, 50, 50);
    inp.candidate = [
      { caseId: 'c1', score: 50.6 },
      { caseId: 'c2', score: 49.4 },
      { caseId: 'c3', score: 50 },
    ];
    const r = verdict(inp);
    expect(r.wins).toBe(1);
    expect(r.losses).toBe(1);
    expect(r.ties).toBe(1);
  });
});

describe('failed candidate answers', () => {
  it('one failed candidate answer blocks verification', () => {
    const inp = mk(6, 50, 90);
    inp.candidate[0] = { caseId: 'c1', score: null };
    const r = verdict(inp);
    expect(r.failed).toBe(1);
    expect(r.cases).toBe(5);
    expect(r.verified).toBe(false);
    expect(r.reasons.join(' ')).toContain('1 candidate answer failed');
  });
  it('plural wording', () => {
    const inp = mk(6, 50, 90);
    inp.candidate[0] = { caseId: 'c1', score: null };
    inp.candidate[1] = { caseId: 'c2', score: null };
    expect(verdict(inp).reasons.join(' ')).toContain('2 candidate answers failed');
  });
  it('a failed baseline answer is not a candidate failure but drops the pair', () => {
    const inp = mk(6, 50, 90);
    inp.baseline[0] = { caseId: 'c1', score: null };
    const r = verdict(inp);
    expect(r.failed).toBe(0);
    expect(r.cases).toBe(5);
    expect(r.verified).toBe(true);
  });
});

describe('evaluator independence', () => {
  it('evaluator equal to author fails', () => {
    const r = verdict(mk(5, 50, 90, { evaluatorId: 'author' }));
    expect(r.verified).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/evaluator.*author/i);
  });
  it('comparison ignores case and whitespace', () => {
    expect(verdict(mk(5, 50, 90, { evaluatorId: '  AUTHOR ' })).verified).toBe(false);
  });
  it('a missing evaluator fails', () => {
    const r = verdict(mk(5, 50, 90, { evaluatorId: '' }));
    expect(r.verified).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/evaluator is missing/i);
  });
  it('a missing author fails', () => {
    expect(verdict(mk(5, 50, 90, { authorId: '' })).verified).toBe(false);
  });
});

describe('dataset hash', () => {
  it('different hashes fail', () => {
    const r = verdict(mk(5, 50, 90, { candidateDatasetHash: 'h2' }));
    expect(r.verified).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/dataset/i);
  });
  it('missing hash fails', () => {
    expect(verdict(mk(5, 50, 90, { baselineDatasetHash: '' })).verified).toBe(false);
    expect(verdict(mk(5, 50, 90, { candidateDatasetHash: '' })).verified).toBe(false);
  });
});

describe('case pairing and score sanity', () => {
  it('cases present on one side only are named and block verification', () => {
    const inp = mk(5, 50, 90);
    inp.candidate.push({ caseId: 'extra', score: 90 });
    const r = verdict(inp);
    expect(r.verified).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/not on both|only on one/i);
  });
  it('duplicate case ids fail', () => {
    const inp = mk(5, 50, 90);
    inp.candidate.push({ caseId: 'c1', score: 90 });
    expect(verdict(inp).verified).toBe(false);
  });
  it('out-of-range or non-finite scores fail', () => {
    for (const bad of [101, -1, NaN, Infinity]) {
      const inp = mk(5, 50, 90);
      inp.candidate[0] = { caseId: 'c1', score: bad };
      const r = verdict(inp);
      expect(r.verified).toBe(false);
      expect(r.reasons.join(' ')).toMatch(/score/i);
    }
  });
});

describe('reasons collect every unmet rule', () => {
  it('lists all of them at once', () => {
    const inp = mk(2, 60, 50, { evaluatorId: 'author', candidateDatasetHash: 'zz' });
    inp.candidate[0] = { caseId: 'c1', score: null };
    const r = verdict(inp);
    expect(r.verified).toBe(false);
    expect(r.reasons.length).toBeGreaterThanOrEqual(4);
  });
});

describe('detectable gain', () => {
  it('is margin + 1.645 x se for the paired deltas', () => {
    const d = detectableGain(10, 25, 5);
    expect(d.se).toBeCloseTo(2, 5);
    expect(d.gain).toBeCloseTo(5 + 1.645 * 2, 1);
    expect(d.n).toBe(25);
  });
  it('shrinks as n grows', () => {
    expect(detectableGain(10, 100, 5).gain).toBeLessThan(detectableGain(10, 10, 5).gain);
  });
  it('false-verify chance of a change that did nothing is about 5% at the detectable gain boundary and < 50% otherwise', () => {
    const d = detectableGain(10, 25, 5);
    expect(d.falseVerify).toBeGreaterThan(0);
    expect(d.falseVerify).toBeLessThan(0.5);
    expect(d.falseVerify).toBeCloseTo(0.006, 2); // z = 5/2 = 2.5 -> 0.0062
  });
  it('zero spread: no uncertainty, gain is the margin', () => {
    const d = detectableGain(0, 10, 5);
    expect(d.gain).toBe(5);
    expect(d.falseVerify).toBe(0);
  });
  it('verdict reports it from the observed spread of paired deltas, and null for n < 2', () => {
    const inp = mk(4, 50, 50);
    inp.candidate = [
      { caseId: 'c1', score: 60 },
      { caseId: 'c2', score: 70 },
      { caseId: 'c3', score: 50 },
      { caseId: 'c4', score: 80 },
    ];
    const r = verdict(inp);
    expect(r.detectable).not.toBeNull();
    expect(r.detectable!.n).toBe(4);
    expect(r.detectable!.sd).toBeGreaterThan(0);
    expect(verdict(mk(1, 50, 90)).detectable).toBeNull();
  });
});

describe('purity', () => {
  it('does not mutate its input', () => {
    const inp = mk(5, 50, 90);
    const copy = JSON.stringify(inp);
    verdict(inp);
    expect(JSON.stringify(inp)).toBe(copy);
  });
  it('is deterministic', () => {
    const inp = mk(5, 50, 90);
    expect(verdict(inp)).toEqual(verdict(inp));
  });
  it('the module imports nothing that runs a model or a process', () => {
    const src = readFileSync(new URL('../src/evolution/verdict.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/child_process|node:http|node:https|node:net|fetch\(|spawn|exec\(|anthropic|openai/i);
    expect(src).not.toMatch(/^import .* from ['"](?!\.)/m); // no package imports at all
  });
});
