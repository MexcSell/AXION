import type { OrgCoverage, OrgCoverageChange } from '../../../shared/contracts/src/index.ts';

/**
 * Improvement cycle 20: does the structure cover the company's needs? Facts only, computed from the reporting lines and
 * the agents (pure, no database). Everything here is a warning for the reader: coverage never blocks an approval.
 *
 * "Placed" = an active agent that is in the chart: the GM, or an agent with a manager line. A role is covered when a
 * placed active agent holds it. Roles compare case-insensitively (u1: one agent per role). "Head of a department" =
 * a member who reports to the GM (same reading as validateOrg's DEPT_WITHOUT_HEAD; the GM's own department is excluded).
 */
export const GM_ID = 'gm';
/** The role catalog: the 18 built-in roles (same keys as web/src/data/roles.ts). Custom roles are never "missing". */
export const ROLE_CATALOG = ['manager', 'research', 'analytics', 'dev', 'ops', 'security', 'comms', 'planning', 'loader', 'knowledge', 'optimize', 'qa', 'integration', 'browser', 'writer', 'mentor', 'release', 'design'] as const;

export interface CoverageEdge { supervisorId: string; subordinateId: string }
export interface CoverageAgent { id: string; status: string; dept: string; role: string; duty?: string | null }
const LIMIT = 64;
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** `prior`: the lines before a change; an agent that managed someone there counts as a manager (so losing all reports shows). */
export function orgCoverage(edges: CoverageEdge[], agents: CoverageAgent[], roles: readonly string[] = ROLE_CATALOG, prior: CoverageEdge[] = []): OrgCoverage {
  const active = agents.filter((a) => a.status === 'active');
  const up = new Map<string, string>();
  for (const e of edges) if (e.supervisorId !== e.subordinateId && !up.has(e.subordinateId)) up.set(e.subordinateId, e.supervisorId);
  const placed = active.filter((a) => a.id === GM_ID || up.has(a.id));

  const holders = (r: string, from: CoverageAgent[]) => from.filter((a) => a.role.toLowerCase() === r.toLowerCase()).map((a) => a.id).sort(cmp);
  const roleRows = roles.map((role) => ({ role, agentIds: holders(role, placed) }));
  const dup = new Map<string, string[]>();
  for (const a of active) { const k = a.role.toLowerCase(); dup.set(k, [...(dup.get(k) ?? []), a.id]); }
  const duplicateRoles = [...dup].filter(([, ids]) => ids.length > 1).map(([role, ids]) => ({ role, agentIds: ids.sort(cmp) })).sort((x, y) => cmp(x.role, y.role));

  const gmDept = active.find((a) => a.id === GM_ID)?.dept;
  const depts = new Map<string, CoverageAgent[]>();
  for (const a of placed) if (a.id !== GM_ID && a.dept !== gmDept) depts.set(a.dept, [...(depts.get(a.dept) ?? []), a]);
  const deptsWithoutHead = [...depts].filter(([, ms]) => !ms.some((m) => up.get(m.id) === GM_ID)).map(([d]) => d).sort(cmp);

  const reports = new Map<string, number>();
  for (const a of active) { const m = up.get(a.id); if (m) reports.set(m, (reports.get(m) ?? 0) + 1); }
  const before = new Set(prior.map((e) => e.supervisorId));
  const managersWithoutReports = active.filter((a) => !reports.has(a.id) && (a.role.toLowerCase() === 'manager' || before.has(a.id))).map((a) => a.id).sort(cmp);
  const agentsWithoutDuty = active.filter((a) => !(a.duty ?? '').trim()).map((a) => a.id).sort(cmp);

  let max = 0; let maxId: string | null = null;
  for (const [id, n] of [...reports].sort(([x], [y]) => cmp(x, y))) if (n > max) { max = n; maxId = id; }

  let depth = 0;
  for (const a of placed) {
    let n = 1; let cur = a.id;
    while (up.has(cur) && n <= LIMIT) { cur = up.get(cur)!; n++; }
    depth = Math.max(depth, n);
  }
  return { roles: roleRows, missingRoles: roleRows.filter((r) => !r.agentIds.length).map((r) => r.role), duplicateRoles, deptsWithoutHead, managersWithoutReports, agentsWithoutDuty, span: { max, agentId: maxId, managers: reports.size }, depth };
}

/** What a proposal changes in the coverage (pure). Messages state facts about the structure, nothing else. */
export function coverageChanges(before: OrgCoverage, after: OrgCoverage): OrgCoverageChange[] {
  const out: OrgCoverageChange[] = [];
  const b = new Set(before.missingRoles); const a = new Set(after.missingRoles);
  for (const role of after.missingRoles) if (!b.has(role)) out.push({ code: 'ROLE_UNCOVERED', role, message: `This proposal leaves role ${role} uncovered.` });
  for (const role of before.missingRoles) if (!a.has(role)) out.push({ code: 'ROLE_COVERED', role, message: `This proposal covers role ${role}.` });
  const bh = new Set(before.deptsWithoutHead); const ah = new Set(after.deptsWithoutHead);
  for (const dept of after.deptsWithoutHead) if (!bh.has(dept)) out.push({ code: 'HEAD_LOST', dept, message: `This proposal leaves ${dept} without a head.` });
  for (const dept of before.deptsWithoutHead) if (!ah.has(dept)) out.push({ code: 'HEAD_ADDED', dept, message: `This proposal adds a head to ${dept}.` });
  const bm = new Set(before.managersWithoutReports);
  for (const agentId of after.managersWithoutReports) if (!bm.has(agentId)) out.push({ code: 'MANAGER_ORPHANED', agentId, message: `${agentId} would manage nobody.` });
  if (after.span.max !== before.span.max) out.push({ code: 'SPAN_CHANGED', agentId: after.span.agentId ?? undefined, message: `The largest span of control goes from ${before.span.max} to ${after.span.max}.` });
  if (after.depth !== before.depth) out.push({ code: 'DEPTH_CHANGED', message: `The chart depth goes from ${before.depth} to ${after.depth} levels.` });
  return out;
}
