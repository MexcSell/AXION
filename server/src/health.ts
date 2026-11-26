// GET /api/v1/health: the deploy contract the Guard judges every slot by (evolve step 1). The Guard's boot, smoke, switch
// and watch read `ok` (the database answers), `commit` (AXION_COMMIT, the image's commit) and `leader` (this process holds
// the leader lock). Kept in its own file so that it can be protected (evolve/protected.txt): an ordinary change to
// app.ts cannot change what the Guard sees.
import type { FastifyInstance } from 'fastify';
import type { Db } from './db.ts';
import type { Leader } from './leader.ts';
import { VERSION } from './config.ts';

export function registerHealth(app: FastifyInstance, deps: { db: Db; commit: string | null | undefined; leader: Leader }): void {
  const { db, commit, leader } = deps;
  app.get('/api/v1/health', async () => {
    let up = false;
    try { await db.query('select 1'); up = true; } catch { /* reported below */ }
    return { ok: up, db: up ? 'up' : 'down', version: VERSION, commit: commit ?? null, leader: leader.isLeader() };
  });
}
