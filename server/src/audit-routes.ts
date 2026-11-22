import type { FastifyInstance } from 'fastify';
import { requireAdmin } from './auth/session.ts';
import { ApiError } from './errors.ts';
import { SlidingWindow } from './ratelimit.ts';
import { verifyChain } from './audit.ts';

/** c31: GET /audit/verify, administrators only. Read-only; a full walk costs a table scan, so it is limited per session. */
export default async function auditRoutes(app: FastifyInstance) {
  const win = new SlidingWindow({ max: 6, windowMs: 60_000 });
  app.get('/audit/verify', async (req, reply) => {
    const ctx = await requireAdmin(req);
    const wait = win.take(ctx.tokenHash);
    if (wait) {
      reply.header('retry-after', String(Math.ceil(wait / 1000)));
      throw new ApiError('RATE_LIMITED', 429, `Too many audit checks from this session. Wait ${Math.ceil(wait / 1000)} s and try again.`, { retryable: true });
    }
    return verifyChain(app.db, ctx.tenantId);
  });
}
