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
 * Rules (also in the `?` help and the cycle report). Fix round (review I2): every outcome counts against the agent that
 * owned the task when it happened.
 * - Evidence is a task that is `passed` or `failed` now and whose finish time is in the window [to − 90 days, to].
 *   Open tasks are not evidence yet; `canceled` (a human stop) counts neither for nor against anyone.
 * - Every agent a task was reassigned away from gets it once as unreliable ("reassigned away"), whatever happened later.
 * - The final owner is judged only on what happened after it took the task over (after the last handover; from the
 *   start when there was none). Its own attempts are the attempts that started or finished after the handover, plus
 *   attempts not started yet (a retry's placeholder is run by whoever owns the task).
 *   - passed + exactly one own attempt → reliable; passed + more → retried; passed + none → not counted (m2).
 *   - failed → failed, unless the task was already `failed` when it was handed over and the new owner made no attempt
 *     of its own: a person reassigning a failed task never adds a failure to the receiving agent (not counted).
 *   - An agent that is also one the task was taken from (A → B → A) is charged once, as reassigned away.
 * - value = reliable ÷ (reliable + unreliable) as a whole percentage, null while n < MIN_EVIDENCE.
 * - Simulated (DEMO) tasks are left out unless includeSimulated.
 */
export const WINDOW_DAYS = 90;
const DAY = 86_400_000;
const FINISHED = new Set(['passed', 'failed']);

export interface Handover {
  /** the agent the task was taken from (null: unknown, skipped) */
  from: string | null;
  at: Date;
  /** the task's status at the handover */
  state: string | null;
}
export interface ReliabilityRow {
  taskId: string;
  status: string;
  /** the final owner's agent id (null: nobody owns it) */
  owner: string | null;
  /** one entry per recorded attempt: its start time, else its finish time; null = not started yet */
  attempts: (Date | null)[];
  simulated: boolean;
  /** the later of the last move into the current status and the last attempt time (a lower bound of the real finish) */
  finishedAt: Date;
  /** reassignments in order */
  handovers: Handover[];
}

export function reliabilityWindow(now = new Date()) {
  return { from: new Date(now.getTime() - WINDOW_DAYS * DAY), to: now };
}

const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

interface Tally { reliable: number; retried: number; failed: number; reassigned: number; noAttempt: number; inherited: number }
const ZERO: Tally = { reliable: 0, retried: 0, failed: 0, reassigned: 0, noAttempt: 0, inherited: 0 };

/** Classify every row once; returns the reliability of any agent id (agents without evidence get an empty one). */
export function reliabilityOf(rows: ReliabilityRow[], opt: { from: Date; to: Date; includeSimulated: boolean }): (agentId: string) => AgentReliability {
  const from = opt.from.getTime(), to = opt.to.getTime();
  const by = new Map<string, Tally>();
  const tally = (a: string) => { let x = by.get(a); if (!x) by.set(a, (x = { ...ZERO })); return x; };
  for (const r of rows) {
    if (!FINISHED.has(r.status) || (r.simulated && !opt.includeSimulated)) continue;
    const t = r.finishedAt.getTime();
    if (!(t >= from && t <= to)) continue;
    const taken = new Set(r.handovers.map((h) => h.from).filter((a): a is string => !!a));
    for (const a of taken) tally(a).reassigned++;
    if (!r.owner || taken.has(r.owner)) continue;
    const last = r.handovers.length ? r.handovers[r.handovers.length - 1] : null;
    const since = last ? last.at.getTime() : -Infinity;
    const own = r.attempts.filter((a) => a == null || a.getTime() > since).length;
    const x = tally(r.owner);
    if (r.status === 'failed') {
      if (last && last.state === 'failed' && own === 0) x.inherited++;
      else x.failed++;
    } else if (own === 0) x.noAttempt++;
    else if (own > 1) x.retried++;
    else x.reliable++;
  }
  return (agentId) => {
    const x = by.get(agentId) ?? ZERO;
    const n = x.reliable + x.retried + x.failed + x.reassigned;
    const parts = [
      n ? `${x.reliable} of ${plural(n, 'finished task')} passed first time` : 'no finished tasks',
      ...(x.retried ? [`${x.retried} retried`] : []),
      ...(x.failed ? [`${x.failed} failed`] : []),
      ...(x.reassigned ? [`${x.reassigned} reassigned away`] : []),
      ...(x.noAttempt ? [`${x.noAttempt} passed with no recorded attempt of its own (not counted)`] : []),
      ...(x.inherited ? [`${x.inherited} taken over after failing elsewhere (not counted)`] : []),
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
 * with its final owner agent, attempt times, finish time and its handovers (from whom, when, in which state). Reassignments are
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
       select a.task_id, array_agg(coalesce(a.started_at, a.finished_at) order by a.attempt_no) as times,
              max(greatest(a.started_at, a.finished_at)) as at from task_attempts a
        where a.task_id in (select id from vis) group by 1
     ),
     moved as (
       select x.subject as task_id,
              jsonb_agg(jsonb_build_object('from', coalesce(fi.agent_id, x.detail->>'fromAgent'), 'at', x.at, 'state', x.detail->>'from') order by x.at, x.id) as handovers
         from audit_events x left join agent_instances fi on fi.id = x.detail->>'fromInstanceId' and fi.tenant_id = x.tenant_id
        where x.tenant_id = $1 and x.action = 'task.reassign' and x.result = 'ok' and x.subject in (select id from vis) group by 1
     )
     select v.id, v.status, v.simulated, v.owner, coalesce(att.times, '{}') as attempts,
            greatest(ev.at, att.at, v.created_at) as finished_at, coalesce(moved.handovers, '[]'::jsonb) as handovers
       from vis v left join ev on ev.task_id = v.id and ev.status = v.status left join att on att.task_id = v.id left join moved on moved.task_id = v.id`,
    [viewer.tenantId, viewer.admin, viewer.userId, includeSimulated])).rows;
  return rows.map((r) => ({
    taskId: r.id, status: r.status, owner: r.owner, simulated: r.simulated, finishedAt: new Date(r.finished_at),
    attempts: (r.attempts as (string | Date | null)[]).map((a) => (a == null ? null : new Date(a))),
    handovers: (r.handovers as { from: string | null; at: string; state: string | null }[]).map((h) => ({ from: h.from ?? null, at: new Date(h.at), state: h.state ?? null })),
  }));
}

/** Every agent gets its reliability from ONE classification of the viewer's rows, so the list and the detail can't diverge. */
export async function attachReliability<T extends AgentBase>(c: Tx | Db, viewer: { tenantId: string; admin: boolean; userId: string }, agents: T[], includeSimulated = false): Promise<(T & Pick<AgentDto, 'reliability'>)[]> {
  const of = reliabilityOf(await loadReliabilityRows(c, viewer, includeSimulated), { ...reliabilityWindow(), includeSimulated });
  return agents.map((a) => ({ ...a, reliability: of(a.id) }));
}
