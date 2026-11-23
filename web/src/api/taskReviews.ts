import { useEffect, useState } from 'react';
import { create } from 'zustand';
import type { CreateTaskReviewBody, TaskReviewDto, TaskReviewsDto } from '@contracts';
import { api, ApiFailure, newKey } from './client';
import { isApi } from './mode';

/**
 * Independent task review (improvement cycle 38, api mode only). One read per task (GET /tasks/:id/reviews); the server
 * decides `canReview` and derives the producer, so nothing here guesses it. Re-read on every task.reviewed event
 * (bumpTaskReviews, from api/events.ts) and on a stream reconnect.
 */
const useTick = create<{ n: number }>(() => ({ n: 0 }));
export const bumpTaskReviews = () => useTick.setState((s) => ({ n: s.n + 1 }));
export const taskReviewsTick = () => useTick.getState().n;
/** c89: lets the forecast ledger re-read after a review (a review resolves forecasts) */
export const useReviewsTick = () => useTick((s) => s.n);

export interface ReviewsRead { data: TaskReviewsDto | null; error: string | null; retry: () => void }
export function useTaskReviews(taskId: string | undefined): ReviewsRead {
  const tick = useTick((s) => s.n);
  const [st, setSt] = useState<{ id?: string; data: TaskReviewsDto | null; error: string | null }>({ data: null, error: null });
  useEffect(() => {
    if (!isApi() || !taskId) return;
    let live = true;
    api<TaskReviewsDto>('GET', `/tasks/${encodeURIComponent(taskId)}/reviews`).then((r) => { if (live) setSt({ id: taskId, data: r, error: null }); })
      .catch((e) => { if (live) setSt((x) => ({ id: taskId, data: x.id === taskId ? x.data : null, error: e instanceof ApiFailure ? e.message : 'Something went wrong.' })); });
    return () => { live = false; };
  }, [taskId, tick]);
  return { data: st.id === taskId ? st.data : null, error: st.error, retry: bumpTaskReviews };
}

export type ReviewWrite = { ok: true; review: TaskReviewDto } | { ok: false; code: string; message: string; fieldErrors?: Record<string, string> };
export async function submitTaskReview(taskId: string, body: CreateTaskReviewBody, idempotencyKey: string): Promise<ReviewWrite> {
  try {
    const r = await api<{ review: TaskReviewDto }>('POST', `/tasks/${encodeURIComponent(taskId)}/reviews`, body, { idempotencyKey });
    bumpTaskReviews();
    return { ok: true, review: r.review };
  } catch (e) {
    bumpTaskReviews();
    return e instanceof ApiFailure ? { ok: false, code: e.code, message: e.message, fieldErrors: (e as { fieldErrors?: Record<string, string> }).fieldErrors } : { ok: false, code: 'UNKNOWN', message: 'Something went wrong.' };
  }
}
export { newKey };
