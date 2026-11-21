import { useEffect } from 'react';
import { create } from 'zustand';
import type { ThroughputDto } from '@contracts';
import { api, ApiFailure } from './client';
import { isApi } from './mode';
import { makeScorecardCache } from './scorecardCache';
import { onScorecardClear, useScorecardTick } from './scorecard';

/** Weekly throughput (improvement cycle 12, api mode): same cache and refresh tick as the scorecard. */
const useStore = create<{ byKey: Record<string, { data: ThroughputDto | null; error: string | null }> }>(() => ({ byKey: {} }));
const cache = makeScorecardCache<ThroughputDto>(
  (query) => api<ThroughputDto>('GET', `/company/throughput?${query}`),
  (e) => (e instanceof ApiFailure ? e.message : 'Something went wrong.'),
);
cache.subscribe((byKey) => useStore.setState({ byKey }));
onScorecardClear.add(() => cache.clear());

export function useThroughput(weeks = 8, includeDemo = false) {
  const tick = useScorecardTick();
  const key = `${weeks}|${includeDemo ? 1 : 0}`;
  const entry = useStore((s) => s.byKey[key]);
  useEffect(() => { if (isApi()) void cache.load(key, `weeks=${weeks}&includeDemo=${includeDemo ? 1 : 0}`, tick); }, [key, weeks, includeDemo, tick]);
  return entry ?? { data: null, error: null };
}
