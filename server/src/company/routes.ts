import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth/session.ts';
import { parse } from '../auth/routes.ts';
import type { Tx } from '../db.ts';
import { VISIBLE_SQL } from '../missions/visibility.ts';
import { SCORECARD_WINDOWS } from '../../../shared/contracts/src/index.ts';
import { STALE_FLAG, STALE_JOINS } from './stale.ts';
import { dbNow, dbWindow, snapshotTx } from './clock.ts';
import { computeScorecard, computeThroughput, THROUGHPUT_WEEKS_MAX, type ScoreInput } from './scorecard.ts';

const ThroughputIn = z.object({ weeks: z.coerce.number().int().min(1).max(THROUGHPUT_WEEKS_MAX).default(8), includeDemo: z.enum(['0', '1']).default('0') });
const QueryIn = z.object({ window: z.enum(SCORECARD_WINDOWS).default('30d'), includeDemo: z.enum(['0', '1']).default('0') });

/**
 * Improvement cycle 2: GET /company/scorecard. Any signed-in user; it counts only the missions the caller can see
 * (same rule as the mission list: tenant, not deleted, VISIBLE_SQL), DEMO missions only with includeDemo=1.
 * Every other table is read only for those missions, so a private mission never leaks through a count.
 */
/** The rows both company routes read: only missions the caller can see, every other table only for those missions. */
/**
 * c71 (P6): what each route needs, and no more. `throughput` uses only missions, first runs and transitions (its weekly counts never read a
 * task, attempt, decision, delegation or review), so it skips those four reads. For `scorecard`: attempts are loaded only for tasks with more
 * than one (the only tasks recovery ever looks at), and a review's freshness (the c51 rule, STALE_BEFORE_SQL) comes from one lateral join
 * on the task's latest attempt instead of three correlated sub-selects per review. Same numbers: test/c71-equivalence.test.ts.
 */
export async function loadInput(db: Tx, ctx: Awaited<ReturnType<typeof requireUser>>, includeDemo: boolean, need: 'scorecard' | 'throughput' = 'scorecard'): Promise<ScoreInput> {
    const missions = (await db.query(
      `select m.id, m.owner_id from missions m where m.tenant_id=$1 and m.deleted_at is null and ${VISIBLE_SQL('$2', '$3')} and ($4::boolean or not m.demo)`,
      [ctx.tenantId, ctx.user.role === 'admin', ctx.user.id, includeDemo])).rows;
    const ids = missions.map((m) => m.id as string);
    const T = ctx.tenantId;
    // one client runs one query at a time (node-postgres will stop queueing concurrent ones): await them in order
    const fs: (() => Promise<{ rows: any[] }>)[] = ids.length ? [
      () => db.query(`select mission_id, min(started_at) as started_at from mission_runs where mission_id = any($1::text[]) group by mission_id`, [ids]),
      () => db.query(`select mission_id, payload->>'from' as f, payload->>'to' as t, occurred_at from events
                 where tenant_id=$1 and type='mission.stateChanged' and mission_id = any($2::text[]) and occurred_at <= now() order by id`, [T, ids]),
      () => db.query(`select id, mission_id, status, simulated from tasks where tenant_id=$1 and mission_id = any($2::text[])`, [T, ids]),
      () => db.query(`select a.task_id, a.attempt_no, a.started_at, a.finished_at from (
                 select x.task_id, x.attempt_no, x.started_at, x.finished_at, count(*) over (partition by x.task_id) as n
                   from task_attempts x join tasks t on t.id=x.task_id where t.tenant_id=$1 and t.mission_id = any($2::text[])) a where a.n > 1`, [T, ids]),
      () => db.query(`select r.mission_id, d.decision, d.decided_by, d.decided_at, (u.id is not null) as human
                  from approval_decisions d join approval_requests r on r.id=d.approval_id
                  left join users u on u.id=d.decided_by and u.tenant_id=r.tenant_id
                 where r.tenant_id=$1 and r.mission_id = any($2::text[])`, [T, ids]),
      () => db.query(`select mission_id, edge_kind, simulated from mission_delegations where mission_id = any($1::text[]) and edge_kind='verifies'`, [ids]),
      () => db.query(`select r.task_id, r.mission_id, r.verdict, r.reviewer_id, r.producer_id, r.principal_id, jsonb_array_length(r.evidence) as ev, r.created_at, r.seq, ${STALE_FLAG('r')} as stale
                  from task_reviews r
                  ${STALE_JOINS('r')}
                 where r.tenant_id=$1 and r.mission_id = any($2::text[])`, [T, ids]),
    ] : [];
    const out: any[][] = [];
    // throughput reads only the first two (first runs and transitions): the rest stay empty
    for (let i = 0; i < fs.length; i++) out.push(need === 'throughput' && i >= 2 ? [] : (await fs[i]()).rows);
    const [runs, transitions, tasks, attempts, decisions, delegations, reviews] = ids.length ? out : [[], [], [], [], [], [], []];
    return {
      missions: missions.map((m) => ({ id: m.id, ownerId: m.owner_id })),
      runs: runs.filter((r) => r.started_at).map((r) => ({ missionId: r.mission_id, startedAt: new Date(r.started_at) })),
      transitions: transitions.filter((e) => e.f && e.t).map((e) => ({ missionId: e.mission_id, from: e.f, to: e.t, at: new Date(e.occurred_at) })),
      tasks: tasks.map((t) => ({ id: t.id, missionId: t.mission_id, status: t.status, simulated: t.simulated })),
      attempts: attempts.map((a) => ({ taskId: a.task_id, attemptNo: a.attempt_no, startedAt: a.started_at ? new Date(a.started_at) : null, finishedAt: a.finished_at ? new Date(a.finished_at) : null })),
      decisions: decisions.map((d) => ({ missionId: d.mission_id, decision: d.decision, decidedBy: d.decided_by, human: d.human, at: new Date(d.decided_at) })),
      delegations: delegations.map((d) => ({ missionId: d.mission_id, edgeKind: d.edge_kind, simulated: d.simulated })),
      reviews: reviews.map((r) => ({ taskId: r.task_id, missionId: r.mission_id, verdict: r.verdict, reviewerId: r.reviewer_id, producerId: r.producer_id, principalId: r.principal_id, evidenceCount: Number(r.ev), at: new Date(r.created_at), seq: Number(r.seq), stale: !!r.stale })),
    };
}

export default async function companyRoutes(app: FastifyInstance) {
  app.get('/company/scorecard', async (req) => {
    const ctx = await requireUser(req);
    const qs = parse(QueryIn, req.query ?? {});
    const includeDemo = qs.includeDemo === '1';
    // one transaction = one database clock: the window end and every SQL `<= now()` bound are the same instant
    return snapshotTx(app.db, async (c) => {
      const w = await dbWindow(c, qs.window);
      return computeScorecard(await loadInput(c, ctx, includeDemo), { ...w, includeDemo });
    });
  });

  /** Improvement cycle 12: GET /company/throughput?weeks=8 — weekly started/finished counts, same visibility rules. */
  app.get('/company/throughput', async (req) => {
    const ctx = await requireUser(req);
    const qs = parse(ThroughputIn, req.query ?? {});
    const includeDemo = qs.includeDemo === '1';
    return snapshotTx(app.db, async (c) => {
      const to = await dbNow(c);
      return computeThroughput(await loadInput(c, ctx, includeDemo, 'throughput'), { weeks: qs.weeks, to, includeDemo });
    });
  });
}
