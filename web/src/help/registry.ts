export interface HelpEntry {
  title: string;
  what: string;           // What this means
  why?: string;           // Why it matters
  how?: string;           // How it works
  example?: string;       // Worked example
  permission?: string;    // Current permission / limitation
  shortcut?: string;
  route?: string;         // "More detail" link
}

/** Core help entries (spec §9.2 mandatory examples + shell). Page files in ./pages/*.ts add more. */
const CORE: Record<string, HelpEntry> = {
  'mission.progress.verified': {
    title: 'Verified progress',
    what: 'Progress counts only tasks whose required evidence has passed independent verification. Ongoing work is not counted as complete.',
    why: 'A percentage based on elapsed time or an agent saying "done" would be misleading.',
    how: 'Progress = verified task weight ÷ total planned task weight in the current scope revision.',
    example: '13 of 17 weighted tasks verified → 76%. If QA rejects one, progress goes down.',
  },
  'mission.aiSummary': {
    title: 'AI summary',
    what: 'A short AI-generated brief built from recorded mission events. It changes only when real progress happens.',
    why: 'You can scan many missions at a glance without opening each one.',
    example: '"Header and 11 of 14 pages migrated; QA running visual diffs." Select it to see the source events.',
    permission: 'Summaries may leave out details. Open Timeline for the full record.',
  },
  'agent.instance': {
    title: 'Agent instance',
    what: 'A mission-specific run of a reusable agent. Its state, memory and access are separate from the same agent in other missions.',
    why: 'One agent can work on two missions without leaking data between them.',
    example: 'Coder-01 in M-126 and Coder-01 in M-129 are two instances of the same agent, each with its own pinned version.',
  },
  'agent.capabilities': {
    title: 'Capability scores',
    what: 'Scores come from relevant tests and real mission outcomes. Each one shows its sample size.',
    why: 'They help you pick the right specialist. They do not grant permissions.',
    example: 'Browser 92 (n=140): 129 of 140 evaluated browser tasks passed verification.',
  },
  'hierarchy.delegation': {
    title: 'Hierarchy arrows',
    what: 'Solid downward arrows point from a manager to the agent that received work. Light upward arrows mean a report was sent. Dashed side arrows mean consultation.',
    how: 'A glowing pulse travels along an arrow when a real delegation or report event arrives. Scroll the mouse wheel over the graph to zoom toward the pointer, drag the background to pan, or use the zoom / fit buttons.',
    example: 'GM ⟶ Coder-01 (delegated "Migrate checkout"). Coder-01 ⇢ GM (report with evidence).',
  },
  'conversation.command': {
    title: 'Command',
    what: 'A command is a new instruction from you to the selected agent. It is checked against mission permissions and may need approval.',
    example: '"Re-run the visual diff on the checkout page in dark mode and attach screenshots."',
    permission: 'Commands cannot grant new website origins or tools. An administrator grants those separately.',
    shortcut: 'Ctrl + Enter to send',
  },
  'conversation.reply': {
    title: 'Reply',
    what: 'A reply answers a specific agent question and is tied to that question\'s ID. It does not grant unrelated permissions.',
    example: 'Reply "Wait for Monday" to the publish question; attach a screenshot if helpful.',
  },
  'browser.originGrant': {
    title: 'Website origin grant',
    what: 'A grant lets agents use only the listed domain, actions and mission, for a limited time. New sites need separate permission.',
    example: 'status.example.com · read-only · M-132 · 2 hours.',
  },
  'browser.humanTakeover': {
    title: 'Human takeover',
    what: 'Takeover gives you temporary direct control of the isolated browser session on the VPS. All browser boundaries stay enforced.',
    permission: 'Time-boxed and audited. Credentials are never shown.',
  },
  'artifact.execute': {
    title: 'Run a result',
    what: 'Run opens a safe, isolated preview or asks for a policy-reviewed execution. It never deploys to production.',
    example: 'Run on "customer-portal v1.4" opens a sandbox preview at a private URL.',
  },
  'release.version': {
    title: 'Immutable versions',
    what: 'Every version of a result is kept as-is with a checksum. Older versions stay downloadable while retained by policy.',
    example: 'Download v1.1 even though v1.4 is latest; the SHA-256 matches the manifest.',
  },
  'evolution.promotion': {
    title: 'Promotion',
    what: 'A candidate becomes active only after independent comparison, security tests and the human review it needs.',
    why: 'No agent can approve its own improvement.',
  },
  'org.reorganization': {
    title: 'Reorganization',
    what: 'Changing reporting lines creates a proposed structure. It takes effect only after review and approval.',
  },
  'models.route': {
    title: 'Model route',
    what: 'A route picks which available model handles a task. Compatibility, load and permissions are checked before use; the Model Loader agent picks the model that fits each agent.',
  },
  'settings.faces': {
    title: 'Avatars & faces',
    what: 'These settings change how the synthetic agent avatars look. They have nothing to do with personal identity or face recognition.',
  },
  // shell & dashboard
  'shell.pipeline': {
    title: 'Company loop',
    what: 'Plan → Execute → Verify → Evolve → Sustain is the loop every mission follows. Click a stage to jump to the screen that runs it.',
  },
  'company.health': {
    title: 'Company health',
    what: 'Share of core services that passed their latest health check: agents, execution jobs, infrastructure and knowledge sync.',
    how: 'Each check runs every 60 s. A stale check counts as unhealthy.',
    permission: 'DEMO values in this prototype.',
  },
  'kpi.activeMissions': { title: 'Active missions', what: 'Missions currently planning, running, verifying or waiting for a decision. Drafts, paused and archived missions are not counted.' },
  'kpi.activeAgents': { title: 'Active agents', what: 'Agent definitions with at least one live instance or that are available for work. Training/evolving agents are counted separately.' },
  'kpi.approvals': { title: 'Pending approvals', what: 'Exact actions waiting for a human decision: risky browser actions, origin grants, releases, promotions.' },
  'kpi.success': { title: 'Mission success', what: 'Verified completed missions ÷ eligible finished missions over the last 30 days.', example: '96.4% = 54 of 56.' },
  'kpi.tokens': { title: 'Tokens today', what: 'Tokens consumed today by every agent instance in every mission. Each agent records its own tokens, active time, CPU and RAM.', why: 'Token use is the activity measure. There are no budgets or fund limits.' },
  'agents.directory': { title: 'Agents', what: 'Every agent in the company — exactly one per role and skill set — with its department, status, development stage and verified success. This page also holds the former Organization views: hierarchy, departments, assignments, policies and proposals.', how: 'Filter by status or development chips, department or search. Switch Cards / List / Hierarchy on the right. Click an agent to open its profile.' },
  'agents.lifecycle': { title: 'Agent lifecycle', what: 'Create → Learn → Deploy → Evolve, with the number of agents in each step now. A new version is trained and evaluated before it is deployed to future instances.' },
  'agents.performance': { title: 'Top performers', what: 'Agents ranked by verified success over the last 30 days. Each one needs at least 30 evaluated tasks.' },
  'agents.evolution': { title: 'Evolution pipeline', what: 'Which agents have a candidate version in each phase: Proposal → Experiment → Benchmark → Promotion. Only verified candidates are promoted; click a phase to open it in the Evolution Lab.' },
  'agents.organization': { title: 'Agent organization', what: 'Departments under the General Manager with the number of agents in each.' },
  'missions.list': { title: 'Missions', what: 'One workspace for all missions. Left: the mission list. The five tiles filter by status, ✎ beside a title edits it and 🗑 at the far right archives or deletes it. The line under the title is the current status; the text below is the AI summary. Right: the open mission\'s Mission Control tabs (Overview, Hierarchy, Task Flow, Browser, Conversations, Results, Approvals, Reports, Timeline). Conversations lists the mission\'s agents on the left — pick one to see its conversation partners and threads. Hierarchy shows the selected agent\'s conversation beside the graph. Drag any divider between panes to resize them (double-click resets). ⇤ collapses the list to an icon rail for more room.' },
  'theme.skin': { title: 'Visual skin', what: 'Flat, Luminous, Pretty and Fancy change how things look only: colors, glow, roundness. Logic and permissions stay the same.' },
  'motion.pref': { title: 'Motion', what: 'Full, Subtle or Reduced animation. Reduced removes movement, scaling and loops but keeps color/opacity state changes. System follows your OS setting.' },
};

const pageModules = import.meta.glob<{ default: Record<string, HelpEntry> }>('./pages/*.ts', { eager: true });

export const HELP: Record<string, HelpEntry> = Object.assign({}, CORE, ...Object.values(pageModules).map((m) => m.default));

export function getHelp(key: string): HelpEntry {
  return HELP[key] ?? { title: 'Help', what: `No help entry for "${key}" yet.` };
}
