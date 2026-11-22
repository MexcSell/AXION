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
export interface OrgDryRun { ok: boolean; errors: OrgIssue[]; warnings: OrgIssue[]; added: OrgEdgeDto[]; removed: OrgEdgeDto[]; coverage?: OrgDryRunCoverage }
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
  /** no evaluation runs yet (agents do not execute): always null, never an invented number */
  evaluation: null;
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
