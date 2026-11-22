import { useCallback, useEffect, useState } from 'react';
import type { ReviewCapacityDto, CapacityPeopleBody } from '@contracts';
import { api, ApiFailure } from './client';
import { isApi } from './mode';

/**
 * Review capacity (c65, api mode). The aggregate is read by everyone. The per-person table is requested only for an administrator
 * (the server refuses anyone else), and only when `wantPeople` is set, so the client never holds per-person numbers it should not show.
 */
export interface CapacityState { review: ReviewCapacityDto | null; people: CapacityPeopleBody | null; error: string | null; loading: boolean; retry: () => void }
export function useReviewCapacity(windowDays: number, admin: boolean, wantPeople: boolean): CapacityState {
  const [st, setSt] = useState<{ review: ReviewCapacityDto | null; people: CapacityPeopleBody | null; error: string | null; for: string }>({ review: null, people: null, error: null, for: '' });
  const [tick, setTick] = useState(0);
  const key = `${windowDays}|${admin && wantPeople ? 'p' : 'a'}|${tick}`;
  useEffect(() => {
    if (!isApi()) return;
    let live = true;
    const q = `?windowDays=${windowDays}`;
    Promise.all([
      api<{ review: ReviewCapacityDto }>('GET', `/review-capacity${q}`),
      admin && wantPeople ? api<CapacityPeopleBody>('GET', `/review-capacity/people${q}`) : Promise.resolve(null),
    ]).then(([a, p]) => { if (live) setSt({ review: a.review, people: p, error: null, for: key }); })
      .catch((e) => { if (live) setSt((x) => ({ ...x, error: e instanceof ApiFailure ? e.message : 'Something went wrong.', for: key })); });
    return () => { live = false; };
  }, [windowDays, admin, wantPeople, key]);
  const retry = useCallback(() => setTick((n) => n + 1), []);
  const cur = st.for === key;
  return { review: cur ? st.review : st.review && st.for.split('|')[0] === String(windowDays) ? st.review : null, people: cur ? st.people : null, error: cur ? st.error : null, loading: !cur, retry };
}
