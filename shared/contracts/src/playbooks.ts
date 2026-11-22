/** Improvement cycle 41: reviewed playbooks and a skill library (records only: nothing executes). */
export type SourceKind = 'mission' | 'failure_tag' | 'review' | 'task' | 'note';
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
  /** Items of the current playbook this text seems to contradict (deterministic check). Accepting needs an override note. */
  conflicts: LessonConflict[];
  /** What the viewer may do: false with a reason when the decider would be the proposer (or the submitter). */
  canDecide: boolean; cannotDecideWhy: string | null;
}
export interface PlaybookItem {
  lessonId: string; text: string; trust: 'reviewed'; addedInVersion: number; sources: SourceRef[]; sha256: string;
  reviewBy: string | null; contradiction: boolean; contradicts: string[]; overrideNote: string | null;
  /** past review_by on the database clock */
  needsReReview: boolean;
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
}
