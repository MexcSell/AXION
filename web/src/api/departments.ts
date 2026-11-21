import { useEffect } from 'react';
import { create } from 'zustand';
import type { DepartmentsDto, ScorecardWindow } from '@contracts';
import { api, ApiFailure } from './client';
import { isApi } from './mode';
import { makeScorecardCache } from './scorecardCache';

/**
 * Department facts (improvement cycle 6, api mode only): the server counts them from recorded rows for the missions the
 * caller can see. Cached per query (window + DEMO switch) with cycle 2's session-safe cache: one read per key and tick,
 * older reads never overwrite newer ones, and a sign-out drops responses still in flight. `bumpDepartments`
 * (api/events.ts: instance.*, task.*, org.*, agent.*, mission.* and reconnect; debounced) re-reads.
 */
interface Entry { data: DepartmentsDto | null; error: string | null; tick?: number }
const useStore = create<{ tick: number; byKey: Record<string, Entry> }>(() => ({ tick: 0, byKey: {} }));
export const bumpDepartments = () => useStore.setState((s) => ({ tick: s.tick + 1 }));

const cache = makeScorecardCache<DepartmentsDto>(
  (query) => api<DepartmentsDto>('GET', `/departments?${query}`),
  (e) => (e instanceof ApiFailure ? e.message : 'Something went wrong.'),
);
cache.subscribe((byKey) => useStore.setState({ byKey }));
/** Sign-out: forget every number and drop responses still in flight (they belong to the previous session). */
export const clearDepartments = () => { cache.clear(); useStore.setState((s) => ({ tick: s.tick + 1 })); };

export function useDepartments(w: ScorecardWindow = '30d', includeDemo = false): Entry {
  const tick = useStore((s) => s.tick);
  const key = `${w}|${includeDemo ? 1 : 0}`;
  const entry = useStore((s) => s.byKey[key]);
  useEffect(() => { if (isApi()) void cache.load(key, `window=${w}&includeDemo=${includeDemo ? 1 : 0}`, tick); }, [key, w, includeDemo, tick]);
  return entry ?? { data: null, error: null };
}
