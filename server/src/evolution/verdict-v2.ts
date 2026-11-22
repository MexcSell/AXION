// Evaluation verdict, policy version 2. Pure: no I/O, no model, no process.
// v1 (verdict.ts) stays as it was. v2 asks for significance, has an explicit inconclusive outcome, reports pass^k and
// cost, and refuses unless the evaluation is honest: frozen hashed holdout, no dev/holdout reuse, independent judge.
// Sources: tau-bench pass^k, "Adding Error Bars to Evals", "AI Agents That Matter", SWE-Bench+, LLM judges self-preference.
import { createHash } from 'node:crypto';
import { signTestTwoSided, pairedMeanCI, passHatK } from './stats.js';

export interface EvaluationPolicyV2 {
  readonly version: 2;
  /** significance level of the two-sided sign test */
  readonly alpha: number;
  /** minimum number of cases scored on both versions */
  readonly minCases: number;
  /** minimum mean gain of the candidate, in score points (0..100) */
  readonly margin: number;
  /** a per-case difference of at most this many points is a tie */
  readonly tieBand: number;
  /** an attempt passes when its score is at least this */
  readonly passScore: number;
  /** c61: each run must have at least this fraction of its attempts GRADED, or the verdict is inconclusive (never "worse") */
  readonly minGradedFraction: number;
  readonly source: string;
}

export const EVALUATION_POLICY_V2: EvaluationPolicyV2 = Object.freeze({
  version: 2,
  alpha: 0.05,
  minCases: 10,
  margin: 5,
  tieBand: 0.5,
  passScore: 70,
  minGradedFraction: 0.8,
  source: 'built-in',
});

/** `ungraded` (c61): a reason code means the grader produced NO grade for this attempt. That is not a failure: it is left out of every
    number. A null score without a reason stays what it was in c47/c53: an attempt that failed, graded as 0 and not passing. */
export interface Attempt { score: number | null; costUnits: number; ungraded?: string | null }
export interface CaseRuns { caseId: string; attempts: Attempt[] }

export interface HoldoutRef {
  datasetId: string;
  split: 'dev' | 'holdout';
  /** content_sha256 stored when the dataset was frozen; null when it is not frozen */
  frozenSha256: string | null;
  /** hash recomputed from the cases actually used in the runs */
  observedSha256: string;
}

export interface VerdictV2Input {
  baseline: CaseRuns[];
  candidate: CaseRuns[];
  holdout: HoldoutRef;
  /** every dataset that was used to tune the candidate (the dev side) */
  tunedOnDatasetIds: string[];
  authorId: string;
  evaluatorId: string;
  candidateModelFamily: string;
  judgeModelFamily: string;
  /** c61: who graded each run. Omitted = not checked (the pure callers of c47). `linked`: a valid re-grade diff joins the two versions. */
  graders?: { baseline: GraderRef | null; candidate: GraderRef | null; linked: boolean };
}
export interface GraderRef { name: string; version: string }

export type Outcome = 'verified_better' | 'not_better' | 'inconclusive';
export type RefusalCode =
  | 'holdout_missing' | 'not_holdout' | 'not_frozen' | 'hash_mismatch' | 'dev_holdout_reuse' | 'self_judging'
  | 'evaluator_is_author' | 'unequal_attempts' | 'unpaired_cases' | 'bad_scores' | 'grader_mismatch';

export interface GradingCount { attempted: number; graded: number }
export interface VerdictV2 {
  outcome: Outcome;
  reasons: string[];
  /** facts to state next to the outcome (for example cost) that do not change it */
  notes: string[];
  refusals: Array<{ code: RefusalCode; detail: string }>;
  cases: number;
  k: number;
  /** c61: the graded fraction of each run, stated beside every pass rate. Ungraded attempts are left out of the numbers below. */
  grading: { baseline: GradingCount; candidate: GradingCount; excludedCases: number; sufficient: boolean; minFraction: number };
  baselineMean: number | null;
  candidateMean: number | null;
  delta: number | null;
  signTest: { wins: number; losses: number; ties: number; n: number; p: number };
  ci: { low: number | null; high: number | null; level: 0.95; method: 't' };
  passAt1: { baseline: number | null; candidate: number | null };
  /** index i is pass^(i+1) for i < k */
  passHatK: { baseline: Array<number | null>; candidate: Array<number | null> };
  cost: { baselinePerCase: number | null; candidatePerCase: number | null; deltaPct: number | null };
  policy: { version: 2; alpha: number; minCases: number; margin: number; tieBand: number; passScore: number; minGradedFraction: number; source: string };
}

const r1 = (x: number) => Math.round(x * 10) / 10;
const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
const norm = (s: unknown) => (typeof s === 'string' ? s.trim().toLowerCase() : '');
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

function canonical(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return '{' + Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => JSON.stringify(k) + ':' + canonical(o[k])).join(',') + '}';
  }
  return JSON.stringify(v) ?? 'null';
}

/** sha256 over the cases sorted by id with keys sorted, so the same content always hashes the same. */
export function hashDataset(cases: Array<{ caseId: string; input: unknown; expected: unknown }>): string {
  const sorted = [...cases].sort((a, b) => (a.caseId < b.caseId ? -1 : a.caseId > b.caseId ? 1 : 0));
  return createHash('sha256').update(canonical(sorted)).digest('hex');
}

export function verdictV2(input: VerdictV2Input): VerdictV2 {
  const P = EVALUATION_POLICY_V2;
  const reasons: string[] = [];
  const notes: string[] = [];
  const refusals: VerdictV2['refusals'] = [];
  const refuse = (code: RefusalCode, detail: string) => { refusals.push({ code, detail }); reasons.push(detail); };

  // honesty rules: the evaluation itself must be sound before any number counts
  const h = input.holdout;
  if (!h || !h.datasetId) refuse('holdout_missing', 'the verdict does not name a holdout dataset');
  else {
    if (h.split !== 'holdout') refuse('not_holdout', `dataset ${h.datasetId} is a ${String(h.split)} split, not a holdout`);
    if (!h.frozenSha256) refuse('not_frozen', `dataset ${h.datasetId} is not frozen, so its content cannot be trusted`);
    else if (h.frozenSha256 !== h.observedSha256) refuse('hash_mismatch', `dataset ${h.datasetId} content hash differs from the frozen value`);
    if ((input.tunedOnDatasetIds ?? []).includes(h.datasetId)) {
      refuse('dev_holdout_reuse', `dataset ${h.datasetId} was used to tune the candidate and cannot also judge it`);
    }
  }
  if (!norm(input.judgeModelFamily) || norm(input.judgeModelFamily) === norm(input.candidateModelFamily)) {
    refuse('self_judging', `the judge model family (${input.judgeModelFamily || 'missing'}) is the candidate's own; a different family must judge`);
  }
  if (!norm(input.authorId) || !norm(input.evaluatorId) || norm(input.authorId) === norm(input.evaluatorId)) {
    refuse('evaluator_is_author', 'the evaluator is missing or is the author of the candidate; someone else must evaluate it');
  }

  // c61: two runs are comparable only when the same grader (name and version) scored both, or a re-grade diff links them.
  // Not recorded on both = equal (every run before c61); recorded on one only = different.
  if (input.graders) {
    const { baseline: gb, candidate: gc, linked } = input.graders;
    const same = gb === null && gc === null ? true : gb !== null && gc !== null && gb.name === gc.name && gb.version === gc.version;
    if (!same && !linked) {
      const show = (g: GraderRef | null) => (g ? `${g.name} ${g.version}` : 'not recorded');
      refuse('grader_mismatch', `the two runs were graded by different graders (base: ${show(gb)}, candidate: ${show(gc)}) and no re-grade diff links them; re-grade one run with the other's grader and record the diff`);
    }
  }

  // index per case
  const idx = (rows: CaseRuns[]) => new Map(rows.map((r) => [r.caseId, r.attempts] as const));
  const B = idx(input.baseline);
  const C = idx(input.candidate);
  const shared = [...C.keys()].filter((id) => B.has(id)).sort();
  const unpaired = B.size + C.size - 2 * shared.length;
  if (unpaired) refuse('unpaired_cases', `${plural(unpaired, 'case')} not on both versions; both must run the same cases`);
  if (B.size !== input.baseline.length || C.size !== input.candidate.length) refuse('unpaired_cases', 'duplicate case ids in a run');

  let k = 0;
  let unequal = false;
  let bad = 0;
  for (const id of shared) {
    const a = B.get(id)!;
    const b = C.get(id)!;
    if (a.length !== b.length || a.length === 0) unequal = true;
    k = k === 0 ? Math.min(a.length, b.length) : Math.min(k, a.length, b.length);
    for (const x of [...a, ...b]) {
      if (x.score !== null && !(Number.isFinite(x.score) && x.score >= 0 && x.score <= 100)) bad++;
      if (!Number.isFinite(x.costUnits) || x.costUnits < 0) bad++;
    }
  }
  if (unequal) refuse('unequal_attempts', 'a case has a different number of attempts on the two versions (or none)');
  if (bad) refuse('bad_scores', `${plural(bad, 'attempt')} with a score outside 0..100 or a bad cost`);

  // c61: ungraded attempts are no grade, not a failure. Count them per run, then leave out every case that has one on either side.
  const count = (rows: CaseRuns[]): GradingCount => {
    const all = rows.flatMap((r) => r.attempts);
    return { attempted: all.length, graded: all.filter((a) => !a.ungraded).length };
  };
  const gB = count(input.baseline), gC = count(input.candidate);
  const frac = (g: GradingCount) => (g.attempted ? g.graded / g.attempted : 1);
  const sufficient = frac(gB) >= P.minGradedFraction && frac(gC) >= P.minGradedFraction;
  const gradable = shared.filter((id) => [...B.get(id)!, ...C.get(id)!].every((a) => !a.ungraded));
  const excludedCases = shared.length - gradable.length;
  const grading = { baseline: gB, candidate: gC, excludedCases, sufficient, minFraction: P.minGradedFraction };

  // numbers (a failed attempt, score null, counts as 0 and as not passing)
  const sc = (x: Attempt) => x.score ?? 0;
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const caseMean = (a: Attempt[]) => mean(a.map(sc));
  const pairs = gradable.map((id) => [caseMean(B.get(id)!), caseMean(C.get(id)!)] as const);
  const n = pairs.length;
  const diffs = pairs.map(([x, y]) => y - x);
  const wins = diffs.filter((d) => d > P.tieBand).length;
  const losses = diffs.filter((d) => d < -P.tieBand).length;
  const ties = n - wins - losses;
  const sign = signTestTwoSided(wins, losses);
  const ci = pairedMeanCI(diffs);
  const bm = n ? mean(pairs.map((p) => p[0])) : null;
  const cm = n ? mean(pairs.map((p) => p[1])) : null;
  const delta = bm !== null && cm !== null ? cm - bm : null;

  const passes = (m: Map<string, Attempt[]>) => gradable.map((id) => m.get(id)!.map((a) => a.score !== null && a.score >= P.passScore));
  const hat = (m: Map<string, Attempt[]>) => {
    const rows = passes(m);
    return Array.from({ length: k }, (_, i) => { const v = passHatK(rows, i + 1); return v === null ? null : r4(v); });
  };
  const bh = k ? hat(B) : [];
  const ch = k ? hat(C) : [];

  const perCase = (m: Map<string, Attempt[]>) => (n ? mean(shared.map((id) => m.get(id)!.reduce((s, a) => s + a.costUnits, 0))) : null);
  const bc = perCase(B);
  const cc = perCase(C);
  const costPct = bc !== null && cc !== null && bc > 0 ? ((cc - bc) / bc) * 100 : null;

  // outcome
  let outcome: Outcome = 'inconclusive';
  if (refusals.length === 0) {
    if (!sufficient) {
      const f = (g: GradingCount) => `${g.graded} of ${g.attempted}`;
      reasons.push(`too few attempts were graded (base ${f(gB)}, candidate ${f(gC)}; the policy needs ${Math.round(P.minGradedFraction * 100)}% of each run); an ungraded attempt is not a failure, so no verdict is drawn`);
    } else if (n < P.minCases) {
      reasons.push(`${plural(n, 'case')} scored on both versions; the policy needs ${P.minCases}`);
    } else if (sign.p >= P.alpha) {
      reasons.push(
        `not significant: sign test p = ${r4(sign.p)} on ${wins} wins and ${losses} losses (${plural(ties, 'tie')} excluded); the policy needs p < ${P.alpha}`,
      );
    } else if (losses > wins) {
      outcome = 'not_better';
      reasons.push(`significantly worse: it lost ${plural(losses, 'case')} and won ${wins} (p = ${r4(sign.p)})`);
    } else if (delta !== null && delta < P.margin) {
      outcome = 'not_better';
      reasons.push(`significant, but the mean gain is ${delta >= 0 ? '+' : ''}${r1(delta)} points; the margin needs +${P.margin}`);
    } else if (ci.low !== null && ci.low <= 0) {
      reasons.push(`the 95% interval of the mean difference (${r1(ci.low)} to ${r1(ci.high ?? 0)}) includes 0, so the gain is not established`);
    } else {
      outcome = 'verified_better';
    }
  }
  if (excludedCases > 0) notes.push(`${plural(excludedCases, 'case')} left out because an attempt was ungraded (not counted as a failure)`);
  if (outcome === 'verified_better' && costPct !== null && costPct > 0) {
    notes.push(`better but costlier by ${r1(costPct)}%`.replace(/\.0%/, '%'));
  } else if (costPct !== null && costPct > 0) {
    notes.push(`costs ${r1(costPct)}% more per case`.replace(/\.0%/, '%'));
  }

  return {
    outcome,
    reasons,
    notes,
    refusals,
    cases: n,
    k,
    grading,
    baselineMean: bm === null ? null : r1(bm),
    candidateMean: cm === null ? null : r1(cm),
    delta: delta === null ? null : r1(delta),
    signTest: { wins, losses, ties, n: sign.n, p: sign.p },
    ci: { low: ci.low, high: ci.high, level: 0.95, method: 't' },
    passAt1: { baseline: bh[0] ?? null, candidate: ch[0] ?? null },
    passHatK: { baseline: bh, candidate: ch },
    cost: { baselinePerCase: bc, candidatePerCase: cc, deltaPct: costPct === null ? null : r1(costPct) },
    policy: { version: 2, alpha: P.alpha, minCases: P.minCases, margin: P.margin, tieBand: P.tieBand, passScore: P.passScore, minGradedFraction: P.minGradedFraction, source: P.source },
  };
}
