import type { Tx, Db } from '../db.ts';
import { ApiError, badRequest, notFound } from '../errors.ts';
import type { Ctx } from '../auth/session.ts';
import { toUiStatus, transition, type MissionStatus } from './machine.ts';
import { audit } from '../audit.ts';
import { emit } from '../events/hooks.ts';
import { readOrgView } from './staffing-org.ts';
import { VISIBLE_SQL } from './visibility.ts';
import { guessKind, deriveTitle, staffingPlan } from '../../../web/src/features/mission/staffing-plan.ts';
import type { Mission } from '../../../web/src/data/types.ts';
import { orgStaffing, type OrgView } from '../../../web/src/features/mission/staffing-org.ts';
import type { MissionFileDto } from '../../../shared/contracts/src/index.ts';

export const SELECT_MISSION = `
  select m.*, r.title, r.kind, r.priority, r.text, r.files, r.criteria, u.name as owner_name, tm.team, dg.deleg
    from missions m
    join mission_revisions r on r.mission_id = m.id and r.revision = m.current_revision
    join users u on u.id = m.owner_id
    left join lateral (select jsonb_agg(jsonb_build_object('id', i.id, 'a', i.agent_id, 'm', i.manager_instance_id) order by i.seq) as team
                         from agent_instances i where i.mission_id = m.id) tm on true
    left join lateral (select jsonb_agg(jsonb_build_object('f', d.from_instance, 't', d.to_instance) order by d.id) as deleg
                         from mission_delegations d where d.mission_id = m.id and d.edge_kind = 'delegated') dg on true`;

const PHASES = ['Plan', 'Design', 'Build', 'Verify', 'Deliver', 'Learn'];

/**
 * Display fields for a new mission (same values as the prototype's addMission). With `org` (cycle 11: every real mission
 * created through POST /missions) the executor and the planned agents' managers follow that organisation; the plan is
 * stored here, so a later org change never alters this mission's staffing.
 * `kindOverride` is set only by the route, for an administrator's `improve` mission; guessKind never returns it.
 */
export function defaultPresentation(text: string, files: MissionFileDto[], ownerName: string, now = Date.now(), org?: OrgView, kindOverride?: Mission['kind']) {
  const kind = kindOverride ?? guessKind(text, files as never);
  const fixture = staffingPlan(kind, text);
  const fromOrg = org ? orgStaffing(kind, fixture, org) : undefined;
  const { executorId, plan } = fromOrg ?? fixture;
  return {
    kind,
    title: deriveTitle(text, files as never),
    presentation: {
      progress: 0, tasksVerified: 0, tasksTotal: plan.length + 2, blocked: 0,
      agentIds: ['gm'], leadId: 'gm', executorId,
      staffing: { stage: 'reading', plan, joined: 0, log: [{ at: now, by: 'gm', text: `GM is reading the mission from ${ownerName}` }], ...(fromOrg ? { org: fromOrg.origin } : {}) },
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
/** Stage 6: the team is derived from agent_instances when the mission has any; otherwise from the presentation (as in Stage 5). */
export function derivedTeam(r: any, p: Record<string, any>) {
  const team = (r.team ?? []) as { id: string; a: string; m: string | null }[];
  if (!team.length) return { agentIds: (p.agentIds ?? []) as string[], leadId: (p.leadId ?? 'gm') as string, executorId: p.executorId as string | undefined };
  const agentIds = team.map((t) => t.a);
  const lead = (p.leadId && agentIds.includes(p.leadId) ? team.find((t) => t.a === p.leadId) : undefined) ?? team.find((t) => t.a === 'gm') ?? team.find((t) => !t.m) ?? team[0];
  // same rule as the web's executorOf: explicit executor, else a non-GM lead, else the GM's first delegated target
  const first = ((r.deleg ?? []) as { f: string; t: string }[]).find((d) => d.f === lead.id);
  const executorId: string | undefined = p.executorId ?? (lead.a !== 'gm' ? lead.a : first ? team.find((t) => t.id === first.t)?.a : undefined);
  return { agentIds, leadId: lead.a, executorId };
}

export function missionDto(r: any, now = Date.now()) {
  const p = (r.presentation ?? {}) as Record<string, any>;
  const team = derivedTeam(r, p);
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
    agentIds: team.agentIds, leadId: team.leadId, ...(team.executorId ? { executorId: team.executorId } : {}), phases: p.phases ?? [],
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

export interface CreateMissionInput {
  tenantId: string; owner: { id: string; name: string }; text: string; files: MissionFileDto[]; shared: boolean;
  /** an administrator's `improve` mission (the caller checks the role) */
  improve?: boolean;
  /** who did it, for the audit row and the event: the owner through the API; the evolve CLI names itself */
  actor: string; actorKind?: 'human' | 'system'; correlationId: string;
  /** extra top-level presentation fields (the evolve CLI's `filedBy`) */
  presentation?: Record<string, unknown>;
}

/**
 * Create a mission in the caller's transaction, exactly as POST /missions does (the route and `cli/evolve-missions.ts file` share it):
 * draft → submit → plan, revision 1 created by the owner, audit `mission.create`, event `mission.created`. Returns the id. The caller
 * starts the staffing (the route through onMissionChanged; the CLI runs the steps itself).
 */
export async function createMission(c: Tx, o: CreateMissionInput): Promise<string> {
  const id = await nextMissionId(c);
  const d = defaultPresentation(o.text, o.files, o.owner.name, Date.now(), await readOrgView(c, o.tenantId), o.improve ? 'improve' : undefined); // cycle 11: staffed by the active org
  // draft → submit → plan in one transaction (spec §10.6; the GM starts staffing at once)
  let status: MissionStatus = 'draft';
  status = transition(status, 'submit');
  status = transition(status, 'plan');
  await c.query(`insert into missions(id, tenant_id, owner_id, shared, status, presentation) values ($1,$2,$3,$4,$5,$6)`,
    [id, o.tenantId, o.owner.id, o.shared, status, JSON.stringify({ ...d.presentation, ...(o.presentation ?? {}) })]);
  await c.query(`insert into mission_revisions(mission_id, revision, title, kind, priority, text, files, criteria, created_by) values ($1,1,$2,$3,'normal',$4,$5,'[]',$6)`,
    [id, d.title, d.kind, o.text.trim(), JSON.stringify(o.files), o.owner.id]);
  await audit(c, { tenantId: o.tenantId, actor: o.actor, action: 'mission.create', subject: id, result: 'ok', correlationId: o.correlationId, detail: { shared: o.shared, files: o.files.length } });
  await emit(c, { tenantId: o.tenantId, actor: o.actor, ...(o.actorKind ? { actorKind: o.actorKind } : {}), correlationId: o.correlationId, type: 'mission.created', subject: id, missionId: id, payload: { status } });
  return id;
}

export function conflict() { return new ApiError('MISSION_REVISION_CONFLICT', 409, 'Someone changed this mission meanwhile. Reload it and apply your change again.', { retryable: false }); }
