/**
 * Improvement cycle 69 (R3-5): process metrics next to the outcome rows. How the work moved (returned for rework, accepted first time,
 * delegated twice, handed over, waiting on a hand-off) rather than only how it ended. Derived read model over rows the server already stores.
 *
 * Rules (also in the `?` help): every cell is a value with n and a window, or "not enough evidence (n = k)"; items that are still open
 * (not yet reviewed, not yet started) are reported beside a rate and are never in its denominator; there is no composite and no "good"
 * threshold; cost has no source until Stage 9, so it is an unmeasured cell, never a number.
 */
export const PROCESS_KEYS = ['rework_rate', 'first_pass_acceptance', 'duplicate_delegation', 'reassign_churn', 'handoff_wait_h', 'approval_decision_h', 'cost'] as const;
export type ProcessKey = (typeof PROCESS_KEYS)[number];
export const PROCESS_WINDOWS = ['7d', '30d', '90d'] as const;
export type ProcessWindow = (typeof PROCESS_WINDOWS)[number];
/** Reassign churn needs at least this many tasks before it shows a median and a p90 (the brief's floor). */
export const CHURN_MIN_TASKS = 20;

export interface ProcessCell {
  /** 'process.' + key; also the id of the row's c66 guard entry */
  key: string;
  label: string;
  /** null when n is below `minN` (state 'none'), unmeasured, or hidden. rates are percentages 0..100; 'h' hours; 'count' a plain number */
  value: number | null;
  unit: '%' | 'h' | 'count';
  /** the sample size behind the value; null when the cell is 'unmeasured' */
  n: number | null;
  minN: number;
  from: string | null;
  to: string | null;
  /** one sentence; for state 'none' it starts with "not enough evidence (n = k)"; for 'unmeasured' with "not measured" */
  evidence: string;
  state: 'ok' | 'none' | 'unmeasured';
  /** the same cell over the previous equal window; value null when that side lacks evidence */
  previous: { value: number | null; n: number };
  trend: 'up' | 'down' | 'flat' | null;
  /** items still open, reported beside the figure and never in its denominator (not yet reviewed / not yet started); null where the idea does not apply */
  open: { n: number; what: string } | null;
  /** the 90th percentile (nearest rank), for the two cells that report a median; null otherwise or below the floor */
  p90: number | null;
  /** the breakdown with n (return causes); empty where the cell has none */
  breakdown: { label: string; n: number }[];
}
export interface ProcessDto {
  window: ProcessWindow;
  from: string;
  to: string;
  previousFrom: string;
  previousTo: string;
  /** null = the whole company; otherwise a department name */
  department: string | null;
  departments: string[];
  cells: ProcessCell[];
}
