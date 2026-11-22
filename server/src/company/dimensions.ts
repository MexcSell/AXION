import { DIMENSION_KEYS, DIMENSION_LABEL, stallCheck, FAILURE_MODE_IDS, type CompanyDimensionsDto, type DimensionCell, type DimensionKey, type DimensionRowDto, type DimensionWindow, type ProgressBody } from '../../../shared/contracts/src/index.ts';
import { MIN_N, trendOf, windowOf } from './scorecard.ts';
import { outcomesOf, type DeptRows } from './departments.ts';

/**
 * Improvement cycle 46: the six dimensions of organizational intelligence (spec §16.1) as a PURE read model. The route loads
 * the rows the caller may see and passes them in; nothing here reads a clock, a table or the network.
 *
 * Hard rules (each repeated in the `?` help and the report):
 * - No composite: a dimension is a list of independent cells (value, n, window, evidence, trend). No sum, no mean across cells.
 * - One predicate for every cell: n >= cell.minN gives a value, otherwise value null, state 'none' and evidence that starts with
 *   "not enough evidence (n = k)". minN is MIN_N (3) everywhere except task outcomes, which use agent reliability's 5.
 * - Simulated and DEMO rows are dropped HERE (every row type carries its own flag), not only in the loader.
 * - Mission-scoped rows count only for missions in `missions` (the loader passes the caller's visible missions only).
 * - A previous value is computed by the same function over the previous equal window (window cells) or as of the previous end
 *   date (snapshot cells). The trend is null unless both sides have a value.
 *
 * Department key of each indicator (a department filter keeps only rows whose key is in the department):
 *   task owner:   first-attempt verified reviews, passed-first-time, environment-tagged failures
 *   to-agent:     briefed delegations
 *   agent:        playbook items, lessons, version promotions, rollbacks
 *   mission:      stalled missions, cross-family reviews' mission, approval decision time, site grants. A mission belongs to a
 *                 department when a real (not simulated) agent instance of that department is on it.
 *   subordinate:  org revisions (a revision counts for a department when it added, removed or re-pointed a line of one of its members)
 */
const DAY = 86_400_000;
const MIN_OUTCOMES = 5; // the same sample floor as agent reliability (MIN_EVIDENCE)

/**
 * The reviewed map from MAST failure modes to the dimension they speak about (AXION's own reading of the frozen taxonomy
 * mast-arxiv-2503.13657v3; the paper does not assign dimensions). Only the environment-type modes feed a cell today.
 * FM-1.4 and FM-2.1 are the two modes that describe a run losing its context (history lost, conversation reset), which in
 * AXION is caused by platform limits and restarts, not by the plan or the verification. Every mode is mapped exactly once.
 */
export const FAILURE_MODE_DIMENSION: Readonly<Record<string, DimensionKey>> = Object.freeze({
  'FM-1.1': 'cognitive', 'FM-1.2': 'collective', 'FM-1.3': 'cognitive', 'FM-1.4': 'environmental', 'FM-1.5': 'cognitive',
  'FM-2.1': 'environmental', 'FM-2.2': 'collective', 'FM-2.3': 'cognitive', 'FM-2.4': 'collective', 'FM-2.5': 'collective', 'FM-2.6': 'cognitive',
  'FM-3.1': 'cognitive', 'FM-3.2': 'cognitive', 'FM-3.3': 'cognitive',
});
export const ENVIRONMENT_MODES: readonly string[] = FAILURE_MODE_IDS.filter((m) => FAILURE_MODE_DIMENSION[m] === 'environmental');

type Task = DeptRows['tasks'][number];
export interface DimInput {
  /** may see lessons under review and site grants (administrators); others get 'none' cells for those, never counts */
  admin: boolean;
  agents: { id: string; dept: string; role: string; active: boolean }[];
  /** the missions the caller can see (the loader applies the scorecard's predicate) */
  missions: { id: string; demo: boolean }[];
  instances: { missionId: string; agentId: string; simulated: boolean }[];
  tasks: Task[];
  reviews: { taskId: string; missionId: string; reviewerId: string; reviewerKind: 'user' | 'agent'; reviewerFamily: string | null; producerId: string; producerKind: 'user' | 'agent'; producerFamily: string | null; principalId: string; verdict: string; evidenceCount: number; at: Date; seq: number; simulated: boolean }[];
  /** progress ledger versions, any order */
  ledgers: { missionId: string; version: number; body: Pick<ProgressBody, 'satisfied' | 'looping' | 'progressing'>; at: Date; demo: boolean }[];
  approvals: { missionId: string; createdAt: Date; decidedAt: Date | null; demo: boolean }[];
  /** edge_kind 'delegated' */
  delegations: { missionId: string; toInstance: string; toAgent: string; at: Date; simulated: boolean }[];
  briefs: { missionId: string; toInstance: string; simulated: boolean }[];
  grants: { missionId: string; issuedAt: Date; expiresAt: Date; revokedAt: Date | null }[];
  /** CONFIRMED failure tags on tasks */
  tags: { taskId: string; modeId: string; at: Date }[];
  lessons: { agentId: string; status: string; createdAt: Date; decidedAt: Date | null; acceptedInVersion: number | null; withdrawnInVersion: number | null }[];
  playbooks: { agentId: string; version: number; items: number; at: Date }[];
  promotions: { agentId: string; at: Date }[];
  rollbacks: { agentId: string; at: Date }[];
  orgRevisions: { seq: number; at: Date }[];
  orgChanges: { seq: number; at: Date; subordinateId: string }[];
}

interface Measure { value: number | null; n: number; evidence: string; basis: DimensionCell['basis'] }
interface Spec { key: string; label: string; unit: DimensionCell['unit']; minN: number }
const round1 = (x: number) => Math.round(x * 10) / 10;
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/** The unmeasured cells have no source yet; they are real cells (n = 0, state none) so no consumer special-cases them. */
const UNMEASURED = 'unmeasured' as const;

interface Ctx {
  from: number; to: number;
  inWin: (t: Date | null | undefined) => boolean;
  live: Set<string>;                 // visible, non-DEMO missions
  scope: (missionId: string) => boolean; // live and (no department, or the mission belongs to it)
  dept: string | null;
  agentIn: (agentId: string | null | undefined) => boolean;
  deptOfAgent: Map<string, string>;
}

function build(input: DimInput, dept: string | null, from: Date, to: Date) {
  const deptOfAgent = new Map(input.agents.map((a) => [a.id, a.dept]));
  const live = new Set(input.missions.filter((m) => !m.demo).map((m) => m.id));
  const deptMissions = new Set<string>();
  for (const i of input.instances) if (!i.simulated && dept && deptOfAgent.get(i.agentId) === dept) deptMissions.add(i.missionId);
  const f = from.getTime(), t = to.getTime();
  return {
    from: f, to: t, dept, deptOfAgent, live,
    inWin: (d: Date | null | undefined) => !!d && d.getTime() >= f && d.getTime() <= t,
    scope: (id: string) => live.has(id) && (!dept || deptMissions.has(id)),
    agentIn: (id: string | null | undefined) => !!id && (!dept || deptOfAgent.get(id) === dept),
  } satisfies Ctx;
}

type Measurer = (input: DimInput, c: Ctx) => Measure;
const rate = (num: number, den: number, ok: (n: number, d: number) => string, minN: number, what: string): Measure => den >= minN
  ? { value: round1((num / den) * 100), n: den, evidence: ok(num, den), basis: 'window' }
  : { value: null, n: den, evidence: `not enough evidence (n = ${den}): ${what} (at least ${minN} needed)`, basis: 'window' };
const count = (n: number, ok: string, what: string, basis: Measure['basis'] = 'window'): Measure => n >= MIN_N
  ? { value: n, n, evidence: ok, basis }
  : { value: null, n, evidence: `not enough evidence (n = ${n}): ${what} (at least ${MIN_N} needed)`, basis };

/** Tasks that are real (not simulated), as a map; reviews/tags/outcomes resolve the owner's department through it. */
const realTasks = (input: DimInput) => new Map(input.tasks.filter((t) => !t.simulated).map((t) => [t.id, t]));

const SPECS: { dim: DimensionKey; spec: Spec; measure: Measurer | typeof UNMEASURED; reason?: string }[] = [
  // ---------------------------------------------------------------- Cognitive
  { dim: 'cognitive', spec: { key: 'cognitive.first_attempt_verified', label: 'Verified on first attempt', unit: '%', minN: MIN_N }, measure: (input, c) => {
    const tasks = realTasks(input);
    const last = new Map<string, DimInput['reviews'][number]>();
    for (const r of [...input.reviews].filter((x) => !x.simulated && c.live.has(x.missionId) && x.at.getTime() <= c.to).sort((a, b) => a.at.getTime() - b.at.getTime() || a.seq - b.seq)) last.set(r.taskId, r);
    const rows = [...last.values()].filter((r) => c.inWin(r.at)).filter((r) => {
      const t = tasks.get(r.taskId);
      return !!t && t.attempts.length <= 1 && (!c.dept || c.agentIn(t.owner));
    });
    const ok = rows.filter((r) => r.verdict === 'accepted' && r.evidenceCount >= 1 && r.reviewerId !== r.producerId && r.reviewerId !== r.principalId && tasks.get(r.taskId)!.status === 'passed').length;
    return rate(ok, rows.length, (a, b) => `${a} of ${plural(b, 'reviewed task')} that needed one attempt had an accepted review with evidence from someone other than the producer and the mission owner`, MIN_N, `${plural(rows.length, 'reviewed first-attempt task')}`);
  } },
  { dim: 'cognitive', spec: { key: 'cognitive.stalled_missions', label: 'Missions with a flagged stall', unit: '%', minN: MIN_N }, measure: (input, c) => {
    const by = new Map<string, DimInput['ledgers']>();
    for (const l of input.ledgers) if (!l.demo && c.scope(l.missionId) && l.at.getTime() <= c.to) by.set(l.missionId, [...(by.get(l.missionId) ?? []), l]);
    let n = 0, stalled = 0;
    for (const hist of by.values()) {
      const h = [...hist].sort((a, b) => a.version - b.version);
      const idxInWin = h.map((x, i) => (c.inWin(x.at) ? i : -1)).filter((i) => i >= 0);
      if (!idxInWin.length) continue;
      n++;
      if (idxInWin.some((i) => stallCheck(h.slice(0, i + 1).map((x) => x.body)).stalled)) stalled++;
    }
    return rate(stalled, n, (a, b) => `${a} of ${plural(b, 'mission')} with a progress ledger entry in the window had a stall flagged (3 entries without progress, or 2 looping in a row)`, MIN_N, `${plural(n, 'mission')} with a progress ledger entry`);
  } },
  // ---------------------------------------------------------------- Capability
  { dim: 'capability', spec: { key: 'capability.playbook_items', label: 'Playbook items in force', unit: 'count', minN: MIN_N }, measure: (input, c) => {
    const agents = input.agents.filter((a) => a.active && c.agentIn(a.id));
    const latest = new Map<string, number>();
    const seen = new Map<string, number>();
    for (const p of input.playbooks) if (p.at.getTime() <= c.to && p.version > (seen.get(p.agentId) ?? 0)) { seen.set(p.agentId, p.version); latest.set(p.agentId, p.items); }
    const per = new Map<string, number>();
    let total = 0;
    for (const a of agents) { const k = latest.get(a.id) ?? 0; total += k; per.set(a.role, (per.get(a.role) ?? 0) + k); }
    const roles = [...per].sort(([x], [y]) => (x < y ? -1 : 1)).map(([r, k]) => `${r} ${k}`).join(', ');
    const n = agents.length;
    return n >= MIN_N
      ? { value: total, n, basis: 'snapshot', evidence: `${plural(total, 'accepted lesson')} in force in the latest playbooks of ${plural(n, 'active agent')} as of the end date; per role: ${roles || 'none'}` }
      : { value: null, n, basis: 'snapshot', evidence: `not enough evidence (n = ${n}): ${plural(n, 'active agent')} in this scope (at least ${MIN_N} needed)` };
  } },
  { dim: 'capability', spec: { key: 'capability.first_pass', label: 'Tasks passed first time', unit: '%', minN: MIN_OUTCOMES }, measure: (input, c) => {
    let pass = 0, n = 0;
    for (const t of input.tasks) {
      if (t.simulated || (t.status !== 'passed' && t.status !== 'failed') || !t.finishedAt || !c.inWin(t.finishedAt)) continue;
      for (const o of outcomesOf(t)) {
        if (!c.agentIn(o.agent)) continue;
        n++;
        if (o.result === 'passed' && !o.retried) pass++;
      }
    }
    return rate(pass, n, (a, b) => `${a} of ${plural(b, 'task outcome')} passed with one attempt and no hand-over (each outcome is charged to the agent that owned the task)`, MIN_OUTCOMES, `${plural(n, 'task outcome')}`);
  } },
  { dim: 'capability', spec: { key: 'capability.site_grants', label: 'Site grants active', unit: 'count', minN: MIN_N }, measure: (input, c) => {
    if (!input.admin) return { value: null, n: 0, basis: 'snapshot', evidence: 'not enough evidence (n = 0): site grants are visible to administrators only' };
    const g = input.grants.filter((x) => c.scope(x.missionId) && c.inWin(x.issuedAt));
    const revoked = g.filter((x) => x.revokedAt && x.revokedAt.getTime() <= c.to).length;
    const expired = g.filter((x) => !(x.revokedAt && x.revokedAt.getTime() <= c.to) && x.expiresAt.getTime() <= c.to).length;
    const active = g.length - revoked - expired;
    const sentence = `${active} active, ${expired} expired, ${revoked} revoked of ${plural(g.length, 'site grant')} issued in the window (a count, not a score)`;
    return g.length >= MIN_N
      ? { value: active, n: g.length, basis: 'window', evidence: sentence }
      : { value: null, n: g.length, basis: 'window', evidence: `not enough evidence (n = ${g.length}): ${plural(g.length, 'site grant')} issued in the window (at least ${MIN_N} needed)` };
  } },
  // ---------------------------------------------------------------- Environmental
  { dim: 'environmental', spec: { key: 'environmental.env_tagged', label: 'Tagged failures of environment type', unit: '%', minN: MIN_N }, measure: (input, c) => {
    const tagsBy = new Map<string, string[]>();
    for (const g of input.tags) if (g.at.getTime() <= c.to) tagsBy.set(g.taskId, [...(tagsBy.get(g.taskId) ?? []), g.modeId]);
    let n = 0, env = 0;
    for (const t of input.tasks) {
      if (t.simulated || (t.status !== 'passed' && t.status !== 'failed') || !t.finishedAt || !c.inWin(t.finishedAt)) continue;
      const bad = outcomesOf(t).some((o) => c.agentIn(o.agent) && (o.result === 'failed' || o.retried));
      const modes = tagsBy.get(t.id);
      if (!bad || !modes) continue;
      n++;
      if (modes.some((m) => ENVIRONMENT_MODES.includes(m))) env++;
    }
    return rate(env, n, (a, b) => `${a} of ${plural(b, 'failed or retried task')} with a confirmed failure tag carry an environment-type tag (${ENVIRONMENT_MODES.join(', ')}); untagged failures are not counted`, MIN_N, `${plural(n, 'failed or retried task')} with a confirmed failure tag`);
  } },
  { dim: 'environmental', spec: { key: 'environmental.site_navigation', label: 'Website navigation outcomes', unit: '%', minN: MIN_N }, measure: UNMEASURED, reason: 'not measured until Stage 7: no browser run exists to record navigation outcomes' },
  { dim: 'environmental', spec: { key: 'environmental.model_availability', label: 'Model availability incidents', unit: 'count', minN: MIN_N }, measure: UNMEASURED, reason: 'not measured until Stage 7: no model calls are made yet, so no outage can be recorded' },
  // ---------------------------------------------------------------- Collective
  { dim: 'collective', spec: { key: 'collective.briefed_delegations', label: 'Delegations with a brief', unit: '%', minN: MIN_N }, measure: (input, c) => {
    const briefed = new Set(input.briefs.filter((b) => !b.simulated && c.live.has(b.missionId)).map((b) => `${b.missionId}|${b.toInstance}`));
    const d = input.delegations.filter((x) => !x.simulated && c.live.has(x.missionId) && c.inWin(x.at) && c.agentIn(x.toAgent));
    const ok = d.filter((x) => briefed.has(`${x.missionId}|${x.toInstance}`)).length;
    return rate(ok, d.length, (a, b) => `${a} of ${plural(b, 'delegation')} in the window were to an agent that holds a typed delegation brief on that mission`, MIN_N, `${plural(d.length, 'delegation')}`);
  } },
  { dim: 'collective', spec: { key: 'collective.cross_family_reviews', label: 'Agent reviews across model families', unit: '%', minN: MIN_N }, measure: (input, c) => {
    const tasks = realTasks(input);
    const rs = input.reviews.filter((r) => !r.simulated && c.live.has(r.missionId) && c.inWin(r.at) && (!c.dept || c.agentIn(tasks.get(r.taskId)?.owner)));
    const cross = rs.filter((r) => r.reviewerKind === 'agent' && r.producerKind === 'agent' && !!r.reviewerFamily && !!r.producerFamily && r.reviewerFamily !== r.producerFamily).length;
    const people = rs.filter((r) => r.reviewerKind === 'user').length;
    return rate(cross, rs.length, (a, b) => `${a} of ${plural(b, 'review')} were agent-on-agent across different model families (the server refuses same-family agent reviews); ${people} were written by a person`, MIN_N, `${plural(rs.length, 'review')}`);
  } },
  { dim: 'collective', spec: { key: 'collective.approval_decision_h', label: 'Median approval decision time', unit: 'h', minN: MIN_N }, measure: (input, c) => {
    const xs = input.approvals.filter((a) => !a.demo && c.scope(a.missionId) && c.inWin(a.decidedAt)).map((a) => (a.decidedAt!.getTime() - a.createdAt.getTime()) / 3_600_000);
    return xs.length >= MIN_N
      ? { value: Math.round(median(xs) * 100) / 100, n: xs.length, basis: 'window', evidence: `median ${round1(median(xs))} h from request to decision over ${plural(xs.length, 'decided approval')}` }
      : { value: null, n: xs.length, basis: 'window', evidence: `not enough evidence (n = ${xs.length}): ${plural(xs.length, 'decided approval')} in the window (at least ${MIN_N} needed)` };
  } },
  // ---------------------------------------------------------------- Knowledge
  { dim: 'knowledge', spec: { key: 'knowledge.lessons_proposed', label: 'Lessons proposed', unit: 'count', minN: MIN_N }, measure: (input, c) => {
    if (!input.admin) return { value: null, n: 0, basis: 'window', evidence: 'not enough evidence (n = 0): lessons under review are visible to administrators and their authors only' };
    const n = input.lessons.filter((l) => c.agentIn(l.agentId) && c.inWin(l.createdAt)).length;
    return count(n, `${plural(n, 'lesson')} proposed in the window`, `${plural(n, 'lesson')} proposed`);
  } },
  { dim: 'knowledge', spec: { key: 'knowledge.lessons_accepted', label: 'Lessons accepted', unit: '%', minN: MIN_N }, measure: (input, c) => {
    if (!input.admin) return { value: null, n: 0, basis: 'window', evidence: 'not enough evidence (n = 0): lessons under review are visible to administrators and their authors only' };
    // decided by a person: accepted (now or since rolled back) or rejected; a duplicate closed by the system is not a decision
    const d = input.lessons.filter((l) => c.agentIn(l.agentId) && c.inWin(l.decidedAt) && (l.acceptedInVersion !== null || l.status === 'rejected'));
    const ok = d.filter((l) => l.acceptedInVersion !== null).length;
    return rate(ok, d.length, (a, b) => `${a} of ${plural(b, 'decided lesson')} were accepted (the rest rejected)`, MIN_N, `${plural(d.length, 'decided lesson')}`);
  } },
  { dim: 'knowledge', spec: { key: 'knowledge.lessons_rolled_back', label: 'Accepted lessons rolled back', unit: '%', minN: MIN_N }, measure: (input, c) => {
    if (!input.admin) return { value: null, n: 0, basis: 'window', evidence: 'not enough evidence (n = 0): lessons under review are visible to administrators and their authors only' };
    const d = input.lessons.filter((l) => c.agentIn(l.agentId) && c.inWin(l.decidedAt) && l.acceptedInVersion !== null);
    const back = d.filter((l) => l.withdrawnInVersion !== null).length;
    return rate(back, d.length, (a, b) => `${a} of ${plural(b, 'lesson')} accepted in the window have since been withdrawn by a playbook rollback (status as recorded now)`, MIN_N, `${plural(d.length, 'accepted lesson')}`);
  } },
  // ---------------------------------------------------------------- Evolutionary
  { dim: 'evolutionary', spec: { key: 'evolutionary.promotions', label: 'Version proposals promoted', unit: 'count', minN: MIN_N }, measure: (input, c) => {
    const n = input.promotions.filter((p) => c.agentIn(p.agentId) && c.inWin(p.at)).length;
    return count(n, `${plural(n, 'version proposal')} promoted by a second administrator in the window`, `${plural(n, 'promotion')}`);
  } },
  { dim: 'evolutionary', spec: { key: 'evolutionary.rollbacks', label: 'Agent versions rolled back', unit: 'count', minN: MIN_N }, measure: (input, c) => {
    const n = input.rollbacks.filter((p) => c.agentIn(p.agentId) && c.inWin(p.at)).length;
    return count(n, `${plural(n, 'rollback')} of an agent to an earlier configuration in the window`, `${plural(n, 'rollback')}`);
  } },
  { dim: 'evolutionary', spec: { key: 'evolutionary.verdict_outcomes', label: 'Evaluation verdicts (win / inconclusive / loss)', unit: 'count', minN: MIN_N }, measure: UNMEASURED, reason: 'not measured yet: evaluation verdicts are computed on demand and not stored, so there is nothing to count (cycle 47 records eval evidence)' },
  { dim: 'evolutionary', spec: { key: 'evolutionary.org_revisions', label: 'Org revisions applied', unit: 'count', minN: MIN_N }, measure: (input, c) => {
    const first = input.orgRevisions.reduce((m, r) => Math.min(m, r.seq), Infinity); // the first revision is the starting chart, not an applied change
    const seqs = c.dept
      ? new Set(input.orgChanges.filter((x) => x.seq > first && c.inWin(x.at) && c.deptOfAgent.get(x.subordinateId) === c.dept).map((x) => x.seq))
      : new Set(input.orgRevisions.filter((r) => r.seq > first && c.inWin(r.at)).map((r) => r.seq));
    return count(seqs.size, `${plural(seqs.size, 'org revision')} applied in the window${c.dept ? ' that changed a reporting line of this department' : ''}`, `${plural(seqs.size, 'org revision')}`);
  } },
];

const FLAT_UNIT = { '%': '%', h: 'h', count: 'tasks' } as const;
const iso = (d: Date) => d.toISOString();

function measureAt(input: DimInput, dept: string | null, from: Date, to: Date) {
  const c = build(input, dept, from, to);
  return SPECS.map((s) => (s.measure === UNMEASURED
    ? { value: null, n: 0, basis: 'none' as const, evidence: `not enough evidence (n = 0): ${s.reason}` }
    : s.measure(input, c)));
}

export function computeDimensions(input: DimInput, opt: { window: DimensionWindow; from: Date; to: Date; department: string | null }): CompanyDimensionsDto {
  const len = opt.to.getTime() - opt.from.getTime();
  // the previous equal window ends 1 ms before this one starts (the scorecard's rule: windows are inclusive, nothing counts twice)
  const pFrom = new Date(opt.from.getTime() - len - 1), pTo = new Date(opt.from.getTime() - 1);
  const cur = measureAt(input, opt.department, opt.from, opt.to);
  const prev = measureAt(input, opt.department, pFrom, pTo);
  const cells = SPECS.map((s, i): { dim: DimensionKey; cell: DimensionCell } => {
    const m = cur[i], p = prev[i];
    const previous = { value: s.measure === UNMEASURED ? null : p.value, n: p.n };
    return { dim: s.dim, cell: {
      key: s.spec.key, label: s.spec.label, value: m.value, unit: s.spec.unit, n: m.n, minN: s.spec.minN, basis: m.basis,
      from: m.basis === 'none' ? null : iso(m.basis === 'snapshot' ? opt.to : opt.from), to: m.basis === 'none' ? null : iso(opt.to),
      evidence: m.evidence, state: m.value === null ? 'none' : 'ok', previous,
      trend: trendOf(FLAT_UNIT[s.spec.unit], { value: m.value, n: m.n }, previous),
    } };
  });
  const dimensions: DimensionRowDto[] = DIMENSION_KEYS.map((k) => ({ key: k, label: DIMENSION_LABEL[k], cells: cells.filter((x) => x.dim === k).map((x) => x.cell) }));
  const departments = [...new Set(input.agents.filter((a) => a.active).map((a) => a.dept))].sort();
  return { window: opt.window, from: iso(opt.from), to: iso(opt.to), previousFrom: iso(pFrom), previousTo: iso(pTo), department: opt.department, departments, dimensions };
}

export { windowOf };
export const DIMENSION_DAY = DAY;
