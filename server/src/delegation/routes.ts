import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser, type Ctx } from '../auth/session.ts';
import { parse } from '../auth/routes.ts';
import { idempotent } from '../idempotency.ts';
import { notFound } from '../errors.ts';
import { VISIBLE_SQL } from '../missions/visibility.ts';
import type { Tx, Db } from '../db.ts';
import { MAX_CHAIN_DEPTH } from './brief.ts';
import { createBrief, briefDto, listBriefs, delegableKinds } from './service.ts';

const NewBriefIn = z.object({
  toInstanceId: z.string().min(1).max(120), fromInstanceId: z.string().min(1).max(120).optional(), taskId: z.string().min(1).max(120).optional(),
  supersedes: z.string().min(1).max(60).optional(), brief: z.unknown(),
}).strict();

async function visibleMission(c: Tx | Db, ctx: Ctx, id: string) {
  const r = (await c.query(`select m.id from missions m where m.id=$1 and m.tenant_id=$2 and m.deleted_at is null and ${VISIBLE_SQL('$3', '$4')}`, [id, ctx.tenantId, ctx.user.role === 'admin', ctx.user.id])).rows[0];
  if (!r) throw notFound('No such mission, or it is not shared with you.');
}

/** Typed delegation briefs (c42). Writes are append-only; there is no update or delete route. */
export default async function delegationRoutes(app: FastifyInstance) {
  app.get('/missions/:id/delegation-briefs', async (req) => {
    const ctx = await requireUser(req);
    const id = (req.params as { id: string }).id;
    await visibleMission(app.db, ctx, id);
    return { briefs: await listBriefs(app.db, id), maxDepth: MAX_CHAIN_DEPTH, kinds: delegableKinds({ id: ctx.user.id, role: ctx.user.role }, id) };
  });

  app.post('/missions/:id/delegation-briefs', async (req, reply) => {
    const ctx = await requireUser(req);
    const id = (req.params as { id: string }).id;
    const body = parse(NewBriefIn, req.body);
    const out = await idempotent(app.db, req, ctx, async (c) => {
      await visibleMission(c, ctx, id);
      const row = await createBrief(c, { tenantId: ctx.tenantId, missionId: id, toInstanceId: body.toInstanceId, fromInstanceId: body.fromInstanceId, taskId: body.taskId, supersedes: body.supersedes,
        brief: body.brief, actor: { id: ctx.user.id, role: ctx.user.role, name: ctx.user.name }, correlationId: ctx.correlationId });
      return { status: 201, body: { brief: briefDto(row) } };
    }, async (c) => { await visibleMission(c, ctx, id); });
    return reply.status(out.status).send(out.body);
  });
}
