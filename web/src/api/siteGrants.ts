import { useEffect, useState } from 'react';
import { create } from 'zustand';
import type { OriginCheckDto, SiteGrantDto } from '@contracts';
import { api, ApiFailure, newKey } from './client';
import { isApi } from './mode';

/** Site grants (c36, api mode, administrators). The list is re-read on every grant.* event and on a stream reconnect. */
const useTick = create<{ n: number }>(() => ({ n: 0 }));
export const bumpGrants = () => useTick.setState((s) => ({ n: s.n + 1 }));

export interface GrantList { grants: SiteGrantDto[]; maxDays: number; capabilities: string[] }
export function useSiteGrants(enabled: boolean): { data: GrantList | null; error: string | null; retry: () => void } {
  const tick = useTick((s) => s.n);
  const [st, setSt] = useState<{ data: GrantList | null; error: string | null }>({ data: null, error: null });
  useEffect(() => {
    if (!isApi() || !enabled) return;
    let live = true;
    api<GrantList>('GET', '/site-grants').then((r) => { if (live) setSt({ data: r, error: null }); })
      .catch((e) => { if (live) setSt((x) => ({ data: x.data, error: e instanceof ApiFailure ? e.message : 'Something went wrong.' })); });
    return () => { live = false; };
  }, [tick, enabled]);
  return { ...st, retry: bumpGrants };
}

export type Write<T> = { ok: true; value: T } | { ok: false; code: string; message: string; fieldErrors?: Record<string, string> };
const fail = (e: unknown): { ok: false; code: string; message: string; fieldErrors?: Record<string, string> } =>
  (e instanceof ApiFailure ? { ok: false, code: e.code, message: e.message, fieldErrors: e.fieldErrors } : { ok: false, code: 'UNKNOWN', message: 'Something went wrong.' });

export interface GrantBody { origin: string; missionId: string; capabilities: string[]; expiresAt: string }
export async function issueGrant(body: GrantBody, idempotencyKey: string): Promise<Write<SiteGrantDto>> {
  try { const r = await api<{ grant: SiteGrantDto }>('POST', '/site-grants', body, { idempotencyKey }); bumpGrants(); return { ok: true, value: r.grant }; }
  catch (e) { bumpGrants(); return fail(e); }
}
export async function revokeGrant(id: string, reason: string): Promise<Write<SiteGrantDto>> {
  try { const r = await api<{ grant: SiteGrantDto }>('POST', `/site-grants/${encodeURIComponent(id)}/revoke`, reason.trim() ? { reason: reason.trim() } : {}); bumpGrants(); return { ok: true, value: r.grant }; }
  catch (e) { bumpGrants(); return fail(e); }
}
/** The server's own normaliser, so the dialog and the server can never disagree. Pure: nothing is stored or fetched. */
export async function checkOrigin(origin: string, signal?: AbortSignal): Promise<OriginCheckDto | null> {
  try { return await api<OriginCheckDto>('GET', `/site-grants/validate?origin=${encodeURIComponent(origin)}`, undefined, { signal }); } catch { return null; }
}
export { newKey };
