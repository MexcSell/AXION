import type { Tx, Db } from '../db.ts';
import { emit } from '../events/hooks.ts';
import { notFound } from '../errors.ts';
import { VISIBLE_SQL } from '../missions/visibility.ts';
import { attachSimBrief } from '../delegation/service.ts';

export const instanceId = (missionId: string, agentId: string) => `${missionId}:${agentId}`;

/** Task status stored in the database ↔ the UI's TaskState. */
export const TASK_TO_UI: Record<string, string> = {
  created: 'queued', ready: 'ready', running: 'running', waiting_agent: 'waiting-agent', waiting_user: 'waiting-user',
  verifying: 'verifying', passed: 'passed', failed: 'failed', retry_ready: 'queued', canceled: 'canceled',
};
export const UI_TO_TASK: Record<string, string> = {
  queued: 'created', ready: 'ready', running: 'running', 'waiting-agent': 'waiting_agent', 'waiting-user': 'waiting_user',
  verifying: 'verifying', passed: 'passed', failed: 'failed', canceled: 'canceled',
};

export interface NewInstance {
  tenantId: string; missionId: string; agentId: string; managerAgentId?: string; state?: string; task?: string; progress?: number;
  taskCount?: number; pending?: number; simulated: boolean; runId?: number | null;
}

/** Real-mission instances do not execute yet: they are idle with this label (demo ones keep their fixture states). */
export const IDLE_TASK = 'Staffed, waits for execution';

/** Insert one instance pinned to the agent's active version. Returns false when it already exists or the agent is unknown. */
export async function insertInstance(c: Tx, i: NewInstance): Promise<boolean> {
  const id = instanceId(i.missionId, i.agentId);
  const r = await c.query(
    `insert into agent_instances(id, tenant_id, mission_id, run_id, agent_id, agent_version_id, manager_instance_id, state, task_label, progress, task_count, pending, simulated)
     select $1,$2,$3,$4,d.id,d.active_version_id,$5,$6,$7,$8,$9,$10,$11 from agent_definitions d
      where d.id=$12 and d.tenant_id=$2 and d.active_version_id is not null
     on conflict (id) do nothing`,
    [id, i.tenantId, i.missionId, i.runId ?? null, i.managerAgentId ? instanceId(i.missionId, i.managerAgentId) : null, i.state ?? (i.simulated ? 'working' : 'idle'), i.task ?? (i.simulated ? '' : IDLE_TASK),
      i.progress ?? 0, i.taskCount ?? 0, i.pending ?? 0, i.simulated, i.agentId]);
  return !!r.rowCount;
}

export async function insertDelegation(c: Tx, d: { missionId: string; from: string; to: string; kind: 'delegated' | 'consults' | 'verifies' | 'mentors'; taskId?: string | null; simulated: boolean }) {
  await c.query(`insert into mission_delegations(mission_id, from_instance, to_instance, edge_kind, task_id, simulated) values ($1,$2,$3,$4,$5,$6)`,
    [d.missionId, d.from, d.to, d.kind, d.taskId ?? null, d.simulated]);
}

/** A person-less system step: an agent joins a mission under its manager (instance + delegated row + events), in the caller's transaction. */
export async function joinMission(c: Tx, i: NewInstance & { managerAgentId: string }) {
  if (!(await insertInstance(c, i))) return false;
  const to = instanceId(i.missionId, i.agentId), from = instanceId(i.missionId, i.managerAgentId);
  await insertDelegation(c, { missionId: i.missionId, from, to, kind: 'delegated', simulated: i.simulated });
  await attachSimBrief(c, { tenantId: i.tenantId, missionId: i.missionId, fromInstanceId: from, toInstanceId: to, goal: i.task ?? '', simulated: i.simulated }); // c42: every new delegation carries a brief
  await emit(c, { tenantId: i.tenantId, type: 'instance.created', subjectKind: 'instance', subject: to, missionId: i.missionId, actor: i.managerAgentId, actorKind: 'agent',
    payload: { instanceId: to, agentId: i.agentId, managerInstanceId: from, simulated: i.simulated } });
  await emit(c, { tenantId: i.tenantId, type: 'task.delegated', subjectKind: 'instance', subject: to, missionId: i.missionId, actor: i.managerAgentId, actorKind: 'agent',
    payload: { fromInstance: from, toInstance: to, kind: 'delegated', simulated: i.simulated } });
  return true;
}

export async function setInstanceState(c: Tx, id: string, state: string, opts: { task?: string; progress?: number } = {}) {
  const r = (await c.query(`update agent_instances set state=$2, task_label=coalesce($3, task_label), progress=coalesce($4, progress),
      ended_at = case when $2='done' then now() else ended_at end
    where id=$1 and state is distinct from $2 returning tenant_id, mission_id, state`, [id, state, opts.task ?? null, opts.progress ?? null])).rows[0];
  if (!r) return false;
  await emit(c, { tenantId: r.tenant_id, type: 'instance.stateChanged', subjectKind: 'instance', subject: id, missionId: r.mission_id, payload: { instanceId: id, state } });
  return true;
}

const ISO = (d: Date | null) => (d ? new Date(d).toISOString() : null);
export const instanceDto = (r: any) => ({
  id: r.id, missionId: r.mission_id, agentId: r.agent_id, versionId: r.agent_version_id, versionLabel: r.version_label,
  managerInstanceId: r.manager_instance_id, state: r.state, task: r.task_label, progress: r.progress, simulated: r.simulated,
  createdAt: ISO(r.created_at), endedAt: ISO(r.ended_at),
});
const SELECT_INSTANCE = `select i.*, v.label as version_label from agent_instances i join agent_versions v on v.id = i.agent_version_id`;

export async function hierarchy(c: Tx | Db, missionId: string) {
  const inst = (await c.query(`${SELECT_INSTANCE} where i.mission_id=$1 order by i.seq`, [missionId])).rows;
  const dels = (await c.query(`select from_instance, to_instance, edge_kind from mission_delegations where mission_id=$1 order by id`, [missionId])).rows;
  const owned = new Map((await c.query(`select owner_instance_id id, count(*)::int n from tasks where mission_id=$1 and owner_instance_id is not null group by 1`, [missionId])).rows.map((r) => [r.id, r.n]));
  const nodes = inst.map((r) => ({
    instanceId: r.id, agentId: r.agent_id, ...(r.manager_instance_id ? { parent: r.manager_instance_id } : {}), task: r.task_label, state: r.state,
    tasks: Math.max(r.task_count, owned.get(r.id) ?? 0), pending: r.pending, progress: r.progress, versionLabel: r.version_label,
  }));
  const edges: { from: string; to: string; kind: string }[] = [];
  for (const d of dels.filter((x) => x.edge_kind === 'delegated')) {
    edges.push({ from: d.from_instance, to: d.to_instance, kind: 'delegated' });
    edges.push({ from: d.to_instance, to: d.from_instance, kind: 'reports' }); // implied, not stored
  }
  for (const d of dels.filter((x) => x.edge_kind !== 'delegated')) edges.push({ from: d.from_instance, to: d.to_instance, kind: d.edge_kind });
  const seen = new Set<string>();
  return { nodes, edges: edges.filter((e) => { const k = `${e.from}|${e.to}|${e.kind}`; if (seen.has(k)) return false; seen.add(k); return true; }) };
}

const SELECT_TASK = `select t.*, coalesce(i.agent_id, t.owner_agent) as owner,
      coalesce((select jsonb_agg(td.depends_on order by td.depends_on) from task_dependencies td where td.task_id=t.id), '[]'::jsonb) as deps
    from tasks t left join agent_instances i on i.id = t.owner_instance_id`;
export const taskDto = (t: any) => ({ id: t.id, title: t.title, owner: t.owner, deps: t.deps, state: TASK_TO_UI[t.status] ?? 'queued', weight: t.weight, evidence: t.evidence, col: t.col, row: t.row });

export async function missionTasks(c: Tx | Db, missionId: string) {
  return (await c.query(`${SELECT_TASK} where t.mission_id=$1 order by t.col, t.row, t.id`, [missionId])).rows.map(taskDto);
}
export async function taskById(c: Tx | Db, id: string) {
  const r = (await c.query(`${SELECT_TASK} where t.id=$1`, [id])).rows[0];
  return r ? taskDto(r) : undefined;
}

export const INSTANCE_PAGE = 500, INSTANCE_MAX = 2000;
/** One page of visible instances, newest first (by seq). `before` is the `nextBefore` of the previous page; `truncated` says more rows exist. */
export async function listInstancesPage(c: Tx | Db, ctx: { tenantId: string; user: { id: string; role: string } }, agentId?: string, opts: { limit?: number; before?: number } = {}) {
  const limit = Math.min(opts.limit ?? INSTANCE_PAGE, INSTANCE_MAX);
  const rows = (await c.query(`select i.*, v.label as version_label from agent_instances i join agent_versions v on v.id=i.agent_version_id join missions m on m.id=i.mission_id
      where m.tenant_id=$1 and m.deleted_at is null and ${VISIBLE_SQL('$2', '$3')} and ($4::text is null or i.agent_id=$4) and ($5::bigint is null or i.seq < $5)
      order by i.seq desc limit $6`, [ctx.tenantId, ctx.user.role === 'admin', ctx.user.id, agentId ?? null, opts.before ?? null, limit + 1])).rows;
  const truncated = rows.length > limit;
  const page = rows.slice(0, limit);
  return { instances: page.map(instanceDto), truncated, ...(truncated ? { nextBefore: String(page[page.length - 1].seq) } : {}) };
}
export async function listInstances(c: Tx | Db, ctx: { tenantId: string; user: { id: string; role: string } }, agentId?: string) {
  return (await listInstancesPage(c, ctx, agentId)).instances;
}

export async function getInstance(c: Tx | Db, ctx: { tenantId: string; user: { id: string; role: string } }, id: string) {
  const r = (await c.query(`select i.*, v.label as version_label from agent_instances i join agent_versions v on v.id=i.agent_version_id join missions m on m.id=i.mission_id
      where i.id=$1 and m.tenant_id=$2 and m.deleted_at is null and ${VISIBLE_SQL('$3', '$4')}`, [id, ctx.tenantId, ctx.user.role === 'admin', ctx.user.id])).rows[0];
  if (!r) throw notFound('No such agent instance, or its mission is not shared with you.');
  return instanceDto(r);
}
