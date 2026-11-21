import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth/session.ts';
import { parse } from '../auth/routes.ts';
import { VISIBLE_SQL } from '../missions/visibility.ts';
import { SCORECARD_WINDOWS } from '../../../shared/contracts/src/index.ts';
import { computeScorecard, windowOf } from './scorecard.ts';

const QueryIn = z.object({ window: z.enum(SCORECARD_WINDOWS).default('30d'), includeDemo: z.enum(['0', '1']).default('0') });

/**
 * Improvement cycle 2: GET /company/scorecard. Any signed-in user; it counts only the missions the caller can see
 * (same rule as the mission list: tenant, not deleted, VISIBLE_SQL), DEMO missions only with includeDemo=1.
 * Every other table is read only for those missions, so a private mission never leaks through a count.
 */
export default async function companyRoutes(app: FastifyInstance) {
  app.get('/company/scorecard', async (req) => {
    const ctx = await requireUser(req);
    const qs = parse(QueryIn, req.query ?? {});
    const w = windowOf(qs.window);
    const includeDemo = qs.includeDemo === '1';
    const db = app.db;
    const missions = (await db.query(
      `select m.id, m.owner_id from missions m where m.tenant_id=$1 and m.deleted_at is null and ${VISIBLE_SQL('$2', '$3')} and ($4::boolean or not m.demo)`,
      [ctx.tenantId, ctx.user.role === 'admin', ctx.user.id, includeDemo])).rows;
    const ids = missions.map((m) => m.id as string);
    const T = ctx.tenantId;
    const [runs, transitions, tasks, attempts, decisions, delegations] = ids.length ? await Promise.all([
      db.query(`select mission_id, min(started_at) as started_at from mission_runs where mission_id = any($1::text[]) group by mission_id`, [ids]),
      db.query(`select mission_id, payload->>'from' as f, payload->>'to' as t, occurred_at from events
                 where tenant_id=$1 and type='mission.stateChanged' and mission_id = any($2::text[]) and occurred_at <= $3 order by id`, [T, ids, w.to]),
      db.query(`select id, mission_id, status, simulated from tasks where tenant_id=$1 and mission_id = any($2::text[])`, [T, ids]),
      db.query(`select a.task_id, a.attempt_no, a.started_at, a.finished_at from task_attempts a join tasks t on t.id=a.task_id
                 where t.tenant_id=$1 and t.mission_id = any($2::text[])`, [T, ids]),
      db.query(`select r.mission_id, d.decision, d.decided_by, d.decided_at, (u.id is not null) as human
                  from approval_decisions d join approval_requests r on r.id=d.approval_id
                  left join users u on u.id=d.decided_by and u.tenant_id=r.tenant_id
                 where r.tenant_id=$1 and r.mission_id = any($2::text[])`, [T, ids]),
      db.query(`select mission_id, edge_kind, simulated from mission_delegations where mission_id = any($1::text[]) and edge_kind='verifies'`, [ids]),
    ]).then((rs) => rs.map((r) => r.rows)) : [[], [], [], [], [], []];
    return computeScorecard({
      missions: missions.map((m) => ({ id: m.id, ownerId: m.owner_id })),
      runs: runs.filter((r) => r.started_at).map((r) => ({ missionId: r.mission_id, startedAt: new Date(r.started_at) })),
      transitions: transitions.filter((e) => e.f && e.t).map((e) => ({ missionId: e.mission_id, from: e.f, to: e.t, at: new Date(e.occurred_at) })),
      tasks: tasks.map((t) => ({ id: t.id, missionId: t.mission_id, status: t.status, simulated: t.simulated })),
      attempts: attempts.map((a) => ({ taskId: a.task_id, attemptNo: a.attempt_no, startedAt: a.started_at ? new Date(a.started_at) : null, finishedAt: a.finished_at ? new Date(a.finished_at) : null })),
      decisions: decisions.map((d) => ({ missionId: d.mission_id, decision: d.decision, decidedBy: d.decided_by, human: d.human, at: new Date(d.decided_at) })),
      delegations: delegations.map((d) => ({ missionId: d.mission_id, edgeKind: d.edge_kind, simulated: d.simulated })),
    }, { ...w, includeDemo });
  });
}
