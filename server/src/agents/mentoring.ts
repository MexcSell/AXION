import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { tx, type Tx } from '../db.ts';
import { audit } from '../audit.ts';
import { ApiError, notFound } from '../errors.ts';
import { requireUser, requireAdmin, type Ctx } from '../auth/session.ts';
import { parse } from '../auth/routes.ts';
import { idempotent } from '../idempotency.ts';
import { emit } from '../events/hooks.ts';
import type { MentoringPlanDto, MentoringMilestoneDto } from '../../../shared/contracts/src/index.ts';

/**
 * Improvement cycle 19: mentoring plans (spec §4.11 Mentoring, §16 Mentors and independent QA).
 * An administrator records a plan for an agent: another active agent as mentor, a target skill, 1-5 milestones and a
 * re-evaluation date. A person ticks milestones (who and when are stored). The plan reports milestones done and dates,
 * never a score: no evaluation data exists because agents do not execute yet (evaluation is always null).
 * Plans are append-only in spirit: closed once as completed or cancelled and kept in history (the database refuses
 * edits to a closed plan, any delete, and a second tick of a milestone). Every write, and every refused write on an
 * existing plan, is audited; events mentoring.* go to everyone (subject: the mentee agent).
 */
const Str = z.string().trim();
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CreateIn = z.object({
  mentorId: Str.min(1).max(64), skill: Str.min(1).max(120),
  milestones: z.array(Str.min(1).max(200)).min(1).max(5),
  reevalOn: z.string().regex(DATE, 'Use a date like 2026-12-31').refine((d) => !Number.isNaN(Date.parse(d + 'T00:00:00Z')) && new Date(d + 'T00:00:00Z').toISOString().slice(0, 10) === d, 'Not a real date'),
}).strict();
const CloseIn = z.object({ outcome: z.enum(['completed', 'cancelled']), note: Str.max(1000).optional() }).strict();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : null);
const SELECT = `select p.*, to_char(p.reeval_on, 'YYYY-MM-DD') as reeval_text, me.name as mentee_name, mo.name as mentor_name, cu.name as created_by_name, xu.name as closed_by_name
  from mentoring_plans p
  join agent_definitions me on me.id = p.mentee_id
  join agent_definitions mo on mo.id = p.mentor_id
  left join users cu on cu.id = p.created_by
  left join users xu on xu.id = p.closed_by`;

async function plans(c: Tx, where: string, params: unknown[]): Promise<MentoringPlanDto[]> {
  const rows = (await c.query(`${SELECT} where ${where} order by p.created_at desc, p.id limit 200`, params)).rows;
  if (!rows.length) return [];
  const ms = (await c.query(
    `select m.*, u.name as done_by_name from mentoring_milestones m left join users u on u.id = m.done_by where m.plan_id = any($1) order by m.plan_id, m.seq`, [rows.map((r) => r.id)])).rows;
  return rows.map((r) => {
    const milestones: MentoringMilestoneDto[] = ms.filter((m) => m.plan_id === r.id).map((m) => ({
      id: m.id, seq: m.seq, text: m.text, doneBy: m.done_by, doneByName: m.done_by ? (m.done_by_name ?? m.done_by) : null, doneAt: iso(m.done_at),
    }));
    return {
      id: r.id, menteeId: r.mentee_id, menteeName: r.mentee_name, mentorId: r.mentor_id, mentorName: r.mentor_name, skill: r.skill,
      reevalOn: r.reeval_text, status: r.status, milestones, milestonesDone: milestones.filter((m) => m.doneAt).length, milestonesTotal: milestones.length,
      createdBy: r.created_by, createdByName: r.created_by_name ?? r.created_by, createdAt: iso(r.created_at)!,
      closedBy: r.closed_by, closedByName: r.closed_by ? (r.closed_by_name ?? r.closed_by) : null, closedAt: iso(r.closed_at), note: r.note, evaluation: null,
    };
  });
}
const one = async (c: Tx, tenantId: string, id: string) => (await plans(c, 'p.id=$1 and p.tenant_id=$2', [id, tenantId]))[0];

export default async function mentoringRoutes(app: FastifyInstance) {
  app.get('/mentoring', async (req) => {
    const ctx = await requireUser(req);
    return tx(app.db, async (c) => ({ plans: await plans(c, 'p.tenant_id=$1', [ctx.tenantId]) }));
  });

  app.get('/agents/:id/mentoring', async (req) => {
    const ctx = await requireUser(req);
    const { id } = req.params as { id: string };
    return tx(app.db, async (c) => {
      if (!(await c.query('select 1 from agent_definitions where id=$1 and tenant_id=$2', [id, ctx.tenantId])).rowCount) throw notFound('No such agent.');
      return { plans: await plans(c, 'p.tenant_id=$1 and p.mentee_id=$2', [ctx.tenantId, id]) };
    });
  });

  app.post('/agents/:id/mentoring', async (req, reply) => {
    const ctx = await requireAdmin(req);
    const { id } = req.params as { id: string };
    const b = parse(CreateIn, req.body);
    const out = await idempotent(app.db, req, ctx, async (c) => {
      const mentee = (await c.query('select id, name, status from agent_definitions where id=$1 and tenant_id=$2', [id, ctx.tenantId])).rows[0];
      if (!mentee) throw notFound('No such agent.');
      if (b.mentorId === id) throw new ApiError('VALIDATION', 422, 'Some fields are not valid.', { fieldErrors: { mentorId: 'An agent cannot mentor itself.' } });
      const mentor = (await c.query('select id, name, status from agent_definitions where id=$1 and tenant_id=$2', [b.mentorId, ctx.tenantId])).rows[0];
      if (!mentor) throw new ApiError('VALIDATION', 422, 'Some fields are not valid.', { fieldErrors: { mentorId: 'No such agent.' } });
      if (mentor.status !== 'active') throw new ApiError('VALIDATION', 422, 'Some fields are not valid.', { fieldErrors: { mentorId: `${mentor.name} is retired and cannot mentor.` } });
      const today = (await c.query(`select to_char(current_date, 'YYYY-MM-DD') as d`)).rows[0].d as string;
      if (b.reevalOn < today) throw new ApiError('VALIDATION', 422, 'Some fields are not valid.', { fieldErrors: { reevalOn: 'The re-evaluation date is already past.' } });
      if ((await c.query(`select 1 from mentoring_plans where tenant_id=$1 and mentee_id=$2 and status='active'`, [ctx.tenantId, id])).rowCount)
        throw new ApiError('MENTORING_ACTIVE', 409, `${mentee.name} already has an active mentoring plan. Close it first; it stays in the history.`);
      const pid = 'MP-' + randomBytes(16).toString('hex').toUpperCase(); // 128-bit
      try {
        await c.query(`insert into mentoring_plans(id, tenant_id, mentee_id, mentor_id, skill, reeval_on, created_by) values ($1,$2,$3,$4,$5,$6,$7)`,
          [pid, ctx.tenantId, id, b.mentorId, b.skill, b.reevalOn, ctx.user.id]);
      } catch (e) {
        if ((e as { code?: string }).code === '23505') throw new ApiError('MENTORING_ACTIVE', 409, `${mentee.name} already has an active mentoring plan.`);
        throw e;
      }
      for (const [i, text] of b.milestones.entries()) await c.query('insert into mentoring_milestones(plan_id, seq, text) values ($1,$2,$3)', [pid, i + 1, text]);
      await audit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, action: 'mentoring.plan', subject: pid, result: 'ok', correlationId: ctx.correlationId, detail: { menteeId: id, mentorId: b.mentorId, skill: b.skill, milestones: b.milestones.length, reevalOn: b.reevalOn } });
      await emit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, correlationId: ctx.correlationId, type: 'mentoring.planned', subject: id, subjectKind: 'agent', payload: { planId: pid, mentorId: b.mentorId, skill: b.skill } });
      return { status: 201, body: { plan: await one(c, ctx.tenantId, pid) } };
    });
    return reply.status(out.status).send(out.body);
  });

  /** A refusal on an existing plan is audited and the transaction still commits; the error is thrown after commit. */
  const refuse = async (c: Tx, ctx: Ctx, action: string, id: string, err: ApiError) => {
    await audit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, action, subject: id, result: 'denied', correlationId: ctx.correlationId, detail: { code: err.code } });
    return { err };
  };
  const closedErr = (status: string) => new ApiError('PLAN_CLOSED', 409, `This plan is already ${status}. A closed plan stays in the history and does not change.`);

  app.post('/mentoring/:pid/milestones/:mid/done', async (req) => {
    const ctx = await requireAdmin(req);
    const { pid, mid } = req.params as { pid: string; mid: string };
    const A = 'mentoring.milestone';
    const out = await tx(app.db, async (c): Promise<{ err: ApiError } | { plan: MentoringPlanDto }> => {
      const p = (await c.query('select * from mentoring_plans where id=$1 and tenant_id=$2 for update', [pid, ctx.tenantId])).rows[0];
      if (!p) return refuse(c, ctx, A, pid, notFound('No such plan.'));
      if (p.status !== 'active') return refuse(c, ctx, A, pid, closedErr(p.status));
      const m = UUID.test(mid) ? (await c.query('select * from mentoring_milestones where id=$1 and plan_id=$2 for update', [mid, pid])).rows[0] : undefined;
      if (!m) return refuse(c, ctx, A, pid, notFound('No such milestone.'));
      if (m.done_at) return refuse(c, ctx, A, pid, new ApiError('MILESTONE_DONE', 409, 'This milestone was already ticked off.'));
      await c.query('update mentoring_milestones set done_by=$2, done_at=now() where id=$1', [mid, ctx.user.id]);
      await audit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, action: A, subject: pid, result: 'ok', correlationId: ctx.correlationId, detail: { menteeId: p.mentee_id, milestoneId: mid, seq: m.seq } });
      await emit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, correlationId: ctx.correlationId, type: 'mentoring.milestoneDone', subject: p.mentee_id, subjectKind: 'agent', payload: { planId: pid, milestoneId: mid, seq: m.seq } });
      return { plan: await one(c, ctx.tenantId, pid) };
    });
    if ('err' in out) throw out.err;
    return out;
  });

  app.post('/mentoring/:pid/close', async (req) => {
    const ctx = await requireAdmin(req);
    const { pid } = req.params as { pid: string };
    const b = parse(CloseIn, req.body);
    const A = 'mentoring.close';
    const out = await tx(app.db, async (c): Promise<{ err: ApiError } | { plan: MentoringPlanDto }> => {
      const p = (await c.query('select * from mentoring_plans where id=$1 and tenant_id=$2 for update', [pid, ctx.tenantId])).rows[0];
      if (!p) return refuse(c, ctx, A, pid, notFound('No such plan.'));
      if (p.status !== 'active') return refuse(c, ctx, A, pid, closedErr(p.status));
      await c.query(`update mentoring_plans set status=$2, closed_by=$3, closed_at=now(), note=$4 where id=$1`, [pid, b.outcome, ctx.user.id, b.note || null]);
      await audit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, action: A, subject: pid, result: 'ok', correlationId: ctx.correlationId, detail: { menteeId: p.mentee_id, outcome: b.outcome, note: b.note || null } });
      await emit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, correlationId: ctx.correlationId, type: 'mentoring.closed', subject: p.mentee_id, subjectKind: 'agent', payload: { planId: pid, outcome: b.outcome } });
      return { plan: await one(c, ctx.tenantId, pid) };
    });
    if ('err' in out) throw out.err;
    return out;
  });
}
