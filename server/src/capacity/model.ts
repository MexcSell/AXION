// Review-capacity read model (c65, research R3-10). Records and display only: nothing here changes, blocks or orders a decision.
// The utilisation-to-wait relationship and Little's law are standard queueing mathematics; they are not taken from the research papers.
// Reuses c58's stored decision latency and queue size (approval_decisions.latency_ms, queue_size); it does not recompute them.
// Every duration and every window bound comes from the database clock (now()) inside SQL.
import { tx, type Db, type Tx } from '../db.ts';
import { littlesLaw } from './littles.ts';
import type { CapacityCellDto, CapacityDeptDto, ReviewCapacityDto, SpanRowDto } from '../../../shared/contracts/src/index.ts';

/** Percentiles are null below this many decided items. */
export const MIN_PERCENTILE_N = 20;
/** A non-administrator sees numbers only from this many items and this many different people (c58's floor). */
export const MIN_ITEMS = 5;
export const MIN_PEOPLE = 3;
/** Only these windows exist, so a member cannot difference two adjacent windows to isolate single items. */
export const WINDOWS = [7, 30, 90] as const;
export const DEFAULT_WINDOW_DAYS = 30;
export const UNASSIGNED = 'Unassigned';

/**
 * The one rule that puts an item in a department: the department of the agent that raised it (an approval: approval_requests.agent_id;
 * a task waiting for a person: the owner instance's agent, else the task's owner_agent: the same rule as c54's departments and c63), read from the agent catalogue (agent_definitions.dept). An agent that is not in
 * the catalogue, or a task with no owner, is "Unassigned" (shown, never dropped and never guessed). Simulated tasks and demo missions are not counted (as in c54). The department is the agent's CURRENT catalogue department, so editing an agent's department moves its past items too. The mission's department is not used:
 * a mission has no department of its own, and an agent's catalogue department is what c6's department facts already use.
 */
export const DEPARTMENT_RULE = 'The department of the agent that raised the item (an approval) or owns the task (a task waiting for a person: its owner instance\'s agent, else its owner agent), from the agent catalogue as it is now; no catalogue entry means Unassigned. Simulated tasks are not counted.';
/**
 * Utilisation (arrivals x mean handling time against the hours an operator gives) is NOT in v1. Two inputs do not exist: AXION records
 * the time from request to decision (which is mostly waiting, so using it would overstate the load) but no handling time, and there is
 * no operator setting for review hours per week. Showing a number built on guesses would be worse than showing none.
 */
export const UTILISATION_NOTE = 'Not measured in this version: AXION records how long a request waits for a decision, not how long a person spends handling it (no handling time), and there is no review hours per week setting yet.';
/**
 * Observed span: for each supervisor in the latest org revision, how many active agents report to them and how many open items those
 * agents raised. It is a measure only. No source gives a safe span of control, so none is claimed, and no field here holds a limit.
 * The rows are agents (not people), listed alphabetically, never by load.
 */
export const SPAN_NOTE = 'A measure only, from the latest org chart. No recommended number: no source gives a safe span of control.';
export const departmentOfAgent = (dept: string | null | undefined): string => (dept && dept.trim() ? dept : UNASSIGNED);

/**
 * The items, one row each, with every duration computed here in SQL. $1 = tenant, $2 = window days.
 *  kind approval: arrival = created_at; closed = the decision, else the expiry (expired, or pending past expires_at); latency = c58's stored latency_ms.
 *  kind task_wait: arrival = the task.stateChanged event into waiting_user; closed = the next event out of it; latency from the two event times.
 *  is_open: still needs a person now. missing_close: no close record although the item is not open (a data-quality fault).
 */
export const ITEMS_SQL = `
  -- the window is N x 24 hours (hours, not days: make_interval(days) is a calendar interval and shifts by an hour across a DST change)
  win as (select now() - make_interval(hours => $2::int * 24) as s, now() as e),
  ap as (
    select 'approval'::text as kind, r.id, coalesce(nullif(btrim(ad.dept), ''), '${UNASSIGNED}') as dept, r.agent_id as agent, r.created_at as arrived,
           coalesce(dd.decided_at, case when r.state = 'expired' or (r.state = 'pending' and r.expires_at <= now()) then least(r.expires_at, now()) end) as closed,
           dd.decided_at is not null as decided, dd.decided_by as decided_by, dd.latency_ms::double precision as latency_ms, dd.queue_size as queue_size, (dd.decided_at is not null and dd.latency_ms is not null) as timed,
           (r.state = 'pending' and r.expires_at > now()) as is_open,
           (dd.decided_at is null and r.state not in ('pending', 'expired')) as missing_close
      from approval_requests r
      left join agent_definitions ad on ad.id = r.agent_id and ad.tenant_id = r.tenant_id
      left join lateral (select decided_at, decided_by, latency_ms, queue_size from approval_decisions d where d.approval_id = r.id order by d.decided_at desc limit 1) dd on true
     where r.tenant_id = $1 and r.demo = false),
  tw as (
    select 'task_wait'::text as kind, e.subject_id || '#' || e.id as id, coalesce(nullif(btrim(ad.dept), ''), '${UNASSIGNED}') as dept, coalesce(oi.agent_id, t.owner_agent) as agent, e.occurred_at as arrived,
           cl.at as closed, cl.at is not null as decided, case when cl.kind = 'human' then cl.actor end as decided_by,
           (extract(epoch from (cl.at - e.occurred_at)) * 1000)::double precision as latency_ms, null::int as queue_size, cl.at is not null as timed,
           (cl.at is null and t.status = 'waiting_user' and not exists (select 1 from events n where n.tenant_id = e.tenant_id and n.type = 'task.stateChanged' and n.subject_id = e.subject_id and n.id > e.id and n.payload->>'to' = 'waiting_user')) as is_open,
           (cl.at is null and not (t.status = 'waiting_user' and not exists (select 1 from events n where n.tenant_id = e.tenant_id and n.type = 'task.stateChanged' and n.subject_id = e.subject_id and n.id > e.id and n.payload->>'to' = 'waiting_user'))) as missing_close
      from events e
      join tasks t on t.id = e.subject_id and t.tenant_id = e.tenant_id
      join missions m on m.id = t.mission_id and m.deleted_at is null and m.demo = false and not t.simulated
      left join agent_instances oi on oi.id = t.owner_instance_id
      left join agent_definitions ad on ad.id = coalesce(oi.agent_id, t.owner_agent) and ad.tenant_id = t.tenant_id
      left join lateral (select x.occurred_at as at, x.actor_id as actor, x.actor_kind as kind from events x where x.tenant_id = e.tenant_id and x.type = 'task.stateChanged' and x.subject_id = e.subject_id and x.id > e.id and x.payload->>'from' = 'waiting_user' order by x.id limit 1) cl on true
     where e.tenant_id = $1 and e.type = 'task.stateChanged' and e.payload->>'to' = 'waiting_user'),
  items as (select * from ap union all select * from tw)`;

export interface RawCell {
  arrivals: number; open_now: number; decided_n: number; people: number; p50: number | null; p95: number | null; medq: number | null;
  /** Little's law inputs, ms */ sum_tis: number; sum_overlap: number; missing: number;
}
export const CELL_AGG = `
  count(*) filter (where arrived >= w.s)::int as arrivals,
  count(*) filter (where is_open)::int as open_now,
  count(*) filter (where timed and arrived >= w.s)::int as decided_n,
  count(distinct decided_by) filter (where timed and arrived >= w.s)::int as people,
  percentile_cont(0.5) within group (order by latency_ms) filter (where timed and arrived >= w.s) as p50,
  percentile_cont(0.95) within group (order by latency_ms) filter (where timed and arrived >= w.s) as p95,
  percentile_cont(0.5) within group (order by queue_size) filter (where timed and arrived >= w.s and queue_size is not null) as medq,
  coalesce(sum(extract(epoch from (coalesce(closed, w.e) - arrived)) * 1000) filter (where arrived >= w.s), 0)::double precision as sum_tis,
  coalesce(sum(greatest(0, extract(epoch from (least(coalesce(closed, w.e), w.e) - greatest(arrived, w.s))) * 1000)), 0)::double precision as sum_overlap,
  count(*) filter (where missing_close)::int as missing`;

const r1 = (x: number) => Math.round(x * 10) / 10;
/** Pure: turns one aggregated row into a cell, applying the floors. Below the floor a member gets n and the reason only: `decided` and `people` are null too (a count of 1 person would name a sole decider). Administrators see every cell; the percentile rule applies to everyone. */
export function toCell(r: RawCell, windowDays: number, viewerIsAdmin: boolean): CapacityCellDto {
  const shown = viewerIsAdmin || (r.arrivals >= MIN_ITEMS && r.people >= MIN_PEOPLE);
  const pct = shown && r.decided_n >= MIN_PERCENTILE_N;
  return {
    n: r.arrivals, decided: shown ? r.decided_n : null, people: shown ? r.people : null, shown,
    arrivalPerDay: shown ? r.arrivals / windowDays : null, openBacklog: shown ? r.open_now : null,
    p50Ms: pct && r.p50 !== null ? Math.round(Number(r.p50)) : null, p95Ms: pct && r.p95 !== null ? Math.round(Number(r.p95)) : null,
    medianQueueSize: shown && r.medq !== null ? r1(Number(r.medq)) : null,
  };
}
const num = (r: Record<string, any>): RawCell => ({
  arrivals: Number(r.arrivals), open_now: Number(r.open_now), decided_n: Number(r.decided_n), people: Number(r.people),
  p50: r.p50 === null ? null : Number(r.p50), p95: r.p95 === null ? null : Number(r.p95), medq: r.medq === null ? null : Number(r.medq),
  sum_tis: Number(r.sum_tis), sum_overlap: Number(r.sum_overlap), missing: Number(r.missing),
});

/** Tasks waiting for a person now with no task.stateChanged event into waiting_user: invisible as items, so counted as a lost open record. */
export const MISSING_OPEN_SQL = `
  select count(*)::int as n from tasks t join missions m on m.id = t.mission_id and m.deleted_at is null and m.demo = false
   where t.tenant_id = $1 and t.status = 'waiting_user' and not t.simulated
     and not exists (select 1 from events e where e.tenant_id = t.tenant_id and e.type = 'task.stateChanged' and e.subject_id = t.id and e.payload->>'to' = 'waiting_user')`;

/** Per department and in total, over a fixed window. Every read runs in one transaction, so now() (and windowStart) is one instant. */
export function reviewCapacity(db: Db | Tx, tenantId: string, windowDays: number, viewerIsAdmin: boolean): Promise<ReviewCapacityDto> {
  return 'totalCount' in db ? tx(db as Db, (c) => reviewCapacityIn(c, tenantId, windowDays, viewerIsAdmin)) : reviewCapacityIn(db as Tx, tenantId, windowDays, viewerIsAdmin);
}
async function reviewCapacityIn(db: Tx, tenantId: string, windowDays: number, viewerIsAdmin: boolean): Promise<ReviewCapacityDto> {
  const rows = (await db.query(
    `with ${ITEMS_SQL}
     select dept, grouping(dept)::int as is_total, ${CELL_AGG}, (select s from win) as window_start
       from items, win w group by grouping sets ((dept), ()) order by dept nulls last`, [tenantId, windowDays])).rows;
  const total = rows.find((r) => r.is_total === 1);
  const empty: RawCell = { arrivals: 0, open_now: 0, decided_n: 0, people: 0, p50: null, p95: null, medq: null, sum_tis: 0, sum_overlap: 0, missing: 0 };
  const start = total ? total.window_start : (await db.query(`select (now() - make_interval(hours => $1::int * 24)) as s`, [windowDays])).rows[0].s;
  const missingOpen = Number((await db.query(MISSING_OPEN_SQL, [tenantId])).rows[0].n);
  const departments: CapacityDeptDto[] = rows.filter((r) => r.is_total !== 1).map((r) => ({ dept: r.dept as string, ...toCell(num(r), windowDays, viewerIsAdmin) }));
  const shownDept = new Set(departments.filter((d) => d.shown).map((d) => d.dept));
  const span: SpanRowDto[] = (await db.query(
    `with ${ITEMS_SQL},
     rev as (select id from org_revisions where tenant_id = $1 order by seq desc limit 1),
     it as materialized (select * from items),
     sa as (select e2.supervisor_id as sid, count(*) filter (where i.is_open)::int as open_items, count(*) filter (where i.arrived >= w.s)::int as arr,
                   count(distinct i.decided_by) filter (where i.timed and i.arrived >= w.s)::int as ppl, array_agg(distinct i.dept) as depts
              from org_edges e2 join it i on i.agent = e2.subordinate_id cross join win w
             where e2.revision_id = (select id from rev) group by e2.supervisor_id)
     select sup.id as supervisor_id, sup.name, coalesce(nullif(btrim(sup.dept), ''), '${UNASSIGNED}') as dept,
            count(*) filter (where sub.status = 'active')::int as agents,
            coalesce(sa.open_items, 0) as open_items, coalesce(sa.arr, 0) as arr, coalesce(sa.ppl, 0) as ppl, coalesce(sa.depts, '{}') as depts
       from org_edges e join agent_definitions sup on sup.id = e.supervisor_id and sup.tenant_id = $1 join agent_definitions sub on sub.id = e.subordinate_id
       left join sa on sa.sid = e.supervisor_id
      where e.revision_id = (select id from rev) group by sup.id, sup.name, sup.dept, sa.open_items, sa.arr, sa.ppl, sa.depts order by sup.name, sup.id`, [tenantId, windowDays])).rows
    .map((r) => {
      // the same floor as the cells: a member sees a supervisor's open items only when the items behind them clear the floor AND none of
      // them sits in a department whose own cell is hidden, so adding rows up can never recover a backlog the cells suppress
      const shown = viewerIsAdmin || (Number(r.arr) >= MIN_ITEMS && Number(r.ppl) >= MIN_PEOPLE && (r.depts as string[]).every((d) => shownDept.has(d)));
      return { supervisorId: r.supervisor_id as string, name: r.name as string, dept: r.dept as string, agents: Number(r.agents), openItems: shown ? Number(r.open_items) : null };
    });
  const t = total ? num(total) : empty;
  return {
    windowDays, windowStart: new Date(start).toISOString(), minItems: MIN_ITEMS, minPeople: MIN_PEOPLE, minPercentileN: MIN_PERCENTILE_N,
    total: toCell(t, windowDays, viewerIsAdmin), departments,
    span: { rows: span, note: SPAN_NOTE },
    utilisation: { value: null, reason: 'not_measured', note: UTILISATION_NOTE },
    littles: littlesLaw({ arrivals: t.arrivals, sumTisMs: t.sum_tis, sumOverlapMs: t.sum_overlap, windowMs: windowDays * 86_400_000, missingClose: t.missing, missingOpen, openNow: t.open_now }),
  };
}

export interface PersonRow { userId: string; name: string; decided: number; p50Ms: number | null; p95Ms: number | null; medianQueueSize: number | null }
/**
 * Per decider, FOR ADMINISTRATORS ONLY (a person is a monitored individual). Same cohort as the cells: items that arrived in the window and were decided with a stored time. Percentiles are null below MIN_PERCENTILE_N decided items.
 * Listed alphabetically by name, never by load or speed. A decider who is not a user row (deleted) shows as "Unknown user".
 */
export async function reviewPeople(db: Db | Tx, tenantId: string, windowDays: number): Promise<PersonRow[]> {
  const rows = (await db.query(
    `with ${ITEMS_SQL}
     select i.decided_by as user_id, coalesce(max(u.name), 'Unknown user') as name, count(*)::int as decided,
            percentile_cont(0.5) within group (order by i.latency_ms) as p50, percentile_cont(0.95) within group (order by i.latency_ms) as p95,
            percentile_cont(0.5) within group (order by i.queue_size) filter (where i.queue_size is not null) as medq
       from items i cross join win w left join users u on u.id = i.decided_by and u.tenant_id = $1
      where i.timed and i.decided_by is not null and i.arrived >= w.s
      group by i.decided_by order by 2, 1`, [tenantId, windowDays])).rows;
  return rows.map((r) => {
    const pct = Number(r.decided) >= MIN_PERCENTILE_N;
    return { userId: r.user_id as string, name: r.name as string, decided: Number(r.decided), p50Ms: pct && r.p50 !== null ? Math.round(Number(r.p50)) : null, p95Ms: pct && r.p95 !== null ? Math.round(Number(r.p95)) : null, medianQueueSize: r.medq === null ? null : r1(Number(r.medq)) };
  });
}
