import type { ScorecardWindow } from './company.ts';

/**
 * Department facts (improvement cycle 6): counted by the server from recorded rows only, for the missions the caller can
 * see. No ratios are computed: every number is a count with its sample (n) and, for outcomes, the observation window.
 */
export interface DepartmentFacts {
  name: string;
  /** the GM in the GM's own department; elsewhere the member reporting to the GM in the latest org revision (tie-break below) */
  headAgentId: string | null;
  /** every member of this department that reports to the GM in the latest revision (head first); more than one = no single head */
  gmReports: string[];
  /** active agents whose catalog department is this one */
  memberIds: string[];
  /** members with a live (not ended), real instance on a visible, active (planning/running/verifying/waiting) mission */
  staffedAgents: number;
  /** distinct visible, active missions those instances belong to */
  activeMissions: number;
  /** current state of tasks owned by members, on visible missions that are not completed, canceled or archived */
  openTasks: { running: number; waiting: number; failed: number };
  /** tasks owned by members that finished (passed or failed) inside the window; retried ⊆ n (more than one attempt); n = passed + failed */
  outcomes: { passed: number; failed: number; retried: number; n: number };
  /** the newest org revision that added, removed or re-pointed a reporting line of a member (line = subordinate's department) */
  lastOrgChange: { revision: number; at: string } | null;
  /** one sentence naming the counts and where they come from */
  evidence: string;
}

export interface DepartmentsDto {
  window: ScorecardWindow;
  from: string;
  to: string;
  includeDemo: boolean;
  departments: DepartmentFacts[];
}

/** Outcomes below this sample are shown as counts with "too few to rate" (the client never shows a ratio either). */
export const DEPT_MIN_SAMPLE = 5;
