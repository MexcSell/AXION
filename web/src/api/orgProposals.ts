import { useEffect, useState } from 'react';
import { create } from 'zustand';
import type { RestructureTrigger, OrgCoverage, OrgDiffDto, OrgDryRun, OrgEdgeDto, OrgPlanDto, OrgProposalDto, OrgRevisionSummaryDto } from '@contracts';
import { api, ApiFailure, newKey } from './client';
import { isApi } from './mode';
import { plainError } from '@/lib/plainError';

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

export interface ProposalBody { title: string; why: string; baseRevision: number; edges: OrgEdgeDto[]; triggers?: RestructureTrigger[]; baseline?: string; expectedCost?: string }
/** The server's dry run of a proposal: stores nothing (POST ?dryRun=1). */
export async function dryRunProposal(body: ProposalBody, signal?: AbortSignal): Promise<Write<OrgDryRun>> {
  try { return { ok: true, value: (await api<{ result: OrgDryRun }>('POST', '/organization/proposals?dryRun=1', body, { signal })).result }; }
  catch (e) { return fail(e); }
}
export async function createProposal(body: ProposalBody, idempotencyKey: string): Promise<Write<OrgProposalDto>> {
  try { const r = await api<{ proposal: OrgProposalDto }>('POST', '/organization/proposals', body, { idempotencyKey }); bumpProposals(); return { ok: true, value: r.proposal }; }
  catch (e) { return fail(e); }
}
/** c89: approving a proposal that has a change plan sends the plan's sha (planSha) that the approver read on the card. */
export async function decideProposal(p: OrgProposalDto, decision: 'approve' | 'reject', note: string, planSha?: string | null): Promise<Write<OrgProposalDto>> {
  try { const r = await api<{ proposal: OrgProposalDto }>('POST', `/organization/proposals/${p.id}/decision`, { decision, sha: p.sha, ...(decision === 'approve' && planSha ? { planSha } : {}), ...(note.trim() ? { note: note.trim() } : {}) }); bumpProposals(); return { ok: true, value: r.proposal }; }
  catch (e) { bumpProposals(); return { ok: false, code: e instanceof ApiFailure ? e.code : 'UNKNOWN', message: plainError(e) }; } // e.g. expired or stale: show the current state too
}
export async function withdrawProposal(p: OrgProposalDto): Promise<Write<OrgProposalDto>> {
  try { const r = await api<{ proposal: OrgProposalDto }>('POST', `/organization/proposals/${p.id}/withdraw`); bumpProposals(); return { ok: true, value: r.proposal }; }
  catch (e) { bumpProposals(); return fail(e); }
}

/* Improvement cycle 4: organisation history. Re-read on the same tick as the proposals (every org.* event, agent.created and a
   stream reconnect), so the timeline and the open diff follow a revision applied anywhere. */
export function useRead<T>(path: string | null): { data: T | null; error: string | null; retry: () => void } {
  const tick = useTick((s) => s.n);
  const [st, setSt] = useState<{ data: T | null; error: string | null; path: string | null }>({ data: null, error: null, path: null });
  useEffect(() => {
    if (!isApi() || !path) return;
    let live = true;
    api<T>('GET', path)
      .then((r) => { if (live) setSt({ data: r, error: null, path }); })
      .catch((e) => { if (live) setSt((x) => ({ data: x.path === path ? x.data : null, error: e instanceof ApiFailure ? e.message : 'Something went wrong.', path })); });
    return () => { live = false; };
  }, [path, tick]);
  return { data: st.path === path ? st.data : null, error: st.path === path ? st.error : null, retry: bumpProposals };
}
export const useOrgRevisions = () => useRead<{ revisions: OrgRevisionSummaryDto[] }>('/organization/revisions');
/** The diff of revision `seq` against the revision before it, with the visible active missions it touches. */
export const useRevisionDiff = (seq: number | null) => useRead<OrgDiffDto>(seq === null ? null : `/organization/revisions/${seq}/diff`);
/** A rollback is a new ordinary proposal (another administrator decides it); it never changes the chart by itself. */
export async function proposeRollback(seq: number, why: string, idempotencyKey: string): Promise<Write<OrgProposalDto>> {
  try {
    const r = await api<{ proposal: OrgProposalDto }>('POST', `/organization/revisions/${seq}/rollback-proposal`, why.trim() ? { why: why.trim() } : {}, { idempotencyKey });
    bumpProposals();
    return { ok: true, value: r.proposal };
  } catch (e) { return fail(e); }
}
export { newKey };
/** Improvement cycle 20: coverage facts of the active organisation revision. */
export const useOrgCoverage = () => useRead<{ revision: number; coverage: OrgCoverage }>('/organization/coverage');
/** c89 (administrators): the change plan and, for an applied proposal, the counts per window. Any other caller gets 403, which is why callers pass `null` unless they are an administrator. */
export const useOrgPlan = (proposalId: string | null) => useRead<OrgPlanDto>(proposalId ? `/organization/proposals/${encodeURIComponent(proposalId)}/plan` : null);
