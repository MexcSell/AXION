/**
 * Phase A, A2: the c95 fake store with its halt flag replaced by the durable run_halts table. A harness under test/ only: no I/O
 * other than the test database, no process, no model. Same model as test/c95/fake-executor.ts (begin and commit are separate ops so
 * tests can interleave workers in every order), except that the halt is READ FROM THE TABLE at admit time and again at commit time.
 */
import type pg from 'pg';
import type { RunCaps, RunClassBreaker, RunCapsDecision, RunCounters, RunStepProposal } from '../../../shared/contracts/src/index.ts';
import { checkRunStep, newRunCounters, recordRunStep } from '../../src/jobs/run-caps.ts';
import { readEffectiveHalt, recordHalt } from '../../src/jobs/run-halts.ts';
import type { Op } from '../c95/fake-executor.ts';

export type HaltScopeD = 'global' | 'class' | 'run';
export interface DurableEffect { worker: number; /** ground truth: the halt row had already been written when the step took effect */ afterHaltRow: boolean }

export class DurableFakeStore {
  counters: RunCounters = newRunCounters(0);
  effects: DurableEffect[] = [];
  refused: string[] = [];
  private haltRowWritten = false;
  private tickets = new Map<string, { step: RunStepProposal; admitted: boolean }>();
  private clock = 0;
  /** `recheckAtCommit: false` is the NEGATIVE CONTROL (a store that trusts the admit-time answer). It is excluded from every count. */
  constructor(
    readonly db: pg.Pool, readonly tenant: string, readonly runId: string, readonly taskClass: string,
    readonly caps: RunCaps | null, readonly breaker: RunClassBreaker, readonly haltScope: HaltScopeD, readonly recheckAtCommit = true,
  ) {}

  private nextStep(): RunStepProposal {
    this.clock += 1000;
    return { tool: 'browse', origin: 'https://a.test', atMs: this.clock, estMoneyMicros: 1, estTokens: 1, fencingToken: 1 };
  }
  private async check(step: RunStepProposal): Promise<RunCapsDecision> {
    const halt = await readEffectiveHalt(this.db, this.tenant, { runId: this.runId, taskClass: this.taskClass }); // one statement: the table decides
    return checkRunStep({ caps: this.caps, breaker: this.breaker, counters: this.counters, step, halt, currentFencingToken: 1 });
  }
  async apply(op: Op): Promise<void> {
    if (op.kind === 'reclaim') return; // not used by the halt scenarios
    if (op.kind === 'halt') {
      const target = this.haltScope === 'global' ? '' : this.haltScope === 'class' ? this.taskClass : this.runId;
      await recordHalt(this.db, this.tenant, { scope: this.haltScope, target, halted: true, reason: 'operator', createdBy: 'test' });
      this.haltRowWritten = true;
      return;
    }
    const key = `${op.worker}:${op.slot}`;
    if (op.kind === 'begin') {
      const step = this.nextStep();
      const d = await this.check(step);
      this.tickets.set(key, { step, admitted: d.action === 'continue' });
      if (d.action === 'stop') this.refused.push(d.reason);
      return;
    }
    const t = this.tickets.get(key);
    if (!t || !t.admitted) return;
    if (this.recheckAtCommit) {
      const d = await this.check(t.step); // the check and the effect are one atomic action in this model
      if (d.action === 'stop') { this.refused.push(d.reason); return; }
    }
    this.effects.push({ worker: op.worker, afterHaltRow: this.haltRowWritten });
    this.counters = recordRunStep(this.counters, t.step, { ok: true, actualMoneyMicros: 1, actualTokens: 1 });
  }
}
