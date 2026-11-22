// Job lease state machine (c45, records only). Pure: no I/O. The database trigger system_jobs_guard enforces the same edges.
export const JOB_KINDS = ['noop.test'] as const;
export type JobKind = (typeof JOB_KINDS)[number];
export const JOB_STATUSES = ['queued', 'leased', 'succeeded', 'failed', 'canceled', 'dead'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];
export const TERMINAL: readonly JobStatus[] = ['succeeded', 'failed', 'canceled', 'dead'];
export const isTerminal = (s: JobStatus) => TERMINAL.includes(s);

/** Legal edges (from -> to). queued -> queued and leased -> leased (heartbeat) keep the state. */
const EDGES: Record<JobStatus, readonly JobStatus[]> = {
  queued: ['queued', 'leased', 'canceled'],
  leased: ['leased', 'queued', 'succeeded', 'failed', 'dead', 'canceled'],
  succeeded: [], failed: [], canceled: [], dead: [],
};
export const isLegalEdge = (from: JobStatus, to: JobStatus) => EDGES[from].includes(to);

/** Where a failed attempt goes. A cancel request wins; a non-retryable failure is final; the last attempt is dead-lettered. */
export function nextOnFail(j: { attempt: number; maxAttempts: number; cancelRequested: boolean }, retryable = true): JobStatus {
  if (j.cancelRequested) return 'canceled';
  if (!retryable) return 'failed';
  return j.attempt >= j.maxAttempts ? 'dead' : 'queued';
}
/** Where an expired lease goes. */
export function nextOnReclaim(j: { attempt: number; maxAttempts: number; cancelRequested: boolean }): JobStatus {
  if (j.cancelRequested) return 'canceled';
  return j.attempt >= j.maxAttempts ? 'dead' : 'queued';
}

export type RefusalReason = 'not_found' | 'terminal' | 'not_leased' | 'stale_token' | 'lease_expired';
export const REFUSAL_TEXT: Record<RefusalReason, string> = {
  not_found: 'No such job.', terminal: 'The job is already finished.', not_leased: 'The job is not leased.',
  stale_token: 'The lease token is stale: the job was reclaimed or claimed again.', lease_expired: 'The lease has expired.',
};
/** Why a lease operation matched nothing. `expired` comes from the database clock. */
export function classifyRefusal(row: { status: JobStatus; leaseToken: number; expired: boolean } | null, token: number): RefusalReason {
  if (!row) return 'not_found';
  if (isTerminal(row.status)) return 'terminal';
  if (row.status !== 'leased') return 'not_leased';
  if (row.leaseToken !== token) return 'stale_token';
  return 'lease_expired';
}
