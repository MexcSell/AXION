import type { FastifyInstance } from 'fastify';
import { requireUser } from '../auth/session.ts';
import { guardRows, PROMOTION_NOTE, type MetricGuardDto } from '../../../shared/contracts/src/index.ts';

/**
 * Improvement cycle 66 (R3-4): GET /company/metric-guard. Any signed-in user. The row registry (counter-metric, uncovered quality
 * dimensions, inputs) plus the derived "gameable" flag. Static metadata: it reads no table and writes nothing.
 */
export default async function metricGuardRoutes(app: FastifyInstance) {
  app.get('/company/metric-guard', async (req): Promise<MetricGuardDto> => {
    await requireUser(req);
    return { rows: guardRows(), promotionNote: PROMOTION_NOTE };
  });
}
