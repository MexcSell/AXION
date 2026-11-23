import type { CompanyScorecardDto, ScorecardRow, ScorecardWindow, ScorecardTrend, ThroughputDto } from '../../../shared/contracts/src/index.ts';

/**
 * Improvement cycle 2: the company scorecard, computed only from recorded rows (spec §11 invariant 9: every metric shows
 * its observation window and sample size; an unknown value stays unknown). Pure: the route loads the rows of the
 * missions the caller can see and passes them in; rows of any other mission are ignored here as well.
 *
 * Rules (each documented in the report and the `?` help):
 * - A mission's final moment is its LAST transition into completed/failed/canceled at or before `to` that is not a
 *   restore from the archive (restore re-emits the old final state). It is "finished" in the window when that moment is
 *   in [from, to], and its outcome is that transition's `to`. So each mission counts once, even after fail → retry → complete.
 * - A completion is verified when, before it completed, a human other than the owner APPROVED one of its approvals,
 *   or when it has at least one task, every task is real (not simulated) and passed, and it has a real `verifies` delegation.
 * - Windows are inclusive at both ends. Rates and medians need n ≥ 3, otherwise value null and state 'none'.
 */
export const MIN_N = 3;
const DAY = 86_400_000;
const HOUR = 3_600_000;
const FINAL = new Set(['completed', 'failed', 'canceled']);

export interface ScoreInput {
  missions: { id: string; ownerId: string }[];
  runs: { missionId: string; startedAt: Date }[];
  /** mission.stateChanged events (payload from/to), in event order */
  transitions: { missionId: string; from: string; to: string; at: Date }[];
  /** simulated = a DEMO fixture task (not evidence) */
  tasks: { id: string; missionId: string; status: string; simulated?: boolean }[];
  attempts: { taskId: string; attemptNo: number; startedAt: Date | null; finishedAt: Date | null }[];
  decisions: { missionId: string; decision: string; decidedBy: string; human: boolean; at: Date }[];
  delegations: { missionId: string; edgeKind: string; simulated: boolean }[];
  /** improvement cycle 38: independent task reviews (append-only rows), in recorded order */
  reviews?: { taskId: string; missionId: string; verdict: string; reviewerId: string; producerId: string; principalId: string; evidenceCount: number; at: Date; seq: number; stale?: boolean }[];
}

/** `now` is REQUIRED: callers pass the database clock (company/clock.ts `dbWindow`); the application clock is never a window bound. */
export function windowOf(w: ScorecardWindow, now: Date) {
  const days = w === '7d' ? 7 : w === '90d' ? 90 : 30;
  return { window: w, from: new Date(now.getTime() - days * DAY), to: now };
}

const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;
const pct = (a: number, b: number) => round((a / b) * 100, 1);
function median(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const fmtH = (h: number) => `${round(h, 1)} h`;

type BaseRow = Omit<ScorecardRow, 'previous' | 'trend'>;

/**
 * c71 (P6): everything that does not depend on the window, built ONCE per input (the scorecard evaluates two windows, the
 * throughput nine): ownership, first runs, per-mission ordered transitions, per-mission verification facts, the review order, the
 * attempt counts. The old code rebuilt all of it per window and scanned every decision for every completed mission (mission × decision).
 * Same rules, same numbers: test/c71-equivalence.test.ts holds the frozen pre-c71 implementation against this one.
 */
interface Prepared {
  owner: Map<string, string>;
  firstRun: Map<string, number>;
  /** per mission, every transition ordered by time (stable: event order breaks ties); a window keeps the prefix with at <= to */
  byMission: Map<string, { from: string; to: string; t: number }[]>;
  /** per mission: the earliest time of an APPROVED decision by a human other than the owner (cycle 38's approval-based rule), if any */
  firstNonOwnerApproval: Map<string, number>;
  /** missions with at least one task, every task real and passed */
  allReal: Set<string>;
  verifiesEdge: Set<string>;
  reviews: NonNullable<ScoreInput['reviews']>;
  taskStatus: Map<string, string>;
  /** tasks with more than one attempt that have a recorded attempt time: its latest time and whether it ended passed */
  retried: { last: number; passed: boolean }[];
}

function prepare(input: ScoreInput): Prepared {
  const owner = new Map(input.missions.map((m) => [m.id, m.ownerId]));
  const mine = <T extends { missionId: string }>(xs: T[]) => xs.filter((x) => owner.has(x.missionId));

  // first run start per mission
  const firstRun = new Map<string, number>();
  for (const r of mine(input.runs)) {
    const t = r.startedAt.getTime();
    if (!firstRun.has(r.missionId) || t < firstRun.get(r.missionId)!) firstRun.set(r.missionId, t);
  }
  const byMission = new Map<string, { from: string; to: string; t: number }[]>();
  for (const e of mine(input.transitions).map((x) => ({ missionId: x.missionId, from: x.from, to: x.to, t: x.at.getTime() })).sort((a, b) => a.t - b.t)) {
    let es = byMission.get(e.missionId);
    if (!es) byMission.set(e.missionId, (es = []));
    es.push(e);
  }
  const firstNonOwnerApproval = new Map<string, number>();
  for (const d of mine(input.decisions)) {
    if (d.decision !== 'approved' || !d.human || d.decidedBy === owner.get(d.missionId)) continue;
    const t = d.at.getTime();
    if (!firstNonOwnerApproval.has(d.missionId) || t < firstNonOwnerApproval.get(d.missionId)!) firstNonOwnerApproval.set(d.missionId, t);
  }
  const tasks = mine(input.tasks);
  const taskCount = new Map<string, number>(), notReal = new Set<string>();
  for (const t of tasks) {
    taskCount.set(t.missionId, (taskCount.get(t.missionId) ?? 0) + 1);
    if (!(t.status === 'passed' && !t.simulated)) notReal.add(t.missionId);
  }
  const allReal = new Set([...taskCount.keys()].filter((id) => !notReal.has(id)));
  const verifiesEdge = new Set(mine(input.delegations).filter((d) => d.edgeKind === 'verifies' && !d.simulated).map((d) => d.missionId));
  const reviews = mine(input.reviews ?? []).sort((a, b) => a.at.getTime() - b.at.getTime() || a.seq - b.seq);
  const taskStatus = new Map(tasks.map((t) => [t.id, t.status]));
  // task recovery: tasks with > 1 attempt, placed in the window by their latest recorded attempt time (no window filter on the attempts themselves)
  const att = new Map<string, { n: number; last: number | null }>();
  for (const a of input.attempts) {
    if (!taskStatus.has(a.taskId)) continue;
    const x = att.get(a.taskId) ?? { n: 0, last: null };
    x.n++;
    for (const d of [a.startedAt, a.finishedAt]) if (d && (x.last == null || d.getTime() > x.last)) x.last = d.getTime();
    att.set(a.taskId, x);
  }
  const retried = [...att].filter(([, x]) => x.n > 1 && x.last != null).map(([id, x]) => ({ last: x.last!, passed: taskStatus.get(id) === 'passed' }));
  return { owner, firstRun, byMission, firstNonOwnerApproval, allReal, verifiesEdge, reviews, taskStatus, retried };
}

function startedIn(p: Prepared, from: number, to: number) {
  let n = 0;
  for (const t of p.firstRun.values()) if (t >= from && t <= to) n++;
  return n;
}

function computeRows(p: Prepared, optFrom: Date, optTo: Date): BaseRow[] {
  const from = optFrom.getTime();
  const to = optTo.getTime();
  const inWin = (t: number) => t >= from && t <= to;

  // ---- started
  const started = startedIn(p, from, to);

  // ---- finished (one final moment per mission): the LAST final transition at or before `to` that is not a restore
  const done: { id: string; outcome: string; at: number }[] = [];
  const waits: number[] = []; // time in waiting_approval: closed intervals that ended in the window
  for (const [id, all] of p.byMission) {
    let end = all.length;
    while (end > 0 && all[end - 1].t > to) end--;
    for (let i = end - 1; i >= 0; i--) {
      const e = all[i];
      if (FINAL.has(e.to) && e.from !== 'archived') { if (inWin(e.t)) done.push({ id, outcome: e.to, at: e.t }); break; }
    }
    let open: number | null = null;
    for (let i = 0; i < end; i++) {
      const e = all[i];
      if (open != null && e.from === 'waiting_approval') { if (inWin(e.t)) waits.push((e.t - open) / HOUR); open = null; }
      if (e.to === 'waiting_approval') open = e.t;
    }
  }
  const count = (o: string) => done.filter((d) => d.outcome === o).length;
  const nCompleted = count('completed'), nFailed = count('failed'), nCanceled = count('canceled');
  const finished = done.length;

  // ---- verified completions
  const approvedByOther = (id: string, at: number) => (p.firstNonOwnerApproval.get(id) ?? Infinity) <= at;
  const verified = (id: string, at: number) => approvedByOther(id, at) || (p.allReal.has(id) && p.verifiesEdge.has(id));
  const nVerified = done.filter((d) => d.outcome === 'completed' && verified(d.id, d.at)).length;
  const nUnverified = nCompleted - nVerified;
  // cycle 38: the approval-based rule alone, kept as its own row so it never silently changes meaning
  const nApprovedNonOwner = done.filter((d) => d.outcome === 'completed' && approvedByOther(d.id, d.at)).length;

  // ---- cycle 38: a task is verified by review when its LATEST review (as of `to`) is accepted, cites evidence, was written by
  // someone who is neither its producer nor the mission owner (the principal STORED with the review), and the task is still `passed`. The task is placed in the window by that review's time.
  const lastReview = new Map<string, NonNullable<ScoreInput['reviews']>[number]>();
  for (const r of p.reviews) if (r.at.getTime() <= to) lastReview.set(r.taskId, r);
  const reviewed = [...lastReview.values()].filter((r) => inWin(r.at.getTime()));
  const nTaskVerified = reviewed.filter((r) => r.verdict === 'accepted' && r.evidenceCount >= 1 && r.reviewerId !== r.producerId && r.reviewerId !== r.principalId && !r.stale && p.taskStatus.get(r.taskId) === 'passed').length;

  // ---- cycle time: first run start → final moment (missions that never ran are left out)
  const cycles = done.filter((d) => p.firstRun.has(d.id) && p.firstRun.get(d.id)! <= d.at).map((d) => (d.at - p.firstRun.get(d.id)!) / HOUR);

  const retried = p.retried.filter((x) => inWin(x.last));
  const recovered = retried.filter((x) => x.passed).length;

  const need = (what: string) => `${what} (at least ${MIN_N} needed)`;
  const rate = (key: ScorecardRow['key'], label: string, num: number, den: number, ok: string, none: string): BaseRow =>
    den >= MIN_N ? { key, label, value: pct(num, den), unit: '%', n: den, evidence: ok, state: 'ok' } : { key, label, value: null, unit: '%', n: den, evidence: none, state: 'none' };
  const med = (key: ScorecardRow['key'], label: string, xs: number[], ok: (m: number) => string, none: string): BaseRow =>
    xs.length >= MIN_N ? { key, label, value: round(median(xs), 2), unit: 'h', n: xs.length, evidence: ok(median(xs)), state: 'ok' } : { key, label, value: null, unit: 'h', n: xs.length, evidence: none, state: 'none' };

  const verifiedSentence = `${nVerified} of ${plural(finished, 'finished mission')} verified · ${nUnverified} completed unverified`;
  const rows: BaseRow[] = [
    { key: 'started', label: 'Missions started', value: started, unit: 'missions', n: started, state: 'ok',
      evidence: `${plural(started, 'mission')} started a first run in this window` },
    { key: 'finished', label: 'Missions finished', value: finished, unit: 'missions', n: finished, state: 'ok',
      evidence: `${plural(finished, 'mission')} reached a final state: ${nCompleted} completed, ${nFailed} failed, ${nCanceled} canceled` },
    rate('verified_success_rate', 'Verified success', nVerified, finished, verifiedSentence,
      need(verifiedSentence)),
    { key: 'completed_unverified', label: 'Completed, unverified', value: nUnverified, unit: 'missions', n: nCompleted, state: 'ok',
      evidence: `${nUnverified} of ${plural(nCompleted, 'completion')} had no check by someone other than the owner` },
    med('median_cycle_time_h', 'Median cycle time', cycles, (m) => `median ${fmtH(m)} from first run to final state over ${plural(cycles.length, 'finished mission')}`,
      need(`${plural(cycles.length, 'finished mission')} with a recorded run`)),
    rate('failure_rate', 'Failure rate', nFailed + nCanceled, finished, `${nFailed} failed + ${nCanceled} canceled of ${plural(finished, 'finished mission')}`,
      need(`${plural(finished, 'finished mission')}`)),
    rate('task_recovery_rate', 'Task recovery', recovered, retried.length, `${recovered} of ${plural(retried.length, 'retried task')} ended passed`,
      need(`${plural(retried.length, 'task')} with more than one attempt`)),
    med('waiting_approval_median_h', 'Waiting for approval', waits, (m) => `median ${fmtH(m)} over ${plural(waits.length, 'closed approval wait')}`,
      need(`${plural(waits.length, 'closed approval wait')}`)),
    { key: 'approved_by_non_owner', label: 'Approved by a non-owner', value: nApprovedNonOwner, unit: 'missions', n: nCompleted, state: 'ok',
      evidence: `${nApprovedNonOwner} of ${plural(nCompleted, 'completion')} had an approval from a person other than the owner (approval rule only)` },
    { key: 'tasks_verified_by_review', label: 'Tasks verified by review', value: nTaskVerified, unit: 'tasks', n: reviewed.length, state: 'ok',
      evidence: `${nTaskVerified} of ${plural(reviewed.length, 'reviewed task')} accepted with evidence by a reviewer other than the producer and the mission owner (the latest review counts, and only if it is not older than the task's latest attempt)` },
  ];
  return rows;
}

/** Improvement cycle 12 (trend): flat tolerance per unit. A trend is only ever drawn from two measured values. */
const FLAT: Record<ScorecardRow['unit'], number> = { '%': 1, h: 0.1, missions: 0, tasks: 0 };
/**
 * 'up' | 'down' | 'flat', or null whenever either period lacks enough evidence: a value that is null (state 'none'), or a
 * sample size below MIN_N on either side. Flat means within ±1 percentage point (rates), ±0.1 h (times) or equal (counts).
 */
export function trendOf(unit: BaseRow['unit'], cur: { value: number | null; n: number }, prev: { value: number | null; n: number }): ScorecardTrend | null {
  if (cur.value === null || prev.value === null || cur.n < MIN_N || prev.n < MIN_N) return null;
  const d = cur.value - prev.value;
  if (Math.abs(d) <= FLAT[unit] + 1e-9) return 'flat';
  return d > 0 ? 'up' : 'down';
}

export function computeScorecard(input: ScoreInput, opt: { window: ScorecardWindow; from: Date; to: Date; includeDemo: boolean }): CompanyScorecardDto {
  const len = opt.to.getTime() - opt.from.getTime();
  // the previous equal-length window ends 1 ms before this one starts (windows are inclusive, so nothing counts twice)
  const pFrom = new Date(opt.from.getTime() - len - 1), pTo = new Date(opt.from.getTime() - 1);
  const prep = prepare(input);
  const prev = new Map(computeRows(prep, pFrom, pTo).map((r) => [r.key, r]));
  const rows = computeRows(prep, opt.from, opt.to).map((r) => {
    const p = prev.get(r.key)!;
    const previous = { value: p.state === 'ok' ? p.value : null, n: p.n };
    return { ...r, previous, trend: trendOf(r.unit, r, previous) };
  });
  return { window: opt.window, from: opt.from.toISOString(), to: opt.to.toISOString(), includeDemo: opt.includeDemo, previousFrom: pFrom.toISOString(), previousTo: pTo.toISOString(), rows };
}

export const THROUGHPUT_WEEKS_MAX = 26;
/** Weekly counts (no ratios): missions started and finished in each of the last `weeks` weeks ending at `to`, oldest first.
 *  Started = first run in the week. Finished = each mission once, by its LAST terminal transition as of `to` (not a restore
 *  from the archive), placed in the week of that transition (so fail → retry → complete counts once, in the completion week,
 *  and the last week equals the 7-day scorecard's finished count). */
export function computeThroughput(input: ScoreInput, opt: { weeks: number; to: Date; includeDemo: boolean }): ThroughputDto {
  const to = opt.to.getTime();
  const prep = prepare(input);
  const ids = new Set(input.missions.map((m) => m.id));
  const lastFinal = new Map<string, number>(); // same rule as computeRows: the last final transition that is not a restore
  for (const e of input.transitions.filter((x) => ids.has(x.missionId) && x.at.getTime() <= to).sort((a, b) => a.at.getTime() - b.at.getTime())) {
    if (FINAL.has(e.to) && e.from !== 'archived') lastFinal.set(e.missionId, e.at.getTime());
  }
  const out: ThroughputDto['weeks'] = [];
  for (let k = opt.weeks - 1; k >= 0; k--) {
    const wTo = to - k * 7 * DAY;
    const wFrom = wTo - 7 * DAY + 1;
    const started = startedIn(prep, wFrom, wTo);
    const finished = [...lastFinal.values()].filter((t) => t >= wFrom && t <= wTo).length;
    out.push({ from: new Date(wFrom).toISOString(), to: new Date(wTo).toISOString(), started, finished });
  }
  return { weeks: out, includeDemo: opt.includeDemo, to: opt.to.toISOString() };
}
