/**
 * c76 R1 (PARKED, owner Q11): release, last-good and rollback-target RECORDS. Nothing in this contract describes an action:
 * no route releases, deploys, restarts or rolls back, and none stores or serves a file.
 */
export type ReleaseMarkKind = 'last_good' | 'rollback_target';
export const RELEASE_MARK_KINDS = ['last_good', 'rollback_target'] as const satisfies readonly ReleaseMarkKind[];

export interface ReleaseDto {
  id: string;
  version: string;
  what: string;
  /** every path the change touched, in the stored normal form */
  changePaths: string[];
  /** the subset on a guardrail path (policy, approvals, audit, locks, migrations); non-empty needs the R4 approval below */
  guardedPaths: string[];
  /** approvals the change came from */
  fromApprovals: string[];
  /** the R4 approval bound to this release (spent when the record was made); null when no path is guarded */
  guardrailApprovalId: string | null;
  releasedBy: string;
  releasedByName: string;
  createdAt: string;
}
export interface ReleaseMarkDto {
  id: string;
  releaseId: string;
  version: string;
  kind: ReleaseMarkKind;
  /** rollback_target only: the known-good release to return to */
  targetReleaseId: string | null;
  targetVersion: string | null;
  markedBy: string;
  markedByName: string;
  reason: string | null;
  createdAt: string;
}
/** The last-good pointer: the newest last_good mark (it never has a rollback target). */
export interface LastGoodDto {
  id: string;
  releaseId: string;
  version: string;
  markedBy: string;
  markedByName: string;
  reason: string | null;
  createdAt: string;
}
export interface ReleasesDto {
  releases: ReleaseDto[];
  /** the newest last_good mark, or null */
  lastGood: LastGoodDto | null;
  /** the newest rollback_target mark of each release */
  rollbackTargets: ReleaseMarkDto[];
  /** the newest marks of both kinds, newest first (at most 100) */
  marks: ReleaseMarkDto[];
}
