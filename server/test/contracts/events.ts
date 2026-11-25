import { str, int, bool, num, iso, unknownV, oneOf, opt, arr, lit, obj, nullable, type V } from './validate.ts';
import { message, instanceState } from './validators.ts';
import { EVENT_TYPES, MISSION_STATUSES, TASK_STATUSES, REVIEW_VERDICTS, type DomainEvent, type EventPayloads, type EventType } from '../../../shared/contracts/src/index.ts';

const severity = oneOf(['critical', 'warning', 'info', 'success'] as const);
const kindOfActor = oneOf(['user', 'agent'] as const);

/** One payload validator per event type. The mapped type makes tsc fail when a type of `EventPayloads` has none, or a field differs. */
export const EVENT_VALIDATORS: { [K in EventType]: V<EventPayloads[K]> } = {
  'mission.created': obj({ status: oneOf(MISSION_STATUSES) }),
  'mission.revised': obj({ revision: int }),
  'mission.stateChanged': obj({ from: oneOf(MISSION_STATUSES), to: oneOf(MISSION_STATUSES), action: str, by: str, simulated: opt(bool) }),
  'mission.shared': obj({ shared: bool }),
  'mission.deleted': obj({ ownerId: str, shared: bool }),
  'staffing.progressed': obj({ simulated: bool, stage: str, joined: int, agentId: opt(str), text: str }),
  'staffing.stalled': obj({ code: str, reason: str, at: num, attempts: int }),
  'staffing.resumed': obj({ by: str }),
  'approval.requested': obj({ approvalId: str, kind: str, risk: str, policyVersion: int, reasons: arr(str) }),
  'approval.decided': obj({ approvalId: str, decision: oneOf(['approved', 'denied', 'expired'] as const), by: str }),
  'approval.consumed': obj({ approvalId: str, kind: str, tier: str, by: str }),
  'notification.created': obj({ id: str, title: str, severity }),
  'conversation.messageCreated': obj({ threadId: str, messageId: str, seq: int, kind: str, simulated: bool, message, channel: opt(obj({ kind: str, userId: str, agentId: opt(str) })) }),
  'conversation.receipt': obj({ threadId: str, messageId: str, state: oneOf(['queued', 'delivered', 'acknowledged'] as const), simulated: bool, channel: opt(obj({ kind: str, userId: str, agentId: opt(str) })) }),
  'instance.created': obj({ instanceId: str, agentId: str, simulated: bool, managerInstanceId: opt(str) }),
  'instance.stateChanged': obj({ instanceId: str, state: instanceState }),
  'task.delegated': obj({ taskId: opt(str), fromInstance: str, toInstance: str, kind: lit('delegated' as const), simulated: opt(bool), by: opt(str) }),
  'task.stateChanged': obj({ taskId: str, from: oneOf(TASK_STATUSES), to: oneOf(TASK_STATUSES), action: str, by: str }),
  'task.reviewed': obj({ taskId: str, reviewId: str, verdict: oneOf(REVIEW_VERDICTS), reviewerId: str, reviewerKind: kindOfActor, by: str }),
  'agent.created': obj({ versionId: str, label: str }),
  'agent.updated': obj({ fields: unknownV, versionId: opt(str) }),
  'agent.versionCreated': obj({ versionId: str, label: str, seq: int, previousVersionId: str, proposalId: opt(str), rollbackOf: opt(str) }),
  'agent.versionProposed': obj({ proposalId: str, title: str, baseVersionId: str }),
  'agent.versionPromoted': obj({ proposalId: str, versionId: str, label: str, previousVersionId: str }),
  'agent.rolledBack': obj({ versionId: str, label: str, toVersionId: str, toLabel: str, previousVersionId: str }),
  'agent.versionProposalDecided': obj({ proposalId: str, status: oneOf(['expired', 'rejected', 'withdrawn'] as const) }),
  'ledger.updated': obj({ kind: oneOf(['task', 'progress'] as const), version: int }),
  'mentoring.planned': obj({ planId: str, mentorId: str, skill: str }),
  'mentoring.milestoneDone': obj({ planId: str, milestoneId: str, seq: int }),
  'mentoring.closed': obj({ planId: str, outcome: oneOf(['completed', 'cancelled'] as const) }),
  'grant.issued': obj({ grantId: str, missionId: str, origin: str }),
  'grant.revoked': obj({ grantId: str, missionId: str, origin: str }),
  'failure.tagged': obj({ tagId: str, subjectKind: str, subjectId: str, modeId: str, status: lit('proposed' as const), taggedByKind: kindOfActor }),
  'failure.decided': obj({ tagId: str, subjectKind: str, subjectId: str, modeId: str, status: oneOf(['confirmed', 'rejected'] as const), selfConfirmed: bool }),
  'playbook.lessonProposed': obj({ lessonId: str }),
  'playbook.lessonDecided': obj({ lessonId: str, status: oneOf(['accepted', 'rejected'] as const), version: opt(int) }),
  'playbook.versionCreated': obj({ version: int, lessonId: opt(str), rollbackTo: opt(int) }),
  'skill.proposed': obj({ skillId: str, version: int }),
  'skill.decided': obj({ skillId: str, status: oneOf(['approved', 'retired'] as const) }),
  'org.proposalCreated': obj({ title: str, baseRevision: int, ok: bool, rollbackTo: opt(int) }),
  'org.proposalDecided': obj({ status: oneOf(['expired', 'rejected', 'applied', 'withdrawn'] as const), revision: opt(int) }),
  'org.revisionApplied': obj({ revision: int, previous: int, proposalId: opt(str), agentId: opt(str) }),
  'user.requested': obj({ userId: str, name: str, device: str, deviceId: opt(str) }),
  'user.changed': obj({ userId: str, passwordChanged: opt(bool), deviceId: opt(str), revoked: opt(bool) }),
  'auth.approved': obj({ userId: str, deviceId: opt(str) }),
};

const envelopeShape = {
  id: str, seq: nullable(int), type: str, tenantId: str, missionRunId: opt(str), missionId: opt(str),
  actor: obj({ kind: oneOf(['human', 'agent', 'system'] as const), id: str }), subject: obj({ kind: str, id: str }),
  occurredAt: iso, correlationId: str, schemaVersion: int,
};
const envelope: V<Omit<DomainEvent, 'payload'>> = obj<Omit<DomainEvent, 'payload'>>(envelopeShape as any);
/** The whole event (envelope and payload) as one validator, for the node-wide mutation and coverage tests. */
export const eventValidator = (type: EventType): V<any> => obj<any>({ ...envelopeShape, payload: EVENT_VALIDATORS[type] } as any);

/** Validate one domain event (the envelope and its payload); an unknown type is itself drift. */
export function checkEvent(ev: unknown): string[] {
  const errs: string[] = [];
  const { payload, ...head } = (ev ?? {}) as { type?: string; payload?: unknown };
  envelope(head, 'event', errs);
  const v = head.type && (EVENT_TYPES as readonly string[]).includes(head.type) ? (EVENT_VALIDATORS as Record<string, V<unknown>>)[head.type] : undefined;
  if (!v) errs.push(`event.type ${String(head.type)}: no payload validator (not in EVENT_TYPES)`);
  else v(payload, `${head.type}.payload`, errs);
  return errs;
}
