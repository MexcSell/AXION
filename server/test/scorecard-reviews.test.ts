import { describe, it, expect } from 'vitest';
import { computeScorecard, windowOf, type ScoreInput } from '../src/company/scorecard.ts';

// Improvement cycle 38: the two review-related rows, on a fixture with known reviews. n and the window are part of the answer.
const NOW = new Date('2026-11-21T12:00:00Z');
const D = 24 * 3_600_000;
const at = (ago: number) => new Date(NOW.getTime() - ago);
type Rv = NonNullable<ScoreInput['reviews']>[number];
let seq = 0;
const rv = (taskId: string, verdict: string, ago: number, over: Partial<Rv> = {}): Rv => ({ taskId, missionId: 'M-1', verdict, reviewerId: 'u-ben', producerId: 'coder-01', principalId: 'u-owner', evidenceCount: 1, at: at(ago), seq: ++seq, ...over });
const STATUS: Record<string, string> = {};
/** tasks default to `passed`; a test lists the exceptions in STATUS */
const base = (reviews: Rv[]): ScoreInput => ({ missions: [{ id: 'M-1', ownerId: 'u-owner' }], runs: [], transitions: [], attempts: [], decisions: [], delegations: [], reviews,
  tasks: [...new Set(reviews.map((r) => r.taskId))].map((id) => ({ id, missionId: 'M-1', status: STATUS[id] ?? 'passed' })) });
const W = windowOf('30d', NOW);
const row = (i: ScoreInput, key: string, w = W) => computeScorecard(i, { window: w.window, from: w.from, to: w.to, includeDemo: false }).rows.find((r) => r.key === key)!;

describe('tasks_verified_by_review', () => {
  it('counts tasks whose latest review is accepted with evidence by a reviewer other than the producer and the owner: exact value and n', () => {
    const rs = [
      rv('T1', 'accepted', 2 * D),                                   // verified
      rv('T2', 'accepted', 3 * D),                                   // verified
      rv('T3', 'rejected', 4 * D),                                   // reviewed, not verified
      rv('T4', 'changes_requested', 5 * D), rv('T4', 'accepted', 4 * D), // latest wins: verified
      rv('T5', 'accepted', 6 * D), rv('T5', 'rejected', 5 * D),      // latest is a rejection: not verified
      rv('T6', 'accepted', 2 * D, { evidenceCount: 0 }),             // no evidence (cannot exist in the DB; never counted)
      rv('T7', 'accepted', 2 * D, { reviewerId: 'coder-01' }),       // reviewer = producer (cannot exist; never counted)
      rv('T8', 'accepted', 2 * D, { reviewerId: 'u-owner' }),        // reviewer = the stored principal (cannot exist; never counted)
      rv('T9', 'accepted', 40 * D),                                  // outside the 30-day window
    ];
    const r = row(base(rs), 'tasks_verified_by_review');
    expect(r).toMatchObject({ value: 3, n: 8, unit: 'tasks', state: 'ok' });
    expect(r.evidence).toContain('3 of 8 reviewed tasks');
  });
  it('a task is placed in the window by its latest review, and a review after `to` is ignored', () => {
    const w7 = windowOf('7d', NOW);
    const rs = [rv('T1', 'accepted', 2 * D), rv('T2', 'accepted', 10 * D), rv('T3', 'accepted', -1 * D)];
    expect(row(base(rs), 'tasks_verified_by_review', w7)).toMatchObject({ value: 1, n: 1 });
    expect(row(base(rs), 'tasks_verified_by_review', W)).toMatchObject({ value: 2, n: 2 });
  });
  it('no reviews is an honest zero with n=0, never invented; reviews of missions outside the input are ignored', () => {
    expect(row(base([]), 'tasks_verified_by_review')).toMatchObject({ value: 0, n: 0, state: 'ok' });
    expect(row(base([rv('T1', 'accepted', D, { missionId: 'M-other' })]), 'tasks_verified_by_review')).toMatchObject({ value: 0, n: 0 });
    expect(row({ ...base([]), reviews: undefined }, 'tasks_verified_by_review')).toMatchObject({ value: 0, n: 0 });
  });
  it('the previous period uses the same rule over the previous window (trend needs n >= 3 on both sides)', () => {
    const rs = [rv('A', 'accepted', 2 * D), rv('B', 'accepted', 3 * D), rv('C', 'accepted', 4 * D), rv('P1', 'accepted', 35 * D), rv('P2', 'accepted', 36 * D), rv('P3', 'rejected', 37 * D)];
    const r = row(base(rs), 'tasks_verified_by_review');
    expect(r.previous).toEqual({ value: 2, n: 3 });
    expect(r.trend).toBe('up');
  });
});

describe('review counting rules (fix round)', () => {
  it('only accepted reviews on tasks that are STILL passed count, whatever the other statuses are', () => {
    const statuses = ['created', 'ready', 'running', 'waiting_agent', 'waiting_user', 'verifying', 'passed', 'failed', 'retry_ready', 'canceled'];
    const rs = statuses.map((st, i) => { STATUS['S' + st] = st; return rv('S' + st, 'accepted', (i + 1) * D / 4); });
    const r = row(base(rs), 'tasks_verified_by_review');
    expect(r).toMatchObject({ value: 1, n: 10 }); // only the passed one; the other nine are reviewed but not verified
    for (const st of statuses) delete STATUS['S' + st];
  });
  it('a task retried after an accepted review is no longer verified', () => {
    STATUS['TR'] = 'retry_ready';
    expect(row(base([rv('TR', 'accepted', D)]), 'tasks_verified_by_review')).toMatchObject({ value: 0, n: 1 });
    delete STATUS['TR'];
  });
  it('the mission owner is excluded by the principal STORED with the review, not by whoever owns the mission now', () => {
    const rs = [rv('P1', 'accepted', D, { reviewerId: 'u-newowner', principalId: 'u-newowner' }), rv('P2', 'accepted', D, { reviewerId: 'u-newowner', principalId: 'u-old' })];
    // the mission is now owned by u-newowner: P2 (reviewed by them while someone else was principal) still counts, P1 never does
    const i = { ...base(rs), missions: [{ id: 'M-1', ownerId: 'u-newowner' }] };
    expect(row(i, 'tasks_verified_by_review')).toMatchObject({ value: 1, n: 2 });
  });
});

describe('approved_by_non_owner (the approval-only rule, its own row)', () => {
  it('counts completed missions with a human non-owner approval before completion; n is the completions', () => {
    const s: ScoreInput = { missions: [{ id: 'M-1', ownerId: 'u-owner' }, { id: 'M-2', ownerId: 'u-owner' }, { id: 'M-3', ownerId: 'u-owner' }], runs: [], tasks: [], attempts: [], delegations: [], reviews: [],
      transitions: ['M-1', 'M-2', 'M-3'].map((id, i) => ({ missionId: id, from: 'running', to: 'completed', at: at((2 + i) * D) })),
      decisions: [
        { missionId: 'M-1', decision: 'approved', decidedBy: 'u-other', human: true, at: at(6 * D) },
        { missionId: 'M-2', decision: 'approved', decidedBy: 'u-owner', human: true, at: at(6 * D) },
      ] };
    expect(row(s, 'approved_by_non_owner')).toMatchObject({ value: 1, n: 3, unit: 'missions' });
    // the mission-level rows keep their meaning
    expect(row(s, 'verified_success_rate')).toMatchObject({ value: 33.3, n: 3 });
  });
});
