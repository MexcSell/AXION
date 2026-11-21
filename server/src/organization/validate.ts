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
 * Errors (block approval): an unknown agent, a retired agent as a manager, the GM as a subordinate, self-management,
 * a line listed twice, more than one manager, a reporting cycle (seen-set walk, limit 64; once per loop), an active
 * agent other than the GM without a manager, and an active chain that does not end at the GM (one tree under the GM).
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

  const retired = new Set<string>();
  for (const e of proposed) { const s = byId.get(e.supervisorId); if (s && s.status !== 'active') retired.add(s.id); }
  for (const id of [...retired].sort()) errors.push({ code: 'RETIRED_MANAGER', agentId: id, message: `${id} is retired and cannot manage anyone.` });
  if (proposed.some((e) => e.subordinateId === GM)) errors.push({ code: 'GM_HAS_MANAGER', agentId: GM, message: 'The GM is the top of the company and cannot report to anyone.' });

  const up = new Map<string, string>();
  const multi = new Set<string>();
  const dup = new Set<string>();
  const lines = new Set<string>();
  for (const e of proposed) {
    if (e.supervisorId === e.subordinateId) { errors.push({ code: 'SELF_MANAGED', agentId: e.subordinateId, message: `${e.subordinateId} cannot manage itself.` }); continue; }
    if (lines.has(keyOf(e))) { dup.add(e.subordinateId); continue; }
    lines.add(keyOf(e));
    if (up.has(e.subordinateId)) { multi.add(e.subordinateId); continue; }
    up.set(e.subordinateId, e.supervisorId);
  }
  for (const id of dup) errors.push({ code: 'DUPLICATE_LINE', agentId: id, message: `The line to ${id} is listed twice.` });
  for (const id of multi) errors.push({ code: 'MULTIPLE_MANAGERS', agentId: id, message: `${id} would have more than one manager.` });

  // each loop is reported once (naming its members), however many chains run into it; a chain deeper than the limit once
  const looped = new Set<string>();
  const reported = new Set<string>();
  for (const start of [...up.keys()].sort()) {
    if (looped.has(start)) continue;
    const path = [start];
    const seen = new Set<string>([start]);
    let cur = up.get(start);
    for (let depth = 0; cur !== undefined; depth++) {
      if (seen.has(cur) || depth >= CHAIN_LIMIT) {
        const deep = !seen.has(cur);
        const loop = deep ? [] : path.slice(path.indexOf(cur));
        const k = deep ? 'deep' : [...loop].sort().join('|');
        if (!reported.has(k)) {
          reported.add(k);
          errors.push(deep
            ? { code: 'CYCLE', agentId: start, message: `The reporting chain above ${start} is deeper than ${CHAIN_LIMIT} levels.` }
            : { code: 'CYCLE', agentId: [...loop].sort()[0], message: `These reporting lines form a loop: ${loop.join(' → ')} → ${loop[0]} (→ = reports to).` });
        }
        path.forEach((x) => looped.add(x));
        break;
      }
      seen.add(cur);
      path.push(cur);
      cur = up.get(cur);
    }
  }

  const managed = new Set(proposed.filter((e) => e.supervisorId !== e.subordinateId).map((e) => e.subordinateId));
  for (const a of agents) {
    if (a.status === 'active' && a.id !== GM && !managed.has(a.id)) errors.push({ code: 'NO_MANAGER', agentId: a.id, message: `${a.id} would have no manager.` });
  }

  // one tree under the GM: every active agent's chain (outside loops) must end at the GM; reported once per detached top
  const detached = new Map<string, string[]>();
  for (const a of [...agents].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))) {
    if (a.status !== 'active' || a.id === GM || looped.has(a.id) || !up.has(a.id)) continue;
    let cur = a.id;
    for (let depth = 0; up.has(cur) && cur !== GM && depth <= CHAIN_LIMIT; depth++) cur = up.get(cur)!;
    if (cur !== GM && !up.has(cur)) detached.set(cur, [...(detached.get(cur) ?? []), a.id]);
  }
  for (const [top, members] of detached) {
    const list = members.filter((m) => m !== top);
    errors.push({ code: 'NOT_UNDER_GM', agentId: top, message: `${list.join(', ')} ${list.length === 1 ? 'is' : 'are'} not under the GM: the chain ends at ${top}.` });
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

/**
 * Improvement cycle 4: before/after diff of two sets of reporting lines (pure). A line is keyed by its subordinate (each
 * agent has one manager per revision: org_edges' primary key is (revision_id, subordinate_id)). moved = in both with
 * another manager; added = only after; removed = only before. Sorted by subordinate.
 */
export function diffLines(before: EdgeIn[], after: EdgeIn[]): { added: OrgEdgeDto[]; removed: OrgEdgeDto[]; moved: { subordinate: string; from: string; to: string }[] } {
  const b = new Map(before.map(edge).map((e) => [e.subordinateId, e]));
  const a = new Map(after.map(edge).map((e) => [e.subordinateId, e]));
  const moved: { subordinate: string; from: string; to: string }[] = [];
  for (const [sub, e] of a) { const o = b.get(sub); if (o && o.supervisorId !== e.supervisorId) moved.push({ subordinate: sub, from: o.supervisorId, to: e.supervisorId }); }
  const bySubordinate = (x: { subordinate: string }, y: { subordinate: string }) => (x.subordinate < y.subordinate ? -1 : x.subordinate > y.subordinate ? 1 : 0);
  return {
    added: [...a.values()].filter((e) => !b.has(e.subordinateId)).sort(bySub),
    removed: [...b.values()].filter((e) => !a.has(e.subordinateId)).sort(bySub),
    moved: moved.sort(bySubordinate),
  };
}
