/**
 * Improvement cycle 66 (R3-4): the writability inventory. Which stored fields feed a scorecard, KPI or dimension row, and who
 * can write each one: a person through a route, an agent identity through a service function, or the system.
 *
 * Why this exists: a metric that its own subject can write is open to Goodhart effects. The row registry (metric-registry.ts)
 * declares only the INPUT fields of each row. Whether a row is agent-writable is never typed by hand: `writabilityOf` derives it
 * from the sites below. Two server tests keep this honest: every non-GET route in the route table must be classified here (a new
 * write route fails until it is), and a scan of server/src finds every insert/update/delete on an input table and fails on a
 * site that is not declared.
 *
 * What it means (and does not). It classifies what the CODE PERMITS today. No route lets a client name an agent, and agents do
 * not execute yet (execution is disabled), so no agent writes anything in a running system today. An agent-writable field is one
 * where a service function takes an agent identity (the kind appears in its signature or its events), and where real execution
 * will write once it exists. When Stage 7 adds an executor, new sites will be added here and the flags will change.
 */
export type WriterKind = 'human' | 'agent' | 'system';

export interface InputField {
  /** one plain sentence: what the stored field says */
  what: string;
  /** the tables a write to it goes through (the source scan looks for insert/update/delete on them) */
  tables: readonly string[];
  /** for event-log and audit-log fields: a literal the writer's source must contain, since the table is shared by every kind of record */
  marker?: string;
}

export const INPUT_FIELDS = {
  'missions.state': { what: 'mission status and presentation (active, waiting, finished)', tables: ['missions'] },
  'mission_runs.started': { what: 'when a mission first ran', tables: ['mission_runs'] },
  'events.mission_state_changed': { what: 'the recorded moves of a mission between states', tables: [], marker: "type: 'mission.stateChanged'" },
  'tasks.status': { what: 'the state of a task (passed, failed, retried...)', tables: ['tasks'] },
  'tasks.owner': { what: 'which agent owns a task', tables: ['tasks'] },
  'task_attempts.times': { what: 'when each attempt of a task started and finished', tables: ['task_attempts'] },
  'approval_requests.record': { what: 'an approval request: when it was asked, its tier and state', tables: ['approval_requests'] },
  'approval_decisions.decision': { what: 'a person\'s decision on an approval request', tables: ['approval_decisions'] },
  'mission_delegations.delegated_edge': { what: 'who delegated work to whom (edges of kind delegated)', tables: ['mission_delegations'] },
  'mission_delegations.verifies_edge': { what: 'which delegation edges verify a mission (edges of kind verifies, which the verified rule reads)', tables: ['mission_delegations'] },
  'delegation_briefs.brief': { what: 'the brief that came with a delegation', tables: ['delegation_briefs'] },
  'agent_instances.assignment': { what: 'which agent works on a mission, and its state', tables: ['agent_instances'] },
  'task_reviews.review': { what: 'an independent review of a task: verdict, evidence, reviewer', tables: ['task_reviews'] },
  'mission_ledgers.progress': { what: 'the progress ledger of a mission', tables: ['mission_ledgers'] },
  'site_grants.window': { what: 'a website grant and when it was active', tables: ['site_grants'] },
  'failure_tags.mode': { what: 'which failure mode was named for a task, and by whom', tables: ['failure_tags'] },
  'failure_tags.status': { what: 'whether a person confirmed or rejected a failure tag', tables: ['failure_tags'] },
  'lesson_candidates.status': { what: 'a proposed lesson and its decision', tables: ['lesson_candidates'] },
  'playbooks.items': { what: 'the playbook items in force for an agent', tables: ['playbooks'] },
  'agent_version_proposals.status': { what: 'a version proposal and its decision', tables: ['agent_version_proposals'] },
  'audit_events.agent_rollback': { what: 'the audit record of an agent version rollback', tables: [], marker: "action: 'agent.rollback'" },
  'org_revisions.lines': { what: 'organisation revisions and their reporting lines', tables: ['org_revisions', 'org_edges'] },
  'eval_runs.results': { what: 'stored evaluation runs behind a verdict', tables: ['eval_runs'] },
  'agent_definitions.catalog': { what: 'the agent catalogue: department, active version', tables: ['agent_definitions'] },
} as const satisfies Record<string, InputField>;
export type InputFieldId = keyof typeof INPUT_FIELDS;
export const INPUT_FIELD_IDS = Object.keys(INPUT_FIELDS) as InputFieldId[];

export interface WriteSite {
  /** path under server/src */
  file: string;
  /** exported function that writes, or 'handler' for SQL written inline in a route handler */
  fn: string;
  /** who can reach it: 'human' = a signed-in person (route), 'agent' = a service function that takes an agent identity, 'system' = the simulator, seed or a timer */
  kinds: readonly WriterKind[];
  /** the routes that reach this site (as a person) */
  routes: readonly string[];
  writes: readonly InputFieldId[];
  /** what stands between an agent-written value and a row reading it, if anything (shown in the help; the row is still flagged) */
  gate?: string;
  note: string;
}

const R = (...r: string[]) => r;
export const WRITE_SITES: Record<string, WriteSite> = {
  missionRoutes: { file: 'missions/routes.ts', fn: 'handler', kinds: ['human'], writes: ['missions.state', 'mission_runs.started', 'events.mission_state_changed'],
    routes: R('POST /missions', 'PATCH /missions/:id', 'POST /missions/:id/share', 'POST /missions/:id/actions/:action', 'DELETE /missions/:id'),
    note: 'a person creates, edits, shares, acts on and deletes a mission; every state move is a person\'s action' },
  staffingRetry: { file: 'missions/staffing-retry.ts', fn: 'handler', kinds: ['human'], writes: ['missions.state'], routes: R('POST /missions/:id/staffing/retry'), note: 'a person clears a stalled-staffing flag' },
  staffingSim: { file: 'missions/staffing-sim.ts', fn: 'handler', kinds: ['system'], writes: ['missions.state', 'mission_runs.started', 'events.mission_state_changed'], routes: [],
    note: 'the staffing simulator (a timer) stands in for the future executor: it starts the first run and moves the mission to running' },
  ledgerRoutes: { file: 'missions/ledger-routes.ts', fn: 'handler', kinds: ['human'], writes: ['mission_ledgers.progress'], routes: R('POST /missions/:id/ledgers/:kind'),
    note: 'the route writes author_kind human only; the database allows agent as an author kind, but no code path writes it' },
  seedDemo: { file: 'seed/demo.ts', fn: 'seedDemo', kinds: ['system'], writes: ['missions.state', 'mission_ledgers.progress'], routes: [], note: 'sample missions; DEMO rows are never counted in a scorecard' },
  taskRoutes: { file: 'tasks/routes.ts', fn: 'handler', kinds: ['human'], writes: ['tasks.status', 'tasks.owner', 'task_attempts.times'], routes: R('POST /tasks/:id/:action'),
    note: 'a person starts, retries, cancels or reassigns a task' },
  taskBackfill: { file: 'instances/backfill.ts', fn: 'backfillMissionControl', kinds: ['system'], writes: ['tasks.status', 'tasks.owner'], routes: [], note: 'creates tasks for sample missions (instances and edges go through instances/service.ts)' },
  instanceService: { file: 'instances/service.ts', fn: 'joinMission', kinds: ['agent', 'system'], writes: ['agent_instances.assignment', 'mission_delegations.delegated_edge'], routes: R('POST /tasks/:id/:action'),
    gate: 'it writes only delegated edges; the verified rule reads verifies edges, which no agent-reachable code writes',
    note: 'a manager agent joins a mission and delegates; its events name the agent as the actor. Today only the staffing simulator and the reassign route call it' },
  delegationHelper: { file: 'instances/service.ts', fn: 'insertDelegation', kinds: ['human', 'system'], writes: ['mission_delegations.verifies_edge'], routes: R('POST /tasks/:id/:action'),
    note: 'the edge kind is a parameter. The reassign route passes delegated, the sample backfill copies edges of any kind (system), and no agent-reachable caller passes verifies (HELPER_CALLERS fails if a new caller appears)' },
  recordReview: { file: 'tasks/reviews.ts', fn: 'recordReview', kinds: ['human', 'agent'], writes: ['task_reviews.review'], routes: R('POST /tasks/:id/reviews'),
    gate: 'the producer and the mission owner can never be the reviewer, and an accepted review needs evidence', note: 'takes a reviewer of kind user or agent; no route lets a client name an agent' },
  createBrief: { file: 'delegation/service.ts', fn: 'createBrief', kinds: ['human', 'agent'], writes: ['delegation_briefs.brief'], routes: R('POST /missions/:id/delegation-briefs', 'POST /tasks/:id/:action'),
    note: 'a brief from a person, or from an agent instance when the delegation names one' },
  approvalRoutes: { file: 'approvals/routes.ts', fn: 'handler', kinds: ['human'], writes: ['approval_requests.record'], routes: R('POST /approvals/:id/decision'),
    note: 'only a person decides; the policy tier says which person' },
  recordDecision: { file: 'approvals/quality.ts', fn: 'recordDecision', kinds: ['human'], writes: ['approval_decisions.decision'], routes: R('POST /approvals/:id/decision'),
    note: 'c58: appends the decision row with its stored latency and queue size; called only by the decision route, with the signed-in person as the decider' },
  requestApproval: { file: 'approvals/service.ts', fn: 'requestApproval', kinds: ['agent', 'system'], writes: ['approval_requests.record'], routes: [],
    note: 'an agent asks for approval and later consumes an approved one; the demo seed calls it too. It never writes a mission state' },
  settleMission: { file: 'approvals/service.ts', fn: 'settleMission', kinds: ['system'], writes: ['missions.state', 'events.mission_state_changed'], routes: [],
    note: 'after a decision, or an expiry sweep, the server moves a mission from waiting for approval back to running; no actor is an agent' },
  createTag: { file: 'failures/service.ts', fn: 'createTag', kinds: ['human', 'agent'], writes: ['failure_tags.mode'], routes: R('POST /failure-tags'),
    gate: 'a tag is only proposed; a person must confirm it before a dimension counts it', note: 'taggedByKind may be agent; the route always passes user' },
  decideTag: { file: 'failures/service.ts', fn: 'decideTag', kinds: ['human'], writes: ['failure_tags.status'], routes: R('POST /failure-tags/:id/decision'), note: 'a person confirms or rejects' },
  proposeLesson: { file: 'agents/playbooks.ts', fn: 'proposeLesson', kinds: ['human', 'agent'], writes: ['lesson_candidates.status'], routes: R('POST /agents/:id/lessons'),
    gate: 'a lesson is only proposed; an administrator decides', note: 'kind may be agent; agents have no session, so they can never decide' },
  playbookRoutes: { file: 'agents/playbooks.ts', fn: 'handler', kinds: ['human'], writes: ['lesson_candidates.status', 'playbooks.items'], routes: R('POST /lessons/:lid/decision', 'POST /agents/:id/playbook/rollback'), note: 'an administrator accepts, rejects or rolls back' },
  versionRoutes: { file: 'agents/versions.ts', fn: 'handler', kinds: ['human'], writes: ['agent_version_proposals.status', 'audit_events.agent_rollback'],
    routes: R('POST /agents/:id/version-proposals', 'POST /version-proposals/:pid/decision', 'POST /version-proposals/:pid/withdraw', 'POST /agents/:id/rollback'), note: 'administrators propose, decide, withdraw and roll back' },
  switchVersion: { file: 'agents/service.ts', fn: 'switchVersion', kinds: ['human'], writes: ['agent_definitions.catalog'], routes: R('POST /agents/:id/version-proposals', 'POST /version-proposals/:pid/decision', 'POST /agents/:id/rollback'), note: 'moves the active version' },
  agentRoutes: { file: 'agents/routes.ts', fn: 'handler', kinds: ['human'], writes: ['agent_definitions.catalog'], routes: R('POST /agents', 'PATCH /agents/:id'), note: 'administrators create and edit agents' },
  agentSeed: { file: 'agents/seed.ts', fn: 'seedCompany', kinds: ['system'], writes: ['agent_definitions.catalog'], routes: [], note: 'the built-in catalogue' },
  createOrgRevision: { file: 'agents/org.ts', fn: 'createOrgRevision', kinds: ['human', 'system'], writes: ['org_revisions.lines'], routes: R('POST /organization/proposals/:id/decision'), note: 'an applied org proposal (administrator) or the seed' },
  startRun: { file: 'evolution/eval-runs.ts', fn: 'startRun', kinds: ['system'], writes: ['eval_runs.results'], routes: [],
    gate: 'the judge label must resolve to a vendor and the evaluator must be named; the database refuses a second run on a holdout and an agent as its own evaluator',
    note: 'c53: the writer-side check for a new run record. Not a route and not called by any server code yet (only tests); a future evaluation worker would call it' },
  e2eCapacitySeed: { file: 'cli/e2e-capacity-seed.ts', fn: 'handler', kinds: ['system'], writes: ['approval_requests.record', 'approval_decisions.decision'], routes: [],
    note: 'c65: harness only (api-c65.mjs), refuses a database that is not an e2e one; seeds approvals and decisions for the review-capacity screens' },
  e2eExtraApprovals: { file: 'cli/e2e-extra-approvals.ts', fn: 'handler', kinds: ['system'], writes: ['delegation_briefs.brief'], routes: [],
    note: 'c58: harness only (api-c58.mjs), refuses a database that is not an e2e one; gives one agent a real brief so the Rule-of-Two flags can derive. It asks its approvals through requestApproval (HELPER_CALLERS)' },
  grantRoutes: { file: 'grants/routes.ts', fn: 'handler', kinds: ['human'], writes: ['site_grants.window'], routes: R('POST /site-grants', 'POST /site-grants/:id/revoke'), note: 'administrators issue and revoke website grants' },
};

/**
 * Exported write helpers, and the files in server/src that import each (a test compares this with the real imports). A new importer fails the test until it is
 * listed here, which is the moment to ask what identity it passes and whether it needs a site above.
 */
export const HELPER_CALLERS: Record<string, readonly string[]> = {
  insertDelegation: ['instances/backfill.ts', 'tasks/routes.ts'],
  insertInstance: ['instances/backfill.ts', 'missions/staffing-sim.ts'],
  joinMission: ['missions/staffing-sim.ts'],
  setInstanceState: [],
  attachSimBrief: ['instances/service.ts'],
  // c63: the failure-pattern rule opens a lesson candidate with channel 'tool_output', proposed by the system from a person's confirmation; only an administrator can accept it
  proposeLesson: ['failures/patterns.ts'],
  createTag: ['failures/routes.ts'],
  decideTag: ['failures/routes.ts'],
  recordReview: ['tasks/routes.ts'],
  createBrief: ['delegation/routes.ts', 'tasks/routes.ts'],
  requestApproval: ['cli/e2e-extra-approvals.ts', 'seed/demo.ts'],
  consumeApproval: [],
  settleMission: ['approvals/routes.ts'],
  createOrgRevision: ['agents/routes.ts', 'agents/seed.ts', 'organization/proposals.ts'],
  switchVersion: ['agents/versions.ts'],
  addVersion: ['agents/routes.ts', 'agents/seed.ts'],
};

/** Non-GET routes that write no scorecard, KPI or dimension input, each with the reason. A route listed here and also reaching a site above is reported. */
const ID = 'writes sign-in, device or profile records; no scorecard, KPI or dimension row reads them';
const CHAT = 'writes conversation messages; no scorecard, KPI or dimension row reads them';
const ORG = 'writes an organisation proposal record; a row reads org revisions, which only the approved decision route writes';
export const ROUTE_NO_INPUT: Record<string, string> = {
  'DELETE /me/devices/:did': ID, 'DELETE /users/:id/devices/:did': ID, 'PATCH /me': ID, 'PATCH /users/:id': ID, 'POST /auth/cancel': ID, 'POST /auth/connect': ID, 'POST /auth/logout': ID,
  'POST /me/password': ID, 'POST /users/:id/approve': ID, 'POST /users/:id/devices/:did/:action': ID, 'POST /users/:id/reject': ID,
  'POST /channels/:key/messages': CHAT, 'POST /channels/admin/:userId/messages': CHAT, 'POST /threads/:id/messages': CHAT, 'POST /missions/:id/threads': CHAT,
  'POST /uploads': 'stores an uploaded file; a review may cite it as evidence, but no row reads the upload itself',
  'POST /notifications/:id/ack': 'marks a notice read; notices are not an input of any row', 'POST /notifications/ack-all': 'marks notices read; notices are not an input of any row',
  'POST /agents/:id/mentoring': 'writes a mentoring plan; no row reads plans', 'POST /mentoring/:pid/close': 'closes a mentoring plan; no row reads plans', 'POST /mentoring/:pid/milestones/:mid/done': 'ticks a mentoring milestone; no row reads plans',
  'POST /company/metric-audits': 'appends a human audit label (administrators only) to its own table; a row\'s flag reads the labels, but no row\'s value or input does',
  'POST /skills/:sid/retirement-dismiss': 'c59: dismisses a retirement proposal on a skill record; no row reads skills',
  'POST /failure-tags/:id/attributions': 'c60: appends an attribution (which step or mechanism a tag points at) to its own append-only table; no scorecard, KPI or dimension row reads attributions, only the OTel export does',
  'POST /skills': 'writes a skill record; no row reads skills', 'POST /skills/:sid/approve': 'writes a skill record; no row reads skills', 'POST /skills/:sid/retire': 'writes a skill record; no row reads skills',
  'POST /organization/proposals': ORG, 'POST /organization/proposals/:id/withdraw': ORG, 'POST /organization/revisions/:seq/rollback-proposal': ORG,
};

export const ALL_WRITE_ROUTES: readonly string[] = [...new Set([...Object.values(WRITE_SITES).flatMap((s) => s.routes), ...Object.keys(ROUTE_NO_INPUT)])].sort();

export interface Writability {
  /** true when any input can be written by an agent identity through a declared site */
  agentWritable: boolean;
  /** every writer kind that reaches any input */
  kinds: WriterKind[];
  /** the agent-reachable sites, by id, with what gates them */
  agentSites: { site: string; fn: string; gate: string | null }[];
}

/** Pure. Derived from the sites, never typed per row. */
export function writabilityOf(inputs: readonly string[], sites: Record<string, WriteSite> = WRITE_SITES): Writability {
  const kinds = new Set<WriterKind>();
  const agentSites: Writability['agentSites'] = [];
  for (const [id, s] of Object.entries(sites)) {
    if (!s.writes.some((w) => inputs.includes(w))) continue;
    for (const k of s.kinds) kinds.add(k);
    if (s.kinds.includes('agent')) agentSites.push({ site: id, fn: s.fn, gate: s.gate ?? null });
  }
  return { agentWritable: agentSites.length > 0, kinds: [...kinds].sort(), agentSites };
}
