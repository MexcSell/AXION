/**
 * c85 (R5-1, first slice): the plan record of an organisation change proposal.
 *
 * What it is: a record of what was PLANNED before an org change, so the metric cannot be chosen after the data is seen. It is the
 * researcher's construction on top of c64 (which already hashes a stated baseline and an expected cost). It is NOT pre-registration in the
 * statistical sense, and this slice gives no statistical verdict: the readout only counts observations in two windows.
 */
export const PLAN_WINDOW_MIN_DAYS = 7;
export const PLAN_WINDOW_MAX_DAYS = 90;
export const PLAN_MAX_GUARDRAILS = 3;
export const PLAN_WHY_MIN = 20;
export const PLAN_WHY_MAX = 1000;
export const PLAN_MIN_N_MAX = 100_000;
export const AMENDMENT_REASON_MIN = 20;
export const AMENDMENT_REASON_MAX = 1000;

export type PlanDirection = 'up' | 'down';
/** One metric id from the metric registry (metric-registry.ts) and a margin in that metric's own unit. Free-text metrics do not exist. */
export interface PlanGuardrail { metric: string; margin: number }
export interface ChangePlan {
  primary: { metric: string; direction: PlanDirection; margin: number };
  /** the smallest number of observations needed in EACH window */
  minN: number;
  windowDays: number;
  guardrails: PlanGuardrail[];
  why: string;
}

/** A change after approval is never an edit: it is one of these rows. */
export interface PlanAmendmentDto {
  seq: number;
  plan: ChangePlan;
  sha: string;
  reason: string;
  createdBy: string;
  createdByName: string;
  /** the database clock when the amendment was written */
  createdAt: string;
  /** which parts of the plan the amendment changed against the plan before it */
  changed: string[];
  /** true when the amendment was written after the change took effect (always true: amendments exist only after approval) */
  afterChange: boolean;
}
export interface PlanWindow { from: string; to: string }
export interface PlanWindows {
  /** [change - N days, change) */
  pre: PlanWindow;
  /** [change, change + N days) */
  post: PlanWindow;
  /** the whole post window has passed, by the database clock */
  postComplete: boolean;
}
export interface PlanObservation {
  role: 'primary' | 'guardrail';
  metric: string;
  label: string;
  /** what one counted observation is, in words */
  unit: string;
  pre: number;
  post: number;
  minN: number;
  preMet: boolean;
  postMet: boolean;
}
export type PlanVerdict = 'no_plan' | 'not_applied' | 'not_enough_evidence' | 'ready_for_analysis';
export interface OrgPlanDto {
  proposalId: string;
  proposalStatus: 'pending' | 'approved' | 'rejected' | 'applied' | 'failed' | 'expired' | 'withdrawn';
  plan: ChangePlan | null;
  /** canonical sha256 of `plan` (null without a plan). After approval it equals the sha fixed into the record. */
  sha: string | null;
  locked: boolean;
  amendments: PlanAmendmentDto[];
  /** the plan after the last amendment (equals `plan` without amendments) */
  effectivePlan: ChangePlan | null;
  amendedAfterChange: boolean;
  change: { revision: number; activeFrom: string } | null;
  windows: PlanWindows | null;
  /** counts for the LOCKED plan's metrics (never for an amended choice) */
  observations: PlanObservation[];
  verdict: PlanVerdict;
  /** plain words; "not enough evidence yet" or "ready for analysis (not computed in this version)". It never says a change worked. */
  verdictText: string;
  /** the database clock when this was computed */
  checkedAt: string;
}
/** PUT .../plan answers with the plan as stored (the proposal is still pending, so there is no change, window or count yet). */
export interface PlanSetDto { proposalId: string; plan: ChangePlan; sha: string; locked: boolean }
export interface PlanAmendIn { plan: ChangePlan; reason: string; baseAmendments: number }
