import { CHURN_MIN_TASKS } from '@contracts';
import type { HelpEntry } from '../registry';

const h = (title: string, what: string, why?: string, how?: string, example?: string, permission?: string): HelpEntry => ({ title, what, why, how, example, permission });
const OPEN = 'Items that are still open (not reviewed yet, no attempt started yet) are shown beside the figure as "open" and are never in the denominator.';
const NOW = ' Review freshness and task state are read as recorded now, so a past window can drift slightly if a task is attempted again later.';

/** Improvement cycle 69 (R3-5): process measures next to the outcome rows. The definitions are this product's own; no "good" level is claimed, and the order of the cells says nothing. */
const entries: Record<string, HelpEntry> = {
  'process.row': h('Process', 'How the work moved, next to how it ended: how often a first review sent a task back, how often work was accepted first time, how often the same goal was delegated twice, how many times a task changed hands, and how long a hand-off waited before work began.',
    'The outcome rows show where work ended up. They do not show the path that led there; process figures may help to see it.',
    'Each figure is counted from rows the server recorded, for missions you can see, with n and the window shown on the cell. Each card has a ? with its exact formula and a shield with what the number could be gamed by. Two cells are honest blanks: the approval decision time and the cost have no source in this version. ' + OPEN,
    'Returned for rework: 4 of 7 tasks whose first review fell in the last 30 days were sent back. n = 7. 2 tasks are open: finished with no review yet.',
    'Everyone signed in can open it. There is no total and no "good" or "bad" level: nothing in the sources says where one would be.'),
  'process.rework_rate': h('Returned for rework', 'Of the tasks whose FIRST review decision fell in the window, the share that review returned (changes requested or rejected).',
    'A task that comes back probably needs another pass. This is the rate at which the first review sent work back; it does not say whether the review was right.',
    'Formula: returned on the first review / tasks whose first review is in the window. A later review of the same task does not change it. The breakdown shows the failure tags on the returned tasks. A tag belongs to the task, not to the review, so it may be about a later attempt or have been confirmed after the return. For each returned task the confirmed failure tag mode known at the window end is shown; "several failure modes" when a task carries more than one; otherwise "criterion failed, no tag" when the review marked a criterion failed; otherwise "no recorded cause". Each cause is shown with its n. ' + OPEN + ' Needs at least 3 tasks.' + NOW,
    '4 of 7 returned = 57.1%. Failure tags on returned tasks: FM-1.1 1, criterion failed, no tag 1, no recorded cause 1, several failure modes 1.',
    'A lenient reviewer lowers it. The guard (shield) names the counter-metric: failures that appear later.'),
  'process.first_pass_acceptance': h('Accepted first time', 'Of the tasks with at least one review in the window, the share whose FIRST review ever was Accepted and whose acceptance still stands.',
    'Work accepted at the first review, on its first attempt, may be a sign of a smooth path; it may also be a sign of a lenient review.',
    'Formula: tasks whose first review is Accepted, was written against attempt 1 and is not stale / tasks with a review in the window. A task whose first attempt failed and whose retry was accepted at its first review is not counted (that was attempt 2). A stale review (the task was attempted again after it) never counts, so a task that was accepted and then retried is not first-time. A task accepted only after a return is not first-time. ' + OPEN + ' Needs at least 3 tasks.' + NOW,
    '3 of 8 = 37.5%.',
    'It is not the complement of "Returned for rework": the cohorts differ (any review in the window here, first review in the window there).'),
  'process.duplicate_delegation': h('Duplicate delegations', 'Delegations in the window whose goal is the same as that of another delegation of the same mission.',
    'The same goal sent twice may be repeated work, or a hand-over that lost context; it may also be a deliberate re-send.',
    'Formula: delegations whose normalised goal matches another current delegation of the same mission in the window / delegations with a goal in the window. Normalised means trimmed, lower-cased, with runs of spaces collapsed, so "Fix the bug" and "  fix  THE bug " match. A revised brief replaces the one it revises and is not counted twice. The same text in two different missions is not a duplicate. A reassign that carries the same goal text as the earlier delegation of that mission counts as a duplicate delegation (its brief is a new delegation, and a revision only replaces a brief for the same agent). Briefs the staffing simulator writes when it places an agent are not counted. Needs at least 3 delegations.',
    '2 of 5 delegations share a goal, in 1 repeated goal = 40%.',
    'Rewording a goal slightly hides a repeat: only a person reading the briefs can tell. The guard says so.'),
  'process.reassign_churn': h('Reassign churn', 'How many times a task changed owner after its first assignment: the median and the 90th percentile over tasks first assigned in the window.',
    'A task that keeps changing hands may be one that nobody owns for long; it may also be work that moved to the right specialist.',
    `Counted from the append-only owner history. A change is a new owning agent; a row with the same agent (an instance ending, say) is not a change. The 90th percentile uses the nearest-rank rule. Shown only from ${CHURN_MIN_TASKS} tasks, because a median of a handful of tasks says little. Changes are counted up to the end of the window.`,
    'Median 0, 90th percentile 2 over 24 tasks.',
    'No level is claimed to be good: some work should be handed over.'),
  'process.handoff_wait_h': h('Wait on a hand-off', 'The time from a delegation of a task to the first started attempt of that task: the median and the 90th percentile, in hours.',
    'Time between "handed over" and "work began" may be time the task waited for someone; the record cannot say why.',
    'Formula: for each delegation to a task made in the window, first started attempt of that task minus the delegation time, measured by the database clock. Open hand-offs (no attempt has started) are shown as open and are not in the median. A delegation with no task is not measured. Needs at least 3 closed hand-offs. The attempt is the task\'s own first attempt; the record does not say which actor started it.',
    'Median 2.5 h and 90th percentile 6 h over 9 delegations; 1 is open.',
    'Starting an attempt early to end the wait would lower it; the guard names the retried tasks as the counter-metric.'),
  'process.approval_decision_h': h('Approval wait', 'The time from an approval request to its decision.', 'A request that waits may hold up the work behind it.', 'Median and 90th percentile, in hours, of the decision time stored when a person decided (the same stored time as Approval quality). It needs at least 20 decided approvals in the window, otherwise the cell says there is not enough evidence. A request that is still waiting is not in it.'),
  'process.cost': h('Cost', 'What the work cost.', 'A process that is cheap but returns work, or costly but smooth, should be read next to its cost.', 'Not measured until Stage 9 (the usage ledger). Nothing records what work cost yet, so the figure stays blank. n is unknown, not zero.'),
};
export default entries;
