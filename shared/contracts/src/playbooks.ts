/** Improvement cycle 41: reviewed playbooks and a skill library (records only: nothing executes). */
export type SourceKind = 'mission' | 'failure_tag' | 'review' | 'task' | 'note' | 'lesson' | 'skill';
/**
 * Improvement cycle 59 (R2-5): where a record came from. The write CHANNEL is recorded by the server from the route or service that wrote it
 * (never from a request body); the origin CLASS is derived from it. Ruling (total order, low to high): tool < agent < human.
 *  - human_entry: a signed-in person typed it (class human). Only a route with a session can write this channel.
 *  - agent_output: an agent proposed it (class agent). tool_output: text that came back from a tool (class tool).
 *  - derived: a summary or merge of other records, named in `sources` as `lesson` or `skill` refs. Its class is the weakest of those
 *    sources, and also never above its writer's own class (an agent-written summary of human items is agent). Review (accept, approve,
 *    rollback) is a separate axis: it never changes the class.
 */
export const ORIGIN_CLASSES = ['tool', 'agent', 'human'] as const;
export type OriginClass = (typeof ORIGIN_CLASSES)[number];
export const ORIGIN_CHANNELS = ['human_entry', 'agent_output', 'tool_output', 'derived'] as const;
export type OriginChannel = (typeof ORIGIN_CHANNELS)[number];
export const originRank = (c: OriginClass): number => ORIGIN_CLASSES.indexOf(c) + 1;
/** Where a lesson or a skill comes from. Only `mission` refs are checked against the database (and for visibility). */
export interface SourceRef { kind: SourceKind; id: string; note?: string; /** set by the server: true for mission and task sources (checked at propose time), false for the typed kinds */ verified?: boolean; /** a private mission or task id hidden from a member (id is empty) */ hidden?: boolean }
export type StepKind = 'navigate' | 'observe' | 'fill' | 'click' | 'check' | 'ask_human' | 'note';
/** A skill step: a closed structure. Text is plain; a URL appears only as `origin` of a navigate step. Quoted data, never executed. */
export interface SkillStep { kind: StepKind; target?: string; detail: string; origin?: string }

export type LessonStatus = 'proposed' | 'accepted' | 'rejected' | 'superseded';
export interface LessonConflict { lessonId: string; text: string }
export interface LessonCandidateDto {
  id: string; agentId: string; agentName: string; role: string; text: string; sources: SourceRef[];
  proposedBy: string; proposedByName: string; proposedByKind: 'human' | 'agent'; submittedBy: string | null;
  status: LessonStatus; sha256: string; reviewBy: string | null; createdAt: string;
  decidedBy: string | null; decidedByName: string | null; decidedAt: string | null; decisionNote: string | null; overrideNote: string | null;
  acceptedInVersion: number | null;
  /** set when a rollback removed the accepted item (status becomes superseded) */
  withdrawnInVersion: number | null;
  /** true when the lesson's item is in the CURRENT playbook (a superseded lesson that a later rollback restored is true) */
  inPlaybook: boolean;
  /** Items of the current playbook this text seems to contradict (deterministic check). Accepting needs an override note. */
  conflicts: LessonConflict[];
  /** What the viewer may do: false with a reason when the decider would be the proposer (or the submitter). */
  canDecide: boolean; cannotDecideWhy: string | null;
  /** c59: the write channel and the origin class derived from it (never raised by review) */
  originChannel: OriginChannel; originClass: OriginClass;
}
export interface PlaybookItem {
  lessonId: string; text: string; trust: 'reviewed'; addedInVersion: number; sources: SourceRef[]; sha256: string;
  reviewBy: string | null; contradiction: boolean; contradicts: string[]; overrideNote: string | null;
  /** past review_by on the database clock */
  needsReReview: boolean;
  /** c59: read from the lesson's own row, so an item written before migration 0044 has them too */
  originChannel: OriginChannel; originClass: OriginClass;
}
export interface PlaybookDto {
  agentId: string; agentName: string; role: string; version: number; items: PlaybookItem[];
  kind: 'accept' | 'rollback' | null; createdBy: string | null; createdByName: string | null; createdAt: string | null; rollbackTo: number | null; note: string | null;
}
export interface PlaybookVersionRow { version: number; kind: 'accept' | 'rollback'; items: number; createdBy: string; createdByName: string; createdAt: string; rollbackTo: number | null; note: string | null; lessonId: string | null }
export interface PlaybookDiff { from: number; to: number; added: PlaybookItem[]; removed: PlaybookItem[]; kept: number }

export type SkillStatus = 'draft' | 'approved' | 'retired';
export interface SkillDto {
  id: string; name: string; version: number; description: string; steps: SkillStep[]; preconditions: string[]; sources: SourceRef[];
  status: SkillStatus; proposedBy: string; proposedByName: string; createdAt: string;
  approvedBy: string | null; approvedByName: string | null; approvedAt: string | null; retiredBy: string | null; retiredAt: string | null; retireNote: string | null;
  canDecide: boolean; cannotDecideWhy: string | null;
  /** c59 */
  originChannel: OriginChannel; originClass: OriginClass;
}

/** c59: one line of a record's append-only contribution log. Who or what changed it, when, and from which sources. */
export const CONTRIBUTION_ACTIONS = ['proposed', 'accepted', 'rejected', 'closed_duplicate', 'withdrawn', 'restored', 'approved', 'retired', 'replaced', 'retirement_kept'] as const;
export type ContributionAction = (typeof CONTRIBUTION_ACTIONS)[number];
export interface ContributionDto {
  seq: number; recordKind: 'lesson' | 'skill'; recordId: string; action: ContributionAction;
  actor: string; actorName: string; actorKind: 'human' | 'agent' | 'system';
  originChannel: OriginChannel; originClass: OriginClass;
  /** the record's sources when the line was written (private ids hidden from a member) */
  sources: SourceRef[];
  /** the playbook version this line created or changed, when it did */
  version: number | null;
  /** administrators only */
  note: string | null;
  at: string;
}

/** c59: outcome-driven retirement proposals. FIXTURE-ONLY: no agent uses a skill yet, so the only scores are ones a test or a demo fixture wrote. */
export const SKILL_SCORE_FLOOR = 0.4;
export const SKILL_OUTCOME_MIN_N = 5;
export interface RetirementProposalDto {
  skillId: string; name: string; version: number;
  score: number; n: number; outcomeId: number; recordedAt: string;
  /** always 'fixture' for now: the label the page shows next to a score */
  source: 'fixture';
}
export interface RetirementProposalsDto {
  floor: number; minN: number;
  /** 'none' = no outcome rows at all ("no outcome data yet"); 'fixture' = there are fixture rows */
  dataState: 'none' | 'fixture';
  proposals: RetirementProposalDto[];
}
