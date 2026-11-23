// RED stub: always continue. Replaced by the real checker after the RED run.
import type { RunCounters, RunCapsDecision } from '../../../shared/contracts/src/index.ts';
export const newRunCounters = (startedAtMs: number): RunCounters => ({ steps: 0, startedAtMs, callTimesMs: [], origins: [], moneyMicrosUsed: 0, tokensUsed: 0, consecutiveFailures: 0, stoppedBy: null });
export const checkRunStep = (_a: any): RunCapsDecision => ({ action: 'continue' });
export const latchStop = (c: RunCounters, _d: any): RunCounters => c;
export const recordRunStep = (c: RunCounters, _s: any, _o: any): RunCounters => ({ ...c, steps: c.steps + 1 });
