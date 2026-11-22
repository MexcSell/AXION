/**
 * Improvement cycle 68 (R3-9): the operator attention queue, "Needs you".
 *
 * One list of what needs a person now, read from stored records only. Every row has a reason code and a one-sentence "why" that the
 * server builds from a template over enums, numbers and ids. No model writes any of it. The order is a fixed, documented design
 * choice (see ATTENTION_RANKING), not a finding from a source; it has no effect on any decision or tier. What the screen claims is
 * navigation and traceability: where an item came from and which check to run. It claims nothing about fewer mistakes.
 */

export const ATTENTION_KINDS = ['approval', 'task_review', 'task_waiting', 'failure', 'proposal', 'lesson'] as const;
export type AttentionKind = (typeof ATTENTION_KINDS)[number];

/** Icon names are a closed list so the web can map each to one drawn icon. */
export const ATTENTION_ICONS = ['shield-check', 'clipboard-check', 'hourglass', 'siren', 'git-pull-request', 'lightbulb'] as const;
export type AttentionIcon = (typeof ATTENTION_ICONS)[number];

export const ATTENTION_REASON_CODES = [
  'approval_pending', 'review_stale', 'task_waiting_person', 'failure_no_detection',
  'org_proposal_expiring', 'version_proposal_expiring', 'lesson_awaiting_review', 'lesson_system_derived',
] as const;
export type AttentionReasonCode = (typeof ATTENTION_REASON_CODES)[number];

export interface AttentionReasonDef {
  code: AttentionReasonCode; kind: AttentionKind; icon: AttentionIcon;
  /** short plain-words name of the reason (a row chip) */
  label: string;
  /** two or three words for a crowded row */
  short: string;
  /** the `?` help: what it means, where it comes from, what the person can do. No claim about safety or error rates. */
  what: string; source: string; action: string;
}

export const ATTENTION_REASONS: readonly AttentionReasonDef[] = Object.freeze([
  { code: 'approval_pending', kind: 'approval', icon: 'shield-check', label: 'Approval waiting', short: 'Approval',
    what: 'An agent asked for permission and nobody has decided yet. The request carries a risk tier from the policy table and an expiry time.',
    source: 'The approval request, its tier and its expiry as stored. Same list as Notifications, Pending.',
    action: 'Open the request, check that the bound digest matches the action, then approve or deny. R3 and R4 can only be decided by an administrator, and never by whoever asked.' },
  { code: 'review_stale', kind: 'task_review', icon: 'clipboard-check', label: 'Review out of date', short: 'Stale review',
    what: 'A task was reviewed, then the agent made another attempt. The old review judged an earlier attempt, so it no longer counts as verification for the task.',
    source: 'The latest stored review of the task compared with the task\'s latest attempt (the c51 freshness rule).',
    action: 'Open the task and review the latest attempt. A new review replaces the stale one.' },
  { code: 'task_waiting_person', kind: 'task_waiting', icon: 'hourglass', label: 'Task waiting on you', short: 'Waiting',
    what: 'A task has been in the state "waiting for a person" for longer than the expected time. The expected time is a fixed default of 24 hours.',
    source: 'The task state and the time of its last change to that state. Without a stored change time, the task\'s creation time is used and the evidence says so.',
    action: 'Open the task and answer, reassign it with a brief, or cancel it.' },
  { code: 'failure_no_detection', kind: 'failure', icon: 'siren', label: 'Failure, no detection recorded', short: 'No detection',
    what: 'A failure was confirmed, but nobody recorded how it was noticed (a test, an audit, a person looking, another agent, or reported later).',
    source: 'Confirmed failure tags of the last 30 days with no detection channel, unless another confirmed tag of the same mode on the same subject has one.',
    action: 'Find out how it was found. A decided tag cannot be changed, so this row cannot be fixed by editing it: tag failures like it with their detection channel from now on. The row leaves the queue after 30 days.' },
  { code: 'org_proposal_expiring', kind: 'proposal', icon: 'git-pull-request', label: 'Org proposal expiring', short: 'Org proposal',
    what: 'A proposed change to reporting lines is still waiting and will expire within 48 hours. An expired proposal cannot be decided; it must be made again.',
    source: 'The organisation proposal, its expiry time and the revision it was made on.',
    action: 'An administrator other than the author approves or rejects it. The author can withdraw it.' },
  { code: 'version_proposal_expiring', kind: 'proposal', icon: 'git-pull-request', label: 'Version proposal expiring', short: 'Version',
    what: 'A proposed new agent version is still waiting and will expire within 48 hours.',
    source: 'The agent version proposal, its expiry time and the version it was made against.',
    action: 'An administrator other than the author promotes or rejects it. The author can withdraw it.' },
  { code: 'lesson_awaiting_review', kind: 'lesson', icon: 'lightbulb', label: 'Lesson awaiting review', short: 'Lesson',
    what: 'A candidate lesson for an agent\'s playbook has not been accepted or rejected. A candidate never becomes active without a person accepting it.',
    source: 'The lesson candidate with its sources, status "proposed".',
    action: 'An administrator other than the proposer reads the sources and accepts or rejects it.' },
  { code: 'lesson_system_derived', kind: 'lesson', icon: 'lightbulb', label: 'System-derived lesson', short: 'System lesson',
    what: 'The system opened this candidate after the same failure mode recurred in several departments. It was derived from stored failure tags, not written by a person.',
    source: 'The candidate and the failure pattern record (c63) that opened it.',
    action: 'Read the failures behind it. Accepting is always a person\'s decision.' },
]);
export const attentionReason = (code: AttentionReasonCode): AttentionReasonDef => ATTENTION_REASONS.find((r) => r.code === code)!;

/** Fixed defaults, shown in the response so the screen can state them. None is a setting a request can change. */
export const ATTENTION_SETTINGS = Object.freeze({
  /** a task waiting on a person for longer than this is listed */
  waitingHours: 24,
  /** a pending proposal expiring within this is listed */
  nearExpiryHours: 48,
  /** confirmed failures older than this are no longer listed */
  failureWindowDays: 30,
});

/**
 * The ranking, in words (also served so the screen can show it). A design choice, not supported by any source:
 *  1. Tier. An approval's tier counts R4 highest down to R2. Every other kind has no tier and sits in one fixed band below R2.
 *  2. Expiry. Rows that expire come before rows that do not, the soonest first.
 *  3. Age. The longest waiting first.
 *  4. Last, a stable tie-break on the row id, so the same data always gives the same order.
 * A collapsed row ranks by its best member. Nothing about the viewer is an input.
 */
export const ATTENTION_RANKING = Object.freeze(['tier', 'expiry', 'age', 'id'] as const);
export const ATTENTION_RANKING_TEXT = 'Tier first (R4, R3, R2, then everything without a tier), then the soonest expiry, then the longest wait, then the id. A design choice; it changes no decision.';

export interface AttentionFact { label: string; value: string }
export interface AttentionEvidence {
  /** the check that would expose a defect in this item (a sentence from a template), never a reassurance */
  check: string;
  facts: AttentionFact[];
}
export interface AttentionAction { label: string; route: string; canAct: boolean; /** why the viewer cannot act, when canAct is false */ note: string | null }

/** One underlying item. A row holds one item, or several that were collapsed. */
export interface AttentionMemberDto {
  id: string; subject: string; ageSec: number; expiresInSec: number | null; route: string;
  tier: string | null; /** set when the wait is counted from a fallback, in words; otherwise null */ ageNote: string | null; canAct: boolean; /** why the viewer cannot act on this item, when canAct is false */ note: string | null; /** from a prototype (demo) mission */ demo: boolean; evidence: AttentionEvidence;
}
export interface AttentionRowDto {
  id: string; reason: AttentionReasonCode; kind: AttentionKind; icon: AttentionIcon;
  /** the approval's tier (R2 to R4), null for every other kind */
  tier: string | null;
  /** the templated sentence, built from stored enums, numbers and ids */
  why: string;
  /** what the lead item calls itself (agent- or person-written text; shown apart from the sentence) */
  subject: string;
  ageSec: number; expiresInSec: number | null;
  /** set when any item's wait is counted from a fallback (the task's creation), in words; otherwise null */
  ageNote: string | null;
  /** how many items this row stands for; always equals members.length */
  count: number;
  /** the lead item first; every collapsed item is listed */
  members: AttentionMemberDto[];
  action: AttentionAction;
  evidence: AttentionEvidence;
  /** what grouped the items, or null for a row that is never collapsed */
  groupedBy: string | null;
  /** the mission of the lead item, when it has one */
  missionId: string | null;
}
export interface AttentionDto {
  rows: AttentionRowDto[];
  /** items = sum of every row's count; collapsed = items - rows (what is folded into other rows, never dropped) */
  totals: { items: number; rows: number; collapsed: number };
  settings: { waitingHours: number; nearExpiryHours: number; failureWindowDays: number };
  ranking: string;
  checkedAt: string;
}
