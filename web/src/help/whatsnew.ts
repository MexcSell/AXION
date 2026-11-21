import type { HelpEntry } from './registry';

/**
 * Improvement cycle 17: the owner's "What's new" guide (Help Center, first tab). One short plain-language page per
 * feature built since Stage 5. Written from PROGRESS.md (Stages 5 and 6) and docs/improve/LOG.md. Every page says what
 * is real, what is still DEMO, and gives a link into the feature.
 * Status: real = measured/stored on the server; mixed = real parts and DEMO parts; later = built on another branch and
 * not in this version of the app yet (the page says so, and the link goes to the closest screen that exists today).
 */
export type WhatsNewStatus = 'real' | 'mixed' | 'later';
export type WhatsNewGroup = 'Stage 5 · the server' | 'Stage 6 · agents and conversations' | 'Improvement loop';

export interface WhatsNewItem {
  key: string;
  group: WhatsNewGroup;
  title: string;
  status: WhatsNewStatus;
  /** one line for the list */
  line: string;
  does: string;
  where: string;
  real: string;
  demo: string;
  limits?: string;
  /** deep link; the browser check opens every one and checks it lands */
  route: string;
  /** what the browser check expects after the link: the page tab panel label (or "dock" for the chat dock, "profile" for an agent page) */
  lands: string;
  linkLabel: string;
}

export const WHATS_NEW: WhatsNewItem[] = [
  {
    key: 'signin', group: 'Stage 5 · the server', title: 'Real sign-in and your devices', status: 'real',
    line: 'Names, passwords and approval of new people and browsers',
    does: 'You connect with a name and a password. The first name that ever connects becomes the administrator. Everyone after that, and every new browser, waits until an administrator approves it.',
    where: 'The Connect screen, and Settings, Users (your profile, password and devices; the administrator also sees the approvals there).',
    real: 'Passwords are stored only as a one-way scramble (argon2id). Sessions expire after 24 idle hours or 30 days. Changing your password signs out your other devices. Members see only the names and avatars of other people.',
    demo: 'Nothing here is DEMO. The offline prototype (open any page with ?data=demo) has its own pretend sign-in that is not secure.',
    limits: 'One person per browser. For a second person use another browser or a private window.',
    route: '/settings?tab=users', lands: 'Users', linkLabel: 'Open Settings, Users',
  },
  {
    key: 'approvals', group: 'Stage 5 · the server', title: 'Approvals on the server', status: 'real',
    line: 'Exact actions that wait for a person to say yes or no',
    does: 'When something needs a decision (for example a mission asks to continue), it appears as an approval. Your decision is saved with who made it and when. An approval can be decided once, and it expires if nobody answers.',
    where: 'Notifications, Pending (waiting) and Resolved (decided).',
    real: 'The decision is checked against the exact action it was made for, so it cannot be reused for something else. Decisions are written to a log that cannot be edited afterwards.',
    demo: 'The sample approvals that come with the DEMO missions are marked DEMO and expire after a week.',
    limits: 'Open question for you: today any member who can see a shared mission may decide its approvals. Say if only the owner and administrators should.',
    route: '/notifications?tab=pending', lands: 'Pending', linkLabel: 'Open Pending approvals',
  },
  {
    key: 'missions', group: 'Stage 5 · the server', title: 'Missions on the server', status: 'mixed',
    line: 'Create, share, pause, resume, cancel and retry; live for everyone',
    does: 'Missions are stored on the server, not in your browser. You can create, edit, share, pause, resume, cancel, retry and archive them. Two people looking at the same mission see changes at once.',
    where: 'Missions (the list on the left, Mission Control on the right). The top bar shows Live, Reconnecting or Stale.',
    real: 'The list, the state changes, the sharing, uploads (up to 25 MB, checked by their real content) and the live updates are real and saved.',
    demo: 'Nothing executes yet. No agent, model or browser runs, so a mission is planned and staffed by a labelled simulation and never actually does the work. The sample missions are tagged DEMO and an administrator can remove them. Task Flow, Activity numbers and results on sample missions are still DEMO.',
    limits: 'Real work starts only when execution is built and switched on (a later stage).',
    route: '/missions', lands: 'Overview', linkLabel: 'Open Missions',
  },
  {
    key: 'health', group: 'Stage 5 · the server', title: 'Server health and backups', status: 'real',
    line: 'Is the server up, and is there a backup that restores',
    does: 'A read-only panel showing the real server: how long it has been up, database size, number of missions, newest backup, and whether execution is enabled (it is not).',
    where: 'System Operations, Services (administrators only).',
    real: 'Every number comes from the running server and refreshes every 15 seconds. Backups are made on the server and a restore check proves a backup can be restored.',
    demo: 'The other Operations tabs (VMs, Workers, Queues, Logs and so on) are still DEMO.',
    route: '/operations?tab=services', lands: 'Services', linkLabel: 'Open System Operations',
  },
  {
    key: 'agents', group: 'Stage 6 · agents and conversations', title: 'Agents and their versions', status: 'mixed',
    line: '24 agents saved on the server, one per role, with immutable versions',
    does: 'Every agent is stored on the server with its role, department, skills, tools and model. Changing skills, tools or the model never edits the old version; it adds a new one, so older versions stay as they were.',
    where: 'System Operations, Agents, Directory (cards, list or hierarchy). Open an agent for its profile and its versions.',
    real: 'The agent list, the reporting lines (the org chart), creating and editing agents, and the version history. Administrators can edit; members see them read-only.',
    demo: 'Most agent numbers (scores, tokens, activity) are DEMO fixtures and say so, or show "not enough evidence". Lineage and development are still DEMO.',
    route: '/operations?tab=agents&sub=directory', lands: 'Directory', linkLabel: 'Open the agents Directory',
  },
  {
    key: 'instances', group: 'Stage 6 · agents and conversations', title: 'Mission instances and tasks', status: 'mixed',
    line: 'Which agents are on which mission, pinned to a version',
    does: 'When a mission is staffed, each agent that joins becomes an instance for that mission only, pinned to the agent version at that moment. Tasks have a recorded history: people can retry, reassign or cancel, and a retry keeps the failed attempt.',
    where: 'System Operations, Agents, Live Instances; and Missions, Hierarchy and Task Flow.',
    real: 'Instances, the team of each mission, task states, and the delegation and attempt history (which cannot be rewritten).',
    demo: 'Instances on real missions show as idle, because nothing executes. A "working" instance is only ever shown on a DEMO mission.',
    route: '/operations?tab=agents&sub=live-instances', lands: 'Live Instances', linkLabel: 'Open Live Instances',
  },
  {
    key: 'conversations', group: 'Stage 6 · agents and conversations', title: 'Conversations on missions', status: 'mixed',
    line: 'Threads with agents, saved on the server',
    does: 'Each mission has conversation threads with its agents. Your messages, attachments and read marks are saved, and the author is always the person who is signed in.',
    where: 'Missions, open a mission, Conversations tab. The chat on the Hierarchy tab shows the same thread.',
    real: 'Saving and showing messages, attachments, paging, and keeping a half-typed draft if sending fails.',
    demo: 'Agents do not answer on real missions: you see one honest note that the message is stored and will be delivered when execution starts. Sample missions show a simulated reply, tagged Simulated.',
    route: '/missions/M-126?tab=conversations', lands: 'Conversations', linkLabel: 'Open a mission\'s Conversations',
  },
  {
    key: 'channels', group: 'Stage 6 · agents and conversations', title: 'Direct channels', status: 'mixed',
    line: 'Your General Manager line, agent lines, and the administrators line',
    does: 'One chat window in the top bar holds your line to the General Manager, your lines to agents, and a line to the administrators.',
    where: 'The chat icon in the top bar (this link opens it on the administrators line).',
    real: 'The administrators line is a real chat between people, and you are notified when an administrator answers. The GM and agent lines are private to you: administrators cannot read them or open their files.',
    demo: 'The General Manager and agents do not reply for real yet, for the same reason as on missions. The Job Search chat is still DEMO.',
    route: '/overview?chat=admin', lands: 'dock', linkLabel: 'Open the chat window',
  },
  {
    key: 'proposals', group: 'Improvement loop', title: 'Organization proposals', status: 'real',
    line: 'Change who reports to whom, with a check and an approval',
    does: 'Instead of editing the org chart directly, someone proposes new reporting lines. A dry run lists the lines added and removed, plus errors and warnings (for example a loop or an agent not under the GM). Another person approves, and only then does the chart change, as a new revision.',
    where: 'System Operations, Agents, Proposals.',
    real: 'Proposals, the dry run, approval, the stale check (a proposal made on an old chart is refused) and the audit trail are stored on the server.',
    demo: 'Impact on running missions is not estimated; only stored facts are shown. The demo-mode prototype proposals are DEMO.',
    route: '/operations?tab=agents&sub=proposals', lands: 'Proposals', linkLabel: 'Open Proposals',
  },
  {
    key: 'history', group: 'Improvement loop', title: 'Organization history and rollback', status: 'later',
    line: 'Coming when merged: timeline, before/after, rollback',
    does: 'Planned from cycle 4: a timeline of org chart revisions, a before/after view of each change and the missions it touches, and a rollback that is never a direct edit: it creates an ordinary proposal that needs the same check and approval.',
    where: 'Not in this version of the app yet. It will appear next to Proposals once it is merged. The link goes to Proposals, which exists today.',
    real: 'Built and reviewed on its own branch; not part of this app version.',
    demo: 'Nothing shown yet.',
    limits: 'Until it is merged you cannot undo an applied org change from the app.',
    route: '/operations?tab=agents&sub=proposals', lands: 'Proposals', linkLabel: 'Open Proposals (closest screen)',
  },
  {
    key: 'scorecard', group: 'Improvement loop', title: 'Company scorecard', status: 'real',
    line: 'Company performance from recorded data only',
    does: 'Eight rows (missions started and finished, verified success, cycle time, failures, task recovery, waiting for approval), each with its sample size n and time window. Hover a row for the evidence behind it.',
    where: 'Overview (the Verified success tile and the scorecard panel) and the Missions list header.',
    real: 'Computed by the server from recorded events, only for missions you can see. A rate needs at least 3 samples; below that it shows a dash, never an invented number. A completion counts as verified only when someone other than the mission owner checked it.',
    demo: 'DEMO missions are left out unless you switch "include DEMO" on, and the panel is then tagged DEMO. Other Overview tiles that still use sample numbers are tagged DEMO.',
    limits: 'Because nothing executes, most rows have little or no evidence for now. That is the honest state.',
    route: '/overview', lands: 'Pulse', linkLabel: 'Open Overview',
  },
  {
    key: 'reliability', group: 'Improvement loop', title: 'Agent reliability', status: 'mixed',
    line: 'How often an agent\'s tasks passed, with n and the window',
    does: 'On an agent profile and on the Directory cards, a measured Reliability value: tasks the agent finished that passed, with n and the 90 day window. With fewer than 5 samples it says "not enough evidence (n of 5)".',
    where: 'Agent profile (Profile tab) and the Agents Directory.',
    real: 'The calculation and its privacy rules are real and tested: only missions you can see count, and an outcome counts against the agent that owned the task at that time, so a reassigned failure is not charged to the receiver.',
    demo: 'The older Reliability tile on the profile is a DEMO fixture and is tagged as one.',
    limits: 'Partly NOT MET: you cannot make an agent reach 5 samples through the app until execution exists. That path is proven only by server tests and a labelled check that writes rows directly.',
    route: '/agents/coder-01', lands: 'Profile', linkLabel: 'Open an agent profile',
  },
  {
    key: 'versionproposals', group: 'Improvement loop', title: 'Agent version proposals', status: 'later',
    line: 'Coming when merged: propose, review, promote, roll back',
    does: 'Planned from cycle 5: improving an agent becomes a governed flow. Someone proposes a candidate version, a different person reviews it, it is promoted, and the last good version is always one click away. Running missions stay on their pinned version.',
    where: 'Not in this version yet. It will replace the DEMO content of Agents, Development. The link goes to that tab as it is today.',
    real: 'Built on its own branch; not part of this app version.',
    demo: 'Agents, Development currently shows DEMO content.',
    route: '/operations?tab=agents&sub=development', lands: 'Development', linkLabel: 'Open Development (today: DEMO)',
  },
  {
    key: 'departmentfacts', group: 'Improvement loop', title: 'Department facts', status: 'later',
    line: 'Coming when merged: real numbers on department cards',
    does: 'Planned from cycle 6: each department card shows facts the server records (members, head, agents staffed on active missions, open tasks, task outcomes with n, last org change) instead of the DEMO capacity and KPI numbers.',
    where: 'Not in this version yet. The link goes to Departments as it is today.',
    real: 'Built on its own branch; not part of this app version.',
    demo: 'Today the capacity ring, skill coverage and KPI deltas on Departments are DEMO fixtures and say so.',
    route: '/operations?tab=agents&sub=departments', lands: 'Departments', linkLabel: 'Open Departments (today: DEMO)',
  },
];

export const WHATS_NEW_BY_KEY: Record<string, WhatsNewItem> = Object.fromEntries(WHATS_NEW.map((i) => [i.key, i]));

/** The same pages as ? entries, so the Context Help index and search find them too. */
export const whatsNewHelp = (): Record<string, HelpEntry> => Object.fromEntries(WHATS_NEW.map((i) => [`whatsnew.${i.key}`, {
  title: i.title, what: i.does, how: `Where: ${i.where}`, why: `Real: ${i.real}`, permission: `DEMO: ${i.demo}${i.limits ? ' ' + i.limits : ''}`, route: i.route,
}]));
