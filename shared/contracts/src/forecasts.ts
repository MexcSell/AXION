import { TASK_CLASS_IDS, TASK_CLASSES, type TaskClassId } from './skills.ts';

/**
 * Improvement cycle 86 (R5-7, first slice): the forecast ledger. Human forecasts only, one question only.
 *
 * QUESTION. "Will the FIRST review of this task be 'accepted'?" A person records a probability before that review exists. The outcome is the
 * first task_reviews row of the task (lowest seq): accepted or not. It is read from the review table every time and never stored.
 *
 * STATES (computed at read time).
 *  - open      no review yet, and the task can still be reviewed.
 *  - void      no review, and the task was canceled or its mission archived: it will not be scored. A later review turns it into resolved.
 *  - resolved  the first review exists and the forecast was made strictly before it (database clock): scored.
 *  - late      a review exists that is not later than the forecast. The write path refuses this under a lock, so it can only come from a
 *              row inserted around the route. It is shown, never scored.
 *
 * SCORES. Both are losses (lower is better). Brier = (p - o)^2, with o = 1 if accepted else 0. Log loss = -ln(probability given to what happened),
 * i.e. the negative of the log score. The log is taken on the probability clamped to [LOG_CLAMP_LO, LOG_CLAMP_HI]; that is the same range
 * a forecast may have, so a forecast is never altered by it. Only the reference-class rate (which can be exactly 0 or 1) is ever clamped.
 *
 * CALIBRATION. 5 bins on whole percents: 1-20, 21-40, 41-60, 61-80, 81-99. A bin shows its observed rate only from CALIBRATION_MIN_N forecasts.
 *
 * REFERENCE CLASS. For a forecast whose task has a delegation brief (made at or before the forecast) naming BOTH a task class and a difficulty, the
 * baseline is the historical first-review acceptance rate of the same class and difficulty, over tasks (of the same company, not simulated, not
 * demo) whose first review came strictly before the forecast was made, with the class taken from the first brief that names both. The baseline
 * is used only from BASELINE_MIN_N such tasks. Its Brier on the same task is the skill reference.
 *
 * SKILL. skill = 1 - (forecaster's mean Brier) / (baseline's mean Brier), over the forecaster's resolved forecasts that have a baseline. It is shown only
 * from SKILL_MIN_RESOLVED such forecasts; below that the text is "not enough evidence (n of 20)". The 20-floor counts forecasts WITH a baseline,
 * which is stricter than counting all resolved ones. A positive skill means the person's forecasts were closer to what happened than the class rate was, on those
 * tasks; it says nothing about any other task, and nothing about agents.
 *
 * NO LEADERBOARD. Each person reads their own record; an administrator reads one person at a time. No route lists forecasters, and no field here
 * orders people. Small studies suggest that models' own estimates are unreliable; that is background only, not an AXION result, and no agent forecast
 * exists in this slice.
 */
export const FORECAST_QUESTION = 'first_review_accepted' as const;
export const FORECAST_P_MIN = 0.01;
export const FORECAST_P_MAX = 0.99;
export const LOG_CLAMP_LO = FORECAST_P_MIN;
export const LOG_CLAMP_HI = FORECAST_P_MAX;
export const CALIBRATION_BINS = 5;
export const CALIBRATION_MIN_N = 5;
export const BASELINE_MIN_N = 5;
export const SKILL_MIN_RESOLVED = 20;
/** a per-class mean is shown from this many resolved forecasts */
export const FORECAST_CLASS_MIN_N = 5;
export const FORECAST_METHOD = 'Brier (p - o)^2 and log loss -ln(p of what happened), both lower-is-better, p clamped to 0.01 to 0.99 for the log; 5 calibration bins on whole percents (a bin shows its rate from 5 forecasts); baseline = the historical first-review acceptance rate of the same task class and difficulty before the forecast was made (from 5 tasks); skill from 20 resolved forecasts that have a baseline.';

export type ForecastState = 'open' | 'void' | 'resolved' | 'late';

/** whole percents (1..99) of a probability that arrives as a string from numeric(3,2) or a number */
export const hundredths = (p: number | string): number => Math.round(Number(p) * 100);
export const clampLog = (p: number): number => Math.min(LOG_CLAMP_HI, Math.max(LOG_CLAMP_LO, p));
export const brier = (p: number, accepted: boolean): number => (p - (accepted ? 1 : 0)) ** 2;
export const logLoss = (p: number, accepted: boolean): number => -Math.log(accepted ? clampLog(p) : 1 - clampLog(p));
/** bin index 0..4 of a probability in whole percents (floating point is avoided on purpose: 0.6 / 0.2 floors to 2) */
export const binOf = (h: number): number => Math.min(CALIBRATION_BINS - 1, Math.max(0, Math.floor((h - 1) / 20)));
export const BIN_EDGES: readonly { lo: number; hi: number }[] = [{ lo: 0.01, hi: 0.2 }, { lo: 0.21, hi: 0.4 }, { lo: 0.41, hi: 0.6 }, { lo: 0.61, hi: 0.8 }, { lo: 0.81, hi: 0.99 }];

export interface ForecastBaseline { classId: TaskClassId; difficulty: number; n: number; rate: number; brier: number; logLoss: number }
export interface ForecastDto {
  id: string;
  taskId: string;
  missionId: string;
  taskTitle: string;
  probability: number;
  madeAt: string;
  state: ForecastState;
  /** the first review's verdict is "accepted"; null until a forecast is resolved */
  accepted: boolean | null;
  resolvedAt: string | null;
  brier: number | null;
  logLoss: number | null;
  classId: TaskClassId | null;
  difficulty: number | null;
  baseline: ForecastBaseline | null;
}
export interface CalibrationBin { lo: number; hi: number; n: number; /** observed acceptance rate and mean forecast: only from CALIBRATION_MIN_N forecasts */ rate: number | null; meanForecast: number | null }
export interface ForecastSkill {
  state: 'ok' | 'not_enough_evidence';
  /** resolved forecasts that have a baseline */
  n: number;
  needed: number;
  meanBrier: number | null;
  baselineBrier: number | null;
  skill: number | null;
  text: string;
}
export interface ForecastClassRow { classId: TaskClassId; label: string; n: number; meanBrier: number | null; meanLogLoss: number | null }
export interface ForecastCounts { total: number; open: number; void: number; resolved: number; late: number }
export interface ForecastLedgerDto {
  forecaster: { id: string; name: string };
  question: typeof FORECAST_QUESTION;
  method: string;
  clamp: { lo: number; hi: number };
  counts: ForecastCounts;
  meanBrier: number | null;
  meanLogLoss: number | null;
  calibration: CalibrationBin[];
  skill: ForecastSkill;
  /** only task classes with at least one resolved forecast, in the fixed class order; a mean shows from FORECAST_CLASS_MIN_N */
  byClass: ForecastClassRow[];
  forecasts: ForecastDto[];
}
export interface ForecastRecordDto { forecast: ForecastDto }

/** What the database gives per forecast, before scoring. `first` is the verdict of the first review (null when none) and `inTime` the SQL comparison made_at < that review's created_at. */
export interface ForecastRowIn {
  id: string; taskId: string; missionId: string; taskTitle: string; probability: number | string; madeAt: string;
  firstVerdict: string | null; firstAt: string | null; inTime: boolean; voided: boolean;
  classId: string | null; difficulty: number | null; baseN: number; baseX: number;
}
const isClass = (s: string | null): s is TaskClassId => !!s && (TASK_CLASS_IDS as readonly string[]).includes(s);
const mean = (xs: readonly number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function scoreForecast(r: ForecastRowIn): ForecastDto {
  const p = hundredths(r.probability) / 100;
  const state: ForecastState = r.firstAt !== null ? (r.inTime ? 'resolved' : 'late') : r.voided ? 'void' : 'open';
  const scored = state === 'resolved';
  const accepted = scored ? r.firstVerdict === 'accepted' : null;
  const cls = isClass(r.classId) && r.difficulty !== null ? r.classId : null;
  let baseline: ForecastBaseline | null = null;
  if (scored && cls && r.baseN >= BASELINE_MIN_N) {
    const rate = r.baseX / r.baseN;
    baseline = { classId: cls, difficulty: r.difficulty!, n: r.baseN, rate, brier: brier(rate, accepted!), logLoss: logLoss(rate, accepted!) };
  }
  return {
    id: r.id, taskId: r.taskId, missionId: r.missionId, taskTitle: r.taskTitle, probability: p, madeAt: r.madeAt, state, accepted,
    resolvedAt: scored ? r.firstAt : null, brier: scored ? brier(p, accepted!) : null, logLoss: scored ? logLoss(p, accepted!) : null,
    classId: cls, difficulty: cls ? r.difficulty : null, baseline,
  };
}

/** Everything a person's page shows, from their forecast rows (pure; the rows are in the database's order and nothing here sorts by a score). */
export function ledgerOf(forecaster: { id: string; name: string }, rows: readonly ForecastRowIn[]): ForecastLedgerDto {
  const fs = rows.map(scoreForecast);
  const done = fs.filter((f) => f.state === 'resolved');
  const counts: ForecastCounts = { total: fs.length, open: fs.filter((f) => f.state === 'open').length, void: fs.filter((f) => f.state === 'void').length, resolved: done.length, late: fs.filter((f) => f.state === 'late').length };
  const bins = BIN_EDGES.map((e) => ({ ...e, ps: [] as number[], xs: [] as number[] }));
  for (const f of done) { const b = bins[binOf(hundredths(f.probability))]; b.ps.push(f.probability); b.xs.push(f.accepted ? 1 : 0); }
  const calibration: CalibrationBin[] = bins.map((b) => ({ lo: b.lo, hi: b.hi, n: b.ps.length, rate: b.ps.length >= CALIBRATION_MIN_N ? mean(b.xs) : null, meanForecast: b.ps.length >= CALIBRATION_MIN_N ? mean(b.ps) : null }));
  const withBase = done.filter((f) => f.baseline);
  const mb = mean(withBase.map((f) => f.brier!)), bb = mean(withBase.map((f) => f.baseline!.brier));
  const enough = withBase.length >= SKILL_MIN_RESOLVED;
  const skillValue = enough && mb !== null && bb !== null && bb > 0 ? 1 - mb / bb : null;
  const skill: ForecastSkill = {
    state: enough ? 'ok' : 'not_enough_evidence', n: withBase.length, needed: SKILL_MIN_RESOLVED,
    meanBrier: enough ? mb : null, baselineBrier: enough ? bb : null, skill: skillValue,
    text: enough ? (skillValue === null ? 'The reference class was never wrong on these tasks, so there is nothing to compare with.' : 'Compared with the historical acceptance rate of the same task class and difficulty, on the same tasks.')
      : `not enough evidence (${withBase.length} of ${SKILL_MIN_RESOLVED})`,
  };
  const byClass: ForecastClassRow[] = TASK_CLASS_IDS.flatMap((classId) => {
    const xs = done.filter((f) => f.classId === classId);
    return xs.length ? [{ classId, label: TASK_CLASSES[classId], n: xs.length, meanBrier: xs.length >= FORECAST_CLASS_MIN_N ? mean(xs.map((f) => f.brier!)) : null, meanLogLoss: xs.length >= FORECAST_CLASS_MIN_N ? mean(xs.map((f) => f.logLoss!)) : null }] : [];
  });
  return { forecaster, question: FORECAST_QUESTION, method: FORECAST_METHOD, clamp: { lo: LOG_CLAMP_LO, hi: LOG_CLAMP_HI }, counts, meanBrier: mean(done.map((f) => f.brier!)), meanLogLoss: mean(done.map((f) => f.logLoss!)), calibration, skill, byClass, forecasts: fs };
}
