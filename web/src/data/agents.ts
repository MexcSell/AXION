import type { Agent, AgentMetrics, AgentStatus, DevLevel, EvoPhase, GrowthState, RoleKey } from './types';

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
  loader: ['Model fit', 'Routing', 'Load balancing', 'Benchmarks'],
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

/** Each agent's own duty — unique across the company. */
const DUTY: Record<RoleKey, string> = {
  manager: 'General Manager', research: 'Research', analytics: 'Analytics', dev: 'Software development (Developer)', ops: 'Operations',
  security: 'Security', comms: 'Communication', planning: 'Planning', loader: 'Model loading & selection', knowledge: 'Knowledge curation',
  optimize: 'Optimization', qa: 'QA / Testing', integration: 'Integration', browser: 'Browser operation', writer: 'Writing', mentor: 'Mentoring',
  release: 'Release', design: 'Design',
};

const DESCR: Record<RoleKey, string> = {
  manager: 'Orchestrates the company: breaks missions into plans, assigns agents and reports outcomes to the Owner.',
  research: 'Gathers sources, verifies claims and produces cited research briefs.',
  analytics: 'Turns raw data into insight: metrics, trends, forecasts and dashboards.',
  dev: 'Builds and maintains code: components, services and automated tests.',
  ops: 'Keeps services healthy: monitoring, runbooks, scheduled jobs and incident response.',
  security: 'Guards permissions, secrets and policy; reviews risky actions before they run.',
  comms: 'Writes clear messages, summaries and translations for humans and agents.',
  planning: 'Schedules work, maps dependencies and keeps missions on their critical path.',
  loader: 'Selects and loads the right model for every agent and task, balancing quality, speed and host capacity (CPU, RAM, VRAM).',
  knowledge: 'Curates verified lessons, documents and embeddings for reuse.',
  optimize: 'Measures and improves agent prompts, recipes and token/latency trade-offs.',
  qa: 'Independently verifies outputs with acceptance tests and evidence.',
  integration: 'Connects external tools: GitHub, APIs, webhooks and providers.',
  browser: 'Operates managed Playwright browsers inside granted website origins.',
  writer: 'Drafts documentation, release notes and on-page copy.',
  mentor: 'Coaches agents with targeted exercises and before/after evaluation.',
  release: 'Packages versions, runs canaries and owns rollback readiness.',
  design: 'Designs interfaces, tokens and motion; keeps UI accessible.',
};

type Seed = [name: string, role: RoleKey, status: AgentStatus, version: string, missions: number, success: number, dept: string,
  growth: GrowthState, growthPct: number, growthNote: string, level: DevLevel, xp: number, generation: number, evoPhase?: EvoPhase, candidate?: string];

/**
 * One agent per role — no duplicates of a role or skill set (owner rule 2026-11-20).
 * The former copies (Coder-02…04, Tester-02/03, Browser-02/03 …) were folded into their -01 original.
 * First 12 keep the 40-4 reference grid order.
 */
const SEEDS: Seed[] = [
  ['Researcher-01', 'research', 'active', 'v2.4.0', 9, 98, 'R&D', 'stable', 100, 'No change in progress', 5, 64, 6],
  ['Analyst-01', 'analytics', 'active', 'v2.4.0', 8, 96, 'R&D', 'learning', 45, 'Forecast calibration (Mentor-01, ex. 2 of 4)', 3, 72, 4],
  ['Coder-01', 'dev', 'in-mission', 'v2.4.0', 14, 96, 'Engineering', 'evolving', 68, 'Candidate v2.5.0: test-first patch recipe', 4, 40, 5, 'benchmark', 'v2.5.0'],
  ['Ops-01', 'ops', 'active', 'v2.3.9', 9, 99, 'Operations', 'stable', 100, 'No change in progress', 5, 22, 6],
  ['Security-01', 'security', 'active', 'v2.4.0', 7, 99, 'Governance', 'stable', 100, 'No change in progress', 5, 81, 7],
  ['Comms-01', 'comms', 'active', 'v2.3.8', 5, 95, 'Operations', 'learning', 30, 'Owner-facing tone rubric (ex. 1 of 3)', 3, 35, 3],
  ['Planner-01', 'planning', 'active', 'v2.4.0', 6, 98, 'Operations', 'stable', 100, 'No change in progress', 4, 58, 5],
  ['Loader-01', 'loader', 'active', 'v2.3.9', 4, 98, 'Operations', 'stable', 100, 'No change in progress', 4, 47, 4],
  ['Knowledge-01', 'knowledge', 'active', 'v2.4.0', 9, 97, 'Knowledge', 'evolving', 40, 'Candidate v2.5.0: dedup-before-index', 4, 63, 5, 'experiment', 'v2.5.0'],
  ['Optimizer-01', 'optimize', 'active', 'v2.4.0', 5, 96, 'R&D', 'evolving', 88, 'Candidate v2.5.0: prompt-cache aware routing', 4, 90, 5, 'promotion', 'v2.5.0'],
  ['Tester-01', 'qa', 'in-mission', 'v2.3.9', 9, 97, 'QA', 'stable', 100, 'No change in progress', 5, 12, 6],
  ['Integrator-01', 'integration', 'active', 'v2.4.0', 7, 98, 'Engineering', 'learning', 60, 'OAuth device-flow exercise (ex. 3 of 5)', 3, 84, 4],
  ['Browser-01', 'browser', 'in-mission', 'v2.4.0', 12, 92, 'Engineering', 'learning', 52, 'Checkout-flow locators, M-127 (ex. 4 of 6)', 2, 66, 3],
  ['Designer-01', 'design', 'in-mission', 'v2.4.0', 6, 96, 'Engineering', 'stable', 100, 'No change in progress', 3, 50, 3],
  ['Writer-01', 'writer', 'in-mission', 'v2.3.9', 5, 97, 'Operations', 'evolving', 15, 'Proposal: release-note template v2', 3, 28, 3, 'proposal', 'v2.4.0'],
  ['Mentor-01', 'mentor', 'active', 'v2.4.0', 6, 98, 'QA', 'stable', 100, 'No change in progress', 5, 70, 6],
  ['Release-01', 'release', 'active', 'v2.4.0', 5, 99, 'Operations', 'stable', 100, 'No change in progress', 4, 33, 5],
];

/** Development stage names (level 1–5). */
export const DEV_LEVELS = ['Seed', 'Apprentice', 'Practitioner', 'Expert', 'Master'] as const;
export const devLevelName = (l: DevLevel) => DEV_LEVELS[l - 1];
/** Evolution pipeline phases (shown on agents' development boards). */
export const EVO_PHASES: { key: EvoPhase; label: string }[] = [
  { key: 'proposal', label: 'Proposal' }, { key: 'experiment', label: 'Experiment' }, { key: 'benchmark', label: 'Benchmark' }, { key: 'promotion', label: 'Promotion' },
];

function metricsFor(name: string, role: RoleKey, success: number): AgentMetrics {
  const r = seeded(name);
  const base = (b: number) => Math.round(Math.min(99, Math.max(52, b + (r() - .5) * 14)));
  const s = success - 8;
  const m: AgentMetrics = {
    reliability: base(s + 4), reasoning: base(s), coding: base(s - 18), research: base(s - 14),
    browser: base(s - 20), communication: base(s - 6), toolPrecision: base(s - 4), tokenEff: base(s - 8),
  };
  const boost: Partial<Record<RoleKey, (keyof AgentMetrics)[]>> = {
    research: ['research', 'reasoning'], dev: ['coding', 'toolPrecision'], browser: ['browser', 'toolPrecision'],
    comms: ['communication'], writer: ['communication'], qa: ['reliability', 'toolPrecision'], analytics: ['reasoning', 'research'],
    manager: ['reasoning', 'communication'], optimize: ['tokenEff', 'reasoning'], loader: ['tokenEff'], security: ['reliability'],
    integration: ['toolPrecision', 'coding'], design: ['communication', 'coding'], knowledge: ['research'],
  };
  for (const k of boost[role] ?? []) m[k] = Math.min(99, m[k] + 18);
  return m;
}

const gm: Agent = {
  id: 'gm', name: 'GM', role: 'manager', duty: 'General Manager', dept: 'Executive', version: 'v3.2.0', status: 'active', missions: 12, success: 98, sample: 412,
  grade: 'S', model: 'claude-opus-5-5', load: 72, skills: SKILLS.manager, metrics: metricsFor('GM', 'manager', 98),
  description: DESCR.manager, createdAgo: 92,
  growth: 'stable', growthPct: 100, growthNote: 'No change in progress', level: 5, xp: 55, generation: 9,
};

export const AGENTS: Agent[] = [
  gm,
  ...SEEDS.map(([name, role, status, version, missions, success, dept, growth, growthPct, growthNote, level, xp, generation, evoPhase, candidate], i): Agent => {
    const r = seeded(name + 'x');
    return {
      id: name.toLowerCase(),
      name, role, status, version, missions, success, dept, duty: DUTY[role],
      sample: 120 + Math.round(r() * 260),
      grade: success >= 98 ? 'S' : success >= 95 ? 'A' : success >= 91 ? 'B' : 'C',
      model: MODELS[i % MODELS.length],
      managerId: 'gm',
      load: status === 'idle' ? 0 : Math.round(25 + r() * 70),
      skills: SKILLS[role],
      metrics: metricsFor(name, role, success),
      description: DESCR[role],
      createdAgo: 8 + Math.round(r() * 80),
      growth, growthPct, growthNote, level, xp, generation, evoPhase, candidate,
    };
  }),
];

/**
 * Derived agents (owner update 2026-11-20 u1). Specialists are derived from a parent agent: they keep what is specific
 * to their speciality and share general lessons back up, so the knowledge structure follows the same lineage.
 *   Coder-01 (Developer) → Mobile-Dev-01, Web-Dev-01
 *   Browser-01 → Homepage-01 (controls homepages, learns in Job Search) → one autopilot agent per website
 */
type DerivedSeed = [id: string, name: string, role: RoleKey, parentId: string, duty: string, status: AgentStatus, success: number, level: DevLevel, xp: number, growth: GrowthState, growthPct: number, note: string, site?: string];
const DERIVED: DerivedSeed[] = [
  ['mobile-dev-01', 'Mobile-Dev-01', 'dev', 'coder-01', 'Mobile app development (iOS, Android)', 'active', 94, 3, 46, 'learning', 58, 'Offline sync patterns (from Coder-01 lessons)'],
  ['web-dev-01', 'Web-Dev-01', 'dev', 'coder-01', 'Website development lead', 'in-mission', 95, 3, 71, 'stable', 100, 'No change in progress'],
  ['homepage-01', 'Homepage-01', 'browser', 'browser-01', 'Homepage control & autopilot', 'active', 93, 3, 38, 'learning', 41, 'Learning job-site flows in Job Search'],
  ['site-upwork', 'Site-Upwork', 'browser', 'homepage-01', 'Autopilot for upwork.com', 'in-mission', 90, 2, 64, 'learning', 64, 'Proposal form layout v3', 'upwork.com'],
  ['site-freelancer', 'Site-Freelancer', 'browser', 'homepage-01', 'Autopilot for freelancer.com', 'in-mission', 88, 2, 31, 'learning', 33, 'Bid limits per day', 'freelancer.com'],
  ['site-wanted', 'Site-Wanted', 'browser', 'homepage-01', 'Autopilot for wanted.co.kr', 'active', 86, 1, 72, 'learning', 72, 'Korean resume fields', 'wanted.co.kr'],
];
const DEPT_OF: Record<string, string> = Object.fromEntries(AGENTS.map((a) => [a.id, a.dept]));
for (const [id, name, role, parentId, duty, status, success, level, xp, growth, growthPct, note, site] of DERIVED) {
  const r = seeded(id + 'd');
  DEPT_OF[id] = DEPT_OF[parentId] ?? 'Engineering';
  AGENTS.push({
    id, name, role, status, version: 'v1.' + Math.floor(r() * 4) + '.0', missions: 2 + Math.floor(r() * 6), success, dept: DEPT_OF[parentId] ?? 'Engineering', duty, parentId, site,
    sample: 40 + Math.round(r() * 120), grade: success >= 95 ? 'A' : success >= 91 ? 'B' : 'C', model: role === 'dev' ? 'claude-sonnet-5-5' : 'claude-haiku-5-5',
    managerId: parentId, load: status === 'idle' ? 0 : Math.round(20 + r() * 60), skills: role === 'dev' ? (duty.startsWith('Mobile') ? ['Swift', 'Kotlin', 'React Native', 'Offline sync'] : ['Next.js', 'CSS', 'SEO', 'Accessibility']) : ['Site flows', 'Locators', 'Forms', 'Rate limits'],
    metrics: metricsFor(name, role, success), description: `${duty}. Derived from ${parentId === 'coder-01' ? 'Coder-01' : parentId === 'browser-01' ? 'Browser-01' : 'Homepage-01'}: keeps specialised experience, shares general lessons upward.`,
    createdAgo: 3 + Math.round(r() * 30), growth, growthPct, growthNote: note, level, xp, generation: 1 + Math.floor(r() * 2),
  });
}

export const AGENT_BY_ID: Record<string, Agent> = Object.fromEntries(AGENTS.map((a) => [a.id, a]));
/** Children derived from an agent. */
export const childrenOf = (id: string) => AGENTS.filter((a) => a.parentId === id);
export const agentName = (id: string) => AGENT_BY_ID[id]?.name ?? (id.startsWith('human:') ? 'You' : id);

/** 12 agents from the reference grid (excludes GM). */
export const FEATURED_AGENTS = AGENTS.slice(1, 13);

export const AGENT_VERSIONS = [
  { v: 'v2.3.0', label: 'Current', note: 'Stable · last-good' },
  { v: 'v2.4.0', label: 'Candidate', note: 'Under evaluation' },
  { v: 'v2.5.0', label: 'Next', note: 'Proposed' },
];
