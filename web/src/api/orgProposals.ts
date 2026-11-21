import { useEffect, useState } from 'react';
import { create } from 'zustand';
import type { OrgDryRun, OrgEdgeDto, OrgProposalDto } from '@contracts';
import { api, ApiFailure, newKey } from './client';
import { isApi } from './mode';

/**
 * Organisation change proposals (improvement cycle 1, api mode only). The list re-reads on every org.* event and on a
 * stream reconnect (bumpProposals, from api/events.ts); an applied proposal also reloads the agent catalog there, which
 * makes useOrgGraph re-read the reporting lines.
 */
const useTick = create<{ n: number }>(() => ({ n: 0 }));
export const bumpProposals = () => useTick.setState((s) => ({ n: s.n + 1 }));

export interface ProposalList { proposals: OrgProposalDto[]; activeRevision: number }
export function useOrgProposals(): { data: ProposalList | null; error: string | null; retry: () => void } {
  const tick = useTick((s) => s.n);
  const [st, setSt] = useState<{ data: ProposalList | null; error: string | null }>({ data: null, error: null });
  useEffect(() => {
    if (!isApi()) return;
    let live = true;
    api<ProposalList>('GET', '/organization/proposals')
      .then((r) => { if (live) setSt({ data: r, error: null }); })
      .catch((e) => { if (live) setSt((x) => ({ data: x.data, error: e instanceof ApiFailure ? e.message : 'Something went wrong.' })); });
    return () => { live = false; };
  }, [tick]);
  return { ...st, retry: bumpProposals };
}

export type Write<T> = { ok: true; value: T } | { ok: false; code: string; message: string };
const fail = (e: unknown): { ok: false; code: string; message: string } =>
  (e instanceof ApiFailure ? { ok: false, code: e.code, message: e.message } : { ok: false, code: 'UNKNOWN', message: 'Something went wrong.' });

export interface ProposalBody { title: string; why: string; baseRevision: number; edges: OrgEdgeDto[] }
/** The server's dry run of a proposal: stores nothing (POST ?dryRun=1). */
export async function dryRunProposal(body: ProposalBody, signal?: AbortSignal): Promise<Write<OrgDryRun>> {
  try { return { ok: true, value: (await api<{ result: OrgDryRun }>('POST', '/organization/proposals?dryRun=1', body, { signal })).result }; }
  catch (e) { return fail(e); }
}
export async function createProposal(body: ProposalBody, idempotencyKey: string): Promise<Write<OrgProposalDto>> {
  try { const r = await api<{ proposal: OrgProposalDto }>('POST', '/organization/proposals', body, { idempotencyKey }); bumpProposals(); return { ok: true, value: r.proposal }; }
  catch (e) { return fail(e); }
}
export async function decideProposal(p: OrgProposalDto, decision: 'approve' | 'reject', note: string): Promise<Write<OrgProposalDto>> {
  try { const r = await api<{ proposal: OrgProposalDto }>('POST', `/organization/proposals/${p.id}/decision`, { decision, sha: p.sha, ...(note.trim() ? { note: note.trim() } : {}) }); bumpProposals(); return { ok: true, value: r.proposal }; }
  catch (e) { bumpProposals(); return fail(e); } // e.g. expired or stale: show the current state too
}
export async function withdrawProposal(p: OrgProposalDto): Promise<Write<OrgProposalDto>> {
  try { const r = await api<{ proposal: OrgProposalDto }>('POST', `/organization/proposals/${p.id}/withdraw`); bumpProposals(); return { ok: true, value: r.proposal }; }
  catch (e) { bumpProposals(); return fail(e); }
}
export { newKey };
