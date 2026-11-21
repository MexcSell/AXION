import type { Approval, Artifact, Message, Mission, MissionEdge, MissionNode, MissionPhase, Task, TimelineEvent } from './types';
import { AGENT_BY_ID, seeded } from './agents';

const phases = (active: number, blockedAt = -1): MissionPhase[] => {
  const keys: [string, string][] = [['plan', 'Plan'], ['design', 'Design'], ['build', 'Build'], ['verify', 'Verify'], ['deliver', 'Deliver'], ['learn', 'Learn']];
  const dates = ['Nov 10', 'Nov 12', 'Nov 18', 'Nov 22', 'Nov 24', 'Nov 26'];
  return keys.map(([key, label], i) => ({ key, label, date: dates[i], state: i === blockedAt ? 'blocked' : i < active ? 'done' : i === active ? 'active' : 'next' }));
};

const RAW_MISSIONS: Omit<Mission, 'ownerId' | 'shared' | 'content'>[] = [
  {
    id: 'M-126', title: 'Website modernization · customer portal', kind: 'website', status: 'running', priority: 'high', owner: 'Luca',
    objective: 'Rebuild the customer portal with the new design system, responsive layouts and dark/light themes, verified by automated visual and accessibility tests.',
    criteria: [
      { text: 'All 14 portal pages migrated to new components', done: true },
      { text: 'Lighthouse accessibility ≥ 95 on every page', done: true },
      { text: 'Visual regression suite passes in light and dark', done: false },
      { text: 'Owner approves release candidate', done: false },
    ],
    progress: 76, tasksVerified: 13, tasksTotal: 17, blocked: 0,
    agentIds: ['gm', 'planner-01', 'coder-01', 'designer-01', 'browser-01', 'tester-01', 'writer-01'], leadId: 'gm',
    summary: 'Header, navigation and 11 of 14 pages are migrated. QA is running visual diffs on checkout; two contrast issues were fixed in v1.4.',
    summaryAgoMin: 6, lastEvent: 'Tester-01 started visual regression (dark theme)', lastEventAgoMin: 2,
    elapsedH: 31, dueInDays: 4, revision: 3, version: 'v1.4.0', phases: phases(3), pendingApprovals: 1, unread: 3, createdAgoDays: 10,
  },
  {
    id: 'M-127', title: 'Train Browser-01 on checkout flows', kind: 'training', status: 'running', priority: 'normal', owner: 'Luca',
    objective: 'Raise Browser-01 checkout-flow success from 81% to ≥ 92% on the fixed fixture suite without regressions.',
    criteria: [
      { text: 'Fixture suite pass-rate ≥ 92% (n ≥ 50)', done: false },
      { text: 'No security-policy regressions', done: true },
      { text: 'Mentor sign-off with before/after evidence', done: false },
    ],
    progress: 52, tasksVerified: 6, tasksTotal: 12, blocked: 0,
    agentIds: ['mentor-01', 'browser-01', 'tester-01', 'optimizer-01'], leadId: 'mentor-01',
    summary: 'Browser-01 improved from 81% → 88% after locator-recipe exercise 3. Exercise 4 (address forms) starts after QA re-evaluation.',
    summaryAgoMin: 18, lastEvent: 'Mentor-01 assigned exercise 4 to Browser-01', lastEventAgoMin: 11,
    elapsedH: 20, dueInDays: 6, revision: 1, version: 'v0.6.0', phases: phases(2), pendingApprovals: 0, unread: 1, createdAgoDays: 6,
  },
  {
    id: 'M-128', title: 'Homepage structure update', kind: 'structure', status: 'waiting', priority: 'high', owner: 'Luca',
    objective: 'Reorganize homepage sections around missions and outcomes; publish only after Owner review of the preview.',
    criteria: [
      { text: 'New IA approved by Owner', done: true },
      { text: 'Preview deployed to sandbox', done: true },
      { text: 'Owner approves publish', done: false },
    ],
    progress: 91, tasksVerified: 10, tasksTotal: 11, blocked: 1,
    agentIds: ['gm', 'designer-01', 'coder-01', 'writer-01', 'release-01'], leadId: 'gm',
    summary: 'Preview is live in the sandbox with the new hero, mission showcase and pricing blocks. Waiting for your publish decision.',
    summaryAgoMin: 25, lastEvent: 'Release-01 requested publish approval', lastEventAgoMin: 24,
    elapsedH: 14, dueInDays: 1, revision: 2, version: 'v2.1.0', phases: phases(4, 4), pendingApprovals: 1, unread: 2, createdAgoDays: 5,
  },
  {
    id: 'M-129', title: 'Self-update: AXION dashboard v2.5', kind: 'self-update', status: 'verifying', priority: 'high', owner: 'Luca',
    objective: 'Agents propose and implement dashboard improvements as a reviewed source patch with tests, previews and rollback plan.',
    criteria: [
      { text: 'Patch passes unit, E2E and visual suites', done: true },
      { text: 'Independent QA verdict: pass', done: false },
      { text: 'Owner approves merge + release separately', done: false },
    ],
    progress: 68, tasksVerified: 11, tasksTotal: 16, blocked: 0,
    agentIds: ['gm', 'coder-01', 'tester-01', 'security-01', 'release-01'], leadId: 'gm',
    summary: 'Branch mission/M-129 has 14 commits. Security-01 found no policy changes. Tester-01 is running the independent E2E suite.',
    summaryAgoMin: 9, lastEvent: 'Security-01 passed policy-diff review', lastEventAgoMin: 8,
    elapsedH: 26, dueInDays: 3, revision: 4, version: 'v2.5.0-rc.2', phases: phases(3), pendingApprovals: 0, unread: 0, createdAgoDays: 8,
  },
  {
    id: 'M-130', title: 'Competitor intelligence report', kind: 'research', status: 'running', priority: 'normal', owner: 'Mina',
    objective: 'Research 8 competitor products, collect cited evidence and deliver a comparison report with recommendations.',
    criteria: [
      { text: '8 competitors profiled with ≥ 3 sources each', done: true },
      { text: 'Every claim cited', done: false },
      { text: 'Executive summary approved', done: false },
    ],
    progress: 42, tasksVerified: 5, tasksTotal: 12, blocked: 0,
    agentIds: ['researcher-01', 'analyst-01', 'writer-01', 'browser-01'], leadId: 'researcher-01',
    summary: '5 of 8 competitor profiles are complete with citations. Analyst-01 is building the pricing comparison matrix.',
    summaryAgoMin: 14, lastEvent: 'Browser-01 captured pricing page (granted origin)', lastEventAgoMin: 5,
    elapsedH: 9, dueInDays: 5, revision: 1, version: 'v0.9.2', phases: phases(2), pendingApprovals: 0, unread: 1, createdAgoDays: 3,
  },
  {
    id: 'M-131', title: 'Knowledge base consolidation', kind: 'data', status: 'running', priority: 'low', owner: 'Luca',
    objective: 'Deduplicate and verify 1,248 knowledge entries; flag contradictions for review.',
    criteria: [{ text: 'Duplicate rate < 2%', done: true }, { text: 'Contradictions reviewed', done: false }],
    progress: 64, tasksVerified: 7, tasksTotal: 11, blocked: 0,
    agentIds: ['knowledge-01', 'researcher-01', 'tester-01'], leadId: 'knowledge-01',
    summary: '248 duplicates merged; 17 contradictions are queued for your review in Knowledge › Learning Queue.',
    summaryAgoMin: 33, lastEvent: 'Knowledge-01 merged 32 duplicate entries', lastEventAgoMin: 30,
    elapsedH: 7, dueInDays: 9, revision: 1, version: 'v0.4.0', phases: phases(2), pendingApprovals: 0, unread: 0, createdAgoDays: 4,
  },
  {
    id: 'M-132', title: 'Security & compliance audit (public pages)', kind: 'automation', status: 'waiting', priority: 'critical', owner: 'Luca',
    objective: 'Audit every public page for exposed secrets, missing headers and third-party scripts; propose fixes.',
    criteria: [{ text: 'All 42 pages scanned', done: true }, { text: 'Findings triaged', done: false }, { text: 'Fix patch approved', done: false }],
    progress: 58, tasksVerified: 7, tasksTotal: 12, blocked: 1,
    agentIds: ['security-01', 'browser-01', 'coder-01'], leadId: 'security-01',
    summary: 'Scan complete: 3 medium findings (CSP, cookie flags). Browser-01 needs a new origin grant for the status page.',
    summaryAgoMin: 12, lastEvent: 'Browser-01 requested origin grant status.example.com', lastEventAgoMin: 12,
    elapsedH: 6, dueInDays: 2, revision: 1, version: 'v0.3.1', phases: phases(2, 2), pendingApprovals: 2, unread: 2, createdAgoDays: 2,
  },
  {
    id: 'M-133', title: 'Mentor program: Tester-01', kind: 'training', status: 'completed', priority: 'normal', owner: 'Mina',
    objective: 'Coach QA agents on visual-diff triage; prove improvement on a fresh challenge set.',
    criteria: [{ text: 'Triage accuracy +10pp', done: true }, { text: 'No regression on fixed set', done: true }],
    progress: 100, tasksVerified: 9, tasksTotal: 9, blocked: 0,
    agentIds: ['mentor-01', 'tester-01'], leadId: 'mentor-01',
    summary: 'Verified: triage accuracy improved 84% → 95% (n=120). Tester-01 v2.4.0 promoted for future instances.',
    summaryAgoMin: 1440, lastEvent: 'Promotion approved by Owner', lastEventAgoMin: 1430,
    elapsedH: 40, dueInDays: -2, revision: 1, version: 'v1.0.0', phases: phases(6), pendingApprovals: 0, unread: 0, createdAgoDays: 14,
  },
  {
    id: 'M-134', title: 'Org restructure: Growth department', kind: 'structure', status: 'planning', priority: 'normal', owner: 'Luca',
    objective: 'Propose a Growth department (marketing, analytics, writer) with simulated workload and approval.',
    criteria: [{ text: 'Before/after org diff reviewed', done: false }, { text: 'Simulation shows no coverage gaps', done: false }],
    progress: 12, tasksVerified: 1, tasksTotal: 8, blocked: 0,
    agentIds: ['gm', 'planner-01', 'analyst-01'], leadId: 'gm',
    summary: 'GM drafted the department charter. Planner-01 is simulating workload across active missions.',
    summaryAgoMin: 48, lastEvent: 'Planner-01 started workload simulation', lastEventAgoMin: 40,
    elapsedH: 2, dueInDays: 7, revision: 1, version: 'v0.1.0', phases: phases(0), pendingApprovals: 0, unread: 0, createdAgoDays: 1,
  },
  {
    id: 'M-135', title: 'Support FAQ automation', kind: 'automation', status: 'paused', priority: 'low', owner: 'Mina',
    objective: 'Draft answers for the 60 most frequent support questions and publish them to the help center after review.',
    criteria: [{ text: '60 answers drafted', done: true }, { text: 'Owner review', done: false }],
    progress: 35, tasksVerified: 3, tasksTotal: 9, blocked: 0,
    agentIds: ['comms-01', 'writer-01', 'knowledge-01'], leadId: 'comms-01',
    summary: 'Paused by Owner to reprioritize work. 60 drafts are saved as v0.3; nothing was published.',
    summaryAgoMin: 300, lastEvent: 'Mission paused by Luca', lastEventAgoMin: 298,
    elapsedH: 5, dueInDays: 12, revision: 1, version: 'v0.3.0', phases: phases(2), pendingApprovals: 0, unread: 0, createdAgoDays: 7,
  },
  {
    id: 'M-136', title: 'Product catalog data refresh', kind: 'data', status: 'completed', priority: 'normal', owner: 'Luca',
    objective: 'Refresh 2,400 product records from approved supplier pages and publish a validated dataset.',
    criteria: [{ text: 'Schema validation 100%', done: true }, { text: 'Sample audit ≥ 99% accurate', done: true }],
    progress: 100, tasksVerified: 10, tasksTotal: 10, blocked: 0,
    agentIds: ['integrator-01', 'browser-01', 'analyst-01', 'tester-01'], leadId: 'integrator-01',
    summary: 'Verified dataset v3 published (2,412 rows, 99.6% audit accuracy). Versions v1–v3 are downloadable.',
    summaryAgoMin: 2880, lastEvent: 'Dataset v3 verified by Tester-01', lastEventAgoMin: 2870,
    elapsedH: 18, dueInDays: -4, revision: 2, version: 'v3.0.0', phases: phases(6), pendingApprovals: 0, unread: 0, createdAgoDays: 12,
  },
  {
    id: 'M-125', title: 'Landing page A/B variants', kind: 'website', status: 'failed', priority: 'normal', owner: 'Mina',
    objective: 'Produce 3 landing page variants and run a sandboxed A/B readiness check.',
    criteria: [{ text: '3 variants built', done: true }, { text: 'Performance budget met', done: false }],
    progress: 66, tasksVerified: 6, tasksTotal: 9, blocked: 2,
    agentIds: ['designer-01', 'coder-01', 'optimizer-01'], leadId: 'designer-01',
    summary: 'Variant C exceeded the 2.5s LCP budget twice. Retry from checkpoint is available after an image-pipeline fix.',
    summaryAgoMin: 720, lastEvent: 'Verification failed: LCP 3.1s', lastEventAgoMin: 715,
    elapsedH: 11, dueInDays: -1, revision: 2, version: 'v0.8.0', phases: phases(3, 3), pendingApprovals: 0, unread: 0, createdAgoDays: 9,
  },
  {
    id: 'M-118', title: 'Legacy blog migration', kind: 'website', status: 'archived', priority: 'low', owner: 'Luca',
    objective: 'Migrate 120 legacy blog posts into the new CMS.', criteria: [{ text: 'All posts migrated', done: true }],
    progress: 100, tasksVerified: 6, tasksTotal: 6, blocked: 0,
    agentIds: ['writer-01', 'integrator-01'], leadId: 'writer-01',
    summary: 'Archived after completion. Retention until 2027-05-01.',
    summaryAgoMin: 30000, lastEvent: 'Archived by Luca', lastEventAgoMin: 29000,
    elapsedH: 8, dueInDays: -30, revision: 1, version: 'v1.0.0', phases: phases(6), pendingApprovals: 0, unread: 0, createdAgoDays: 40,
  },
];

/**
 * Who added each fixture mission, and whether it is shared (owner update 2026-11-20 u1).
 * u-1 is always the first account created in this browser (the administrator).
 * Users see their own missions plus shared ones; administrators see all.
 */
export const FIXTURE_OWNERS: Record<string, { ownerId: string; shared: boolean }> = {
  'M-126': { ownerId: 'u-1', shared: true }, 'M-127': { ownerId: 'u-1', shared: false }, 'M-128': { ownerId: 'u-1', shared: false },
  'M-129': { ownerId: 'u-1', shared: false }, 'M-130': { ownerId: 'u-mina', shared: true }, 'M-131': { ownerId: 'u-kenji', shared: true },
  'M-132': { ownerId: 'u-1', shared: false }, 'M-133': { ownerId: 'u-mina', shared: true }, 'M-134': { ownerId: 'u-1', shared: false },
  'M-135': { ownerId: 'u-mina', shared: false }, 'M-136': { ownerId: 'u-sara', shared: false }, 'M-125': { ownerId: 'u-mina', shared: false },
  'M-118': { ownerId: 'u-1', shared: false },
};

export const MISSIONS: Mission[] = RAW_MISSIONS.map((m) => ({
  ...m, ...(FIXTURE_OWNERS[m.id] ?? { ownerId: 'u-1', shared: false }),
  content: { text: m.objective, files: [] },
}));


/* ------------------------------------------------------------------ */
/* Mission Control fixture generator — every mission gets a full set.   */
/* ------------------------------------------------------------------ */

const TASK_TITLES: Record<string, string[]> = {
  website: ['Audit current portal', 'Define page inventory', 'Design tokens & themes', 'Build navigation shell', 'Migrate account pages', 'Migrate checkout pages', 'Visual regression suite', 'Accessibility audit', 'Release candidate'],
  training: ['Baseline evaluation', 'Pick failure clusters', 'Design exercises', 'Run exercise set', 'Fresh challenge set', 'Mentor review', 'Promotion proposal'],
  structure: ['Collect requirements', 'Draft new structure', 'Simulate workload', 'Build preview', 'Review diff', 'Owner decision'],
  'self-update': ['Proposal & scope', 'Create branch', 'Implement patch', 'Unit + E2E tests', 'Policy-diff review', 'Independent QA', 'Release plan'],
  research: ['Define questions', 'Collect sources', 'Profile competitors', 'Pricing matrix', 'Cite & verify', 'Write report'],
  data: ['Inventory sources', 'Extract records', 'Validate schema', 'Deduplicate', 'Sample audit', 'Publish dataset'],
  automation: ['Scope & grants', 'Crawl pages', 'Analyze findings', 'Draft fixes', 'Owner review'],
};

const LINES = {
  delegation: [
    'Please take "{task}". Acceptance: evidence attached, tests green, report back to me when done.',
    'Assigning "{task}" to you. Time box: 40 min. Ask me if a new website origin is needed.',
    'New subtask: {task}. Use the current design tokens and keep changes scoped to this mission branch.',
  ],
  ack: ['Acknowledged. Starting "{task}" now.', 'Received — I will report progress at each checkpoint.', 'On it. ETA ~25 minutes; I will attach evidence.'],
  report: [
    'Report: "{task}" is complete. Evidence: 3 screenshots, test log (24/24 passed). Ready for verification.',
    'Progress on "{task}": 70% — remaining items are edge cases in dark mode. No blockers.',
    'Done with "{task}". Artifact v1.3 uploaded; checksum attached. Requesting QA verification.',
  ],
  consult: [
    'Quick check: does the spacing token change affect your tables? I can keep the old value for data-dense views.',
    'Can you confirm the locator for the submit button? I see two candidates with the same label.',
    'Sharing a finding: the pricing page loads a third-party script before consent. Flagging for review.',
  ],
  question: [
    'Question for Owner: publish the new homepage preview now, or wait for the Monday campaign?',
    'I need a decision: allow navigation to status.example.com for the audit? It is not in the current grant.',
  ],
};

const fill = (s: string, task: string) => s.replace('{task}', task);

export interface MissionControlData {
  nodes: MissionNode[];
  edges: MissionEdge[];
  threads: Record<string, Message[]>; // key = sorted pair "a|b"
  tasks: Task[];
  artifacts: Artifact[];
  approvals: Approval[];
  timeline: TimelineEvent[];
}

export const threadKey = (a: string, b: string) => [a, b].sort().join('|');

const STATE_CYCLE: MissionNode['state'][] = ['working', 'working', 'verifying', 'waiting', 'reporting', 'idle'];

export function buildMissionControl(m: Mission): MissionControlData {
  const r = seeded(m.id);
  const lead = m.leadId;
  const others = m.agentIds.filter((a) => a !== lead);
  // hierarchy: lead → up to 2 managers → specialists; verifier (qa) reports to lead
  const managers = others.slice(0, Math.min(2, Math.max(1, Math.floor(others.length / 3))));
  const specialists = others.filter((a) => !managers.includes(a));
  const nodes: MissionNode[] = [];
  const titles = TASK_TITLES[m.kind] ?? TASK_TITLES.website;
  const inst = (a: string) => `${m.id}:${a}`;
  const doneAll = m.status === 'completed' || m.status === 'archived';
  const stateFor = (i: number): MissionNode['state'] => doneAll ? 'done' : m.status === 'paused' ? 'idle' : m.status === 'failed' && i === 1 ? 'blocked' : m.status === 'waiting' && i === 0 ? 'waiting' : STATE_CYCLE[i % STATE_CYCLE.length];

  nodes.push({ instanceId: inst(lead), agentId: lead, task: 'Coordinating mission plan', state: doneAll ? 'done' : m.status === 'waiting' ? 'waiting' : 'working', tasks: titles.length, pending: m.pendingApprovals, progress: m.progress });
  managers.forEach((a, i) => nodes.push({ instanceId: inst(a), agentId: a, parent: inst(lead), task: titles[(i + 1) % titles.length], state: stateFor(i), tasks: 3 + Math.round(r() * 3), pending: i === 0 ? m.unread : 0, progress: Math.round(40 + r() * 55) }));
  specialists.forEach((a, i) => {
    const parent = managers.length ? inst(managers[i % managers.length]) : inst(lead);
    nodes.push({ instanceId: inst(a), agentId: a, parent, task: titles[(i + 3) % titles.length], state: stateFor(i + 2), tasks: 1 + Math.round(r() * 3), pending: 0, progress: Math.round(20 + r() * 80) });
  });

  const edges: MissionEdge[] = [];
  for (const n of nodes) if (n.parent) {
    edges.push({ from: n.parent, to: n.instanceId, kind: 'delegated' });
    edges.push({ from: n.instanceId, to: n.parent, kind: 'reports' });
  }
  // lateral consult between first two specialists, verifier edge for qa agents
  if (specialists.length > 1) edges.push({ from: inst(specialists[0]), to: inst(specialists[1]), kind: 'consults' });
  const qa = m.agentIds.find((a) => AGENT_BY_ID[a]?.role === 'qa' || AGENT_BY_ID[a]?.role === 'security');
  const verifyTarget = specialists.find((a) => a !== qa);
  if (qa && verifyTarget) edges.push({ from: inst(qa), to: inst(verifyTarget), kind: 'verifies' });
  const mentor = m.agentIds.find((a) => AGENT_BY_ID[a]?.role === 'mentor');
  if (mentor) for (const s of specialists.filter((a) => a !== mentor).slice(0, 2)) edges.push({ from: inst(mentor), to: inst(s), kind: 'mentors' });

  // threads
  const threads: Record<string, Message[]> = {};
  let mid = 0;
  const push = (a: string, b: string, msg: Omit<Message, 'id'>) => {
    const k = threadKey(a, b);
    (threads[k] ??= []).push({ id: `${m.id}-msg-${++mid}`, ...msg });
  };
  for (const n of nodes) {
    if (!n.parent) continue;
    const sup = nodes.find((x) => x.instanceId === n.parent)!.agentId;
    const me = n.agentId;
    const task = n.task;
    let t = 300 + Math.round(r() * 200);
    push(sup, me, { from: sup, to: me, kind: 'delegation', text: fill(LINES.delegation[Math.floor(r() * 3)], task), agoMin: t, taskId: `T-${100 + mid}` });
    t -= 3 + Math.round(r() * 6);
    push(sup, me, { from: me, to: sup, kind: 'ack', text: fill(LINES.ack[Math.floor(r() * 3)], task), agoMin: t, status: 'acknowledged' });
    t -= 40 + Math.round(r() * 60);
    push(sup, me, { from: me, to: sup, kind: 'report', text: fill(LINES.report[1], task), agoMin: t });
    t -= 20 + Math.round(r() * 60);
    if (n.state === 'done' || n.state === 'verifying' || n.state === 'reporting') {
      push(sup, me, {
        from: me, to: sup, kind: 'result', text: fill(LINES.report[Math.floor(r() * 2) === 0 ? 0 : 2], task), agoMin: Math.max(1, t),
        attachments: [{ id: 'att-' + mid, name: `${task.toLowerCase().replace(/[^a-z]+/g, '-')}-evidence.png`, kind: 'image', size: '412 KB' }],
      });
      push(sup, me, { from: sup, to: me, kind: 'reply', text: 'Thanks — forwarding to QA for independent verification. Good work.', agoMin: Math.max(1, t - 2) });
    }
  }
  if (specialists.length > 1) {
    const [a, b] = specialists;
    push(a, b, { from: a, to: b, kind: 'consult', text: LINES.consult[Math.floor(r() * 3)], agoMin: 95 });
    push(a, b, { from: b, to: a, kind: 'consult', text: 'Good catch. Keep the old value for dense tables; I will update my snapshot baseline.', agoMin: 91 });
  }
  // human ↔ lead thread
  push('human:owner', lead, { from: 'human:owner', to: lead, kind: 'command', text: `Mission started: ${m.title}. Keep me posted at every phase change.`, agoMin: 600, status: 'acknowledged' });
  push('human:owner', lead, { from: lead, to: 'human:owner', kind: 'report', text: m.summary, agoMin: m.summaryAgoMin });
  if (m.pendingApprovals > 0) push('human:owner', lead, { from: lead, to: 'human:owner', kind: 'question', text: m.kind === 'automation' ? LINES.question[1] : m.kind === 'structure' ? LINES.question[0] : `Decision needed: approve release candidate ${m.version} for staging? QA evidence is attached in Results.`, agoMin: m.lastEventAgoMin, replyTo: `APR-${m.id}-1` });

  // task DAG (3–4 columns)
  const tasks: Task[] = titles.map((title, i) => {
    const col = Math.min(4, Math.floor((i * 5) / titles.length));
    const fraction = (i + 1) / titles.length;
    const state: Task['state'] = doneAll ? 'passed'
      : fraction <= m.progress / 100 ? 'passed'
      : fraction - 1 / titles.length <= m.progress / 100 ? (m.status === 'waiting' ? 'waiting-user' : m.status === 'failed' ? 'failed' : m.status === 'paused' ? 'queued' : 'running')
      : i === titles.length - 1 ? 'queued' : r() > .5 ? 'ready' : 'queued';
    return { id: `T-${m.id.slice(2)}${String(i + 1).padStart(2, '0')}`, title, owner: m.agentIds[(i % (m.agentIds.length - 1)) + 1] ?? lead, deps: [], state, weight: 1 + Math.round(r() * 2), evidence: state === 'passed' ? 1 + Math.round(r() * 4) : 0, col, row: 0 };
  });
  const byCol: Record<number, Task[]> = {};
  tasks.forEach((t) => (byCol[t.col] ??= []).push(t));
  Object.values(byCol).forEach((arr) => arr.forEach((t, i) => (t.row = i)));
  tasks.forEach((t) => { const prev = byCol[t.col - 1]; if (prev?.length) t.deps = [prev[t.row % prev.length].id, ...(prev.length > 1 && t.row === 0 ? [prev[prev.length - 1].id] : [])].filter((v, i, a) => a.indexOf(v) === i); });

  // artifacts
  const artifactNames: Record<string, [string, Artifact['type'], boolean][]> = {
    website: [['customer-portal (site build)', 'website', true], ['design-tokens.json', 'code', false], ['visual-diff-report.pdf', 'report', false], ['portal-home-dark.png', 'screenshot', false]],
    training: [['checkout-locator-recipe', 'recipe', true], ['evaluation-results.csv', 'dataset', false], ['mentor-report.md', 'document', false]],
    structure: [['homepage-preview (site build)', 'website', true], ['ia-diagram.png', 'image', false], ['structure-diff.json', 'code', false]],
    'self-update': [['axion-web patch (M-129)', 'code', true], ['e2e-results.html', 'report', false], ['release-manifest.json', 'document', false]],
    research: [['competitor-report.pdf', 'report', false], ['pricing-matrix.csv', 'dataset', false], ['sources-bundle.zip', 'document', false]],
    data: [['catalog-dataset.parquet', 'dataset', false], ['validation-report.html', 'report', false]],
    automation: [['audit-findings.md', 'document', false], ['csp-fix.patch', 'code', true], ['page-scan.mp4', 'video', false]],
  };
  const vcount = Math.max(1, Math.round(m.progress / 25));
  const artifacts: Artifact[] = (artifactNames[m.kind] ?? artifactNames.website).map(([name, type, runnable], i) => ({
    id: `${m.id}-A${i + 1}`, name, type, missionId: m.id, runnable, tags: [m.kind, type],
    versions: Array.from({ length: Math.max(1, vcount - (i > 1 ? 1 : 0)) }, (_, k) => k).map((k, _i, arr) => {
      const n = arr.length - k;
      return {
        v: `v1.${n - 1}`, hash: 'sha256:' + Math.floor(seeded(name + n)() * 0xffffffff).toString(16).padStart(8, '0') + Math.floor(seeded(n + name)() * 0xffffffff).toString(16).padStart(8, '0'),
        size: `${(0.2 + seeded(name + k)() * 9).toFixed(1)} MB`, agoMin: 20 + k * 260 + i * 15, by: m.agentIds[(i + k) % m.agentIds.length],
        notes: k === 0 ? 'Latest build after review fixes' : k === arr.length - 1 ? 'Initial version' : 'Iteration with QA feedback applied', verified: k > 0 || m.status === 'completed',
      };
    }),
  }));

  const approvals: Approval[] = Array.from({ length: m.pendingApprovals }, (_, i) => ({
    id: `APR-${m.id}-${i + 1}`, missionId: m.id, agentId: i === 0 ? (m.kind === 'automation' ? 'browser-01' : 'release-01') : 'security-01',
    title: m.kind === 'automation' ? (i === 0 ? 'Grant origin status.example.com' : 'Submit CSP header fix to staging') : m.kind === 'structure' ? 'Publish homepage preview v2.1 to production' : 'Approve release candidate v1.4 for staging',
    detail: m.kind === 'automation' ? 'Read-only navigation for 2 hours, mission M-132 only. No form submissions.' : 'Exact revision sha256:9f1c…a24e. Canary 10% for 30 min, automatic rollback on error-rate > 1%.',
    risk: i === 0 ? 'high' : 'medium', kind: m.kind === 'automation' ? (i === 0 ? 'origin-grant' : 'browser-action') : 'release', expiresMin: 90 - i * 30, agoMin: m.lastEventAgoMin + i * 4, status: 'pending',
  }));

  const evTypes: TimelineEvent['type'][] = ['create', 'delegate', 'delegate', 'browser', 'model', 'message', 'artifact', 'verify', 'report', 'approval'];
  const timeline: TimelineEvent[] = Array.from({ length: 16 }, (_, i) => {
    const type = evTypes[i % evTypes.length];
    const actor = i === 0 ? 'human:owner' : m.agentIds[i % m.agentIds.length];
    const nm = AGENT_BY_ID[actor]?.name ?? 'Luca (Owner)';
    const text: Record<TimelineEvent['type'], string> = {
      create: `Mission ${m.id} created (revision ${m.revision})`, delegate: `${nm} delegated "${titles[i % titles.length]}"`,
      browser: `${nm} navigated to granted origin · screenshot captured`, model: `${nm} model call · 2.1k tokens`,
      message: `${nm} sent a progress report upward`, artifact: `${nm} uploaded artifact version`, verify: `${nm} verification passed (evidence ×3)`,
      report: `${nm} submitted phase report`, approval: `${nm} requested approval`, error: `${nm} encountered a recoverable error`, release: `${nm} prepared release candidate`,
    };
    return { id: `${m.id}-ev-${i}`, agoMin: Math.max(1, Math.round(m.lastEventAgoMin + (15 - i) * 38 * r())), actor, type, text: text[type], missionId: m.id, trace: `tr_${m.id.slice(2)}${(i * 7919).toString(36)}` };
  }).sort((a, b) => a.agoMin - b.agoMin);

  return { nodes, edges, threads, tasks, artifacts, approvals, timeline };
}

const cache = new Map<string, MissionControlData>();
/** The prototype's generated Mission Control data (demo mode; DEMO artifacts and timeline in api mode). */
export function fixtureMissionControl(m: Mission) {
  // keyed by the team too: agents join a mission while it runs (owner update u1)
  const key = `${m.id}|${m.leadId}|${m.agentIds.join(',')}`;
  if (!cache.has(key)) cache.set(key, buildMissionControl(m));
  return cache.get(key)!;
}

/**
 * api mode (Stage 6): web/src/api/missionControl.ts registers a provider that answers from the server's data.
 * It returns null when it does not apply (demo mode), and the fixture is used. Kept as a plain hook point because
 * the server imports this file too (seeding, backfill) and must not pull in browser modules.
 */
type Provider = (m: Mission) => MissionControlData | null;
let provider: Provider | null = null;
export function setMissionControlProvider(p: Provider | null) { provider = p; }

export function getMissionControl(m: Mission): MissionControlData {
  return provider?.(m) ?? fixtureMissionControl(m);
}
