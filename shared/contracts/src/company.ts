/** Company scorecard (improvement cycle 2): computed by the server only from recorded rows (spec §11 invariant 9, §16). */
export const SCORECARD_WINDOWS = ['7d', '30d', '90d'] as const;
export type ScorecardWindow = (typeof SCORECARD_WINDOWS)[number];

export type ScorecardRowKey =
  | 'started' | 'finished' | 'verified_success_rate' | 'completed_unverified'
  | 'median_cycle_time_h' | 'failure_rate' | 'task_recovery_rate' | 'waiting_approval_median_h';

export interface ScorecardRow {
  key: ScorecardRowKey;
  label: string;
  /** null when there is not enough evidence (state 'none'); rates are percentages 0–100 */
  value: number | null;
  unit: '%' | 'h' | 'missions';
  /** the sample size behind the value */
  n: number;
  /** one sentence naming the evidence (counts) */
  evidence: string;
  state: 'ok' | 'none';
  /** the same row over the previous equal-length window; value null when that period has no evidence */
  previous: { value: number | null; n: number };
  /** null whenever either period lacks evidence (value null or n below 3); flat within ±1 point (±0.1 h, equal for counts) */
  trend: ScorecardTrend | null;
}
export type ScorecardTrend = 'up' | 'down' | 'flat';

/** Weekly counts, oldest first (improvement cycle 12). Counts only: no ratios. */
export interface ThroughputDto {
  weeks: { from: string; to: string; started: number; finished: number }[];
  includeDemo: boolean;
  to: string;
}

export interface CompanyScorecardDto {
  window: ScorecardWindow;
  /** ISO times of the observation window */
  from: string;
  to: string;
  includeDemo: boolean;
  /** ISO bounds of the previous equal-length window the `previous` values come from */
  previousFrom: string;
  previousTo: string;
  rows: ScorecardRow[];
}
