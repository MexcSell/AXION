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
}

export interface CompanyScorecardDto {
  window: ScorecardWindow;
  /** ISO times of the observation window */
  from: string;
  to: string;
  includeDemo: boolean;
  rows: ScorecardRow[];
}
