import type { Tx, Db } from '../db.ts';
import { ApiError, badRequest, notFound } from '../errors.ts';
import type { Ctx } from '../auth/session.ts';
import { toUiStatus, type MissionStatus } from './machine.ts';
import { VISIBLE_SQL } from './visibility.ts';
import { guessKind, deriveTitle, staffingPlan } from '../../../web/src/features/mission/staffing-plan.ts';
import type { MissionFileDto } from '../../../shared/contracts/src/index.ts';

export const SELECT_MISSION = `
  select m.*, r.title, r.kind, r.priority, r.text, r.files, r.criteria, u.name as owner_name
    from missions m
    join mission_revisions r on r.mission_id = m.id and r.revision = m.current_revision
    join users u on u.id = m.owner_id`;

const PHASES = ['Plan', 'Design', 'Build', 'Verify', 'Deliver', 'Learn'];

/** DEMO-only display fields for a new mission (same values as the prototype's addMission). */
export function defaultPresentation(text: string, files: MissionFileDto[], ownerName: string, now = Date.now()) {
  const kind = guessKind(text, files as never);
  const { executorId, plan } = staffingPlan(kind, text);
  return {
    kind,
    title: deriveTitle(text, files as never),
    presentation: {
      progress: 0, tasksVerified: 0, tasksTotal: plan.length + 2, blocked: 0,
      agentIds: ['gm'], leadId: 'gm', executorId,
      staffing: { stage: 'reading', plan, joined: 0, log: [{ at: now, by: 'gm', text: `GM is reading the mission from ${ownerName}` }] },
      summary: 'The General Manager is reading the mission and will appoint a general executor.', summaryAt: now,
      lastEvent: `Added by ${ownerName}`, lastEventAt: now,
      elapsedH: 0, dueInDays: 7, version: 'v0.1.0',
      phases: PHASES.map((label, i) => ({ key: label.toLowerCase(), label, date: '—', state: i === 0 ? 'active' : 'next' })),
      pendingApprovals: 0, unread: 0,
    } as Record<string, unknown>,
  };
}

const minsAgo = (at: unknown, now: number) => (typeof at === 'number' ? Math.max(0, Math.round((now - at) / 60000)) : undefined);

/** The web's Mission shape, built from the row, its current revision and the presentation fields. */
export function missionDto(r: any, now = Date.now()) {
  const p = (r.presentation ?? {}) as Record<string, any>;
  const { preArchive: _pa, summaryAt, lastEventAt, ...shown } = p;
  void _pa;
  const created = new Date(r.created_at).getTime();
  return {
    ...shown,
    id: r.id, title: r.title, kind: r.kind, priority: r.priority,
    status: toUiStatus(r.status as MissionStatus), serverStatus: r.status,
    owner: r.owner_name, ownerId: r.owner_id, shared: r.shared,
    content: { text: r.text, files: r.files ?? [] },
    objective: p.objective ?? (r.text?.trim() || 'See the attached files.'),
    criteria: r.criteria ?? [],
    revision: r.current_revision, rowVersion: r.content_version ?? r.row_version, syncVersion: r.row_version, demo: r.demo,
    summaryAgoMin: minsAgo(summaryAt, now) ?? p.summaryAgoMin ?? 0,
    lastEventAgoMin: minsAgo(lastEventAt, now) ?? p.lastEventAgoMin ?? 0,
    createdAgoDays: r.demo && typeof p.createdAgoDays === 'number' ? p.createdAgoDays : Math.floor((now - created) / 86_400_000),
    agentIds: p.agentIds ?? [], leadId: p.leadId ?? 'gm', phases: p.phases ?? [],
    progress: p.progress ?? 0, tasksVerified: p.tasksVerified ?? 0, tasksTotal: p.tasksTotal ?? 0, blocked: p.blocked ?? 0,
    summary: p.summary ?? '', lastEvent: p.lastEvent ?? '', elapsedH: p.elapsedH ?? 0, dueInDays: p.dueInDays ?? 7,
    version: p.version ?? 'v0.1.0', pendingApprovals: p.pendingApprovals ?? 0, unread: p.unread ?? 0,
    archivedAt: r.archived_at ? new Date(r.archived_at).getTime() : undefined,
    updatedAt: new Date(r.updated_at).getTime(),
  };
}
export type MissionDto = ReturnType<typeof missionDto>;

export async function listVisible(c: Tx | Db, ctx: Pick<Ctx, 'tenantId' | 'user'>) {
  const rows = (await c.query(`${SELECT_MISSION} where m.tenant_id=$1 and m.deleted_at is null and ${VISIBLE_SQL('$2', '$3')} order by m.created_at desc, m.id desc`,
    [ctx.tenantId, ctx.user.role === 'admin', ctx.user.id])).rows;
  return rows.map((r) => missionDto(r));
}

/** A visible mission row (404 when it doesn't exist, is deleted, is in another tenant or isn't visible). */
export async function getVisibleRow(c: Tx | Db, ctx: Pick<Ctx, 'tenantId' | 'user'>, id: string, lock = false) {
  if (!/^M-\d{1,9}$/.test(id)) throw notFound('No such mission.');
  if (lock) await c.query('select 1 from missions where id=$1 and tenant_id=$2 for update', [id, ctx.tenantId]);
  const r = (await c.query(`${SELECT_MISSION} where m.id=$1 and m.tenant_id=$2 and m.deleted_at is null and ${VISIBLE_SQL('$3', '$4')}`,
    [id, ctx.tenantId, ctx.user.role === 'admin', ctx.user.id])).rows[0];
  if (!r) throw notFound('No such mission, or it is not shared with you.');
  return r;
}

export async function loadRow(c: Tx | Db, id: string) {
  return (await c.query(`${SELECT_MISSION} where m.id=$1`, [id])).rows[0];
}

/** Uploaded files the creator may attach (their own uploads; admins any in the tenant). */
export async function filesFor(c: Tx, ctx: Ctx, ids: string[]): Promise<MissionFileDto[]> {
  if (ids.length > 10) throw badRequest('Attach at most 10 files.');
  if (!ids.length) return [];
  const rows = (await c.query('select * from uploads where tenant_id=$1 and id = any($2::text[])', [ctx.tenantId, ids])).rows;
  return ids.map((id) => {
    const f = rows.find((r) => r.id === id);
    if (!f || (f.owner_id !== ctx.user.id && ctx.user.role !== 'admin')) throw badRequest('One of the files is unknown. Upload it again.', { files: id });
    return { id: f.id, name: f.name, kind: f.kind, size: Number(f.size), mime: f.mime, url: `/api/v1/uploads/${f.id}`, ...(f.excerpt ? { excerpt: f.excerpt } : {}) };
  });
}

export async function nextMissionId(c: Tx) {
  return 'M-' + (await c.query(`select nextval('mission_seq') as n`)).rows[0].n;
}

export function conflict() { return new ApiError('MISSION_REVISION_CONFLICT', 409, 'Someone changed this mission meanwhile. Reload it and apply your change again.', { retryable: false }); }
