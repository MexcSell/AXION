import { useEffect, useState } from 'react';
import { create } from 'zustand';
import type { AgentDto, AgentVersionDto, VersionConfig, VersionDiff, VersionProposalDto } from '@contracts';
import { api, ApiFailure, newKey } from './client';
import { isApi } from './mode';
import { loadAgents } from './agents';

/**
 * Agent version proposals (improvement cycle 5, api mode only). Lists re-read on every agent.* event and on a stream
 * reconnect (bumpVersionProposals, from api/events.ts): a promote or a rollback also reloads the catalog there.
 */
const useTick = create<{ n: number }>(() => ({ n: 0 }));
export const bumpVersionProposals = () => useTick.setState((s) => ({ n: s.n + 1 }));
/** How many refreshes were requested so far (a check reads it to prove a pending refresh was cancelled on sign-out). */
export const versionProposalsTick = () => useTick.getState().n;

interface Read<T> { data: T | null; error: string | null; retry: () => void }
function useTickedRead<T>(path: string | null, pick: (r: any) => T): Read<T> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const tick = useTick((s) => s.n);
  const [st, setSt] = useState<{ path: string | null; data: T | null; error: string | null }>({ path, data: null, error: null });
  useEffect(() => {
    if (!path || !isApi()) return;
    let live = true;
    api<unknown>('GET', path).then((r) => { if (live) setSt({ path, data: pick(r), error: null }); })
      .catch((e) => { if (live) setSt((x) => ({ path, data: x.path === path ? x.data : null, error: e instanceof ApiFailure ? e.message : 'Something went wrong.' })); });
    return () => { live = false; };
  }, [path, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  return { data: st.path === path ? st.data : null, error: st.error, retry: bumpVersionProposals };
}

/** Every agent's proposals (GET /version-proposals), or one agent's. */
export const useVersionProposals = (agentId?: string) =>
  useTickedRead<VersionProposalDto[]>(agentId ? `/agents/${encodeURIComponent(agentId)}/version-proposals` : '/version-proposals', (r) => r.proposals ?? []);

/** One agent with its versions (GET /agents/:id): the active version id and config a proposal or a rollback starts from. */
export const useAgentDetail = (agentId: string | null) =>
  useTickedRead<AgentDto & { versions: AgentVersionDto[] }>(agentId ? `/agents/${encodeURIComponent(agentId)}` : null, (r) => r.agent);

export type Write<T> = { ok: true; value: T } | { ok: false; code: string; message: string };
const fail = (e: unknown): { ok: false; code: string; message: string } =>
  (e instanceof ApiFailure ? { ok: false, code: e.code, message: e.message } : { ok: false, code: 'UNKNOWN', message: 'Something went wrong.' });
const after = () => { bumpVersionProposals(); void loadAgents().catch(() => undefined); };

export interface VersionProposalBody { title: string; hypothesis: string; candidate: VersionConfig; baseVersionId: string }
export async function createVersionProposal(agentId: string, body: VersionProposalBody, idempotencyKey: string): Promise<Write<VersionProposalDto>> {
  try { const r = await api<{ proposal: VersionProposalDto }>('POST', `/agents/${encodeURIComponent(agentId)}/version-proposals`, body, { idempotencyKey }); bumpVersionProposals(); return { ok: true, value: r.proposal }; }
  catch (e) { if (e instanceof ApiFailure && e.code === 'AGENT_CHANGED') after(); return fail(e); }
}
/** overrideReason: the written reason to promote without a verified evaluation (the server decides whether it is needed). */
export async function decideVersionProposal(p: VersionProposalDto, decision: 'promote' | 'reject', note: string, overrideReason = ''): Promise<Write<VersionProposalDto>> {
  try { const r = await api<{ proposal: VersionProposalDto }>('POST', `/version-proposals/${p.id}/decision`, { decision, sha: p.sha, ...(note.trim() ? { note: note.trim() } : {}), ...(decision === 'promote' ? { evaluationSha: p.evaluationSha } : {}), ...(decision === 'promote' && overrideReason.trim() ? { overrideReason: overrideReason.trim() } : {}) }); after(); return { ok: true, value: r.proposal }; }
  catch (e) { bumpVersionProposals(); return fail(e); } // e.g. stale or expired: show the current state too
}
export async function withdrawVersionProposal(p: VersionProposalDto): Promise<Write<VersionProposalDto>> {
  try { const r = await api<{ proposal: VersionProposalDto }>('POST', `/version-proposals/${p.id}/withdraw`); bumpVersionProposals(); return { ok: true, value: r.proposal }; }
  catch (e) { bumpVersionProposals(); return fail(e); }
}
export async function rollbackAgent(agentId: string, toVersionId: string, why: string, idempotencyKey: string): Promise<Write<{ agent: AgentDto; version: AgentVersionDto }>> {
  try { const r = await api<{ agent: AgentDto; version: AgentVersionDto }>('POST', `/agents/${encodeURIComponent(agentId)}/rollback`, { toVersionId, why }, { idempotencyKey }); after(); return { ok: true, value: r }; }
  catch (e) { after(); return fail(e); }
}

/** The same rule as the server (configDiff): skills and tools are sets, order is no change. */
export function versionDiff(a: VersionConfig, b: VersionConfig): VersionDiff {
  const u = (xs: string[]) => [...new Set(xs.map((x) => x.trim()).filter(Boolean))];
  const minus = (x: string[], y: string[]) => u(x).filter((v) => !u(y).includes(v));
  const d = { skillsAdded: minus(b.skills, a.skills), skillsRemoved: minus(a.skills, b.skills), toolsAdded: minus(b.tools, a.tools), toolsRemoved: minus(a.tools, b.tools), model: a.model !== b.model ? { from: a.model, to: b.model } : null };
  return { ...d, changed: !!d.model || d.skillsAdded.length + d.skillsRemoved.length + d.toolsAdded.length + d.toolsRemoved.length > 0 };
}
export { newKey };
