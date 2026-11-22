// Job store (c45, RECORDS ONLY). Nothing in the API imports this file: only tests and (later) a worker may.
// All time comparisons are SQL now(); the Node clock is never consulted for a lease.
import { randomUUID } from 'node:crypto';
import { audit } from '../audit.ts';
import { tx, type Db, type Tx } from '../db.ts';
import { classifyRefusal, nextOnFail, type JobKind, type JobStatus, type RefusalReason } from './machine.ts';

export interface Job {
  id: string; tenantId: string; kind: JobKind; payloadRef: string | null; status: JobStatus; attempt: number; maxAttempts: number;
  leaseOwner: string | null; leaseToken: number; leaseExpiresAt: string | null; heartbeatAt: string | null; cancelRequested: boolean;
  idempotencyKey: string; createdBy: string; createdAt: string; finishedAt: string | null; lastError: string | null;
}
const COLS = 'id, tenant_id, kind, payload_ref, status, attempt, max_attempts, lease_owner, lease_token::float8 as lease_token, lease_expires_at, heartbeat_at, cancel_requested, idempotency_key, created_by, created_at, finished_at, last_error';
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toJob = (r: any): Job => ({
  id: r.id, tenantId: r.tenant_id, kind: r.kind, payloadRef: r.payload_ref, status: r.status, attempt: r.attempt, maxAttempts: r.max_attempts,
  leaseOwner: r.lease_owner, leaseToken: Number(r.lease_token), leaseExpiresAt: iso(r.lease_expires_at), heartbeatAt: iso(r.heartbeat_at),
  cancelRequested: r.cancel_requested, idempotencyKey: r.idempotency_key, createdBy: r.created_by, createdAt: iso(r.created_at)!, finishedAt: iso(r.finished_at), lastError: r.last_error,
});
const RET = COLS.split(", ").map((c) => (c.includes(" as ") ? c : `j.${c}`)).join(", ");
const secs = (n: number) => { if (!Number.isFinite(n) || n < 0.05 || n > 3600) throw new Error('leaseSeconds must be between 0.05 and 3600'); return n; };

export type JobResult = { ok: true; job: Job } | { ok: false; reason: RefusalReason };

export async function getJob(db: Db | Tx, tenantId: string, id: string): Promise<Job | null> {
  const r = await db.query(`select ${COLS} from system_jobs where tenant_id=$1 and id=$2`, [tenantId, id]);
  return r.rows[0] ? toJob(r.rows[0]) : null;
}

/** Idempotent: the same (tenant, kind, key) returns the existing row and `created: false`. */
export async function enqueueJob(db: Db, a: { tenantId: string; kind: JobKind; idempotencyKey: string; createdBy: string; payloadRef?: string | null; maxAttempts?: number; correlationId?: string }): Promise<{ job: Job; created: boolean }> {
  return tx(db, async (c) => {
    const ins = await c.query(
      `insert into system_jobs(tenant_id, kind, payload_ref, max_attempts, idempotency_key, created_by) values ($1,$2,$3,$4,$5,$6)
       on conflict (tenant_id, kind, idempotency_key) do nothing returning ${COLS}`,
      [a.tenantId, a.kind, a.payloadRef ?? null, a.maxAttempts ?? 3, a.idempotencyKey, a.createdBy]);
    if (ins.rows[0]) {
      const job = toJob(ins.rows[0]);
      await audit(c, { tenantId: a.tenantId, actor: a.createdBy, action: 'job.enqueue', subject: job.id, result: 'ok', correlationId: a.correlationId ?? randomUUID(), detail: { kind: job.kind, maxAttempts: job.maxAttempts } });
      return { job, created: true };
    }
    const ex = await c.query(`select ${COLS} from system_jobs where tenant_id=$1 and kind=$2 and idempotency_key=$3`, [a.tenantId, a.kind, a.idempotencyKey]);
    return { job: toJob(ex.rows[0]), created: false };
  });
}

/** Claims the oldest queued job of one of `kinds` (FOR UPDATE SKIP LOCKED). The token goes up by one. */
export async function claimJob(db: Db, a: { owner: string; kinds: JobKind[]; leaseSeconds: number; tenantId?: string }): Promise<Job | null> {
  const r = await db.query(
    `with c as (select id from system_jobs where status='queued' and kind = any($2::text[]) and ($4::text is null or tenant_id = $4)
                order by seq limit 1 for update skip locked)
     update system_jobs j set status='leased', attempt=j.attempt+1, lease_token=j.lease_token+1, lease_owner=$1,
       lease_expires_at = now() + make_interval(secs => $3::float8), heartbeat_at = now()
     from c where j.id = c.id returning ${RET}`,
    [a.owner, a.kinds, secs(a.leaseSeconds), a.tenantId ?? null]);
  return r.rows[0] ? toJob(r.rows[0]) : null;
}

async function refuse(db: Db | Tx, tenantId: string, id: string, token: number): Promise<JobResult> {
  const r = await db.query(`select status, lease_token::float8 as lt, (lease_expires_at <= now()) as expired from system_jobs where tenant_id=$1 and id=$2`, [tenantId, id]);
  const row = r.rows[0];
  return { ok: false, reason: classifyRefusal(row ? { status: row.status, leaseToken: Number(row.lt), expired: !!row.expired } : null, token) };
}
const LIVE = `j.tenant_id=$1 and j.id=$2 and j.status='leased' and j.lease_token=$3 and j.lease_expires_at > now()`;

/** Extends the lease only for the current token while it is unexpired. The holder reads `job.cancelRequested`. */
export async function heartbeatJob(db: Db, a: { tenantId: string; id: string; token: number; leaseSeconds: number }): Promise<JobResult> {
  const r = await db.query(`update system_jobs j set lease_expires_at = now() + make_interval(secs => $4::float8), heartbeat_at = now() where ${LIVE} returning ${RET}`, [a.tenantId, a.id, a.token, secs(a.leaseSeconds)]);
  return r.rows[0] ? { ok: true, job: toJob(r.rows[0]) } : refuse(db, a.tenantId, a.id, a.token);
}

export async function completeJob(db: Db, a: { tenantId: string; id: string; token: number }): Promise<JobResult> {
  const r = await db.query(`update system_jobs j set status='succeeded', finished_at=now(), lease_owner=null, lease_expires_at=null where ${LIVE} returning ${RET}`, [a.tenantId, a.id, a.token]);
  return r.rows[0] ? { ok: true, job: toJob(r.rows[0]) } : refuse(db, a.tenantId, a.id, a.token);
}

/** Holder reports a failed attempt: retry (queued) until max_attempts, then dead. retryable=false is final (failed). A cancel request wins. */
export async function failJob(db: Db, a: { tenantId: string; id: string; token: number; error: string; retryable?: boolean; correlationId?: string }): Promise<JobResult> {
  return tx(db, async (c) => {
    const cur = await c.query(`select attempt, max_attempts, cancel_requested from system_jobs j where ${LIVE} for update`, [a.tenantId, a.id, a.token]);
    if (!cur.rows[0]) return refuse(c, a.tenantId, a.id, a.token);
    const to = nextOnFail({ attempt: cur.rows[0].attempt, maxAttempts: cur.rows[0].max_attempts, cancelRequested: cur.rows[0].cancel_requested }, a.retryable ?? true);
    const r = await c.query(releaseSql(), [a.tenantId, a.id, to, String(a.error).slice(0, 1000)]);
    const job = toJob(r.rows[0]);
    if (job.status === 'dead') await audit(c, { tenantId: a.tenantId, actor: 'system', action: 'job.dead', subject: job.id, result: 'error', correlationId: a.correlationId ?? randomUUID(), detail: { kind: job.kind, attempt: job.attempt, reason: 'failed', error: job.lastError } });
    return { ok: true, job };
  });
}
/** Moves one leased row to `to`. The token goes up by one unless the job succeeded or failed for good. */
function releaseSql() {
  return `update system_jobs j set status=$3, last_error=$4,
      lease_token = case when $3 = 'failed' then j.lease_token else j.lease_token + 1 end,
      finished_at = case when $3 in ('failed','dead','canceled') then now() else null end,
      lease_owner=null, lease_expires_at=null
    where j.tenant_id=$1 and j.id=$2 returning ${RET}`;
}

/** The holder saw cancelRequested and stops: leased -> canceled. */
export async function acknowledgeCancel(db: Db, a: { tenantId: string; id: string; token: number }): Promise<JobResult> {
  const r = await db.query(`update system_jobs j set status='canceled', finished_at=now(), lease_token=j.lease_token+1, lease_owner=null, lease_expires_at=null where ${LIVE} and j.cancel_requested returning ${RET}`, [a.tenantId, a.id, a.token]);
  if (r.rows[0]) return { ok: true, job: toJob(r.rows[0]) };
  const j = await getJob(db, a.tenantId, a.id);
  if (j && j.status === 'leased' && j.leaseToken === a.token && !j.cancelRequested) return { ok: false, reason: 'not_leased' };
  return refuse(db, a.tenantId, a.id, a.token);
}

/** Expired leases (database clock) go back to queued, or to dead / canceled. The token is bumped, so the old holder is fenced out. */
export async function reclaimExpired(db: Db, a: { tenantId?: string; correlationId?: string } = {}): Promise<Job[]> {
  return tx(db, async (c) => {
    const r = await c.query(
      `update system_jobs j set status = t.tgt, lease_token = j.lease_token + 1, lease_owner=null, lease_expires_at=null,
         last_error = case when t.tgt = 'dead' then 'lease expired after the last attempt' else j.last_error end,
         finished_at = case when t.tgt in ('dead','canceled') then now() else null end
       from (select id, case when cancel_requested then 'canceled' when attempt >= max_attempts then 'dead' else 'queued' end as tgt
             from system_jobs where status='leased' and lease_expires_at <= now() and ($1::text is null or tenant_id=$1) order by seq for update skip locked) t
       where j.id = t.id returning ${RET}`, [a.tenantId ?? null]);
    const jobs = r.rows.map(toJob);
    for (const job of jobs) if (job.status === 'dead') await audit(c, { tenantId: job.tenantId, actor: 'system', action: 'job.dead', subject: job.id, result: 'error', correlationId: a.correlationId ?? randomUUID(), detail: { kind: job.kind, attempt: job.attempt, reason: 'lease expired' } });
    return jobs;
  });
}

/** Queued: canceled at once. Leased: flagged, the holder sees it on its next heartbeat. Finished: refused. */
export async function requestCancel(db: Db, a: { tenantId: string; id: string; actor: string; correlationId?: string }): Promise<{ ok: true; job: Job; outcome: 'canceled' | 'flagged' } | { ok: false; reason: RefusalReason }> {
  return tx(db, async (c) => {
    const cur = await c.query('select status from system_jobs where tenant_id=$1 and id=$2 for update', [a.tenantId, a.id]);
    if (!cur.rows[0]) return { ok: false as const, reason: 'not_found' as const };
    const st = cur.rows[0].status as JobStatus;
    let r;
    if (st === 'queued') r = await c.query(`update system_jobs j set status='canceled', cancel_requested=true, finished_at=now() where j.tenant_id=$1 and j.id=$2 returning ${RET}`, [a.tenantId, a.id]);
    else if (st === 'leased') r = await c.query(`update system_jobs j set cancel_requested=true where j.tenant_id=$1 and j.id=$2 returning ${RET}`, [a.tenantId, a.id]);
    else return { ok: false as const, reason: 'terminal' as const };
    const job = toJob(r.rows[0]);
    await audit(c, { tenantId: a.tenantId, actor: a.actor, action: 'job.cancel', subject: job.id, result: 'ok', correlationId: a.correlationId ?? randomUUID(), detail: { kind: job.kind, outcome: st === 'queued' ? 'canceled' : 'flagged' } });
    return { ok: true as const, job, outcome: st === 'queued' ? 'canceled' as const : 'flagged' as const };
  });
}
