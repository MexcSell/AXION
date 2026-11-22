import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth/session.ts';
import { parse } from '../auth/routes.ts';
import { SCORECARD_WINDOWS } from '../../../shared/contracts/src/index.ts';
import { dbWindow, snapshotTx } from './clock.ts';
import { departmentFacts, loadDeptRows } from './departments.ts';

const QueryIn = z.object({ window: z.enum(SCORECARD_WINDOWS).default('30d'), includeDemo: z.enum(['0', '1']).default('0') });

/**
 * Improvement cycle 6: GET /departments. Any signed-in user; counts only the missions the caller can see (tenant, not
 * deleted, VISIBLE_SQL, DEMO missions only with includeDemo=1) in every mission-scoped query (see loadDeptRows).
 */
export default async function departmentRoutes(app: FastifyInstance) {
  app.get('/departments', async (req) => {
    const ctx = await requireUser(req);
    const qs = parse(QueryIn, req.query ?? {});
    const includeDemo = qs.includeDemo === '1';
    return snapshotTx(app.db, async (c) => {
      const w = await dbWindow(c, qs.window);
      const rows = await loadDeptRows(c, { tenantId: ctx.tenantId, admin: ctx.user.role === 'admin', userId: ctx.user.id }, includeDemo);
      return departmentFacts(rows, { ...w, includeDemo });
    });
  });
}
