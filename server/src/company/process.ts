import { PROCESS_KEYS, CHURN_MIN_TASKS, type ProcessCell, type ProcessDto, type ProcessWindow } from '../../../shared/contracts/src/index.ts';
import { MIN_N, trendOf } from './scorecard.ts';

/**
 * Improvement cycle 69 (R3-5): process metrics, a PURE read model (no clock, no table, no network). The route loads the rows the caller
 * may see and passes them in. The definitions are this brief's own (the research pages they came from are unverified):
 *
 * - Return-for-rework rate: among tasks whose FIRST review decision falls in the window, the share returned (changes requested or rejected)
 *   on it. The cause of each return is a confirmed failure tag mode known at the window end (one mode; "several failure modes" when
 *   there are more), else "criterion failed, no tag" when the review marked a rubric criterion failed, else "no recorded cause".
 *   Open tasks (finished or verifying, no review yet as of the end) are reported beside it and are never in the denominator.
 * - First-pass acceptance: among tasks with at least one review in the window, the share whose FIRST review ever is accepted, was written against
 *   attempt 1, and is not stale (c51 freshness: a later attempt exists, so the acceptance no longer stands). A task accepted only after a return is not first-pass.
 * - Duplicate delegation: current (not superseded) delegation briefs in the window whose goal, trimmed, lower-cased and with runs of white
 *   space collapsed, equals that of another brief of the same mission in the window. Count and share, with n.
 * - Reassign churn: per task first assigned in the window, the number of changes of owning agent up to the window end, from the append-only
 *   owner history (a row with the same agent, such as an instance change, is not a change; a row with no agent is skipped). Median and p90
 *   (nearest rank), null below CHURN_MIN_TASKS tasks.
 * - Handoff wait: for each delegation to a task made in the window, hours until the first attempt of that task started (computed by the
 *   database, DB time only). A delegation whose task has no started attempt is open: counted beside, never in the median.
 * - Approval time to decision (c58's stored `approval_decisions.latency_ms`, written in SQL from the database clock when the person decides; never recomputed
 *   from timestamps here): median and 90th percentile (nearest rank) in hours over the approvals decided in the window, on live missions, in the department of
 *   the requesting agent. Null below APPROVAL_MIN_N (20, the same floor as c58's and c65's percentiles). A decision with no stored latency is not counted.
 * - Cost is an unmeasured cell until Stage 9.
 * A department keeps the rows of its own agents: tasks follow their current owner, delegations follow the receiving agent.
 * Simulated and DEMO rows are dropped here. No composite, no "good" threshold.
 */
export interface ProcInput {
  agents: { id: string; dept: string; active: boolean }[];
  /** the missions the caller can see (the loader applies the scorecard's predicate) */
  missions: { id: string; demo: boolean }[];
  tasks: { id: string; missionId: string; owner: string | null; status: string; simulated: boolean }[];
  /** every review of the visible missions, any order */
  reviews: { taskId: string; missionId: string; verdict: string; at: Date; seq: number; stale: boolean; failedCriteria: number;
    /** attempt_no of the attempt the review was written against (null when none is recorded) */
    attemptNo: number | null; simulated: boolean }[];
  /** CONFIRMED failure tags on tasks */
  tags: { taskId: string; modeId: string; at: Date }[];
  briefs: { id: string; missionId: string; toAgent: string; goal: string | null; at: Date; supersedesId: string | null; simulated: boolean }[];
  /** task_owner_history rows (append-only, c51) */
  ownerHistory: { taskId: string; agentId: string | null; at: Date; seq: number }[];
  /** delegations to a task; waitSeconds comes from SQL (first attempt start minus delegation time), null = no attempt has started */
  handoffs: { missionId: string; taskId: string; toAgent: string; at: Date; waitSeconds: number | null; simulated: boolean }[];
  /** decided approvals with c58's stored decision latency (milliseconds, written by the database when the decision was recorded); demo requests are excluded by the loader */
  approvals: { missionId: string; agentId: string; decidedAt: Date; latencyMs: number }[];
}
/** Percentiles of the approval time are null below this many decisions (the floor c58 and c65 use). */
export const APPROVAL_MIN_N = 20;

const round1 = (x: number) => Math.round(x * 10) / 10;
const round2 = (x: number) => Math.round(x * 100) / 100;
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
/** nearest-rank percentile: the ceil(p * n)-th smallest */
export const nearestRank = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.max(0, Math.ceil(p * s.length) - 1)]; };
const normGoal = (g: string) => g.trim().toLowerCase().replace(/\s+/g, ' ');

interface Measure { value: number | null; n: number | null; evidence: string; state?: 'unmeasured'; open?: { n: number; what: string } | null; p90?: number | null; breakdown?: { label: string; n: number }[] }
interface Spec { key: (typeof PROCESS_KEYS)[number]; label: string; unit: ProcessCell['unit']; minN: number; measure: (i: ProcInput, c: Ctx) => Measure }
interface Ctx { from: number; to: number; inWin: (d: Date) => boolean; live: Set<string>; deptOfAgent: Map<string, string>; agentIn: (a: string | null | undefined) => boolean }

const none = (n: number, what: string, minN: number): Measure => ({ value: null, n, evidence: `not enough evidence (n = ${n}): ${what} (at least ${minN} needed)` });

/** Real tasks of live (visible, non-DEMO) missions in the department. */
function realTasks(i: ProcInput, c: Ctx) {
  return new Map(i.tasks.filter((t) => !t.simulated && c.live.has(t.missionId) && (c.agentIn(t.owner) )).map((t) => [t.id, t]));
}
/** The reviews of those tasks as of the window end, oldest first. */
function reviewsOf(i: ProcInput, c: Ctx, tasks: Map<string, ProcInput['tasks'][number]>) {
  const by = new Map<string, ProcInput['reviews']>();
  for (const r of [...i.reviews].filter((x) => !x.simulated && tasks.has(x.taskId) && x.at.getTime() <= c.to).sort((a, b) => a.at.getTime() - b.at.getTime() || a.seq - b.seq)) by.set(r.taskId, [...(by.get(r.taskId) ?? []), r]);
  return by;
}
/** Finished or verifying, and no review as of the end. Open "now": a snapshot, not a window count. */
function openTasks(tasks: Map<string, ProcInput['tasks'][number]>, reviewed: Map<string, unknown>) {
  return [...tasks.values()].filter((t) => (t.status === 'passed' || t.status === 'verifying') && !reviewed.has(t.id)).length;
}

const SPECS: Spec[] = [
  { key: 'rework_rate', label: 'Returned for rework', unit: '%', minN: MIN_N, measure: (i, c) => {
    const tasks = realTasks(i, c);
    const by = reviewsOf(i, c, tasks);
    const open = { n: openTasks(tasks, by), what: 'finished or verifying with no review yet' };
    const first = [...by.values()].map((rs) => rs[0]).filter((r) => c.inWin(r.at));
    const returned = first.filter((r) => r.verdict !== 'accepted');
    const modes = new Map<string, Set<string>>();
    for (const g of i.tags) if (g.at.getTime() <= c.to) modes.set(g.taskId, new Set([...(modes.get(g.taskId) ?? []), g.modeId]));
    const causes = new Map<string, number>();
    for (const r of returned) {
      const m = modes.get(r.taskId);
      const cause = m && m.size === 1 ? [...m][0] : m && m.size > 1 ? 'several failure modes' : r.failedCriteria > 0 ? 'criterion failed, no tag' : 'no recorded cause';
      causes.set(cause, (causes.get(cause) ?? 0) + 1);
    }
    const breakdown = [...causes].map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n || (a.label < b.label ? -1 : 1));
    const tail = open.n ? `; ${plural(open.n, 'task')} finished or in verification ${open.n === 1 ? 'has' : 'have'} no review yet and ${open.n === 1 ? 'is' : 'are'} not counted` : '';
    if (first.length < MIN_N) return { ...none(first.length, `${plural(first.length, 'task')} whose first review fell in the window`, MIN_N), open, breakdown };
    return { value: round1((returned.length / first.length) * 100), n: first.length, open, breakdown,
      evidence: `${returned.length} of ${plural(first.length, 'task')} whose first review fell in the window were returned (changes requested or rejected) on that first review${tail}` };
  } },
  { key: 'first_pass_acceptance', label: 'Accepted first time', unit: '%', minN: MIN_N, measure: (i, c) => {
    const tasks = realTasks(i, c);
    const by = reviewsOf(i, c, tasks);
    const open = { n: openTasks(tasks, by), what: 'finished or verifying with no review yet' };
    const cohort = [...by.values()].filter((rs) => rs.some((r) => c.inWin(r.at)));
    const ok = cohort.filter((rs) => rs[0].verdict === 'accepted' && !rs[0].stale && rs[0].attemptNo === 1).length;
    const tail = open.n ? `; ${plural(open.n, 'task')} with no review yet ${open.n === 1 ? 'is' : 'are'} not counted` : '';
    if (cohort.length < MIN_N) return { ...none(cohort.length, `${plural(cohort.length, 'task')} with a review in the window`, MIN_N), open };
    return { value: round1((ok / cohort.length) * 100), n: cohort.length, open,
      evidence: `${ok} of ${plural(cohort.length, 'task')} with a review in the window were accepted on attempt 1 at their first review and that acceptance still stands (a stale one does not count)${tail}` };
  } },
  { key: 'duplicate_delegation', label: 'Duplicate delegations', unit: '%', minN: MIN_N, measure: (i, c) => {
    const superseded = new Set(i.briefs.filter((b) => b.supersedesId && b.at.getTime() <= c.to).map((b) => b.supersedesId!));
    const bs = i.briefs.filter((b) => !b.simulated && c.live.has(b.missionId) && c.inWin(b.at) && c.agentIn(b.toAgent) && !superseded.has(b.id) && b.goal !== null && normGoal(b.goal) !== '');
    const groups = new Map<string, number>();
    for (const b of bs) { const k = `${b.missionId}\u0000${normGoal(b.goal!)}`; groups.set(k, (groups.get(k) ?? 0) + 1); }
    const dup = [...groups.values()].filter((g) => g >= 2);
    const count = dup.reduce((s, g) => s + g, 0);
    if (bs.length < MIN_N) return { ...none(bs.length, `${plural(bs.length, 'delegation')} with a goal in the window`, MIN_N), open: null };
    return { value: round1((count / bs.length) * 100), n: bs.length, open: null,
      evidence: `${count} of ${plural(bs.length, 'delegation')} in the window share their goal (ignoring case and spacing) with another delegation of the same mission, in ${plural(dup.length, 'repeated goal')}; a revised brief replaces its earlier version` };
  } },
  { key: 'reassign_churn', label: 'Reassign churn', unit: 'count', minN: CHURN_MIN_TASKS, measure: (i, c) => {
    const tasks = realTasks(i, c);
    const hist = new Map<string, ProcInput['ownerHistory']>();
    for (const h of [...i.ownerHistory].filter((x) => tasks.has(x.taskId) && x.agentId !== null && x.at.getTime() <= c.to).sort((a, b) => a.at.getTime() - b.at.getTime() || a.seq - b.seq)) hist.set(h.taskId, [...(hist.get(h.taskId) ?? []), h]);
    const changes: number[] = [];
    for (const hs of hist.values()) {
      if (!c.inWin(hs[0].at)) continue; // cohort: tasks first assigned in the window
      let k = 0;
      for (let x = 1; x < hs.length; x++) if (hs[x].agentId !== hs[x - 1].agentId) k++;
      changes.push(k);
    }
    if (changes.length < CHURN_MIN_TASKS) return { ...none(changes.length, `${plural(changes.length, 'task')} first assigned in the window`, CHURN_MIN_TASKS), open: null, p90: null };
    const p90 = nearestRank(changes, 0.9), med = median(changes);
    return { value: med, p90, n: changes.length, open: null,
      evidence: `median ${med} and 90th percentile ${p90} owner changes after the first assignment, over ${plural(changes.length, 'task')} first assigned in the window (changes counted up to the end of the window)` };
  } },
  { key: 'handoff_wait_h', label: 'Wait on a hand-off', unit: 'h', minN: MIN_N, measure: (i, c) => {
    const hs = i.handoffs.filter((h) => !h.simulated && c.live.has(h.missionId) && c.inWin(h.at) && c.agentIn(h.toAgent));
    const waits = hs.filter((h) => h.waitSeconds !== null).map((h) => h.waitSeconds! / 3600);
    const open = { n: hs.length - waits.length, what: 'delegated, no attempt started yet' };
    const tail = open.n ? `; ${plural(open.n, 'delegation')} ${open.n === 1 ? 'has' : 'have'} no started attempt yet and ${open.n === 1 ? 'is' : 'are'} not in the median` : '';
    if (waits.length < MIN_N) return { ...none(waits.length, `${plural(waits.length, 'delegation')} whose task has started`, MIN_N), open, p90: null };
    const med = round2(median(waits)), p90 = round2(nearestRank(waits, 0.9));
    return { value: med, p90, n: waits.length, open,
      evidence: `median ${round1(med)} h and 90th percentile ${round1(p90)} h from a delegation to the first started attempt of its task, over ${plural(waits.length, 'delegation')} made in the window (database time)${tail}` };
  } },
  { key: 'approval_decision_h', label: 'Approval wait', unit: 'h', minN: APPROVAL_MIN_N, measure: (i, c) => {
    const hs = i.approvals.filter((a) => c.live.has(a.missionId) && c.inWin(a.decidedAt) && c.agentIn(a.agentId)).map((a) => a.latencyMs / 3_600_000);
    if (hs.length < APPROVAL_MIN_N) return { ...none(hs.length, `${plural(hs.length, 'approval')} decided in the window with a stored decision time`, APPROVAL_MIN_N), open: null, p90: null };
    const med = round2(median(hs)), p90 = round2(nearestRank(hs, 0.9));
    return { value: med, p90, n: hs.length, open: null,
      evidence: `median ${round1(med)} h and 90th percentile ${round1(p90)} h from a request to its decision (the decision time stored when the person decided), over ${plural(hs.length, 'approval')} decided in the window` };
  } },
  { key: 'cost', label: 'Cost', unit: 'count', minN: MIN_N,
    measure: () => ({ value: null, n: null, state: 'unmeasured', evidence: 'not measured until Stage 9 (the usage ledger): nothing records what work cost yet, so there is no number' }) },
];

const FLAT_UNIT = { '%': '%', h: 'h', count: 'tasks' } as const;
const iso = (d: Date) => d.toISOString();

function build(input: ProcInput, dept: string | null, from: Date, to: Date): Ctx {
  const deptOfAgent = new Map(input.agents.map((a) => [a.id, a.dept]));
  return {
    from: from.getTime(), to: to.getTime(), deptOfAgent,
    live: new Set(input.missions.filter((m) => !m.demo).map((m) => m.id)),
    inWin: (d) => d.getTime() >= from.getTime() && d.getTime() <= to.getTime(),
    agentIn: (a) => !dept || (!!a && deptOfAgent.get(a) === dept),
  };
}

export function computeProcess(input: ProcInput, opt: { window: ProcessWindow; from: Date; to: Date; department: string | null }): ProcessDto {
  const len = opt.to.getTime() - opt.from.getTime();
  // the previous equal window ends 1 ms before this one starts (the scorecard's rule: inclusive windows, nothing counted twice)
  const pFrom = new Date(opt.from.getTime() - len - 1), pTo = new Date(opt.from.getTime() - 1);
  const cc = build(input, opt.department, opt.from, opt.to), pc = build(input, opt.department, pFrom, pTo);
  const cells = SPECS.map((s): ProcessCell => {
    const m = s.measure(input, cc);
    const p = m.state ? null : s.measure(input, pc);
    const previous = { value: p ? p.value : null, n: p?.n ?? 0 };
    const unmeasured = m.state === 'unmeasured';
    return {
      key: `process.${s.key}`, label: s.label, value: m.value, unit: s.unit, n: m.n, minN: s.minN,
      from: unmeasured ? null : iso(opt.from), to: unmeasured ? null : iso(opt.to), evidence: m.evidence,
      state: m.state ?? (m.value === null ? 'none' : 'ok'), previous,
      trend: unmeasured ? null : trendOf(FLAT_UNIT[s.unit], { value: m.value, n: m.n ?? 0 }, previous),
      open: m.open ?? null, p90: m.p90 ?? null, breakdown: m.breakdown ?? [],
    };
  });
  const departments = [...new Set(input.agents.filter((a) => a.active).map((a) => a.dept))].sort();
  return { window: opt.window, from: iso(opt.from), to: iso(opt.to), previousFrom: iso(pFrom), previousTo: iso(pTo), department: opt.department, departments, cells };
}
