import { createHash, randomBytes } from 'node:crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { Tx, Db } from '../db.ts';
import { ApiError } from '../errors.ts';

export const SID = 'axion_sid';
export const DEV = 'axion_dev';
export const WAIT = 'axion_wait';
export const SESSION_DAYS = 30;
export const IDLE_HOURS = 24;

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const token = () => randomBytes(32).toString('base64url');
export const shortId = (p: string) => p + '-' + randomBytes(6).toString('hex');

export function cookieOpts(maxAgeSec: number) {
  return { path: '/', httpOnly: true, sameSite: 'strict' as const, secure: process.env.COOKIE_SECURE === '1', maxAge: maxAgeSec };
}

/** Create a session row; only the sha256 of the token is stored. */
export async function newSession(c: Tx | Db, s: { tenantId: string; userId: string; deviceId: string; kind: 'full' | 'wait' }) {
  const t = token();
  const csrf = token();
  const ttl = s.kind === 'full' ? `${SESSION_DAYS} days` : '24 hours';
  await c.query(
    `insert into sessions(token_hash, tenant_id, user_id, device_id, kind, csrf, expires_at) values ($1,$2,$3,$4,$5,$6, now() + $7::interval)`,
    [sha256(t), s.tenantId, s.userId, s.deviceId, s.kind, csrf, ttl],
  );
  return { token: t, csrf };
}

export function setSid(reply: FastifyReply, t: string) { reply.setCookie(SID, t, cookieOpts(SESSION_DAYS * 86400)); }
export function setWait(reply: FastifyReply, t: string) { reply.setCookie(WAIT, t, cookieOpts(86400)); }
export function clear(reply: FastifyReply, name: string) { reply.clearCookie(name, { path: '/' }); }

export async function revokeUserSessions(c: Tx | Db, userId: string, exceptHash?: string) {
  await c.query(`update sessions set revoked_at = now() where user_id = $1 and revoked_at is null and token_hash <> coalesce($2, '')`, [userId, exceptHash ?? null]);
}
export async function revokeDeviceSessions(c: Tx | Db, deviceId: string) {
  await c.query(`update sessions set revoked_at = now() where device_id = $1 and revoked_at is null`, [deviceId]);
}

export interface Ctx {
  tenantId: string;
  user: { id: string; name: string; role: 'admin' | 'member' };
  deviceId: string;
  tokenHash: string;
  csrf: string;
  correlationId: string;
}

declare module 'fastify' { interface FastifyRequest { ctx?: Ctx } }

const WRITE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Resolve the signed-in user (cached per request). Writes also need X-CSRF = the session's csrf. */
export async function requireUser(req: FastifyRequest): Promise<Ctx> {
  if (req.ctx) return req.ctx;
  const raw = req.cookies[SID];
  if (!raw) throw new ApiError('UNAUTHENTICATED', 401, 'Sign in first.');
  const db = req.server.db;
  const h = sha256(raw);
  const r = await db.query(
    `select s.tenant_id, s.user_id, s.device_id, s.csrf, s.revoked_at, s.expires_at < now() as expired,
            s.last_seen_at < now() - interval '${IDLE_HOURS} hours' as idle, s.last_seen_at < now() - interval '1 minute' as stale_seen,
            u.name, u.role, u.status, d.status as dev_status
       from sessions s join users u on u.id = s.user_id left join devices d on d.id = s.device_id
      where s.token_hash = $1 and s.kind = 'full' and s.tenant_id = $2`, [h, req.server.cfg.tenantId]);
  const s = r.rows[0];
  if (!s) throw new ApiError('UNAUTHENTICATED', 401, 'Sign in first.');
  if (s.revoked_at || s.status !== 'approved' || s.dev_status !== 'approved') throw new ApiError('SESSION_REVOKED', 401, 'Your access was changed by an administrator. Sign in again.');
  if (s.expired || s.idle) throw new ApiError('UNAUTHENTICATED', 401, 'Your session expired. Sign in again.');
  if (WRITE.has(req.method) && req.headers['x-csrf'] !== s.csrf) throw new ApiError('CSRF', 403, 'This request was blocked as cross-site. Reload the page.');
  if (s.stale_seen) {
    await db.query(`update sessions set last_seen_at = now() where token_hash = $1`, [h]);
    if (s.device_id) await db.query(`update devices set last_seen_at = now() where id = $1`, [s.device_id]);
  }
  req.ctx = { tenantId: s.tenant_id, user: { id: s.user_id, name: s.name, role: s.role }, deviceId: s.device_id, tokenHash: h, csrf: s.csrf, correlationId: String(req.id) };
  return req.ctx;
}

export async function requireAdmin(req: FastifyRequest): Promise<Ctx> {
  const c = await requireUser(req);
  if (c.user.role !== 'admin') throw new ApiError('FORBIDDEN', 403, 'Only an administrator can do this.');
  return c;
}

/** Same-origin check for every write (axor pattern): an Origin, when sent, must match Host or an allowed origin. */
export function checkOrigin(req: FastifyRequest, allowed: string[] = []) {
  if (!WRITE.has(req.method)) return;
  const origin = req.headers.origin;
  if (!origin) return;
  let host = '';
  try { host = new URL(origin).host; } catch { /* bad origin */ }
  const reqHost = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '');
  if (host && (host === reqHost || allowed.includes(origin))) return;
  throw new ApiError('CSRF', 403, 'This request was blocked as cross-site.');
}
