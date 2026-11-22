import type { FastifyInstance } from 'fastify';
import { readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireAdmin } from '../auth/session.ts';
import { VERSION } from '../config.ts';
import { queueSummary } from '../jobs/summary.ts';

export const DEFAULT_BACKUP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'backups');

/** Read-only operational status for administrators (spec Stage 5: "read-only operational status"). */
export default async function opsRoutes(app: FastifyInstance) {
  const started = Date.now();
  app.get('/operations/health', async (req) => {
    const ctx = await requireAdmin(req);
    let db: { status: 'up' | 'down'; sizeBytes?: number; missions?: number } = { status: 'down' };
    let events = { count: 0, lastAt: null as string | null };
    try {
      const size = (await app.db.query('select pg_database_size(current_database())::bigint as s')).rows[0].s;
      const ms = (await app.db.query('select count(*)::int n from missions where tenant_id=$1 and deleted_at is null', [ctx.tenantId])).rows[0].n;
      const ev = (await app.db.query('select count(*)::int n, max(occurred_at) as last from events where tenant_id=$1', [ctx.tenantId])).rows[0];
      db = { status: 'up', sizeBytes: Number(size), missions: ms };
      events = { count: ev.n, lastAt: ev.last ? new Date(ev.last).toISOString() : null };
    } catch { /* reported as down */ }
    let backup: { last: string | null; file: string | null; count: number } = { last: null, file: null, count: 0 };
    try {
      const dir = app.cfg.backupDir ?? DEFAULT_BACKUP_DIR;
      const files = readdirSync(dir).filter((f) => /^axion-.*\.dump$/.test(f)).map((f) => ({ f, at: statSync(join(dir, f)).mtime }));
      files.sort((a, b) => b.at.getTime() - a.at.getTime());
      if (files.length) backup = { last: files[0].at.toISOString(), file: files[0].f, count: files.length };
    } catch { /* no backups yet */ }
    return {
      version: VERSION,
      api: { status: 'up', uptimeSec: Math.round((Date.now() - started) / 1000) },
      db, events,
      sse: { clients: app.sse.clients },
      backup,
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
