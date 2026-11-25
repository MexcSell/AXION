import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdmin, requireUser } from '../auth/session.ts';
import { ApiError } from '../errors.ts';
import { tx } from '../db.ts';
import { audit } from '../audit.ts';
import { parse } from '../auth/routes.ts';
import { CHAT_ROUTE_MAX, type ChatModelRouteDto, type ChatUsageDto } from '../../../shared/contracts/src/index.ts';

/**
 * The chat model route (owner 2026-11-25), Settings › AI Chat:
 *  GET  /chat-model          everyone signed in: the order, each model's state and the model the next answer goes to (no tokens, no accounts)
 *  PUT  /chat-model          administrators: {models: [ids]} the preference order (1..20 configured ids, no repeats); {models: null} = the default order
 *  GET  /chat-model/usage    administrators: chat answers per day and model (?days=1..90, default 7), from the audit log (sizes only)
 */
const Put = z.object({ models: z.array(z.string().min(1).max(60)).min(1, 'Choose at least one model.').max(CHAT_ROUTE_MAX).nullable() }).strict();

export default async function chatModelRoutes(app: FastifyInstance) {
  const router = app.modelRouter;

  app.get('/chat-model', async (req): Promise<ChatModelRouteDto> => {
    const ctx = await requireUser(req);
    return { ...(await router.status(app.db, ctx.tenantId)), canEdit: ctx.user.role === 'admin' };
  });

  app.put('/chat-model', async (req): Promise<ChatModelRouteDto> => {
    const ctx = await requireAdmin(req);
    const { models } = parse(Put, req.body);
    if (models) {
      if (new Set(models).size !== models.length) throw new ApiError('VALIDATION', 400, 'A model is listed twice.', { fieldErrors: { models: 'no repeats' } });
      const unknown = models.filter((id) => !router.get(id));
      if (unknown.length) throw new ApiError('VALIDATION', 400, `Not configured on this server: ${unknown.join(', ')}.`, { fieldErrors: { models: 'unknown model' } });
    }
    await tx(app.db, async (c) => {
      if (models) await c.query(`insert into chat_model_routes (tenant_id, models, updated_by) values ($1, $2, $3)
        on conflict (tenant_id) do update set models = excluded.models, updated_by = excluded.updated_by, updated_at = now()`, [ctx.tenantId, models, ctx.user.id]);
      else await c.query('delete from chat_model_routes where tenant_id=$1', [ctx.tenantId]);
      await audit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, action: 'model.chat.route', subject: 'chat', result: 'ok', correlationId: ctx.correlationId, detail: { models: models ?? 'default' } });
    });
    return { ...(await router.status(app.db, ctx.tenantId)), canEdit: true };
  });

  app.get('/chat-model/usage', async (req): Promise<ChatUsageDto> => {
    const ctx = await requireAdmin(req);
    const raw = (req.query as { days?: string }).days;
    const days = raw === undefined ? 7 : /^\d{1,2}$/.test(raw) ? Number(raw) : NaN;
    if (!(days >= 1 && days <= 90)) throw new ApiError('VALIDATION', 400, 'days must be a whole number from 1 to 90.', { fieldErrors: { days: '1..90' } });
    const rows = (await app.db.query(`select to_char(date_trunc('day', at at time zone 'UTC'), 'YYYY-MM-DD') as day, split_part(subject, ':', 1) as model_id,
        count(*)::int as calls, count(*) filter (where result <> 'ok')::int as errors,
        coalesce(sum((detail->>'answered')::int) filter (where result = 'ok'), 0)::int as answered,
        coalesce(sum((detail->>'usageIn')::int), 0)::int as input_tokens, coalesce(sum((detail->>'usageOut')::int), 0)::int as output_tokens,
        count(*) filter (where result = 'ok' and (detail->>'fallback')::boolean)::int as fallbacks
      from audit_events where tenant_id=$1 and action='model.cloud.chat' and at >= now() - make_interval(days => $2)
      group by 1, 2 order by 1 desc, 2`, [ctx.tenantId, days])).rows;
    return { days, rows: rows.map((r) => ({ day: r.day, modelId: r.model_id, calls: r.calls, errors: r.errors, answered: r.answered, inputTokens: r.input_tokens, outputTokens: r.output_tokens })),
      fallbacks: rows.reduce((s, r) => s + r.fallbacks, 0) };
  });
}
