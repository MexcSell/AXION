import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Tx } from '../db.ts';
import { requireUser } from '../auth/session.ts';
import { parse } from '../auth/routes.ts';
import { appendEvent } from '../events/log.ts';
import { badRequest } from '../errors.ts';

export interface NoticeInput { tenantId: string; severity: 'critical' | 'warning' | 'info' | 'success'; category: 'mission' | 'agent' | 'system' | 'approval' | 'evolution'; title: string; body: string; route?: string; missionId?: string; adminsOnly?: boolean; userId?: string; actionable?: boolean }

export async function createNotification(c: Tx, n: NoticeInput) {
  const id = 'n-' + (await c.query(`select nextval('notification_seq') as s`)).rows[0].s;
  const audience = n.adminsOnly ? 'admins' : n.userId ? 'user' : n.missionId ? 'mission' : 'all';
  await c.query(`insert into notifications(id, tenant_id, audience, audience_user, mission_id, severity, category, title, body, route, actionable) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [id, n.tenantId, audience, n.userId ?? null, n.missionId ?? null, n.severity, n.category, n.title, n.body, n.route ?? null, n.actionable ?? false]);
  await appendEvent(c, { tenantId: n.tenantId, type: 'notification.created', subject: { kind: 'notification', id }, missionId: n.missionId, audience, audienceUser: n.userId, payload: { id, title: n.title, severity: n.severity } });
  return id;
}

const NOTICE_ID = /^[A-Za-z0-9-]{1,40}$/;

export default async function notificationRoutes(app: FastifyInstance) {
  app.get('/notifications', async (req) => {
    const ctx = await requireUser(req);
    const admin = ctx.user.role === 'admin';
    const rows = (await app.db.query(
      `select n.* from notifications n left join missions m on m.id = n.mission_id
        where n.tenant_id=$1 and (
          n.audience='all' or (n.audience='admins' and $2::boolean) or (n.audience='user' and (n.audience_user=$3 or $2::boolean))
          or (n.audience='mission' and m.deleted_at is null and ($2::boolean or m.owner_id=$3 or m.shared)))
        order by n.created_at desc limit 200`, [ctx.tenantId, admin, ctx.user.id])).rows;
    const read = (await app.db.query('select notice_id from notification_reads where tenant_id=$1 and user_id=$2', [ctx.tenantId, ctx.user.id])).rows.map((r) => r.notice_id);
    const now = Date.now();
    return {
      notifications: rows.map((r) => ({ id: r.id, severity: r.severity, category: r.category, title: r.title, body: r.body, route: r.route ?? undefined, missionId: r.mission_id ?? undefined, actionable: r.actionable, agoMin: Math.max(0, Math.round((now - new Date(r.created_at).getTime()) / 60000)), createdAt: new Date(r.created_at).getTime() })),
      read,
    };
  });

  const ack = async (tenantId: string, userId: string, ids: string[]) => {
    if (!ids.length) return;
    await app.db.query(`insert into notification_reads(tenant_id, user_id, notice_id) select $1, $2, unnest($3::text[]) on conflict do nothing`, [tenantId, userId, ids]);
  };

  app.post('/notifications/:id/ack', async (req) => {
    const ctx = await requireUser(req);
    const { id } = req.params as { id: string };
    if (!NOTICE_ID.test(id)) throw badRequest('Unknown notice.');
    await ack(ctx.tenantId, ctx.user.id, [id]);
    return { ok: true };
  });

  app.post('/notifications/ack-all', async (req) => {
    const ctx = await requireUser(req);
    const b = parse(z.object({ ids: z.array(z.string().regex(NOTICE_ID)).max(1000) }), req.body);
    await ack(ctx.tenantId, ctx.user.id, b.ids);
    return { ok: true };
  });
}
