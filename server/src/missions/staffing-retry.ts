import type { FastifyInstance } from 'fastify';
import { requireUser } from '../auth/session.ts';
import { audit } from '../audit.ts';
import { ApiError, forbidden, notFound } from '../errors.ts';
import { idempotent } from '../idempotency.ts';
import { emit } from '../events/hooks.ts';
import { VISIBLE_SQL } from './visibility.ts';

/** Retry a stalled staffing run (c42 fix round 2). Administrator or the mission owner; audited; rate-limited with the governance writes. */
export default async function staffingRetryRoutes(app: FastifyInstance) {
  app.post('/missions/:id/staffing/retry', async (req, reply) => {
    const ctx = await requireUser(req);
    const id = (req.params as { id: string }).id;
    const out = await idempotent(app.db, req, ctx, async (c) => {
      const m = (await c.query(`select m.id, m.owner_id, m.presentation from missions m where m.id=$1 and m.tenant_id=$2 and m.deleted_at is null and ${VISIBLE_SQL('$3', '$4')} for update of m`,
        [id, ctx.tenantId, ctx.user.role === 'admin', ctx.user.id])).rows[0];
      if (!m) throw notFound('No such mission, or it is not shared with you.');
      if (ctx.user.role !== 'admin' && m.owner_id !== ctx.user.id) throw forbidden('Only an administrator or the mission owner can retry staffing.');
      if (!m.presentation?.staffing?.stalled) throw new ApiError('CONFLICT', 409, 'Staffing is not stopped.');
      await c.query(`update missions set presentation = presentation #- '{staffing,stalled}', row_version=row_version+1, updated_at=now() where id=$1`, [id]);
      await audit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, action: 'staffing.retry', subject: id, result: 'ok', correlationId: ctx.correlationId, detail: { previous: m.presentation.staffing.stalled } });
      await emit(c, { tenantId: ctx.tenantId, type: 'staffing.resumed', subject: id, missionId: id, actor: ctx.user.id, correlationId: ctx.correlationId, payload: { by: ctx.user.name } });
      return { status: 200, body: { ok: true } };
    });
    if (out.status === 200 && !(out.body as { replayed?: boolean }).replayed) app.retryStaffing?.(id);
    return reply.status(out.status).send(out.body);
  });
}
