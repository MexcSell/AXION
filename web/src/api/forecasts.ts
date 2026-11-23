import { useEffect, useState } from 'react';
import { create } from 'zustand';
import type { ForecastLedgerDto, ForecastRecordDto } from '@contracts';
import { api, ApiFailure, newKey } from './client';
import { isApi } from './mode';
import { useReviewsTick } from './taskReviews';
import { plainError } from '@/lib/plainError';

/**
 * c89: the forecast ledger (api mode only). GET /me/forecasts is the person's own record; GET /users/:id/forecasts (administrators) reads ONE
 * person at a time. There is no route that lists people, so this file has no such read. The ledger re-reads after a forecast is recorded and
 * after every task.reviewed event (a review resolves forecasts).
 */
const useTick = create<{ n: number }>(() => ({ n: 0 }));
export const bumpForecasts = () => useTick.setState((s) => ({ n: s.n + 1 }));

export interface LedgerRead { data: ForecastLedgerDto | null; error: string | null; retry: () => void }
function useLedger(path: string | null): LedgerRead {
  const tick = useTick((s) => s.n);
  const rtick = useReviewsTick();
  const [st, setSt] = useState<{ path: string | null; data: ForecastLedgerDto | null; error: string | null }>({ path: null, data: null, error: null });
  useEffect(() => {
    if (!isApi() || !path) return;
    let live = true;
    api<ForecastLedgerDto>('GET', path)
      .then((r) => { if (live) setSt({ path, data: r, error: null }); })
      .catch((e) => { if (live) setSt((x) => ({ path, data: x.path === path ? x.data : null, error: plainError(e) })); });
    return () => { live = false; };
  }, [path, tick, rtick]);
  return { data: st.path === path ? st.data : null, error: st.path === path ? st.error : null, retry: bumpForecasts };
}
export const useMyForecasts = (enabled = true): LedgerRead => useLedger(enabled ? '/me/forecasts' : null);
/** Administrators only: one person's record (the server refuses anyone else with 403). */
export const useUserForecasts = (userId: string | null): LedgerRead => useLedger(userId ? `/users/${encodeURIComponent(userId)}/forecasts` : null);

export type ForecastWrite = { ok: true; value: ForecastRecordDto['forecast'] } | { ok: false; code: string; message: string };
/** Records the person's one forecast for a task: `percent` is a whole number 1..99. */
export async function recordForecast(taskId: string, percent: number, idempotencyKey: string): Promise<ForecastWrite> {
  try {
    const r = await api<ForecastRecordDto>('POST', `/tasks/${encodeURIComponent(taskId)}/forecasts`, { probability: percent / 100 }, { idempotencyKey });
    bumpForecasts();
    return { ok: true, value: r.forecast };
  } catch (e) {
    bumpForecasts();
    return { ok: false, code: e instanceof ApiFailure ? e.code : 'UNKNOWN', message: plainError(e) };
  }
}
export { newKey };
