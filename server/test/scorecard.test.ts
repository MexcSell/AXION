import { describe, it, expect } from 'vitest';
import { computeScorecard, windowOf, type ScoreInput } from '../src/company/scorecard.ts';

// Improvement cycle 2 (brief web/docs/improve/cycles/c02-brief.md): the pure scorecard function, row by row.
const NOW = new Date('2026-11-21T12:00:00Z');
const H = 3_600_000;
const D = 24 * H;
const at = (msAgo: number) => new Date(NOW.getTime() - msAgo);
const W30 = windowOf('30d', NOW);

const empty = (): ScoreInput => ({ missions: [], runs: [], transitions: [], tasks: [], attempts: [], decisions: [], delegations: [] });
const row = (input: ScoreInput, key: string, w = W30) => {
  const r = computeScorecard(input, { window: w.window, from: w.from, to: w.to, includeDemo: false }).rows.find((x) => x.key === key);
  if (!r) throw new Error('no row ' + key);
  return r;
};

/** A mission owned by `owner`, first run `runAgo` ago, then each [to, msAgo] transition in order (from = previous state). */
function mission(s: ScoreInput, id: string, runAgo: number | null, steps: [string, number][], owner = 'u-owner') {
  s.missions.push({ id, ownerId: owner });
  if (runAgo != null) s.runs.push({ missionId: id, startedAt: at(runAgo) });
  let from = 'running';
  for (const [to, ago] of steps) { s.transitions.push({ missionId: id, from, to, at: at(ago) }); from = to; }
}

describe('windows', () => {
  it('30d is the default size; 7d and 90d too', () => {
    expect(W30.to.getTime() - W30.from.getTime()).toBe(30 * D);
    expect(windowOf('7d', NOW).to.getTime() - windowOf('7d', NOW).from.getTime()).toBe(7 * D);
    expect(windowOf('90d', NOW).to.getTime() - windowOf('90d', NOW).from.getTime()).toBe(90 * D);
  });
  it('the response carries the window, its ISO bounds and includeDemo', () => {
    const out = computeScorecard(empty(), { window: '7d', from: windowOf('7d', NOW).from, to: NOW, includeDemo: true });
    expect(out).toMatchObject({ window: '7d', to: NOW.toISOString(), from: new Date(NOW.getTime() - 7 * D).toISOString(), includeDemo: true });
    expect(out.rows.map((r) => r.key)).toEqual(['started', 'finished', 'verified_success_rate', 'completed_unverified', 'median_cycle_time_h', 'failure_rate', 'task_recovery_rate', 'waiting_approval_median_h', 'approved_by_non_owner', 'tasks_verified_by_review']);
  });
});

describe('no evidence', () => {
  it('an empty history: counts are 0 (measured), every rate and median is null with state none', () => {
    const s = empty();
    for (const k of ['started', 'finished', 'completed_unverified']) expect(row(s, k)).toMatchObject({ value: 0, n: 0, state: 'ok' });
    for (const k of ['verified_success_rate', 'median_cycle_time_h', 'failure_rate', 'task_recovery_rate', 'waiting_approval_median_h']) {
      const r = row(s, k);
      expect(r).toMatchObject({ value: null, n: 0, state: 'none' });
      expect(r.evidence.length).toBeGreaterThan(10);
    }
  });
});

describe('started', () => {
  it('counts missions whose FIRST run started in the window (boundary included, a run before the window excludes it)', () => {
    const s = empty();
    mission(s, 'M-1', 1 * D, []);
    mission(s, 'M-2', 30 * D, []); // exactly at `from`
    mission(s, 'M-3', 30 * D + 1, []); // 1 ms before the window
    s.runs.push({ missionId: 'M-3', startedAt: at(2 * D) }); // a later run (resume) doesn't make it "started" again
    mission(s, 'M-4', null, []); // never ran
    expect(row(s, 'started')).toMatchObject({ value: 2, n: 2, state: 'ok', unit: 'missions' });
  });
});

describe('finished, failure rate, cycle time', () => {
  it('finished counts each mission once, by its last final state; a restore from the archive is not a new finish', () => {
    const s = empty();
    mission(s, 'M-1', 10 * D, [['failed', 9 * D], ['retry_queued', 8 * D], ['running', 8 * D], ['verifying', 7 * D], ['completed', 6 * D]]);
    mission(s, 'M-2', 10 * D, [['canceled', 5 * D], ['archived', 4 * D]]);
    s.transitions.push({ missionId: 'M-2', from: 'archived', to: 'canceled', at: at(1 * D) }); // restore
    mission(s, 'M-3', 40 * D, [['failed', 31 * D]]); // before the window
    const f = row(s, 'finished');
    expect(f).toMatchObject({ value: 2, n: 2, state: 'ok' });
    expect(f.evidence).toContain('1 completed');
    expect(f.evidence).toContain('1 canceled');
  });

  it('a final state exactly at `from` counts; 1 ms earlier does not', () => {
    const s = empty();
    mission(s, 'M-1', 40 * D, [['canceled', 30 * D]]);
    mission(s, 'M-2', 40 * D, [['canceled', 30 * D + 1]]);
    expect(row(s, 'finished').value).toBe(1);
  });

  it('the `to` end: an event exactly at `to` counts; 1 ms after `to` does not (fix round m4)', () => {
    const s = empty();
    const w = { window: '30d' as const, from: at(30 * D), to: at(1 * D) }; // a window that ends before now
    mission(s, 'M-1', 40 * D, [['canceled', 1 * D]]); // exactly at `to`
    mission(s, 'M-2', 40 * D, [['canceled', 1 * D - 1]]); // 1 ms after `to`
    mission(s, 'M-3', 1 * D - 1, []); // first run 1 ms after `to`
    mission(s, 'M-4', 2 * D, [['verifying', 2 * D], ['completed', 1 * D - 1]]); // ran inside the window, completed 1 ms after `to`: started, not finished
    expect(row(s, 'finished', w)).toMatchObject({ value: 1 });
    expect(row(s, 'started', w)).toMatchObject({ value: 1 }); // M-4 only (M-1 and M-2 ran before `from`)
    expect(row(s, 'completed_unverified', w)).toMatchObject({ value: 0, n: 0 });
  });

  it('failure rate = (failed + canceled) / finished; null below 3 finished', () => {
    const s = empty();
    mission(s, 'M-1', 3 * D, [['failed', 2 * D]]);
    mission(s, 'M-2', 3 * D, [['canceled', 2 * D]]);
    expect(row(s, 'failure_rate')).toMatchObject({ value: null, n: 2, state: 'none' });
    mission(s, 'M-3', 3 * D, [['verifying', 2 * D], ['completed', 1 * D]]);
    mission(s, 'M-4', 3 * D, [['verifying', 2 * D], ['completed', 1 * D]]);
    expect(row(s, 'failure_rate')).toMatchObject({ value: 50, n: 4, state: 'ok', unit: '%' });
  });

  it('median cycle time: first run start → final state, in hours; only finished missions with a run; null below 3', () => {
    const s = empty();
    mission(s, 'M-1', 10 * H, [['canceled', 8 * H]]); // 2 h
    mission(s, 'M-2', 10 * H, [['canceled', 6 * H]]); // 4 h
    mission(s, 'M-3', null, [['canceled', 1 * H]]); // canceled in planning: finished, but no run → not in the cycle sample
    expect(row(s, 'median_cycle_time_h')).toMatchObject({ value: null, n: 2, state: 'none' });
    mission(s, 'M-4', 40 * D, [['canceled', 1 * H]]); // its run started before the window: still counts (the finish is in the window)
    const r = row(s, 'median_cycle_time_h');
    expect(r).toMatchObject({ n: 3, state: 'ok', unit: 'h' });
    expect(r.value).toBe(4);
    mission(s, 'M-5', 10 * H, [['canceled', 9 * H]]); // 1 h → median of 1, 2, 4, 959 = 3
    expect(row(s, 'median_cycle_time_h').value).toBe(3);
  });
});

describe('verified vs unverified', () => {
  const four = () => {
    const s = empty();
    for (const id of ['M-1', 'M-2', 'M-3', 'M-4']) mission(s, id, 5 * D, [['verifying', 3 * D], ['completed', 2 * D]]);
    return s;
  };
  it('a completion is unverified without a check by someone else', () => {
    const s = four();
    const r = row(s, 'verified_success_rate');
    expect(r).toMatchObject({ value: 0, n: 4, state: 'ok' });
    expect(r.evidence).toBe('0 of 4 finished missions verified · 4 completed unverified');
    expect(row(s, 'completed_unverified')).toMatchObject({ value: 4, n: 4, state: 'ok' });
  });
  it('an approval by a human other than the owner verifies; by the owner, by a non-human or after the completion does not', () => {
    const s = four();
    s.decisions.push({ missionId: 'M-1', decision: 'approved', decidedBy: 'u-other', human: true, at: at(4 * D) });
    s.decisions.push({ missionId: 'M-2', decision: 'approved', decidedBy: 'u-owner', human: true, at: at(4 * D) });
    s.decisions.push({ missionId: 'M-3', decision: 'approved', decidedBy: 'system', human: false, at: at(4 * D) });
    s.decisions.push({ missionId: 'M-4', decision: 'approved', decidedBy: 'u-other', human: true, at: at(1 * D) }); // after it completed
    expect(row(s, 'verified_success_rate')).toMatchObject({ value: 25, n: 4, evidence: '1 of 4 finished missions verified · 3 completed unverified' });
    expect(row(s, 'completed_unverified').value).toBe(3);
  });
  it('a denied decision is not a verification', () => {
    const s = four();
    s.decisions.push({ missionId: 'M-1', decision: 'denied', decidedBy: 'u-other', human: true, at: at(4 * D) });
    expect(row(s, 'verified_success_rate').value).toBe(0);
  });
  it('every task passed + a (real) verifies delegation verifies; a missing delegation, an open task, no tasks or a simulated delegation does not', () => {
    const s = four();
    // M-1: all passed + verifies → verified
    s.tasks.push({ id: 'T-1', missionId: 'M-1', status: 'passed' }, { id: 'T-2', missionId: 'M-1', status: 'passed' });
    s.delegations.push({ missionId: 'M-1', edgeKind: 'verifies', simulated: false });
    // M-2: all passed but only a delegated edge
    s.tasks.push({ id: 'T-3', missionId: 'M-2', status: 'passed' });
    s.delegations.push({ missionId: 'M-2', edgeKind: 'delegated', simulated: false });
    // M-3: a verifies edge but one task failed; M-4: a verifies edge but no tasks at all
    s.tasks.push({ id: 'T-4', missionId: 'M-3', status: 'passed' }, { id: 'T-5', missionId: 'M-3', status: 'failed' });
    s.delegations.push({ missionId: 'M-3', edgeKind: 'verifies', simulated: false }, { missionId: 'M-4', edgeKind: 'verifies', simulated: false });
    expect(row(s, 'verified_success_rate')).toMatchObject({ value: 25, evidence: '1 of 4 finished missions verified · 3 completed unverified' });
    s.delegations[0] = { missionId: 'M-1', edgeKind: 'verifies', simulated: true };
    expect(row(s, 'verified_success_rate').value).toBe(0);
  });
  it('simulated tasks are not evidence: all passed but simulated + a real verifies delegation does not verify (fix round m6)', () => {
    const s = four();
    s.tasks.push({ id: 'T-1', missionId: 'M-1', status: 'passed', simulated: true }, { id: 'T-2', missionId: 'M-1', status: 'passed', simulated: true });
    s.delegations.push({ missionId: 'M-1', edgeKind: 'verifies', simulated: false });
    expect(row(s, 'verified_success_rate').value).toBe(0);
    s.tasks[1] = { id: 'T-2', missionId: 'M-1', status: 'passed', simulated: false }; // one real, one simulated: still not
    expect(row(s, 'verified_success_rate').value).toBe(0);
    s.tasks[0] = { id: 'T-1', missionId: 'M-1', status: 'passed', simulated: false };
    expect(row(s, 'verified_success_rate').value).toBe(25);
  });
  it('the rate divides by every finished mission (failed and canceled too); null below 3 finished', () => {
    const s = empty();
    mission(s, 'M-1', 5 * D, [['verifying', 3 * D], ['completed', 2 * D]]);
    s.decisions.push({ missionId: 'M-1', decision: 'approved', decidedBy: 'u-other', human: true, at: at(4 * D) });
    mission(s, 'M-2', 5 * D, [['canceled', 2 * D]]);
    const r = row(s, 'verified_success_rate');
    expect(r).toMatchObject({ value: null, n: 2, state: 'none' });
    expect(r.evidence).toContain('1 of 2 finished missions verified');
    mission(s, 'M-3', 5 * D, [['failed', 2 * D]]);
    expect(row(s, 'verified_success_rate')).toMatchObject({ value: 33.3, n: 3, state: 'ok', unit: '%' });
  });
});

describe('task recovery', () => {
  it('tasks with more than one attempt that ended passed ÷ tasks with more than one attempt; window on the latest attempt time', () => {
    const s = empty();
    s.missions.push({ id: 'M-1', ownerId: 'u-owner' });
    const attempts = (taskId: string, n: number, lastAgo: number) => {
      for (let i = 1; i <= n; i++) s.attempts.push({ taskId, attemptNo: i, startedAt: at(lastAgo + (n - i) * H + H), finishedAt: i < n ? at(lastAgo + (n - i) * H) : null });
    };
    s.tasks.push({ id: 'T-1', missionId: 'M-1', status: 'passed' }); attempts('T-1', 2, 1 * D);
    s.tasks.push({ id: 'T-2', missionId: 'M-1', status: 'retry_ready' }); attempts('T-2', 2, 1 * D);
    s.tasks.push({ id: 'T-3', missionId: 'M-1', status: 'passed' }); attempts('T-3', 1, 1 * D); // one attempt: not in the sample
    expect(row(s, 'task_recovery_rate')).toMatchObject({ value: null, n: 2, state: 'none' });
    s.tasks.push({ id: 'T-4', missionId: 'M-1', status: 'passed' }); attempts('T-4', 3, 2 * D);
    s.tasks.push({ id: 'T-5', missionId: 'M-1', status: 'passed' }); attempts('T-5', 2, 40 * D); // outside the window
    const r = row(s, 'task_recovery_rate');
    expect(r).toMatchObject({ value: 66.7, n: 3, state: 'ok', unit: '%' });
    expect(r.evidence).toContain('2 of 3');
  });
  it('a retry whose new attempt has not started yet (started_at null) still places the task by the earlier attempt', () => {
    const s = empty();
    s.missions.push({ id: 'M-1', ownerId: 'u-owner' });
    for (const id of ['T-1', 'T-2', 'T-3']) {
      s.tasks.push({ id, missionId: 'M-1', status: 'retry_ready' });
      s.attempts.push({ taskId: id, attemptNo: 1, startedAt: at(3 * D), finishedAt: at(2 * D) }, { taskId: id, attemptNo: 2, startedAt: null, finishedAt: null });
    }
    expect(row(s, 'task_recovery_rate')).toMatchObject({ value: 0, n: 3, state: 'ok' });
  });
});

describe('time waiting for approval', () => {
  it('median of closed waiting_approval intervals that ended in the window; pause ends an interval; open intervals do not count', () => {
    const s = empty();
    mission(s, 'M-1', 5 * D, [['waiting_approval', 10 * H], ['running', 8 * H]]); // 2 h
    mission(s, 'M-2', 5 * D, [['waiting_approval', 10 * H], ['paused', 4 * H]]); // 6 h, ended by a pause
    mission(s, 'M-3', 5 * D, [['waiting_approval', 3 * H]]); // still waiting
    expect(row(s, 'waiting_approval_median_h')).toMatchObject({ value: null, n: 2, state: 'none' });
    s.transitions.push({ missionId: 'M-2', from: 'paused', to: 'waiting_approval', at: at(3 * H) }, { missionId: 'M-2', from: 'waiting_approval', to: 'running', at: at(2 * H) }); // +1 h
    const r = row(s, 'waiting_approval_median_h');
    expect(r).toMatchObject({ value: 2, n: 3, state: 'ok', unit: 'h' });
  });
  it('an interval that ended before the window does not count', () => {
    const s = empty();
    for (const id of ['M-1', 'M-2', 'M-3']) mission(s, id, 50 * D, [['waiting_approval', 40 * D], ['running', 31 * D]]);
    expect(row(s, 'waiting_approval_median_h')).toMatchObject({ value: null, n: 0 });
  });
});

describe('only the missions it is given', () => {
  it('transitions, tasks, decisions and delegations of missions outside the input set are ignored', () => {
    const s = empty();
    mission(s, 'M-1', 5 * D, [['canceled', 1 * D]]);
    // rows of a mission that is not in s.missions (e.g. not visible): never counted
    s.runs.push({ missionId: 'M-X', startedAt: at(2 * D) });
    s.transitions.push({ missionId: 'M-X', from: 'verifying', to: 'completed', at: at(1 * D) });
    s.tasks.push({ id: 'T-X', missionId: 'M-X', status: 'passed' });
    s.attempts.push({ taskId: 'T-X', attemptNo: 1, startedAt: at(2 * D), finishedAt: at(2 * D) }, { taskId: 'T-X', attemptNo: 2, startedAt: at(1 * D), finishedAt: at(1 * D) });
    expect(row(s, 'started').value).toBe(1);
    expect(row(s, 'finished').value).toBe(1);
    expect(row(s, 'task_recovery_rate').n).toBe(0);
  });
});
