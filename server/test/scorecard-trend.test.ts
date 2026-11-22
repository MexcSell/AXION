import { describe, it, expect } from 'vitest';
import { computeScorecard, computeThroughput, trendOf, windowOf, type ScoreInput } from '../src/company/scorecard.ts';

// Improvement cycle 12 (brief c12-brief.md): previous-period comparison and weekly throughput, pure functions.
const NOW = new Date('2026-11-21T12:00:00Z');
const H = 3_600_000;
const D = 24 * H;
const at = (msAgo: number) => new Date(NOW.getTime() - msAgo);
const W7 = windowOf('7d', NOW);
const empty = (): ScoreInput => ({ missions: [], runs: [], transitions: [], tasks: [], attempts: [], decisions: [], delegations: [] });
function mission(s: ScoreInput, id: string, runAgo: number | null, steps: [string, number][]) {
  s.missions.push({ id, ownerId: 'u1' });
  if (runAgo != null) s.runs.push({ missionId: id, startedAt: at(runAgo) });
  let from = 'running';
  for (const [to, ago] of steps) { s.transitions.push({ missionId: id, from, to, at: at(ago) }); from = to; }
}
const row = (s: ScoreInput, key: string) => computeScorecard(s, { window: '7d', from: W7.from, to: W7.to, includeDemo: false }).rows.find((r) => r.key === key)!;

describe('trendOf rules', () => {
  const v = (value: number | null, n: number) => ({ value, n });
  it('null when either period lacks evidence', () => {
    expect(trendOf('%', v(50, 2), v(40, 5))).toBeNull();
    expect(trendOf('%', v(50, 5), v(40, 2))).toBeNull();
    expect(trendOf('%', v(null, 5), v(40, 5))).toBeNull();
    expect(trendOf('%', v(50, 5), v(null, 5))).toBeNull();
    expect(trendOf('%', v(50, 0), v(null, 0))).toBeNull();
  });
  it('flat within ±1 point, up/down beyond it', () => {
    expect(trendOf('%', v(51, 3), v(50, 3))).toBe('flat');
    expect(trendOf('%', v(49, 3), v(50, 3))).toBe('flat');
    expect(trendOf('%', v(50, 3), v(50, 3))).toBe('flat');
    expect(trendOf('%', v(51.1, 3), v(50, 3))).toBe('up');
    expect(trendOf('%', v(48.9, 3), v(50, 3))).toBe('down');
  });
  it('counts are flat only when equal; times use ±0.1 h', () => {
    expect(trendOf('missions', v(4, 4), v(4, 3))).toBe('flat');
    expect(trendOf('missions', v(5, 5), v(4, 4))).toBe('up');
    expect(trendOf('h', v(2.05, 3), v(2, 3))).toBe('flat');
    expect(trendOf('h', v(3, 3), v(2, 3))).toBe('up');
  });
});

describe('previous window in the scorecard', () => {
  it('an empty history has no previous values and no trend on any row', () => {
    const out = computeScorecard(empty(), { window: '7d', from: W7.from, to: W7.to, includeDemo: false });
    for (const r of out.rows) { expect(r.trend).toBeNull(); expect(r.previous.value === null || r.unit === 'missions' || r.unit === 'tasks').toBe(true); }
    expect(out.previousTo).toBe(new Date(W7.from.getTime() - 1).toISOString());
    expect(out.previousFrom).toBe(new Date(W7.from.getTime() - 7 * D - 1).toISOString());
  });
  it('previous counts and n come from the equal-length window just before; trend appears only with n >= 3 both sides', () => {
    const s = empty();
    for (let i = 0; i < 3; i++) mission(s, 'P' + i, 10 * D + i * H, [['failed', 9 * D]]);       // previous window: 3 started, 3 finished
    for (let i = 0; i < 5; i++) mission(s, 'C' + i, 3 * D + i * H, [['completed', 2 * D]]);     // current: 5 started, 5 finished
    const started = row(s, 'started');
    expect(started).toMatchObject({ value: 5, previous: { value: 3, n: 3 }, trend: 'up' });
    expect(row(s, 'failure_rate')).toMatchObject({ value: 0, previous: { value: 100, n: 3 }, trend: 'down' });
  });
  it('a previous period with too little evidence gives a null previous value and a null trend', () => {
    const s = empty();
    mission(s, 'P1', 10 * D, [['failed', 9 * D]]);
    for (let i = 0; i < 4; i++) mission(s, 'C' + i, 3 * D, [['completed', 2 * D]]);
    expect(row(s, 'failure_rate')).toMatchObject({ value: 0, previous: { value: null, n: 1 }, trend: null });
    expect(row(s, 'started').trend).toBeNull(); // previous started n = 1
  });
  it('a mission finishing exactly at the boundary is counted once (current window), not in both', () => {
    const s = empty();
    mission(s, 'B', 8 * D, [['completed', 7 * D]]); // exactly at `from`
    expect(row(s, 'finished')).toMatchObject({ value: 1, previous: { n: 0 } });
  });
  it('the current values are unchanged by the new fields', () => {
    const s = empty();
    mission(s, 'C', 3 * D, [['canceled', 1 * D]]);
    expect(row(s, 'finished')).toMatchObject({ value: 1, n: 1, state: 'ok', unit: 'missions' });
  });
});

describe('weekly throughput', () => {
  it('returns `weeks` contiguous weekly buckets, oldest first, with counts only', () => {
    const out = computeThroughput(empty(), { weeks: 8, to: NOW, includeDemo: false });
    expect(out.weeks).toHaveLength(8);
    expect(out.weeks[7].to).toBe(NOW.toISOString());
    for (let i = 1; i < 8; i++) expect(new Date(out.weeks[i].from).getTime()).toBe(new Date(out.weeks[i - 1].to).getTime() + 1);
    for (const w of out.weeks) expect(Object.keys(w).sort()).toEqual(['finished', 'from', 'started', 'to']);
    expect(out.weeks.every((w) => w.started === 0 && w.finished === 0)).toBe(true);
  });
  it('puts started and finished in the right week', () => {
    const s = empty();
    mission(s, 'A', 1 * D, [['completed', 1 * H]]);          // this week: started + finished
    mission(s, 'B', 9 * D, [['failed', 8 * D]]);             // last week: both
    mission(s, 'C', 20 * D, []);                             // 3 weeks ago, still running
    const w = computeThroughput(s, { weeks: 8, to: NOW, includeDemo: false }).weeks;
    expect(w.map((x) => x.started)).toEqual([0, 0, 0, 0, 0, 1, 1, 1]);
    expect(w.map((x) => x.finished)).toEqual([0, 0, 0, 0, 0, 0, 1, 1]);
  });
  it('fail in week 3 → retry → complete in week 6 counts once, in week 6; the sum equals the distinct finished missions', () => {
    const s = empty();
    mission(s, 'R', 40 * D, [['failed', 35 * D], ['running', 30 * D], ['completed', 8 * D]]); // oldest week index 0 ... failed ~5 weeks ago, completed 8 days ago
    mission(s, 'Q', 20 * D, [['completed', 2 * D]]);
    mission(s, 'Z', 20 * D, [['failed', 70 * D]]); // outside the 8 weeks (final long ago)
    const w = computeThroughput(s, { weeks: 8, to: NOW, includeDemo: false }).weeks;
    expect(w.map((x) => x.finished)).toEqual([0, 0, 0, 0, 0, 0, 1, 1]);
    expect(w.reduce((a, x) => a + x.finished, 0)).toBe(2);
    const sc = computeScorecard(s, { window: '7d', from: W7.from, to: W7.to, includeDemo: false }).rows.find((r) => r.key === 'finished')!;
    expect(w[7].finished).toBe(sc.value);
  });
  it('ignores rows of missions outside the mission set', () => {
    const s = empty();
    s.runs.push({ missionId: 'X', startedAt: at(1 * D) });
    expect(computeThroughput(s, { weeks: 2, to: NOW, includeDemo: false }).weeks.every((w) => w.started === 0)).toBe(true);
  });
});
