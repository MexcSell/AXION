import type { OrgDryRun, OrgEdgeDto, OrgIssue } from '../../../shared/contracts/src/index.ts';

export interface EdgeIn { supervisorId: string; subordinateId: string; edgeType?: string }
/** `status` is agent_definitions.status (active | retired), not the display status. */
export interface OrgAgent { id: string; status: string; dept: string; role?: string }

export const GM = 'gm';
const CHAIN_LIMIT = 64; // same walk as agents/org.ts assertAcyclic, so a clean dry run is also accepted there
const edge = (e: EdgeIn): OrgEdgeDto => ({ supervisorId: e.supervisorId, subordinateId: e.subordinateId, edgeType: e.edgeType ?? 'reports_to' });
const keyOf = (e: OrgEdgeDto) => `${e.supervisorId}\u0000${e.subordinateId}\u0000${e.edgeType}`;
const bySub = (a: OrgEdgeDto, b: OrgEdgeDto) => a.subordinateId.localeCompare(b.subordinateId) || a.supervisorId.localeCompare(b.supervisorId);

/**
 * Dry run of a proposed organisation (pure: no database). `edges` is the full proposed set of reporting lines,
 * `current` the active revision's lines (for added/removed).
 * Errors (block approval): an unknown agent, self-management, a reporting cycle (seen-set walk, limit 64),
 * more than one manager, an active agent other than the GM without a manager.
 * Warnings (shown, never block):
 *  - MANAGER_WITHOUT_REPORTS: an active agent that manages someone in the active revision (or whose role is manager)
 *    and would manage nobody;
 *  - DEPT_WITHOUT_HEAD: a department (of active agents, the GM's own excluded) where no member reports to the GM.
 */
export function validateOrg(edges: EdgeIn[], agents: OrgAgent[], current: EdgeIn[] = []): OrgDryRun {
  const errors: OrgIssue[] = [];
  const warnings: OrgIssue[] = [];
  const byId = new Map(agents.map((a) => [a.id, a]));
  const proposed = edges.map(edge);

  const unknown = new Set<string>();
  for (const e of proposed) for (const id of [e.supervisorId, e.subordinateId]) if (!byId.has(id)) unknown.add(id);
  for (const id of unknown) errors.push({ code: 'UNKNOWN_AGENT', agentId: id, message: `${id} is not an agent of this company.` });

  const up = new Map<string, string>();
  const multi = new Set<string>();
  for (const e of proposed) {
    if (e.supervisorId === e.subordinateId) { errors.push({ code: 'SELF_MANAGED', agentId: e.subordinateId, message: `${e.subordinateId} cannot manage itself.` }); continue; }
    if (up.has(e.subordinateId)) { multi.add(e.subordinateId); continue; }
    up.set(e.subordinateId, e.supervisorId);
  }
  for (const id of multi) errors.push({ code: 'MULTIPLE_MANAGERS', agentId: id, message: `${id} would have more than one manager.` });

  // a cycle is reported once, at the first agent (in a stable order) whose chain loops or runs deeper than the limit
  const looped = new Set<string>();
  for (const start of [...up.keys()].sort()) {
    if (looped.has(start)) continue;
    const seen = new Set<string>([start]);
    let cur = up.get(start);
    for (let depth = 0; cur !== undefined; depth++) {
      if (seen.has(cur) || depth >= CHAIN_LIMIT) {
        const deep = !seen.has(cur);
        errors.push({ code: 'CYCLE', agentId: start, message: deep ? `The reporting chain above ${start} is deeper than ${CHAIN_LIMIT} levels.` : `The reporting lines above ${start} form a loop.` });
        seen.forEach((s) => looped.add(s));
        break;
      }
      seen.add(cur);
      cur = up.get(cur);
    }
  }

  const managed = new Set(proposed.filter((e) => e.supervisorId !== e.subordinateId).map((e) => e.subordinateId));
  for (const a of agents) {
    if (a.status === 'active' && a.id !== GM && !managed.has(a.id)) errors.push({ code: 'NO_MANAGER', agentId: a.id, message: `${a.id} would have no manager.` });
  }

  const reportsAfter = new Set(proposed.map((e) => e.supervisorId));
  const managersBefore = new Set(current.map((e) => e.supervisorId));
  for (const a of agents) {
    if (a.status !== 'active' || reportsAfter.has(a.id)) continue;
    if (managersBefore.has(a.id) || a.role === 'manager') warnings.push({ code: 'MANAGER_WITHOUT_REPORTS', agentId: a.id, message: `${a.id} would manage nobody.` });
  }
  const gmDept = byId.get(GM)?.dept;
  const depts = new Map<string, OrgAgent[]>();
  for (const a of agents) if (a.status === 'active' && a.id !== GM && a.dept !== gmDept) depts.set(a.dept, [...(depts.get(a.dept) ?? []), a]);
  for (const [dept, members] of [...depts].sort(([x], [y]) => x.localeCompare(y))) {
    if (!members.some((m) => up.get(m.id) === GM)) warnings.push({ code: 'DEPT_WITHOUT_HEAD', dept, message: `${dept} would have no head: none of its agents reports to the GM.` });
  }

  const before = new Set(current.map(edge).map(keyOf));
  const after = new Set(proposed.map(keyOf));
  return {
    ok: errors.length === 0, errors, warnings,
    added: proposed.filter((e) => !before.has(keyOf(e))).sort(bySub),
    removed: current.map(edge).filter((e) => !after.has(keyOf(e))).sort(bySub),
  };
}
