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

/** GET /operations/queues (administrators, c45): read-only job record counts. */
export const JOB_STATUS_NAMES = ['queued', 'leased', 'succeeded', 'failed', 'canceled', 'dead'] as const;
export interface QueueSummaryDto {
  kinds: { kind: string; counts: Record<string, number>; total: number }[];
  oldestQueuedAgeSec: number | null; expiredLeases: number; total: number;
  execution: 'disabled'; recordsOnly: true; checkedAt: string;
}

/** GET /operations/anchors (administrators, c49): status of the external audit anchor. No key, file path or hash is ever included. */
export const ANCHOR_STATUS_NAMES = ['ok', 'truncated', 'rewritten', 'bad_signature', 'anchor_missing', 'rolled_back', 'insecure_file', 'unreadable'] as const;
export type AnchorStatusName = (typeof ANCHOR_STATUS_NAMES)[number];
export interface AnchorTenantDto { tenant: string; status: AnchorStatusName; anchoredSeq: number | null; anchoredAt: string | null; reason: string | null }
export interface AnchorStatusDto { configured: boolean; ok: boolean; lastAnchorAt: string | null; restartedAt: string | null; reason: string | null; tenants: AnchorTenantDto[]; checkedAt: string }

/** GET /audit/verify: the audit hash chain walk. `firstBadSeq` and `reason` appear only when the chain is broken. */
export interface AuditVerifyDto { ok: boolean; checked: number; firstBadSeq?: number; reason?: string }

/** GET /policy/baseline (administrators). `heldBy` and `note` appear on kinds an owner approves. */
export interface PolicyKindDto { kind: string; tier: string; effect: string; approver: string | null; heldBy?: string; note?: string; prohibited: string | null; why: string }
export interface PolicyBaselineDto { version: number; source: string; tiers: string[]; kinds: PolicyKindDto[] }

/** What the staffing simulation records on a mission (the web's `Staffing`); `org` exists on real missions only, `stalled` only while staffing is stopped. */
export interface StaffingDto {
  stage: 'reading' | 'appointing' | 'recruiting' | 'working';
  plan: { agentId: string; why: string; managerId?: string }[];
  joined: number;
  log: { at: number; text: string; agentId?: string; by?: string }[];
  org?: { revision?: number; dept: string; executorFrom: 'head' | 'fixture' };
  stalled?: { code: string; reason: string; at: number; attempts: number };
}
export interface PhaseDto { key: string; label: string; date: string; state: string }

/** GET /missions, GET /missions/:id and every mission write. The presentation fields (staffing, prePause, ...) are open. */
export interface MissionDto {
  id: string; title: string; kind: string; priority: 'low' | 'normal' | 'high' | 'critical';
  status: UiMissionStatus; serverStatus: MissionStatus;
  owner: string; ownerId: string; shared: boolean;
  content: { text: string; files: MissionFileDto[] };
  objective: string; criteria: { text: string; done: boolean }[];
  revision: number; rowVersion: number; syncVersion: number; demo: boolean;
  summaryAgoMin: number; lastEventAgoMin: number; createdAgoDays: number;
  agentIds: string[]; leadId: string; executorId?: string; phases: PhaseDto[];
  staffing?: StaffingDto; prePause?: MissionStatus;
  progress: number; tasksVerified: number; tasksTotal: number; blocked: number;
  summary: string; lastEvent: string; elapsedH: number; dueInDays: number; version: string;
  pendingApprovals: number; unread: number; archivedAt?: number; updatedAt: number;
  [presentation: string]: unknown;
}

export interface UploadDto { id: string; name: string; kind: MissionFileDto['kind']; size: number; mime: string; excerpt?: string }

/** c58: why an approval was asked. The three flags are derived by the server from the agent's configuration; the Rule of Two is a heuristic from a vendor blog. */
export interface RuleOfTwoDto {
  flags: { untrustedInput: boolean; sensitiveAccess: boolean; canChangeState: boolean };
  because: { untrustedInput: string[]; sensitiveAccess: string[]; canChangeState: string[] };
  fired: boolean; rule: 'rule_of_two' | null; policyVersion: number;
}

/** c58 (R2-9): how a decision was made. Administrators only, decided requests only. Advisory: it never changed a decision. */
export interface DecisionRecordDto { latencyMs: number; queueSize: number; fastBulk: boolean }
/** One cell of the approval-quality statistics. Below `minEvidence` decisions the numbers are null and the cell reads "not enough evidence". */
export interface QualityCellDto { n: number; enough: boolean; approvalRate: number | null; medianLatencyMs: number | null; fastBulk: number | null }
/** GET /approvals/quality (everyone): the aggregate over the tenant, no names. */
/** `approverCount` is how many different people decided in the window; everyone but an administrator needs `minApprovers` of them before any number shows. Windows are 7, 30 or 90 days only. */
export interface ApprovalQualityDto extends QualityCellDto { medianQueueSize: number | null; windowDays: number; windowStart: string; minEvidence: number; approverCount: number; minApprovers: number }
/** GET /approvals/quality/approvers (administrators only): one row per approver. */
export interface ApproverQualityDto extends QualityCellDto { userId: string; name: string }
export interface ApproverQualityBody { windowDays: number; minEvidence: number; approvers: ApproverQualityDto[] }

/**
 * c65 (R3-10): review capacity. Items that need a person: approvals, and tasks waiting for a person ("waiting_user").
 * Task reviews and delegations have no "awaiting a decision" state in the data, so they are not counted (see the report).
 * `n` is the arrivals in the window; every cell shows it. Numbers are null when `shown` is false (a non-administrator below the floor).
 */
export interface CapacityCellDto {
  n: number; decided: number; people: number; shown: boolean;
  arrivalPerDay: number | null; openBacklog: number | null;
  /** null below `minPercentileN` decided items */
  p50Ms: number | null; p95Ms: number | null;
  /** c58's stored queue size at decision time, approvals only */
  medianQueueSize: number | null;
}
export interface CapacityDeptDto extends CapacityCellDto { dept: string }
/** Little's law as a data-quality check: L (average open) against lambda times W. `fail` = a close record is missing or the two sides differ by more than the stated tolerance. */
export interface LittleLawDto {
  status: 'pass' | 'fail' | 'insufficient'; reason: 'ok' | 'missing_close' | 'mismatch' | 'no_arrivals';
  avgOpen: number | null; lambdaTimesW: number | null; relError: number | null; relTol: number; absTol: number; missingClose: number; openNow: number;
}
export interface ReviewCapacityDto {
  windowDays: number; windowStart: string;
  minItems: number; minPeople: number; minPercentileN: number;
  total: CapacityCellDto; departments: CapacityDeptDto[];
  littles: LittleLawDto;
  /** v1 does not measure utilisation: no handling time is recorded and there is no hours-per-week setting. Always null, with the reason. */
  utilisation: { value: null; reason: 'not_measured'; note: string };
}

export interface ApprovalDto {
  id: string; missionId: string; agentId: string; title: string; detail: string; kind: string;
  risk: string; riskTier: string; digest: string; digestVersion: number; demo: boolean;
  taskId: string | null; origin: string | null; target: string | null; requestedBy: string | null;
  effect: string | null; effectWhy: string | null; approver: string;
  consumed: boolean; consumedAt: number | null;
  /** who decided (null while pending or expired) */
  decidedByName: string | null;
  /** c48: whether the signed-in viewer may decide this request now, and when not, why (the server's own check, the same one the decision route runs) */
  canDecide: boolean;
  decideBlockedReason: 'tier_requires_admin' | 'requester_cannot_decide' | 'already_decided' | 'expired' | null;
  /** c58: the flags and the rule that fired when this was asked (null on requests made before they were recorded) */
  ruleOfTwo: RuleOfTwoDto | null;
  /** c58: latency, queue size and the advisory fast-bulk flag of the decision; null for everyone but administrators, and until decided */
  decisionRecord: DecisionRecordDto | null;
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
