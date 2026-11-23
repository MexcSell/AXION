import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { Tx, Db } from '../db.ts';
import { audit } from '../audit.ts';
import { ApiError, notFound } from '../errors.ts';
import { taskReviewLock } from '../locks.ts';
import { VISIBLE_SQL } from '../missions/visibility.ts';
import {
  FORECAST_P_MIN, FORECAST_P_MAX, FORECAST_QUESTION, TASK_CLASS_IDS, ledgerOf,
  type ForecastRecordDto, type ForecastLedgerDto, type ForecastRowIn,
} from '../../../shared/contracts/src/index.ts';

/**
 * Improvement cycle 86 (R5-7, first slice): the forecast ledger. Method, states and limits are written in shared/contracts/src/forecasts.ts.
 * Writing: one forecast per person per task, recorded only while the task has no review (checked in SQL, under the task-review lock that
 * recordReview also takes, in the same statement as the insert). Reading: the outcome is the first task_reviews row by seq, joined at read time;
 * nothing about it is stored. Every time comparison is SQL on the database clock.
 */
export const ForecastIn = z.object({
  probability: z.number().min(FORECAST_P_MIN).max(FORECAST_P_MAX).refine((p) => Math.abs(p * 100 - Math.round(p * 100)) < 1e-9, 'at most two decimals'),
}).strict();

export interface ForecastCtx { tenantId: string; user: { id: string; name: string; role: 'admin' | 'member' | string }; correlationId: string }
const fid = () => 'FC-' + randomBytes(12).toString('hex');

/** A brief that names BOTH a task class and a difficulty (1 to 5); `d` is the brief row alias. */
const NAMES_BOTH = (d: string) => `${d}.brief->>'taskClass' = any($3::text[]) and ${d}.brief->>'difficulty' ~ '^[1-5]$'`;

/** Rows of one person's forecasts (optionally one task), with the first review, the void test and the reference-class history, all computed in SQL. */
async function rowsOf(c: Tx | Db, viewer: ForecastCtx, forecasterId: string, taskId: string | null): Promise<ForecastRowIn[]> {
  const rs = (await c.query(
    `with hist as materialized (
       select t.id as task_id, fr.created_at as first_at, fr.verdict, hb.cls, hb.diff
         from tasks t join missions m on m.id = t.mission_id
         join lateral (select r.verdict, r.created_at from task_reviews r where r.task_id = t.id order by r.seq limit 1) fr on true
         join lateral (select d.brief->>'taskClass' as cls, d.brief->>'difficulty' as diff from delegation_briefs d
                        where d.task_id = t.id and d.created_at < fr.created_at and ${NAMES_BOTH('d')} order by d.seq limit 1) hb on true
        where t.tenant_id = $1 and not (t.simulated or m.demo) and m.deleted_at is null and ${VISIBLE_SQL('$4', '$5')})
     select f.id, f.task_id, f.mission_id, f.probability, f.made_at, t.title,
            fr.verdict as first_verdict, fr.created_at as first_at,
            coalesce(fr.created_at is not null and f.made_at < fr.created_at, false) as in_time,
            (t.status = 'canceled' or m.status = 'archived' or m.archived_at is not null) as voided,
            b.cls, b.diff, coalesce(h.n, 0) as base_n, coalesce(h.x, 0) as base_x
       from forecasts f join tasks t on t.id = f.task_id join missions m on m.id = f.mission_id
       left join lateral (select r.verdict, r.created_at from task_reviews r where r.task_id = f.task_id order by r.seq limit 1) fr on true
       left join lateral (select d.brief->>'taskClass' as cls, d.brief->>'difficulty' as diff from delegation_briefs d
                           where d.task_id = f.task_id and d.created_at <= f.made_at and ${NAMES_BOTH('d')} order by d.seq limit 1) b on true
       left join lateral (select count(*)::int as n, (count(*) filter (where hh.verdict = 'accepted'))::int as x from hist hh
                           where b.cls is not null and hh.cls = b.cls and hh.diff = b.diff and hh.first_at < f.made_at and hh.task_id <> f.task_id) h on true
      where f.tenant_id = $1 and f.forecaster_id = $2 and m.deleted_at is null and ${VISIBLE_SQL('$4', '$5')} and ($6::text is null or f.task_id = $6)
      order by f.seq desc`,
    [viewer.tenantId, forecasterId, [...TASK_CLASS_IDS], viewer.user.role === 'admin', viewer.user.id, taskId])).rows;
  return rs.map((r) => ({
    id: r.id, taskId: r.task_id, missionId: r.mission_id, taskTitle: r.title, probability: r.probability, madeAt: new Date(r.made_at).toISOString(),
    firstVerdict: r.first_verdict ?? null, firstAt: r.first_at ? new Date(r.first_at).toISOString() : null, inTime: r.in_time, voided: r.voided,
    classId: r.cls ?? null, difficulty: r.diff === null || r.diff === undefined ? null : Number(r.diff), baseN: r.base_n, baseX: r.base_x,
  }));
}

/** One person's ledger, as the viewer may see it (missions the viewer cannot see are left out). */
export async function loadLedger(c: Tx | Db, viewer: ForecastCtx, forecaster: { id: string; name: string }): Promise<ForecastLedgerDto> {
  return ledgerOf(forecaster, await rowsOf(c, viewer, forecaster.id, null));
}

/** The administrator route: the person must belong to this company. */
export async function forecasterOf(c: Tx | Db, tenantId: string, userId: string): Promise<{ id: string; name: string }> {
  const u = (await c.query(`select id, name from users where id=$1 and tenant_id=$2`, [userId, tenantId])).rows[0];
  if (!u) throw notFound('No such person.');
  return { id: u.id, name: u.name };
}

/** A replayed answer is returned only while the task is still visible to the person (the same rule as the first call). */
export async function assertVisible(c: Tx, ctx: ForecastCtx, taskId: string): Promise<void> {
  const ok = (await c.query(`select 1 from tasks t join missions m on m.id = t.mission_id where t.id=$1 and m.tenant_id=$2 and m.deleted_at is null and ${VISIBLE_SQL('$3', '$4')}`,
    [taskId, ctx.tenantId, ctx.user.role === 'admin', ctx.user.id])).rowCount;
  if (!ok) throw notFound('No such task, or its mission is not shared with you.');
}

/** Record one forecast (inside the caller's transaction). The lock is the first statement; the review check is part of the insert statement. */
export async function recordForecast(c: Tx, ctx: ForecastCtx, taskId: string, input: z.infer<typeof ForecastIn>): Promise<ForecastRecordDto> {
  await taskReviewLock(c, taskId);
  const t = (await c.query(
    `select t.id, t.status, t.mission_id, m.status as mstatus, m.archived_at from tasks t join missions m on m.id = t.mission_id
      where t.id = $1 and m.tenant_id = $2 and m.deleted_at is null and ${VISIBLE_SQL('$3', '$4')}`, [taskId, ctx.tenantId, ctx.user.role === 'admin', ctx.user.id])).rows[0];
  if (!t) throw notFound('No such task, or its mission is not shared with you.');
  if (t.status === 'canceled' || t.mstatus === 'archived' || t.archived_at) throw new ApiError('CONFLICT', 409, 'This task was canceled or archived, so its first review will not come. A forecast would never be scored.', { fieldErrors: { forecast: 'closed' } });
  const id = fid();
  const ins = await c.query(
    `insert into forecasts(id, tenant_id, mission_id, task_id, forecaster_id, probability)
     select $1::text, $2::text, $3::text, $4::text, $5::text, $6::numeric
      where not exists (select 1 from task_reviews r where r.task_id = $4::text)
     on conflict (task_id, forecaster_id, question) do nothing returning id`,
    [id, ctx.tenantId, t.mission_id, taskId, ctx.user.id, input.probability.toFixed(2)]);
  if (!ins.rowCount) {
    const mine = (await c.query(`select 1 from forecasts where task_id = $1 and forecaster_id = $2 and question = $3`, [taskId, ctx.user.id, FORECAST_QUESTION])).rowCount;
    if (mine) throw new ApiError('CONFLICT', 409, 'You already forecast this task. A forecast is never changed or replaced.', { fieldErrors: { forecast: 'exists' } });
    throw new ApiError('CONFLICT', 409, 'This task already has a review, so the outcome is known and a forecast can no longer be recorded.', { fieldErrors: { forecast: 'closed' } });
  }
  await audit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, action: 'forecast.record', subject: taskId, result: 'ok', correlationId: ctx.correlationId,
    detail: { forecastId: id, missionId: t.mission_id, probability: input.probability, question: FORECAST_QUESTION } });
  const made = (await c.query(`select made_at from forecasts where id = $1`, [id])).rows[0];
  return { forecast: { id, taskId, missionId: t.mission_id, question: FORECAST_QUESTION, probability: input.probability, madeAt: new Date(made.made_at).toISOString() } };
}
