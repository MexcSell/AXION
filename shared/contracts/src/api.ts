/**
 * Response shapes of routes that had no shared type before improvement cycle 50 (API contract tests, server/test/contracts).
 * The server tests validate real responses against validators that are type-checked against these interfaces, so a field
 * added on the server and not here (or the other way round) fails the suite.
 */
import type { MissionStatus, UiMissionStatus, MissionFileDto } from './missions.ts';
import type { AccountDto } from './auth.ts';
import type { MessageDto, ThreadDto } from './conversations.ts';
import type { TaskStatus } from './tasks.ts';
import type { ReviewVerdict } from './reviews.ts';

export interface HealthDto { ok: boolean; db: 'up' | 'down'; version: string }

export interface OpsHealthDto {
  version: string;
  api: { status: 'up'; uptimeSec: number };
  db: { status: 'up' | 'down'; sizeBytes?: number; missions?: number };
  events: { count: number; lastAt: string | null };
  sse: { clients: number };
  backup: { last: string | null; file: string | null; count: number };
  execution: 'disabled';
  checkedAt: string;
}

/** GET /audit/verify: the audit hash chain walk. `firstBadSeq` and `reason` appear only when the chain is broken. */
export interface AuditVerifyDto { ok: boolean; checked: number; firstBadSeq?: number; reason?: string }

/** GET /policy/baseline (administrators). `heldBy` and `note` appear on kinds an owner approves. */
export interface PolicyKindDto { kind: string; tier: string; effect: string; approver: string | null; heldBy?: string; note?: string; prohibited: string | null; why: string }
export interface PolicyBaselineDto { version: number; source: string; tiers: string[]; kinds: PolicyKindDto[] }

/** GET /missions, GET /missions/:id and every mission write. The presentation fields (staffing, prePause, ...) are open. */
export interface MissionDto {
  id: string; title: string; kind: string; priority: 'low' | 'normal' | 'high' | 'critical';
  status: UiMissionStatus; serverStatus: MissionStatus;
  owner: string; ownerId: string; shared: boolean;
  content: { text: string; files: MissionFileDto[] };
  objective: string; criteria: { text: string; done: boolean }[];
  revision: number; rowVersion: number; syncVersion: number; demo: boolean;
  summaryAgoMin: number; lastEventAgoMin: number; createdAgoDays: number;
  agentIds: string[]; leadId: string; executorId?: string; phases: unknown[];
  progress: number; tasksVerified: number; tasksTotal: number; blocked: number;
  summary: string; lastEvent: string; elapsedH: number; dueInDays: number; version: string;
  pendingApprovals: number; unread: number; archivedAt?: number; updatedAt: number;
  [presentation: string]: unknown;
}

export interface UploadDto { id: string; name: string; kind: MissionFileDto['kind']; size: number; mime: string; excerpt?: string }

export interface ApprovalDto {
  id: string; missionId: string; agentId: string; title: string; detail: string; kind: string;
  risk: string; riskTier: string; digest: string; digestVersion: number; demo: boolean;
  taskId: string | null; origin: string | null; target: string | null; requestedBy: string | null;
  effect: string | null; effectWhy: string | null; approver: string;
  consumed: boolean; consumedAt: number | null;
  /** who decided (null while pending or expired) */
  decidedByName: string | null;
  status: 'pending' | 'approved' | 'denied'; state: 'pending' | 'approved' | 'denied' | 'expired' | 'revoked';
  expiresMin: number; agoMin: number; expiresAt: number;
}

export interface NoticeDto {
  id: string; severity: 'critical' | 'warning' | 'info' | 'success'; category: 'mission' | 'agent' | 'system' | 'approval' | 'evolution';
  title: string; body: string; route?: string; missionId?: string; actionable: boolean; agoMin: number; createdAt: number;
}

export type InstanceState = 'working' | 'waiting' | 'blocked' | 'idle' | 'verifying' | 'done' | 'reporting';
export interface InstanceDto {
  id: string; missionId: string; agentId: string; versionId: string; versionLabel: string; managerInstanceId: string | null;
  state: InstanceState; task: string; progress: number; simulated: boolean; createdAt: string | null; endedAt: string | null;
}
/** GET /agent-instances: `truncated` is always sent; `nextBefore` only when it is true. */
export interface InstancesPageDto { instances: InstanceDto[]; truncated: boolean; nextBefore?: string }
export interface HierarchyNodeDto { instanceId: string; agentId: string; parent?: string; task: string; state: InstanceState; tasks: number; pending: number; progress: number; versionLabel: string }
export interface HierarchyEdgeDto { from: string; to: string; kind: string }
export interface HierarchyDto { nodes: HierarchyNodeDto[]; edges: HierarchyEdgeDto[] }

export type UiTaskState = 'queued' | 'ready' | 'running' | 'waiting-agent' | 'waiting-user' | 'verifying' | 'passed' | 'failed' | 'canceled';
export interface TaskDto { id: string; title: string; owner: string | null; deps: string[]; state: UiTaskState; weight: number; evidence: number; col: number; row: number }

export interface MessagePageDto { messages: MessageDto[]; hasMore: boolean; nextBefore: number | null }
export interface ThreadPartnerDto {
  threadId: string | null; kind: string; human: boolean; withInstanceId: string | null; withAgentId: string | null;
  lastMessage: MessageDto | null; unread: number; count: number;
}
export interface MissionThreadsDto {
  threads: ThreadDto[];
  instances: { instanceId: string; agentId: string; partners: ThreadPartnerDto[] }[];
}

export type { AccountDto };


/** Payload of each SSE event type (the envelope is DomainEvent). One entry per EventType: tsc fails when one is missing. */
export interface EventPayloads {
  'mission.created': { status: MissionStatus };
  'mission.revised': { revision: number };
  'mission.stateChanged': { from: MissionStatus; to: MissionStatus; action: string; by: string; simulated?: boolean };
  'mission.shared': { shared: boolean };
  'mission.deleted': { ownerId: string; shared: boolean };
  'staffing.progressed': { simulated: boolean; stage: string; joined: number; agentId?: string; text: string };
  /** staffing gave up after repeated failures; `at` is epoch milliseconds */
  'staffing.stalled': { code: string; reason: string; at: number; attempts: number };
  'staffing.resumed': { by: string };
  'approval.requested': { approvalId: string; kind: string; risk: string; policyVersion: number; reasons: string[] };
  'approval.decided': { approvalId: string; decision: 'approved' | 'denied' | 'expired'; by: string };
  'approval.consumed': { approvalId: string; kind: string; tier: string; by: string };
  'notification.created': { id: string; title: string; severity: NoticeDto['severity'] };
  'conversation.messageCreated': { threadId: string; messageId: string; seq: number; kind: string; simulated: boolean; message: MessageDto; channel?: { kind: string; userId: string; agentId?: string } };
  'conversation.receipt': { threadId: string; messageId: string; state: 'queued' | 'delivered' | 'acknowledged'; simulated: boolean };
  'instance.created': { instanceId: string; agentId: string; simulated: boolean; managerInstanceId?: string };
  'instance.stateChanged': { instanceId: string; state: InstanceState };
  /** one payload shape for both subjects: a staffing join has no taskId and carries `simulated`; a person's reassignment names the task and who did it */
  'task.delegated': { taskId?: string; fromInstance: string; toInstance: string; kind: 'delegated'; simulated?: boolean; by?: string };
  'task.stateChanged': { taskId: string; from: TaskStatus; to: TaskStatus; action: string; by: string };
  'task.reviewed': { taskId: string; reviewId: string; verdict: ReviewVerdict; reviewerId: string; reviewerKind: 'user' | 'agent'; by: string };
  'agent.created': { versionId: string; label: string };
  'agent.updated': { fields: unknown; versionId?: string };
  'agent.versionCreated': { versionId: string; label: string; seq: number; previousVersionId: string; proposalId?: string; rollbackOf?: string };
  'agent.versionProposed': { proposalId: string; title: string; baseVersionId: string };
  'agent.versionPromoted': { proposalId: string; versionId: string; label: string; previousVersionId: string };
  'agent.rolledBack': { versionId: string; label: string; toVersionId: string; toLabel: string; previousVersionId: string };
  'agent.versionProposalDecided': { proposalId: string; status: 'expired' | 'rejected' | 'withdrawn' };
  'ledger.updated': { kind: 'task' | 'progress'; version: number };
  'mentoring.planned': { planId: string; mentorId: string; skill: string };
  'mentoring.milestoneDone': { planId: string; milestoneId: string; seq: number };
  'mentoring.closed': { planId: string; outcome: 'completed' | 'cancelled' };
  'grant.issued': { grantId: string; missionId: string; origin: string };
  'grant.revoked': { grantId: string; missionId: string; origin: string };
  'failure.tagged': { tagId: string; subjectKind: string; subjectId: string; modeId: string; status: 'proposed'; taggedByKind: 'user' | 'agent' };
  'failure.decided': { tagId: string; subjectKind: string; subjectId: string; modeId: string; status: 'confirmed' | 'rejected'; selfConfirmed: boolean };
  'playbook.lessonProposed': { lessonId: string };
  'playbook.lessonDecided': { lessonId: string; status: 'accepted' | 'rejected'; version?: number };
  'playbook.versionCreated': { version: number; lessonId?: string; rollbackTo?: number };
  'skill.proposed': { skillId: string; version: number };
  'skill.decided': { skillId: string; status: 'approved' | 'retired' };
  'org.proposalCreated': { title: string; baseRevision: number; ok: boolean; rollbackTo?: number };
  'org.proposalDecided': { status: 'expired' | 'rejected' | 'applied' | 'withdrawn'; revision?: number };
  'org.revisionApplied': { revision: number; previous: number; proposalId?: string; agentId?: string };
  'user.requested': { userId: string; name: string; device: string; deviceId?: string };
  'user.changed': { userId: string; passwordChanged?: boolean; deviceId?: string; revoked?: boolean };
  'auth.approved': { userId: string; deviceId?: string };
}
