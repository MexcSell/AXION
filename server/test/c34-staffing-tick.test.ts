import { describe, it, expect } from 'vitest';
import { tickStaffing } from '../../web/src/features/mission/staffing-plan.ts';

// c34: the demo staffing driver reads the CURRENT mission inside the tick, so a mission archived or paused after the
// render-time list was captured is never advanced.
const mk = (id: string, status: string) => ({
  id, status, progress: 0, agentIds: ['gm'], leadId: 'gm', executorId: 'research-01',
  staffing: { stage: 'reading', joined: 0, plan: [], log: [] },
}) as any;

describe('tickStaffing', () => {
  it('advances a fresh planning mission', () => {
    const fresh = mk('a', 'planning'); const seen: string[] = [];
    tickStaffing([mk('a', 'planning')], (id) => (id === 'a' ? fresh : undefined), (id) => seen.push(id), 1);
    expect(seen).toEqual(['a']);
  });
  it.each(['archived', 'paused'])('never advances a mission the store already holds as %s, even when the captured copy is stale', (status) => {
    const seen: string[] = [];
    tickStaffing([mk('a', 'planning')], () => mk('a', status), (id) => seen.push(id), 1);
    expect(seen).toEqual([]);
  });
  it('skips a mission that is gone from the store', () => {
    const seen: string[] = [];
    tickStaffing([mk('a', 'planning')], () => undefined, (id) => seen.push(id), 1);
    expect(seen).toEqual([]);
  });
  it('re-reads between missions: an earlier update that archives a later mission stops it', () => {
    const store: Record<string, any> = { a: mk('a', 'planning'), b: mk('b', 'planning') };
    const seen: string[] = [];
    tickStaffing([store.a, store.b], (id) => store[id], (id) => { seen.push(id); if (id === 'a') store.b = mk('b', 'archived'); }, 1);
    expect(seen).toEqual(['a']);
  });
});
