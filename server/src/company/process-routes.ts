import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth/session.ts';
import { parse } from '../auth/routes.ts';
import { notFound } from '../errors.ts';
import { STALE_BEFORE_SQL } from '../tasks/reviews.ts';
import { VISIBLE_SQL } from '../missions/visibility.ts';
import { FAILURE_TAXONOMY_VERSION, PROCESS_WINDOWS } from '../../../shared/contracts/src/index.ts';
import { computeProcess, type ProcInput } from './process.ts';
import { dbWindow, snapshotTx } from './clock.ts';

const QueryIn = z.object({ window: z.enum(PROCESS_WINDOWS).default('30d'), department: z.string().trim().min(1).max(80).optional() }).strict();

/**
 * Improvement cycle 69 (R3-5): GET /company/process?window=7d|30d|90d&department=. Any signed-in user. A read only: there is no write route.
 * DEMO missions and simulated rows are never read (no includeDemo switch). Every mission-scoped table is read only for the missions the caller
 * can see (the scorecard's predicate). One REPEATABLE READ transaction, one database clock: SQL bounds are `<= now()`, and the hand-off wait is
 * computed in SQL (first started attempt minus the delegation time), never from a JS Date.
 */
export default async function processRoutes(app: FastifyInstance) {
  app.get('/company/process', async (req) => {
    const ctx = await requireUser(req);
    const qs = parse(QueryIn, req.query ?? {});
    const T = ctx.tenantId;
    return snapshotTx(app.db, async (c) => {
      const w = await dbWindow(c, qs.window);
      // the previous window is 2 windows back at most; a lower SQL bound is only a superset, the pure function places each row by its own time
      const sinceMs = 2 * (w.to.getTime() - w.from.getTime()) + 2;
      const missions = (await c.query(
        `select m.id, m.demo from missions m where m.tenant_id=$1 and m.deleted_at is null and ${VISIBLE_SQL('$2', '$3')} and not m.demo`,
        [T, ctx.user.role === 'admin', ctx.user.id])).rows;
      const ids = missions.map((m) => m.id as string);
      const E = { rows: [] as Record<string, any>[] };
      const q = (sql: string, p: unknown[]) => (ids.length ? c.query(sql, p) : Promise.resolve(E));
      const D = (x: unknown) => new Date(x as string);
      // one client runs one query at a time: awaited in order
      const agents = (await c.query(`select id, dept, status from agent_definitions where tenant_id=$1`, [T])).rows;
      const tasks = await q(`select t.id, t.mission_id, coalesce(i.agent_id, t.owner_agent) as owner, t.status, t.simulated from tasks t left join agent_instances i on i.id = t.owner_instance_id
          where t.tenant_id=$1 and t.mission_id = any($2::text[])`, [T, ids]);
      const reviews = await q(`select r.task_id, r.mission_id, r.verdict, r.created_at, r.seq, t.simulated, (${STALE_BEFORE_SQL('r')} is not null) as stale,
            (select count(*) from jsonb_array_elements(r.rubric) x where x->>'result' = 'fail')::int as failed
          from task_reviews r join tasks t on t.id = r.task_id where r.tenant_id=$1 and r.mission_id = any($2::text[]) and r.created_at <= now()`, [T, ids]);
      const tags = await q(`select subject_id, mode_id, coalesce(decided_at, created_at) as at from failure_tags
          where tenant_id=$1 and mission_id = any($2::text[]) and subject_kind='task' and status='confirmed' and taxonomy_version=$3`, [T, ids, FAILURE_TAXONOMY_VERSION]);
      // the staffing simulator writes a brief for every agent it places (created_by 'system', simulated false on a real mission); those are not a delegation decision, and several share a fallback goal
      const briefs = await q(`select b.id::text as id, b.mission_id, b.to_agent, b.brief->>'goal' as goal, b.created_at, b.supersedes_id::text as supersedes_id, b.simulated from delegation_briefs b
          where b.tenant_id=$1 and b.mission_id = any($2::text[]) and b.created_at <= now()
           and b.created_by <> 'system'`, [T, ids]);
      const history = await q(`select h.task_id, h.agent_id, h.at, h.seq from task_owner_history h join tasks t on t.id = h.task_id
          where h.tenant_id=$1 and t.mission_id = any($2::text[]) and h.at <= now()`, [T, ids]);
      const handoffs = await q(`select d.mission_id, d.task_id, i.agent_id as to_agent, d.at, d.simulated,
            extract(epoch from (select min(a.started_at) from task_attempts a where a.task_id = d.task_id and a.started_at >= d.at and a.started_at <= now()) - d.at)::float8 as wait_s
          from mission_delegations d join agent_instances i on i.id = d.to_instance
         where i.tenant_id=$1 and d.mission_id = any($2::text[]) and d.edge_kind='delegated' and d.task_id is not null
           and d.at <= now() and d.at >= now() - ($3::double precision * interval '1 millisecond')`, [T, ids, sinceMs]);
      const input: ProcInput = {
        agents: agents.map((a) => ({ id: a.id, dept: a.dept, active: a.status === 'active' })),
        missions: missions.map((m) => ({ id: m.id, demo: m.demo })),
        tasks: tasks.rows.map((t) => ({ id: t.id, missionId: t.mission_id, owner: t.owner, status: t.status, simulated: t.simulated })),
        reviews: reviews.rows.map((r) => ({ taskId: r.task_id, missionId: r.mission_id, verdict: r.verdict, at: D(r.created_at), seq: Number(r.seq), stale: !!r.stale, failedCriteria: Number(r.failed), simulated: r.simulated })),
        tags: tags.rows.map((g) => ({ taskId: g.subject_id, modeId: g.mode_id, at: D(g.at) })),
        briefs: briefs.rows.map((b) => ({ id: b.id, missionId: b.mission_id, toAgent: b.to_agent, goal: typeof b.goal === 'string' ? b.goal : null, at: D(b.created_at), supersedesId: b.supersedes_id, simulated: b.simulated })),
        ownerHistory: history.rows.map((h) => ({ taskId: h.task_id, agentId: h.agent_id, at: D(h.at), seq: Number(h.seq) })),
        handoffs: handoffs.rows.map((h) => ({ missionId: h.mission_id, taskId: h.task_id, toAgent: h.to_agent, at: D(h.at), waitSeconds: h.wait_s === null ? null : Number(h.wait_s), simulated: h.simulated })),
      };
      const departments = new Set(input.agents.filter((a) => a.active).map((a) => a.dept));
      if (qs.department && !departments.has(qs.department)) throw notFound('No such department.');
      return computeProcess(input, { window: qs.window, from: w.from, to: w.to, department: qs.department ?? null });
    });
  });
}
