import type { FastifyInstance } from 'fastify';
import { tx } from '../db.ts';
import { requireUser } from '../auth/session.ts';
import { buildAttention } from './build.ts';

/**
 * Improvement cycle 68 (R3-9): the operator attention queue. Read only and open to every signed-in person; each row passes the same
 * visibility rule as the route it comes from, so a member never sees more here than the source screens show them.
 */
export default async function attentionRoutes(app: FastifyInstance) {
  app.get('/attention', async (req) => {
    const ctx = await requireUser(req);
    return tx(app.db, (c) => buildAttention(c, { tenantId: ctx.tenantId, user: ctx.user }));
  });
}
