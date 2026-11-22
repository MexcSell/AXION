import { useEffect } from 'react';
import { create } from 'zustand';
import type { ProcessDto, ProcessWindow } from '@contracts';
import { api, ApiFailure } from './client';
import { isApi } from './mode';
import { makeScorecardCache } from './scorecardCache';
import { useScorecardTick, onScorecardClear } from './scorecard';

/**
 * Process metrics (improvement cycle 69, api mode only): one server computation per (window, department), from GET /company/process. Same
 * session-safe cache as the six dimensions: one read per key and tick, an older read never overwrites a newer one, a sign-out drops late responses.
 */
interface Entry { data: ProcessDto | null; error: string | null; tick?: number }
const useStore = create<{ byKey: Record<string, Entry> }>(() => ({ byKey: {} }));
const cache = makeScorecardCache<ProcessDto>(
  (query) => api<ProcessDto>('GET', `/company/process?${query}`),
  (e) => (e instanceof ApiFailure ? e.message : 'Something went wrong.'),
);
cache.subscribe((byKey) => useStore.setState({ byKey }));
onScorecardClear.add(() => cache.clear());

export function useProcess(w: ProcessWindow, department: string | null): Entry {
  const tick = useScorecardTick();
  const key = `${w}|${department ?? ''}`;
  const entry = useStore((s) => s.byKey[key]);
  useEffect(() => {
    if (isApi()) void cache.load(key, `window=${w}${department ? `&department=${encodeURIComponent(department)}` : ''}`, tick);
  }, [key, w, department, tick]);
  return entry ?? { data: null, error: null };
}
