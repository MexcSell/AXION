import type { Tx, Db } from '../db.ts';
import { VISIBLE_SQL } from '../missions/visibility.ts';
import { GM } from '../organization/validate.ts';
import { DEPT_MIN_SAMPLE, type DepartmentFacts, type DepartmentsDto, type ScorecardWindow } from '../../../shared/contracts/src/index.ts';

/**
 * Improvement cycle 6: department facts, counted only from recorded rows (spec §16.1: company and department levels with
 * sample sizes and evidence; spec §11 invariant 9). Pure: the loader below reads the rows of the missions the caller can
 * see and passes them in. No ratio is computed here or anywhere: counts with n and a window only.
 *
 * Rules (also in the `?` help and the cycle report):
 * - Members: active agents whose catalog department (agent_definitions.dept) is this one. Tasks, instances and org lines
 *   belong to the department of their agent (retired agents included, so history keeps its department).
 * - Head: in the GM's own department the GM; elsewhere the active member reporting to the GM in the latest org revision
 *   (max seq). With several, the one with the most members of the same department under it, then the lowest id.
 * - Staffed: a member with a live (not ended) instance on a mission that is planning, running, verifying or waiting for
 *   approval. Simulated instances and DEMO missions only with includeDemo (the same rule as the Overview "Staffed Agents").
 * - Open tasks (now): running = running + verifying, waiting = waiting_agent + waiting_user, failed = failed, on missions
 *   that are not completed, canceled or archived. Queued (created, ready, retry_ready) and finished tasks are not open.
 * - Outcomes (window, inclusive): tasks that are passed or failed now and finished inside the window (cycle 3's finish
 *   time). n = passed + failed; retried = those with more than one recorded attempt (a subset). Canceled is not an outcome.
 *   Simulated tasks and DEMO missions only with includeDemo.
 * - Last org change: the newest revision that added, removed or re-pointed a reporting line whose subordinate is in the
 *   department (each revision compared with the one before it).
 */
const ACTIVE_MISSION = new Set(['planning', 'running', 'verifying', 'waiting_approval']);
const CLOSED_MISSION = new Set(['completed', 'canceled', 'archived']);
const OPEN_BUCKET: Record<string, keyof DepartmentFacts['openTasks']> = {
  running: 'running', verifying: 'running', waiting_agent: 'waiting', waiting_user: 'waiting', failed: 'failed',
};

export interface DeptRows {
  agents: { id: string; dept: string; active: boolean }[];
  /** reporting lines of the latest org revision */
  edges: { supervisorId: string; subordinateId: string }[];
  /** instances on missions the caller can see; simulated = a simulated instance or a DEMO mission */
  instances: { agentId: string; missionId: string; missionStatus: string; ended: boolean; simulated: boolean }[];
  /** tasks of missions the caller can see; owner = the owner instance's agent, else owner_agent; simulated = simulated task or DEMO mission */
  tasks: { id: string; owner: string | null; status: string; missionStatus: string; attempts: number; finishedAt: Date | null; simulated: boolean }[];
  /** per revision, each subordinate whose reporting line differs from the revision before */
  orgChanges: { seq: number; at: Date; subordinateId: string }[];
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const DAYS: Record<ScorecardWindow, string> = { '7d': '7 days', '30d': '30 days', '90d': '90 days' };

export function departmentFacts(rows: DeptRows, opt: { window: ScorecardWindow; from: Date; to: Date; includeDemo: boolean }): DepartmentsDto {
  const from = opt.from.getTime(), to = opt.to.getTime();
  const deptOf = new Map(rows.agents.map((a) => [a.id, a.dept]));
  const active = new Set(rows.agents.filter((a) => a.active).map((a) => a.id));
  const gmDept = active.has(GM) ? deptOf.get(GM) : undefined;
  const names = [...new Set(rows.agents.filter((a) => a.active).map((a) => a.dept))].sort(cmp);
  const counted = (simulated: boolean) => opt.includeDemo || !simulated;

  // reporting lines of the latest revision: children per supervisor (for the head tie-break)
  const kids = new Map<string, string[]>();
  const up = new Map<string, string>();
  for (const e of rows.edges) { kids.set(e.supervisorId, [...(kids.get(e.supervisorId) ?? []), e.subordinateId]); up.set(e.subordinateId, e.supervisorId); }
  /** members of `dept` anywhere under `id` (seen-set: a malformed chart can't loop) */
  const under = (id: string, dept: string) => {
    let n = 0;
    const seen = new Set([id]);
    const stack = [...(kids.get(id) ?? [])];
    while (stack.length) {
      const x = stack.pop()!;
      if (seen.has(x)) continue;
      seen.add(x);
      if (active.has(x) && deptOf.get(x) === dept) n++;
      stack.push(...(kids.get(x) ?? []));
    }
    return n;
  };

  const out = new Map<string, DepartmentFacts & { staffed: Set<string>; missions: Set<string> }>();
  for (const name of names) {
    const memberIds = rows.agents.filter((a) => a.active && a.dept === name).map((a) => a.id);
    const gmReports = name === gmDept ? [] : memberIds.filter((id) => id !== GM && up.get(id) === GM)
      .map((id) => ({ id, n: under(id, name) })).sort((a, b) => b.n - a.n || cmp(a.id, b.id)).map((x) => x.id);
    out.set(name, {
      name, headAgentId: name === gmDept ? GM : (gmReports[0] ?? null), gmReports, memberIds,
      staffedAgents: 0, activeMissions: 0, openTasks: { running: 0, waiting: 0, failed: 0 }, outcomes: { passed: 0, failed: 0, retried: 0, n: 0 },
      lastOrgChange: null, evidence: '', staffed: new Set(), missions: new Set(),
    });
  }
  const of = (agentId: string | null) => (agentId ? out.get(deptOf.get(agentId) ?? '\u0000') : undefined);

  for (const i of rows.instances) {
    const d = of(i.agentId);
    if (!d || i.ended || !ACTIVE_MISSION.has(i.missionStatus) || !counted(i.simulated)) continue;
    d.staffed.add(i.agentId);
    d.missions.add(i.missionId);
  }
  for (const t of rows.tasks) {
    const d = of(t.owner);
    if (!d || !counted(t.simulated)) continue;
    const bucket = OPEN_BUCKET[t.status];
    if (bucket && !CLOSED_MISSION.has(t.missionStatus)) d.openTasks[bucket]++;
    if ((t.status === 'passed' || t.status === 'failed') && t.finishedAt) {
      const at = t.finishedAt.getTime();
      if (at < from || at > to) continue;
      d.outcomes[t.status]++;
      d.outcomes.n++;
      if (t.attempts > 1) d.outcomes.retried++;
    }
  }
  for (const c of rows.orgChanges) {
    const d = of(c.subordinateId);
    if (d && (!d.lastOrgChange || c.seq > d.lastOrgChange.revision)) d.lastOrgChange = { revision: c.seq, at: c.at.toISOString() };
  }

  const departments: DepartmentFacts[] = [...out.values()].map(({ staffed, missions, ...d }) => {
    const o = d.outcomes;
    const head = d.name === gmDept ? 'the GM heads its own department'
      : d.gmReports.length === 0 ? 'no member reports to the GM'
        : d.gmReports.length > 1 ? `${d.gmReports.length} members report to the GM (head: the one with the most of the department under it)` : null;
    const parts = [
      plural(d.memberIds.length, 'member'),
      ...(head ? [head] : []),
      `${staffed.size} staffed on ${plural(missions.size, 'active mission')}`,
      `open tasks: ${d.openTasks.running} running, ${d.openTasks.waiting} waiting, ${d.openTasks.failed} failed`,
      `${plural(o.n, 'finished task')} in ${DAYS[opt.window]}${o.n < DEPT_MIN_SAMPLE ? ` (too few to rate, ${DEPT_MIN_SAMPLE} needed)` : ''}: ${o.passed} passed, ${o.failed} failed, ${o.retried} retried`,
      'from missions you can see',
      ...(opt.includeDemo ? ['DEMO included'] : []),
    ];
    return { ...d, staffedAgents: staffed.size, activeMissions: missions.size, evidence: parts.join(' · ') };
  });
  return { window: opt.window, from: opt.from.toISOString(), to: opt.to.toISOString(), includeDemo: opt.includeDemo, departments };
}

/**
 * The rows for one caller, in five queries whatever the number of departments (no N+1). Every mission-scoped query joins
 * `missions m` and repeats the tenant, not-deleted, VISIBLE_SQL and DEMO conditions; catalog and org queries are tenant-only
 * (org_edges has no tenant column: it is reached through org_revisions).
 */
export async function loadDeptRows(c: Tx | Db, viewer: { tenantId: string; admin: boolean; userId: string }, includeDemo: boolean): Promise<DeptRows> {
  const V = [viewer.tenantId, viewer.admin, viewer.userId, includeDemo];
  const MISSIONS = `m.tenant_id = $1 and m.deleted_at is null and ${VISIBLE_SQL('$2', '$3')} and ($4::boolean or not m.demo)`;
  const [agents, edges, instances, tasks, changes] = await Promise.all([
    c.query(`select id, dept, status from agent_definitions where tenant_id = $1`, [viewer.tenantId]),
    c.query(`select e.supervisor_id, e.subordinate_id from org_edges e
              where e.revision_id = (select id from org_revisions where tenant_id = $1 order by seq desc limit 1)`, [viewer.tenantId]),
    c.query(`select i.agent_id, i.mission_id, m.status, (i.ended_at is not null) as ended, (i.simulated or m.demo) as simulated
               from agent_instances i join missions m on m.id = i.mission_id
              where i.tenant_id = $1 and ${MISSIONS} and i.ended_at is null and m.status in ('planning','running','verifying','waiting_approval')`, V),
    c.query(`with vis as (
               select t.id, t.status, m.status as mission_status, (t.simulated or m.demo) as simulated, t.created_at, coalesce(i.agent_id, t.owner_agent) as owner
                 from tasks t join missions m on m.id = t.mission_id left join agent_instances i on i.id = t.owner_instance_id
                where t.tenant_id = $1 and ${MISSIONS}
                  and t.status in ('running','verifying','waiting_agent','waiting_user','failed','passed')
             ),
             ev as (
               select e.subject_id as task_id, e.payload->>'to' as status, max(e.occurred_at) as at from events e
                where e.tenant_id = $1 and e.type = 'task.stateChanged' and e.subject_id in (select id from vis where status in ('passed','failed')) group by 1, 2
             ),
             att as (
               select a.task_id, count(*)::int as n, max(greatest(a.started_at, a.finished_at)) as at from task_attempts a
                where a.task_id in (select id from vis) group by 1
             )
             select v.id, v.owner, v.status, v.mission_status, v.simulated, coalesce(att.n, 0) as attempts,
                    case when v.status in ('passed','failed') then coalesce(ev.at, greatest(att.at, v.created_at)) end as finished_at
               from vis v left join ev on ev.task_id = v.id and ev.status = v.status left join att on att.task_id = v.id`, V),
    // each revision against the one before it (by seq): lines added, removed or re-pointed, keyed by subordinate
    c.query(`with r as (
               select id, seq, active_from, lag(id) over (order by seq) as prev from org_revisions where tenant_id = $1
             )
             select r.seq, r.active_from, x.subordinate_id from r cross join lateral (
               (select subordinate_id, supervisor_id, edge_type from org_edges where revision_id = r.id
                except select subordinate_id, supervisor_id, edge_type from org_edges where revision_id = r.prev)
               union
               (select subordinate_id, supervisor_id, edge_type from org_edges where revision_id = r.prev
                except select subordinate_id, supervisor_id, edge_type from org_edges where revision_id = r.id)
             ) x`, [viewer.tenantId]),
  ]).then((rs) => rs.map((r) => r.rows));
  return {
    agents: agents.map((a) => ({ id: a.id, dept: a.dept, active: a.status === 'active' })),
    edges: edges.map((e) => ({ supervisorId: e.supervisor_id, subordinateId: e.subordinate_id })),
    instances: instances.map((i) => ({ agentId: i.agent_id, missionId: i.mission_id, missionStatus: i.status, ended: i.ended, simulated: i.simulated })),
    tasks: tasks.map((t) => ({ id: t.id, owner: t.owner, status: t.status, missionStatus: t.mission_status, attempts: t.attempts, finishedAt: t.finished_at ? new Date(t.finished_at) : null, simulated: t.simulated })),
    orgChanges: changes.map((x) => ({ seq: x.seq, at: new Date(x.active_from), subordinateId: x.subordinate_id })),
  };
}
