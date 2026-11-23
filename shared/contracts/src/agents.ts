/** Agent registry contracts (Stage 6). The UI's Agent shape plus version and provenance. */
export interface Provenance {
  /** demo-fixture: prototype numbers; measured: counted from real tasks (shown only when sample >= MIN_EVIDENCE) */
  source: 'demo-fixture' | 'measured';
  sample: number | null;
  window: '90d';
}
export const MIN_EVIDENCE = 5;

/**
 * Improvement cycle 3: an agent's reliability, measured on the server from recorded tasks, attempts and reassignments.
 * value = tasks that passed first time and were never reassigned away ÷ finished tasks (passed or failed) in the window,
 * as a whole percentage; null while n < MIN_EVIDENCE. Canceled and open tasks are not evidence. Simulated (DEMO) tasks
 * count only on request (includesSimulated). Only tasks of missions the caller can see count.
 */
export interface AgentReliability {
  value: number | null;
  n: number;
  window: '90d';
  /** e.g. "4 of 6 finished tasks passed first time · 1 retried · 1 reassigned away · last 90 days · from missions you can see" */
  evidence: string;
  includesSimulated: boolean;
}

export interface AgentVersionDto {
  id: string; seq: number; label: string; parentVersionId: string | null;
  model: string; skills: string[]; tools: string[]; promptHash: string; createdBy: string; createdAt: string;
}

/** Fields not listed here come from the definition's profile (metrics, load, growth, level, xp, ...). */
export interface AgentStoredDto {
  id: string; name: string; role: string; dept: string; duty: string; description: string;
  parentId?: string; managerId?: string; site?: string; avatar: Record<string, unknown>;
  status: string; lifecycle: 'active' | 'retired';
  model: string; skills: string[]; tools: string[];
  version: string; versionId: string; versionLabel: string;
  /** profile scores, a name to a whole number; empty for an agent made through the API */
  metrics?: Record<string, number>;
  rowVersion: number; provenance: Provenance; createdAt: string;
  versions?: AgentVersionDto[];
  [profile: string]: unknown;
}
/** What GET /agents and GET /agents/:id return: the stored agent plus its reliability as the caller can see it. */
export interface AgentDto extends AgentStoredDto {
  /** improvement cycle 3: measured from recorded tasks (never from the profile fixture) */
  reliability: AgentReliability;
}

export interface OrgEdgeDto { supervisorId: string; subordinateId: string; edgeType: string }
export interface OrgRevisionDto { id: number; seq: number; note: string; createdBy: string; activeFrom: string }

/** Improvement cycle 1: organisation change proposals (a full proposed set of reporting lines, checked by a dry run). */
export type OrgProposalStatus = 'pending' | 'approved' | 'rejected' | 'applied' | 'failed' | 'expired' | 'withdrawn';
export interface OrgIssue { code: string; message: string; agentId?: string; dept?: string }
/** The server's dry run (validateOrg): stored facts only, no estimates. */
export interface OrgDryRun {
  ok: boolean; errors: OrgIssue[]; warnings: OrgIssue[]; added: OrgEdgeDto[]; removed: OrgEdgeDto[]; coverage?: OrgDryRunCoverage;
  /** c64: the evidence for the triggers the proposer picked (counts computed by the server). Absent on proposals made before c64. */
  evidence?: OrgEvidence;
  /** c64: the new contract checks (pass or fail, with reasons). Absent on proposals made before c64. */
  contracts?: OrgContractCheck[];
  /** c64: the churn budget and cooldown status at the time of the check. Absent on proposals made before c64. */
  churn?: OrgChurn;
}
/** c64 (R3-6): why a restructure is proposed. The proposer picks triggers from this closed list; the server computes the counts. No trigger is a valid, honest answer. */
export const RESTRUCTURE_TRIGGERS = ['load_imbalance', 'coverage_gap', 'repeated_reassigns', 'failure_concentration'] as const;
export type RestructureTrigger = (typeof RESTRUCTURE_TRIGGERS)[number];
export interface TriggerFact { label: string; value: number }
/** `supported` = the recorded counts back the trigger (rule per kind in server/src/organization/evidence.ts); a picked trigger the data does not support is shown, not hidden. */
export interface TriggerEvidence { kind: RestructureTrigger;
  /** 'now' = a point-in-time count (open tasks today, today's chart); 'window' = counted over `windowDays` */
  scope: 'now' | 'window';
  /** null only when `hidden` (c88): whether the counts back the trigger depends on missions the reader may not see */
  supported: boolean | null; facts: TriggerFact[]; subjects: string[];
  /** c88 (T2): true in the view of a non-administrator for a trigger counted over missions (open tasks, failures, reassigns): `supported` is null, `facts` and `subjects` are empty. Only administrators see those counts. */
  hidden?: boolean }
export interface OrgEvidence {
  /** the triggers the proposer picked */
  triggers: TriggerEvidence[];
  /** the other triggers, with their counts, so the picked ones can't be cherry-picked. Absent on results stored before the c64 fix round. */
  others?: TriggerEvidence[]; windowDays: number }
/** One contract a restructure must keep. Orphan duty and a manager without reports were checked before c64 and are not listed here. */
export interface OrgContractCheck { code: string; title: string; ok: boolean; reasons: string[] }
/** Operator settings (never routes): 0 or unset = not enforced. `cooldownEndsInMinutes` and `usedInWindow` are computed with the database clock. */
export interface OrgChurn {
  linesChanged: number; budget: number | null; windowHours: number | null; usedInWindow: number; overBudget: boolean;
  cooldownHours: number | null; cooldownEndsInMinutes: number | null;
  /** true on the one rollback that is exempt from the cooldown and the budget: the undo of the last applied change */
  exempt?: boolean;
}
/** Improvement cycle 20: does the structure cover the company's needs. Facts about the structure, never errors. */
export interface OrgCoverage {
  /** every role of the catalog with the placed active agents that hold it (empty = missing) */
  roles: { role: string; agentIds: string[] }[];
  missingRoles: string[];
  duplicateRoles: { role: string; agentIds: string[] }[];
  deptsWithoutHead: string[];
  managersWithoutReports: string[];
  agentsWithoutDuty: string[];
  span: { max: number; agentId: string | null; managers: number };
  depth: number;
}
export interface OrgCoverageChange { code: string; message: string; role?: string; dept?: string; agentId?: string }
/** The coverage of the active revision, of the proposed lines, and what the proposal changes. */
export interface OrgDryRunCoverage { current: OrgCoverage; proposed: OrgCoverage; changes: OrgCoverageChange[] }
export interface OrgProposalDto {
  id: string; title: string; why: string; baseRevision: number; edges: OrgEdgeDto[]; sha: string; status: OrgProposalStatus;
  createdBy: string; createdByName: string; createdAt: string; expiresAt: string;
  decidedBy: string | null; decidedByName: string | null; decidedAt: string | null; decisionNote: string | null;
  appliedRevision: number | null; result: OrgDryRun;
  /** c64 */
  triggers: RestructureTrigger[]; baseline: string; expectedCost: string; linesChanged: number;
}

/** Improvement cycle 5: agent version proposals (a candidate model/skills/tools against the active version). */
export type VersionProposalStatus = 'pending' | 'promoted' | 'rejected' | 'withdrawn' | 'expired';
export interface VersionConfig { model: string; skills: string[]; tools: string[] }
/** base → candidate: set differences of skills and tools (order is not a change) and the model change, if any. */
export interface VersionDiff { skillsAdded: string[]; skillsRemoved: string[]; toolsAdded: string[]; toolsRemoved: string[]; model: { from: string; to: string } | null; changed: boolean }
export interface VersionProposalDto {
  id: string; agentId: string; agentName: string; title: string; hypothesis: string;
  baseVersionId: string; baseVersionLabel: string; baseSha: string; base: VersionConfig;
  candidate: VersionConfig; candidateSha: string; diff: VersionDiff;
  /** what a decision is bound to: sha256 of agent, base, candidate, title and hypothesis */
  sha: string;
  status: VersionProposalStatus;
  /** the agent's active version now; `stale` = it is no longer the base (only reject or withdraw remain) */
  activeVersionId: string; stale: boolean;
  createdBy: string; createdByName: string; createdAt: string; expiresAt: string;
  decidedBy: string | null; decidedByName: string | null; decidedAt: string | null; note: string | null;
  promotedVersionId: string | null; promotedVersionLabel: string | null;
  /** c47: computed by the server from stored runs on a frozen holdout dataset; null when the candidate has no finished runs. Never a caller-supplied number. */
  evaluation: ProposalEvaluationDto | null;
  /** fingerprint of the evidence behind `evaluation` (run ids, dataset hash, outcome, refusal codes; a fixed value when there is none). A promote must carry the one the reviewer saw. */
  evaluationSha: string;
  /** the administrator's reason for promoting without a verified evaluation (at least 10 characters); null when none was needed */
  overrideReason: string | null;
}
/** `inconclusive` is not a loss: it says the evidence cannot establish a difference (or the evaluation was not honest, see refusals). */
export type EvalOutcome = 'verified_better' | 'inconclusive' | 'worse';
/** attempts of a run, how many carry a grade, and the grader (name and version) that graded them; null = not recorded (runs before c61) */
export interface GradingDto { attempted: number; graded: number; graderName: string | null; graderVersion: string | null }
export interface DatasetValidityDto { unvalidated: boolean; status: 'attested' | 'failing' | 'unattested'; version: number | null; failedItems: string[];
  /** false for a dataset created before its author was recorded: the "not the author" rule cannot be checked, so it can never be attested */
  canBeAttested: boolean }
export interface EvalRefusalDto { code: string; detail: string }
export interface ProposalEvaluationDto {
  outcome: EvalOutcome;
  /** cases scored on both the base version and the candidate */
  n: number; wins: number; losses: number; ties: number; k: number;
  /** mean score gain of the candidate over the base, in points (0..100) */
  delta: number | null;
  /** 95% t interval of the paired mean difference */
  ci: { low: number | null; high: number | null };
  baselineMean: number | null; candidateMean: number | null;
  /** index i is pass^(i+1) */
  passHatK: { baseline: Array<number | null>; candidate: Array<number | null> };
  /** why the evaluation is not trusted (empty when it is) */
  refusals: EvalRefusalDto[];
  /** the verdict's reasons in words, and facts such as cost */
  reasons: string[]; notes: string[];
  datasetId: string; datasetSha: string | null; baseRunId: string | null; candidateRunId: string;
  /**
   * c61 (R2-2): who graded each run and how much of it was graded. Shown beside every pass rate. An ungraded attempt is no grade, not a
   * failure: with too few graded (`sufficient` false) the outcome is `inconclusive`, never `worse`. `regrade` is the re-grade diff
   * that links two runs graded by different grader versions (its NEW grades are the ones compared); null when none was needed.
   */
  grading: { baseline: GradingDto | null; candidate: GradingDto; excludedCases: number; sufficient: boolean; minFraction: number;
    /** the re-grade diff this verdict rests on (the NEW grades of one run were compared) and the person who recorded it; null when none was needed. Show it: the grades are not the original ones. */
    regrade: { id: string; by: string; byName: string } | null;
    /** cases each run kept (every attempt graded), of the cases both ran; below `minFraction` of either the verdict is inconclusive */
    retained: { baseline: number; candidate: number; shared: number };
    /** false when the verdict was withdrawn because it did not survive the worst case for the cases left out (ungraded) */
    robust: boolean };
  /**
   * c61 (R2-3): was the dataset attested (ABC-style checklist, by an administrator who is not its author) before it was frozen? An
   * unattested dataset can still be used, but the verdict is flagged `unvalidated`. `failing`: attested, with at least one "no" answer.
   */
  validity: DatasetValidityDto;
  /** runs recorded for this candidate on that dataset (finished or not): more than one is refused as re-run shopping */
  runCount: number;
}
/** Improvement cycle 4: organisation history. Where a revision came from (stored facts only). */
export type OrgRevisionSource =
  | { kind: 'proposal'; proposalId: string; title: string }
  | { kind: 'agent'; agentId: string }
  | { kind: 'seed' }
  | { kind: 'other' };
/** A revision with who made it, its source and how many reporting lines changed against the revision before it. */
export interface OrgRevisionSummaryDto extends OrgRevisionDto {
  createdByName: string; source: OrgRevisionSource; appliedFromProposal: string | null; changed: number; coverage?: OrgCoverage;
}
export interface OrgRevisionDetailDto extends OrgRevisionSummaryDto { edges: OrgEdgeDto[] }
/** A line whose subordinate is in both revisions with another manager. */
export interface OrgMoveDto { subordinate: string; from: string; to: string }
/** An active, visible mission with an instance of an agent whose manager differs between the two revisions (never changed). */
export interface OrgImpactDto { missionId: string; title: string; agentId: string; instanceId: string; demo: boolean }
/** GET /organization/revisions/:seq/diff?against=: `against` 0 = before any revision. Pure computation. */
export interface OrgDiffDto { seq: number; against: number; added: OrgEdgeDto[]; removed: OrgEdgeDto[]; moved: OrgMoveDto[]; impact: OrgImpactDto[] }

/* Improvement cycle 19: mentoring plans. Only recorded facts: no score, no skill gain (nothing is measured yet). */
export type MentoringStatus = 'active' | 'completed' | 'cancelled';
export interface MentoringMilestoneDto { id: string; seq: number; text: string; doneBy: string | null; doneByName: string | null; doneAt: string | null }
export interface MentoringPlanDto {
  id: string; menteeId: string; menteeName: string; mentorId: string; mentorName: string; skill: string;
  /** ISO date (YYYY-MM-DD) */
  reevalOn: string; status: MentoringStatus;
  milestones: MentoringMilestoneDto[]; milestonesDone: number; milestonesTotal: number;
  createdBy: string; createdByName: string; createdAt: string;
  closedBy: string | null; closedByName: string | null; closedAt: string | null; note: string | null;
  /** always null: re-evaluation needs evaluation data and agents do not execute yet */
  evaluation: null;
}

/** c36: site grants. One exact origin, one mission, a few low-risk capabilities, a limited time. */
export type SiteGrantCapability = 'read' | 'screenshot' | 'summarize' | 'fill_draft';
export type SiteGrantState = 'active' | 'expired' | 'revoked';
export interface SiteGrantDto {
  id: string; missionId: string; origin: string; capabilities: SiteGrantCapability[];
  issuedBy: string; issuedByName: string; issuedAt: string; expiresAt: string;
  state: SiteGrantState;
  revokedAt: string | null; revokedBy: string | null; revokedByName: string | null; reason: string | null;
  /** risk tier of issuing a grant, from the policy (R3) */
  tier: string;
}
export interface OriginCheckDto { ok: boolean; origin?: string; reason?: string; message?: string }
