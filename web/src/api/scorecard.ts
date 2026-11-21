import { useEffect } from 'react';
import { create } from 'zustand';
import type { CompanyScorecardDto, ScorecardRow, ScorecardWindow } from '@contracts';
import { api, ApiFailure } from './client';
import { isApi } from './mode';
import { makeScorecardCache } from './scorecardCache';

/**
 * Company scorecard (improvement cycle 2, api mode only): one server computation from recorded rows. Results are kept
 * per query (window + DEMO switch) so the Overview tile, the scorecard panel and the Missions header share one read.
 * `bumpScorecard` (api/events.ts: mission.stateChanged, task.stateChanged, sharing/deletes, reconnect; debounced) re-reads.
 */
interface Entry { data: CompanyScorecardDto | null; error: string | null; tick?: number }
const useStore = create<{ tick: number; byKey: Record<string, Entry> }>(() => ({ tick: 0, byKey: {} }));
export const bumpScorecard = () => useStore.setState((s) => ({ tick: s.tick + 1 }));

// one read per query and refresh tick; older reads never overwrite newer ones; a sign-out drops late responses (m2)
const cache = makeScorecardCache<CompanyScorecardDto>(
  (query) => api<CompanyScorecardDto>('GET', `/company/scorecard?${query}`),
  (e) => (e instanceof ApiFailure ? e.message : 'Something went wrong.'),
);
cache.subscribe((byKey) => useStore.setState({ byKey }));
/** Sign-out: forget every number and drop responses still in flight (they belong to the previous session). */
export const clearScorecard = () => { cache.clear(); useStore.setState((s) => ({ tick: s.tick + 1 })); };

export function useScorecard(w: ScorecardWindow = '30d', includeDemo = false): Entry {
  const tick = useStore((s) => s.tick);
  const key = `${w}|${includeDemo ? 1 : 0}`;
  const entry = useStore((s) => s.byKey[key]);
  useEffect(() => { if (isApi()) void cache.load(key, `window=${w}&includeDemo=${includeDemo ? 1 : 0}`, tick); }, [key, w, includeDemo, tick]);
  return entry ?? { data: null, error: null };
}

export const rowOf = (d: CompanyScorecardDto | null, key: ScorecardRow['key']) => d?.rows.find((r) => r.key === key);

/** A row's value as text: "—" when there is no evidence (state 'none'); never branch on truthiness (0 is a value). */
export function fmtRow(r: ScorecardRow): string {
  if (r.state !== 'ok' || r.value === null) return '—';
  if (r.unit === '%') return `${r.value.toFixed(1)}%`;
  if (r.unit === 'h') return `${r.value < 10 ? r.value.toFixed(1) : Math.round(r.value)} h`;
  return String(r.value);
}
