/**
 * c95 fake executor: scripted runaways against the pure caps checker. No I/O, no model, no tool runs. A harness for the checker.
 *
 * Two parts. `runSequential` drives one run through a spec's script, optionally setting a halt mid-run, and keeps proposing
 * after any stop (a runaway ignores a stop). `FakeStore` models the single atomic "check, then take effect" action of a real
 * store (one SQL statement under the lease), with begin / commit split in two so tests can interleave workers in every order.
 */
import type { RunCounters, RunHaltState, RunStopReason, RunCapsDecision, RunCaps, RunClassBreaker, RunStepProposal } from '../../../shared/contracts/src/index.ts';
import { checkRunStep, latchStop, newRunCounters, recordRunStep } from '../../src/jobs/run-caps.ts';
import { HARNESS_CEILING, type FixtureSpec, type ScriptedStep } from './fixture-specs.ts';

export interface SeqResult {
  accepted: number;
  stopReason: RunStopReason | null;
  /** the run reached the harness ceiling without a stop: a FAIL of the checker, never a hang */
  hitCeiling: boolean;
  /** steps accepted after the halt was set (must be 0) */
  acceptedAfterHalt: number;
  /** extra proposals made after the stop; each must be refused */
  extraProposals: number;
  extraAccepted: number;
}

const proposalOf = (s: ScriptedStep, token: number): RunStepProposal => ({ tool: s.tool, origin: s.origin, atMs: s.atMs, estMoneyMicros: s.estMoneyMicros, estTokens: s.estTokens, fencingToken: token });

/** `haltAfter`: set the halt flag once this many steps are accepted (0 = before the first step). The flag is the only thing set. */
export function runSequential(spec: FixtureSpec, opts: { haltAfter?: number; mutateToken?: boolean } = {}): SeqResult {
  let counters: RunCounters = newRunCounters(0);
  let halt: RunHaltState = { halted: false };
  const token = 1;
  let accepted = 0, acceptedAfterHalt = 0, stopReason: RunStopReason | null = null, hitCeiling = false;
  for (let i = 1; i <= HARNESS_CEILING; i++) {
    if (opts.haltAfter !== undefined && !halt.halted && accepted >= opts.haltAfter) halt = { halted: true, reason: 'operator' };
    const s = spec.script(i);
    const d = checkRunStep({ caps: spec.caps, breaker: spec.breaker, counters, step: proposalOf(s, token), halt, currentFencingToken: token });
    if (d.action === 'stop') { stopReason = d.reason; counters = latchStop(counters, d); break; }
    accepted++;
    if (halt.halted) acceptedAfterHalt++;
    counters = recordRunStep(counters, proposalOf(s, token), { ok: s.ok, actualMoneyMicros: s.actualMoneyMicros, actualTokens: s.actualTokens });
    if (i === HARNESS_CEILING) hitCeiling = true;
  }
  // a runaway ignores the stop: it keeps proposing, ten more times, 70 s later (past the rate window) to test the latch
  let extraAccepted = 0;
  const extra = 10;
  for (let k = 1; k <= extra; k++) {
    const s = spec.script(accepted + k);
    const d: RunCapsDecision = checkRunStep({ caps: spec.caps, breaker: spec.breaker, counters, step: proposalOf({ ...s, atMs: s.atMs + 70_000 * k }, token), halt, currentFencingToken: token });
    if (d.action === 'continue') extraAccepted++;
  }
  return { accepted, stopReason, hitCeiling, acceptedAfterHalt, extraProposals: extra, extraAccepted };
}

// ---- concurrent model ------------------------------------------------------------------------------------------------

export type Op = { kind: 'begin' | 'commit'; worker: number; slot: number } | { kind: 'halt' } | { kind: 'reclaim' };
export interface Effect { worker: number; haltedAtEffect: boolean; tokenAtEffect: number; heldToken: number }
export interface Ticket { worker: number; slot: number; step: RunStepProposal; admitted: boolean }

export class FakeStore {
  counters: RunCounters = newRunCounters(0);
  halt: RunHaltState = { halted: false };
  token = 1;
  effects: Effect[] = [];
  refused: RunStopReason[] = [];
  private tickets = new Map<string, Ticket>();
  private clock = 0;
  /** `recheckAtCommit: false` is the NEGATIVE CONTROL (a store that trusts the admit-time answer). It is excluded from every count. */
  constructor(readonly caps: RunCaps | null, readonly breaker: RunClassBreaker, readonly recheckAtCommit = true, readonly heldToken = 1) {}

  private nextStep(): RunStepProposal {
    this.clock += 1000;
    return { tool: 'browse', origin: 'https://a.test', atMs: this.clock, estMoneyMicros: 1, estTokens: 1, fencingToken: this.heldToken };
  }
  private check(step: RunStepProposal): RunCapsDecision {
    return checkRunStep({ caps: this.caps, breaker: this.breaker, counters: this.counters, step, halt: this.halt, currentFencingToken: this.token });
  }
  apply(op: Op): void {
    if (op.kind === 'halt') { this.halt = { halted: true, reason: 'operator' }; return; } // the flag only; the token is untouched
    if (op.kind === 'reclaim') { this.token += 1; return; }
    const key = `${op.worker}:${op.slot}`;
    if (op.kind === 'begin') {
      const step = this.nextStep();
      const d = this.check(step);
      this.tickets.set(key, { worker: op.worker, slot: op.slot, step, admitted: d.action === 'continue' });
      if (d.action === 'stop') this.refused.push(d.reason);
      return;
    }
    const t = this.tickets.get(key);
    if (!t || !t.admitted) return;
    if (this.recheckAtCommit) {
      const d = this.check(t.step); // check and effect are one atomic action here
      if (d.action === 'stop') { this.refused.push(d.reason); return; }
    }
    this.effects.push({ worker: op.worker, haltedAtEffect: this.halt.halted, tokenAtEffect: this.token, heldToken: t.step.fencingToken });
    this.counters = recordRunStep(this.counters, t.step, { ok: true, actualMoneyMicros: 1, actualTokens: 1 });
  }
}

/** Every merge of the actors' op lists that keeps each actor's own order. */
export function* interleavings(lists: Op[][]): Generator<Op[]> {
  const idx = lists.map(() => 0);
  const out: Op[] = [];
  const total = lists.reduce((n, l) => n + l.length, 0);
  function* rec(): Generator<Op[]> {
    if (out.length === total) { yield [...out]; return; }
    for (let a = 0; a < lists.length; a++) {
      if (idx[a] >= lists[a].length) continue;
      out.push(lists[a][idx[a]++]);
      yield* rec();
      idx[a]--; out.pop();
    }
  }
  yield* rec();
}

export const workerOps = (worker: number, steps: number): Op[] => Array.from({ length: steps }, (_, slot) => [{ kind: 'begin', worker, slot } as Op, { kind: 'commit', worker, slot } as Op]).flat();
