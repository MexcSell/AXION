import type { LedgerKind, ProgressBody, TaskBody } from './ledgers.ts';
import { stallCheck } from './ledgers.ts';

/**
 * DEMO sample ledgers (cycle 39), built from a fixture mission's own objective and criteria. Every row is stored with
 * demo=true and author 'system' and the text says DEMO: they illustrate the layout, no agent wrote them.
 */
export interface DemoMission { title: string; objective: string; status: string; criteria: { text: string; done: boolean }[] }
const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

export function demoLedgers(m: DemoMission): { kind: LedgerKind; body: TaskBody | ProgressBody }[] {
  const open = m.criteria.filter((c) => !c.done);
  const stuck = ['waiting_approval', 'paused', 'failed', 'blocked'].includes(m.status);
  const done = m.status === 'completed';
  const task: TaskBody = {
    facts: {
      given: [{ text: cut(m.objective || m.title, 380), source: 'mission text' }],
      to_look_up: open.slice(0, 2).map((c) => ({ text: cut(`Evidence for: ${c.text}`, 380) })),
      to_derive: open.slice(2, 3).map((c) => ({ text: cut(`What remains for: ${c.text}`, 380) })),
      guesses: [{ text: 'DEMO sample: this ledger is illustrative, no agent wrote it' }],
    },
    steps: m.criteria.slice(0, 6).map((c, i) => ({ id: `s${i + 1}`, text: cut(c.text, 380), status: c.done || done ? 'done' : stuck && c === open[0] ? 'blocked' : c === open[0] ? 'doing' : 'todo' })),
  };
  const flags = (progressing: boolean): Omit<ProgressBody, 'stall'> => ({
    satisfied: done, looping: false, progressing, notes: 'DEMO sample: illustrative only.',
    ...(open[0] ? { next_speaker: 'gm', next_instruction: cut(`Work on: ${open[0].text}`, 580) } : {}),
  });
  const hist: ProgressBody[] = [];
  const push = (progressing: boolean) => { const f = flags(progressing); hist.push({ ...f, stall: stallCheck([...hist, { ...f, stall: 0 }]).counter }); };
  if (stuck) { push(true); push(false); push(false); push(false); } else push(!['queued', 'draft'].includes(m.status));
  return [{ kind: 'task', body: task }, ...hist.map((body) => ({ kind: 'progress' as const, body }))];
}
