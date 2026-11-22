import { randomBytes } from 'node:crypto';
import type { Tx, Db } from '../db.ts';
import { audit } from '../audit.ts';
import { ApiError, notFound } from '../errors.ts';
import { emit } from '../events/hooks.ts';
import { VISIBLE_SQL } from '../missions/visibility.ts';
import { failureModeOf, FAILURE_TAXONOMY, FAILURE_TAXONOMY_VERSION, FAILURE_TAXONOMY_SOURCE, type FailureSubjectKind, type FailureSubjectInfo, type FailureTagDto, type FailureModesDto } from './taxonomy.ts';

/**
 * Improvement cycle 33: failure-mode tags (MAST). A subject is a task, a task attempt, a message of a mission thread or a mission;
 * every one resolves to its mission, which carries tenant, visibility (the u1 rule) and the DEMO flag. A subject the caller cannot
 * see, one of another tenant and one that does not exist are the same 404. Every tag starts `proposed`; a person decides once.
 */
export type Viewer = { tenantId: string; user: { id: string; role: string } };
type Q = Tx | Db;
const NUM = /^[1-9]\d{0,17}$/; // task_attempts.id and messages.id are bigserial: anything else cannot exist (404, never a cast error)

/** The mission a subject belongs to, if it exists in this tenant and (when `viewer` is given) the viewer may see that mission. `viewer: null` = internal caller (an agent), tenant only. */
export async function resolveSubject(c: Q, tenantId: string, viewer: Viewer | null, kind: FailureSubjectKind, id: string): Promise<FailureSubjectInfo> {
  const vis = viewer ? `and ${VISIBLE_SQL('$3', '$4')}` : 'and $3::boolean is not null and $4::text is not null';
  const args = (x: unknown) => [x, tenantId, viewer ? viewer.user.role === 'admin' : true, viewer ? viewer.user.id : ''];
  const base = `m.tenant_id=$2 and m.deleted_at is null ${vis}`;
  const miss = () => notFound('No such subject, or its mission is not shared with you.');
  let row: { mission_id: string; demo: boolean; failed?: boolean; retried?: boolean } | undefined;
  if (kind === 'mission') {
    row = (await c.query(`select m.id as mission_id, m.demo from missions m where m.id=$1 and ${base}`, args(id))).rows[0];
  } else if (kind === 'task') {
    row = (await c.query(`select t.mission_id, m.demo, (t.status='failed') as failed,
        (t.status='retry_ready' or (select count(*) from task_attempts a where a.task_id=t.id) > 1) as retried
      from tasks t join missions m on m.id=t.mission_id where t.id=$1 and t.tenant_id=m.tenant_id and ${base}`, args(id))).rows[0];
  } else if (kind === 'task_attempt') {
    if (!NUM.test(id)) throw miss();
    row = (await c.query(`select t.mission_id, m.demo, (a.result='failed') as failed, (a.attempt_no > 1) as retried
      from task_attempts a join tasks t on t.id=a.task_id join missions m on m.id=t.mission_id where a.id=$1::bigint and t.tenant_id=m.tenant_id and ${base}`, args(id))).rows[0];
  } else {
    if (!NUM.test(id)) throw miss();
    // only messages of a mission thread: direct channels are private to their owner and are never tagged here
    row = (await c.query(`select th.mission_id, m.demo from messages g join conversation_threads th on th.id=g.thread_id join missions m on m.id=th.mission_id
      where g.id=$1::bigint and th.scope='mission' and th.tenant_id=m.tenant_id and ${base}`, args(id))).rows[0];
  }
  if (!row) throw miss();
  return { kind, id, missionId: row.mission_id, demo: row.demo, failed: !!row.failed, retried: !!row.retried };
}

const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : null);
const SELECT = `select f.*, tu.name as tagged_name, ta.name as agent_name, du.name as decided_name
  from failure_tags f left join users tu on tu.id=f.tagged_by and f.tagged_by_kind='user'
  left join agent_instances ai on ai.id=f.tagged_by and f.tagged_by_kind='agent' left join agent_definitions ta on ta.id=ai.agent_id
  left join users du on du.id=f.decided_by`;
export function tagDto(r: any): FailureTagDto {
  const m = failureModeOf(r.mode_id);
  return {
    id: r.id, subjectKind: r.subject_kind, subjectId: r.subject_id, missionId: r.mission_id, taxonomyVersion: r.taxonomy_version, modeId: r.mode_id,
    modeName: m?.mode.name ?? r.mode_id, categoryId: m?.category.id ?? '', categoryName: m?.category.name ?? '', note: r.note,
    taggedBy: r.tagged_by, taggedByName: r.tagged_name ?? r.agent_name ?? r.tagged_by, taggedByKind: r.tagged_by_kind, status: r.status, selfConfirmed: !!r.self_confirmed, createdAt: iso(r.created_at)!,
    decidedBy: r.decided_by, decidedByName: r.decided_by ? (r.decided_name ?? r.decided_by) : null, decidedAt: iso(r.decided_at),
  };
}
export const tagById = async (c: Q, tenantId: string, id: string) => { const r = (await c.query(`${SELECT} where f.id=$1 and f.tenant_id=$2`, [id, tenantId])).rows[0]; return r ? tagDto(r) : undefined; };

export async function tagsOfSubject(c: Q, viewer: Viewer, kind: FailureSubjectKind, id: string) {
  const subject = await resolveSubject(c, viewer.tenantId, viewer, kind, id);
  const rows = (await c.query(`${SELECT} where f.tenant_id=$1 and f.subject_kind=$2 and f.subject_id=$3 order by f.created_at desc, f.id`, [viewer.tenantId, kind, id])).rows;
  return { subject, tags: rows.map(tagDto) };
}

export interface NewTag { kind: FailureSubjectKind; subjectId: string; modeId: string; note?: string | null }
/** Records one tag as `proposed`. A person is checked against visibility (`viewer`); an agent (`taggedByKind: 'agent'`, `viewer` null) only against the tenant. The mode must be in the current taxonomy version. */
export async function createTag(c: Tx, a: { tenantId: string; viewer: Viewer | null; taggedBy: string; taggedByKind: 'user' | 'agent'; correlationId?: string }, t: NewTag): Promise<FailureTagDto> {
  if (!failureModeOf(t.modeId)) throw new ApiError('VALIDATION', 400, 'Some fields are not valid.', { fieldErrors: { modeId: `Not a failure mode of ${FAILURE_TAXONOMY_VERSION}.` } });
  const s = await resolveSubject(c, a.tenantId, a.viewer, t.kind, t.subjectId);
  const id = 'FT-' + randomBytes(16).toString('hex').toUpperCase(); // 128-bit
  try {
    await c.query(`insert into failure_tags(id, tenant_id, mission_id, subject_kind, subject_id, taxonomy_version, mode_id, note, tagged_by, tagged_by_kind)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [id, a.tenantId, s.missionId, t.kind, t.subjectId, FAILURE_TAXONOMY_VERSION, t.modeId, t.note?.trim() || null, a.taggedBy, a.taggedByKind]);
  } catch (e) {
    if ((e as { code?: string }).code === '23505') throw new ApiError('FAILURE_TAG_DUPLICATE', 409, 'This failure mode is already tagged on this subject (proposed or confirmed).');
    throw e;
  }
  await audit(c, { tenantId: a.tenantId, actor: a.taggedBy, action: 'failure.tag', subject: id, result: 'ok', correlationId: a.correlationId ?? '', detail: { subjectKind: t.kind, subjectId: t.subjectId, modeId: t.modeId, taggedByKind: a.taggedByKind } });
  await emit(c, { tenantId: a.tenantId, actor: a.taggedBy, actorKind: a.taggedByKind === 'agent' ? 'agent' : 'human', correlationId: a.correlationId, type: 'failure.tagged', subject: id, subjectKind: 'failure_tag', missionId: s.missionId,
    payload: { tagId: id, subjectKind: t.kind, subjectId: t.subjectId, modeId: t.modeId, status: 'proposed', taggedByKind: a.taggedByKind } });
  return (await tagById(c, a.tenantId, id))!;
}

/** One decision by a person, once. A tag of an invisible mission is a 404; a tag already decided is a 409 (audited, and the transaction still commits). */
export async function decideTag(c: Tx, ctx: Viewer & { correlationId?: string }, id: string, decision: 'confirm' | 'reject'): Promise<{ err: ApiError } | { tag: FailureTagDto }> {
  const A = 'failure.decide';
  const refuse = async (err: ApiError) => { await audit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, action: A, subject: id, result: 'denied', correlationId: ctx.correlationId ?? '', detail: { code: err.code } }); return { err }; };
  const f = (await c.query(`select f.* from failure_tags f join missions m on m.id=f.mission_id
    where f.id=$1 and f.tenant_id=$2 and m.tenant_id=$2 and m.deleted_at is null and ${VISIBLE_SQL('$3', '$4')} for update of f`, [id, ctx.tenantId, ctx.user.role === 'admin', ctx.user.id])).rows[0];
  if (!f) return refuse(notFound('No such failure tag, or its mission is not shared with you.'));
  if (f.status !== 'proposed') return refuse(new ApiError('FAILURE_TAG_DECIDED', 409, `This tag was already ${f.status}. A decision is final; tag again to record another view.`));
  const status = decision === 'confirm' ? 'confirmed' : 'rejected';
  const self = status === 'confirmed' && f.tagged_by_kind === 'user' && f.tagged_by === ctx.user.id;
  await c.query(`update failure_tags set status=$2, decided_by=$3, decided_at=now(), self_confirmed=$4 where id=$1`, [id, status, ctx.user.id, self]);
  await audit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, action: A, subject: id, result: 'ok', correlationId: ctx.correlationId ?? '', detail: { decision: status, selfConfirmed: self, modeId: f.mode_id, subjectKind: f.subject_kind, subjectId: f.subject_id } });
  await emit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, correlationId: ctx.correlationId, type: 'failure.decided', subject: id, subjectKind: 'failure_tag', missionId: f.mission_id,
    payload: { tagId: id, subjectKind: f.subject_kind, subjectId: f.subject_id, modeId: f.mode_id, status, selfConfirmed: self } });
  return { tag: (await tagById(c, ctx.tenantId, id))! };
}

/** Confirmed tags per mode and category over a window, visible missions only (DEMO with includeDemo). The window is placed by the tag's creation time. n = confirmed tags in the window; below 1 every count is null (never 0). */
export async function failureModeCounts(c: Q, ctx: Viewer, w: { window: '7d' | '30d' | '90d'; from: Date; to: Date }, includeDemo: boolean): Promise<FailureModesDto> {
  const rows = (await c.query(`select f.mode_id, f.status, m.demo, f.self_confirmed, count(*)::int as n from failure_tags f join missions m on m.id=f.mission_id
      where f.tenant_id=$1 and m.tenant_id=$1 and m.deleted_at is null and ${VISIBLE_SQL('$2', '$3')} and ($4::boolean or not m.demo)
        and f.taxonomy_version=$5 and f.status in ('confirmed','proposed') and f.created_at > $6 and f.created_at <= $7 group by 1, 2, 3, 4`,
    [ctx.tenantId, ctx.user.role === 'admin', ctx.user.id, includeDemo, FAILURE_TAXONOMY_VERSION, w.from, w.to])).rows;
  const by = new Map<string, number>();
  let n = 0, proposed = 0, demo = 0, selfConfirmed = 0;
  for (const r of rows) { if (r.status === 'confirmed') { by.set(r.mode_id, (by.get(r.mode_id) ?? 0) + r.n); n += r.n; if (r.demo) demo += r.n; if (r.self_confirmed) selfConfirmed += r.n; } else proposed += r.n; }
  const some = n > 0;
  return {
    window: w.window, from: w.from.toISOString(), to: w.to.toISOString(), includeDemo, taxonomyVersion: FAILURE_TAXONOMY_VERSION, source: FAILURE_TAXONOMY_SOURCE, n, demo, selfConfirmed, proposed,
    categories: FAILURE_TAXONOMY.map((cat) => {
      const modes = cat.modes.map((m) => ({ id: m.id, name: m.name, count: some ? (by.get(m.id) ?? 0) : null }));
      return { id: cat.id, name: cat.name, count: some ? modes.reduce((s, m) => s + (m.count ?? 0), 0) : null, modes };
    }),
  };
}
