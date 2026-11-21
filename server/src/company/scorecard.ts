import type { CompanyScorecardDto, ScorecardRow, ScorecardWindow } from '../../../shared/contracts/src/index.ts';

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
}

export function windowOf(w: ScorecardWindow, now = new Date()) {
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

export function computeScorecard(input: ScoreInput, opt: { window: ScorecardWindow; from: Date; to: Date; includeDemo: boolean }): CompanyScorecardDto {
  const from = opt.from.getTime();
  const to = opt.to.getTime();
  const inWin = (t: number) => t >= from && t <= to;
  const owner = new Map(input.missions.map((m) => [m.id, m.ownerId]));
  const mine = <T extends { missionId: string }>(xs: T[]) => xs.filter((x) => owner.has(x.missionId));

  // first run start per mission
  const firstRun = new Map<string, number>();
  for (const r of mine(input.runs)) {
    const t = r.startedAt.getTime();
    if (!firstRun.has(r.missionId) || t < firstRun.get(r.missionId)!) firstRun.set(r.missionId, t);
  }
  // transitions per mission, ordered by time (stable: event order breaks ties)
  const byMission = new Map<string, ScoreInput['transitions']>();
  for (const e of mine(input.transitions).filter((x) => x.at.getTime() <= to).sort((a, b) => a.at.getTime() - b.at.getTime())) {
    byMission.set(e.missionId, [...(byMission.get(e.missionId) ?? []), e]);
  }

  // ---- started
  const started = [...firstRun.values()].filter(inWin).length;

  // ---- finished (one final moment per mission)
  const done: { id: string; outcome: string; at: number }[] = [];
  for (const [id, es] of byMission) {
    const last = [...es].reverse().find((e) => FINAL.has(e.to) && e.from !== 'archived');
    if (last && inWin(last.at.getTime())) done.push({ id, outcome: last.to, at: last.at.getTime() });
  }
  const count = (o: string) => done.filter((d) => d.outcome === o).length;
  const nCompleted = count('completed'), nFailed = count('failed'), nCanceled = count('canceled');
  const finished = done.length;

  // ---- verified completions
  const tasksOf = new Map<string, ScoreInput['tasks']>();
  for (const t of mine(input.tasks)) tasksOf.set(t.missionId, [...(tasksOf.get(t.missionId) ?? []), t]);
  const verifiesEdge = new Set(mine(input.delegations).filter((d) => d.edgeKind === 'verifies' && !d.simulated).map((d) => d.missionId));
  const decisions = mine(input.decisions);
  const verified = (id: string, at: number) => {
    const ownerId = owner.get(id);
    if (decisions.some((d) => d.missionId === id && d.decision === 'approved' && d.human && d.decidedBy !== ownerId && d.at.getTime() <= at)) return true;
    const ts = tasksOf.get(id) ?? [];
    return ts.length > 0 && ts.every((t) => t.status === 'passed' && !t.simulated) && verifiesEdge.has(id);
  };
  const nVerified = done.filter((d) => d.outcome === 'completed' && verified(d.id, d.at)).length;
  const nUnverified = nCompleted - nVerified;

  // ---- cycle time: first run start → final moment (missions that never ran are left out)
  const cycles = done.filter((d) => firstRun.has(d.id) && firstRun.get(d.id)! <= d.at).map((d) => (d.at - firstRun.get(d.id)!) / HOUR);

  // ---- task recovery: tasks with > 1 attempt, placed in the window by their latest recorded attempt time
  const taskMission = new Map(mine(input.tasks).map((t) => [t.id, t]));
  const att = new Map<string, { n: number; last: number | null }>();
  for (const a of input.attempts) {
    if (!taskMission.has(a.taskId)) continue;
    const x = att.get(a.taskId) ?? { n: 0, last: null };
    x.n++;
    for (const d of [a.startedAt, a.finishedAt]) if (d && (x.last == null || d.getTime() > x.last)) x.last = d.getTime();
    att.set(a.taskId, x);
  }
  const retried = [...att].filter(([, x]) => x.n > 1 && x.last != null && inWin(x.last)).map(([id]) => taskMission.get(id)!);
  const recovered = retried.filter((t) => t.status === 'passed').length;

  // ---- time in waiting_approval: closed intervals that ended in the window
  const waits: number[] = [];
  for (const es of byMission.values()) {
    let open: number | null = null;
    for (const e of es) {
      const t = e.at.getTime();
      if (open != null && e.from === 'waiting_approval') { if (inWin(t)) waits.push((t - open) / HOUR); open = null; }
      if (e.to === 'waiting_approval') open = t;
    }
  }

  const need = (what: string) => `${what} (at least ${MIN_N} needed)`;
  const rate = (key: ScorecardRow['key'], label: string, num: number, den: number, ok: string, none: string): ScorecardRow =>
    den >= MIN_N ? { key, label, value: pct(num, den), unit: '%', n: den, evidence: ok, state: 'ok' } : { key, label, value: null, unit: '%', n: den, evidence: none, state: 'none' };
  const med = (key: ScorecardRow['key'], label: string, xs: number[], ok: (m: number) => string, none: string): ScorecardRow =>
    xs.length >= MIN_N ? { key, label, value: round(median(xs), 2), unit: 'h', n: xs.length, evidence: ok(median(xs)), state: 'ok' } : { key, label, value: null, unit: 'h', n: xs.length, evidence: none, state: 'none' };

  const verifiedSentence = `${nVerified} of ${plural(finished, 'finished mission')} verified · ${nUnverified} completed unverified`;
  const rows: ScorecardRow[] = [
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
  ];
  return { window: opt.window, from: opt.from.toISOString(), to: opt.to.toISOString(), includeDemo: opt.includeDemo, rows };
}
