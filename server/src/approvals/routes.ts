import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { tx } from '../db.ts';
import { audit } from '../audit.ts';
import { ApiError, notFound } from '../errors.ts';
import { requireUser } from '../auth/session.ts';
import { parse } from '../auth/routes.ts';
import { emit } from '../events/hooks.ts';
import { VISIBLE_SQL } from '../missions/visibility.ts';
import { approvalDto, decideRefusal, rowDigest, settleMission, sweepExpired } from './service.ts';
import { tx as txRun } from '../db.ts';

export default async function approvalRoutes(app: FastifyInstance) {
  app.get('/approvals', async (req) => {
    const ctx = await requireUser(req);
    const released = await txRun(app.db, (c) => sweepExpired(c, ctx.tenantId));
    released.forEach((id) => app.onMissionChanged?.(id, 'running'));
    // expired requests are history: they can't be decided any more, so they leave the list
    const rows = (await app.db.query(
      `select a.*, (a.expires_at < now()) as db_expired, du.name as decided_by_name from approval_requests a join missions m on m.id=a.mission_id
        left join lateral (select decided_by from approval_decisions d where d.approval_id=a.id order by d.decided_at desc limit 1) dd on true
        left join users du on du.id=dd.decided_by
        where a.tenant_id=$1 and m.deleted_at is null and ${VISIBLE_SQL('$2', '$3')} and a.state <> 'expired' and not (a.state='pending' and a.expires_at <= now())
        order by a.created_at desc, a.id desc`,
      [ctx.tenantId, ctx.user.role === 'admin', ctx.user.id])).rows;
    return { approvals: rows.map((r) => approvalDto(r, Date.now(), ctx.user)) };
  });

  app.post('/approvals/:id/decision', async (req) => {
    const ctx = await requireUser(req);
    const { id } = req.params as { id: string };
    const b = parse(z.object({ decision: z.enum(['approved', 'denied']), digest: z.string().max(128), reason: z.string().max(1000).default('') }), req.body);
    const out = await tx(app.db, async (c) => {
      const a = (await c.query(
        `select a.*, (a.expires_at < now()) as db_expired, m.status as mission_status from approval_requests a join missions m on m.id=a.mission_id
          where a.id=$1 and a.tenant_id=$2 and m.deleted_at is null and ${VISIBLE_SQL('$3', '$4')} for update of a, m`,
        [id, ctx.tenantId, ctx.user.role === 'admin', ctx.user.id])).rows[0];
      if (!a) throw notFound('No such approval, or its mission is not shared with you.');
      // one policy path for refusing and for the canDecide flag the lists show (decideRefusal)
      const refusal = decideRefusal(a, ctx.user);
      if (refusal && refusal.reason !== 'expired') throw new ApiError(refusal.code, refusal.status, refusal.message);
      if (refusal) {
        if (a.state === 'pending') { await c.query(`update approval_requests set state='expired' where id=$1`, [id]); await settleMission(c, ctx.tenantId, a.mission_id, ctx.correlationId); }
        return { stale: refusal.message };
      }
      // the stored digest must still match the row, and the client must have seen it (the client's value is only compared, never used)
      if (rowDigest(a) !== a.action_digest || b.digest !== a.action_digest) return { stale: 'This request changed since you opened it. Review it again.' };
      // compare-and-set: only a still-pending request can be decided (axor execution-gateway pattern)
      const u = await c.query(`update approval_requests set state=$2 where id=$1 and state='pending' returning id`, [id, b.decision]);
      if (!u.rowCount) throw new ApiError('APPROVAL_ALREADY_DECIDED', 409, 'Someone already decided this request.');
      await c.query(`insert into approval_decisions(approval_id, decision, reason, digest, decided_by) values ($1,$2,$3,$4,$5)`, [id, b.decision, b.reason, b.digest, ctx.user.id]);
      await audit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, action: 'approval.decide', subject: id, result: 'ok', correlationId: ctx.correlationId, detail: { decision: b.decision, mission: a.mission_id } });
      await emit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, correlationId: ctx.correlationId, type: 'approval.decided', subject: a.mission_id, missionId: a.mission_id, payload: { approvalId: id, decision: b.decision, by: ctx.user.name } });
      const released = await settleMission(c, ctx.tenantId, a.mission_id, ctx.correlationId);
      return { released, missionId: a.mission_id as string, approval: approvalDto((await c.query(`select a.*, (a.expires_at < now()) as db_expired, du.name as decided_by_name from approval_requests a
          left join lateral (select decided_by from approval_decisions d where d.approval_id=a.id order by d.decided_at desc limit 1) dd on true
          left join users du on du.id=dd.decided_by where a.id=$1`, [id])).rows[0], Date.now(), ctx.user) };
    });
    if ('stale' in out) throw new ApiError('APPROVAL_STALE', 409, out.stale!);
    if (out.released) app.onMissionChanged?.(out.missionId, 'running'); // unfinished staffing continues
    return { approval: out.approval };
  });
}
