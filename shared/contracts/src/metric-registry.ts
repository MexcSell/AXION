import { INPUT_FIELDS, writabilityOf, type InputFieldId, type Writability } from './metric-guard.ts';

/**
 * Improvement cycle 66 (R3-4), item 1: the row registry. Every scorecard row, KPI tile and six-dimension cell declares three things
 * (Goodhart guard; metadata only, no decision changes because of it):
 *  (i)   a counter-metric that would RISE if the primary metric were gamed, or an explicit "no known counter-metric" with the reason
 *        (a forced filler text is worse than an honest none);
 *  (ii)  the quality dimensions the row does NOT cover (so nobody reads a number as more than it measures);
 *  (iii) its INPUT fields. Whether the row is agent-writable is never typed here: `guardOf` derives it from the writability inventory.
 * A contract test (server/test/c66-registry.test.ts) enforces 100% coverage of the live row sets.
 */
export const QUALITY_DIMENSIONS = {
  correctness: 'Correctness (is the result right)',
  completeness: 'Completeness (is everything done)',
  timeliness: 'Timeliness (how long it took)',
  cost: 'Cost (what it spent)',
  safety: 'Safety (did it stay inside its limits)',
  independence: 'Independent checking (a second pair of eyes)',
  user_value: 'Value to the person who asked',
  durability: 'Durability (does it stay fixed)',
} as const;
export type QualityDimension = keyof typeof QUALITY_DIMENSIONS;
export const QUALITY_DIMENSION_IDS = Object.keys(QUALITY_DIMENSIONS) as QualityDimension[];

export type CounterMetric = { ref: string; why: string } | { none: string };
export interface MetricMeta {
  id: string;
  kind: 'scorecard' | 'dimension' | 'kpi';
  label: string;
  inputs: readonly InputFieldId[];
  /** required when `inputs` is empty: why a row reads no stored field */
  inputsNote?: string;
  counter: CounterMetric;
  /** quality dimensions the row reads (so it is not also "uncovered") */
  covers: readonly QualityDimension[];
  /** quality dimensions it does not cover; never empty */
  uncovered: readonly QualityDimension[];
}

const S = (key: string, label: string, inputs: InputFieldId[], counter: CounterMetric, covers: QualityDimension[], uncovered: QualityDimension[]): MetricMeta => ({ id: `scorecard.${key}`, kind: 'scorecard', label, inputs, counter, covers, uncovered });
const D = (key: string, label: string, inputs: InputFieldId[], counter: CounterMetric, covers: QualityDimension[], uncovered: QualityDimension[], inputsNote?: string): MetricMeta =>
  ({ id: `dimension.${key}`, kind: 'dimension', label, inputs, counter, covers, uncovered, ...(inputsNote ? { inputsNote } : {}) });
const K = (key: string, label: string, inputs: InputFieldId[], counter: CounterMetric, covers: QualityDimension[], uncovered: QualityDimension[]): MetricMeta => ({ id: `kpi.${key}`, kind: 'kpi', label, inputs, counter, covers, uncovered });
const via = (ref: string, why: string): CounterMetric => ({ ref, why });

export const METRICS: readonly MetricMeta[] = [
  // ---- company scorecard (c02, c12, c38)
  S('started', 'Missions started', ['mission_runs.started'], via('scorecard.finished', 'starting many missions that never end raises started but not finished'), [], ['correctness', 'completeness', 'user_value', 'cost']),
  S('finished', 'Missions finished', ['events.mission_state_changed'], via('scorecard.verified_success_rate', 'ending missions by failing or cancelling them raises finished without raising the verified share'), ['completeness'], ['correctness', 'independence', 'user_value', 'cost']),
  S('verified_success_rate', 'Verified success', ['events.mission_state_changed', 'approval_decisions.decision', 'tasks.status', 'mission_delegations.edge'], via('scorecard.waiting_approval_median_h', 'rubber-stamped approvals shorten the time missions wait for one'), ['correctness', 'independence'], ['timeliness', 'durability', 'user_value', 'cost']),
  S('completed_unverified', 'Completed, unverified', ['events.mission_state_changed', 'approval_decisions.decision', 'tasks.status', 'mission_delegations.edge'], via('scorecard.approved_by_non_owner', 'adding cosmetic approvals lowers the unverified count and raises the non-owner approvals'), ['independence'], ['correctness', 'timeliness', 'durability', 'cost']),
  S('median_cycle_time_h', 'Median cycle time', ['mission_runs.started', 'events.mission_state_changed'], via('scorecard.failure_rate', 'finishing fast by failing or cancelling shortens the cycle and raises the failure rate'), ['timeliness'], ['correctness', 'completeness', 'user_value', 'cost']),
  S('failure_rate', 'Failure rate', ['events.mission_state_changed'], via('scorecard.completed_unverified', 'hiding failures by completing without a check raises completions that nobody verified'), ['completeness'], ['durability', 'safety', 'user_value', 'cost']),
  S('task_recovery_rate', 'Task recovery', ['tasks.status', 'task_attempts.times'], via('scorecard.tasks_verified_by_review', 'marking retried tasks passed raises recovery but not independently accepted reviews'), ['durability'], ['correctness', 'independence', 'timeliness', 'cost']),
  S('waiting_approval_median_h', 'Waiting for approval', ['events.mission_state_changed'],
    { none: 'a short wait can mean quick care or rubber-stamping, and nothing stored tells them apart; only the human audit sample can' }, ['timeliness'], ['correctness', 'safety', 'independence', 'cost']),
  S('approved_by_non_owner', 'Approved by a non-owner', ['events.mission_state_changed', 'approval_decisions.decision'], via('dimension.cognitive.first_attempt_verified', 'approvals given without looking show up as accepted work that later reviews do not confirm'), ['independence'], ['correctness', 'timeliness', 'durability', 'cost']),
  S('tasks_verified_by_review', 'Tasks verified by review', ['task_reviews.review', 'tasks.status'], via('scorecard.failure_rate', 'reviews that pass bad work raise the verified share and later the failure rate'), ['correctness', 'independence'], ['timeliness', 'durability', 'user_value', 'cost']),
  S('throughput', 'Weekly throughput', ['mission_runs.started', 'events.mission_state_changed'], via('scorecard.failure_rate', 'splitting or rushing missions raises the weekly counts and the failure rate'), ['completeness'], ['correctness', 'user_value', 'independence', 'cost']),

  // ---- the command-center KPI tiles that show a measured number (the DEMO-only tiles show invented numbers and are not rows)
  K('success.api', 'Verified Success', ['events.mission_state_changed', 'approval_decisions.decision', 'tasks.status', 'mission_delegations.edge'], via('scorecard.waiting_approval_median_h', 'the same scorecard row: rubber-stamped approvals shorten the wait'), ['correctness', 'independence'], ['timeliness', 'durability', 'user_value', 'cost']),
  K('staffedAgents', 'Staffed Agents', ['agent_instances.assignment', 'missions.state'], { none: 'a count of who is placed on live missions; padding it harms nothing a second stored number would show' }, [], ['correctness', 'completeness', 'timeliness', 'cost']),
  K('activeMissions', 'Active Missions', ['missions.state'], via('scorecard.finished', 'keeping missions open raises the active count and lowers finished'), [], ['correctness', 'completeness', 'timeliness', 'cost']),
  K('approvals', 'Pending Approvals', ['approval_requests.record'], via('scorecard.waiting_approval_median_h', 'a pile of unanswered requests lengthens the wait'), ['timeliness'], ['correctness', 'safety', 'cost']),

  // ---- six dimensions (c46, c54)
  D('cognitive.first_attempt_verified', 'Verified on first attempt', ['task_reviews.review', 'tasks.owner'], via('scorecard.failure_rate', 'reviews that pass first attempts without checking raise this and later the failure rate'), ['correctness', 'independence'], ['timeliness', 'durability', 'cost']),
  D('cognitive.stalled_missions', 'Missions with a flagged stall', ['mission_ledgers.progress'], via('scorecard.median_cycle_time_h', 'a ledger that never says "looping" hides stalls and lengthens the cycle'), ['timeliness'], ['correctness', 'completeness', 'cost']),
  D('cognitive.context_loss', 'Context-loss failures (FM-1.4, FM-2.1)', ['failure_tags.mode', 'failure_tags.status', 'tasks.status'], via('scorecard.failure_rate', 'tagging failures as something else lowers this and leaves the failure rate unchanged'), ['durability'], ['correctness', 'completeness', 'cost']),
  D('capability.playbook_items', 'Playbook items in force', ['playbooks.items', 'agent_definitions.catalog'], via('dimension.knowledge.lessons_rolled_back', 'adding many weak items raises the count and later the rollbacks'), [], ['correctness', 'completeness', 'user_value', 'cost']),
  D('capability.first_pass', 'Tasks passed first time', ['tasks.status', 'task_attempts.times', 'tasks.owner'], via('scorecard.tasks_verified_by_review', 'marking tasks passed without a check raises this but not independently accepted reviews'), ['correctness'], ['independence', 'timeliness', 'durability', 'cost']),
  D('capability.site_grants', 'Site grants active at the end', ['site_grants.window'], { none: 'a count of authorisations an administrator issued; more grants are neither better nor worse, and no second stored number tracks misuse of them' }, [], ['correctness', 'completeness', 'safety', 'cost']),
  D('environmental.site_navigation', 'Website navigation outcomes', [], { none: 'not measured until Stage 7 (browser execution), so there is no number to game yet' }, [], ['correctness', 'completeness', 'safety', 'cost'], 'no source exists yet'),
  D('environmental.model_availability', 'Model availability incidents', [], { none: 'not measured until Stage 7 (browser execution), so there is no number to game yet' }, [], ['correctness', 'completeness', 'timeliness', 'cost'], 'no source exists yet'),
  D('collective.briefed_delegations', 'Delegations with a brief', ['delegation_briefs.brief', 'mission_delegations.edge'], via('dimension.cognitive.first_attempt_verified', 'empty or boilerplate briefs raise this without raising work that passes its first review'), ['completeness'], ['correctness', 'user_value', 'cost']),
  D('collective.cross_family_reviews', 'Agent reviews across model families', ['task_reviews.review'], via('scorecard.tasks_verified_by_review', 'choosing a reviewer of another family without a real check raises this but not accepted-with-evidence reviews'), ['independence'], ['correctness', 'timeliness', 'cost']),
  D('collective.approval_decision_h', 'Median approval decision time', ['approval_requests.record', 'approval_decisions.decision'], { none: 'a short decision time can mean quick care or rubber-stamping, and nothing stored tells them apart; only the human audit sample can' }, ['timeliness'], ['correctness', 'safety', 'cost']),
  D('knowledge.lessons_proposed', 'Lessons proposed', ['lesson_candidates.status'], via('dimension.knowledge.lessons_accepted', 'proposing many weak lessons raises this and lowers the accepted share'), [], ['correctness', 'user_value', 'durability', 'cost']),
  D('knowledge.lessons_accepted', 'Lessons accepted', ['lesson_candidates.status'], via('dimension.knowledge.lessons_rolled_back', 'lessons accepted without scrutiny are rolled back more often'), ['independence'], ['correctness', 'durability', 'cost']),
  D('knowledge.lessons_rolled_back', 'Accepted lessons rolled back', ['lesson_candidates.status', 'playbooks.items'], { none: 'a rollback is itself the counter-signal to the lesson rows; nothing stored would rise if rollbacks were avoided' }, ['durability'], ['correctness', 'completeness', 'cost']),
  D('evolutionary.promotions', 'Version proposals promoted', ['agent_version_proposals.status'], via('dimension.evolutionary.rollbacks', 'promoting weak versions raises this and later the rollbacks'), [], ['correctness', 'durability', 'cost']),
  D('evolutionary.rollbacks', 'Agent versions rolled back', ['audit_events.agent_rollback'], { none: 'a rollback is itself the counter-signal to promotions; nothing stored would rise if rollbacks were avoided' }, ['durability'], ['correctness', 'completeness', 'cost']),
  D('evolutionary.verdict_outcomes', 'Evaluation verdicts', ['eval_runs.results', 'agent_version_proposals.status'], via('dimension.evolutionary.rollbacks', 'proposals that win their evaluation but do badly later raise this and then the rollbacks'), ['correctness'], ['durability', 'user_value', 'cost']),
  D('evolutionary.org_revisions', 'Org revisions applied', ['org_revisions.lines', 'agent_definitions.catalog'], { none: 'a count of structural changes an administrator approved; more or fewer is neither better nor worse, and no stored number tracks their effect yet' }, [], ['correctness', 'completeness', 'timeliness', 'cost']),
];

export const METRIC_BY_ID: ReadonlyMap<string, MetricMeta> = new Map(METRICS.map((m) => [m.id, m]));

/** One row as the API and the UI use it: the declaration plus the derived writability. `gameable` is never stored, only derived. */
export interface MetricGuard {
  id: string;
  kind: MetricMeta['kind'];
  label: string;
  counter: { kind: 'metric'; ref: string; refLabel: string; why: string } | { kind: 'none'; reason: string };
  uncovered: { id: QualityDimension; label: string }[];
  /** derived from the writability inventory: true when any input can be written by an agent identity */
  gameable: boolean;
  /** plain words, one or two sentences */
  gameableText: string;
  inputs: { id: string; what: string }[];
}

export function counterText(c: CounterMetric): string { return 'none' in c ? `No known counter-metric: ${c.none}` : c.why; }

export function gameableText(w: Writability, inputs: readonly string[]): string {
  if (inputs.length === 0) return 'Reads no stored field yet, so there is nothing for an agent to write.';
  if (!w.agentWritable) return 'No agent identity can write any field this row reads today. Only people (through a route) or the system can.';
  const fns = [...new Set(w.agentSites.map((s) => s.fn))].join(', ');
  const gates = [...new Set(w.agentSites.map((s) => s.gate).filter(Boolean))];
  return `An agent identity can write an input of this row (through ${fns}), so the agent being measured could move this number.${gates.length ? ` Gate in the way: ${gates.join('; ')}.` : ''} Display only: nothing changes because of this flag.`;
}

export function guardOf(m: MetricMeta, byId: ReadonlyMap<string, MetricMeta> = METRIC_BY_ID): MetricGuard {
  const w = writabilityOf(m.inputs);
  return {
    id: m.id, kind: m.kind, label: m.label,
    counter: 'none' in m.counter ? { kind: 'none', reason: m.counter.none } : { kind: 'metric', ref: m.counter.ref, refLabel: byId.get(m.counter.ref)?.label ?? m.counter.ref, why: m.counter.why },
    uncovered: m.uncovered.map((id) => ({ id, label: QUALITY_DIMENSIONS[id] })),
    gameable: w.agentWritable, gameableText: gameableText(w, m.inputs),
    inputs: m.inputs.map((id) => ({ id, what: INPUT_FIELDS[id].what })),
  };
}
export const guardRows = (): MetricGuard[] => METRICS.map((m) => guardOf(m));

/** What is wrong with a registry compared with the live row ids (empty = 100% coverage, every declaration well-formed). */
export function registryProblems(metrics: readonly MetricMeta[], liveIds: readonly string[], fieldIds: readonly string[]): string[] {
  const out: string[] = [];
  const ids = new Set(metrics.map((m) => m.id));
  if (ids.size !== metrics.length) out.push('duplicate id in the registry');
  for (const id of liveIds) if (!ids.has(id)) out.push(`${id}: a live row with no registry entry (counter-metric, uncovered dimensions and inputs)`);
  for (const m of metrics) {
    if (!liveIds.includes(m.id)) out.push(`${m.id}: in the registry but no such row is shown (renamed or removed?)`);
    if ('none' in m.counter) { if (m.counter.none.trim().length < 40) out.push(`${m.id}: "no known counter-metric" needs a real reason (at least 40 characters)`); }
    else {
      if (m.counter.ref === m.id) out.push(`${m.id}: a row cannot be its own counter-metric`);
      else if (!ids.has(m.counter.ref)) out.push(`${m.id}: counter-metric ${m.counter.ref} is not a registered row`);
      if (m.counter.why.trim().length < 25) out.push(`${m.id}: the counter-metric needs a sentence saying why it would rise (at least 25 characters)`);
    }
    if (m.uncovered.length === 0) out.push(`${m.id}: declares no uncovered quality dimension`);
    for (const q of [...m.uncovered, ...m.covers]) if (!QUALITY_DIMENSION_IDS.includes(q)) out.push(`${m.id}: unknown quality dimension ${q}`);
    for (const q of m.uncovered) if (m.covers.includes(q)) out.push(`${m.id}: ${q} is both covered and uncovered`);
    for (const f of m.inputs) if (!fieldIds.includes(f)) out.push(`${m.id}: input ${f} is not in the writability inventory`);
    if (m.inputs.length === 0 && !(m.inputsNote && m.inputsNote.trim().length >= 10)) out.push(`${m.id}: reads no input, so it needs inputsNote saying why`);
    if ('gameable' in m || 'writable' in m || 'agentWritable' in m) out.push(`${m.id}: writability is derived from the inventory and must not be declared on the row`);
  }
  return out;
}

/** GET /company/metric-guard (c66). The flag is display only; the promotion-input rule waits for R3-3 and is recorded as this note, nothing more. */
export const PROMOTION_NOTE = 'The "gameable" flag is display only. Whether a gameable row may ever be an input to a promotion decision belongs to R3-3, which waits for the owner\'s answer to Q13. Nothing in AXION changes because of this flag.';
export interface MetricGuardDto { rows: MetricGuard[]; promotionNote: string }
