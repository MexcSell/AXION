import type { FastifyInstance } from 'fastify';
import { requireUser, requireAdmin } from '../auth/session.ts';
import { parse } from '../auth/routes.ts';
import { idempotent } from '../idempotency.ts';
import { ForecastIn, recordForecast, assertVisible, loadLedger, forecasterOf } from './ledger.ts';
import type { ForecastLedgerDto } from '../../../shared/contracts/src/index.ts';

/**
 * Improvement cycle 86 (R5-7). POST /tasks/:id/forecasts: any signed-in person who can see the task. GET /me/forecasts: your own record.
 * GET /users/:id/forecasts: administrators only, ONE person at a time. No route lists forecasters, and none orders people by a score.
 */
export default async function forecastRoutes(app: FastifyInstance) {
  app.post('/tasks/:id/forecasts', async (req, reply) => {
    const ctx = await requireUser(req);
    const { id } = req.params as { id: string };
    const body = parse(ForecastIn, req.body);
    const out = await idempotent(app.db, req, ctx, async (c) => ({ status: 201, body: await recordForecast(c, ctx, id, body) }), (c) => assertVisible(c, ctx, id));
    return reply.status(out.status).send(out.body);
  });

  app.get('/me/forecasts', async (req): Promise<ForecastLedgerDto> => {
    const ctx = await requireUser(req);
    return loadLedger(app.db, ctx, { id: ctx.user.id, name: ctx.user.name });
  });

  app.get('/users/:id/forecasts', async (req): Promise<ForecastLedgerDto> => {
    const ctx = await requireAdmin(req);
    const who = await forecasterOf(app.db, ctx.tenantId, (req.params as { id: string }).id);
    return loadLedger(app.db, ctx, who);
  });
}
