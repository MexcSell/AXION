import { describe, it, expect } from 'vitest';
import type { RunCaps, RunClassBreaker } from '../../shared/contracts/src/index.ts';
import { RUN_STOP_BOUND } from '../../shared/contracts/src/index.ts';
import { checkRunStep, newRunCounters } from '../src/jobs/run-caps.ts';
import { SEQUENTIAL_FIXTURES, HALT_AFTER, THRESHOLDS } from './c95/fixture-specs.ts';
import { runSequential, FakeStore, interleavings, workerOps, type Op } from './c95/fake-executor.ts';

/** c95: an engineering control, not evidence. These fixtures test the harness and the pure checker, not any agent. Nothing executes. */
const LOOSE: RunCaps = { maxSteps: 1000, maxWallMs: 3_600_000, maxToolCallsPerMinute: 1000, maxDistinctOrigins: 1000, reservedMoneyMicros: 1e12, reservedTokens: 1e12 };
const BR: RunClassBreaker = { taskClass: 'fixture', stage: 2, maxConsecutiveFailures: 1000 };

describe('threshold (a): every runaway stops at or before capSteps + 1', () => {
  it('has at least 25 runaway fixtures covering all five kinds', () => {
    expect(SEQUENTIAL_FIXTURES.length).toBeGreaterThanOrEqual(THRESHOLDS.minRunaways);
    expect(new Set(SEQUENTIAL_FIXTURES.map((f) => f.kind)).size).toBe(5);
    expect(new Set(SEQUENTIAL_FIXTURES.map((f) => f.id)).size).toBe(SEQUENTIAL_FIXTURES.length);
  });
  for (const f of SEQUENTIAL_FIXTURES) {
    it(`${f.id}: ${f.why}`, () => {
      const r = runSequential(f);
      expect(r.hitCeiling, 'harness ceiling reached: the checker never stopped').toBe(false);
      expect(r.accepted).toBeLessThanOrEqual(f.capSteps + RUN_STOP_BOUND.capPlusSteps);
      expect(r.accepted).toBe(f.accepted);
      expect(r.stopReason).toBe(f.reason);
      expect(r.extraAccepted, 'a stop is final: later proposals, even 70 s later, are refused').toBe(0);
    });
  }
  it('two workers race for the last step: the cap holds exactly in all 6 interleavings', () => {
    let n = 0;
    for (const order of interleavings([workerOps(1, 1), workerOps(2, 1)])) {
      const s = new FakeStore({ ...LOOSE, maxSteps: 1 }, BR);
      for (const op of order) s.apply(op);
      expect(s.effects.length).toBe(1);
      n++;
    }
    expect(n).toBe(THRESHOLDS.interleavings.C2);
  });
});

describe('threshold (b): zero accepted steps after a halt, in every fixture', () => {
  for (const f of SEQUENTIAL_FIXTURES) {
    it(`${f.id}: halt injected after ${HALT_AFTER.join(', ')} accepted steps`, () => {
      for (const h of HALT_AFTER) {
        const r = runSequential(f, { haltAfter: h });
        expect(r.acceptedAfterHalt).toBe(0);
        expect(r.accepted).toBe(Math.min(h, f.accepted));
        expect(r.stopReason).toBe(h <= f.accepted ? 'halted' : f.reason);
        expect(r.extraAccepted).toBe(0);
        expect(r.hitCeiling).toBe(false);
      }
    });
  }
  const haltViolations = (ordersOf: Op[][], mk: () => FakeStore) => {
    let runs = 0, bad = 0;
    for (const order of interleavings(ordersOf)) {
      const s = mk();
      for (const op of order) s.apply(op);
      runs++;
      if (s.effects.some((e) => e.haltedAtEffect)) bad++;
    }
    return { runs, bad };
  };
  it('H3: 3 workers x 1 step + a halt, all 630 interleavings', () => {
    const r = haltViolations([workerOps(1, 1), workerOps(2, 1), workerOps(3, 1), [{ kind: 'halt' }]], () => new FakeStore(LOOSE, BR));
    expect(r.runs).toBe(THRESHOLDS.interleavings.H3);
    expect(r.bad).toBe(0);
  });
  it('H2: 2 workers x 2 steps + a halt, all 630 interleavings (a step admitted before the halt takes effect after it)', () => {
    const r = haltViolations([workerOps(1, 2), workerOps(2, 2), [{ kind: 'halt' }]], () => new FakeStore(LOOSE, BR));
    expect(r.runs).toBe(THRESHOLDS.interleavings.H2);
    expect(r.bad).toBe(0);
  });
  it('R2: a lease reclaim (token bump, no halt) fences out the old holder in all 30 interleavings', () => {
    let runs = 0;
    for (const order of interleavings([workerOps(1, 1), workerOps(2, 1), [{ kind: 'reclaim' }]])) {
      const s = new FakeStore(LOOSE, BR);
      for (const op of order) s.apply(op);
      runs++;
      expect(s.effects.every((e) => e.tokenAtEffect === e.heldToken)).toBe(true);
    }
    expect(runs).toBe(THRESHOLDS.interleavings.R2);
  });
  it('NEGATIVE CONTROL (excluded from every count): a store that skips the re-check at commit does accept steps after a halt', () => {
    const r = haltViolations([workerOps(1, 1), workerOps(2, 1), workerOps(3, 1), [{ kind: 'halt' }]], () => new FakeStore(LOOSE, BR, false));
    expect(r.bad).toBeGreaterThan(0);
  });
});

describe('threshold (c): a lease without caps is refused for stage 2 and 3', () => {
  const step = { tool: 'browse', origin: 'https://a.test', atMs: 0, estMoneyMicros: 1, estTokens: 1, fencingToken: 1 };
  const ask = (stage: 0 | 1 | 2 | 3, caps: unknown) => checkRunStep({ caps: caps as RunCaps, breaker: { taskClass: 'c', stage, maxConsecutiveFailures: 3 }, counters: newRunCounters(0), step, halt: { halted: false }, currentFencingToken: 1 });
  it.each([2, 3] as const)('stage %i: null, undefined, partial and empty caps are refused', (st) => {
    for (const c of [null, undefined, {}, { maxSteps: 5 }]) expect(ask(st, c)).toMatchObject({ action: 'stop', reason: 'caps_missing', retry: false });
  });
  it.each([0, 1] as const)('stage %i without caps is allowed (nothing to check but halt, token and breaker)', (st) => {
    expect(ask(st, null)).toEqual({ action: 'continue' });
  });
});
