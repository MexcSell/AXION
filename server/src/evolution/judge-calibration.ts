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

export function correctedPassRate(o: { judgedPass: number; n: number; calibration: Calibration | null; z?: number; center?: boolean; minPerClass?: number; minJudgeMargin?: number }): RateEstimate {
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
