import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Tx, Db } from '../db.ts';
import { audit } from '../audit.ts';
import { ApiError, notFound } from '../errors.ts';
import { requireUser, type Ctx } from '../auth/session.ts';
import { parse } from '../auth/routes.ts';
import { idempotent } from '../idempotency.ts';
import { emit } from '../events/hooks.ts';
import { VISIBLE_SQL } from '../missions/visibility.ts';
import { insertDelegation, taskById } from '../instances/service.ts';
import { transitionTask, USER_TASK_ACTIONS, type TaskStatus, type TaskAction } from './machine.ts';

const ReassignIn = z.object({ toInstanceId: z.string().min(1).max(120), reason: z.string().max(400).optional() }).strict();
const NoBody = z.object({}).strict().nullish();

/** A task of a mission the caller can see (404 otherwise, same as the mission routes). */
async function visibleTask(c: Tx | Db, ctx: Ctx, id: string, lock = false) {
  const r = (await c.query(`select t.id, t.status, t.mission_id, t.tenant_id, t.owner_instance_id, t.owner_agent from tasks t join missions m on m.id = t.mission_id
      where t.id=$1 and m.tenant_id=$2 and m.deleted_at is null and ${VISIBLE_SQL('$3', '$4')} ${lock ? 'for update of t' : ''}`,
    [id, ctx.tenantId, ctx.user.role === 'admin', ctx.user.id])).rows[0];
  if (!r) throw notFound('No such task, or its mission is not shared with you.');
  return r as { id: string; status: TaskStatus; mission_id: string; tenant_id: string; owner_instance_id: string | null; owner_agent: string | null };
}

export default async function taskRoutes(app: FastifyInstance) {
  app.get('/tasks/:id', async (req) => {
    const ctx = await requireUser(req);
    const t = await visibleTask(app.db, ctx, (req.params as { id: string }).id);
    return { task: await taskById(app.db, t.id) };
  });

  app.post('/tasks/:id/:action', async (req, reply) => {
    const ctx = await requireUser(req);
    const { id, action } = req.params as { id: string; action: string };
    if (!(USER_TASK_ACTIONS as readonly string[]).includes(action)) throw new ApiError('ACTION_NOT_ALLOWED', 403, 'This action is not available to people.');
    const body = action === 'reassign' ? parse(ReassignIn, req.body) : (parse(NoBody, req.body), null);
    const out = await idempotent(app.db, req, ctx, async (c) => {
      const t = await visibleTask(c, ctx, id, true);
      const from = t.status;
      const to = transitionTask(from, action as TaskAction);
      const detail: Record<string, unknown> = { from, to };
      let delegated: { from: string; to: string } | undefined;
      if (action === 'reassign') {
        const target = (await c.query(`select id, agent_id from agent_instances where id=$1 and mission_id=$2`, [body!.toInstanceId, t.mission_id])).rows[0];
        if (!target) throw new ApiError('TASK_TARGET_INVALID', 422, 'Choose an agent that is part of this mission.', { fieldErrors: { toInstanceId: 'not in this mission' } });
        if (t.owner_instance_id === target.id || (!t.owner_instance_id && t.owner_agent === target.agent_id)) throw new ApiError('TASK_TARGET_INVALID', 422, 'That agent already owns this task.', { fieldErrors: { toInstanceId: 'already the owner' } });
        const lead = (await c.query(`select id, manager_instance_id from agent_instances where mission_id=$1 order by (manager_instance_id is not null), seq limit 1`, [t.mission_id])).rows[0];
        const sim = (await c.query('select simulated from tasks where id=$1', [id])).rows[0].simulated as boolean;
        const u = await c.query(`update tasks set owner_instance_id=$2, owner_agent=$3 where id=$1 and status=$4 returning id`, [id, target.id, target.agent_id, from]);
        if (!u.rowCount) throw new ApiError('CONFLICT', 409, 'The task changed while you were editing it. Reload and try again.');
        const fromInst = lead && lead.id !== target.id ? lead.id : target.id;
        if (fromInst !== target.id) await insertDelegation(c, { missionId: t.mission_id, from: fromInst, to: target.id, kind: 'delegated', taskId: id, simulated: sim });
        Object.assign(detail, { toInstanceId: target.id, fromInstanceId: t.owner_instance_id, fromAgent: t.owner_agent, reason: body!.reason ?? null }); // fromAgent: cycle 3 reliability (a task without an owner instance)
        delegated = { from: fromInst, to: target.id };
      } else {
        // compare-and-set on the status we read: a concurrent change is a conflict, never a silent overwrite
        const u = await c.query(`update tasks set status=$2 where id=$1 and status=$3 returning id`, [id, to, from]);
        if (!u.rowCount) throw new ApiError('CONFLICT', 409, 'The task changed while you were editing it. Reload and try again.');
        if (action === 'retry') {
          const n = (await c.query('select coalesce(max(attempt_no), 0) m from task_attempts where task_id=$1', [id])).rows[0].m as number;
          let next = n + 1;
          if (n === 0) { // fixture tasks have no history: make the failed attempt explicit first
            await c.query(`insert into task_attempts(task_id, attempt_no, started_at, finished_at, result) select id, 1, created_at, now(), 'failed' from tasks where id=$1`, [id]);
            next = 2;
          }
          await c.query(`insert into task_attempts(task_id, attempt_no, started_at) values ($1,$2,null)`, [id, next]);
          detail.attemptNo = next;
        }
      }
      await audit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, action: `task.${action}`, subject: id, result: 'ok', correlationId: ctx.correlationId, detail: { missionId: t.mission_id, ...detail } });
      const common = { tenantId: ctx.tenantId, actor: ctx.user.id, correlationId: ctx.correlationId, subjectKind: 'task', subject: id, missionId: t.mission_id };
      if (delegated) await emit(c, { ...common, type: 'task.delegated', payload: { taskId: id, ...delegated, toInstanceId: delegated.to, kind: 'delegated', by: ctx.user.name } });
      if (to !== from) await emit(c, { ...common, type: 'task.stateChanged', payload: { taskId: id, from, to, action, by: ctx.user.name } });
      return { status: 200, body: { task: await taskById(c, id) } };
    }, async (c) => { await visibleTask(c, ctx, id); });
    return reply.status(out.status).send(out.body);
  });
}
