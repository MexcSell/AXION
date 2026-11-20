import type { FastifyRequest } from 'fastify';
import { createHash } from 'node:crypto';
import type { Db } from './db.ts';
import { ApiError } from './errors.ts';
import type { Ctx } from './auth/session.ts';

export interface Stored { status: number; body: unknown }

/**
 * Idempotency-Key (spec §11): the first request with a key runs; a repeat with the same body gets the stored
 * response; a repeat with another body is 422; a repeat while the first is still running is 409 (retryable).
 */
export async function idempotent(db: Db, req: FastifyRequest, ctx: Ctx, fn: () => Promise<Stored>): Promise<Stored> {
  const key = String(req.headers['idempotency-key'] ?? '');
  if (!key || key.length > 200) throw new ApiError('IDEMPOTENCY_KEY_REQUIRED', 400, 'This request needs an Idempotency-Key header.');
  const hash = createHash('sha256').update(`${req.method} ${req.url} ${JSON.stringify(req.body ?? null)}`).digest('hex');
  const ins = await db.query(
    `insert into idempotency_keys(tenant_id, user_id, key, request_hash) values ($1,$2,$3,$4) on conflict do nothing returning key`,
    [ctx.tenantId, ctx.user.id, key, hash]);
  if (!ins.rowCount) {
    const row = (await db.query('select request_hash, status, response from idempotency_keys where tenant_id=$1 and user_id=$2 and key=$3', [ctx.tenantId, ctx.user.id, key])).rows[0];
    if (row.request_hash !== hash) throw new ApiError('IDEMPOTENCY_MISMATCH', 422, 'This Idempotency-Key was already used for a different request.');
    if (row.status == null) throw new ApiError('CONFLICT', 409, 'The same request is still being processed.', { retryable: true });
    return { status: row.status, body: row.response };
  }
  try {
    const out = await fn();
    await db.query('update idempotency_keys set status=$4, response=$5 where tenant_id=$1 and user_id=$2 and key=$3', [ctx.tenantId, ctx.user.id, key, out.status, JSON.stringify(out.body)]);
    return out;
  } catch (e) {
    await db.query('delete from idempotency_keys where tenant_id=$1 and user_id=$2 and key=$3', [ctx.tenantId, ctx.user.id, key]);
    throw e;
  }
}
