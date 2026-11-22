/** The MAST taxonomy is frozen data that lives in the shared contracts (the web quotes the same list); the server re-exports it. */
export {
  FAILURE_TAXONOMY, FAILURE_TAXONOMY_VERSION, FAILURE_TAXONOMY_SOURCE, FAILURE_MODE_IDS, FAILURE_SUBJECT_KINDS, failureModeOf,
} from '../../../shared/contracts/src/failures.ts';
export type { FailureSubjectKind, FailureTagStatus, FailureTagDto, FailureSubjectInfo, FailureModesDto } from '../../../shared/contracts/src/failures.ts';
