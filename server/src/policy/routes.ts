import type { FastifyInstance } from 'fastify';
import { requireAdmin } from '../auth/session.ts';
import { CURRENT_BASELINE, approverFor } from './baseline.ts';
import { TIERS } from './types.ts';

/** Read-only view of the frozen baseline policy, for the UI `?` help. There is no write route (invariant 10). */
export default async function policyRoutes(app: FastifyInstance) {
  app.get('/policy/baseline', async (req) => {
    await requireAdmin(req);
    const p = CURRENT_BASELINE;
    return {
      version: p.version, source: p.source, tiers: TIERS,
      kinds: Object.entries(p.kinds).map(([kind, k]) => ({ kind, tier: k.tier, effect: k.effect, approver: approverFor(k.tier), ...(approverFor(k.tier) === 'owner' ? { heldBy: 'admin', note: 'No separate owner role exists yet: an administrator decides as owner.' } : {}), prohibited: k.prohibited ?? null, why: k.why })),
    };
  });
}
