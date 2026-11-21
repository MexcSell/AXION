import type { FastifyInstance } from 'fastify';
import { requireUser } from '../auth/session.ts';
import { getVisibleRow } from '../missions/service.ts';
import { getInstance, hierarchy, listInstances, missionTasks } from './service.ts';

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
    const a = (req.query as { agentId?: string }).agentId;
    return { instances: await listInstances(app.db, ctx, typeof a === 'string' && a ? a : undefined) };
  });
  app.get('/agent-instances/:id', async (req) => {
    const ctx = await requireUser(req);
    return { instance: await getInstance(app.db, ctx, (req.params as { id: string }).id) };
  });
}
