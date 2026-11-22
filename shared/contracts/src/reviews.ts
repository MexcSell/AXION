/** Independent task review (improvement cycle 38; spec invariant 5): who checked what, against which criteria, with what evidence. */
export const REVIEW_VERDICTS = ['accepted', 'changes_requested', 'rejected'] as const;
export type ReviewVerdict = (typeof REVIEW_VERDICTS)[number];
export const RUBRIC_RESULTS = ['pass', 'fail', 'na'] as const;
export type RubricResult = (typeof RUBRIC_RESULTS)[number];
export const EVIDENCE_KINDS = ['file', 'message', 'url'] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];
/** A reviewer's agreement is shown only from this many comparable reviews (below it: "not enough evidence"). */
export const MIN_AGREEMENT_N = 5;

export interface RubricItem { criterion: string; result: RubricResult; note: string }
export interface EvidenceRef { kind: EvidenceKind; ref: string; label?: string }
export interface ReviewActor { id: string; kind: 'user' | 'agent'; name: string; modelFamily: string | null }
/** agreed/n: of this reviewer's reviews that a LATER review of the same task by someone else judged, how many got the same verdict. */
export interface ReviewerAgreement { agreed: number; n: number; rate: number | null; state: 'ok' | 'none' }

export interface TaskReviewDto {
  id: string;
  taskId: string;
  missionId: string;
  reviewer: ReviewActor;
  producer: ReviewActor;
  verdict: ReviewVerdict;
  rubric: RubricItem[];
  evidence: EvidenceRef[];
  createdAt: string;
  /** Computed over the reviews of the missions the viewer can see, never stored. */
  reviewerAgreement: ReviewerAgreement;
}

/** `canReview` is decided by the server (never guessed by the client): code names the reason when allowed is false. */
export interface TaskReviewsDto {
  taskId: string;
  missionId: string;
  producer: ReviewActor | null;
  canReview: { allowed: boolean; code: string | null; reason: string | null };
  /** the mission's acceptance criteria (texts); empty when none were written */
  criteria: string[];
  /** things the reviewer may cite: the mission's files and the messages about this task */
  evidenceOptions: { kind: EvidenceKind; ref: string; label: string }[];
  reviews: TaskReviewDto[];
}

export interface CreateTaskReviewBody { verdict: ReviewVerdict; rubric: RubricItem[]; evidence: EvidenceRef[] }
