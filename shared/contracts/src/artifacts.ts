/**
 * c76 A1 (PARKED, owner Q11): artifact METADATA and immutable versions. The server records what is claimed about a file (hash, size,
 * media type, producer). It stores no file and serves none; there is no download route and no download ticket (deferred, see migration 0056).
 */
export const ARTIFACT_PRODUCER_KINDS = ['user', 'agent', 'system'] as const;
export type ArtifactProducerKind = (typeof ARTIFACT_PRODUCER_KINDS)[number];
export const ARTIFACT_MAX_BYTES = 1_099_511_627_776;

export interface ArtifactVersionDto {
  version: number;
  /** lower-case hex sha256 of the file, as claimed by the recorder (the server never sees the bytes) */
  sha256: string;
  sizeBytes: number;
  mediaType: string;
  producer: string;
  producerKind: ArtifactProducerKind;
  recordedBy: string;
  recordedByName: string;
  createdAt: string;
}
export interface ArtifactDto {
  id: string;
  name: string;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  versionCount: number;
  /** an artifact is created with its first version, so there is always a latest one */
  latest: ArtifactVersionDto;
}
export interface ArtifactsDto { artifacts: ArtifactDto[] }
/** newest version first */
export interface ArtifactDetailDto { artifact: ArtifactDto; versions: ArtifactVersionDto[] }
