import { create } from 'zustand';
import type { AgentDto } from '@contracts';
import { applyAgentCatalog, AGENTS } from '@/data/agents';
import { ROLES } from '@/data/roles';
import type { Agent, AgentMetrics, RoleKey } from '@/data/types';
import { api } from './client';

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
  const role = (d.role in ROLES ? d.role : 'dev') as RoleKey;
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
export async function loadAgents() {
  const mine = ++gen;
  const r = await api<{ agents: AgentDto[] }>('GET', '/agents');
  if (mine !== gen) return; // a newer load started meanwhile
  applyAgentCatalog(r.agents.map(toAgent));
  useAgentsVersion.setState((s) => ({ v: s.v + 1, loaded: true, failed: false }));
}

/** First load after sign-in. On failure the shell still opens with the built-in catalog (and says so). */
export async function loadAgentsOnce() {
  if (useAgentsVersion.getState().loaded) return;
  try { await loadAgents(); }
  catch {
    useAgentsVersion.setState({ loaded: true, failed: true });
    const { toast } = await import('@/store/ui');
    toast({ tone: 'warning', title: 'Agent list not loaded', body: `Showing the built-in list of ${AGENTS.length} agents until the server answers.` });
  }
}
