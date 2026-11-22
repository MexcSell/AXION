/** SSE envelope (spec §12.2). */
export interface DomainEvent<P = Record<string, unknown>> {
  id: string;
  seq: number | null;
  type: string;
  tenantId: string;
  missionRunId?: string;
  /** Stage 6: the mission an event belongs to (thread and instance events have other subjects) */
  missionId?: string;
  actor: { kind: 'human' | 'agent' | 'system'; id: string };
  subject: { kind: string; id: string };
  occurredAt: string;
  correlationId: string;
  payload: P;
  schemaVersion: number;
}
/**
 * Every event type the server sends (a runtime list since c50, so tests can enumerate it; `EventType` is derived from it).
 * Adding a type here without a payload contract in `EventPayloads` fails `tsc`, and without a validator in
 * server/test/contracts/events.ts fails the inventory test.
 */
export const EVENT_TYPES = [
  'mission.created', 'mission.revised', 'mission.stateChanged', 'mission.shared', 'mission.deleted', 'staffing.progressed', 'staffing.stalled', 'staffing.resumed',
  'approval.requested', 'approval.decided', 'approval.consumed', 'notification.created',
  'conversation.messageCreated', 'conversation.receipt', 'instance.created', 'instance.stateChanged', 'task.delegated', 'task.stateChanged', 'task.reviewed',
  'agent.created', 'agent.updated', 'agent.versionCreated',
  'agent.versionProposed', 'agent.versionPromoted', 'agent.rolledBack', 'agent.versionProposalDecided',
  'ledger.updated',
  'mentoring.planned', 'mentoring.milestoneDone', 'mentoring.closed',
  'grant.issued', 'grant.revoked',
  'failure.tagged', 'failure.decided',
  'playbook.lessonProposed', 'playbook.lessonDecided', 'playbook.versionCreated', 'skill.proposed', 'skill.decided',
  'org.proposalCreated', 'org.proposalDecided', 'org.revisionApplied',
  'user.requested', 'user.changed', 'auth.approved',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** `task.delegated`: one payload shape for both subjects (an instance joining under its manager, or a task reassigned). */
export interface TaskDelegatedPayload { taskId?: string; fromInstance: string; toInstance: string; kind: 'delegated'; simulated?: boolean; by?: string }
