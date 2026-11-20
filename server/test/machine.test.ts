import { describe, it, expect } from 'vitest';
import { transition, MISSION_STATUSES, USER_ACTIONS, SYSTEM_ACTIONS, type MissionStatus, type MissionAction, assertAcyclic, toUiStatus } from '../src/missions/machine.ts';

// Spec §10.6: every legal edge. Anything not listed must throw ILLEGAL_TRANSITION.
const LEGAL: [MissionStatus, MissionAction, MissionStatus][] = [
  ['draft', 'submit', 'queued'], ['draft', 'cancel', 'canceled'],
  ['queued', 'plan', 'planning'], ['queued', 'cancel', 'canceled'],
  ['planning', 'start', 'running'], ['planning', 'pause', 'paused'], ['planning', 'cancel', 'canceled'], ['planning', 'fail', 'failed'],
  ['running', 'verify', 'verifying'], ['running', 'requestApproval', 'waiting_approval'], ['running', 'pause', 'paused'], ['running', 'cancel', 'canceled'], ['running', 'fail', 'failed'],
  ['waiting_approval', 'approvalDone', 'running'], ['waiting_approval', 'pause', 'paused'], ['waiting_approval', 'cancel', 'canceled'], ['waiting_approval', 'fail', 'failed'],
  ['verifying', 'complete', 'completed'], ['verifying', 'pause', 'paused'], ['verifying', 'cancel', 'canceled'], ['verifying', 'fail', 'failed'],
  ['paused', 'resume', 'running'], ['paused', 'cancel', 'canceled'],
  ['failed', 'retry', 'retry_queued'], ['failed', 'archive', 'archived'],
  ['retry_queued', 'start', 'running'], ['retry_queued', 'cancel', 'canceled'],
  ['completed', 'archive', 'archived'], ['canceled', 'archive', 'archived'],
];
const ALL_ACTIONS = [...USER_ACTIONS, ...SYSTEM_ACTIONS] as MissionAction[];

describe('mission state machine', () => {
  it.each(LEGAL)('%s --%s--> %s', (from, action, to) => {
    expect(transition(from, action)).toBe(to);
  });

  it('every other (status, action) pair throws ILLEGAL_TRANSITION', () => {
    let illegal = 0;
    for (const from of MISSION_STATUSES) for (const action of ALL_ACTIONS) {
      if (LEGAL.some(([f, a]) => f === from && a === action)) continue;
      if (from === 'archived' && action === 'restore') continue;
      expect(() => transition(from, action), `${from} ${action}`).toThrowError(expect.objectContaining({ code: 'ILLEGAL_TRANSITION', status: 409 }));
      illegal++;
    }
    expect(illegal).toBeGreaterThan(100);
  });

  it('archive is only legal from completed, canceled or failed', () => {
    const ok = MISSION_STATUSES.filter((s) => { try { transition(s, 'archive'); return true; } catch { return false; } });
    expect(ok.sort()).toEqual(['canceled', 'completed', 'failed']);
  });

  it('restore returns an archived mission to its status before archiving', () => {
    expect(transition('archived', 'restore', { preArchive: 'failed' })).toBe('failed');
    expect(transition('archived', 'restore', { preArchive: 'completed' })).toBe('completed');
    expect(() => transition('archived', 'restore')).toThrow();
  });

  it('no action moves a failed or archived mission back to running directly', () => {
    for (const a of ALL_ACTIONS) {
      for (const from of ['failed', 'archived'] as const) {
        let to: string | undefined;
        try { to = transition(from, a, { preArchive: 'canceled' }); } catch { continue; } // illegal is fine
        expect(to, `${from} ${a}`).not.toBe('running'); // review M18: the assertion is no longer inside the try
      }
    }
  });

  it('user and system actions are disjoint', () => {
    expect(USER_ACTIONS.filter((a) => (SYSTEM_ACTIONS as readonly string[]).includes(a))).toEqual([]);
    expect(USER_ACTIONS).toEqual(['start', 'pause', 'resume', 'cancel', 'retry', 'archive', 'restore']);
  });

  it('maps server statuses to the UI', () => {
    expect(toUiStatus('waiting_approval')).toBe('waiting');
    expect(toUiStatus('retry_queued')).toBe('queued');
    expect(toUiStatus('canceled')).toBe('canceled');
    expect(toUiStatus('running')).toBe('running');
  });
});

describe('task dependency graph', () => {
  it('accepts a DAG and rejects a cycle', () => {
    expect(() => assertAcyclic([['b', 'a'], ['c', 'b'], ['c', 'a']])).not.toThrow();
    expect(() => assertAcyclic([['a', 'b'], ['b', 'c'], ['c', 'a']])).toThrowError(expect.objectContaining({ code: 'VALIDATION' }));
    expect(() => assertAcyclic([['a', 'a']])).toThrow();
  });
});
