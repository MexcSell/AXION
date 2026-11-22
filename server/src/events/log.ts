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

/**
 * The events lock key, scoped to the current schema like the audit-chain lock: one schema in production (same exclusivity
 * as the old constant 0x41584556), and in the test database each test schema gets its own lock, so a test that parks a
 * writer on it (audit-chain M1) no longer stalls every other schema's audit writes past their 5 s lock_timeout.
 * Use as `select pg_advisory_xact_lock(${EVENTS_LOCK})` (an SQL expression, not a parameter).
 */
export const EVENTS_LOCK = "hashtextextended(current_schema() || ':axion-events', 0)";
export const CHANNEL = 'axion_events';

/** Append one event inside the caller's transaction. Serialised so ids are visible in commit order; NOTIFY wakes streams on commit. */
export async function appendEvent(c: Tx, e: AppendInput): Promise<DomainEvent> {
  await c.query(`select pg_advisory_xact_lock(${EVENTS_LOCK})`);
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
