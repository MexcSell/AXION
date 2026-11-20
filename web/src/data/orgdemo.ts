import { AGENTS, AGENT_BY_ID, seeded } from './agents';
import { MISSIONS } from './missions';
import type { Agent, AgentMetrics, RoleKey } from './types';

/* ------------------------------------------------------------------ */
/* Departments (derived from AGENTS[].dept)                             */
/* ------------------------------------------------------------------ */
export interface Dept {
  key: string; name: string; short: string; role: RoleKey; hue: number; charter: string;
  managerId: string; memberIds: string[]; capacity: number; // percent in use
  budget: number; spend: number; missions: number; skillCoverage: { skill: string; pct: number }[];
  kpis: { label: string; value: number; unit: string; delta: number }[];
}

const DEPT_META: Record<string, { short: string; role: RoleKey; hue: number; charter: string }> = {
  Executive: { short: 'EXE', role: 'manager', hue: 268, charter: 'Owns the company plan, staffs missions and reports verified outcomes to the Owner.' },
  'R&D': { short: 'R&D', role: 'research', hue: 280, charter: 'Researches, analyses and optimises: new recipes, evidence-backed briefs and candidate improvements.' },
  Engineering: { short: 'ENG', role: 'dev', hue: 215, charter: 'Builds and integrates software, automates browsers and keeps the design system coherent.' },
  Operations: { short: 'OPS', role: 'ops', hue: 192, charter: 'Plans, runs and releases work; keeps services healthy and communication clear.' },
  Governance: { short: 'GOV', role: 'security', hue: 148, charter: 'Guards permissions, secrets and policy. Reviews risky actions before they run.' },
  Finance: { short: 'FIN', role: 'finance', hue: 42, charter: 'Tracks spend and budgets per mission, model and agent; flags overruns early.' },
  Knowledge: { short: 'KNW', role: 'knowledge', hue: 212, charter: 'Curates verified lessons, documents and embeddings for reuse across missions.' },
  QA: { short: 'QA', role: 'qa', hue: 172, charter: 'Independently verifies outputs, and coaches agents with assessed exercises.' },
};

export const DEPTS: Dept[] = Object.keys(DEPT_META).map((name) => {
  const m = DEPT_META[name];
  const members = AGENTS.filter((a) => a.dept === name);
  const mgr = [...members].sort((a, b) => b.success - a.success || b.sample - a.sample)[0];
  const r = seeded('dept' + name);
  const used = members.length ? Math.round(members.reduce((s, a) => s + a.load, 0) / members.length) : 0;
  const skills = Array.from(new Set(members.flatMap((a) => a.skills))).slice(0, 5);
  const missionIds = new Set(MISSIONS.filter((x) => x.agentIds.some((id) => AGENT_BY_ID[id]?.dept === name)).map((x) => x.id));
  const budget = Math.round((members.length * 160 + 120) / 10) * 10;
  return {
    key: name, name, short: m.short, role: m.role, hue: m.hue, charter: m.charter,
    managerId: mgr?.id ?? 'gm', memberIds: members.map((a) => a.id), capacity: used,
    budget, spend: Math.round(budget * (0.35 + r() * 0.4)), missions: missionIds.size,
    skillCoverage: skills.map((s) => ({ skill: s, pct: Math.round(70 + r() * 28) })),
    kpis: [
      { label: 'Verified success', value: members.length ? Math.round(members.reduce((s, a) => s + a.success, 0) / members.length) : 0, unit: '%', delta: +(r() * 2).toFixed(1) },
      { label: 'Median task time', value: Math.round(8 + r() * 20), unit: 'min', delta: -+(r() * 3).toFixed(1) },
      { label: 'Rework rate', value: +(1 + r() * 4).toFixed(1), unit: '%', delta: -+(r() * 1.2).toFixed(1) },
    ],
  };
});
export const DEPT_BY_NAME: Record<string, Dept> = Object.fromEntries(DEPTS.map((d) => [d.name, d]));

/* ------------------------------------------------------------------ */
/* Policies, proposals                                                  */
/* ------------------------------------------------------------------ */
export const CONSTITUTION = [
  { id: 'C-1', title: 'Owner authority', text: 'The Owner can pause, redirect or stop any mission. No agent can remove that ability.' },
  { id: 'C-2', title: 'Verified progress', text: 'Progress counts only evidence that passed independent verification.' },
  { id: 'C-3', title: 'No self-approval', text: 'An agent can never approve its own improvement, grant or promotion.' },
  { id: 'C-4', title: 'Bounded access', text: 'Capability is not authorization. Sites, tools and spend are granted per mission and expire.' },
  { id: 'C-5', title: 'Reversible change', text: 'Every organisational or agent change is versioned, auditable and has a rollback.' },
];
export const DELEGATION_RULES = [
  { rule: 'GM may delegate to any manager inside its own department', cap: 'Auto', hue: 145 },
  { rule: 'Cross-department delegation above $20 budget', cap: 'GM review', hue: 38 },
  { rule: 'New browser origin for any agent', cap: 'Owner approval', hue: 350 },
  { rule: 'Agent promotion to a new stable version', cap: 'QA + Owner', hue: 350 },
  { rule: 'Reporting cadence: manager to GM at each phase change', cap: 'Required', hue: 200 },
  { rule: 'Autonomy cap per agent: 3 parallel instances', cap: 'Enforced', hue: 268 },
];
export const POLICY_HISTORY = [
  { v: 'r14', agoD: 2, by: 'Luca (Owner)', note: 'Cap parallel instances per agent at 3', status: 'active' },
  { v: 'r13', agoD: 9, by: 'Security-01', note: 'Origin grants default to 2 hours', status: 'superseded' },
  { v: 'r12', agoD: 21, by: 'GM', note: 'Cross-department budget threshold lowered to $20', status: 'superseded' },
  { v: 'r11', agoD: 34, by: 'Luca (Owner)', note: 'Require QA verdict for every promotion', status: 'superseded' },
];

export type ProposalStage = 'draft' | 'simulate' | 'evaluate' | 'approve' | 'applied';
export interface OrgProposal { id: string; kind: 'split' | 'merge' | 'reassign' | 'create-role' | 'retire'; title: string; by: string; summary: string; stage: ProposalStage; impact: { coverage: number; latency: number; cost: number }; agentIds: string[]; agoD: number; }
export const PROPOSALS: OrgProposal[] = [
  { id: 'P-21', kind: 'split', title: 'Split Engineering into Web and Automation', by: 'GM', summary: 'Browser-01 moves under Integrator-01 in a new Automation department to shorten checkout-flow loops.', stage: 'simulate', impact: { coverage: 3, latency: -12, cost: 2 }, agentIds: ['browser-01', 'integrator-01'], agoD: 1 },
  { id: 'P-20', kind: 'merge', title: 'Merge Knowledge into R&D', by: 'Planner-01', summary: 'Knowledge-01 would report to Researcher-01. Risk: curation independence is reduced.', stage: 'evaluate', impact: { coverage: -2, latency: -5, cost: -4 }, agentIds: ['knowledge-01', 'researcher-01'], agoD: 3 },
  { id: 'P-19', kind: 'create-role', title: 'Create a Marketing role (one new agent)', by: 'GM', summary: 'Linked to mission M-134. No current agent has the marketing skill set, so a new unique role is proposed instead of a copy of Writer-01.', stage: 'approve', impact: { coverage: 9, latency: -3, cost: 6 }, agentIds: ['analyst-01', 'writer-01'], agoD: 1 },
  { id: 'P-18', kind: 'reassign', title: 'Put Browser-01 into the Mentor program', by: 'Mentor-01', summary: 'Browser-01 is below 92% verified on checkout flows; pair with Mentor-01 for 2 weeks.', stage: 'approve', impact: { coverage: 1, latency: 2, cost: 0 }, agentIds: ['browser-01', 'mentor-01'], agoD: 2 },
  { id: 'P-17', kind: 'retire', title: 'Retire duplicate agents (Coder-02…04, Tester-02…03 …)', by: 'Finance-01', summary: 'One agent per role and skill set. 20 copies were folded into their original; their verified history was merged.', stage: 'applied', impact: { coverage: 0, latency: 0, cost: -9 }, agentIds: ['coder-01', 'tester-01'], agoD: 0 },
  { id: 'P-16', kind: 'reassign', title: 'Add Security-01 to the M-132 audit', by: 'GM', summary: 'Applied to new instances only. Running instances stay pinned.', stage: 'applied', impact: { coverage: 4, latency: -9, cost: 1 }, agentIds: ['security-01'], agoD: 6 },
];

/* ------------------------------------------------------------------ */
/* Assignment matrix                                                    */
/* ------------------------------------------------------------------ */
export function assignmentMatrix() {
  const missions = MISSIONS.filter((m) => !['archived', 'draft'].includes(m.status)).slice(0, 9);
  const agents = AGENTS.filter((a) => missions.some((m) => m.agentIds.includes(a.id))).sort((a, b) => b.missions - a.missions).slice(0, 14);
  const cell = (m: (typeof missions)[number], a: Agent) => {
    if (!m.agentIds.includes(a.id)) return 0;
    const r = seeded(m.id + a.id)();
    return m.leadId === a.id ? 65 : Math.round(25 + r * 70);
  };
  const rows = agents.map((a) => ({ a, cells: missions.map((m) => cell(m, a)) }));
  const conflicts = rows.filter((r) => r.cells.reduce((s, v) => s + v, 0) > 180).map((r) => ({ agentId: r.a.id, total: r.cells.reduce((s, v) => s + v, 0), n: r.cells.filter(Boolean).length }));
  return { missions, rows, conflicts };
}

/* ------------------------------------------------------------------ */
/* Agent profile demo data                                              */
/* ------------------------------------------------------------------ */
export const METRIC_LABELS: Record<keyof AgentMetrics, string> = {
  reliability: 'Reliability', reasoning: 'Reasoning', coding: 'Coding', research: 'Research',
  browser: 'Browser', communication: 'Comms', toolPrecision: 'Tool precision', costEff: 'Cost-effic.',
};
export const METRIC_KEYS = Object.keys(METRIC_LABELS) as (keyof AgentMetrics)[];

export function metricSample(a: Agent, k: keyof AgentMetrics) {
  const r = seeded(a.id + k)();
  return Math.max(12, Math.round(a.sample * (0.35 + r * 0.6)));
}

export interface ToolDef { id: string; name: string; provider: string; scopes: string; sites: string; expiryD: number | null; lastUseMin: number; granted: boolean; risk: 'low' | 'medium' | 'high'; }
const TOOLS_BY_ROLE: Partial<Record<RoleKey, string[]>> = {
  browser: ['Managed browser', 'Screenshot capture', 'Form filler'], dev: ['Workspace shell', 'Git branch', 'Test runner'], research: ['Web search', 'Managed browser', 'Citation store'],
  qa: ['Test runner', 'Visual diff', 'Managed browser'], security: ['Policy scanner', 'Secret audit', 'Git read'], ops: ['Service monitor', 'Runbook runner', 'Job scheduler'],
  integration: ['GitHub API', 'Webhook relay', 'OAuth broker'], analytics: ['SQL read', 'Dashboard builder'], finance: ['Usage meter', 'Budget ledger'], knowledge: ['Knowledge index', 'Embedding store'],
  manager: ['Mission planner', 'Delegation', 'Approval inbox'], writer: ['Doc editor', 'Release notes'], design: ['Token editor', 'Visual diff'], release: ['Version packager', 'Canary runner'],
};
export function toolsFor(a: Agent): ToolDef[] {
  const names = [...(TOOLS_BY_ROLE[a.role] ?? ['Knowledge read']), 'Mission messaging'];
  return names.map((name, i) => {
    const r = seeded(a.id + name);
    const granted = i !== 2 || r() > .4;
    return {
      id: `${a.id}-t${i}`, name, provider: ['Local', 'Playwright', 'GitHub', 'Internal'][Math.floor(r() * 4)],
      scopes: ['read', 'read, write', 'execute'][Math.floor(r() * 3)], sites: /browser|Screenshot|Form/i.test(name) ? 'status.example.com, portal.example.com' : 'n/a',
      expiryD: granted ? 1 + Math.floor(r() * 20) : null, lastUseMin: Math.round(3 + r() * 900), granted, risk: i === 0 && /browser|shell/i.test(name) ? 'high' : i < 2 ? 'medium' : 'low',
    };
  });
}

export function memoryFor(a: Agent) {
  const r = seeded(a.id + 'mem');
  const skills = a.skills.map((s, i) => ({ id: `${a.id}-sk${i}`, skill: s, verified: i < 3, uses: Math.round(10 + r() * 90), source: `M-${126 + Math.floor(r() * 8)}`, expiresD: i < 3 ? null : 14 + i * 7 }));
  const proposed = [
    { id: `${a.id}-pl0`, text: `Prefer ${a.skills[0]} checklist before reporting complete`, source: 'M-126 retro', status: 'proposed' as const },
    { id: `${a.id}-pl1`, text: `Cache ${a.skills[1]} results per mission scope`, source: 'M-129 review', status: 'reviewing' as const },
  ];
  const scopes = MISSIONS.filter((m) => m.agentIds.includes(a.id) && m.status !== 'archived').map((m) => ({ missionId: m.id, title: m.title, items: Math.round(6 + seeded(m.id + a.id)() * 40), kb: Math.round(40 + seeded(a.id + m.id)() * 900) }));
  return { skills, proposed, scopes };
}

export function auditFor(a: Agent) {
  const r = seeded(a.id + 'aud');
  const mk = (kind: string, text: string, who: string, i: number, tone: 'good' | 'warn' | 'bad' | 'info' = 'info') => ({ id: `${a.id}-au${i}`, kind, text, who, agoH: Math.round((i + 1) * (3 + r() * 20)), tone, hash: 'sha256:' + Math.floor(seeded(a.id + i)() * 0xffffffff).toString(16).padStart(8, '0') });
  return [
    mk('grant', `Granted ${toolsFor(a)[0].name} (read) for mission ${a.missions ? 'M-126' : 'n/a'}, 2h`, 'Security-01', 0, 'good'),
    mk('denied', 'Denied: write access to billing origin (not granted)', 'policy engine', 1, 'bad'),
    mk('version', `Pinned ${a.version} for new instances`, 'GM', 2),
    mk('model', `Model route set to ${a.model}`, 'Models admin', 3),
    mk('skill', `Skill "${a.skills[0]}" verified (n=${12 + Math.round(r() * 40)})`, 'Tester-01', 4, 'good'),
    mk('report', 'Phase report accepted, provenance linked to 3 events', 'GM', 5),
    mk('denied', 'Denied: delegate outside own department over $20', 'policy engine', 6, 'warn'),
    mk('profile', 'Profile revision saved (skill goals)', 'Luca (Owner)', 7),
  ];
}

export function evolutionFor(a: Agent) {
  const r = seeded(a.id + 'evo');
  return {
    lineage: [
      { v: a.version, label: 'Stable', note: 'Active for new instances', gain: 0, state: 'stable' as const },
      { v: bump(a.version, 1), label: 'Candidate', note: 'Prompt revision: stricter verification checklist', gain: +(1 + r() * 4).toFixed(1), state: 'candidate' as const },
      { v: bump(a.version, 2), label: 'Proposed', note: 'Recipe change: cache tool results per scope', gain: +(0.5 + r() * 2).toFixed(1), state: 'proposed' as const },
    ],
    experiment: { n: 60 + Math.round(r() * 80), baseline: a.success - 2, candidate: Math.min(99, a.success + 1 + Math.round(r() * 2)), reviewer: 'Tester-01', security: 'Security-01' },
  };
}
function bump(v: string, n: number) { const p = v.replace('v', '').split('.').map(Number); p[1] = (p[1] || 0) + n; p[2] = 0; return 'v' + p.join('.'); }

export function mentoringFor(a: Agent) {
  const r = seeded(a.id + 'men');
  const gaps = (Object.entries(a.metrics) as [keyof AgentMetrics, number][]).sort((x, y) => x[1] - y[1]).slice(0, 3);
  return {
    mentor: AGENT_BY_ID['mentor-01'], goals: gaps.map(([k, v]) => ({ metric: k, now: v, target: Math.min(95, v + 8 + Math.round(r() * 6)) })),
    exercises: [
      { id: 1, title: `${METRIC_LABELS[gaps[0][0]]} fundamentals`, state: 'passed', before: gaps[0][1] - 6, after: gaps[0][1], n: 40 },
      { id: 2, title: `${METRIC_LABELS[gaps[1][0]]} under constraint`, state: 'passed', before: gaps[1][1] - 4, after: gaps[1][1], n: 30 },
      { id: 3, title: `${METRIC_LABELS[gaps[2][0]]} edge cases`, state: 'scheduled', before: gaps[2][1], after: 0, n: 0 },
    ],
  };
}

export function perfSeries(a: Agent, key: string, len = 14, base?: number, spread = 6) {
  const r = seeded(a.id + key);
  const b = base ?? a.success;
  return Array.from({ length: len }, (_, i) => Math.round(Math.min(100, Math.max(0, b - spread + (i / len) * spread * 0.8 + (r() - .5) * spread * .8))));
}
