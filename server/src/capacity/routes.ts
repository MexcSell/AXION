import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdmin, requireUser } from '../auth/session.ts';
import { parse } from '../auth/routes.ts';
import { DEFAULT_WINDOW_DAYS, MIN_PERCENTILE_N, WINDOWS, reviewCapacity, reviewPeople } from './model.ts';

// Strict on purpose: no sort, order, filter or person parameter exists, so the view cannot be turned into a ranking, and only the three fixed
// windows exist so a member cannot difference two windows to isolate single items.
const Q = z.object({ windowDays: z.coerce.number().pipe(z.union([z.literal(WINDOWS[0]), z.literal(WINDOWS[1]), z.literal(WINDOWS[2])])).default(DEFAULT_WINDOW_DAYS) }).strict();

/** c65 (R3-10): read-only review-capacity view. Aggregates for everyone (with the c58 floor for non-administrators), per-person rows for administrators only. */
export default async function capacityRoutes(app: FastifyInstance) {
  app.get('/review-capacity', async (req) => {
    const ctx = await requireUser(req);
    const q = parse(Q, req.query ?? {});
    return { review: await reviewCapacity(app.db, ctx.tenantId, q.windowDays, ctx.user.role === 'admin') };
  });
  app.get('/review-capacity/people', async (req) => {
    const ctx = await requireAdmin(req);
    const q = parse(Q, req.query ?? {});
    return { windowDays: q.windowDays, minPercentileN: MIN_PERCENTILE_N, people: await reviewPeople(app.db, ctx.tenantId, q.windowDays) };
  });
}
