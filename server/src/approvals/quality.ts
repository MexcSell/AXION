// Approval-quality records (c58, research R2-9). Records and display only: nothing here ever changes, blocks or grants a decision.
// Evidence is thin (a survey of systems and a blog caveat); the widely quoted approval rates are not used. Thresholds are advisory.
import type { Db, Tx } from '../db.ts';
import { TIERS, EFFECT_FLOOR, tierRank } from '../policy/types.ts';

/** Below this many recorded decisions a cell says "not enough evidence" and shows no number. */
export const MIN_EVIDENCE = 5;
/** Advisory "fast bulk" flag: this is at least the BULK_COUNT-th decision at R2 or above by one approver within BULK_WINDOW_S seconds. */
export const BULK_WINDOW_S = 60;
export const BULK_COUNT = 3;
/** R2 and above, taken from the existing tier table (the external-effect floor), not a second list. */
export const BULK_TIERS: readonly string[] = TIERS.filter((t) => tierRank(t) >= tierRank(EFFECT_FLOOR.external));
export const DEFAULT_WINDOW_DAYS = 30;
export const MAX_WINDOW_DAYS = 365;

/** Pending requests of this tenant right now, by the database clock (this one included). Read before the decision is written. */
export async function pendingQueueSize(c: Tx, tenantId: string): Promise<number> {
  return Number((await c.query(`select count(*) from approval_requests where tenant_id=$1 and state='pending' and expires_at > now()`, [tenantId])).rows[0].count);
}

/**
 * Appends the decision row with its quality record. Latency and the bulk flag are computed in SQL from the request row and the database
 * clock (no app clock, no value from the client). The flag only describes; the caller has already decided.
 */
export async function recordDecision(c: Tx, a: { approvalId: string; decision: 'approved' | 'denied'; reason: string; digest: string; userId: string; queueSize: number }) {
  await c.query(
    `insert into approval_decisions(approval_id, decision, reason, digest, decided_by, latency_ms, queue_size, fast_bulk)
     select $1, $2, $3, $4, $5,
            greatest(0, (extract(epoch from (now() - r.created_at)) * 1000)::bigint),
            $6,
            (r.risk = any($7::text[])) and (select count(*) from approval_decisions d join approval_requests q on q.id = d.approval_id
               where d.decided_by = $5 and d.decided_at > now() - make_interval(secs => $8::double precision) and q.risk = any($7::text[])) >= $9
       from approval_requests r where r.id = $1`,
    [a.approvalId, a.decision, a.reason, a.digest, a.userId, a.queueSize, BULK_TIERS, BULK_WINDOW_S, BULK_COUNT - 1]);
}

export interface QualityCell { n: number; enough: boolean; approvalRate: number | null; medianLatencyMs: number | null; fastBulk: number | null }
const cell = (r: { n: number | string; approved: number | string; med: number | string | null; fast: number | string }): QualityCell => {
  const n = Number(r.n), enough = n >= MIN_EVIDENCE;
  return { n, enough, approvalRate: enough ? Number(r.approved) / n : null, medianLatencyMs: enough && r.med !== null ? Math.round(Number(r.med)) : null, fastBulk: enough ? Number(r.fast) : null };
};
const CELL_SQL = `count(*)::int as n, count(*) filter (where d.decision='approved')::int as approved,
  percentile_cont(0.5) within group (order by d.latency_ms) as med, count(*) filter (where d.fast_bulk)::int as fast`;
const WHERE = `r.tenant_id = $1 and d.latency_ms is not null and d.decided_at > now() - make_interval(days => $2::int)`;

/** Aggregate for everyone: counts and medians over the whole tenant, no names. */
export async function aggregateQuality(db: Db | Tx, tenantId: string, windowDays: number) {
  const r = (await db.query(
    `select ${CELL_SQL}, percentile_cont(0.5) within group (order by d.queue_size) as medq, (now() - make_interval(days => $2::int)) as window_start
       from approval_decisions d join approval_requests r on r.id = d.approval_id where ${WHERE}`, [tenantId, windowDays])).rows[0];
  const c = cell(r);
  return { ...c, medianQueueSize: c.enough && r.medq !== null ? Math.round(Number(r.medq) * 10) / 10 : null, windowDays, windowStart: new Date(r.window_start).toISOString(), minEvidence: MIN_EVIDENCE };
}

/** Per approver, for administrators only: a person is a monitored individual, so this is never shown to anyone else. */
export async function approverQuality(db: Db | Tx, tenantId: string, windowDays: number) {
  const rows = (await db.query(
    `select d.decided_by as user_id, coalesce(max(u.name), 'Unknown user') as name, ${CELL_SQL}
       from approval_decisions d join approval_requests r on r.id = d.approval_id left join users u on u.id = d.decided_by
      where ${WHERE} group by d.decided_by order by count(*) desc, 2`, [tenantId, windowDays])).rows;
  return rows.map((r) => ({ userId: r.user_id as string, name: r.name as string, ...cell(r) }));
}
