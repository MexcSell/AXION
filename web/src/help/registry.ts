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
  // improvement cycle 2: the company scorecard (api mode), computed by the server from recorded events only
  'kpi.success.api': { title: 'Verified success', what: 'Verified completions ÷ every finished mission (completed, failed or canceled) over the last 30 days, among the missions you can see. DEMO missions are left out. "n" is the number of finished missions.', why: 'A completion counts as verified only when someone other than the mission owner checked it. Below 3 finished missions there is not enough evidence, so no number is shown.', how: 'The Company Scorecard beside it explains every count; hover the n for the evidence.' },
  'kpi.staffedAgents': { title: 'Staffed agents', what: 'Agents with a live, real (not simulated) instance on one of your visible, non-DEMO missions that is planning, running, verifying or waiting. Counted from the server\'s agent instances.', why: 'Agents do not execute work before Stage 7, so "active" cannot be measured yet; being staffed on a real mission can.' },
  'company.scorecard': { title: 'Company scorecard', example: 'An arrow and "↑ 40.0%" mean the previous period of the same length had 40.0% and this one is higher. Flat means within 1 point for rates, 0.1 h for times, equal for counts. The arrow shows direction only, not better or worse. No arrow means one of the two periods has fewer than 3 samples, so there is no trend to claim.', what: 'Company performance measured from recorded data only: mission state changes, runs, tasks, task attempts, approval decisions and delegations. Each row shows its value, its sample size n, the window and (on hover) a sentence naming the evidence.', why: 'Nothing executes yet, so most rows have little evidence. A rate or median needs at least 3 samples; below that the row shows "—" instead of a number. Numbers are never invented.', how: 'Switch the window (7, 30 or 90 days). "include DEMO missions" adds the sample missions, and the panel is then tagged DEMO. Only missions you can see are counted, so two people can see different numbers.' },
  'scorecard.throughput': { title: 'Weekly throughput', what: 'Missions started (grey) and finished (colour) in each of the last 8 weeks, as plain counts. A finished mission counts once, in the week of its last final state. Hover a pair for the exact numbers.', why: 'It shows direction without any ratio. Only missions you can see are counted, and DEMO ones only when the switch is on.' },
  'scorecard.started': { title: 'Missions started', what: 'Missions whose first run started in the window. A resume adds a run but does not start the mission again.' },
  'scorecard.finished': { title: 'Missions finished', what: 'Missions that reached completed, failed or canceled in the window. Each mission counts once, by its last final state (failed → retry → completed counts as completed). Restoring a mission from the archive is not a new finish.' },
  'scorecard.verified_success_rate': { title: 'Verified success', what: 'Verified completions ÷ finished missions.', why: 'A completion is verified only when, before it completed, a person other than the mission owner approved one of its approval requests, or when every task passed and a verifier agent was delegated to check it. Everything else is "completed, unverified".', example: '3 of 7 finished missions verified · 2 completed unverified. Shown as "—" while fewer than 3 missions finished.' },
  'scorecard.completed_unverified': { title: 'Completed, unverified', what: 'Completions in the window that nobody but the owner checked. n is the number of completions.', why: 'They count as finished but never as success.' },
  'scorecard.median_cycle_time_h': { title: 'Median cycle time', what: 'Hours from a mission\'s first run start to its final state, median over finished missions that had a run. A mission canceled before it ever ran is left out.', why: '"—" while fewer than 3 samples exist.' },
  'scorecard.failure_rate': { title: 'Failure rate', what: '(Failed + canceled) ÷ finished missions. A canceled mission counts as a failure to deliver.', why: '"—" while fewer than 3 missions finished.' },
  'scorecard.task_recovery_rate': { title: 'Task recovery', what: 'Tasks with more than one attempt that ended passed ÷ all tasks with more than one attempt. A task is placed in the window by its latest recorded attempt time.', why: '"—" while fewer than 3 tasks were retried. Tasks are not executed before Stage 7, so this stays empty for now.' },
  'scorecard.waiting_approval_median_h': { title: 'Waiting for approval', what: 'Median hours a mission spent waiting for an approval, from the recorded state changes. n counts closed waits (a mission can wait several times); a wait still open is not counted.', why: '"—" while fewer than 3 waits have ended in the window.' },
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
