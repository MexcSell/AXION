import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdmin } from '../auth/session.ts';
import { parse } from '../auth/routes.ts';
import { idempotent } from '../idempotency.ts';
import { audit } from '../audit.ts';
import { recordHalt } from '../jobs/run-halts.ts';
import { HALT_REASON_MAX, HALT_SCOPES, HALT_TARGET_RE, type HaltDto, type HaltRecordDto, type HaltsDto } from '../../../shared/contracts/src/index.ts';

/**
 * Phase A (A2). Administrators only. POST /operations/halts sets or lifts a halt (a new row; rows are never edited) and audits it; GET lists the halts
 * that are active now and the last 100 rows. A halt STOPS runs; nothing here starts or runs anything, and no run exists yet.
 */
const HaltIn = z.object({
  scope: z.enum(HALT_SCOPES),
  target: z.string().trim().max(120).optional(),
  halted: z.boolean(),
  reason: z.string().trim().min(1).max(HALT_REASON_MAX),
}).strict().superRefine((b, ctx) => {
  if (b.scope === 'global' && b.target) ctx.addIssue({ code: 'custom', path: ['target'], message: 'The global scope has no target.' });
  if (b.scope !== 'global' && !(b.target && HALT_TARGET_RE.test(b.target))) ctx.addIssue({ code: 'custom', path: ['target'], message: 'Name the class or the run (letters, digits and . _ : - only).' });
});

const SELECT = `select h.id, h.scope, h.target, h.halted, h.reason, h.created_by, h.created_at, u.name as created_by_name
  from run_halts h left join users u on u.id = h.created_by and u.tenant_id = h.tenant_id`;
function dto(r: Record<string, any>): HaltDto {
  return { id: Number(r.id), scope: r.scope, target: r.target, halted: r.halted, reason: r.reason, createdBy: r.created_by, createdByName: r.created_by_name ?? null, createdAt: new Date(r.created_at).toISOString() };
}

export default async function haltRoutes(app: FastifyInstance) {
  app.get('/operations/halts', async (req): Promise<HaltsDto> => {
    const ctx = await requireAdmin(req);
    const active = (await app.db.query(
      `${SELECT} where h.tenant_id = $1 and h.halted and h.id in (select distinct on (scope, target) id from run_halts where tenant_id = $1 order by scope, target, id desc)
        order by case h.scope when 'global' then 0 when 'class' then 1 else 2 end, h.target`, [ctx.tenantId])).rows;
    const recent = (await app.db.query(`${SELECT} where h.tenant_id = $1 order by h.id desc limit 100`, [ctx.tenantId])).rows;
    return { active: active.map(dto), recent: recent.map(dto) };
  });

  app.post('/operations/halts', async (req, reply) => {
    const ctx = await requireAdmin(req);
    const b = parse(HaltIn, req.body);
    const out = await idempotent(app.db, req, ctx, async (c) => {
      const target = b.scope === 'global' ? '' : b.target!;
      const row = await recordHalt(c, ctx.tenantId, { scope: b.scope, target, halted: b.halted, reason: b.reason, createdBy: ctx.user.id });
      await audit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, action: b.halted ? 'run.halt.set' : 'run.halt.lift', subject: b.scope === 'global' ? 'global' : `${b.scope}:${target}`, result: 'ok', correlationId: ctx.correlationId, detail: { scope: b.scope, target, halted: b.halted, reason: b.reason, haltId: row.id } });
      const body: HaltRecordDto = { halt: { id: row.id, scope: row.scope, target: row.target, halted: row.halted, reason: row.reason, createdBy: row.createdBy, createdByName: ctx.user.name, createdAt: row.createdAt } };
      return { status: 201, body };
    });
    return reply.status(out.status).send(out.body);
  });
}
