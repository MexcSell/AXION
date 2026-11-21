import { useEffect, useState } from 'react';
import { create } from 'zustand';
import type { AgentDto, AgentVersionDto, OrgEdgeDto, OrgRevisionDto } from '@contracts';
import { applyAgentCatalog, AGENTS } from '@/data/agents';
import type { Agent, AgentMetrics, RoleKey } from '@/data/types';
import { rebuildDepts } from '@/data/orgdemo';
import { api, ApiFailure, newKey } from './client';
import { isApi } from './mode';

/**
 * Agent catalog (Stage 6). In api mode the company's agents come from GET /agents: after sign-in and before the shell
 * renders (AuthGate waits for `loaded`), and again on every agent.* event and stream reconnect. The arrays in
 * data/agents.ts are filled in place; `v` changes each time, so views that list agents subscribe to it.
 */
interface CatalogState { v: number; loaded: boolean; failed: boolean }
export const useAgentsVersion = create<CatalogState>(() => ({ v: 0, loaded: false, failed: false }));
/** Subscribe a view to catalog changes; returns the version (use it in memo deps). */
export const useAgentsCatalog = () => useAgentsVersion((s) => s.v);

const ZERO: AgentMetrics = { reliability: 0, reasoning: 0, coding: 0, research: 0, browser: 0, communication: 0, toolPrecision: 0, tokenEff: 0 };

/** The server's agent = the UI's Agent plus version and provenance; fill what a newly created agent does not have yet. */
export function toAgent(d: AgentDto): Agent {
  const p = d as unknown as Partial<Agent> & Record<string, unknown>;
  const role = d.role as RoleKey; // an unknown role keeps its name; data/roles.ts gives it a generic chip and icon
  return {
    ...p,
    id: d.id, name: d.name, role, duty: d.duty, dept: d.dept, description: d.description, model: d.model, skills: d.skills ?? [], version: d.versionLabel ?? d.version,
    status: (p.status ?? 'idle') as Agent['status'], missions: p.missions ?? 0, success: p.success ?? 0, sample: p.sample ?? 0, grade: p.grade ?? 'C', load: p.load ?? 0,
    metrics: { ...ZERO, ...(p.metrics ?? {}) }, createdAgo: p.createdAgo ?? 0, growth: p.growth ?? 'stable', growthPct: p.growthPct ?? 0, growthNote: p.growthNote ?? '',
    level: p.level ?? 1, xp: p.xp ?? 0, generation: p.generation ?? 1,
    ...(d.parentId ? { parentId: d.parentId } : {}), ...(d.managerId ? { managerId: d.managerId } : {}), ...(d.site ? { site: d.site } : {}),
  } as Agent;
}

let gen = 0;
let latest: Promise<void> = Promise.resolve();
/** A load that a newer one overtakes does not apply its (older) answer, but it resolves only once the newest load has been
 *  applied: callers such as updateAgent() await it and then read the current rowVersion from the catalog. */
export function loadAgents(): Promise<void> {
  const mine = ++gen;
  const run = (async () => {
    const r = await api<{ agents: AgentDto[] }>('GET', '/agents');
    if (mine !== gen) return latest === run ? undefined : latest; // a newer load started meanwhile: wait for it instead of returning with nothing applied
    applyAgentCatalog(r.agents.map(toAgent));
    rebuildDepts(); // departments are derived from the catalog: agents created later belong to them too
    useAgentsVersion.setState((s) => ({ v: s.v + 1, loaded: true, failed: false }));
  })();
  latest = run;
  return run;
}

/** First load after sign-in. On failure the shell still opens with the built-in catalog (and says so). */
/** Signed out: the next sign-in in this tab loads the catalog again (it may be another user, or the server changed). */
export function resetAgentsCatalog() { gen++; useAgentsVersion.setState({ loaded: false, failed: false }); }

export async function loadAgentsOnce() {
  if (useAgentsVersion.getState().loaded) return;
  try { await loadAgents(); }
  catch {
    useAgentsVersion.setState({ loaded: true, failed: true });
    const { toast } = await import('@/store/ui');
    toast({ tone: 'warning', title: 'Agent list not loaded', body: `Showing the built-in list of ${AGENTS.length} agents until the server answers.` });
  }
}

/* ------------------------------------------------------------------ writes (administrators) */
export type AgentWrite = { ok: true; agent: AgentDto } | { ok: false; message: string; code: string; fieldErrors?: Record<string, string> };
const fail = (e: unknown): AgentWrite => (e instanceof ApiFailure ? { ok: false, message: e.message, code: e.code, fieldErrors: e.fieldErrors } : { ok: false, message: 'Something went wrong.', code: 'UNKNOWN' });

export interface NewAgentBody { name: string; role: string; dept: string; duty: string; description: string; model: string; skills: string[]; tools: string[] }
/** One key per dialog submit: pressing the button twice (or a retry) creates one agent. */
export async function createAgent(body: NewAgentBody, idempotencyKey: string): Promise<AgentWrite> {
  try {
    const r = await api<{ agent: AgentDto }>('POST', '/agents', body, { idempotencyKey });
    await loadAgents().catch(() => undefined);
    return { ok: true, agent: r.agent };
  } catch (e) { return fail(e); }
}
export async function updateAgent(id: string, rowVersion: number, body: Partial<Pick<NewAgentBody, 'name' | 'description' | 'model' | 'skills' | 'tools' | 'dept'>>): Promise<AgentWrite> {
  try {
    const r = await api<{ agent: AgentDto }>('PATCH', `/agents/${id}`, body, { ifMatch: rowVersion });
    await loadAgents().catch(() => undefined);
    return { ok: true, agent: r.agent };
  } catch (e) {
    if (e instanceof ApiFailure && e.status === 409) await loadAgents().catch(() => undefined); // someone else changed it: show the current state
    return fail(e);
  }
}
export { newKey };

/* ------------------------------------------------------------------ reads that follow events */
export interface InstanceRow { id: string; missionId: string; agentId: string; versionId: string; versionLabel: string; state: string; task: string; progress: number; simulated: boolean; createdAt: string; endedAt: string | null }
/** instance.*, task.* and mission.* events (and a stream reconnect) make instance lists re-read. */
const useInstTick = create<{ n: number }>(() => ({ n: 0 }));
export const bumpInstances = () => useInstTick.setState((s) => ({ n: s.n + 1 }));

interface Read<T> { data: T | null; error: string | null; retry: () => void }
/** GET `path`, again when any of `deps` changes. A failed read keeps the last data and says so (never shown as empty). */
function useRead<T>(path: string | null, pick: (r: any) => T, deps: unknown[]): Read<T> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const [st, setSt] = useState<{ path: string | null; data: T | null; error: string | null }>({ path, data: null, error: null });
  const [manual, setManual] = useState(0);
  useEffect(() => {
    if (!path || !isApiMode()) return;
    let live = true;
    api<unknown>('GET', path).then((r) => { if (live) setSt({ path, data: pick(r), error: null }); })
      .catch((e) => { if (live) setSt((x) => ({ path, data: x.path === path ? x.data : null, error: e instanceof ApiFailure ? e.message : 'Something went wrong.' })); });
    return () => { live = false; };
  }, [path, manual, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
  return { data: st.path === path ? st.data : null, error: st.error, retry: () => setManual((n) => n + 1) };
}
const isApiMode = () => isApi();

/** Agent instances visible to me (GET /agent-instances), one agent or all. */
export function useAgentInstances(agentId?: string): Read<InstanceRow[]> {
  const tick = useInstTick((s) => s.n);
  return useRead<InstanceRow[]>(`/agent-instances${agentId ? `?agentId=${encodeURIComponent(agentId)}` : ''}`, (r) => r.instances, [tick]);
}
/** An agent's immutable versions, newest last (GET /agents/:id). */
export function useAgentVersions(agentId: string): Read<AgentVersionDto[]> {
  const v = useAgentsCatalog();
  return useRead<AgentVersionDto[]>(`/agents/${agentId}`, (r) => r.agent.versions ?? [], [v]);
}
/** The active organization revision and its reporting lines (GET /organization/graph). */
export function useOrgGraph(): Read<{ revision: OrgRevisionDto | null; edges: OrgEdgeDto[] }> {
  const v = useAgentsCatalog();
  return useRead(`/organization/graph`, (r) => ({ revision: r.revision, edges: r.edges ?? [] }), [v]);
}
