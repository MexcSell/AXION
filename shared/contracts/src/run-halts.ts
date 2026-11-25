/**
 * Phase A (A2): the halt record. A halt stops runs; a lift is a new row. Records only: nothing executes and no run exists yet.
 * The effective halt of one run is read global first, then the run's task class, then the run (server/src/jobs/run-halts.ts).
 */
export const HALT_SCOPES = ['global', 'class', 'run'] as const;
export type HaltScope = (typeof HALT_SCOPES)[number];
export const HALT_REASON_MAX = 500;
/** A class name or a run id: letters, digits and . _ : - only, so a target can never carry markup or spaces. */
export const HALT_TARGET_RE = /^[A-Za-z0-9._:-]{1,120}$/;

export interface HaltDto {
  id: number;
  scope: HaltScope;
  /** empty for the global scope */
  target: string;
  halted: boolean;
  reason: string;
  createdBy: string;
  createdByName: string | null;
  createdAt: string;
}
export interface HaltsDto {
  /** the newest row of every (scope, target) that is halted now, global first */
  active: HaltDto[];
  /** the last 100 rows, newest first (sets and lifts) */
  recent: HaltDto[];
}
export interface HaltRecordDto { halt: HaltDto }
