import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { tx } from '../db.ts';
import { audit } from '../audit.ts';
import { ApiError, notFound } from '../errors.ts';
import { requireUser, requireAdmin } from '../auth/session.ts';
import { parse } from '../auth/routes.ts';
import { idempotent } from '../idempotency.ts';
import { emit } from '../events/hooks.ts';
import { addVersion, getAgent, listAgents } from './service.ts';
import { activeRevision, createOrgRevision, edgesOf, revDto } from './org.ts';

const Str = z.string().trim();
const List = z.array(Str.min(1).max(80)).max(50);
const CreateIn = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/).optional(),
  name: Str.min(1).max(80), role: Str.min(1).max(60), dept: Str.min(1).max(60), duty: Str.min(1).max(160),
  description: Str.max(2000).default(''), model: Str.min(1).max(120), skills: List.default([]), tools: List.default([]),
  parentId: z.string().max(60).optional(), managerId: z.string().max(60).optional(), site: Str.max(120).optional(),
  avatar: z.record(z.string(), z.unknown()).default({}),
}).strict();
const PatchIn = z.object({
  name: Str.min(1).max(80).optional(), dept: Str.min(1).max(60).optional(), description: Str.max(2000).optional(),
  site: Str.max(120).nullable().optional(), avatar: z.record(z.string(), z.unknown()).optional(),
  model: Str.min(1).max(120).optional(), skills: List.optional(), tools: List.optional(),
}).strict();

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
const stale = () => new ApiError('CONFLICT', 409, 'Someone changed this agent meanwhile. Reload it and apply your change again.');
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export default async function agentRoutes(app: FastifyInstance) {
  app.get('/agents', async (req) => {
    const ctx = await requireUser(req);
    return { agents: await listAgents(app.db, ctx.tenantId) };
  });

  app.get('/agents/:id', async (req) => {
    const ctx = await requireUser(req);
    const a = await getAgent(app.db, ctx.tenantId, (req.params as { id: string }).id);
    if (!a) throw notFound('No such agent.');
    return { agent: a };
  });

  app.post('/agents', async (req, reply) => {
    const ctx = await requireAdmin(req);
    const b = parse(CreateIn, req.body);
    const out = await idempotent(app.db, req, ctx, async (c) => {
      await c.query('select pg_advisory_xact_lock(hashtext($1))', ['agent-create:' + ctx.tenantId]);
      const id = b.id ?? (slug(b.name) || 'agent');
      if ((await c.query('select 1 from agent_definitions where id=$1', [id])).rowCount) throw new ApiError('CONFLICT', 409, `An agent with the id ${id} already exists.`);
      // u1: one agent per role (among active agents) and one per duty (case-insensitive)
      if ((await c.query(`select 1 from agent_definitions where tenant_id=$1 and status='active' and lower(role)=lower($2)`, [ctx.tenantId, b.role])).rowCount)
        throw new ApiError('ROLE_TAKEN', 409, 'An agent already holds this role. Each role belongs to one agent.', { fieldErrors: { role: 'taken' } });
      if ((await c.query('select 1 from agent_definitions where tenant_id=$1 and lower(duty)=lower($2)', [ctx.tenantId, b.duty])).rowCount)
        throw new ApiError('DUTY_TAKEN', 409, 'An agent already holds this duty. Each duty belongs to one agent.', { fieldErrors: { duty: 'taken' } });
      if (b.parentId && !(await c.query('select 1 from agent_definitions where tenant_id=$1 and id=$2', [ctx.tenantId, b.parentId])).rowCount)
        throw new ApiError('VALIDATION', 400, 'The parent agent does not exist.', { fieldErrors: { parentId: 'unknown' } });
      const profile = { status: 'idle', missions: 0, success: 0, sample: 0, grade: 'C', load: 0, metrics: {}, createdAgo: 0, growth: 'stable', growthPct: 0, growthNote: '', level: 1, xp: 0, generation: 1, provenance: { source: 'measured', sample: 0, window: '90d' } };
      await c.query(
        `insert into agent_definitions(id, tenant_id, name, role, dept, duty, parent_id, site, avatar, description, profile, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [id, ctx.tenantId, b.name, b.role, b.dept, b.duty, b.parentId ?? null, b.site ?? null, JSON.stringify(b.avatar), b.description, JSON.stringify(profile), ctx.user.id]);
      const v = await addVersion(c, { agentId: id, model: b.model, skills: b.skills, tools: b.tools, createdBy: ctx.user.id });
      // the new agent needs a place in the organization: a new revision = the active edges + its reporting line
      const manager = b.managerId ?? (b.parentId ?? 'gm');
      // review I-1: createOrgRevision locks the organisation, THEN reads the latest revision and adds this line to it
      let org: { seq: number; previous: number } | null = null;
      if ((await c.query('select 1 from agent_definitions where tenant_id=$1 and id=$2', [ctx.tenantId, manager])).rowCount) {
        const rev = await createOrgRevision(c, { tenantId: ctx.tenantId, edges: (latest) => [...latest, { supervisorId: manager, subordinateId: id }], note: `Added ${b.name}`, createdBy: ctx.user.id });
        org = { seq: rev.seq, previous: rev.seq - 1 };
      } else if (b.managerId) throw new ApiError('VALIDATION', 400, 'The manager does not exist.', { fieldErrors: { managerId: 'unknown' } });
      await audit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, action: 'agent.create', subject: id, result: 'ok', correlationId: ctx.correlationId, detail: { role: b.role, version: v.label, revision: org?.seq ?? null } });
      await emit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, correlationId: ctx.correlationId, type: 'agent.created', subject: id, payload: { versionId: v.id, label: v.label } });
      if (org) await emit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, correlationId: ctx.correlationId, type: 'org.revisionApplied', subject: String(org.seq), subjectKind: 'org', payload: { revision: org.seq, previous: org.previous, agentId: id } });
      return { status: 201, body: { agent: await getAgent(c, ctx.tenantId, id) } };
    });
    return reply.status(out.status).send(out.body);
  });

  app.patch('/agents/:id', async (req) => {
    const ctx = await requireAdmin(req);
    const { id } = req.params as { id: string };
    const b = parse(PatchIn, req.body);
    const ifm = req.headers['if-match'];
    if (ifm === undefined) throw new ApiError('PRECONDITION_REQUIRED', 428, 'Send If-Match with the agent version you edited.');
    const expected = Number(String(ifm).replace(/"/g, ''));
    const agent = await tx(app.db, async (c) => {
      const cur = await getAgent(c, ctx.tenantId, id, false, true);
      if (!cur) throw notFound('No such agent.');
      if (cur.rowVersion !== expected) throw stale();
      const display = ['name', 'dept', 'description', 'site', 'avatar'].filter((k) => (b as Record<string, unknown>)[k] !== undefined && !same((b as Record<string, unknown>)[k], (cur as Record<string, unknown>)[k] ?? null));
      const model = b.model ?? cur.model, skills = b.skills ?? cur.skills, tools = b.tools ?? cur.tools;
      const versioned = model !== cur.model || !same(skills, cur.skills) || !same(tools, cur.tools);
      if (!display.length && !versioned) return (await getAgent(c, ctx.tenantId, id))!; // nothing changed: no write, no event
      const u = await c.query(
        `update agent_definitions set name=$3, dept=$4, description=$5, site=$6, avatar=$7, row_version=row_version+1 where id=$1 and row_version=$2 returning id`,
        [id, expected, b.name ?? cur.name, b.dept ?? cur.dept, b.description ?? cur.description, b.site === undefined ? (cur.site ?? null) : b.site, JSON.stringify(b.avatar ?? cur.avatar)]);
      if (!u.rowCount) throw stale();
      if (display.length) {
        await audit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, action: 'agent.update', subject: id, result: 'ok', correlationId: ctx.correlationId, detail: { fields: display } });
        await emit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, correlationId: ctx.correlationId, type: 'agent.updated', subject: id, payload: { fields: display } });
      }
      if (versioned) {
        const v = await addVersion(c, { agentId: id, model, skills, tools, createdBy: ctx.user.id });
        await audit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, action: 'agent.version', subject: id, result: 'ok', correlationId: ctx.correlationId, detail: { seq: v.seq, label: v.label, from: cur.versionId } });
        await emit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, correlationId: ctx.correlationId, type: 'agent.versionCreated', subject: id, payload: { versionId: v.id, label: v.label, seq: v.seq, previousVersionId: cur.versionId } });
      }
      return (await getAgent(c, ctx.tenantId, id))!;
    });
    return { agent };
  });

  app.get('/organization/graph', async (req) => {
    const ctx = await requireUser(req);
    const revision = await activeRevision(app.db, ctx.tenantId);
    return { revision, edges: revision ? await edgesOf(app.db, revision.id) : [] };
  });

  app.get('/organization/revisions', async (req) => {
    const ctx = await requireUser(req);
    const rows = (await app.db.query('select * from org_revisions where tenant_id=$1 order by seq', [ctx.tenantId])).rows;
    return { revisions: rows.map(revDto) };
  });
}
