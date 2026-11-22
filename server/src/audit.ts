import { createHash } from 'node:crypto';
import pg from 'pg';
import type { Tx, Db } from './db.ts';
import { canonical } from './approvals/service.ts';
import { EVENTS_LOCK } from './events/log.ts';
import { advisoryXactLock } from './locks.ts';

const SECRET_KEYS = /pass|password|token|secret|csrf|hash|cookie/i;
/** Drop any field that could hold a secret (axor rule: secrets are never logged). */
export function redact(detail: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(detail)) {
    if (SECRET_KEYS.test(k)) continue;
    out[k] = v && typeof v === 'object' && !Array.isArray(v) ? redact(v as Record<string, unknown>) : v;
  }
  return out;
}

export interface AuditInput { tenantId: string; actor: string; action: string; subject: string; result: 'ok' | 'denied' | 'error'; correlationId: string; detail?: Record<string, unknown> }

/** Tamper-evident chain (c31). row_hash = sha256(prev_hash \n canonical(row)); migration 0026 backfills old rows with the SQL twin of this. */
export const GENESIS = '0'.repeat(64);
export interface ChainRow { tenantId: string; seq: number; at: string; actor: string; action: string; subject: string; result: string; correlationId: string; detail: unknown }
export const chainHash = (prev: string, r: ChainRow) => createHash('sha256').update(prev + '\n' + canonical(r)).digest('hex');
const AT_FMT = `'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`;

/**
 * Append one audit row. Inside the caller's transaction it takes the tenant's advisory lock (held to commit), so two writers
 * can never both extend the same head: the chain cannot fork. A pool (no transaction yet) gets a transaction of its own.
 * Lock order: the events lock first, then the tenant lock. Several callers emit (events lock) before they audit and others
 * after; taking the events lock first here keeps one global order, so the two can never deadlock.
 */
export async function audit(c: Tx | Db, a: AuditInput) {
  if (c instanceof pg.Pool) {
    const t = await c.connect();
    try {
      await t.query('begin');
      await t.query(`set local lock_timeout = '5s'`);
      await audit(t, a);
      await t.query('commit');
    } catch (e) {
      try { await t.query('rollback'); } catch { /* connection lost */ }
      throw e;
    } finally { t.release(); }
    return;
  }
  const detail = JSON.stringify(redact(a.detail ?? {})); // what is stored is what is hashed: redacted first
  await advisoryXactLock(c, EVENTS_LOCK);
  await advisoryXactLock(c, 'audit-chain:' + a.tenantId); // same key as before: schema || ':audit-chain:' || tenant
  const head = (await c.query('select seq, row_hash from audit_events where tenant_id=$1 order by seq desc limit 1', [a.tenantId])).rows[0];
  const seq = head ? Number(head.seq) + 1 : 1;
  const prev: string = head ? head.row_hash : GENESIS;
  const at: string = (await c.query(`select to_char(clock_timestamp() at time zone 'UTC', ${AT_FMT}) as at`)).rows[0].at;
  const rowHash = chainHash(prev, { tenantId: a.tenantId, seq, at, actor: a.actor, action: a.action, subject: a.subject, result: a.result, correlationId: a.correlationId, detail: JSON.parse(detail) });
  await c.query(
    'insert into audit_events(tenant_id, actor, action, subject, result, correlation_id, detail, at, seq, prev_hash, row_hash) values ($1,$2,$3,$4,$5,$6,$7,$8::timestamptz,$9,$10,$11)',
    [a.tenantId, a.actor, a.action, a.subject, a.result, a.correlationId, detail, at, seq, prev, rowHash],
  );
}

export interface ChainResult { ok: boolean; checked: number; firstBadSeq?: number; reason?: string }
/** Read-only walk of one tenant's chain in seq order, in batches. Stops at the first row that does not fit. */
export async function verifyChain(db: Db | Tx, tenantId: string, batch = 1000): Promise<ChainResult> {
  let prev = GENESIS;
  let expect = 1;
  let checked = 0;
  for (;;) {
    const rows = (await db.query(
      `select seq, prev_hash, row_hash, to_char(at at time zone 'UTC', ${AT_FMT}) as at, actor, action, subject, result, correlation_id, detail
         from audit_events where tenant_id=$1 and seq > $2 order by seq limit $3`, [tenantId, expect - 1, batch])).rows;
    if (!rows.length) return { ok: true, checked };
    for (const r of rows) {
      const seq = Number(r.seq);
      const bad = (reason: string, at = seq): ChainResult => ({ ok: false, checked, firstBadSeq: at, reason });
      if (seq !== expect) return bad(`seq ${expect} is missing (next row is ${seq})`, expect);
      if (r.prev_hash !== prev) return bad('prev_hash does not match the previous row');
      const h = chainHash(prev, { tenantId, seq, at: r.at, actor: r.actor, action: r.action, subject: r.subject, result: r.result, correlationId: r.correlation_id, detail: r.detail });
      if (h !== r.row_hash) return bad('row content does not match its hash');
      prev = h; expect = seq + 1; checked++;
    }
  }
}
