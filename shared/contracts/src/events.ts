/** SSE envelope (spec §12.2). */
export interface DomainEvent<P = Record<string, unknown>> {
  id: string;
  seq: number | null;
  type: string;
  tenantId: string;
  missionRunId?: string;
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
  | 'user.requested' | 'user.changed' | 'auth.approved';
