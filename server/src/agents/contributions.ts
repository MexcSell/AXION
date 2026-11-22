import type { Tx } from '../db.ts';
import type { ContributionAction, OriginChannel, OriginClass, SourceRef } from '../../../shared/contracts/src/index.ts';

/**
 * Improvement cycle 59 (R2-5): the contribution log. One append-only line per change to a lesson or a skill: who or what changed it
 * (a person, an agent, or the system), the record's write channel and class at that moment, and the sources it rested on. Written in
 * the SAME transaction as the change, so a refused or rolled-back change leaves no line. The time is the database's now().
 * The table refuses UPDATE, DELETE and TRUNCATE (the only DELETE allowed is the cascade of a demo purge): migration 0044.
 */
export interface Contribution {
  tenantId: string; kind: 'lesson' | 'skill'; recordId: string; action: ContributionAction;
  actor: string; actorKind: 'human' | 'agent' | 'system'; version?: number | null; note?: string | null; ref?: string | null;
}

/** The record's own origin and sources are read from its row, so a caller cannot write a line that disagrees with the record. */
export async function logContribution(c: Tx, x: Contribution): Promise<void> {
  const table = x.kind === 'lesson' ? 'lesson_candidates' : 'skills';
  const r = (await c.query(`select origin_channel, origin_class, sources from ${table} where id=$1 and tenant_id=$2`, [x.recordId, x.tenantId])).rows[0] as { origin_channel: OriginChannel; origin_class: OriginClass; sources: SourceRef[] } | undefined;
  if (!r) throw new Error('contribution for a record that does not exist: ' + x.recordId);
  await c.query(
    `insert into record_contributions(tenant_id, record_kind, record_id, action, actor, actor_kind, origin_channel, origin_class, sources, version, note, ref) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [x.tenantId, x.kind, x.recordId, x.action, x.actor, x.actorKind, r.origin_channel, r.origin_class, JSON.stringify(r.sources), x.version ?? null, x.note ?? null, x.ref ?? null]);
}

export const CONTRIBUTION_SELECT = `select rc.*, coalesce(u.name, a.name, rc.actor) as actor_name from record_contributions rc
  left join users u on u.id = rc.actor and rc.actor_kind = 'human' left join agent_definitions a on a.id = rc.actor and rc.actor_kind = 'agent'`;
