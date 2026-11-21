import { useEffect } from 'react';
import { create } from 'zustand';
import type { CompanyScorecardDto, ScorecardRow, ScorecardWindow } from '@contracts';
import { api, ApiFailure } from './client';
import { isApi } from './mode';

/**
 * Company scorecard (improvement cycle 2, api mode only): one server computation from recorded rows. Results are kept
 * per query (window + DEMO switch) so the Overview tile, the scorecard panel and the Missions header share one read.
 * `bumpScorecard` (api/events.ts: mission.stateChanged, task.stateChanged, sharing/deletes, reconnect; debounced) re-reads.
 */
interface Entry { data: CompanyScorecardDto | null; error: string | null; tick?: number }
const useStore = create<{ tick: number; byKey: Record<string, Entry> }>(() => ({ tick: 0, byKey: {} }));
export const bumpScorecard = () => useStore.setState((s) => ({ tick: s.tick + 1 }));
export const clearScorecard = () => useStore.setState({ byKey: {} });

const inflight = new Set<string>();
function load(w: ScorecardWindow, includeDemo: boolean, tick: number) {
  const key = `${w}|${includeDemo ? 1 : 0}`;
  const once = `${key}|${tick}`; // one read per query and refresh tick, however many components ask
  if (inflight.has(once)) return;
  inflight.add(once);
  api<CompanyScorecardDto>('GET', `/company/scorecard?window=${w}&includeDemo=${includeDemo ? 1 : 0}`)
    // a slower, older read never overwrites a newer one
    .then((data) => useStore.setState((s) => ((s.byKey[key]?.tick ?? -1) > tick ? s : { byKey: { ...s.byKey, [key]: { data, error: null, tick } } })))
    .catch((e) => useStore.setState((s) => ({ byKey: { ...s.byKey, [key]: { data: s.byKey[key]?.data ?? null, error: e instanceof ApiFailure ? e.message : 'Something went wrong.' } } })))
    .finally(() => { inflight.delete(once); });
}

export function useScorecard(w: ScorecardWindow = '30d', includeDemo = false): Entry {
  const tick = useStore((s) => s.tick);
  const entry = useStore((s) => s.byKey[`${w}|${includeDemo ? 1 : 0}`]);
  useEffect(() => { if (isApi()) load(w, includeDemo, tick); }, [w, includeDemo, tick]);
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
