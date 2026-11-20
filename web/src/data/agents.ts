import type { Agent, AgentMetrics, AgentStatus, RoleKey } from './types';

/** Deterministic PRNG so DEMO data is identical on every load. */
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

const SKILLS: Record<RoleKey, string[]> = {
  manager: ['Planning', 'Delegation', 'Prioritization', 'Reporting'],
  research: ['Web research', 'Citation', 'Synthesis', 'Fact-check'],
  analytics: ['SQL', 'Forecasting', 'Dashboards', 'Statistics'],
  dev: ['TypeScript', 'React', 'Node.js', 'Testing'],
  ops: ['Runbooks', 'Monitoring', 'systemd', 'Incidents'],
  security: ['Threat model', 'Secrets', 'Policy', 'Audit'],
  comms: ['Copywriting', 'Summaries', 'Translation', 'Tone'],
  planning: ['Roadmaps', 'Scheduling', 'Dependencies', 'Risk'],
  finance: ['Budgeting', 'Cost model', 'Forecast', 'Usage'],
  knowledge: ['Indexing', 'Embeddings', 'Dedup', 'Curation'],
  optimize: ['Profiling', 'Prompt tuning', 'Caching', 'A/B'],
  qa: ['E2E tests', 'Acceptance', 'Visual diff', 'Regression'],
  integration: ['APIs', 'Webhooks', 'GitHub', 'OAuth'],
  browser: ['Playwright', 'Locators', 'Forms', 'Screenshots'],
  writer: ['Docs', 'Release notes', 'UX copy', 'Editing'],
  mentor: ['Coaching', 'Rubrics', 'Exercises', 'Review'],
  release: ['Versioning', 'Canary', 'Rollback', 'Changelog'],
  design: ['UI design', 'Accessibility', 'Motion', 'Design tokens'],
};

const MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'local/llama-4-70b', 'claude-fable-5-2'];

const DESCR: Record<RoleKey, string> = {
  manager: 'Orchestrates the company: breaks missions into plans, staffs teams and reports outcomes to the Owner.',
  research: 'Gathers sources, verifies claims and produces cited research briefs.',
  analytics: 'Turns raw data into insight: metrics, trends, forecasts and dashboards.',
  dev: 'Builds and maintains code: components, services and automated tests.',
  ops: 'Keeps services healthy: monitoring, runbooks, scheduled jobs and incident response.',
  security: 'Guards permissions, secrets and policy; reviews risky actions before they run.',
  comms: 'Writes clear messages, summaries and translations for humans and agents.',
  planning: 'Schedules work, maps dependencies and keeps missions on their critical path.',
  finance: 'Tracks spend and budgets per mission, model and agent; flags overruns early.',
  knowledge: 'Curates verified lessons, documents and embeddings for reuse.',
  optimize: 'Measures and improves agent prompts, recipes and cost/latency trade-offs.',
  qa: 'Independently verifies outputs with acceptance tests and evidence.',
  integration: 'Connects external tools: GitHub, APIs, webhooks and providers.',
  browser: 'Operates managed Playwright browsers inside granted website origins.',
  writer: 'Drafts documentation, release notes and on-page copy.',
  mentor: 'Coaches agents with targeted exercises and before/after evaluation.',
  release: 'Packages versions, runs canaries and owns rollback readiness.',
  design: 'Designs interfaces, tokens and motion; keeps UI accessible.',
};

type Seed = [name: string, role: RoleKey, status: AgentStatus, version: string, missions: number, success: number, dept: string];

/** First 12 match the 40-4 reference grid exactly. */
const SEEDS: Seed[] = [
  ['Researcher-01', 'research', 'active', 'v2.4.0', 5, 98, 'R&D'],
  ['Analyst-01', 'analytics', 'active', 'v2.4.0', 4, 97, 'R&D'],
  ['Coder-01', 'dev', 'in-mission', 'v2.4.0', 6, 96, 'Engineering'],
  ['Ops-01', 'ops', 'active', 'v2.3.9', 6, 99, 'Operations'],
  ['Security-01', 'security', 'active', 'v2.4.0', 4, 99, 'Governance'],
  ['Comms-01', 'comms', 'active', 'v2.3.8', 3, 95, 'Operations'],
  ['Planner-01', 'planning', 'active', 'v2.4.0', 5, 98, 'Operations'],
  ['Finance-01', 'finance', 'active', 'v2.3.9', 4, 98, 'Finance'],
  ['Knowledge-01', 'knowledge', 'active', 'v2.4.0', 6, 97, 'Knowledge'],
  ['Optimizer-01', 'optimize', 'evolving', 'v2.4.0', 3, 96, 'R&D'],
  ['Tester-01', 'qa', 'in-mission', 'v2.3.9', 4, 97, 'QA'],
  ['Integrator-01', 'integration', 'active', 'v2.4.0', 4, 98, 'Engineering'],
  // the rest of the 38-agent company
  ['Browser-01', 'browser', 'in-mission', 'v2.4.0', 7, 95, 'Engineering'],
  ['Browser-02', 'browser', 'in-mission', 'v2.3.9', 5, 93, 'Engineering'],
  ['Coder-02', 'dev', 'in-mission', 'v2.4.0', 5, 95, 'Engineering'],
  ['Coder-03', 'dev', 'active', 'v2.3.9', 4, 94, 'Engineering'],
  ['Designer-01', 'design', 'in-mission', 'v2.4.0', 4, 96, 'Engineering'],
  ['Writer-01', 'writer', 'in-mission', 'v2.3.8', 3, 97, 'Operations'],
  ['Mentor-01', 'mentor', 'active', 'v2.4.0', 6, 98, 'QA'],
  ['Release-01', 'release', 'active', 'v2.4.0', 5, 99, 'Operations'],
  ['Researcher-02', 'research', 'in-mission', 'v2.4.0', 4, 96, 'R&D'],
  ['Researcher-03', 'research', 'training', 'v2.3.7', 2, 91, 'R&D'],
  ['Analyst-02', 'analytics', 'in-mission', 'v2.3.9', 3, 95, 'R&D'],
  ['Tester-02', 'qa', 'in-mission', 'v2.4.0', 4, 98, 'QA'],
  ['Tester-03', 'qa', 'training', 'v2.3.6', 1, 89, 'QA'],
  ['Ops-02', 'ops', 'active', 'v2.3.9', 3, 97, 'Operations'],
  ['Security-02', 'security', 'active', 'v2.3.9', 2, 98, 'Governance'],
  ['Knowledge-02', 'knowledge', 'active', 'v2.3.9', 3, 96, 'Knowledge'],
  ['Planner-02', 'planning', 'idle', 'v2.3.8', 1, 94, 'Operations'],
  ['Comms-02', 'comms', 'active', 'v2.3.9', 2, 96, 'Operations'],
  ['Integrator-02', 'integration', 'in-mission', 'v2.3.9', 3, 95, 'Engineering'],
  ['Browser-03', 'browser', 'training', 'v2.3.5', 1, 88, 'Engineering'],
  ['Optimizer-02', 'optimize', 'evolving', 'v2.3.9', 2, 94, 'R&D'],
  ['Coder-04', 'dev', 'training', 'v2.3.4', 1, 90, 'Engineering'],
  ['Designer-02', 'design', 'active', 'v2.3.9', 2, 95, 'Engineering'],
  ['Analyst-03', 'analytics', 'idle', 'v2.3.8', 1, 93, 'R&D'],
  ['Writer-02', 'writer', 'active', 'v2.3.9', 2, 96, 'Operations'],
];

function metricsFor(name: string, role: RoleKey, success: number): AgentMetrics {
  const r = seeded(name);
  const base = (b: number) => Math.round(Math.min(99, Math.max(52, b + (r() - .5) * 14)));
  const s = success - 8;
  const m: AgentMetrics = {
    reliability: base(s + 4), reasoning: base(s), coding: base(s - 18), research: base(s - 14),
    browser: base(s - 20), communication: base(s - 6), toolPrecision: base(s - 4), costEff: base(s - 8),
  };
  const boost: Partial<Record<RoleKey, (keyof AgentMetrics)[]>> = {
    research: ['research', 'reasoning'], dev: ['coding', 'toolPrecision'], browser: ['browser', 'toolPrecision'],
    comms: ['communication'], writer: ['communication'], qa: ['reliability', 'toolPrecision'], analytics: ['reasoning', 'research'],
    manager: ['reasoning', 'communication'], optimize: ['costEff', 'reasoning'], finance: ['costEff'], security: ['reliability'],
    integration: ['toolPrecision', 'coding'], design: ['communication', 'coding'], knowledge: ['research'],
  };
  for (const k of boost[role] ?? []) m[k] = Math.min(99, m[k] + 18);
  return m;
}

const gm: Agent = {
  id: 'gm', name: 'GM', role: 'manager', dept: 'Executive', version: 'v3.2.0', status: 'active', missions: 12, success: 98, sample: 412,
  grade: 'S', model: 'claude-opus-5-5', load: 72, skills: SKILLS.manager, metrics: metricsFor('GM', 'manager', 98),
  description: DESCR.manager, createdAgo: 92,
};

export const AGENTS: Agent[] = [
  gm,
  ...SEEDS.map(([name, role, status, version, missions, success, dept], i): Agent => {
    const r = seeded(name + 'x');
    return {
      id: name.toLowerCase(),
      name, role, status, version, missions, success, dept,
      sample: 40 + Math.round(r() * 160),
      grade: success >= 98 ? 'S' : success >= 95 ? 'A' : success >= 91 ? 'B' : 'C',
      model: MODELS[i % MODELS.length],
      managerId: 'gm',
      load: status === 'idle' ? 0 : Math.round(25 + r() * 70),
      skills: SKILLS[role],
      metrics: metricsFor(name, role, success),
      description: DESCR[role],
      createdAgo: 8 + Math.round(r() * 80),
    };
  }),
];

export const AGENT_BY_ID: Record<string, Agent> = Object.fromEntries(AGENTS.map((a) => [a.id, a]));
export const agentName = (id: string) => AGENT_BY_ID[id]?.name ?? (id.startsWith('human:') ? 'You' : id);

/** 12 agents from the reference grid (excludes GM). */
export const FEATURED_AGENTS = AGENTS.slice(1, 13);

export const AGENT_VERSIONS = [
  { v: 'v2.3.0', label: 'Current', note: 'Stable · last-good' },
  { v: 'v2.4.0', label: 'Candidate', note: 'Under evaluation' },
  { v: 'v2.5.0', label: 'Next', note: 'Proposed' },
];
