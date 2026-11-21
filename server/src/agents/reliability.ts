import type { Tx, Db } from '../db.ts';
import type { AgentDto } from '../../../shared/contracts/src/index.ts';
import type { AgentBase } from './service.ts';
import { MIN_EVIDENCE, type AgentReliability } from '../../../shared/contracts/src/index.ts';
import { VISIBLE_SQL } from '../missions/visibility.ts';

/**
 * Improvement cycle 3: an agent's reliability, measured from recorded task history only (spec §11 invariant 9: every
 * metric carries its sample size and window; an unknown value stays unknown). Pattern: subnet-scout organization.py
 * (reliability = delegated work done without escalation, MIN_EVIDENCE = 5).
 *
 * Rules (also in the `?` help and the cycle report):
 * - Evidence is a task that is `passed` or `failed` now and whose finish time is in the window [to − 90 days, to].
 *   Open tasks are not evidence yet; `canceled` (a human stop) counts neither for nor against anyone.
 * - It is charged to its final owner agent, and once (as unreliable) to every agent it was reassigned away from — also
 *   when it later passed elsewhere. An agent it was taken from and later given back to is charged only that once.
 * - Reliable = passed, at most one recorded attempt (a retry always records attempt 2), never taken from this agent.
 *   Unreliable = failed, passed after a retry, or reassigned away.
 * - value = reliable ÷ (reliable + unreliable) as a whole percentage, null while n < MIN_EVIDENCE.
 * - Simulated (DEMO) tasks are left out unless includeSimulated.
 */
export const WINDOW_DAYS = 90;
const DAY = 86_400_000;
const FINISHED = new Set(['passed', 'failed']);

export interface ReliabilityRow {
  taskId: string;
  status: string;
  /** the final owner's agent id (null: nobody owns it) */
  owner: string | null;
  /** recorded task_attempts rows */
  attempts: number;
  simulated: boolean;
  /** the latest recorded move into the current status; without one, a lower bound (latest attempt time, else creation) */
  finishedAt: Date;
  /** agent ids the task was reassigned away from, in order (may repeat) */
  takenFrom: string[];
}

export function reliabilityWindow(now = new Date()) {
  return { from: new Date(now.getTime() - WINDOW_DAYS * DAY), to: now };
}

const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

interface Tally { reliable: number; retried: number; failed: number; reassigned: number }

/** Classify every row once; returns the reliability of any agent id (agents without evidence get an empty one). */
export function reliabilityOf(rows: ReliabilityRow[], opt: { from: Date; to: Date; includeSimulated: boolean }): (agentId: string) => AgentReliability {
  const from = opt.from.getTime(), to = opt.to.getTime();
  const by = new Map<string, Tally>();
  const tally = (a: string) => { let x = by.get(a); if (!x) by.set(a, (x = { reliable: 0, retried: 0, failed: 0, reassigned: 0 })); return x; };
  for (const r of rows) {
    if (!FINISHED.has(r.status) || (r.simulated && !opt.includeSimulated)) continue;
    const t = r.finishedAt.getTime();
    if (!(t >= from && t <= to)) continue;
    const taken = new Set(r.takenFrom.filter(Boolean));
    for (const a of taken) tally(a).reassigned++;
    if (!r.owner || taken.has(r.owner)) continue;
    const x = tally(r.owner);
    if (r.status === 'failed') x.failed++;
    else if (r.attempts > 1) x.retried++;
    else x.reliable++;
  }
  return (agentId) => {
    const x = by.get(agentId) ?? { reliable: 0, retried: 0, failed: 0, reassigned: 0 };
    const n = x.reliable + x.retried + x.failed + x.reassigned;
    const parts = [
      n ? `${x.reliable} of ${plural(n, 'finished task')} passed first time` : 'no finished tasks',
      ...(x.retried ? [`${x.retried} retried`] : []),
      ...(x.failed ? [`${x.failed} failed`] : []),
      ...(x.reassigned ? [`${x.reassigned} reassigned away`] : []),
      `last ${WINDOW_DAYS} days`, 'from missions you can see',
      ...(opt.includeSimulated ? ['DEMO tasks included'] : []),
    ];
    const enough = n >= MIN_EVIDENCE;
    return {
      value: enough ? Math.round((x.reliable / n) * 100) : null,
      n, window: '90d',
      evidence: (enough ? '' : `not enough evidence (${n} of ${MIN_EVIDENCE}) · `) + parts.join(' · '),
      includesSimulated: opt.includeSimulated,
    };
  };
}

/**
 * One query for all agents: every finished task of the missions the caller can see (tenant, not deleted, VISIBLE_SQL),
 * with its final owner agent, attempt count, finish time and the agents it was reassigned away from. Reassignments are
 * read from the `task.reassign` audit rows (the delegation row names the mission lead, not the previous owner).
 */
export async function loadReliabilityRows(c: Tx | Db, viewer: { tenantId: string; admin: boolean; userId: string }, includeSimulated: boolean): Promise<ReliabilityRow[]> {
  const rows = (await c.query(
    `with vis as (
       select t.id, t.status, (t.simulated or m.demo) as simulated, t.created_at, coalesce(i.agent_id, t.owner_agent) as owner
         from tasks t join missions m on m.id = t.mission_id left join agent_instances i on i.id = t.owner_instance_id
        where m.tenant_id = $1 and m.deleted_at is null and ${VISIBLE_SQL('$2', '$3')}
          and t.status in ('passed','failed') and ($4::boolean or not (t.simulated or m.demo))
     ),
     ev as (
       select e.subject_id as task_id, e.payload->>'to' as status, max(e.occurred_at) as at from events e
        where e.tenant_id = $1 and e.type = 'task.stateChanged' and e.subject_id in (select id from vis) group by 1, 2
     ),
     att as (
       select a.task_id, count(*)::int as n, max(greatest(a.started_at, a.finished_at)) as at from task_attempts a
        where a.task_id in (select id from vis) group by 1
     ),
     moved as (
       select x.subject as task_id, array_agg(coalesce(fi.agent_id, x.detail->>'fromAgent') order by x.id) as taken
         from audit_events x left join agent_instances fi on fi.id = x.detail->>'fromInstanceId' and fi.tenant_id = x.tenant_id
        where x.tenant_id = $1 and x.action = 'task.reassign' and x.result = 'ok' and x.subject in (select id from vis) group by 1
     )
     select v.id, v.status, v.simulated, v.owner, coalesce(att.n, 0) as attempts,
            coalesce(ev.at, greatest(att.at, v.created_at)) as finished_at, coalesce(moved.taken, '{}') as taken
       from vis v left join ev on ev.task_id = v.id and ev.status = v.status left join att on att.task_id = v.id left join moved on moved.task_id = v.id`,
    [viewer.tenantId, viewer.admin, viewer.userId, includeSimulated])).rows;
  return rows.map((r) => ({
    taskId: r.id, status: r.status, owner: r.owner, attempts: r.attempts, simulated: r.simulated,
    finishedAt: new Date(r.finished_at), takenFrom: (r.taken as (string | null)[]).filter((a): a is string => !!a),
  }));
}

/** Every agent gets its reliability from ONE classification of the viewer's rows, so the list and the detail can't diverge. */
export async function attachReliability<T extends AgentBase>(c: Tx | Db, viewer: { tenantId: string; admin: boolean; userId: string }, agents: T[], includeSimulated = false): Promise<(T & Pick<AgentDto, 'reliability'>)[]> {
  const of = reliabilityOf(await loadReliabilityRows(c, viewer, includeSimulated), { ...reliabilityWindow(), includeSimulated });
  return agents.map((a) => ({ ...a, reliability: of(a.id) }));
}
