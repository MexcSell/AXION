/** Agent registry contracts (Stage 6). The UI's Agent shape plus version and provenance. */
export interface Provenance {
  /** demo-fixture: prototype numbers; measured: counted from real tasks (shown only when sample >= MIN_EVIDENCE) */
  source: 'demo-fixture' | 'measured';
  sample: number | null;
  window: '90d';
}
export const MIN_EVIDENCE = 5;

export interface AgentVersionDto {
  id: string; seq: number; label: string; parentVersionId: string | null;
  model: string; skills: string[]; tools: string[]; promptHash: string; createdBy: string; createdAt: string;
}

/** Fields not listed here come from the definition's profile (metrics, load, growth, level, xp, ...). */
export interface AgentDto {
  id: string; name: string; role: string; dept: string; duty: string; description: string;
  parentId?: string; managerId?: string; site?: string; avatar: Record<string, unknown>;
  status: string; lifecycle: 'active' | 'retired';
  model: string; skills: string[]; tools: string[];
  version: string; versionId: string; versionLabel: string;
  rowVersion: number; provenance: Provenance; createdAt: string;
  versions?: AgentVersionDto[];
  [profile: string]: unknown;
}

export interface OrgEdgeDto { supervisorId: string; subordinateId: string; edgeType: string }
export interface OrgRevisionDto { id: number; seq: number; note: string; createdBy: string; activeFrom: string }
