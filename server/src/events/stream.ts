import type { FastifyInstance } from 'fastify';
import { EventEmitter } from 'node:events';
import pg from 'pg';
import { requireUser, sha256, SID } from '../auth/session.ts';
import { CHANNEL, eventDto } from './log.ts';

declare module 'fastify' { interface FastifyInstance { eventBus: EventEmitter; sseClients: () => number } }

const HEARTBEAT_MS = 15_000;
const SAFETY_POLL_MS = 5_000;

/** One LISTEN connection per process; NOTIFY only wakes streams, which then re-read the log by cursor. */
export function startListener(app: FastifyInstance, databaseUrl: string) {
  const bus = new EventEmitter();
  bus.setMaxListeners(0);
  let client: pg.Client | null = null;
  let closed = false;
  const connect = async () => {
    if (closed) return;
    const c = new pg.Client({ connectionString: databaseUrl });
    c.on('notification', () => bus.emit('wake'));
    c.on('error', () => { /* handled by end */ });
    c.on('end', () => { client = null; if (!closed) setTimeout(() => void connect(), 1000); });
    try { await c.connect(); await c.query(`listen ${CHANNEL}`); client = c; bus.emit('wake'); }
    catch { try { await c.end(); } catch { /* ignore */ } if (!closed) setTimeout(() => void connect(), 1000); }
  };
  void connect();
  app.addHook('onClose', async () => { closed = true; bus.emit('close'); if (client) await client.end().catch(() => {}); });
  return bus;
}

export default async function streamRoutes(app: FastifyInstance) {
  let clients = 0;
  app.decorate('sseClients', () => clients);

  app.get('/events/stream', async (req, reply) => {
    const ctx = await requireUser(req);
    const tokenHash = sha256(req.cookies[SID]!);
    const tenantId = ctx.tenantId;
    const last = String(req.headers['last-event-id'] ?? (req.query as { since?: string }).since ?? '');
    let cursor = /^\d+$/.test(last) ? last : String((await app.db.query('select coalesce(max(id), 0) as m from events where tenant_id=$1', [tenantId])).rows[0].m);

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    res.write(`retry: 2000\n\nevent: hello\ndata: ${JSON.stringify({ cursor, userId: ctx.user.id })}\n\n`);
    clients++;

    let open = true;
    let busy = false;
    let again = false;
    const finish = () => {
      if (!open) return;
      open = false; clients--;
      clearInterval(hb); clearInterval(poll);
      app.eventBus.off('wake', pump); app.eventBus.off('close', end);
    };
    const end = () => { finish(); try { res.end(); } catch { /* gone */ } };

    async function pump() {
      if (!open) return;
      if (busy) { again = true; return; }
      busy = true;
      try {
        do {
          again = false;
          // axor pattern: the session is re-checked on every loop; a revoked or expired session closes the stream
          const s = (await app.db.query(
            `select u.role, u.status, d.status as dev_status, s.revoked_at, s.expires_at < now() as expired
               from sessions s join users u on u.id=s.user_id left join devices d on d.id=s.device_id where s.token_hash=$1`, [tokenHash])).rows[0];
          if (!s || s.revoked_at || s.expired || s.status !== 'approved' || s.dev_status !== 'approved') {
            res.write(`event: auth\ndata: ${JSON.stringify({ code: s && !s.expired ? 'SESSION_REVOKED' : 'UNAUTHENTICATED' })}\n\n`);
            end();
            return;
          }
          const admin = s.role === 'admin';
          const rows = (await app.db.query('select * from events where tenant_id=$1 and id > $2 order by id limit 500', [tenantId, cursor])).rows;
          const mids = [...new Set(rows.filter((r) => r.audience === 'mission').map((r) => r.mission_id))];
          const ms = mids.length ? new Map((await app.db.query('select id, owner_id, shared, deleted_at, tenant_id from missions where id = any($1::text[])', [mids])).rows.map((m) => [m.id, m])) : new Map();
          for (const r of rows) {
            cursor = String(r.id);
            let ok = false;
            if (r.audience === 'all') ok = true;
            else if (r.audience === 'admins') ok = admin;
            else if (r.audience === 'user') ok = admin || r.audience_user === ctx.user.id;
            else if (r.audience === 'mission') {
              const m = ms.get(r.mission_id);
              ok = !!m && m.tenant_id === tenantId && (r.type === 'mission.deleted' || !m.deleted_at) && (admin || m.owner_id === ctx.user.id || m.shared);
            }
            if (ok) res.write(`id: ${r.id}\nevent: ${r.type}\ndata: ${JSON.stringify(eventDto(r))}\n\n`);
            else res.write(`id: ${r.id}\n: skip\n\n`); // advance the client's Last-Event-ID without content
          }
          if (rows.length === 500) again = true;
        } while (again && open);
      } catch {
        // DB blip: the safety poll retries
      } finally { busy = false; }
    }

    // a real (named) event, so browsers can tell a live link from a dead one; comments are invisible to EventSource
    const hb = setInterval(() => { if (open) res.write(`event: ping\ndata: {"t":${Date.now()}}\n\n`); }, app.cfg.sseHeartbeatMs ?? HEARTBEAT_MS);
    const poll = setInterval(() => void pump(), SAFETY_POLL_MS);
    app.eventBus.on('wake', pump);
    app.eventBus.on('close', end);
    req.raw.on('close', finish);
    void pump();
  });
}
