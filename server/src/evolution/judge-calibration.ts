import type { Tx } from '../db.ts';
import { judgeFamily, JudgeLabelError } from './eval-runs.ts';
import { EVALUATION_POLICY_V2 } from './verdict-v2.ts';

/**
 * c61 (R2-1): judge calibration SCAFFOLD. Judges exist today only as family labels (c53), so nothing in a proposal's verdict calls this
 * yet. Pure arithmetic over stored human labels: no model call, no execution, no route.
 *
 * ESTIMATOR. A1: Chungpa Lee, Thomas Zeng, Jongwon Jeong, Jy-yong Sohn, Kangwook Lee, "How to Correctly Report LLM-as-a-Judge Evaluations",
 * ICML 2026, arXiv 2511.21140 (v4). With test size n, judged pass rate p̂, and a calibration set of m1 human-positive and m0 human-negative
 * items on which the judge had sensitivity q̂1 and specificity q̂0:
 *   point estimate (Eq. 7, Rogan-Gladen):  θ̂ = (p̂ + q̂0 − 1) / (q̂0 + q̂1 − 1)
 *   interval (Eq. 8-12, adjusted Wald, "add two successes and two failures"): ñ = n + z², m̃0 = m0 + 2, m̃1 = m1 + 2,
 *     p̃ = (n p̂ + z²/2) / ñ, q̃0 = (m0 q̂0 + 1) / m̃0, q̃1 = (m1 q̂1 + 1) / m̃1, θ̃ = (p̃ + q̃0 − 1) / (q̃0 + q̃1 − 1),
 *     interval = θ̃ + dθ̃ ± z · sqrt( [ p̃(1−p̃)/ñ + (1−θ̃)² q̃0(1−q̃0)/m̃0 + θ̃² q̃1(1−q̃1)/m̃1 ] / (q̃0 + q̃1 − 1)² ), truncated to [0, 1],
 *     with the centring term dθ̃ = 2z² [ −(1−θ̃) q̃0(1−q̃0)/m̃0 + θ̃ q̃1(1−q̃1)/m̃1 ] as the paper states it (it says the term is negligible).
 * The formulas were checked term by term against the LaTeX source in the paper's HTML page (arXiv 2511.21140v4), including the 2z² centring term;
 * `center: false` drops that term (the paper's length analysis does).
 *
 * SCOPE. BINARY judge verdicts. Mapped to AXION: one pass/fail verdict per case (attempt 1, "passed" = score at or above the policy's
 * passScore), so the n units are distinct cases. A1 assumes the judge's error rates on the test set equal those on the calibration
 * items (its Eq. 18), human labels are ground truth, and q0 + q1 > 1.
 *
 * What is OURS, not A1's: the minimum calibration size per class, the minimum margin q̃0 + q̃1 − 1, the Wilson interval shown for the
 * RAW rate, and the two-version comparison rule in calibratedVerdict (non-overlap by the margin).
 */
export const ESTIMATOR = 'A1 (Lee et al., ICML 2026, arXiv 2511.21140): Rogan-Gladen point estimate (Eq. 7) with the adjusted-Wald interval (Eq. 8-12)';
export const ESTIMATOR_SCOPE = 'binary judge verdicts, mapped to one pass/fail verdict per case (attempt 1); human labels are ground truth; the judge errs equally on calibration and test items';

/** Human-labelled items needed in EACH class (human-positive and human-negative) before a corrected estimate is made. Ours, chosen from the coverage grid (fix round): with 10 per class the interval under-covers. (A1's "10 per class" is the size of its pilot allocation sample, not an inference minimum.) */
export const MIN_CALIBRATION_PER_CLASS = 20;
/** POLICY (controller ruling, c61 fix round): fail closed. A corrected verdict is issued only for a judge whose adjusted q̃0 + q̃1 − 1 (sensitivity + specificity − 1) is at least this; below it the verdict is inconclusive with `judge_too_weak`. The coverage guarantee holds only for judges that clearly pass it. Selection on the observed margin biases the interval for a judge whose true margin is near any floor, so weak judges are unreliable even when they pass a gate (see the report). */
export const MIN_JUDGE_MARGIN = 0.5;
const Z95 = 1.959963984540054;

export interface Calibration { tp: number; fn: number; tn: number; fp: number }
export type EstimateStatus = 'ok' | 'no_calibration' | 'too_few_calibration' | 'judge_too_weak' | 'no_test_items';
export interface Interval { rate: number | null; low: number | null; high: number | null }
export interface RateEstimate {
  n: number; judgedPass: number;
  /** what the judge said, unadjusted, with a Wilson 95% interval */
  raw: Interval;
  /** the bias-corrected rate and interval; all null unless status is ok */
  corrected: Interval;
  sensitivity: number | null; specificity: number | null;
  status: EstimateStatus; reason: string | null;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const isCount = (x: unknown) => typeof x === 'number' && Number.isInteger(x) && x >= 0;
const NONE: Interval = { rate: null, low: null, high: null };

/** The c61 behaviour (margin gate on all labels, interval from the same labels). Kept as the reproduction baseline for the c84 simulation. */
export function correctedPassRateGate(o: { judgedPass: number; n: number; calibration: Calibration | null; z?: number; center?: boolean; minPerClass?: number; minJudgeMargin?: number }): RateEstimate {
  const minPerClass = o.minPerClass ?? MIN_CALIBRATION_PER_CLASS, minMargin = o.minJudgeMargin ?? MIN_JUDGE_MARGIN;
  const { judgedPass, n, calibration } = o;
  const z = o.z ?? Z95;
  if (!isCount(n) || !isCount(judgedPass) || judgedPass > n) throw new Error('judgedPass and n must be counts with judgedPass <= n');
  if (calibration && !(isCount(calibration.tp) && isCount(calibration.fn) && isCount(calibration.tn) && isCount(calibration.fp))) throw new Error('calibration counts must be non-negative integers');
  const base = { n, judgedPass, sensitivity: null, specificity: null, corrected: NONE } as const;
  if (n === 0) return { ...base, raw: NONE, status: 'no_test_items', reason: 'no test items were judged' };
  const p = judgedPass / n;
  const wc = (judgedPass + z * z / 2) / (n + z * z), wh = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / (1 + z * z / n);
  const raw: Interval = { rate: p, low: clamp01(wc - wh), high: clamp01(wc + wh) };
  const m1 = calibration ? calibration.tp + calibration.fn : 0, m0 = calibration ? calibration.tn + calibration.fp : 0;
  if (!calibration || m0 + m1 === 0) return { ...base, raw, status: 'no_calibration', reason: 'no human-labelled calibration items for this judge on this dataset' };
  const q1 = calibration.tp / (m1 || 1), q0 = calibration.tn / (m0 || 1);
  const sens = m1 ? q1 : null, spec = m0 ? q0 : null;
  if (m0 < minPerClass || m1 < minPerClass) {
    return { ...base, raw, sensitivity: sens, specificity: spec, status: 'too_few_calibration', reason: `${m1} human-positive and ${m0} human-negative calibration items; ${minPerClass} of each are needed` };
  }
  const weak = (why: string): RateEstimate => ({ ...base, raw, sensitivity: q1, specificity: q0, status: 'judge_too_weak', reason: why });
  if (q0 + q1 <= 1) return weak(`sensitivity ${q1.toFixed(2)} plus specificity ${q0.toFixed(2)} is not above 1: the judge is no better than chance, so its verdicts cannot be corrected`);
  const nT = n + z * z, m0T = m0 + 2, m1T = m1 + 2;
  const pT = (judgedPass + z * z / 2) / nT, q0T = (calibration.tn + 1) / m0T, q1T = (calibration.tp + 1) / m1T;
  const D = q0T + q1T - 1;
  if (D < minMargin) return weak(`the judge's adjusted sensitivity plus specificity minus 1 is ${D.toFixed(2)}, under the ${minMargin} needed to correct it`);
  const v0 = q0T * (1 - q0T) / m0T, v1 = q1T * (1 - q1T) / m1T;
  const thetaT = (pT + q0T - 1) / D;
  const d = o.center === false ? 0 : 2 * z * z * (-(1 - thetaT) * v0 + thetaT * v1);
  const half = z * Math.sqrt((pT * (1 - pT) / nT + (1 - thetaT) ** 2 * v0 + thetaT ** 2 * v1) / (D * D));
  const theta = (p + q0 - 1) / (q0 + q1 - 1);
  return { ...base, raw, sensitivity: q1, specificity: q0, status: 'ok', reason: null, corrected: { rate: clamp01(theta), low: clamp01(thetaT + d - half), high: clamp01(thetaT + d + half) } };
}

export const correctedPassRate = correctedPassRateGate;

// ---- c84 (E1e): remedies for selection bias in the margin gate ----------------------------------------------------------
/**
 * SPLIT RULE (written and committed BEFORE any grid was run with it; chosen by reasoning, never tuned on coverage):
 *  1. Each class (human-positive, human-negative) is divided in half: the pilot takes floor(m/2) items of the class, the holdout the rest
 *     (so the holdout is never the smaller part). One half each, because the two jobs (deciding eligibility, then estimating the interval)
 *     need the same kind of information and neither is more important; a fraction other than 1/2 would have to be tuned.
 *  2. Which items go to the pilot is a pseudo-random draw without replacement, driven by a fixed generator seeded only by the four
 *     calibration counts (not by the test counts, not by the grid). So base and candidate runs, which share the table, share the split.
 *  3. ELIGIBILITY is decided on the pilot alone: at least 10 of each class in the pilot and the adjusted margin q̃0 + q̃1 - 1 at least
 *     MIN_JUDGE_MARGIN. (With the standing minimum of 20 per class in total, the pilot has at least 10 per class and so does the holdout.)
 *  4. The INTERVAL is computed from the holdout labels only (the same adjusted-Wald formula), never from the pilot. The only test on the
 *     holdout is that it is able to produce a finite interval at all: raw and adjusted q0 + q1 - 1 above 0. Otherwise: no interval.
 *  5. Fail closed: an ineligible judge, or a holdout that cannot support an interval, gives NO interval ("not enough evidence"), never a
 *     wider guess.
 * Why this helps: the gate looks only at the pilot; the interval uses labels the gate never saw, so being let through says nothing about
 * how lucky the holdout is. What stays conditioned on: the pilot, and the question whether the holdout margin is above 0.
 */
export const SPLIT_PILOT_FRACTION = 0.5;
export const MIN_PILOT_PER_CLASS = 10;
export const MIN_HOLDOUT_PER_CLASS = 10;
const SPLIT_SEED_TAG = 'c84-split-v1';

function splitRng(seedText: string) {
  let h = 2166136261;
  for (let i = 0; i < seedText.length; i++) { h ^= seedText.charCodeAt(i); h = Math.imul(h, 16777619); }
  let a = h >>> 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** `k` draws without replacement from `a` items of one kind and `b` of the other; returns how many of the first kind were drawn. */
function hypergeometric(rng: () => number, a: number, b: number, k: number): number {
  let first = 0, ra = a, rt = a + b;
  for (let i = 0; i < k; i++) { if (rng() * rt < ra) { first++; ra--; } rt--; }
  return first;
}
export interface CalibrationSplit { pilot: Calibration; holdout: Calibration }
/** Rule 1 and 2 above: a deterministic split of the 2x2 table into pilot and holdout tables. */
export function splitCalibration(cal: Calibration, fraction: number = SPLIT_PILOT_FRACTION): CalibrationSplit {
  const rng = splitRng(`${SPLIT_SEED_TAG}:${cal.tp}:${cal.fn}:${cal.tn}:${cal.fp}`);
  const m1 = cal.tp + cal.fn, m0 = cal.tn + cal.fp;
  const k1 = Math.floor(m1 * fraction), k0 = Math.floor(m0 * fraction);
  const ptp = hypergeometric(rng, cal.tp, cal.fn, k1), ptn = hypergeometric(rng, cal.tn, cal.fp, k0);
  return {
    pilot: { tp: ptp, fn: k1 - ptp, tn: ptn, fp: k0 - ptn },
    holdout: { tp: cal.tp - ptp, fn: cal.fn - (k1 - ptp), tn: cal.tn - ptn, fp: cal.fp - (k0 - ptn) },
  };
}

/** The adjusted-Wald corrected interval (A1 Eq. 8-12) from one calibration table; null when the table cannot support one (q̃0 + q̃1 - 1 not above 0). */
function adjustedWald(judgedPass: number, n: number, c: Calibration, z: number, center: boolean): Interval | null {
  const m0 = c.tn + c.fp, m1 = c.tp + c.fn;
  const nT = n + z * z, m0T = m0 + 2, m1T = m1 + 2;
  const pT = (judgedPass + z * z / 2) / nT, q0T = (c.tn + 1) / m0T, q1T = (c.tp + 1) / m1T;
  const D = q0T + q1T - 1;
  if (!(D > 0)) return null;
  const v0 = q0T * (1 - q0T) / m0T, v1 = q1T * (1 - q1T) / m1T;
  const thetaT = (pT + q0T - 1) / D;
  const d = center ? 2 * z * z * (-(1 - thetaT) * v0 + thetaT * v1) : 0;
  const half = z * Math.sqrt((pT * (1 - pT) / nT + (1 - thetaT) ** 2 * v0 + thetaT ** 2 * v1) / (D * D));
  const q0 = m0 ? c.tn / m0 : 0, q1 = m1 ? c.tp / m1 : 0;
  if (!(q0 + q1 > 1)) return null;
  const theta = (judgedPass / n + q0 - 1) / (q0 + q1 - 1);
  return { rate: clamp01(theta), low: clamp01(thetaT + d - half), high: clamp01(thetaT + d + half) };
}

export type RemedyStatus = 'ok' | 'ineligible' | 'unbounded';
export interface RemedyResult { status: RemedyStatus; corrected: Interval; reason: string | null }

/** Remedy 1, sample splitting: eligibility from the pilot, interval from the holdout (rules 3 to 5 above). Pure. */
export function splitInterval(o: { judgedPass: number; n: number; pilot: Calibration; holdout: Calibration; z?: number; center?: boolean; minJudgeMargin?: number }): RemedyResult {
  const z = o.z ?? Z95, minMargin = o.minJudgeMargin ?? MIN_JUDGE_MARGIN;
  const { pilot, holdout } = o;
  const no = (why: string): RemedyResult => ({ status: 'ineligible', corrected: NONE, reason: why });
  if (pilot.tp + pilot.fn < MIN_PILOT_PER_CLASS || pilot.tn + pilot.fp < MIN_PILOT_PER_CLASS) return no('not enough evidence: the pilot part of the calibration labels is too small to decide eligibility');
  if (holdout.tp + holdout.fn < MIN_HOLDOUT_PER_CLASS || holdout.tn + holdout.fp < MIN_HOLDOUT_PER_CLASS) return no('not enough evidence: the holdout part of the calibration labels is too small');
  const D = (pilot.tn + 1) / (pilot.tn + pilot.fp + 2) + (pilot.tp + 1) / (pilot.tp + pilot.fn + 2) - 1;
  if (D < minMargin) return no(`not enough evidence: on the pilot labels the judge's adjusted sensitivity plus specificity minus 1 is ${D.toFixed(2)}, under the ${minMargin} needed`);
  const w = adjustedWald(o.judgedPass, o.n, holdout, z, o.center !== false);
  if (!w) return no('not enough evidence: on the holdout labels the judge is not better than chance, so no finite interval exists');
  return { status: 'ok', corrected: w, reason: null };
}

/**
 * Remedy 3, a Fieller-type interval, no eligibility gate. The corrected rate theta solves p = theta q1 + (1 - theta)(1 - q0). The set of theta
 * that a z-test of g(theta) = p - (1-theta)(1-q0) - theta q1 = 0 does not reject (with the adjusted proportions and the variance
 * Vp + (1-theta)^2 V0 + theta^2 V1) is {a theta^2 + b theta + c <= 0}. When a <= 0 (the margin's confidence set contains 0) that set is
 * unbounded, and the function says so rather than returning a number. Otherwise the bounded set is cut to [0, 1]. Pure; uses all the labels.
 */
export function fiellerInterval(o: { judgedPass: number; n: number; calibration: Calibration; z?: number }): RemedyResult {
  const z = o.z ?? Z95, c = o.calibration;
  const m0 = c.tn + c.fp, m1 = c.tp + c.fn;
  const nT = o.n + z * z, m0T = m0 + 2, m1T = m1 + 2;
  const pT = (o.judgedPass + z * z / 2) / nT, q0T = (c.tn + 1) / m0T, q1T = (c.tp + 1) / m1T;
  const D = q0T + q1T - 1, A = pT + q0T - 1;
  const Vp = pT * (1 - pT) / nT, V0 = q0T * (1 - q0T) / m0T, V1 = q1T * (1 - q1T) / m1T, z2 = z * z;
  const a = D * D - z2 * (V0 + V1), b = -2 * A * D + 2 * z2 * V0, cc = A * A - z2 * (Vp + V0);
  if (D <= 0) return { status: 'unbounded', corrected: NONE, reason: 'the judge is not better than chance on these labels (A1 assumes sensitivity + specificity above 1)' };
  if (!(a > 0)) return { status: 'unbounded', corrected: NONE, reason: 'the confidence set for the judge margin includes 0, so the corrected rate has no upper or lower limit' };
  const disc = b * b - 4 * a * cc;
  if (!(disc >= 0)) return { status: 'unbounded', corrected: NONE, reason: 'no corrected rate is consistent with the data at this confidence level' };
  const r = Math.sqrt(disc), lo = (-b - r) / (2 * a), hi = (-b + r) / (2 * a);
  if (hi < 0 || lo > 1) return { status: 'unbounded', corrected: NONE, reason: 'the consistent corrected rates all lie outside 0 to 1' };
  const q0 = m0 ? c.tn / m0 : 0, q1 = m1 ? c.tp / m1 : 0;
  const point = q0 + q1 > 1 ? (o.judgedPass / o.n + q0 - 1) / (q0 + q1 - 1) : null;
  return { status: 'ok', corrected: { rate: point === null ? null : clamp01(point), low: clamp01(lo), high: clamp01(hi) }, reason: null };
}

export interface CalibratedVerdict {
  outcome: 'verified_better' | 'worse' | 'inconclusive';
  reasons: string[];
  /** raw and corrected figures are ALWAYS both present (corrected is null when it cannot be made) */
  baseline: RateEstimate; candidate: RateEstimate;
  rawDelta: number | null; correctedDelta: number | null;
  /** the margin as a pass-rate gap: the policy's margin in score points (0..100) read as percentage points of pass rate */
  marginRate: number;
  estimator: string; scope: string;
}
/**
 * Candidate against base, both judged by the same judge and calibrated on the same labels. OURS, not A1's (A1 gives one interval per
 * rate): verified better only when the candidate's corrected interval is above the base's by at least the margin; worse when it lies
 * wholly below; otherwise inconclusive, including when either correction cannot be made. Conservative: two intervals, no pooling.
 */
export function calibratedVerdict(o: { baseline: { judgedPass: number; n: number }; candidate: { judgedPass: number; n: number }; calibration: Calibration | null; marginRate?: number }): CalibratedVerdict {
  const marginRate = o.marginRate ?? EVALUATION_POLICY_V2.margin / 100;
  const baseline = correctedPassRate({ ...o.baseline, calibration: o.calibration }), candidate = correctedPassRate({ ...o.candidate, calibration: o.calibration });
  const reasons: string[] = [];
  const rawDelta = baseline.raw.rate !== null && candidate.raw.rate !== null ? candidate.raw.rate - baseline.raw.rate : null;
  let outcome: CalibratedVerdict['outcome'] = 'inconclusive';
  let correctedDelta: number | null = null;
  if (baseline.status !== 'ok' || candidate.status !== 'ok') {
    reasons.push(`the judge's verdicts cannot be corrected: ${(baseline.status !== 'ok' ? baseline : candidate).reason}`);
  } else {
    const b = baseline.corrected, c = candidate.corrected;
    correctedDelta = c.rate! - b.rate!;
    if (c.low! - b.high! >= marginRate) outcome = 'verified_better';
    else if (c.high! < b.low!) { outcome = 'worse'; reasons.push('the candidate\'s corrected interval lies wholly below the base\'s'); }
    else reasons.push(`the corrected intervals (base ${b.low!.toFixed(2)} to ${b.high!.toFixed(2)}, candidate ${c.low!.toFixed(2)} to ${c.high!.toFixed(2)}) do not separate by the ${marginRate} margin`);
  }
  return { outcome, reasons, baseline, candidate, rawDelta, correctedDelta, marginRate, estimator: ESTIMATOR, scope: ESTIMATOR_SCOPE };
}

// ---- stored labels ---------------------------------------------------------------------------------------------------
export interface CalibrationLabelInput { tenantId: string; datasetId: string; judgeLabel: string; input: unknown; judgeVerdict: boolean; humanLabel: boolean; labeledBy: string }
/**
 * Stores one human calibration label for (judge family, frozen dataset). The family resolves through the c38 table (judgeFamily). The
 * database refuses an unfrozen dataset, an unknown labeller, and an input that is a case of the dataset (calibration_overlaps_test).
 */
export async function recordCalibrationLabel(c: Tx, o: CalibrationLabelInput): Promise<void> {
  const family = judgeFamily(o.judgeLabel);
  await c.query(
    `insert into eval_calibration_labels(tenant_id, dataset_id, judge_family, input, input_sha256, judge_verdict, human_label, labeled_by) values ($1,$2,$3,$4::jsonb,'0',$5,$6,$7)`,
    [o.tenantId, o.datasetId, family, JSON.stringify(o.input), o.judgeVerdict, o.humanLabel, o.labeledBy]);
}
/** The 2x2 table of the stored labels of one judge family on one dataset. */
export async function calibrationCounts(c: Tx, tenantId: string, datasetId: string, family: string): Promise<Calibration> {
  const r = (await c.query(
    `select count(*) filter (where judge_verdict and human_label)::int tp, count(*) filter (where not judge_verdict and human_label)::int fn,
            count(*) filter (where not judge_verdict and not human_label)::int tn, count(*) filter (where judge_verdict and not human_label)::int fp
       from eval_calibration_labels where tenant_id=$1 and dataset_id=$2 and judge_family=$3`, [tenantId, datasetId, family])).rows[0];
  return { tp: r.tp, fn: r.fn, tn: r.tn, fp: r.fp };
}

/**
 * The calibrated comparison of two stored runs. Both must be of the same dataset and judged by the same family; otherwise it is
 * inconclusive. An ungraded attempt (R2-2) is left out of n, never counted as a judged failure; a null score without a reason is a
 * failed attempt, judged "fail". The unit is attempt 1 of each case.
 */
export async function calibratedEvaluation(c: Tx, o: { tenantId: string; baseRunId: string; candidateRunId: string }): Promise<CalibratedVerdict & { datasetId: string | null; judgeFamily: string | null }> {
  const runs = (await c.query(`select id, dataset_id, judge_model_family from eval_runs where tenant_id=$1 and id = any($2)`, [o.tenantId, [o.baseRunId, o.candidateRunId]])).rows as Array<{ id: string; dataset_id: string; judge_model_family: string | null }>;
  const b = runs.find((r) => r.id === o.baseRunId), cd = runs.find((r) => r.id === o.candidateRunId);
  if (!b || !cd) throw new Error('both runs must exist in this tenant');
  const tally = async (id: string) => {
    const r = (await c.query(`select count(*)::int n, count(*) filter (where score >= $2)::int pass from eval_results where run_id=$1 and attempt=1 and ungraded_reason is null`, [id, EVALUATION_POLICY_V2.passScore])).rows[0];
    return { judgedPass: r.pass as number, n: r.n as number };
  };
  const base = await tally(b.id), cand = await tally(cd.id);
  const fail = (why: string) => ({ ...calibratedVerdict({ baseline: base, candidate: cand, calibration: null }), datasetId: b.dataset_id, judgeFamily: null, reasons: [why] });
  if (b.dataset_id !== cd.dataset_id) return fail('the two runs are on different datasets');
  let fb: string, fc: string;
  try { fb = judgeFamily(b.judge_model_family); fc = judgeFamily(cd.judge_model_family); } catch (e) { if (e instanceof JudgeLabelError) return fail(`the judge label does not resolve: ${e.message}`); throw e; }
  if (fb !== fc) return fail(`the two runs were judged by different judge families (${fb}, ${fc}), so one calibration cannot correct both`);
  const v = calibratedVerdict({ baseline: base, candidate: cand, calibration: await calibrationCounts(c, o.tenantId, b.dataset_id, fb) });
  return { ...v, datasetId: b.dataset_id, judgeFamily: fb };
}
