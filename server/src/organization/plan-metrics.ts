import type { Db, Tx } from '../db.ts';
import { METRICS } from '../../../shared/contracts/src/index.ts';

/**
 * c85 (R5-1) item 3: what ONE observation is, for each registry metric a plan may name. The plan readout only COUNTS these in two windows; it
 * computes no rate, no effect and no verdict.
 *
 * Every unit reads only tables that the metric's declared INPUT fields (metric-registry.ts, INPUT_FIELDS in metric-guard.ts) already name, plus
 * `support` tables used only to keep real work (a mission that is not demo and not deleted, a task that is not simulated), exactly as the
 * company loaders and evidence.ts do. test/c85-plan-metrics.test.ts keeps this honest: every registry id is either mapped here or listed in
 * NOT_COUNTABLE with a reason (so a new registry row fails the day it is added), and no unit reads a table its metric does not declare.
 * A metric with no recorded observations (no inputs, or a point-in-time tile) cannot be the subject of a plan.
 *
 * SQL: tenant is $1; the unit returns one row per observation with its time `ts`. The windows are built in SQL from the change time and the
 * database clock (never a JS Date as a bound).
 */
export interface ObservationUnit {
  id: string;
  /** one counted observation, in words (shown in the readout) */
  what: string;
  /** the tables whose rows are the observations (each must be a table the metric's inputs declare) */
  tables: readonly string[];
  /** tables joined only to keep real work */
  support: readonly string[];
  sql: string;
}
const REAL_M = `m.tenant_id = $1 and m.deleted_at is null and not m.demo`;
const unit = (id: string, what: string, tables: string[], support: string[], sql: string): ObservationUnit => ({ id, what, tables, support, sql });
export const UNITS: Record<string, ObservationUnit> = {
  run: unit('run', 'a mission that started its first run', ['mission_runs'], ['missions'],
    `select r.first_at as ts from (select mission_id, min(started_at) as first_at from mission_runs group by mission_id) r join missions m on m.id = r.mission_id where ${REAL_M}`),
  mission_end: unit('mission_end', 'a mission that moved to completed, failed or cancelled', ['events'], ['missions'],
    `select e.occurred_at as ts from events e join missions m on m.id = e.mission_id where e.tenant_id = $1 and e.type = 'mission.stateChanged' and e.payload->>'to' in ('completed','failed','canceled') and ${REAL_M}`),
  approval_wait: unit('approval_wait', 'a mission that left the waiting-for-approval state', ['events'], ['missions'],
    `select e.occurred_at as ts from events e join missions m on m.id = e.mission_id where e.tenant_id = $1 and e.type = 'mission.stateChanged' and e.payload->>'from' = 'waiting_approval' and ${REAL_M}`),
  task: unit('task', 'a task that was created (not simulated)', ['tasks'], ['missions'],
    `select t.created_at as ts from tasks t join missions m on m.id = t.mission_id where t.tenant_id = $1 and not t.simulated and ${REAL_M}`),
  attempt: unit('attempt', 'a task attempt that started (not simulated)', ['task_attempts'], ['tasks', 'missions'],
    `select a.started_at as ts from task_attempts a join tasks t on t.id = a.task_id join missions m on m.id = t.mission_id where t.tenant_id = $1 and not t.simulated and ${REAL_M}`),
  review: unit('review', 'an independent task review that was recorded', ['task_reviews'], ['missions'],
    `select r.created_at as ts from task_reviews r join missions m on m.id = r.mission_id where r.tenant_id = $1 and ${REAL_M}`),
  approval_decision: unit('approval_decision', 'a person\'s decision on an approval request (not demo)', ['approval_decisions'], ['approval_requests'],
    `select d.decided_at as ts from approval_decisions d join approval_requests r on r.id = d.approval_id where r.tenant_id = $1 and not r.demo`),
  delegated: unit('delegated', 'a delegation edge between two agent instances (not simulated)', ['mission_delegations'], ['missions'],
    `select d.at as ts from mission_delegations d join missions m on m.id = d.mission_id where d.edge_kind = 'delegated' and not d.simulated and ${REAL_M}`),
  brief: unit('brief', 'a delegation brief that was recorded (not simulated)', ['delegation_briefs'], ['missions'],
    `select b.created_at as ts from delegation_briefs b join missions m on m.id = b.mission_id where b.tenant_id = $1 and not b.simulated and ${REAL_M}`),
  progress_ledger: unit('progress_ledger', 'a progress ledger version (not demo)', ['mission_ledgers'], ['missions'],
    `select l.created_at as ts from mission_ledgers l join missions m on m.id = l.mission_id where l.tenant_id = $1 and l.kind = 'progress' and not l.demo and m.deleted_at is null`),
  confirmed_tag: unit('confirmed_tag', 'a failure tag that a person confirmed (a tag on a demo or deleted mission is not counted)', ['failure_tags'], ['missions'],
    `select f.decided_at as ts from failure_tags f left join missions m on m.id = f.mission_id where f.tenant_id = $1 and f.status = 'confirmed' and f.decided_at is not null and (f.mission_id is null or (not m.demo and m.deleted_at is null))`),
  grant: unit('grant', 'a website grant that was issued', ['site_grants'], ['missions'],
    `select g.issued_at as ts from site_grants g join missions m on m.id = g.mission_id where g.tenant_id = $1 and ${REAL_M}`),
  lesson_proposed: unit('lesson_proposed', 'a lesson that was proposed', ['lesson_candidates'], [],
    `select l.created_at as ts from lesson_candidates l where l.tenant_id = $1`),
  lesson_accepted: unit('lesson_accepted', 'a lesson that was accepted', ['lesson_candidates'], [],
    `select l.decided_at as ts from lesson_candidates l where l.tenant_id = $1 and l.status = 'accepted' and l.decided_at is not null`),
  playbook: unit('playbook', 'a playbook version that was written', ['playbooks'], [],
    `select p.created_at as ts from playbooks p where p.tenant_id = $1`),
  promotion: unit('promotion', 'an agent version proposal that was promoted', ['agent_version_proposals'], [],
    `select v.decided_at as ts from agent_version_proposals v where v.tenant_id = $1 and v.status = 'promoted' and v.decided_at is not null`),
  rollback: unit('rollback', 'an agent version rollback', ['audit_events'], [],
    `select a.at as ts from audit_events a where a.tenant_id = $1 and a.action = 'agent.rollback' and a.result = 'ok'`),
  eval_run: unit('eval_run', 'an evaluation run that started', ['eval_runs'], [],
    `select r.started_at as ts from eval_runs r where r.tenant_id = $1`),
  org_revision: unit('org_revision', 'an organisation revision that became active', ['org_revisions'], [],
    `select o.active_from as ts from org_revisions o where o.tenant_id = $1`),
  owner_change: unit('owner_change', 'a change of the owner of a task (not simulated, not on a demo or deleted mission)', ['task_owner_history'], ['tasks', 'missions'],
    `select h.at as ts from task_owner_history h join tasks t on t.id = h.task_id join missions m on m.id = t.mission_id where h.tenant_id = $1 and h.source = 'change' and not t.simulated and ${REAL_M}`),
};

/** registry id -> unit id */
export const METRIC_UNIT: Record<string, string> = {
  'scorecard.started': 'run', 'scorecard.finished': 'mission_end', 'scorecard.verified_success_rate': 'mission_end', 'scorecard.completed_unverified': 'mission_end',
  'scorecard.median_cycle_time_h': 'mission_end', 'scorecard.failure_rate': 'mission_end', 'scorecard.task_recovery_rate': 'attempt', 'scorecard.waiting_approval_median_h': 'approval_wait',
  'scorecard.approved_by_non_owner': 'approval_decision', 'scorecard.tasks_verified_by_review': 'review', 'scorecard.throughput': 'run',
  'kpi.success.api': 'mission_end',
  'dimension.cognitive.first_attempt_verified': 'review', 'dimension.cognitive.stalled_missions': 'progress_ledger', 'dimension.cognitive.context_loss': 'confirmed_tag',
  'dimension.capability.playbook_items': 'playbook', 'dimension.capability.first_pass': 'task', 'dimension.capability.site_grants': 'grant',
  'dimension.collective.briefed_delegations': 'delegated', 'dimension.collective.cross_family_reviews': 'review', 'dimension.collective.approval_decision_h': 'approval_decision',
  'dimension.knowledge.lessons_proposed': 'lesson_proposed', 'dimension.knowledge.lessons_accepted': 'lesson_accepted',
  'dimension.evolutionary.promotions': 'promotion', 'dimension.evolutionary.rollbacks': 'rollback', 'dimension.evolutionary.org_revisions': 'org_revision',
  'process.rework_rate': 'review', 'process.first_pass_acceptance': 'review', 'process.duplicate_delegation': 'brief', 'process.reassign_churn': 'owner_change',
  'process.handoff_wait_h': 'delegated', 'process.approval_decision_h': 'approval_decision',
};
/** Registry rows with no timestamped observations to count: a plan cannot name them (the reason is shown to the person who tries). */
export const NOT_COUNTABLE: Record<string, string> = {
  'kpi.staffedAgents': 'it is a count of the present moment, with no recorded observations to count in a window',
  'kpi.activeMissions': 'it is a count of the present moment, with no recorded observations to count in a window',
  'kpi.approvals': 'it is a count of the present moment, with no recorded observations to count in a window',
  'dimension.environmental.site_navigation': 'nothing records it yet (browser execution comes with Stage 7)',
  'dimension.environmental.model_availability': 'nothing records it yet (browser execution comes with Stage 7)',
  'dimension.knowledge.lessons_rolled_back': 'the only rows it could count are accepted lessons, which is a different thing, so a count would mislead',
  'dimension.evolutionary.verdict_outcomes': 'the only rows it could count are all evaluation runs, not their verdicts, so a count would mislead',
  'process.cost': 'nothing records it until Stage 9 (the usage ledger)',
};
export const PLANNABLE: readonly string[] = METRICS.map((m) => m.id).filter((id) => id in METRIC_UNIT);
const LABEL = new Map(METRICS.map((m) => [m.id, m.label]));
export const labelOf = (id: string) => LABEL.get(id) ?? id;
export const unitOf = (id: string): ObservationUnit | undefined => UNITS[METRIC_UNIT[id]];

/** Why a metric id cannot be in a plan, or null when it can. */
export function whyNotPlannable(id: string): string | null {
  if (!LABEL.has(id)) return 'This is not a metric of the registry. Pick one from the metric list; free-text metrics are not accepted.';
  if (id in NOT_COUNTABLE) return `${labelOf(id)} cannot be planned: ${NOT_COUNTABLE[id]}.`;
  return unitOf(id) ? null : `${labelOf(id)} has no recorded observations to count.`;
}

type Q = Tx | Db;
export interface ChangeBounds { otherChanges: number; revision: number; activeFrom: Date; preFrom: Date; postTo: Date; postComplete: boolean; checkedAt: Date }
/** The change time and both window bounds, from the database clock: `now()` and `active_from` never leave SQL. */
export async function changeBounds(c: Q, tenantId: string, revision: number, days: number): Promise<ChangeBounds | null> {
  const r = (await c.query(
    `select seq, active_from, active_from - make_interval(days => $3::int) as pre_from, active_from + make_interval(days => $3::int) as post_to,
            now() >= active_from + make_interval(days => $3::int) as complete, now() as checked_at,
            (select count(*)::int from org_revisions o where o.tenant_id = $1 and o.seq <> $2 and o.active_from >= r.active_from and o.active_from < r.active_from + make_interval(days => $3::int) and o.active_from <= now()) as other
       from org_revisions r where tenant_id = $1 and seq = $2`, [tenantId, revision, days])).rows[0];
  return r ? { otherChanges: r.other, revision: r.seq, activeFrom: new Date(r.active_from), preFrom: new Date(r.pre_from), postTo: new Date(r.post_to), postComplete: r.complete, checkedAt: new Date(r.checked_at) } : null;
}
/** Observations of one metric before and after the change: pre = [change - N days, change), post = [change, change + N days) up to now. Counts only. */
export async function countObservations(c: Q, tenantId: string, metric: string, revision: number, days: number): Promise<{ pre: number; post: number }> {
  const u = unitOf(metric);
  if (!u) return { pre: 0, post: 0 };
  const r = (await c.query(
    `with w as (select active_from as a, active_from - make_interval(days => $3::int) as pf, active_from + make_interval(days => $3::int) as pt from org_revisions where tenant_id = $1 and seq = $2)
     select (count(*) filter (where o.ts >= w.pf and o.ts < w.a))::int as pre, (count(*) filter (where o.ts >= w.a and o.ts < w.pt and o.ts <= now()))::int as post
       from (${u.sql}) o cross join w`, [tenantId, revision, days])).rows[0];
  return { pre: r?.pre ?? 0, post: r?.post ?? 0 };
}
