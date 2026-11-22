import { useCallback, useEffect, useState } from 'react';
import { create } from 'zustand';
import type { AttentionDto } from '@contracts';
import { api, ApiFailure } from './client';
import { isApi } from './mode';
import { ATTENTION_DEMO } from '@/data/attentionDemo';

/**
 * The attention queue, "Needs you" (c68, api mode). One read of GET /attention. It re-reads on every event that can change it
 * (approvals, tasks, failures, proposals, lessons; see api/events.ts) and on a stream reconnect, and once a minute so ages and
 * expiry times stay current. Demo mode shows the labelled sample in data/attentionDemo.ts.
 */
const useTick = create<{ n: number }>(() => ({ n: 0 }));
export const bumpAttention = () => useTick.setState((s) => ({ n: s.n + 1 }));

export interface AttentionState { data: AttentionDto | null; error: string | null; loading: boolean; retry: () => void }
const REFRESH_MS = 60_000;

export function useAttention(): AttentionState {
  const tick = useTick((s) => s.n);
  const [local, setLocal] = useState(0);
  const [st, setSt] = useState<{ data: AttentionDto | null; error: string | null; done: boolean }>({ data: null, error: null, done: false });
  useEffect(() => {
    if (!isApi()) return;
    let live = true;
    api<AttentionDto>('GET', '/attention')
      .then((r) => { if (live) setSt({ data: r, error: null, done: true }); })
      .catch((e) => { if (live) setSt((x) => ({ data: x.data, error: e instanceof ApiFailure ? e.message : 'Something went wrong.', done: true })); });
    return () => { live = false; };
  }, [tick, local]);
  useEffect(() => {
    if (!isApi()) return;
    const t = window.setInterval(() => setLocal((n) => n + 1), REFRESH_MS);
    return () => window.clearInterval(t);
  }, []);
  const retry = useCallback(() => setLocal((n) => n + 1), []);
  if (!isApi()) return { data: ATTENTION_DEMO, error: null, loading: false, retry };
  return { data: st.data, error: st.error, loading: !st.done, retry };
}
