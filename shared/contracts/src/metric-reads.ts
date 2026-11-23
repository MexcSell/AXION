/**
 * c83 (M2b, item 3): the COLUMNS each registry row reads, and the loader files that read them. The row registry (metric-registry.ts) already declares the
 * input fields of each row; this file goes one level down. A server test (server/test/c83-registry-columns.test.ts) reads the SQL of every loader file
 * (every file under server/src/company/, plus every loader a row names here) and fails
 *  - on a column a loader reads that no row naming that loader declares (an undeclared read), and
 *  - on a column a row declares that none of its loaders reads (a stale declaration),
 * so a new loader file, a new statement or a new column cannot go uncovered. Columns are `table.column`; `table.*` means the loader selects every column.
 */

/** A loader: a file under server/src, optionally limited to one enclosing function or route (`file#scope`). No scope = every statement of the file. */
export type LoaderRef = string;

/**
 * Columns that say WHICH row or WHICH tenant, not a value a metric is built from: the row key, the tenant scope, the mission link and the
 * visibility predicate of the missions the caller may see. Declared once, with the reason, so rows do not each repeat them. A pattern is `table.column`; `*` is any table.
 */
export const CONTEXT_READS: { column: string; why: string }[] = [
  { column: '*.id', why: 'the row key (which row), never a value the metric counts' },
  { column: '*.tenant_id', why: 'the tenant scope of every query' },
  { column: '*.mission_id', why: 'the link from a record to its mission, which scopes it to the missions the caller can see' },
  { column: '*.task_id', why: 'the link from a record to its task (join key)' },
  { column: '*.approval_id', why: 'the link from a decision to its request (join key)' },
  { column: 'missions.owner_id', why: 'visibility: administrators see all, owners see theirs (VISIBLE_SQL)' },
  { column: 'missions.shared', why: 'visibility: everyone sees shared missions (VISIBLE_SQL)' },
  { column: 'missions.deleted_at', why: 'a deleted mission is never read' },
  { column: 'missions.demo', why: 'DEMO missions are left out of every measured row' },
];

/**
 * Columns a loader fetches for some other purpose than a registry row (the screen it also serves), declared per loader so that a new column on it still
 * needs a decision. Empty for a loader whose every column a row uses.
 */
export const LOADER_EXTRA: Record<LoaderRef, { reads: string[]; why: string }> = {
  'company/departments.ts': {
    reads: ['agent_instances.ended_at', 'missions.status', 'org_edges.supervisor_id', 'org_edges.subordinate_id', 'org_edges.edge_type', 'org_edges.revision_id', 'org_revisions.seq', 'org_revisions.active_from', 'audit_events.action', 'audit_events.result', 'audit_events.subject', 'audit_events.detail', 'audit_events.at'],
    why: 'GET /departments facts (reporting lines, who is staffed, hand-overs on reassign): counted facts with their n, not registry rows. The same loader feeds the dimension cells that read tasks and instances',
  },
  'instances/service.ts#listInstancesPage': { reads: ['agent_versions.label'], why: 'the instance list shows the version label of each instance; the tile counts instances' },
  'approvals/routes.ts#GET /approvals': { reads: ['users.name', 'approval_decisions.decided_at', 'approval_decisions.decided_by', 'approval_decisions.latency_ms', 'approval_decisions.queue_size', 'approval_decisions.fast_bulk'], why: 'the approval list also returns who decided and how fast (c58); the tile counts pending requests' },
  'evolution/proposal-evidence.ts': { reads: ['users.name'], why: 'the name of the person who re-graded a run, shown with the evidence; the verdict counts do not read it' },
  'missions/service.ts#listVisible': { reads: ['missions.*', 'mission_revisions.title', 'mission_revisions.kind', 'mission_revisions.priority', 'mission_revisions.text', 'mission_revisions.files', 'mission_revisions.criteria', 'mission_revisions.revision', 'users.name', 'agent_instances.agent_id', 'agent_instances.manager_instance_id', 'agent_instances.seq', 'mission_delegations.edge_kind', 'mission_delegations.from_instance', 'mission_delegations.to_instance'], why: 'the mission list returns whole missions; the tile counts status' },
};

/** Files under server/src/company/ that are not a metric loader, each with what it reads and why no row reads it. A file with SQL that is neither here nor named by a row fails the test. */
export const NON_METRIC_COMPANY_FILES: Record<string, { reads: string[]; why: string }> = {
  'company/metric-guard-routes.ts': {
    reads: ['metric_audit_labels.metric_id', 'metric_audit_labels.sample_ref', 'metric_audit_labels.metric_label', 'metric_audit_labels.audit_label', 'metric_audit_labels.audited_at'],
    why: 'reads the human audit labels to show a row\'s divergence; no row\'s value reads them (the flag is display only)',
  },
  'company/metric-audit-store.ts': {
    reads: ['missions.demo'],
    why: 'checks that a sample reference names a stored record of the tenant, and finds the labels that point at demo records for the purge; reads only keys and the demo flag',
  },
};

export interface MetricReads { loaders: readonly LoaderRef[]; reads: readonly string[] }

// ---- scorecard (company/routes.ts, with the freshness fragments of company/stale.ts expanded into its SQL)
const SC = ['company/routes.ts'] as const;
const TRANSITIONS = ['events.payload', 'events.occurred_at', 'events.type'] as const; // mission.stateChanged events: from, to, when
const VERIFY = [...TRANSITIONS, 'approval_decisions.decision', 'approval_decisions.decided_by', 'approval_decisions.decided_at', 'tasks.status', 'tasks.simulated', 'mission_delegations.edge_kind', 'mission_delegations.simulated'] as const;
const REVIEW = ['task_reviews.verdict', 'task_reviews.evidence', 'task_reviews.reviewer_id', 'task_reviews.producer_id', 'task_reviews.principal_id', 'task_reviews.created_at', 'task_reviews.seq', 'task_reviews.attempt_id', 'task_attempts.attempt_no', 'task_attempts.started_at'] as const;
// ---- six dimensions
const DIM = ['company/dimensions-routes.ts', 'company/departments.ts'] as const;
/** every dimension cell can be cut by department: a department is the agents' `dept`, and a mission belongs to it through a real instance of its agents */
const DEPT = ['agent_definitions.dept', 'agent_definitions.status', 'agent_instances.agent_id', 'agent_instances.simulated', 'agent_instances.created_at'] as const;
/** the task rows loadDeptRows builds, for a row that needs the task itself: status, whether it is a sample, who owns it, and when its attempts started and ended */
const TASK_CORE = ['tasks.status', 'tasks.simulated', 'tasks.owner_agent', 'tasks.owner_instance_id', 'task_attempts.attempt_no', 'task_attempts.started_at', 'task_attempts.finished_at'] as const;
/** a row that needs only who owns a task (to cut by department) */
const TASK_OWNER = ['tasks.simulated', 'tasks.owner_agent', 'tasks.owner_instance_id'] as const;
/** a row that reads task OUTCOMES (passed or failed, when, retried, handed over): the core plus the task state-change events and the creation time the loader uses to place a task */
const TASKS = [...TASK_CORE, 'tasks.created_at', 'events.subject_id', 'events.payload', 'events.occurred_at', 'events.type'] as const;
const TAGS = ['failure_tags.subject_id', 'failure_tags.subject_kind', 'failure_tags.mode_id', 'failure_tags.status', 'failure_tags.taxonomy_version', 'failure_tags.created_at', 'failure_tags.decided_at'] as const;
const LESSONS = ['lesson_candidates.agent_id', 'lesson_candidates.status', 'lesson_candidates.created_at', 'lesson_candidates.decided_at', 'lesson_candidates.accepted_in_version', 'lesson_candidates.withdrawn_in_version'] as const;
const PROC = ['company/process-routes.ts'] as const;

/**
 * Columns that decide WHICH rows count (the department cut, sample and DEMO flags), not what a row measures. They are left out when two rows are compared
 * for shared inputs (item 4): two rows that both cut by department do not share an input.
 */
export const SCOPE_ONLY_READS: readonly string[] = [...DEPT, 'tasks.simulated', 'mission_delegations.simulated', 'delegation_briefs.simulated', 'approval_requests.demo', 'mission_ledgers.demo'];

const r = (loaders: readonly string[], ...reads: (readonly string[] | string)[]): MetricReads => ({ loaders, reads: [...new Set(reads.flat())] });

export const METRIC_READS: Record<string, MetricReads> = {
  'scorecard.started': r(SC, 'mission_runs.started_at'),
  'scorecard.finished': r(SC, TRANSITIONS),
  'scorecard.verified_success_rate': r(SC, VERIFY),
  'scorecard.completed_unverified': r(SC, VERIFY),
  'scorecard.median_cycle_time_h': r(SC, 'mission_runs.started_at', TRANSITIONS),
  'scorecard.failure_rate': r(SC, TRANSITIONS),
  'scorecard.task_recovery_rate': r(SC, 'tasks.status', 'task_attempts.attempt_no', 'task_attempts.started_at', 'task_attempts.finished_at'),
  'scorecard.waiting_approval_median_h': r(SC, TRANSITIONS),
  'scorecard.approved_by_non_owner': r(SC, TRANSITIONS, 'approval_decisions.decision', 'approval_decisions.decided_by', 'approval_decisions.decided_at'),
  'scorecard.tasks_verified_by_review': r(SC, REVIEW, 'tasks.status'),
  'scorecard.throughput': r(SC, 'mission_runs.started_at', TRANSITIONS),

  // ---- KPI tiles. The tile counts in the browser from the lists the server returns, so the loader is the list.
  'kpi.success.api': r(SC, VERIFY),
  'kpi.staffedAgents': r(['instances/service.ts#listInstancesPage', 'missions/service.ts#listVisible'], 'agent_instances.*', 'agent_instances.agent_id', 'agent_instances.simulated', 'agent_instances.ended_at', 'missions.*', 'missions.status'),
  'kpi.activeMissions': r(['missions/service.ts#listVisible'], 'missions.*', 'missions.status'),
  'kpi.approvals': r(['approvals/routes.ts#GET /approvals'], 'approval_requests.*', 'approval_requests.state', 'approval_requests.expires_at'),

  // ---- dimensions
  'dimension.cognitive.first_attempt_verified': r(DIM, DEPT, TASK_CORE, 'task_reviews.verdict', 'task_reviews.evidence', 'task_reviews.reviewer_id', 'task_reviews.producer_id', 'task_reviews.principal_id', 'task_reviews.created_at', 'task_reviews.seq', 'task_reviews.attempt_id', 'task_reviews.reviewer_kind', 'task_reviews.producer_kind'),
  'dimension.cognitive.stalled_missions': r(DIM, DEPT, 'mission_ledgers.kind', 'mission_ledgers.version', 'mission_ledgers.body', 'mission_ledgers.created_at', 'mission_ledgers.demo'),
  'dimension.cognitive.context_loss': r(DIM, DEPT, TASKS, TAGS),
  'dimension.capability.playbook_items': r(DIM, DEPT, 'agent_definitions.role', 'playbooks.agent_id', 'playbooks.version', 'playbooks.items', 'playbooks.created_at'),
  'dimension.capability.first_pass': r(DIM, DEPT, TASKS),
  'dimension.capability.site_grants': r(DIM, DEPT, 'site_grants.issued_at', 'site_grants.expires_at', 'site_grants.revoked_at'),
  'dimension.environmental.site_navigation': r([]),
  'dimension.environmental.model_availability': r([]),
  'dimension.collective.briefed_delegations': r(DIM, DEPT, 'delegation_briefs.to_instance', 'delegation_briefs.simulated', 'delegation_briefs.created_at', 'mission_delegations.to_instance', 'mission_delegations.at', 'mission_delegations.simulated', 'mission_delegations.edge_kind'),
  'dimension.collective.cross_family_reviews': r(DIM, DEPT, TASK_OWNER, 'task_reviews.reviewer_kind', 'task_reviews.reviewer_model_family', 'task_reviews.producer_kind', 'task_reviews.producer_model_family', 'task_reviews.created_at', 'task_reviews.seq', 'task_reviews.verdict'),
  'dimension.collective.approval_decision_h': r(DIM, DEPT, 'approval_requests.created_at', 'approval_requests.demo', 'approval_decisions.decided_at'),
  'dimension.knowledge.lessons_proposed': r(DIM, DEPT, LESSONS),
  'dimension.knowledge.lessons_accepted': r(DIM, DEPT, LESSONS),
  'dimension.knowledge.lessons_rolled_back': r(DIM, DEPT, LESSONS, 'playbooks.agent_id', 'playbooks.version', 'playbooks.items', 'playbooks.created_at'),
  'dimension.evolutionary.promotions': r(DIM, DEPT, 'agent_version_proposals.agent_id', 'agent_version_proposals.status', 'agent_version_proposals.decided_at'),
  'dimension.evolutionary.rollbacks': r(DIM, DEPT, 'audit_events.action', 'audit_events.result', 'audit_events.subject', 'audit_events.at'),
  'dimension.evolutionary.verdict_outcomes': r([...DIM, 'evolution/proposal-evidence.ts'], DEPT, 'agent_version_proposals.agent_id', 'agent_version_proposals.created_by', 'agent_version_proposals.base_version_id', 'agent_version_proposals.candidate',
    'eval_runs.subject_proposal_id', 'eval_runs.finished_at', 'eval_runs.started_at', 'eval_runs.dataset_id', 'eval_runs.k', 'eval_runs.judge_model_family', 'eval_runs.evaluator_id', 'eval_runs.grader_name', 'eval_runs.grader_version', 'eval_runs.subject_version_id',
    'eval_results.run_id', 'eval_results.case_id', 'eval_results.attempt', 'eval_results.score', 'eval_results.cost_units', 'eval_results.ungraded_reason',
    'eval_regrades.run_id', 'eval_regrades.created_at', 'eval_regrades.created_by', 'eval_regrades.from_grader_name', 'eval_regrades.from_grader_version', 'eval_regrades.to_grader_name', 'eval_regrades.to_grader_version',
    'eval_regrade_cases.regrade_id', 'eval_regrade_cases.case_id', 'eval_regrade_cases.attempt', 'eval_regrade_cases.new_score', 'eval_regrade_cases.new_ungraded_reason',
    'eval_datasets.split', 'eval_datasets.content_sha256', 'eval_cases.dataset_id', 'eval_cases.case_id', 'eval_cases.input', 'eval_cases.expected'),
  'dimension.evolutionary.org_revisions': r(DIM, DEPT, 'org_revisions.seq', 'org_revisions.active_from', 'org_edges.subordinate_id', 'org_edges.supervisor_id', 'org_edges.edge_type', 'org_edges.revision_id'),

  // ---- process rows (company/process-routes.ts)
  'process.rework_rate': r(PROC, 'task_reviews.verdict', 'task_reviews.rubric', 'task_reviews.created_at', 'task_reviews.seq', 'task_reviews.attempt_id', 'task_attempts.attempt_no', 'task_attempts.started_at', 'tasks.status', 'tasks.simulated', 'tasks.owner_agent', 'tasks.owner_instance_id', 'agent_instances.agent_id', TAGS, 'agent_definitions.dept', 'agent_definitions.status'),
  'process.first_pass_acceptance': r(PROC, 'task_reviews.verdict', 'task_reviews.created_at', 'task_reviews.seq', 'task_reviews.attempt_id', 'task_attempts.attempt_no', 'task_attempts.started_at', 'tasks.simulated', 'tasks.owner_agent', 'tasks.owner_instance_id', 'agent_instances.agent_id', 'agent_definitions.dept', 'agent_definitions.status'),
  'process.duplicate_delegation': r(PROC, 'delegation_briefs.brief', 'delegation_briefs.to_agent', 'delegation_briefs.created_at', 'delegation_briefs.supersedes_id', 'delegation_briefs.simulated', 'delegation_briefs.created_by', 'agent_definitions.dept', 'agent_definitions.status'),
  'process.reassign_churn': r(PROC, 'task_owner_history.agent_id', 'task_owner_history.at', 'task_owner_history.seq', 'tasks.owner_agent', 'tasks.owner_instance_id', 'tasks.simulated', 'agent_instances.agent_id', 'agent_definitions.dept', 'agent_definitions.status'),
  'process.handoff_wait_h': r(PROC, 'mission_delegations.at', 'mission_delegations.simulated', 'mission_delegations.edge_kind', 'mission_delegations.to_instance', 'agent_instances.agent_id', 'task_attempts.started_at', 'agent_definitions.dept', 'agent_definitions.status'),
  'process.approval_decision_h': r(PROC, 'approval_requests.agent_id', 'approval_requests.demo', 'approval_decisions.decided_at', 'approval_decisions.latency_ms', 'agent_definitions.dept', 'agent_definitions.status'),
  'process.cost': r([]),
};
