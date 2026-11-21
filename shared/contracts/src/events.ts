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
/** Event types the Stage 5 server sends. */
export type EventType =
  | 'mission.created' | 'mission.revised' | 'mission.stateChanged' | 'mission.shared' | 'mission.deleted' | 'staffing.progressed'
  | 'approval.requested' | 'approval.decided' | 'notification.created'
  | 'conversation.messageCreated' | 'conversation.receipt' | 'instance.created' | 'instance.stateChanged' | 'task.delegated' | 'task.stateChanged'
  | 'agent.created' | 'agent.updated' | 'agent.versionCreated'
  | 'agent.versionProposed' | 'agent.versionPromoted' | 'agent.rolledBack' | 'agent.versionProposalDecided'
  | 'org.proposalCreated' | 'org.proposalDecided' | 'org.revisionApplied'
  | 'user.requested' | 'user.changed' | 'auth.approved';
