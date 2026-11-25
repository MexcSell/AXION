import type { HelpEntry } from './registry';

/**
 * Improvement cycle 17: the owner's "What's new" guide (Help Center, first tab). One short plain-language page per
 * feature built since Stage 5. Written from PROGRESS.md (Stages 5 and 6) and docs/improve/LOG.md. Every page says what
 * is real, what is still DEMO, and gives a link into the feature.
 * Status: real = stored or measured on the server; mixed = real parts and DEMO parts. These describe the server version; the offline
 * demo (?data=demo) shows sample data instead. (The 'later' status is kept for pages about features that are not merged yet.)
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
  /** CSS selector that only exists once cycles 4 to 6 are merged; the browser check skips (not fails) while it is missing */
  afterMerge?: string;
}

export const WHATS_NEW: WhatsNewItem[] = [
  {
    key: 'signin', group: 'Stage 5 · the server', title: 'Real sign-in and your devices', status: 'real',
    line: 'Names, passwords and approval of new people and browsers',
    does: 'You connect with a name and a password. The first name that ever connects becomes the administrator. Everyone after that, and every new browser, waits until an administrator approves it.',
    where: 'The Connect screen, and Settings, Users (your profile, password and devices; the administrator also sees the approvals there).',
    real: 'Passwords are stored only in scrambled form that cannot be turned back into the password. Sessions end after 24 idle hours or 30 days. Changing your password signs out your other devices. Members see only the names and avatars of other people.',
    demo: 'Nothing in the server version is DEMO. The offline demo (any page opened with ?data=demo) has its own pretend sign-in that is not secure and shows sample data.',
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
    where: 'System Operations, Agents, Live Instances; and Missions, Hierarchy (Task Flow still shows sample data on sample missions).',
    real: 'Instances, the team of each mission, task states, and the delegation and attempt history (which cannot be rewritten).',
    demo: 'Instances on real missions show as idle, because nothing executes. A "working" instance is only ever shown on a DEMO mission.',
    route: '/operations?tab=agents&sub=live-instances', lands: 'Live Instances', linkLabel: 'Open Live Instances',
  },
  {
    key: 'conversations', group: 'Stage 6 · agents and conversations', title: 'Conversations on missions', status: 'mixed',
    line: 'Threads with agents, saved on the server',
    does: 'Each mission has conversation threads with its agents. Your messages, attachments and read marks are saved, and the author is always the person who is signed in.',
    where: 'Missions, open any mission, Conversations tab. The chat on the Hierarchy tab shows the same thread. The link opens the Missions page; pick a mission there.',
    real: 'Saving and showing messages, attachments, paging, and keeping a half-typed draft if sending fails.',
    demo: 'Agents do not answer on real missions: you see one honest note that the message is stored and will be delivered when execution starts. Sample missions show a simulated reply, tagged Simulated.',
    route: '/missions', lands: 'Overview', linkLabel: 'Open Missions',
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
    does: 'Reporting lines (who reports to whom) are changed through a reviewed proposal. Someone proposes new lines. A check lists the lines added and removed, plus errors and warnings (for example a loop, or an agent not under the GM). A second administrator approves, and only then does the chart change, as a new revision. Adding an agent is different: it places the new agent in the chart directly.',
    where: 'System Operations, Agents, Proposals.',
    real: 'Proposals, the check, approval, the protection against an out-of-date proposal (one made on an old chart is refused) and the audit trail are stored on the server.',
    demo: 'Impact on running missions is not estimated; only stored facts are shown. In the offline demo (?data=demo) the proposals are sample data.',
    route: '/operations?tab=agents&sub=proposals', lands: 'Proposals', linkLabel: 'Open Proposals',
    limits: 'Only administrators can propose and decide, and the person who proposed cannot approve their own proposal. You need two administrators: with only one, a proposal can be made but never applied. Whether single administrators may also edit an agent\'s skills, tools or model directly is an open question for you (today they can: it is audited and creates a new version).',
  },
  {
    key: 'history', group: 'Improvement loop', title: 'Organization history and rollback', status: 'real',
    line: 'Timeline of org changes, before/after, propose a rollback',
    does: 'A History view next to Proposals lists every version of the org chart, newest first, with who made it and how many lines changed. Pick one to see what changed against the one before, and which active missions are affected (listed only: running missions keep their teams). An administrator can propose a rollback to an older version. It is not a direct edit: it becomes an ordinary proposal that needs the same check and a second administrator.',
    where: 'System Operations, Agents, Proposals, then the Proposals / History switch in the panel header.',
    real: 'History, the before/after comparison, the affected-missions list and rollback proposals are stored on the server and never change running missions.',
    demo: 'In the offline demo (?data=demo) there is no history; the screen shows sample data.',
    limits: 'There is no one-click undo: a rollback is a proposal that two administrators must handle. A rollback to a version from before an agent was added cannot be approved, because that old chart has no place for the newer agent.',
    route: '/operations?tab=agents&sub=proposals', lands: 'Proposals', linkLabel: 'Open Proposals (then History)',
    afterMerge: '[role="list"][aria-label="Org revisions"]', // c04's revision timeline (OrgHistory.tsx)
  },
  {
    key: 'scorecard', group: 'Improvement loop', title: 'Company scorecard', status: 'real',
    line: 'Company performance from recorded data only',
    does: 'Eight rows (missions started and finished, verified success, cycle time, failures, task recovery, waiting for approval), each with its sample size n and time window. Hover a row for the evidence behind it.',
    where: 'Overview (the Verified success tile and the scorecard panel) and the Missions list header.',
    real: 'Computed by the server from recorded events, only for missions you can see. A rate needs at least 3 samples; below that it shows a dash, never an invented number. A completion counts as verified only when someone other than the mission owner approved it, or when an agent checked tasks that really passed.',
    demo: 'DEMO missions are left out unless you switch "include DEMO" on, and the panel is then tagged DEMO. Other Overview tiles that still use sample numbers are tagged DEMO.',
    limits: 'Because nothing executes, most rows have little or no evidence for now. That is the honest state.',
    route: '/overview', lands: 'Pulse', linkLabel: 'Open Overview',
  },
  {
    key: 'reliability', group: 'Improvement loop', title: 'Agent reliability', status: 'mixed',
    line: 'How often an agent\'s tasks passed, with n and the window',
    does: 'On an agent profile and on the Directory cards, a measured Reliability value: tasks the agent finished that passed, with the number of tasks counted and the 90 day window. With fewer than 5 tasks it says "not enough evidence".',
    where: 'Agent profile (Profile tab) and the Agents Directory.',
    real: 'The calculation and its privacy rules are real and tested: only missions you can see count, and an outcome counts against the agent that owned the task at that time, so a reassigned failure is not charged to the receiver.',
    demo: 'The older Reliability tile on the profile is a DEMO fixture and is tagged as one.',
    limits: 'Not possible yet: you cannot make an agent reach 5 samples through the app until execution exists. That path is proven only by server tests and a labelled check that writes rows directly.',
    route: '/agents/coder-01', lands: 'Profile', linkLabel: 'Open an agent profile',
  },
  {
    key: 'versionproposals', group: 'Improvement loop', title: 'Agent version proposals', status: 'real',
    line: 'Propose, review, promote and roll back an agent version',
    does: 'Improving an agent follows a reviewed flow. An administrator proposes a changed version (skills, tools or model) and sees what differs. A different administrator promotes or rejects it; proposals expire after 14 days or go out of date if the agent changed meanwhile. A rollback makes a new version with an older version\'s settings (a reason is required); nothing is deleted. Running missions stay on the version they were pinned to.',
    where: 'System Operations, Agents, Development (all proposals), and an agent\'s profile, Evolution tab (its versions, propose, roll back).',
    real: 'Proposals, the before/after differences, promote, reject, withdraw and rollback are stored on the server, with an audit trail.',
    demo: 'Proposals show no evaluation numbers: each card says "No evaluation yet" because agents do not execute work yet. In the offline demo (?data=demo) the Development tab shows sample content.',
    route: '/operations?tab=agents&sub=development', lands: 'Development', linkLabel: 'Open Development',
    limits: 'You need two administrators: the author of a proposal cannot promote it. Editing an agent directly (skills, tools or model) is still a single-administrator action; it is audited and creates a new version, and whether that should need a review is an open question for you.',
    afterMerge: '[data-dev-proposals], [data-version-proposals]',
  },
  {
    key: 'departmentfacts', group: 'Improvement loop', title: 'Department facts', status: 'real',
    line: 'Real numbers on department cards',
    does: 'Each department card shows what the server records: its members, its head, how many of its agents are staffed on active missions, open tasks by state, task outcomes with the sample size, and when the org chart last changed there. A 7, 30 or 90 day window is available on the panel.',
    where: 'System Operations, Agents, Departments.',
    real: 'Every number is counted from recorded data, only on missions you can see. Below 5 finished tasks the card says "too few to rate" and shows no percentage.',
    demo: 'The old sample capacity ring, skill coverage and KPI changes are hidden in the server version. In the offline demo (?data=demo) they still show as sample data.',
    route: '/operations?tab=agents&sub=departments', lands: 'Departments', linkLabel: 'Open Departments',
    limits: 'Task outcomes stay empty until agents execute work, so for now the cards show membership, heads and staffing, not performance. Where several agents report straight to the GM, the head shown is a tie-break and the card says how many candidates there are.',
    afterMerge: '[data-departments]',
  },
];

export const WHATS_NEW_BY_KEY: Record<string, WhatsNewItem> = Object.fromEntries(WHATS_NEW.map((i) => [i.key, i]));

/** The same pages as ? entries, so the Context Help index and search find them too. */
export const whatsNewHelp = (): Record<string, HelpEntry> => Object.fromEntries(WHATS_NEW.map((i) => [`whatsnew.${i.key}`, {
  title: i.title, what: i.does, how: `Where: ${i.where}`, why: `Real: ${i.real}`, permission: i.limits, route: i.route,
}]));
