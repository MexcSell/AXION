import type { FastifyRequest } from 'fastify';
import { createHash } from 'node:crypto';
import { tx, type Db, type Tx } from './db.ts';
import { ApiError } from './errors.ts';
import type { Ctx } from './auth/session.ts';

export interface Stored { status: number; body: unknown }

/**
 * Idempotency-Key (spec §11), review I5: the key, the work and the stored response commit in ONE transaction.
 * A repeat with the same body gets the stored response (a concurrent repeat waits on the key's row lock and then
 * reads it); a repeat with another body is 422. If anything fails, nothing is kept and a retry runs again.
 * `onReplay` re-checks access before a stored response is returned (review M5).
 */
export async function idempotent(db: Db, req: FastifyRequest, ctx: Ctx, fn: (c: Tx) => Promise<Stored>, onReplay?: (c: Tx) => Promise<void>): Promise<Stored> {
  const key = String(req.headers['idempotency-key'] ?? '');
  if (!key || key.length > 200) throw new ApiError('IDEMPOTENCY_KEY_REQUIRED', 400, 'This request needs an Idempotency-Key header.');
  const hash = createHash('sha256').update(`${req.method} ${req.url} ${JSON.stringify(req.body ?? null)}`).digest('hex');
  return tx(db, async (c) => {
    const ins = await c.query(
      `insert into idempotency_keys(tenant_id, user_id, key, request_hash) values ($1,$2,$3,$4) on conflict do nothing returning key`,
      [ctx.tenantId, ctx.user.id, key, hash]);
    if (!ins.rowCount) {
      const row = (await c.query('select request_hash, status, response from idempotency_keys where tenant_id=$1 and user_id=$2 and key=$3', [ctx.tenantId, ctx.user.id, key])).rows[0];
      if (row.request_hash !== hash) throw new ApiError('IDEMPOTENCY_MISMATCH', 422, 'This Idempotency-Key was already used for a different request.');
      await onReplay?.(c);
      return { status: row.status, body: row.response };
    }
    const out = await fn(c);
    await c.query('update idempotency_keys set status=$4, response=$5 where tenant_id=$1 and user_id=$2 and key=$3', [ctx.tenantId, ctx.user.id, key, out.status, JSON.stringify(out.body)]);
    return out;
  });
}
