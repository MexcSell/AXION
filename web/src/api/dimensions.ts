import { useEffect } from 'react';
import { create } from 'zustand';
import type { CompanyDimensionsDto, DimensionWindow } from '@contracts';
import { api, ApiFailure } from './client';
import { isApi } from './mode';
import { makeScorecardCache } from './scorecardCache';
import { useScorecardTick, onScorecardClear } from './scorecard';

/**
 * Six dimensions (improvement cycle 46, api mode only): one server computation per (window, department). It follows the
 * scorecard's refresh tick (mission and task events) and its sign-out, with the same session-safe cache (one read per key and
 * tick; an older read never overwrites a newer one; a sign-out drops responses still in flight).
 */
interface Entry { data: CompanyDimensionsDto | null; error: string | null; tick?: number }
const useStore = create<{ byKey: Record<string, Entry> }>(() => ({ byKey: {} }));
const cache = makeScorecardCache<CompanyDimensionsDto>(
  (query) => api<CompanyDimensionsDto>('GET', `/company/dimensions?${query}`),
  (e) => (e instanceof ApiFailure ? e.message : 'Something went wrong.'),
);
cache.subscribe((byKey) => useStore.setState({ byKey }));
onScorecardClear.add(() => cache.clear());

export function useDimensions(w: DimensionWindow, department: string | null): Entry {
  const tick = useScorecardTick();
  const key = `${w}|${department ?? ''}`;
  const entry = useStore((s) => s.byKey[key]);
  useEffect(() => {
    if (isApi()) void cache.load(key, `window=${w}${department ? `&department=${encodeURIComponent(department)}` : ''}`, tick);
  }, [key, w, department, tick]);
  return entry ?? { data: null, error: null };
}
