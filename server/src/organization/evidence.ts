import type { Db, Tx } from '../db.ts';
import { RESTRUCTURE_TRIGGERS, type OrgEvidence, type RestructureTrigger, type TriggerEvidence } from '../../../shared/contracts/src/index.ts';
import { orgCoverage, type CoverageAgent, type CoverageEdge } from './coverage.ts';

/**
 * c64 (R3-6) item 1: the evidence block of an organisation proposal. The proposer only PICKS which triggers apply (a closed
 * list); every count here is computed from recorded rows, never typed. The literature gives no rule for when to restructure,
 * so `supported` is only a plain reading of the counts, shown to the reader, and it never blocks or approves anything.
 *
 * What counts: real work only. Missions that are demo or deleted, and tasks marked simulated, are not evidence. Failure tags count
 * only when a person confirmed them. Reassigns count only when they succeeded. The window is the database clock: `now() - interval`
 * in SQL, never a bound built in the application.
 *
 * "Affected" = the agents whose reporting line the proposal adds, removes or re-points, and the managers they leave or join.
 * The reassign and failure triggers look at the ROLES of those agents (a role is what the structure is about).
 */
export const EVIDENCE_WINDOW_DAYS = 30;
/** `supported` rules (documented here and in the help text). */
export const LOAD_MIN_TASKS = 3;       // the busiest agent holds at least this many open tasks ...
export const LOAD_MIN_RATIO = 2;       // ... and at least this many times the average of the agents that hold any
export const REASSIGN_MIN = 2;         // at least this many reassigns away from agents of the affected roles
export const FAILURE_MIN_TAGS = 3;     // at least this many confirmed tags in the window ...
export const FAILURE_MIN_SHARE = 0.5;  // ... and the top role holds at least this share of ALL of them (tags not attributed to a role count in the denominator)

const OPEN = `('created','ready','running','waiting_agent','waiting_user','verifying','retry_ready')`;
const REAL = `m.tenant_id = $1 and m.deleted_at is null and not m.demo and not t.simulated`;
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const round1 = (n: number) => Math.round(n * 10) / 10;

export function affectedAgents(current: CoverageEdge[], proposed: CoverageEdge[]): string[] {
  const before = new Map(current.map((e) => [e.subordinateId, e.supervisorId]));
  const after = new Map(proposed.map((e) => [e.subordinateId, e.supervisorId]));
  const out = new Set<string>();
  for (const sub of new Set([...before.keys(), ...after.keys()])) {
    const b = before.get(sub); const a = after.get(sub);
    if (b === a) continue;
    out.add(sub);
    if (b) out.add(b);
    if (a) out.add(a);
  }
  return [...out].sort(cmp);
}

type Q = Tx | Db;
async function loadImbalance(c: Q, tenantId: string): Promise<TriggerEvidence> {
  const rows = (await c.query(
    `select coalesce(t.owner_agent, i.agent_id) as agent_id, count(*)::int as n
       from tasks t join missions m on m.id = t.mission_id left join agent_instances i on i.id = t.owner_instance_id
      where ${REAL} and t.status in ${OPEN} and coalesce(t.owner_agent, i.agent_id) is not null
      group by 1 order by n desc, 1`, [tenantId])).rows as { agent_id: string; n: number }[];
  const active = (await c.query(`select count(*)::int as n from agent_definitions where tenant_id=$1 and status='active'`, [tenantId])).rows[0].n as number;
  const top = rows[0];
  const avg = rows.length ? rows.reduce((s, r) => s + r.n, 0) / rows.length : 0;
  return {
    kind: 'load_imbalance', scope: 'now',
    supported: !!top && top.n >= LOAD_MIN_TASKS && top.n >= LOAD_MIN_RATIO * avg && rows.length > 1,
    facts: [
      { label: 'Open tasks of the busiest agent', value: top?.n ?? 0 },
      { label: 'Average open tasks of agents that hold any', value: round1(avg) },
      { label: 'Agents with at least one open task', value: rows.length },
      { label: 'Active agents', value: active },
    ],
    subjects: top ? [top.agent_id] : [],
  };
}

function coverageGap(current: CoverageEdge[], agents: CoverageAgent[]): TriggerEvidence {
  const cov = orgCoverage(current, agents);
  const facts = [
    { label: 'Roles nobody holds', value: cov.missingRoles.length },
    { label: 'Departments without a head', value: cov.deptsWithoutHead.length },
    { label: 'Managers without reports', value: cov.managersWithoutReports.length },
    { label: 'Agents without a duty', value: cov.agentsWithoutDuty.length },
  ];
  return { kind: 'coverage_gap', scope: 'now', supported: facts.some((f) => f.value > 0), facts, subjects: [...cov.missingRoles, ...cov.deptsWithoutHead].sort(cmp) };
}

/** Reassign counts per role: audit `task.reassign` rows that succeeded in the window, on tasks of real missions (demo, deleted and simulated work is left out, like the other counts), by the role of the agent the task was taken from. */
async function repeatedReassigns(c: Q, tenantId: string, affectedRoles: string[]): Promise<TriggerEvidence> {
  const rows = (await c.query(
    `select lower(d.role) as role, count(*)::int as n
       from audit_events a
       left join agent_instances i on i.id = a.detail->>'fromInstanceId' and i.tenant_id = a.tenant_id
       join agent_definitions d on d.id = coalesce(a.detail->>'fromAgent', i.agent_id) and d.tenant_id = a.tenant_id
       join tasks t on t.id = a.subject and t.tenant_id = a.tenant_id
       join missions m on m.id = t.mission_id
      where m.deleted_at is null and not m.demo and not t.simulated and a.tenant_id = $1 and a.action = 'task.reassign' and a.result = 'ok' and a.at > now() - make_interval(days => $2)
      group by 1`, [tenantId, EVIDENCE_WINDOW_DAYS])).rows as { role: string; n: number }[];
  const set = new Set(affectedRoles.map((r) => r.toLowerCase()));
  const all = rows.reduce((s, r) => s + r.n, 0);
  const hit = rows.filter((r) => set.has(r.role)).reduce((s, r) => s + r.n, 0);
  return {
    kind: 'repeated_reassigns', scope: 'window', supported: hit >= REASSIGN_MIN,
    facts: [{ label: 'Reassigns away from agents of the affected roles', value: hit }, { label: 'Reassigns away from agents of all roles', value: all }],
    subjects: [...set].sort(cmp),
  };
}

/** Confirmed failure tags on tasks, by the role of the agent that owned the task. Tags on messages, attempts and missions are not attributed to a role. */
async function failureConcentration(c: Q, tenantId: string): Promise<TriggerEvidence> {
  const rows = (await c.query(
    `select lower(d.role) as role, count(*)::int as n
       from failure_tags f
       join tasks t on f.subject_kind = 'task' and t.id = f.subject_id and t.tenant_id = f.tenant_id
       join missions m on m.id = t.mission_id
       left join agent_instances i on i.id = t.owner_instance_id
       join agent_definitions d on d.id = coalesce(t.owner_agent, i.agent_id) and d.tenant_id = f.tenant_id
      where f.tenant_id = $1 and f.status = 'confirmed' and f.created_at > now() - make_interval(days => $2) and m.deleted_at is null and not m.demo and not t.simulated
      group by 1 order by n desc, 1`, [tenantId, EVIDENCE_WINDOW_DAYS])).rows as { role: string; n: number }[];
  const total = (await c.query(
    `select count(*)::int as n from failure_tags f join missions m on m.id = f.mission_id
      where f.tenant_id = $1 and f.status = 'confirmed' and f.created_at > now() - make_interval(days => $2) and m.deleted_at is null and not m.demo`, [tenantId, EVIDENCE_WINDOW_DAYS])).rows[0].n as number;
  const attributed = rows.reduce((s, r) => s + r.n, 0);
  const top = rows[0];
  return {
    kind: 'failure_concentration', scope: 'window',
    supported: !!top && total >= FAILURE_MIN_TAGS && top.n / total >= FAILURE_MIN_SHARE, // the share is of ALL confirmed tags in the window, not only the attributed ones
    facts: [
      { label: 'Confirmed failure tags', value: total },
      { label: 'Of these on tasks of a known role', value: attributed },
      { label: 'Tags on the top role', value: top?.n ?? 0 },
    ],
    subjects: top ? [top.role] : [],
  };
}

/** The evidence block: all four triggers are computed from recorded rows. `triggers` = the ones the proposer picked (duplicates dropped,
    canonical order; none is a valid, honest answer); `others` = the rest, so a proposer cannot show only the trigger that happens to be backed. */
export async function computeEvidence(c: Q, tenantId: string, picked: readonly RestructureTrigger[], a: { current: CoverageEdge[]; proposed: CoverageEdge[]; agents: CoverageAgent[] }): Promise<OrgEvidence> {
  const roles = [...new Set(affectedAgents(a.current, a.proposed).map((id) => a.agents.find((x) => x.id === id)?.role).filter((r): r is string => !!r))];
  const triggers: TriggerEvidence[] = [];
  const others: TriggerEvidence[] = [];
  for (const k of RESTRUCTURE_TRIGGERS) {
    const ev = k === 'load_imbalance' ? await loadImbalance(c, tenantId)
      : k === 'coverage_gap' ? coverageGap(a.current, a.agents)
        : k === 'repeated_reassigns' ? await repeatedReassigns(c, tenantId, roles)
          : await failureConcentration(c, tenantId);
    (picked.includes(k) ? triggers : others).push(ev);
  }
  return { triggers, others, windowDays: EVIDENCE_WINDOW_DAYS };
}
