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
export interface OrgDryRun { ok: boolean; errors: OrgIssue[]; warnings: OrgIssue[]; added: OrgEdgeDto[]; removed: OrgEdgeDto[] }
export interface OrgProposalDto {
  id: string; title: string; why: string; baseRevision: number; edges: OrgEdgeDto[]; sha: string; status: OrgProposalStatus;
  createdBy: string; createdByName: string; createdAt: string; expiresAt: string;
  decidedBy: string | null; decidedByName: string | null; decidedAt: string | null; decisionNote: string | null;
  appliedRevision: number | null; result: OrgDryRun;
}
