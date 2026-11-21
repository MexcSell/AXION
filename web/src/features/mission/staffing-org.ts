import type { Mission } from '../../data/types';

/**
 * Improvement cycle 11 (theme A4): a new real mission is staffed by the active organisation.
 * Pure part, shared by the server (which stores the result when the mission is created) and the web (the Add mission
 * preview in api mode). Relative imports only: the server (Node) imports this file directly.
 * Demo mode and DEMO missions never call it: their staffing is the fixture plan from ./staffing-plan, unchanged.
 */

/**
 * The department that answers for each kind of mission. This is the one table. Each value is the department of the
 * GM's fixture executor for that kind (a test pins this), so the seeded organisation staffs exactly as before.
 */
export const KIND_DEPT: Record<Mission['kind'], string> = {
  website: 'Engineering',
  research: 'R&D',
  training: 'QA',
  data: 'R&D',
  automation: 'Engineering',
  structure: 'Operations',
  'self-update': 'Engineering',
};

/** What staffing reads from the organisation: the agents (department, active or retired) and the reporting lines. */
export interface OrgView {
  revision?: number;
  agents: { id: string; dept: string; active: boolean }[];
  edges: { supervisorId: string; subordinateId: string }[];
}
export interface PlannedAgent { agentId: string; why: string; managerId?: string }
/** Where the executor came from: the department's head in the org chart, or the fixture rule (the department has no head). */
export interface StaffingOrigin { revision?: number; dept: string; executorFrom: 'head' | 'fixture' }

const GM = 'gm';
/** The reason given for the GM's usual executor when the department's head leads instead. */
export const FORMER_EXECUTOR_WHY = 'does the hands-on work for this kind of mission';

const supervisors = (org: OrgView) => new Map(org.edges.map((e) => [e.subordinateId, e.supervisorId]));

/** A department's heads: its active members who report to the GM (cycle 1's definition), by id. */
export function departmentHeads(dept: string, org: OrgView): string[] {
  const up = supervisors(org);
  return org.agents.filter((a) => a.active && a.dept === dept && a.id !== GM && up.get(a.id) === GM).map((a) => a.id).sort();
}

/**
 * The head who leads missions of this kind, or undefined when the department has no head. When it has several:
 *   1. the fixture executor, if it is a head itself;
 *   2. else the head above the fixture executor in the org chart;
 *   3. else the head with the most department members under them;
 *   4. else the first by id.
 */
export function departmentHead(kind: Mission['kind'], fixtureExecutor: string, org: OrgView): string | undefined {
  const dept = KIND_DEPT[kind];
  const heads = departmentHeads(dept, org);
  if (!heads.length) return undefined;
  if (heads.includes(fixtureExecutor)) return fixtureExecutor;
  const up = supervisors(org);
  const seen = new Set<string>();
  for (let cur = up.get(fixtureExecutor), prev = fixtureExecutor; cur !== undefined && !seen.has(cur); prev = cur, cur = up.get(cur)) {
    seen.add(cur);
    if (cur === GM) { if (heads.includes(prev)) return prev; break; }
  }
  const deptOf = new Map(org.agents.map((a) => [a.id, a.dept]));
  const down = new Map<string, string[]>();
  for (const e of org.edges) down.set(e.supervisorId, [...(down.get(e.supervisorId) ?? []), e.subordinateId]);
  const under = (id: string) => {
    let n = 0;
    const stack = [...(down.get(id) ?? [])];
    const visited = new Set<string>([id]);
    while (stack.length) {
      const x = stack.pop()!;
      if (visited.has(x)) continue;
      visited.add(x);
      if (deptOf.get(x) === dept) n++;
      stack.push(...(down.get(x) ?? []));
    }
    return n;
  };
  return [...heads].sort((a, b) => under(b) - under(a) || (a < b ? -1 : a > b ? 1 : 0))[0];
}

/**
 * The fixture plan (from staffingPlan) re-read against the organisation:
 * - the executor is the head of the mission kind's department (KIND_DEPT), or the fixture executor when it has no head;
 *   a replaced fixture executor joins as the first planned agent;
 * - each planned agent's manager is its org supervisor when that supervisor is one of the mission's agents other than
 *   the GM, otherwise the executor (agents who report to the GM in the chart are the executor's peers, and the
 *   executor brings them);
 * - the plan is put in join order: a manager joins before the agents under it, otherwise the fixture order is kept.
 */
export function orgStaffing(kind: Mission['kind'], base: { executorId: string; plan: { agentId: string; why: string }[] }, org: OrgView):
  { executorId: string; plan: PlannedAgent[]; origin: StaffingOrigin } {
  const head = departmentHead(kind, base.executorId, org);
  const executorId = head ?? base.executorId;
  const listed = base.plan.filter((p) => p.agentId !== executorId && p.agentId !== GM);
  const raw = executorId !== base.executorId ? [{ agentId: base.executorId, why: FORMER_EXECUTOR_WHY }, ...listed] : listed;
  const members = new Set([executorId, ...raw.map((p) => p.agentId)]);
  const up = supervisors(org);
  const withManager = raw.map((p): PlannedAgent => {
    const sup = up.get(p.agentId);
    return { ...p, managerId: sup && sup !== GM && sup !== p.agentId && members.has(sup) ? sup : executorId };
  });
  // join order: stable, managers first
  const plan: PlannedAgent[] = [];
  const joined = new Set([executorId]);
  let rest = withManager;
  while (rest.length) {
    const ready = rest.filter((p) => joined.has(p.managerId!));
    if (!ready.length) { for (const p of rest) plan.push({ ...p, managerId: executorId }); break; } // cannot happen on a valid chart
    for (const p of ready) { plan.push(p); joined.add(p.agentId); }
    rest = rest.filter((p) => !joined.has(p.agentId));
  }
  return { executorId, plan, origin: { ...(org.revision !== undefined ? { revision: org.revision } : {}), dept: KIND_DEPT[kind], executorFrom: head ? 'head' : 'fixture' } };
}
