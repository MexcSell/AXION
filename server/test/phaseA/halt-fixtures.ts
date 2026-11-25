/**
 * Phase A, A2 fixtures: the durable halt source (run_halts). COMMITTED BEFORE the table, the reducer or the routes exist.
 * Nothing executes. Every expectation below was worked out BY HAND from one rule, never computed by the code under test:
 *
 *   RULE. A halt row is (scope, target, halted, reason). A lift is a NEW row with halted=false; rows are never edited. For each
 *   (scope, target) the row with the highest id (insertion order) decides. The effective halt of a run is looked up GLOBAL first:
 *   if the latest global row halts, the answer is "halted, scope global". Otherwise the CLASS row for the run's task class, then
 *   the RUN row for the run id. A lift at one scope never lifts another scope. No rows at all means "not halted".
 *   Scope `global` always has target '' (empty).
 *
 * Interleaving counts (hand-derived multinomials, same as c95):
 *   H3 = 3 workers x (begin, commit) + 1 halt event:   7!/(2!2!2!)  = 630   (run once per halt scope: global, class, run = 1890)
 *   H2 = 2 workers x 2 x (begin, commit) + 1 halt:     9!/(4!4!)     = 630   (global halt only)
 */
export type HaltScopeF = 'global' | 'class' | 'run';
export interface HaltRowF { scope: HaltScopeF; target: string; halted: boolean; reason: string }
export interface HaltCase {
  id: string;
  /** rows in insertion order */
  rows: HaltRowF[];
  query: { runId: string; taskClass: string };
  /** hand-derived answer */
  expect: { halted: boolean; scope: HaltScopeF | null; reason: string | null };
  why: string;
}

const g = (halted: boolean, reason: string): HaltRowF => ({ scope: 'global', target: '', halted, reason });
const c = (target: string, halted: boolean, reason: string): HaltRowF => ({ scope: 'class', target, halted, reason });
const r = (target: string, halted: boolean, reason: string): HaltRowF => ({ scope: 'run', target, halted, reason });
const Q = { runId: 'run-1', taskClass: 'web-research' };
const no = { halted: false, scope: null, reason: null } as const;

export const HALT_CASES: HaltCase[] = [
  { id: 'none', rows: [], query: Q, expect: no, why: 'no rows: not halted' },
  { id: 'global-set', rows: [g(true, 'stop all')], query: Q, expect: { halted: true, scope: 'global', reason: 'stop all' }, why: 'one global halt' },
  { id: 'global-set-lift', rows: [g(true, 'stop all'), g(false, 'all clear')], query: Q, expect: no, why: 'the later global row (a lift) decides' },
  { id: 'global-set-lift-set', rows: [g(true, 'a'), g(false, 'b'), g(true, 'c')], query: Q, expect: { halted: true, scope: 'global', reason: 'c' }, why: 'the newest row wins, so the second set wins' },
  { id: 'global-lift-only', rows: [g(false, 'noop')], query: Q, expect: no, why: 'a lift with nothing to lift is a row that says not halted' },
  { id: 'class-other', rows: [c('mail-triage', true, 'x')], query: Q, expect: no, why: 'a halt of another class does not touch this class' },
  { id: 'class-match', rows: [c('web-research', true, 'class stop')], query: Q, expect: { halted: true, scope: 'class', reason: 'class stop' }, why: 'class halt matches the run\'s task class' },
  { id: 'class-set-lift', rows: [c('web-research', true, 'x'), c('web-research', false, 'y')], query: Q, expect: no, why: 'class lift' },
  { id: 'run-match', rows: [r('run-1', true, 'run stop')], query: Q, expect: { halted: true, scope: 'run', reason: 'run stop' }, why: 'run halt on this run id' },
  { id: 'run-other', rows: [r('run-2', true, 'x')], query: Q, expect: no, why: 'a halt of another run does not touch this run' },
  { id: 'run-set-lift', rows: [r('run-1', true, 'x'), r('run-1', false, 'y')], query: Q, expect: no, why: 'run lift' },
  { id: 'global-and-class', rows: [c('web-research', true, 'class'), g(true, 'global')], query: Q, expect: { halted: true, scope: 'global', reason: 'global' }, why: 'global is looked up first, whatever the insertion order' },
  { id: 'global-and-class-and-run', rows: [r('run-1', true, 'run'), c('web-research', true, 'class'), g(true, 'global')], query: Q, expect: { halted: true, scope: 'global', reason: 'global' }, why: 'global first of three' },
  { id: 'global-lifted-class-set', rows: [g(true, 'a'), c('web-research', true, 'class'), g(false, 'b')], query: Q, expect: { halted: true, scope: 'class', reason: 'class' }, why: 'the global lift does not lift the class halt: class answers' },
  { id: 'class-lifted-run-set', rows: [c('web-research', true, 'a'), r('run-1', true, 'run'), c('web-research', false, 'b')], query: Q, expect: { halted: true, scope: 'run', reason: 'run' }, why: 'the class lift does not lift the run halt: run answers' },
  { id: 'global-set-run-lift', rows: [g(true, 'global'), r('run-1', false, 'lift run')], query: Q, expect: { halted: true, scope: 'global', reason: 'global' }, why: 'a lift at run scope never lifts the global halt' },
  { id: 'class-set-global-lift', rows: [c('web-research', true, 'class'), g(false, 'lift all')], query: Q, expect: { halted: true, scope: 'class', reason: 'class' }, why: 'a global lift never lifts a class halt' },
  { id: 'all-lifted', rows: [g(true, 'a'), c('web-research', true, 'b'), r('run-1', true, 'c'), r('run-1', false, 'c2'), c('web-research', false, 'b2'), g(false, 'a2')], query: Q, expect: no, why: 'each scope\'s newest row is a lift' },
  { id: 'other-class-and-run-only', rows: [c('mail-triage', true, 'x'), r('run-9', true, 'y')], query: Q, expect: no, why: 'both targets differ from this run' },
  { id: 'run-set-lift-set', rows: [r('run-1', true, 'r1'), r('run-1', false, 'r2'), r('run-1', true, 'r3')], query: Q, expect: { halted: true, scope: 'run', reason: 'r3' }, why: 'set, lift, set at run scope: halted by the third row' },
  { id: 'target-is-exact', rows: [c('web-research-2', true, 'x'), c('Web-Research', true, 'y'), r('run-10', true, 'z')], query: Q, expect: no, why: 'targets are compared exactly: no prefix or case match' },
];

export const THRESHOLDS_A2 = {
  /** the durable reducer and the table both give the hand answer in every case */
  minCases: 20,
  interleavings: { H3: 630, H2: 630 },
  /** H3 is run for the three halt scopes, H2 for global only */
  totalInterleavings: 630 * 3 + 630,
} as const;
