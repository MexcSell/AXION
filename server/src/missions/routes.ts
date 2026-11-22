import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { tx } from '../db.ts';
import { audit } from '../audit.ts';
import { ApiError } from '../errors.ts';
import { requireUser } from '../auth/session.ts';
import { parse } from '../auth/routes.ts';
import { idempotent } from '../idempotency.ts';
import { emit } from '../events/hooks.ts';
import { transition, USER_ACTIONS, type MissionStatus, type MissionAction } from './machine.ts';
import { canManage } from './visibility.ts';
import { SELECT_MISSION, conflict, defaultPresentation, filesFor, getVisibleRow, listVisible, loadRow, missionDto, nextMissionId } from './service.ts';
import { readOrgView } from './staffing-org.ts';

const CreateIn = z.object({ text: z.string().max(20_000).default(''), files: z.array(z.string().max(40)).max(10).default([]), shared: z.boolean().default(false) });
const PatchIn = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  kind: z.enum(['website', 'training', 'research', 'structure', 'self-update', 'data', 'automation']).optional(),
  priority: z.enum(['low', 'normal', 'high', 'critical']).optional(),
  text: z.string().max(20_000).optional(),
  criteria: z.array(z.object({ text: z.string().max(400), done: z.boolean() })).max(50).optional(),
}).strict();

declare module 'fastify' { interface FastifyInstance { onMissionChanged?: (id: string, status: MissionStatus) => void; retryStaffing?: (id: string) => void } }

export default async function missionRoutes(app: FastifyInstance) {
  const T = () => app.cfg.tenantId;

  app.get('/missions', async (req) => {
    const ctx = await requireUser(req);
    return { missions: await listVisible(app.db, ctx) };
  });

  app.get('/missions/:id', async (req) => {
    const ctx = await requireUser(req);
    return { mission: missionDto(await getVisibleRow(app.db, ctx, (req.params as { id: string }).id)) };
  });

  app.post('/missions', async (req, reply) => {
    const ctx = await requireUser(req);
    const b = parse(CreateIn, req.body);
    if (!b.text.trim() && !b.files.length) throw new ApiError('VALIDATION', 400, 'Describe the mission or attach a file.', { fieldErrors: { text: 'empty' } });
    const out = await idempotent(app.db, req, ctx, async (c) => {
      const m = await (async () => {
        const files = await filesFor(c, ctx, b.files);
        const id = await nextMissionId(c);
        const d = defaultPresentation(b.text, files, ctx.user.name, Date.now(), await readOrgView(c, ctx.tenantId)); // cycle 11: staffed by the active org
        // draft → submit → plan in one transaction (spec §10.6; the GM starts staffing at once)
        let status: MissionStatus = 'draft';
        status = transition(status, 'submit');
        status = transition(status, 'plan');
        await c.query(`insert into missions(id, tenant_id, owner_id, shared, status, presentation) values ($1,$2,$3,$4,$5,$6)`,
          [id, ctx.tenantId, ctx.user.id, b.shared, status, JSON.stringify(d.presentation)]);
        await c.query(`insert into mission_revisions(mission_id, revision, title, kind, priority, text, files, criteria, created_by) values ($1,1,$2,$3,'normal',$4,$5,'[]',$6)`,
          [id, d.title, d.kind, b.text.trim(), JSON.stringify(files), ctx.user.id]);
        await audit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, action: 'mission.create', subject: id, result: 'ok', correlationId: ctx.correlationId, detail: { shared: b.shared, files: files.length } });
        await emit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, correlationId: ctx.correlationId, type: 'mission.created', subject: id, missionId: id, payload: { status } });
        return missionDto(await loadRow(c, id));
      })();
      return { status: 201, body: { mission: m } };
    });
    if (out.status === 201) app.onMissionChanged?.((out.body as { mission: { id: string } }).mission.id, 'planning');
    return reply.status(out.status).send(out.body);
  });

  app.patch('/missions/:id', async (req) => {
    const ctx = await requireUser(req);
    const { id } = req.params as { id: string };
    const b = parse(PatchIn, req.body);
    const ifm = req.headers['if-match'];
    if (ifm === undefined) throw new ApiError('PRECONDITION_REQUIRED', 428, 'Send If-Match with the mission version you edited.');
    const expected = Number(String(ifm).replace(/"/g, ''));
    const m = await tx(app.db, async (c) => {
      const r = await getVisibleRow(c, ctx, id, true);
      if (r.content_version !== expected) throw conflict();
      if (r.status === 'archived') throw new ApiError('ILLEGAL_TRANSITION', 409, 'Restore the mission before editing it.');
      const next = { title: b.title ?? r.title, kind: b.kind ?? r.kind, priority: b.priority ?? r.priority, text: b.text ?? r.text, criteria: JSON.stringify(b.criteria ?? r.criteria) };
      let rev = r.current_revision;
      if (r.status === 'draft') {
        await c.query('update mission_revisions set title=$3, kind=$4, priority=$5, text=$6, criteria=$7 where mission_id=$1 and revision=$2', [id, rev, next.title, next.kind, next.priority, next.text, next.criteria]);
      } else {
        rev += 1;
        await c.query(`insert into mission_revisions(mission_id, revision, title, kind, priority, text, files, criteria, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [id, rev, next.title, next.kind, next.priority, next.text, JSON.stringify(r.files), next.criteria, ctx.user.id]);
      }
      const u = await c.query(`update missions set current_revision=$2, row_version=row_version+1, content_version=content_version+1, updated_at=now(),
          presentation = presentation || jsonb_build_object('lastEvent', $4::text, 'lastEventAt', $5::bigint) where id=$1 and content_version=$3 returning id`,
        [id, rev, expected, `Edited by ${ctx.user.name}`, Date.now()]);
      if (!u.rowCount) throw conflict();
      await audit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, action: 'mission.revise', subject: id, result: 'ok', correlationId: ctx.correlationId, detail: { revision: rev, fields: Object.keys(b) } });
      await emit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, correlationId: ctx.correlationId, type: 'mission.revised', subject: id, missionId: id, payload: { revision: rev } });
      return missionDto(await loadRow(c, id));
    });
    return { mission: m };
  });

  app.post('/missions/:id/share', async (req) => {
    const ctx = await requireUser(req);
    const { id } = req.params as { id: string };
    const b = parse(z.object({ shared: z.boolean() }), req.body);
    const m = await tx(app.db, async (c) => {
      const r = await getVisibleRow(c, ctx, id, true);
      if (!canManage(ctx, r)) throw new ApiError('FORBIDDEN', 403, 'Only the owner or an administrator can change sharing.');
      if (r.shared === b.shared) return missionDto(r); // no change: no event to everyone
      await c.query(`update missions set shared=$2, row_version=row_version+1, updated_at=now() where id=$1`, [id, b.shared]);
      await audit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, action: 'mission.share', subject: id, result: 'ok', correlationId: ctx.correlationId, detail: { shared: b.shared } });
      await emit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, correlationId: ctx.correlationId, type: 'mission.shared', subject: id, missionId: id, payload: { shared: b.shared } });
      return missionDto(await loadRow(c, id));
    });
    return { mission: m };
  });

  app.post('/missions/:id/actions/:action', async (req, reply) => {
    const ctx = await requireUser(req);
    const { id, action } = req.params as { id: string; action: string };
    if (!(USER_ACTIONS as readonly string[]).includes(action)) throw new ApiError('ACTION_NOT_ALLOWED', 403, 'This action is not available to people.');
    const b = parse(z.object({ cancelFirst: z.boolean().optional() }), req.body);
    const out = await idempotent(app.db, req, ctx, async (c) => {
      const m = await (async () => {
        const r = await getVisibleRow(c, ctx, id, true);
        let from = r.status as MissionStatus;
        const steps: [MissionStatus, MissionAction, MissionStatus][] = [];
        if (action === 'archive' && b.cancelFirst && !['completed', 'canceled', 'failed'].includes(from)) {
          const to = transition(from, 'cancel'); steps.push([from, 'cancel', to]); from = to;
        }
        let to = transition(from, action as MissionAction, { preArchive: r.presentation?.preArchive, prePause: r.presentation?.prePause });
        // paused while waiting for approval, and the last approval was decided meanwhile → the gate is open again
        if (action === 'resume' && to === 'waiting_approval') {
          const left = Number((await c.query(`select count(*) from approval_requests where mission_id=$1 and state='pending' and expires_at > now()`, [id])).rows[0].count);
          if (left === 0) to = 'running';
        }
        steps.push([from, action as MissionAction, to]);
        const label: Record<string, string> = { start: 'started', pause: 'paused', resume: 'resumed', cancel: 'canceled', retry: 'queued for retry', archive: 'archived', restore: 'restored' };
        const pres: Record<string, unknown> = { lastEvent: `${label[action] ? label[action][0].toUpperCase() + label[action].slice(1) : action} by ${ctx.user.name}`, lastEventAt: Date.now() };
        if (action === 'archive') pres.preArchive = from;
        if (action === 'pause') pres.prePause = from;
        // compare-and-set on the status we read (axor pattern): a concurrent change makes this a conflict, never a silent overwrite
        const u = await c.query(`update missions set status=$2, row_version=row_version+1, updated_at=now(),
            archived_at = case when $2='archived' then now() when $4 = 'restore' then null else archived_at end,
            presentation = presentation || $5::jsonb
          where id=$1 and status=$3 returning id`, [id, to, r.status, action, JSON.stringify(pres)]);
        if (!u.rowCount) throw conflict();
        if (to === 'running' && (action === 'start' || action === 'resume')) {
          await c.query(`update mission_runs set ended_at=now(), status='superseded' where mission_id=$1 and ended_at is null`, [id]);
          await c.query(`insert into mission_runs(mission_id, revision, status, execution) values ($1,$2,'running','disabled')`, [id, r.current_revision]);
        }
        if (['canceled', 'archived', 'failed'].includes(to)) await c.query(`update mission_runs set ended_at=now(), status=$2 where mission_id=$1 and ended_at is null`, [id, to]);
        for (const [f, a, t2] of steps) {
          await audit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, action: `mission.${a}`, subject: id, result: 'ok', correlationId: ctx.correlationId, detail: { from: f, to: t2 } });
          await emit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, correlationId: ctx.correlationId, type: 'mission.stateChanged', subject: id, missionId: id, payload: { from: f, to: t2, action: a, by: ctx.user.name } });
        }
        return missionDto(await loadRow(c, id));
      })();
      return { status: 200, body: { mission: m } };
    }, async (c) => { await getVisibleRow(c, ctx, id); });
    const st = (out.body as { mission: { serverStatus: MissionStatus; id: string } }).mission;
    app.onMissionChanged?.(st.id, st.serverStatus);
    return reply.status(out.status).send(out.body);
  });

  app.delete('/missions/:id', async (req) => {
    const ctx = await requireUser(req);
    const { id } = req.params as { id: string };
    await tx(app.db, async (c) => {
      const r = await getVisibleRow(c, ctx, id, true);
      if (!canManage(ctx, r)) throw new ApiError('FORBIDDEN', 403, 'Only the owner or an administrator can delete a mission.');
      await c.query(`update missions set deleted_at=now(), row_version=row_version+1, updated_at=now() where id=$1`, [id]);
      await audit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, action: 'mission.delete', subject: id, result: 'ok', correlationId: ctx.correlationId });
      await emit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, correlationId: ctx.correlationId, type: 'mission.deleted', subject: id, missionId: id, payload: { ownerId: r.owner_id, shared: r.shared } });
    });
    app.onMissionChanged?.(id, 'canceled');
    return { ok: true };
  });

  void SELECT_MISSION; void T;
}
