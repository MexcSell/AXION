/**
 * c91 (R5-5): skill promotion gate. A PURE function: no database, no clock, no model call, no route. Nothing calls it yet.
 * It tests the gate, not any skill: every score it is run on today is synthetic (see scripts/c91-gate-fixtures.ts).
 *
 * Shapes a future caller passes: a candidate (id, the task ids that were used to write it, its contract text), and for each of three
 * task sets (probe A = the tuning probe, probe B = a held-out second probe never shown to the generator, replay = historical tasks)
 * the task ids in the set and per-class scores {n items, mean score in [0,1]} for the candidate and for the incumbent on the SAME items.
 *
 * WHAT EACH CHECK PROTECTS AGAINST
 *  (i)   gain on probe A above MARGIN_PROBE_A      : a skill that does nothing useful.
 *  (ii)  gain on probe B above MARGIN_PROBE_B      : a candidate that fits probe A by luck or by being tuned against it.
 *  (iii) per-class loss on replay <= REGRESSION_BUDGET : a skill that helps on average but breaks one kind of work.
 *  (iv)  no evidence task id is in A, B or replay  : a skill that was written from the very tasks it is scored on.
 *  (v)   MIN_ITEMS_PER_CLASS per class per set     : a verdict from too few items; the result is "not_enough_evidence", not a pass.
 *  cap   probeAAttempts <= MAX_ATTEMPTS_PER_PROBE_A : see "REPEATED CANDIDATES".
 *
 * KNOWN LIMIT: A and B have no per-class floor. Net gain is a class-balanced mean, so a candidate can win overall on A and B while losing some
 * classes there. Only replay has a per-class check (iii).
 *
 * NET GAIN is class-balanced: the plain mean over classes of (candidate mean - incumbent mean). A class with many items does not outvote one with few.
 * Comparisons: a gain must be strictly ABOVE its margin; a loss may be AT the budget but not beyond it. Both with a tolerance of 1e-9 so that
 * float noise (0.6 + 0.03 - 0.6) cannot flip a boundary case.
 *
 * REPEATED CANDIDATES (the multiple-comparisons problem on the gate itself). Every candidate scored on the same probe A is another draw
 * against it, so a candidate generator trying many variants will eventually find one that beats probe A by chance. Two defences:
 *  1. Probe B is a fresh check: it was never shown to the generator, so a chance win on A passes B only with the chance rate of B.
 *     That is what check (ii) is for. If probe B were reused for tuning it would stop being fresh.
 *  2. A cap, MAX_ATTEMPTS_PER_PROBE_A: after that many candidates on one probe A it must be replaced by a new one (checkAttemptCap).
 *     The caller counts the attempts, including the candidate now being gated, and passes it as probeAAttempts.
 * NOT COVERED: probe B itself is spent a little by every candidate that reaches it. The cap bounds A only; B needs its own refresh policy
 * once real candidates exist (EXEC). No source in R5 supports a particular number: the constants below are choices, stated, not derived.
 *
 * Verdict: 'refuse' if any definite failure applies (leakage, missing contract or evidence, bad scores, exhausted attempts, a gain too small,
 * a regression); else 'not_enough_evidence' if any set is too small; else 'admit'. 'admit' only means "may go to a human": a person still activates.
 */

/** Net gain on probe A must be strictly above this (score points, 0..1 scale). */
export const MARGIN_PROBE_A = 0.03;
/** Net gain on the held-out probe B must be strictly above this. */
export const MARGIN_PROBE_B = 0.03;
/** On replay no class may lose more than this (candidate mean below incumbent mean). A loss of exactly this is allowed. */
export const REGRESSION_BUDGET = 0.02;
/** Each class needs at least this many items, on each set, for both the candidate and the incumbent. */
export const MIN_ITEMS_PER_CLASS = 20;
/** After this many candidates on one probe A it must be refreshed (the count includes the candidate being gated). */
export const MAX_ATTEMPTS_PER_PROBE_A = 20;
const EPS = 1e-9;

export type ClassScores = Record<string, { n: number; mean: number }>;
export type ScoreSet = { taskIds: string[]; candidate: ClassScores; incumbent: ClassScores };
export type GateInput = {
  candidate: { id: string; evidenceTaskIds: string[]; contract: string };
  probeA: ScoreSet; probeB: ScoreSet; replay: ScoreSet;
  /** How many candidates (this one included) have been gated against this probe A. */
  probeAAttempts: number;
};
export type ReasonCode =
  | 'all_checks_passed' | 'probe_a_gain_too_small' | 'probe_b_gain_too_small' | 'replay_regression' | 'evidence_leakage'
  | 'probe_a_too_small' | 'probe_b_too_small' | 'replay_too_small' | 'probe_a_attempts_exhausted'
  | 'contract_missing' | 'evidence_missing' | 'invalid_scores' | 'no_classes' | 'probe_overlap';
export type Reason = { code: ReasonCode; message: string; classes?: string[]; taskIds?: string[] };
export type Decision = {
  verdict: 'admit' | 'refuse' | 'not_enough_evidence';
  reasons: Reason[];
  metrics: { gainA: number | null; gainB: number | null; replayDeltaByClass: Record<string, number> | null };
};

export function checkAttemptCap(attempts: number): { ok: boolean; remaining: number } {
  if (!Number.isInteger(attempts) || attempts < 1) throw new RangeError('attempts must be an integer >= 1');
  return { ok: attempts <= MAX_ATTEMPTS_PER_PROBE_A, remaining: Math.max(0, MAX_ATTEMPTS_PER_PROBE_A - attempts) };
}

type Check = { state: 'ok'; delta: Record<string, number> } | { state: 'small'; classes: string[] } | { state: 'invalid' };
function inspect(s: ScoreSet, required: string[]): Check {
  for (const arm of [s.candidate, s.incumbent]) for (const e of Object.values(arm)) {
    if (!Number.isInteger(e.n) || e.n < 0 || !Number.isFinite(e.mean) || e.mean < 0 || e.mean > 1) return { state: 'invalid' };
  }
  const small = required.filter((c) => !(s.candidate[c]?.n >= MIN_ITEMS_PER_CLASS && s.incumbent[c]?.n >= MIN_ITEMS_PER_CLASS));
  if (small.length) return { state: 'small', classes: small };
  return { state: 'ok', delta: Object.fromEntries(required.map((c) => [c, s.candidate[c].mean - s.incumbent[c].mean])) };
}
const avg = (o: Record<string, number>) => { const v = Object.values(o); return v.reduce((a, b) => a + b, 0) / v.length; };
const pts = (x: number) => (x >= 0 ? '+' : '') + x.toFixed(3);

export function skillGate(input: GateInput): Decision {
  const reasons: Reason[] = []; // definite failures
  const smalls: Reason[] = [];
  const { candidate, probeA, probeB, replay } = input;
  if (!candidate.contract.trim()) reasons.push({ code: 'contract_missing', message: 'the candidate has no contract text (intended behaviour and observable criteria)' });
  if (candidate.evidenceTaskIds.length === 0) reasons.push({ code: 'evidence_missing', message: 'the candidate lists no evidence tasks, so leakage cannot be checked' });
  if (!checkAttemptCap(input.probeAAttempts).ok) reasons.push({ code: 'probe_a_attempts_exhausted', message: `probe A has been used for ${input.probeAAttempts} candidates (cap ${MAX_ATTEMPTS_PER_PROBE_A}); refresh it` });

  // leakage (iv)
  const evidence = new Set(candidate.evidenceTaskIds);
  const leaked = new Set<string>();
  const where: string[] = [];
  for (const [name, s] of [['probe A', probeA], ['probe B', probeB], ['replay', replay]] as const) {
    const hit = s.taskIds.filter((t) => evidence.has(t));
    if (hit.length) { where.push(name); hit.forEach((t) => leaked.add(t)); }
  }
  if (leaked.size) reasons.push({ code: 'evidence_leakage', message: `evidence tasks also in ${where.join(', ')}`, taskIds: [...leaked].sort() });

  // A and B must be disjoint, and neither may share tasks with replay: otherwise B is not held out
  const pairs: Array<[string, ScoreSet, string, ScoreSet]> = [['probe A', probeA, 'probe B', probeB], ['probe A', probeA, 'replay', replay], ['probe B', probeB, 'replay', replay]];
  for (const [na, sa, nb, sb] of pairs) {
    const ids = new Set(sa.taskIds);
    const shared = [...new Set(sb.taskIds.filter((t) => ids.has(t)))].sort();
    if (shared.length) reasons.push({ code: 'probe_overlap', message: `${na} and ${nb} share ${shared.length} task id(s); the sets must be disjoint`, taskIds: shared });
  }
  for (const [name, s] of [['probe A', probeA], ['probe B', probeB], ['replay', replay]] as const) {
    if (s.taskIds.length === 0) reasons.push({ code: 'invalid_scores', message: `${name} lists no task ids, so leakage and overlap cannot be checked` });
  }

  // sufficiency (v) and the numeric checks (i)-(iii). Required classes = every class named anywhere (union over all six score tables),
  // so a class missing from one set, or present only in the candidate arm, is "too small" there instead of being silently skipped.
  const required = [...new Set([probeA, probeB, replay].flatMap((s) => [...Object.keys(s.candidate), ...Object.keys(s.incumbent)]))].sort();
  if (required.length === 0) {
    reasons.push({ code: 'no_classes', message: 'no task class has any score in probe A, probe B or replay; nothing to compare' });
    return { verdict: 'refuse', reasons, metrics: { gainA: null, gainB: null, replayDeltaByClass: null } };
  }
  const a = inspect(probeA, required), b = inspect(probeB, required), r = inspect(replay, required);
  let gainA: number | null = null, gainB: number | null = null, replayDelta: Record<string, number> | null = null;
  const note = (c: Check, name: string, code: 'probe_a_too_small' | 'probe_b_too_small' | 'replay_too_small') => {
    if (c.state === 'invalid') reasons.push({ code: 'invalid_scores', message: `${name} has a score outside [0,1], a non-finite number or a bad item count` });
    else if (c.state === 'small') smalls.push({ code, message: `${name}: fewer than ${MIN_ITEMS_PER_CLASS} items (or missing) in a class, for the candidate or the incumbent`, classes: c.classes });
  };
  note(a, 'probe A', 'probe_a_too_small'); note(b, 'probe B', 'probe_b_too_small'); note(r, 'replay', 'replay_too_small');
  if (a.state === 'ok') { gainA = avg(a.delta); if (!(gainA > MARGIN_PROBE_A + EPS)) reasons.push({ code: 'probe_a_gain_too_small', message: `net gain on probe A ${pts(gainA)} is not above the margin ${MARGIN_PROBE_A}` }); }
  if (b.state === 'ok') { gainB = avg(b.delta); if (!(gainB > MARGIN_PROBE_B + EPS)) reasons.push({ code: 'probe_b_gain_too_small', message: `net gain on held-out probe B ${pts(gainB)} is not above the margin ${MARGIN_PROBE_B}` }); }
  if (r.state === 'ok') {
    replayDelta = r.delta;
    const bad = required.filter((c) => -r.delta[c] > REGRESSION_BUDGET + EPS);
    if (bad.length) reasons.push({ code: 'replay_regression', message: `replay loss beyond ${REGRESSION_BUDGET} in: ${bad.map((c) => `${c} ${pts(r.delta[c])}`).join(', ')}`, classes: bad });
  }

  if (reasons.length) return { verdict: 'refuse', reasons: [...reasons, ...smalls], metrics: { gainA, gainB, replayDeltaByClass: replayDelta } };
  if (smalls.length) return { verdict: 'not_enough_evidence', reasons: smalls, metrics: { gainA, gainB, replayDeltaByClass: replayDelta } };
  return { verdict: 'admit', reasons: [{ code: 'all_checks_passed', message: 'gains on A and B above margin, no class over the regression budget, no leakage, enough items' }], metrics: { gainA, gainB, replayDeltaByClass: replayDelta } };
}
