import type { Tx } from '../db.ts';
import { appendEvent, type Audience } from './log.ts';

/** Route-level helper: picks subject kind and audience from the event type. */
export interface EmitInput { tenantId: string; type: string; subject: string; missionId?: string; adminOnly?: boolean; actor?: string; actorKind?: 'human' | 'agent' | 'system'; subjectKind?: string; correlationId?: string; payload?: Record<string, unknown> }

export async function emit(c: Tx, e: EmitInput) {
  const userEvent = e.type.startsWith('user.') || e.type.startsWith('auth.');
  let audience: Audience = e.missionId ? 'mission' : 'all';
  if (userEvent) audience = 'user';
  if (e.type === 'mission.shared') audience = 'all'; // visible to everyone before (un-share) or after (share)
  if (e.adminOnly) audience = 'admins';
  return appendEvent(c, {
    tenantId: e.tenantId, type: e.type, missionId: e.missionId, payload: e.payload, correlationId: e.correlationId,
    subject: { kind: e.subjectKind ?? (e.missionId ? 'mission' : userEvent ? 'user' : 'other'), id: e.subject },
    actor: e.actor ? { kind: e.actorKind ?? 'human', id: e.actor } : undefined,
    audience, audienceUser: userEvent ? e.subject : undefined,
  });
}
