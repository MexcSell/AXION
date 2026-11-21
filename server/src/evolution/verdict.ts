// Evaluation core for agent version proposals. Pure: no I/O, no model, no process.
// Compares a baseline and a candidate on the SAME cases and says, with reasons, whether
// the candidate is verified better. Pattern: subnet-scout evolution.py (evidence, _detectable).

export interface EvaluationPolicy {
  readonly version: number;
  /** minimum number of cases scored on both versions */
  readonly minCases: number;
  /** minimum mean gain of the candidate, in score points (scores run 0..100) */
  readonly margin: number;
  /** a per-case difference of at most this many points is a tie */
  readonly tieBand: number;
  /** where this policy came from; recorded in every verdict */
  readonly source: string;
  /** who set it (when not built in); never the candidate author */
  readonly setBy?: string;
}

export const EVALUATION_POLICY_V1: EvaluationPolicy = Object.freeze({
  version: 1,
  minCases: 5,
  margin: 5,
  tieBand: 0.5,
  source: 'built-in',
});

export interface CaseScore {
  caseId: string;
  /** 0..100, or null when the answer failed */
  score: number | null;
}

export interface VerdictInput {
  baseline: CaseScore[];
  candidate: CaseScore[];
  baselineDatasetHash: string;
  candidateDatasetHash: string;
  authorId: string;
  evaluatorId: string;
  /** optional; defaults to the built-in policy. Its source is echoed in the output. */
  policy?: EvaluationPolicy;
}

export interface Detectable {
  n: number;
  sd: number;
  se: number;
  /** smallest true gain (points) the trial shows about 19 times in 20 */
  gain: number;
  /** chance that a change that did nothing is verified */
  falseVerify: number;
}

export interface Verdict {
  verified: boolean;
  reasons: string[];
  cases: number;
  baselineMean: number | null;
  candidateMean: number | null;
  delta: number | null;
  wins: number;
  losses: number;
  ties: number;
  failed: number;
  policy: { version: number; minCases: number; margin: number; tieBand: number; source: string };
  detectable: Detectable | null;
}

/** one-sided 95% point of the normal curve */
const Z = 1.645;

const r1 = (x: number) => Math.round(x * 10) / 10;
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const norm = (s: unknown) => (typeof s === 'string' ? s.trim().toLowerCase() : '');

// Abramowitz-Stegun 7.1.26, absolute error < 1.5e-7
function erfc(x: number): number {
  const s = x < 0 ? -1 : 1;
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-a * a);
  return s > 0 ? 1 - y : 1 + y;
}

export function detectableGain(sd: number, n: number, margin: number): Detectable {
  const se = sd * Math.sqrt(1 / Math.max(1, n));
  const falseVerify = se > 0 ? 0.5 * erfc(margin / se / Math.SQRT2) : margin > 0 ? 0 : 0.5;
  return { n, sd: r3(sd), se: r3(se), gain: r1(margin + Z * se), falseVerify: r3(falseVerify) };
}

function policyProblem(p: EvaluationPolicy, authorId: string): string | null {
  if (
    !Number.isFinite(p.version) ||
    !Number.isInteger(p.minCases) ||
    p.minCases < 1 ||
    !Number.isFinite(p.margin) ||
    p.margin < 0 ||
    !Number.isFinite(p.tieBand) ||
    p.tieBand < 0 ||
    !p.source
  ) {
    return 'the evaluation policy is invalid';
  }
  if (p.setBy !== undefined && authorId && norm(p.setBy) === norm(authorId)) {
    return 'the evaluation policy was set by the candidate author; the author cannot set the rules';
  }
  return null;
}

export function verdict(input: VerdictInput): Verdict {
  const policy = input.policy ?? EVALUATION_POLICY_V1;
  const reasons: string[] = [];
  const policyOut = {
    version: policy.version,
    minCases: policy.minCases,
    margin: policy.margin,
    tieBand: policy.tieBand,
    source: policy.source,
  };

  const pol = policyProblem(policy, input.authorId);
  if (pol) reasons.push(pol);

  // identity rules
  if (!norm(input.authorId)) reasons.push('the author of the candidate is missing');
  if (!norm(input.evaluatorId)) reasons.push('the evaluator is missing');
  else if (norm(input.evaluatorId) === norm(input.authorId)) {
    reasons.push('the evaluator is the author of the candidate; someone else must evaluate it');
  }
  if (!input.baselineDatasetHash || !input.candidateDatasetHash) {
    reasons.push('the dataset hash is missing for one of the runs');
  } else if (input.baselineDatasetHash !== input.candidateDatasetHash) {
    reasons.push('the two runs used different datasets (hashes differ)');
  }

  // index each side; duplicates and bad scores are reasons, not exceptions
  const index = (rows: CaseScore[], label: string) => {
    const m = new Map<string, number | null>();
    let dup = 0;
    let bad = 0;
    for (const r of rows) {
      if (m.has(r.caseId)) dup++;
      m.set(r.caseId, r.score);
      if (r.score !== null && !(Number.isFinite(r.score) && r.score >= 0 && r.score <= 100)) bad++;
    }
    if (dup) reasons.push(`${label} has ${plural(dup, 'duplicate case id')}`);
    if (bad) reasons.push(`${label} has ${plural(bad, 'score')} outside 0..100 or not a number`);
    return m;
  };
  const b = index(input.baseline, 'the baseline');
  const c = index(input.candidate, 'the candidate');

  let unpaired = 0;
  for (const k of b.keys()) if (!c.has(k)) unpaired++;
  for (const k of c.keys()) if (!b.has(k)) unpaired++;
  if (unpaired) reasons.push(`${plural(unpaired, 'case')} not on both versions; both must run the same cases`);

  let failed = 0;
  const pairs: Array<[number, number]> = [];
  for (const [k, cs] of c) {
    if (cs === null) failed++;
    const bs = b.get(k);
    if (bs === undefined || bs === null || cs === null) continue;
    if (Number.isFinite(bs) && Number.isFinite(cs)) pairs.push([bs, cs]);
  }
  const n = pairs.length;
  const bm = n ? pairs.reduce((s, p) => s + p[0], 0) / n : null;
  const cm = n ? pairs.reduce((s, p) => s + p[1], 0) / n : null;
  const delta = bm !== null && cm !== null ? cm - bm : null;
  const wins = pairs.filter(([x, y]) => y > x + policy.tieBand).length;
  const losses = pairs.filter(([x, y]) => y < x - policy.tieBand).length;

  if (n < policy.minCases) {
    reasons.push(`${plural(n, 'case')} scored on both versions; the policy needs ${policy.minCases}`);
  }
  if (delta !== null && delta < policy.margin) {
    reasons.push(
      `the candidate is ${delta >= 0 ? '+' : ''}${r1(delta).toFixed(1)} points; the policy needs +${policy.margin}`,
    );
  }
  if (losses > wins) reasons.push(`it lost ${plural(losses, 'case')} and won ${wins}`);
  if (failed) {
    reasons.push(`${failed} candidate ${failed === 1 ? 'answer' : 'answers'} failed`);
  }

  let detectable: Detectable | null = null;
  if (n >= 2 && delta !== null) {
    const ds = pairs.map(([x, y]) => y - x);
    const mean = ds.reduce((s, d) => s + d, 0) / n;
    const sd = Math.sqrt(ds.reduce((s, d) => s + (d - mean) ** 2, 0) / (n - 1));
    detectable = detectableGain(sd, n, policy.margin);
  }

  return {
    verified: reasons.length === 0 && n > 0,
    reasons,
    cases: n,
    baselineMean: bm === null ? null : r1(bm),
    candidateMean: cm === null ? null : r1(cm),
    delta: delta === null ? null : r1(delta),
    wins,
    losses,
    ties: n - wins - losses,
    failed,
    policy: policyOut,
    detectable,
  };
}
