import type { Db } from '../db.ts';
import { JOB_KINDS, JOB_STATUSES, type JobKind, type JobStatus } from './machine.ts';

export interface QueueSummary {
  kinds: { kind: JobKind; counts: Record<JobStatus, number>; total: number }[];
  oldestQueuedAgeSec: number | null;
  expiredLeases: number;
  total: number;
}
/** Read-only counts for the operations view. Ages and expiry come from the database clock. */
export async function queueSummary(db: Db, tenantId: string): Promise<QueueSummary> {
  const rows = (await db.query('select kind, status, count(*)::int n from system_jobs where tenant_id=$1 group by 1,2', [tenantId])).rows as { kind: JobKind; status: JobStatus; n: number }[];
  const o = (await db.query(
    `select (select floor(extract(epoch from now() - min(created_at)))::int from system_jobs where tenant_id=$1 and status='queued') as age,
            (select count(*)::int from system_jobs where tenant_id=$1 and status='leased' and lease_expires_at <= now()) as expired`, [tenantId])).rows[0];
  const kinds = JOB_KINDS.map((kind) => {
    const counts = Object.fromEntries(JOB_STATUSES.map((s) => [s, 0])) as Record<JobStatus, number>;
    for (const r of rows) if (r.kind === kind) counts[r.status] = r.n;
    return { kind, counts, total: JOB_STATUSES.reduce((a, s) => a + counts[s], 0) };
  });
  return { kinds, oldestQueuedAgeSec: o.age ?? null, expiredLeases: o.expired, total: kinds.reduce((a, k) => a + k.total, 0) };
}
