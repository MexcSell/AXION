import type { Agent, DevLevel, EvoPhase } from './types';

/** The signed-in tenant's catalog, filled by GET /agents. In-place updates preserve existing subscribers. */
export const AGENTS: Agent[] = [];
export const AGENT_BY_ID: Record<string, Agent> = Object.create(null);

export function applyAgentCatalog(list: Agent[]) {
  for (const id of Object.keys(AGENT_BY_ID)) delete AGENT_BY_ID[id];
  AGENTS.splice(0, AGENTS.length, ...list);
  for (const agent of list) AGENT_BY_ID[agent.id] = agent;
}

/** Development stage names (level 1–5). */
export const DEV_LEVELS = ['Seed', 'Apprentice', 'Practitioner', 'Expert', 'Master'] as const;
export const devLevelName = (l: DevLevel) => DEV_LEVELS[l - 1];
/** Evolution pipeline phases (shown on agents' development boards). */
export const EVO_PHASES: { key: EvoPhase; label: string }[] = [
  { key: 'proposal', label: 'Proposal' }, { key: 'experiment', label: 'Experiment' }, { key: 'benchmark', label: 'Benchmark' }, { key: 'promotion', label: 'Promotion' },
];

export function seeded(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
