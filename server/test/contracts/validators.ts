import { nul, str, num, int, bool, iso, rec, lit, oneOf, nullable, opt, arr, either, obj, openObj, dict, type V } from './validate.ts';
import {
  ERROR_CODES, MISSION_STATUSES, SCORECARD_WINDOWS, REVIEW_VERDICTS, RUBRIC_RESULTS, EVIDENCE_KINDS, FAILURE_SUBJECT_KINDS, DETECTION_CHANNELS, FAILURE_MECHANISMS, FAILURE_CONTROLS, STEP_STATUSES, STALL_POLICY,
  type AccountDto, type PhaseDto, type StaffingDto, type AgentDto, type AgentVersionDto, type ApprovalDto, type AttachmentDto, type AuditVerifyDto, type AvatarDto, type BriefTier, type ChannelDto,
  type CompanyScorecardDto, type ConnectResult, type DelegableKind, type DelegationBriefDto, type DelegationBriefList, type DepartmentFacts, type DepartmentsDto, type DeviceDto,
  type ErrorEnvelope, type EvidenceRef, type DetectionFieldCount, type FailurePatternDto, type FailurePatternsDto, type FailureDetectionDto, type FailureAttributionDto, type FailureCategoryCount, type FailureModeCount, type FailureModesDto, type FailureSubjectInfo, type FailureTagDto, type HealthDto,
  type HierarchyDto, type HierarchyEdgeDto, type HierarchyNodeDto, type InstanceDto, type InstancesPageDto, type LedgerDto, type LedgerVersionDto, type LedgerVersionPageDto,
  type LedgersDto, type LessonCandidateDto, type LessonConflict, type MeDto, type MentoringMilestoneDto, type MentoringPlanDto, type MessageDto, type MessagePageDto,
  type MissionDto, type MissionFileDto, type MissionThreadsDto, type NoticeDto, type OpsHealthDto, type OriginCheckDto, type OrgCoverage, type OrgCoverageChange,
  type OrgDiffDto, type OrgDryRun, type OrgDryRunCoverage, type OrgEdgeDto, type OrgImpactDto, type OrgIssue, type OrgMoveDto, type OrgProposalDto, type OrgRevisionDetailDto,
  type OrgRevisionDto, type OrgRevisionSource, type OrgRevisionSummaryDto, type PlaybookDiff, type PlaybookDto, type PlaybookItem, type PlaybookVersionRow, type PolicyBaselineDto,
  type PolicyKindDto, type ProgressBody, type Provenance, type ReviewActor, type ReviewerAgreement, type RubricItem, type ScorecardRow, type SiteGrantDto, type SkillDto,
  type SkillStep, type SourceRef, type TaskBody, type TaskDto, type TaskReviewDto, type TaskReviewsDto, type ThreadDto, type ThreadPartnerDto, type ThroughputDto,
  type UploadDto, type VersionConfig, type VersionDiff, type VersionProposalDto, type AgentReliability, type QueueSummaryDto, type AnchorStatusDto, type AnchorTenantDto, ANCHOR_STATUS_NAMES, JOB_STATUS_NAMES,
  type ProposalEvaluationDto, type EvalRefusalDto, type CompanyDimensionsDto, type DimensionRowDto, type DimensionCell, DIMENSION_KEYS, DIMENSION_WINDOWS,
} from '../../../shared/contracts/src/index.ts';

export const errorEnvelope: V<ErrorEnvelope> = obj<ErrorEnvelope>({ code: oneOf(ERROR_CODES), message: str, correlationId: str, retryable: bool, fieldErrors: opt(dict(str)) });
export const okBody: V<{ ok: boolean }> = obj({ ok: lit(true) });

// ---- health, operations, policy, audit
export const health: V<HealthDto> = obj<HealthDto>({ ok: bool, db: oneOf(['up', 'down'] as const), version: str });
export const opsHealth: V<OpsHealthDto> = obj<OpsHealthDto>({
  version: str, api: obj({ status: lit('up' as const), uptimeSec: num }),
  db: obj({ status: oneOf(['up', 'down'] as const), sizeBytes: opt(num), missions: opt(int) }),
  events: obj({ count: int, lastAt: nullable(iso) }), sse: obj({ clients: int }),
  backup: obj({ last: nullable(iso), file: nullable(str), count: int }), execution: lit('disabled' as const), checkedAt: iso,
});
export const queues: V<QueueSummaryDto> = obj<QueueSummaryDto>({
  kinds: arr(obj<QueueSummaryDto['kinds'][number]>({ kind: str, counts: obj<Record<string, number>>(Object.fromEntries(JOB_STATUS_NAMES.map((k) => [k, int])) as never), total: int })),
  oldestQueuedAgeSec: nullable(int), expiredLeases: int, total: int, execution: lit('disabled' as const), recordsOnly: lit(true as const), checkedAt: iso,
});
const anchorTenant: V<AnchorTenantDto> = obj<AnchorTenantDto>({ tenant: str, status: oneOf(ANCHOR_STATUS_NAMES), anchoredSeq: nullable(int), anchoredAt: nullable(iso), reason: nullable(str) });
export const anchors: V<AnchorStatusDto> = obj<AnchorStatusDto>({ configured: bool, ok: bool, lastAnchorAt: nullable(iso), restartedAt: nullable(iso), reason: nullable(str), tenants: arr(anchorTenant), checkedAt: iso });
export const auditVerify: V<AuditVerifyDto> = obj<AuditVerifyDto>({ ok: bool, checked: int, firstBadSeq: opt(int), reason: opt(str) });
const policyKind: V<PolicyKindDto> = obj<PolicyKindDto>({ kind: str, tier: str, effect: str, approver: nullable(str), heldBy: opt(str), note: opt(str), prohibited: nullable(str), why: str });
export const policyBaseline: V<PolicyBaselineDto> = obj<PolicyBaselineDto>({ version: int, source: str, tiers: arr(str), kinds: arr(policyKind) });

// ---- auth
const avatar: V<AvatarDto> = obj<AvatarDto>({ kind: oneOf(['initials', 'image', 'robot'] as const), hue: num, image: opt(str), robot: opt(str) });
const device: V<DeviceDto> = obj<DeviceDto>({ id: str, name: str, kind: oneOf(['desktop', 'laptop', 'phone', 'tablet'] as const), browser: str, status: oneOf(['pending', 'approved', 'blocked'] as const), addedAt: num, lastSeenAt: num });
export const account: V<AccountDto> = obj<AccountDto>({
  id: str, name: str, role: oneOf(['admin', 'member'] as const), status: oneOf(['pending', 'approved', 'rejected', 'disabled'] as const), avatar, devices: arr(device),
  createdAt: num, approvedAt: opt(num), approvedBy: opt(str), passwordChangedAt: opt(num),
});
export const me: V<MeDto> = obj<MeDto>({ account, deviceId: str, csrf: str });
export const meBody = obj<{ me: MeDto }>({ me });
export const connectResult: V<ConnectResult> = either(
  obj({ state: lit('signedIn' as const), me }),
  obj({ state: lit('waiting' as const), reason: oneOf(['user', 'device'] as const), name: str, device: obj({ name: str }) }),
);
export const peopleBody = obj<{ people: AccountDto[] }>({ people: arr(account) });
export const usersBody = obj<{ users: AccountDto[] }>({ users: arr(account) });
export const helloBody = obj<{ firstEver: boolean }>({ firstEver: bool });

// ---- missions
const fileKind = oneOf(['image', 'audio', 'video', 'doc', 'pdf', 'txt', 'file'] as const);
const missionFile: V<MissionFileDto> = obj<MissionFileDto>({ id: str, name: str, kind: fileKind, size: num, mime: str, url: opt(str), excerpt: opt(str) });
const staffing: V<StaffingDto> = obj<StaffingDto>({
  stage: oneOf(['reading', 'appointing', 'recruiting', 'working'] as const),
  plan: arr(obj({ agentId: str, why: str, managerId: opt(str) })), joined: int,
  log: arr(obj({ at: num, text: str, agentId: opt(str), by: opt(str) })),
  org: opt(obj({ revision: opt(int), dept: str, executorFrom: oneOf(['head', 'fixture'] as const) })),
  stalled: opt(obj({ code: str, reason: str, at: num, attempts: int })),
});
export const mission: V<MissionDto> = openObj<MissionDto>({
  id: str, title: str, kind: str, priority: oneOf(['low', 'normal', 'high', 'critical'] as const),
  status: oneOf(['draft', 'queued', 'planning', 'running', 'verifying', 'waiting', 'paused', 'completed', 'failed', 'canceled', 'archived'] as const), serverStatus: oneOf(MISSION_STATUSES),
  owner: str, ownerId: str, shared: bool, content: obj({ text: str, files: arr(missionFile) }), objective: str,
  criteria: arr(obj({ text: str, done: bool })), revision: int, rowVersion: int, syncVersion: int, demo: bool,
  summaryAgoMin: num, lastEventAgoMin: num, createdAgoDays: num, agentIds: arr(str), leadId: str, executorId: opt(str), phases: arr(obj<PhaseDto>({ key: str, label: str, date: str, state: str })), staffing: opt(staffing), prePause: opt(oneOf(MISSION_STATUSES)),
  progress: num, tasksVerified: num, tasksTotal: num, blocked: num, summary: str, lastEvent: str, elapsedH: num, dueInDays: num, version: str,
  pendingApprovals: num, unread: num, archivedAt: opt(num), updatedAt: num,
});
export const missionBody = obj<{ mission: MissionDto }>({ mission });
export const missionsBody = obj<{ missions: MissionDto[] }>({ missions: arr(mission) });
export const upload: V<UploadDto> = obj<UploadDto>({ id: str, name: str, kind: fileKind, size: int, mime: str, excerpt: opt(str) });

// ---- approvals, notifications
export const approval: V<ApprovalDto> = obj<ApprovalDto>({
  id: str, missionId: str, agentId: str, title: str, detail: str, kind: str, risk: str, riskTier: str, digest: str, digestVersion: int, demo: bool,
  taskId: nullable(str), origin: nullable(str), target: nullable(str), requestedBy: nullable(str), effect: nullable(str), effectWhy: nullable(str), approver: str,
  consumed: bool, consumedAt: nullable(num), decidedByName: nullable(str),
  canDecide: bool, decideBlockedReason: nullable(oneOf(['tier_requires_admin', 'requester_cannot_decide', 'already_decided', 'expired'] as const)),
  status: oneOf(['pending', 'approved', 'denied'] as const), state: oneOf(['pending', 'approved', 'denied', 'expired', 'revoked'] as const), expiresMin: num, agoMin: num, expiresAt: num,
});
export const approvalsBody = obj<{ approvals: ApprovalDto[] }>({ approvals: arr(approval) });
export const approvalBody = obj<{ approval: ApprovalDto }>({ approval });
const notice: V<NoticeDto> = obj<NoticeDto>({
  id: str, severity: oneOf(['critical', 'warning', 'info', 'success'] as const), category: oneOf(['mission', 'agent', 'system', 'approval', 'evolution'] as const),
  title: str, body: str, route: opt(str), missionId: opt(str), actionable: bool, agoMin: num, createdAt: num,
});
export const noticesBody = obj<{ notifications: NoticeDto[]; read: string[] }>({ notifications: arr(notice), read: arr(str) });

// ---- instances, tasks
export const instanceState = oneOf(['working', 'waiting', 'blocked', 'idle', 'verifying', 'done', 'reporting'] as const);
export const instance: V<InstanceDto> = obj<InstanceDto>({
  id: str, missionId: str, agentId: str, versionId: str, versionLabel: str, managerInstanceId: nullable(str), state: instanceState, task: str, progress: num, simulated: bool,
  createdAt: nullable(iso), endedAt: nullable(iso),
});
export const instanceBody = obj<{ instance: InstanceDto }>({ instance });
export const instancesBody: V<InstancesPageDto> = obj<InstancesPageDto>({ instances: arr(instance), truncated: bool, nextBefore: opt(str) });
const node: V<HierarchyNodeDto> = obj<HierarchyNodeDto>({ instanceId: str, agentId: str, parent: opt(str), task: str, state: instanceState, tasks: int, pending: int, progress: num, versionLabel: str });
const hedge: V<HierarchyEdgeDto> = obj<HierarchyEdgeDto>({ from: str, to: str, kind: str });
export const hierarchy: V<HierarchyDto> = obj<HierarchyDto>({ nodes: arr(node), edges: arr(hedge) });
export const task: V<TaskDto> = obj<TaskDto>({
  id: str, title: str, owner: nullable(str), deps: arr(str), state: oneOf(['queued', 'ready', 'running', 'waiting-agent', 'waiting-user', 'verifying', 'passed', 'failed', 'canceled'] as const),
  weight: num, evidence: int, col: int, row: int,
});
export const taskBody = obj<{ task: TaskDto }>({ task });
export const missionTasks: V<TaskDto[]> = arr(task);

// ---- task reviews
const reviewActor: V<ReviewActor> = obj<ReviewActor>({ id: str, kind: oneOf(['user', 'agent'] as const), name: str, modelFamily: nullable(str) });
const rubricItem: V<RubricItem> = obj<RubricItem>({ criterion: str, result: oneOf(RUBRIC_RESULTS), note: str });
const evidenceRef: V<EvidenceRef> = obj<EvidenceRef>({ kind: oneOf(EVIDENCE_KINDS), ref: str, label: opt(str) });
const agreement: V<ReviewerAgreement> = obj<ReviewerAgreement>({ agreed: int, n: int, rate: nullable(num), state: oneOf(['ok', 'none'] as const) });
const taskReview: V<TaskReviewDto> = obj<TaskReviewDto>({ id: str, taskId: str, missionId: str, reviewer: reviewActor, producer: reviewActor, verdict: oneOf(REVIEW_VERDICTS), rubric: arr(rubricItem), evidence: arr(evidenceRef), createdAt: iso, reviewerAgreement: agreement, stale: nullable(obj<{ beforeAttempt: number }>({ beforeAttempt: int })) });
export const taskReviewBody = obj<{ review: TaskReviewDto }>({ review: taskReview });
export const taskReviews: V<TaskReviewsDto> = obj<TaskReviewsDto>({
  taskId: str, missionId: str, producer: nullable(reviewActor), taskStatus: str, canAccept: bool,
  canReview: obj({ allowed: bool, code: nullable(str), reason: nullable(str) }), criteria: arr(str),
  evidenceOptions: arr(obj({ kind: oneOf(EVIDENCE_KINDS), ref: str, label: str })), reviews: arr(taskReview), verified: bool,
});

// ---- delegation briefs
const tier = oneOf(['R0', 'R1', 'R2', 'R3', 'R4'] as const);
const capability = obj<{ kind: string; origin?: string }>({ kind: str, origin: opt(str) });
const briefDto: V<DelegationBriefDto> = obj<DelegationBriefDto>({
  id: str, missionId: str, taskId: nullable(str), fromId: str, fromKind: oneOf(['user', 'agent'] as const), toInstanceId: str, toAgentId: str,
  brief: obj({ goal: str, inputs: arr(str), acceptance: arr(str), capabilities: arr(capability), budget: opt(num), deadline: opt(str), escalation: str }),
  sha256: str, parentBriefId: nullable(str), supersedesId: nullable(str), depth: int, simulated: bool, createdAt: iso,
  tiers: dict(nullable(tier as V<BriefTier>)),
  effective: opt(obj({ capabilities: arr(capability), deadline: nullable(str), budget: nullable(num), narrowedBy: arr(obj({ briefId: str, toAgentId: str, dropped: arr(str) })) })),
});
export const briefBody = obj<{ brief: DelegationBriefDto }>({ brief: briefDto });
const delegableKind: V<DelegableKind> = obj<DelegableKind>({ kind: str, tier, effect: str, approver: nullable(str), allowed: bool, why: str });
export const briefList: V<DelegationBriefList> = obj<DelegationBriefList>({ briefs: arr(briefDto), maxDepth: int, kinds: arr(delegableKind) });

// ---- ledgers
const factV = obj<{ text: string; source?: string }>({ text: str, source: opt(str) });
const taskLedgerBody: V<TaskBody> = obj<TaskBody>({
  facts: obj<TaskBody['facts']>({ given: arr(factV), to_look_up: arr(factV), to_derive: arr(factV), guesses: arr(factV) }),
  steps: arr(obj<TaskBody['steps'][number]>({ id: str, text: str, owner: opt(str), status: oneOf(STEP_STATUSES) })),
});
const progressBody: V<ProgressBody> = obj<ProgressBody>({ satisfied: bool, looping: bool, progressing: bool, next_speaker: opt(str), next_instruction: opt(str), notes: str, stall: int });
const ledgerMeta = { version: int, authorId: str, authorName: str, authorKind: oneOf(['human', 'agent', 'system'] as const), createdAt: iso, demo: bool };
const ledgerVersion: V<LedgerVersionDto> = obj<LedgerVersionDto>(ledgerMeta);
const taskLedger: V<LedgerDto<TaskBody>> = obj<LedgerDto<TaskBody>>({ id: str, missionId: str, kind: lit('task' as const), body: taskLedgerBody, ...ledgerMeta });
const progressLedger: V<LedgerDto<ProgressBody>> = obj<LedgerDto<ProgressBody>>({ id: str, missionId: str, kind: lit('progress' as const), body: progressBody, ...ledgerMeta });
export const ledgerBody = obj<{ ledger: LedgerDto }>({ ledger: either(taskLedger, progressLedger) as V<LedgerDto> });
export const ledgerVersions: V<LedgerVersionPageDto> = obj<LedgerVersionPageDto>({ versions: arr(ledgerVersion), next: nullable(int) });
export const ledgers: V<LedgersDto> = obj<LedgersDto>({
  ledgers: obj({ task: nullable(taskLedger), progress: nullable(progressLedger) }),
  versions: obj({ task: arr(ledgerVersion), progress: arr(ledgerVersion) }),
  moreVersions: obj({ task: nullable(int), progress: nullable(int) }),
  stall: obj({ stalled: bool, counter: int, reason: nullable(oneOf(['no-progress', 'looping'] as const)) }),
  policy: obj({ nonProgressing: lit(STALL_POLICY.nonProgressing), loopingInARow: lit(STALL_POLICY.loopingInARow) }), canEdit: bool, demo: bool,
});

// ---- conversations
const attachment: V<AttachmentDto> = obj<AttachmentDto>({ id: str, name: str, kind: oneOf(['image', 'audio', 'video', 'doc', 'file', 'link'] as const), size: opt(str), url: opt(str) });
export const message: V<MessageDto> = obj<MessageDto>({
  id: str, seq: int, threadId: str, from: str, to: str, kind: oneOf(['delegation', 'report', 'consult', 'command', 'reply', 'question', 'ack', 'result', 'system'] as const),
  text: str, agoMin: num, ts: num, taskId: opt(str), replyTo: opt(str), attachments: opt(arr(attachment)),
  status: opt(oneOf(['sent', 'delivered', 'acknowledged', 'queued'] as const)), simulated: bool,
  author: obj({ kind: oneOf(['human', 'agent', 'system'] as const), id: str, name: str, instanceId: opt(str) }),
});
export const messageBody = obj<{ message: MessageDto }>({ message });
export const messagePage: V<MessagePageDto> = obj<MessagePageDto>({ messages: arr(message), hasMore: bool, nextBefore: nullable(int) });
const thread: V<ThreadDto> = obj<ThreadDto>({
  id: str, missionId: nullable(str), kind: str, a: str, b: str, aAgentId: nullable(str), bAgentId: nullable(str), count: int, unread: int, lastMessage: nullable(message), createdAt: iso,
});
const partner: V<ThreadPartnerDto> = obj<ThreadPartnerDto>({ threadId: nullable(str), kind: str, human: bool, withInstanceId: nullable(str), withAgentId: nullable(str), lastMessage: nullable(message), unread: int, count: int });
export const missionThreads: V<MissionThreadsDto> = obj<MissionThreadsDto>({ threads: arr(thread), instances: arr(obj({ instanceId: str, agentId: str, partners: arr(partner) })) });
export const threadIdBody = obj<{ threadId: string }>({ threadId: str });
const channel: V<ChannelDto> = obj<ChannelDto>({
  kind: oneOf(['gm', 'admin', 'agent'] as const), userId: str, userName: opt(str), agentId: opt(str), threadId: nullable(str), count: int, unread: int, last: nullable(message),
});
export const channelsBody = obj<{ channels: ChannelDto[] }>({ channels: arr(channel) });

// ---- agents
const provenance: V<Provenance> = obj<Provenance>({ source: oneOf(['demo-fixture', 'measured'] as const), sample: nullable(int), window: lit('90d' as const) });
const reliability: V<AgentReliability> = obj<AgentReliability>({ value: nullable(num), n: int, window: lit('90d' as const), evidence: str, includesSimulated: bool });
const agentVersion: V<AgentVersionDto> = obj<AgentVersionDto>({ id: str, seq: int, label: str, parentVersionId: nullable(str), model: str, skills: arr(str), tools: arr(str), promptHash: str, createdBy: str, createdAt: iso });
export const agent: V<AgentDto> = openObj<AgentDto>({
  id: str, name: str, role: str, dept: str, duty: str, description: str, parentId: opt(str), managerId: opt(str), site: opt(str), avatar: rec, metrics: opt(dict(num)),
  status: str, lifecycle: oneOf(['active', 'retired'] as const), model: str, skills: arr(str), tools: arr(str), version: str, versionId: str, versionLabel: str,
  rowVersion: int, provenance, createdAt: iso, versions: opt(arr(agentVersion)), reliability,
});
export const agentBody = obj<{ agent: AgentDto }>({ agent });
/** POST /agents/:id/rollback also returns the NEW version it created (a rollback adds a version equal to the target; nothing is reused). */
export const agentRollbackBody = obj<{ agent: AgentDto; version: AgentVersionDto }>({ agent, version: agentVersion });
export const agentsBody = obj<{ agents: AgentDto[] }>({ agents: arr(agent) });

const versionConfig: V<VersionConfig> = obj<VersionConfig>({ model: str, skills: arr(str), tools: arr(str) });
const versionDiff: V<VersionDiff> = obj<VersionDiff>({ skillsAdded: arr(str), skillsRemoved: arr(str), toolsAdded: arr(str), toolsRemoved: arr(str), model: nullable(obj({ from: str, to: str })), changed: bool });
const nullOnly = nul;
const evalRefusal: V<EvalRefusalDto> = obj<EvalRefusalDto>({ code: str, detail: str });
const proposalEvaluation: V<ProposalEvaluationDto> = obj<ProposalEvaluationDto>({
  outcome: oneOf(['verified_better', 'inconclusive', 'worse'] as const), n: int, wins: int, losses: int, ties: int, k: int,
  delta: nullable(num), ci: obj<ProposalEvaluationDto['ci']>({ low: nullable(num), high: nullable(num) }), baselineMean: nullable(num), candidateMean: nullable(num),
  passHatK: obj<ProposalEvaluationDto['passHatK']>({ baseline: arr(nullable(num)), candidate: arr(nullable(num)) }),
  refusals: arr(evalRefusal), reasons: arr(str), notes: arr(str),
  datasetId: str, datasetSha: nullable(str), baseRunId: nullable(str), candidateRunId: str, runCount: int,
});
const versionProposal: V<VersionProposalDto> = obj<VersionProposalDto>({
  id: str, agentId: str, agentName: str, title: str, hypothesis: str, baseVersionId: str, baseVersionLabel: str, baseSha: str, base: versionConfig, candidate: versionConfig, candidateSha: str,
  diff: versionDiff, sha: str, status: oneOf(['pending', 'promoted', 'rejected', 'withdrawn', 'expired'] as const), activeVersionId: str, stale: bool,
  createdBy: str, createdByName: str, createdAt: iso, expiresAt: iso, decidedBy: nullable(str), decidedByName: nullable(str), decidedAt: nullable(iso), note: nullable(str),
  promotedVersionId: nullable(str), promotedVersionLabel: nullable(str), evaluation: nullable(proposalEvaluation), evaluationSha: str, overrideReason: nullable(str),
});
export const versionProposalBody = obj<{ proposal: VersionProposalDto }>({ proposal: versionProposal });
export const versionProposalsBody = obj<{ proposals: VersionProposalDto[] }>({ proposals: arr(versionProposal) });

// ---- organisation
const orgEdge: V<OrgEdgeDto> = obj<OrgEdgeDto>({ supervisorId: str, subordinateId: str, edgeType: str });
const orgRevision: V<OrgRevisionDto> = obj<OrgRevisionDto>({ id: int, seq: int, note: str, createdBy: str, activeFrom: iso });
export const orgGraph = obj<{ revision: OrgRevisionDto | null; edges: OrgEdgeDto[] }>({ revision: nullable(orgRevision), edges: arr(orgEdge) });
const orgCoverage: V<OrgCoverage> = obj<OrgCoverage>({
  roles: arr(obj({ role: str, agentIds: arr(str) })), missingRoles: arr(str), duplicateRoles: arr(obj({ role: str, agentIds: arr(str) })), deptsWithoutHead: arr(str),
  managersWithoutReports: arr(str), agentsWithoutDuty: arr(str), span: obj({ max: int, agentId: nullable(str), managers: int }), depth: int,
});
const coverageChange: V<OrgCoverageChange> = obj<OrgCoverageChange>({ code: str, message: str, role: opt(str), dept: opt(str), agentId: opt(str) });
const dryRunCoverage: V<OrgDryRunCoverage> = obj<OrgDryRunCoverage>({ current: orgCoverage, proposed: orgCoverage, changes: arr(coverageChange) });
export const orgCoverageBody = obj<{ revision: number; coverage: OrgCoverage }>({ revision: int, coverage: orgCoverage });
const source: V<OrgRevisionSource> = either(
  obj({ kind: lit('proposal' as const), proposalId: str, title: str }),
  either(obj({ kind: lit('agent' as const), agentId: str }), either(obj({ kind: lit('seed' as const) }), obj({ kind: lit('other' as const) }))),
) as V<OrgRevisionSource>;
const revisionSummary: V<OrgRevisionSummaryDto> = obj<OrgRevisionSummaryDto>({
  id: int, seq: int, note: str, createdBy: str, activeFrom: iso, createdByName: str, source, appliedFromProposal: nullable(str), changed: int, coverage: opt(orgCoverage),
});
const revisionDetail: V<OrgRevisionDetailDto> = obj<OrgRevisionDetailDto>({
  id: int, seq: int, note: str, createdBy: str, activeFrom: iso, createdByName: str, source, appliedFromProposal: nullable(str), changed: int, coverage: opt(orgCoverage), edges: arr(orgEdge),
});
export const orgRevisions = obj<{ revisions: OrgRevisionSummaryDto[] }>({ revisions: arr(revisionSummary) });
export const orgRevisionBody = obj<{ revision: OrgRevisionDetailDto }>({ revision: revisionDetail });
export const orgDiff: V<OrgDiffDto> = obj<OrgDiffDto>({
  seq: int, against: int, added: arr(orgEdge), removed: arr(orgEdge), moved: arr(obj<OrgMoveDto>({ subordinate: str, from: str, to: str })),
  impact: arr(obj<OrgImpactDto>({ missionId: str, title: str, agentId: str, instanceId: str, demo: bool })),
});
const orgIssue: V<OrgIssue> = obj<OrgIssue>({ code: str, message: str, agentId: opt(str), dept: opt(str) });
const dryRun: V<OrgDryRun> = obj<OrgDryRun>({ ok: bool, errors: arr(orgIssue), warnings: arr(orgIssue), added: arr(orgEdge), removed: arr(orgEdge), coverage: opt(dryRunCoverage) });
const proposal: V<OrgProposalDto> = obj<OrgProposalDto>({
  id: str, title: str, why: str, baseRevision: int, edges: arr(orgEdge), sha: str,
  status: oneOf(['pending', 'approved', 'rejected', 'applied', 'failed', 'expired', 'withdrawn'] as const),
  createdBy: str, createdByName: str, createdAt: iso, expiresAt: iso, decidedBy: nullable(str), decidedByName: nullable(str), decidedAt: nullable(iso), decisionNote: nullable(str),
  appliedRevision: nullable(int), result: dryRun,
});
export const proposalBody = obj<{ proposal: OrgProposalDto }>({ proposal });
export const proposalsBody = obj<{ proposals: OrgProposalDto[]; activeRevision: number }>({ proposals: arr(proposal), activeRevision: int });
export const dryRunBody = obj<{ result: OrgDryRun; baseRevision: number }>({ result: dryRun, baseRevision: int });
/** POST /organization/proposals answers a proposal (201) or, with ?dryRun=1, the dry-run result (200). */
export const proposalOrDryRun = either(proposalBody, dryRunBody);

// ---- mentoring
const milestone: V<MentoringMilestoneDto> = obj<MentoringMilestoneDto>({ id: str, seq: int, text: str, doneBy: nullable(str), doneByName: nullable(str), doneAt: nullable(iso) });
const plan: V<MentoringPlanDto> = obj<MentoringPlanDto>({
  id: str, menteeId: str, menteeName: str, mentorId: str, mentorName: str, skill: str, reevalOn: str, status: oneOf(['active', 'completed', 'cancelled'] as const),
  milestones: arr(milestone), milestonesDone: int, milestonesTotal: int, createdBy: str, createdByName: str, createdAt: iso,
  closedBy: nullable(str), closedByName: nullable(str), closedAt: nullable(iso), note: nullable(str), evaluation: nullOnly,
});
export const planBody = obj<{ plan: MentoringPlanDto }>({ plan });
export const plansBody = obj<{ plans: MentoringPlanDto[] }>({ plans: arr(plan) });

// ---- playbooks and skills
const sourceRef: V<SourceRef> = obj<SourceRef>({ kind: oneOf(['mission', 'failure_tag', 'review', 'task', 'note'] as const), id: str, note: opt(str), verified: opt(bool), hidden: opt(bool) });
const lesson: V<LessonCandidateDto> = obj<LessonCandidateDto>({
  id: str, agentId: str, agentName: str, role: str, text: str, sources: arr(sourceRef), proposedBy: str, proposedByName: str, proposedByKind: oneOf(['human', 'agent'] as const),
  submittedBy: nullable(str), status: oneOf(['proposed', 'accepted', 'rejected', 'superseded'] as const), sha256: str, reviewBy: nullable(str), createdAt: iso,
  decidedBy: nullable(str), decidedByName: nullable(str), decidedAt: nullable(iso), decisionNote: nullable(str), overrideNote: nullable(str), acceptedInVersion: nullable(int),
  withdrawnInVersion: nullable(int), inPlaybook: bool, conflicts: arr(obj<LessonConflict>({ lessonId: str, text: str })), canDecide: bool, cannotDecideWhy: nullable(str),
});
const playbookItem: V<PlaybookItem> = obj<PlaybookItem>({
  lessonId: str, text: str, trust: lit('reviewed' as const), addedInVersion: int, sources: arr(sourceRef), sha256: str, reviewBy: nullable(str), contradiction: bool,
  contradicts: arr(str), overrideNote: nullable(str), needsReReview: bool,
});
const playbook: V<PlaybookDto> = obj<PlaybookDto>({
  agentId: str, agentName: str, role: str, version: int, items: arr(playbookItem), kind: nullable(oneOf(['accept', 'rollback'] as const)), createdBy: nullable(str), createdByName: nullable(str),
  createdAt: nullable(iso), rollbackTo: nullable(int), note: nullable(str),
});
const playbookRow: V<PlaybookVersionRow> = obj<PlaybookVersionRow>({
  version: int, kind: oneOf(['accept', 'rollback'] as const), items: int, createdBy: str, createdByName: str, createdAt: iso, rollbackTo: nullable(int), note: nullable(str), lessonId: nullable(str),
});
export const playbookBody = obj<{ playbook: PlaybookDto; versions: PlaybookVersionRow[] }>({ playbook, versions: arr(playbookRow) });
export const playbookVersionBody = obj<{ playbook: PlaybookDto }>({ playbook });
export const playbookDiffBody = obj<{ diff: PlaybookDiff }>({ diff: obj<PlaybookDiff>({ from: int, to: int, added: arr(playbookItem), removed: arr(playbookItem), kept: int }) });
export const playbookRollbackBody = obj<{ playbook: PlaybookDto; versions: number }>({ playbook, versions: int });
export const lessonBody = obj<{ lesson: LessonCandidateDto }>({ lesson });
export const lessonsBody = obj<{ lessons: LessonCandidateDto[] }>({ lessons: arr(lesson) });
export const lessonDecisionBody = obj<{ lesson: LessonCandidateDto; playbook: PlaybookDto | null }>({ lesson, playbook: nullable(playbook) });
const skillStep: V<SkillStep> = obj<SkillStep>({ kind: oneOf(['navigate', 'observe', 'fill', 'click', 'check', 'ask_human', 'note'] as const), target: opt(str), detail: str, origin: opt(str) });
const skill: V<SkillDto> = obj<SkillDto>({
  id: str, name: str, version: int, description: str, steps: arr(skillStep), preconditions: arr(str), sources: arr(sourceRef), status: oneOf(['draft', 'approved', 'retired'] as const),
  proposedBy: str, proposedByName: str, createdAt: iso, approvedBy: nullable(str), approvedByName: nullable(str), approvedAt: nullable(iso), retiredBy: nullable(str), retiredAt: nullable(iso),
  retireNote: nullable(str), canDecide: bool, cannotDecideWhy: nullable(str),
});
export const skillBody = obj<{ skill: SkillDto }>({ skill });
export const skillsBody = obj<{ skills: SkillDto[] }>({ skills: arr(skill) });

const DETECTION_CHANNEL_IDS = DETECTION_CHANNELS.map((x) => x.id) as unknown as readonly (typeof DETECTION_CHANNELS)[number]['id'][];
const FAILURE_MECHANISM_IDS = FAILURE_MECHANISMS.map((x) => x.id) as unknown as readonly (typeof FAILURE_MECHANISMS)[number]['id'][];
const FAILURE_CONTROL_IDS = FAILURE_CONTROLS.map((x) => x.id) as unknown as readonly (typeof FAILURE_CONTROLS)[number]['id'][];
// ---- site grants, failure tags
const grantCap = oneOf(['read', 'screenshot', 'summarize', 'fill_draft'] as const);
const grant: V<SiteGrantDto> = obj<SiteGrantDto>({
  id: str, missionId: str, origin: str, capabilities: arr(grantCap), issuedBy: str, issuedByName: str, issuedAt: iso, expiresAt: iso, state: oneOf(['active', 'expired', 'revoked'] as const),
  revokedAt: nullable(iso), revokedBy: nullable(str), revokedByName: nullable(str), reason: nullable(str), tier: str,
});
export const grantsBody = obj<{ grants: SiteGrantDto[]; maxDays: number; capabilities: SiteGrantDto['capabilities'] }>({ grants: arr(grant), maxDays: int, capabilities: arr(grantCap) });
export const grantIssued = obj<{ grant: SiteGrantDto; decision: { tier: string; approver: string | null; policyVersion: number; reasons: string[] } }>({
  grant, decision: obj({ tier: str, approver: nullable(str), policyVersion: int, reasons: arr(str) }),
});
export const grantBody = obj<{ grant: SiteGrantDto }>({ grant });
export const originCheck: V<OriginCheckDto> = obj<OriginCheckDto>({ ok: bool, origin: opt(str), reason: opt(str), message: opt(str) });
const failureAttribution: V<FailureAttributionDto> = obj<FailureAttributionDto>({
  id: str, agentId: nullable(str), stepRef: nullable(str), fullTraceAvailable: bool, attributedBy: str, attributedByName: str, attributedByKind: oneOf(['user', 'agent'] as const), createdAt: iso,
});
const failureTag: V<FailureTagDto> = obj<FailureTagDto>({
  id: str, subjectKind: oneOf(FAILURE_SUBJECT_KINDS), subjectId: str, missionId: str, taxonomyVersion: str, modeId: str, modeName: str, categoryId: str, categoryName: str, note: nullable(str),
  taggedBy: str, taggedByName: str, taggedByKind: oneOf(['user', 'agent'] as const), status: oneOf(['proposed', 'confirmed', 'rejected'] as const), selfConfirmed: bool, createdAt: iso,
  decidedBy: nullable(str), decidedByName: nullable(str), decidedAt: nullable(iso), attributions: arr(failureAttribution), attributionDisagreements: int,
  detectionChannel: nullable(oneOf(DETECTION_CHANNEL_IDS)), detectedAfterSeconds: nullable(int), mechanism: nullable(oneOf(FAILURE_MECHANISM_IDS)),
  controlExpected: nullable(oneOf(FAILURE_CONTROL_IDS)), controlCaught: nullable(oneOf(FAILURE_CONTROL_IDS)), detectionNote: nullable(str),
});
export const failureTagBody = obj<{ tag: FailureTagDto }>({ tag: failureTag });
export const failureTagsBody = obj<{ subject: FailureSubjectInfo; tags: FailureTagDto[] }>({
  subject: obj<FailureSubjectInfo>({ kind: oneOf(FAILURE_SUBJECT_KINDS), id: str, missionId: str, demo: bool, failed: bool, retried: bool }), tags: arr(failureTag),
});
const modeCount: V<FailureModeCount> = obj<FailureModeCount>({ id: str, name: str, count: nullable(int) });
const categoryCount: V<FailureCategoryCount> = obj<FailureCategoryCount>({ id: str, name: str, count: nullable(int), modes: arr(modeCount) });
const detectionField: V<DetectionFieldCount> = obj<DetectionFieldCount>({ have: int, missing: int, missingShare: nullable(num) });
const detection: V<FailureDetectionDto> = obj<FailureDetectionDto>({
  n: int,
  fields: obj<FailureDetectionDto['fields']>({ channel: detectionField, detectedAfter: detectionField, mechanism: detectionField, controlExpected: detectionField, controlCaught: detectionField }),
  channels: obj<FailureDetectionDto['channels']>({ test: int, audit: int, human_review: int, other_agent: int, reported_later: int }),
  humanOnly: obj<FailureDetectionDto['humanOnly']>({ humanReview: int, withChannel: int, missing: int, share: nullable(num), minN: int, window: oneOf(SCORECARD_WINDOWS) }),
});
export const failureModes: V<FailureModesDto> = obj<FailureModesDto>({
  window: oneOf(SCORECARD_WINDOWS), from: iso, to: iso, includeDemo: bool, taxonomyVersion: str, source: str, n: int, demo: int, selfConfirmed: int, proposed: int, categories: arr(categoryCount), detection,
});

const failurePattern: V<FailurePatternDto> = obj<FailurePatternDto>({
  id: str, modeId: str, modeName: str, windowDays: int, failures: int, departments: arr(str), candidateId: str, candidateStatus: oneOf(['proposed', 'accepted', 'rejected', 'superseded'] as const), derivedBy: lit('system_failure_pattern' as const), createdAt: iso,
});
export const failurePatterns: V<FailurePatternsDto> = obj<FailurePatternsDto>({ minFailures: int, minDepartments: int, windowDays: int, patterns: arr(failurePattern) });

// ---- company: scorecard, throughput, departments
const scoreRow: V<ScorecardRow> = obj<ScorecardRow>({
  key: oneOf(['started', 'finished', 'verified_success_rate', 'completed_unverified', 'median_cycle_time_h', 'failure_rate', 'task_recovery_rate', 'waiting_approval_median_h', 'approved_by_non_owner', 'tasks_verified_by_review'] as const),
  label: str, value: nullable(num), unit: oneOf(['%', 'h', 'missions', 'tasks'] as const), n: int, evidence: str, state: oneOf(['ok', 'none'] as const),
  previous: obj({ value: nullable(num), n: int }), trend: nullable(oneOf(['up', 'down', 'flat'] as const)),
});
export const scorecard: V<CompanyScorecardDto> = obj<CompanyScorecardDto>({ window: oneOf(SCORECARD_WINDOWS), from: iso, to: iso, includeDemo: bool, previousFrom: iso, previousTo: iso, rows: arr(scoreRow) });
export const throughput: V<ThroughputDto> = obj<ThroughputDto>({ weeks: arr(obj({ from: iso, to: iso, started: int, finished: int })), includeDemo: bool, to: iso });
const deptFacts: V<DepartmentFacts> = obj<DepartmentFacts>({
  name: str, headAgentId: nullable(str), gmReports: arr(str), memberIds: arr(str), staffedAgents: int, activeMissions: int,
  openTasks: obj({ running: int, waiting: int, failed: int }), outcomes: obj({ passed: int, failed: int, retried: int, n: int }),
  lastOrgChange: nullable(obj({ revision: int, at: iso })), evidence: str,
});
export const departments: V<DepartmentsDto> = obj<DepartmentsDto>({ window: oneOf(SCORECARD_WINDOWS), from: iso, to: iso, includeDemo: bool, departments: arr(deptFacts) });

// ---- company dimensions (c46)
const dimensionCell: V<DimensionCell> = obj<DimensionCell>({
  key: str, label: str, value: nullable(num), unit: oneOf(['%', 'h', 'count'] as const), n: nullable(int), minN: int, basis: oneOf(['window', 'snapshot', 'none'] as const),
  from: nullable(iso), to: nullable(iso), evidence: str, scope: oneOf(['missions', 'company'] as const), state: oneOf(['ok', 'none', 'hidden', 'unmeasured'] as const),
  previous: obj<DimensionCell['previous']>({ value: nullable(num), n: int }), trend: nullable(oneOf(['up', 'down', 'flat'] as const)),
});
const dimensionRow: V<DimensionRowDto> = obj<DimensionRowDto>({ key: oneOf(DIMENSION_KEYS), label: str, cells: arr(dimensionCell) });
export const dimensions: V<CompanyDimensionsDto> = obj<CompanyDimensionsDto>({
  window: oneOf(DIMENSION_WINDOWS), from: iso, to: iso, previousFrom: iso, previousTo: iso, department: nullable(str), departments: arr(str), dimensions: arr(dimensionRow),
});
