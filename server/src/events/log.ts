import type { Tx } from '../db.ts';
import type { DomainEvent } from '../../../shared/contracts/src/index.ts';

export type Audience = 'all' | 'admins' | 'user' | 'mission' | 'owner';
export interface AppendInput {
  tenantId: string;
  type: string;
  subject: { kind: string; id: string };
  missionId?: string;
  actor?: { kind: 'human' | 'agent' | 'system'; id: string };
  correlationId?: string;
  payload?: Record<string, unknown>;
  audience?: Audience;
  audienceUser?: string;
}

export const EVENTS_LOCK = 0x4158_4556; // 'AXEV'
export const CHANNEL = 'axion_events';

/** Append one event inside the caller's transaction. Serialised so ids are visible in commit order; NOTIFY wakes streams on commit. */
export async function appendEvent(c: Tx, e: AppendInput): Promise<DomainEvent> {
  await c.query('select pg_advisory_xact_lock($1)', [EVENTS_LOCK]);
  const seq = e.missionId ? Number((await c.query('select coalesce(max(seq), 0) + 1 as s from events where mission_id=$1', [e.missionId])).rows[0].s) : null;
  const r = (await c.query(
    `insert into events(tenant_id, type, mission_id, seq, actor_kind, actor_id, subject_kind, subject_id, audience, audience_user, payload, correlation_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning *`,
    [e.tenantId, e.type, e.missionId ?? null, seq, e.actor?.kind ?? 'system', e.actor?.id ?? 'system', e.subject.kind, e.subject.id,
      e.audience ?? (e.missionId ? 'mission' : 'all'), e.audienceUser ?? null, JSON.stringify(e.payload ?? {}), e.correlationId ?? ''])).rows[0];
  await c.query('select pg_notify($1, $2)', [CHANNEL, String(r.id)]);
  return eventDto(r);
}

export function eventDto(r: any): DomainEvent {
  return {
    id: String(r.id), seq: r.seq, type: r.type, tenantId: r.tenant_id, ...(r.mission_id ? { missionId: r.mission_id } : {}),
    actor: { kind: r.actor_kind, id: r.actor_id }, subject: { kind: r.subject_kind, id: r.subject_id },
    occurredAt: new Date(r.occurred_at).toISOString(), correlationId: r.correlation_id, payload: r.payload, schemaVersion: r.schema_version,
  };
}
