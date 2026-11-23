import type { FastifyInstance } from 'fastify';
import { readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireAdmin } from '../auth/session.ts';
import { VERSION } from '../config.ts';
import { queueSummary } from '../jobs/summary.ts';
import { ApiError } from '../errors.ts';
import { SlidingWindow } from '../ratelimit.ts';
import { verifyAnchors } from '../audit-anchor.ts';
import { readPslHealth } from '../grants/psl-age.ts';

export const DEFAULT_BACKUP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'backups');

/** Read-only operational status for administrators (spec Stage 5: "read-only operational status"). */
export default async function opsRoutes(app: FastifyInstance) {
  const started = Date.now();
  const win = new SlidingWindow({ max: 12, windowMs: 60_000 });
  /** c49: read-only status of the external audit anchor for the caller's own tenant. No key, no file path, no hashes leave the server. */
  app.get('/operations/anchors', async (req, reply) => {
    const ctx = await requireAdmin(req);
    const wait = win.take(ctx.tokenHash);
    if (wait) {
      reply.header('retry-after', String(Math.ceil(wait / 1000)));
      throw new ApiError('RATE_LIMITED', 429, `Too many anchor checks from this session. Wait ${Math.ceil(wait / 1000)} s and try again.`, { retryable: true });
    }
    const r = await verifyAnchors(app.db, { ...app.cfg.auditAnchor, tenant: ctx.tenantId });
    return { configured: r.configured, ok: r.ok, lastAnchorAt: r.lastAnchorAt, restartedAt: r.rotatedFrom?.at ?? null, reason: r.reason ?? null,
      tenants: r.tenants.map((t) => ({ tenant: t.tenant, status: t.status, anchoredSeq: t.anchoredSeq, anchoredAt: t.anchoredAt, reason: t.reason ?? null })), checkedAt: new Date().toISOString() };
  });
  app.get('/operations/health', async (req) => {
    const ctx = await requireAdmin(req);
    let db: { status: 'up' | 'down'; sizeBytes?: number; missions?: number } = { status: 'down' };
    let events = { count: 0, lastAt: null as string | null };
    try {
      // c81 (T1 item 2): pg_database_size counts every tenant's rows, so it is returned only while this tenant is the only one in the database
      // (then it is the caller's own data). With a second tenant the field is left out; the UI shows a dash for a missing figure.
      const sole = Number((await app.db.query('select count(*)::int n from tenants')).rows[0].n) <= 1;
      const size = sole ? (await app.db.query('select pg_database_size(current_database())::bigint as s')).rows[0].s : undefined;
      const ms = (await app.db.query('select count(*)::int n from missions where tenant_id=$1 and deleted_at is null', [ctx.tenantId])).rows[0].n;
      const ev = (await app.db.query('select count(*)::int n, max(occurred_at) as last from events where tenant_id=$1', [ctx.tenantId])).rows[0];
      db = { status: 'up', ...(size === undefined ? {} : { sizeBytes: Number(size) }), missions: ms };
      events = { count: ev.n, lastAt: ev.last ? new Date(ev.last).toISOString() : null };
    } catch { /* reported as down */ }
    let backup: { last: string | null; file: string | null; count: number } = { last: null, file: null, count: 0 };
    try {
      const dir = app.cfg.backupDir ?? DEFAULT_BACKUP_DIR;
      const files = readdirSync(dir).filter((f) => /^axion-.*\.dump$/.test(f)).map((f) => ({ f, at: statSync(join(dir, f)).mtime }));
      files.sort((a, b) => b.at.getTime() - a.at.getTime());
      if (files.length) backup = { last: files[0].at.toISOString(), file: files[0].f, count: files.length };
    } catch { /* no backups yet */ }
    let publicSuffix: Awaited<ReturnType<typeof readPslHealth>> | null = null;
    try { publicSuffix = await readPslHealth(app.db); } catch (e) { app.log.warn({ err: e }, 'public suffix snapshot age unavailable'); /* reported as null: the health read itself never fails for this */ }
    return {
      version: VERSION,
      api: { status: 'up', uptimeSec: Math.round((Date.now() - started) / 1000) },
      db, events,
      sse: { clients: app.sse.clients },
      backup,
      publicSuffix, // c73: snapshot date, age (database date) and the 90-day warning; null when it could not be read
      execution: 'disabled',
      checkedAt: new Date().toISOString(),
    };
  });

  /** Read-only job records (c45): counts only. No route enqueues, claims or cancels; nothing runs a job in this build. */
  app.get('/operations/queues', async (req) => {
    const ctx = await requireAdmin(req);
    const q = await queueSummary(app.db, ctx.tenantId);
    return { ...q, execution: 'disabled', recordsOnly: true, checkedAt: new Date().toISOString() };
  });
}
