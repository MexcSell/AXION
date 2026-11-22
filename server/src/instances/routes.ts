import type { FastifyInstance } from 'fastify';
import { requireUser } from '../auth/session.ts';
import { getVisibleRow } from '../missions/service.ts';
import { badRequest } from '../errors.ts';
import { getInstance, hierarchy, listInstancesPage, missionTasks } from './service.ts';

export default async function instanceRoutes(app: FastifyInstance) {
  app.get('/missions/:id/hierarchy', async (req) => {
    const ctx = await requireUser(req);
    const m = await getVisibleRow(app.db, ctx, (req.params as { id: string }).id);
    return hierarchy(app.db, m.id);
  });
  app.get('/missions/:id/tasks', async (req) => {
    const ctx = await requireUser(req);
    const m = await getVisibleRow(app.db, ctx, (req.params as { id: string }).id);
    return missionTasks(app.db, m.id);
  });
  app.get('/agent-instances', async (req) => {
    const ctx = await requireUser(req);
    const q = req.query as { agentId?: string; limit?: string; before?: string };
    const num = (v: string | undefined, f: string, min: number) => {
      if (v === undefined) return undefined;
      if (!/^\d{1,18}$/.test(v) || Number(v) < min) throw badRequest('Some fields are not valid.', { [f]: 'must be a whole number' });
      return Number(v);
    };
    return listInstancesPage(app.db, ctx, typeof q.agentId === 'string' && q.agentId ? q.agentId : undefined, { limit: num(q.limit, 'limit', 1), before: num(q.before, 'before', 0) });
  });
  app.get('/agent-instances/:id', async (req) => {
    const ctx = await requireUser(req);
    return { instance: await getInstance(app.db, ctx, (req.params as { id: string }).id) };
  });
}
