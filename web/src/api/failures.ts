import { useEffect, useState } from 'react';
import { create } from 'zustand';
import type { FailureTagDto, FailureSubjectInfo, FailureModesDto, FailureSubjectKind, ScorecardWindow } from '@contracts';
import { api, ApiFailure, newKey } from './client';
import { isApi } from './mode';

/**
 * Failure-mode tags (improvement cycle 33, api mode only). Reads re-run on every failure.* event and on a stream reconnect
 * (bumpFailures, from api/events.ts). Only recorded facts: a tag is proposed until a person decides; only confirmed tags are counted.
 */
const useTick = create<{ n: number }>(() => ({ n: 0 }));
export const bumpFailures = () => useTick.setState((s) => ({ n: s.n + 1 }));

interface Read<T> { data: T | null; error: string | null; retry: () => void }
const msg = (e: unknown) => (e instanceof ApiFailure ? e.message : 'Something went wrong.');

/** The tags on one subject, and what the server knows about it (failed, retried, DEMO). */
export function useFailureTags(kind: FailureSubjectKind, id: string): Read<{ subject: FailureSubjectInfo; tags: FailureTagDto[] }> {
  const tick = useTick((s) => s.n);
  const key = `${kind}|${id}`;
  const [st, setSt] = useState<{ key: string; data: { subject: FailureSubjectInfo; tags: FailureTagDto[] } | null; error: string | null }>({ key, data: null, error: null });
  useEffect(() => {
    if (!isApi() || !id) return;
    let live = true;
    api<{ subject: FailureSubjectInfo; tags: FailureTagDto[] }>('GET', `/failure-tags?subjectKind=${kind}&subjectId=${encodeURIComponent(id)}`)
      .then((r) => { if (live) setSt({ key, data: r, error: null }); })
      .catch((e) => { if (live) setSt((x) => ({ key, data: x.key === key ? x.data : null, error: msg(e) })); });
    return () => { live = false; };
  }, [key, kind, id, tick]);
  return { data: st.key === key ? st.data : null, error: st.key === key ? st.error : null, retry: bumpFailures };
}

/** Confirmed tags per mode and category over a window (GET /company/failure-modes). */
export function useFailureModes(window: ScorecardWindow, includeDemo: boolean): Read<FailureModesDto> {
  const tick = useTick((s) => s.n);
  const key = `${window}|${includeDemo ? 1 : 0}`;
  const [st, setSt] = useState<{ key: string; data: FailureModesDto | null; error: string | null }>({ key, data: null, error: null });
  useEffect(() => {
    if (!isApi()) return;
    let live = true;
    api<FailureModesDto>('GET', `/company/failure-modes?window=${window}&includeDemo=${includeDemo ? 1 : 0}`)
      .then((r) => { if (live) setSt({ key, data: r, error: null }); })
      .catch((e) => { if (live) setSt((x) => ({ key, data: x.key === key ? x.data : null, error: msg(e) })); });
    return () => { live = false; };
  }, [key, window, includeDemo, tick]);
  return { data: st.key === key ? st.data : null, error: st.key === key ? st.error : null, retry: bumpFailures };
}

export type Write<T> = { ok: true; value: T } | { ok: false; code: string; message: string; fieldErrors?: Record<string, string> };
const fail = (e: unknown): { ok: false; code: string; message: string; fieldErrors?: Record<string, string> } =>
  (e instanceof ApiFailure ? { ok: false, code: e.code, message: e.message, fieldErrors: e.fieldErrors } : { ok: false, code: 'UNKNOWN', message: 'Something went wrong.' });

export async function tagFailure(body: { subjectKind: FailureSubjectKind; subjectId: string; modeId: string; note?: string; detectionChannel?: string; mechanism?: string; controlExpected?: string; controlCaught?: string; detectionNote?: string }, idempotencyKey: string): Promise<Write<FailureTagDto>> {
  try { const r = await api<{ tag: FailureTagDto }>('POST', '/failure-tags', body, { idempotencyKey }); bumpFailures(); return { ok: true, value: r.tag }; }
  catch (e) { bumpFailures(); return fail(e); }
}
export async function decideFailureTag(id: string, decision: 'confirm' | 'reject'): Promise<Write<FailureTagDto>> {
  try { const r = await api<{ tag: FailureTagDto }>('POST', `/failure-tags/${encodeURIComponent(id)}/decision`, { decision }); bumpFailures(); return { ok: true, value: r.tag }; }
  catch (e) { bumpFailures(); return fail(e); }
}
export { newKey };
