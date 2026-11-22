import type { OrgContractCheck, OrgIssue } from '../../../shared/contracts/src/index.ts';
import { DEFAULT_MAX_ESCALATION_LEVELS } from '../config.ts';
import { modelFamily } from '../tasks/review-rules.ts';
import { GM, type EdgeIn, type OrgAgent } from './validate.ts';

/**
 * c64 (R3-6) item 2: the contracts a restructure must keep. Pure (no database); composed into the dry run in proposals.ts, NOT into
 * validateOrg (agents/org.ts calls that one for every revision writer, hires and the seed included; these checks gate proposals).
 * A6 is the only support for "gate a restructure on contracts", and it gives no numbers: the two rules here are our own.
 *
 *  - REVIEWER_PER_TEAM (TEAM_REVIEWERS). A team is a manager and everyone who reports to that manager. A team whose members change
 *    must keep at least two members able to review: an active agent whose model family c38 can name (an agent of an unknown family
 *    can neither review nor be reviewed by an agent, which is the fail-closed rule of the independent-review check). Two, so that
 *    whoever produced the work still has a possible reviewer in the team. Teams the proposal does not change are not checked, so an
 *    old weak team does not block an unrelated change. Whether a team spans two model families is NOT checked (the seeded company
 *    is almost all one family); see the report.
 *  - ESCALATION_WITHIN_LEVELS (ESCALATION_TOO_DEEP). Every active agent's chain of managers reaches the GM within N levels (the GM
 *    is level 0). "Reaches the GM at all, with no loop and no dangling chain" is already checked by NO_MANAGER, NOT_UNDER_GM and CYCLE
 *    (limit 64) and is not counted as new here; N (operator setting, default 6) is the tighter, new bound.
 *  - NOT built: "the output contract of each role is unchanged". The organisation model has no output-contract field to compare.
 */
export interface GuardAgent extends OrgAgent { model?: string | null }
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** manager -> active/inactive members (sorted) from lines; a second line for one subordinate is ignored (validateOrg reports it). */
function teams(edges: EdgeIn[], byId: Map<string, GuardAgent>): Map<string, string[]> {
  const seen = new Set<string>();
  const out = new Map<string, string[]>();
  for (const e of edges) {
    if (e.supervisorId === e.subordinateId || seen.has(e.subordinateId)) continue;
    seen.add(e.subordinateId);
    if (!byId.has(e.supervisorId) || !byId.has(e.subordinateId)) continue;
    out.set(e.supervisorId, [...(out.get(e.supervisorId) ?? []), e.subordinateId]);
  }
  for (const [m, rs] of out) out.set(m, rs.sort(cmp));
  return out;
}
const able = (a: GuardAgent | undefined) => !!a && a.status === 'active' && modelFamily(a.model) !== null;

export function contractChecks(edges: EdgeIn[], agents: GuardAgent[], current: EdgeIn[], opts: { maxEscalationLevels?: number } = {}): { checks: OrgContractCheck[]; errors: OrgIssue[] } {
  const max = opts.maxEscalationLevels && opts.maxEscalationLevels > 0 ? opts.maxEscalationLevels : DEFAULT_MAX_ESCALATION_LEVELS;
  const byId = new Map(agents.map((a) => [a.id, a]));
  const errors: OrgIssue[] = [];

  // ---- a reviewer in every changed team
  const after = teams(edges, byId);
  const before = teams(current, byId);
  const reviewerReasons: string[] = [];
  for (const [manager, reports] of [...after].sort(([x], [y]) => cmp(x, y))) {
    const b = before.get(manager);
    if (b && b.length === reports.length && b.every((x, i) => x === reports[i])) continue; // not changed
    const members = [manager, ...reports];
    const ok = members.filter((id) => able(byId.get(id)));
    if (ok.length >= 2) continue;
    const msg = `The team of ${manager} (${members.join(', ')}) would have ${ok.length === 0 ? 'no member' : 'only ' + ok[0]} able to review: a reviewer must be an active agent with a known model family, and a team needs two so the producer of a task always has another reviewer.`;
    reviewerReasons.push(msg);
    errors.push({ code: 'TEAM_REVIEWERS', agentId: manager, message: msg });
  }

  // ---- every chain reaches the GM within N levels
  const up = new Map<string, string>();
  for (const e of edges) if (e.supervisorId !== e.subordinateId && !up.has(e.subordinateId)) up.set(e.subordinateId, e.supervisorId);
  const levels = new Map<string, number>(); // agent -> levels below the GM (only chains that reach the GM)
  const levelOf = (id: string): number | null => {
    if (id === GM) return 0;
    if (levels.has(id)) return levels.get(id)!;
    const seen = new Set<string>([id]);
    let cur = id; let n = 0;
    while (up.has(cur)) {
      cur = up.get(cur)!; n++;
      if (cur === GM) { levels.set(id, n); return n; }
      if (seen.has(cur) || n > 1000) return null; // a loop: reported by the old dry run
      seen.add(cur);
    }
    return null; // dangling: reported by the old dry run
  };
  const depthReasons: string[] = [];
  for (const a of [...agents].sort((x, y) => cmp(x.id, y.id))) {
    if (a.status !== 'active' || a.id === GM) continue;
    const n = levelOf(a.id);
    if (n === null || n <= max) continue;
    const parent = up.get(a.id)!;
    const pn = levelOf(parent);
    if (pn !== null && pn > max) continue; // report only the first agent over the limit on each chain
    const msg = `${a.id} would be ${n} levels below the GM, more than the limit of ${max}: an escalation would pass through ${n - 1} managers.`;
    depthReasons.push(msg);
    errors.push({ code: 'ESCALATION_TOO_DEEP', agentId: a.id, message: msg });
  }

  return {
    errors,
    checks: [
      { code: 'REVIEWER_PER_TEAM', title: 'Every changed team keeps two members able to review', ok: reviewerReasons.length === 0, reasons: reviewerReasons },
      { code: 'ESCALATION_WITHIN_LEVELS', title: `Every chain of managers reaches the GM within ${max} levels`, ok: depthReasons.length === 0, reasons: depthReasons },
    ],
  };
}
