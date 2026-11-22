import type { Tx } from '../db.ts';
import { ApiError, badRequest, notFound } from '../errors.ts';
import { ORIGIN_CLASSES, originRank, type OriginChannel, type OriginClass, type SourceRef } from '../../../shared/contracts/src/index.ts';

/**
 * Improvement cycle 59 (R2-5): the origin of a lesson or a skill. Pure rules plus one lookup.
 *  - The CHANNEL is decided by the code path that writes the record, never by a request body: the person route can only produce
 *    human_entry (or derived, when it cites other records); the service functions agents will use can produce agent_output,
 *    tool_output or derived, and can never produce human_entry.
 *  - The CLASS follows the channel. A derived record is never above its weakest record source and never above its writer's own class.
 *    Sources that are not records (mission, review, task, note...) carry no class and are not counted.
 *  - Review (accept, approve, rollback) is a different axis and never changes the class. The database holds the same rules
 *    (CHECK constraints, an insert trigger and the immutable-column guards in migration 0044).
 * Ruling: the order is tool < agent < human. It rests on our own tests, not on a published success rate.
 */
export const isRecordSource = (s: SourceRef) => s.kind === 'lesson' || s.kind === 'skill';
export const classOfChannel = (ch: Exclude<OriginChannel, 'derived'>): OriginClass => (ch === 'human_entry' ? 'human' : ch === 'agent_output' ? 'agent' : 'tool');
export const weakest = (xs: OriginClass[]): OriginClass => xs.reduce((a, b) => (originRank(b) < originRank(a) ? b : a), ORIGIN_CLASSES[ORIGIN_CLASSES.length - 1]);

export interface OriginArgs { tenantId: string; kind: 'human' | 'agent'; submittedBy?: string | null; channel?: OriginChannel; sources: SourceRef[] }
export interface Origin { channel: OriginChannel; cls: OriginClass }

/** The class of every lesson or skill the sources name, or 404 when one does not exist in this tenant. */
export async function recordClasses(c: Tx, tenantId: string, sources: SourceRef[]): Promise<OriginClass[]> {
  const out: OriginClass[] = [];
  for (const s of sources.filter(isRecordSource)) {
    const table = s.kind === 'lesson' ? 'lesson_candidates' : 'skills';
    const r = (await c.query(`select origin_class from ${table} where id=$1 and tenant_id=$2`, [s.id, tenantId])).rows[0] as { origin_class: OriginClass } | undefined;
    if (!r) throw notFound('No such record to derive from, or it is not visible to you.');
    out.push(r.origin_class);
  }
  return out;
}

export async function resolveOrigin(c: Tx, a: OriginArgs): Promise<Origin> {
  const refs = a.sources.filter(isRecordSource);
  const byAgent = a.kind === 'agent' || !!a.submittedBy;
  const channel: OriginChannel = a.channel ?? (a.kind === 'agent' ? 'agent_output' : refs.length ? 'derived' : 'human_entry');
  if (channel === 'human_entry' && (byAgent || refs.length))
    throw new ApiError('ORIGIN_NOT_ALLOWED', 403, byAgent ? 'An agent-side write can never be a human entry.' : 'A typed entry that cites other records is a derived record.');
  if (channel === 'derived') {
    if (!refs.length) throw badRequest('A derived record must name the lessons or skills it comes from.', { sources: 'Add at least one lesson or skill source.' });
    const ceiling: OriginClass = byAgent ? 'agent' : 'human';
    return { channel, cls: weakest([ceiling, ...(await recordClasses(c, a.tenantId, a.sources))]) };
  }
  return { channel, cls: classOfChannel(channel) };
}
