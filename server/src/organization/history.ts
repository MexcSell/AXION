import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { type Db, type Tx } from '../db.ts';
import { ApiError, notFound } from '../errors.ts';
import { requireUser, requireAdmin } from '../auth/session.ts';
import { parse } from '../auth/routes.ts';
import { idempotent } from '../idempotency.ts';
import { VISIBLE_SQL } from '../missions/visibility.ts';
import { edgesOf, latestRevision, revDto } from '../agents/org.ts';
import { diffLines } from './validate.ts';
import { coverageAgents, revisionCoverage } from './coverageRoutes.ts';
import { createProposal, lockProposals, pendingWithEdges, expireDue } from './proposals.ts';
import { RESTRUCTURE_TRIGGERS, type OrgDiffDto, OrgEdgeDto, OrgImpactDto, OrgRevisionDetailDto, OrgRevisionSource, OrgRevisionSummaryDto } from '../../../shared/contracts/src/index.ts';

/**
 * Improvement cycle 4: the organisation's history. Every revision with who made it and where it came from (a proposal,
 * an agent being created, the seed), a before/after diff of any two revisions with the active missions it touches, and a
 * rollback that is never a direct write: it stores an ordinary cycle 1 proposal whose lines are the earlier revision's,
 * so the dry run, the second administrator, the stale check and the audit trail all apply. Reads write nothing.
 * Running missions are never changed: their instances keep manager_instance_id (the impact list only names them).
 */
const Seq = z.coerce.number().int().min(1).max(2_147_483_647);
const SeqParam = z.object({ seq: Seq });
const DiffQs = z.object({ against: z.coerce.number().int().min(0).max(2_147_483_647).optional() }).strict();
const RollbackIn = z.object({ why: z.string().trim().max(2000).optional(), triggers: z.array(z.enum(RESTRUCTURE_TRIGGERS)).max(RESTRUCTURE_TRIGGERS.length * 2).optional() }).strict(); // c64: a rollback can name why too
/** Missions in a final state (or archived) are not running: they are never listed as affected. */
const FINAL = ['completed', 'failed', 'canceled', 'archived'];

type Row = { id: string; seq: number; note: string; created_by: string; active_from: string; created_by_name: string | null; proposal_id: string | null; proposal_title: string | null; agent_id: string | null };
/** Revisions of the tenant with their author's name, the proposal applied as them and the agent whose creation made them. */
const REVISIONS = `select r.*, u.name as created_by_name, p.id as proposal_id, p.title as proposal_title, a.subject as agent_id
  from org_revisions r
  left join users u on u.id = r.created_by and u.tenant_id = r.tenant_id
  left join org_proposals p on p.tenant_id = r.tenant_id and p.applied_revision = r.seq
  left join lateral (select subject from audit_events x where x.tenant_id = r.tenant_id and x.action = 'agent.create' and x.result = 'ok'
                       and case when jsonb_typeof(x.detail->'revision') = 'number' then (x.detail->>'revision')::int end = r.seq order by x.id limit 1) a on true
  where r.tenant_id = $1`;

const sourceOf = (r: Row): OrgRevisionSource =>
  r.proposal_id ? { kind: 'proposal', proposalId: r.proposal_id, title: r.proposal_title ?? '' }
    : r.agent_id ? { kind: 'agent', agentId: r.agent_id }
      : r.created_by === 'system' ? { kind: 'seed' } : { kind: 'other' };
const summary = (r: Row, changed: number): OrgRevisionSummaryDto => ({
  ...revDto(r), createdByName: r.created_by_name ?? r.created_by, source: sourceOf(r), appliedFromProposal: r.proposal_id, changed,
});
const changedCount = (before: OrgEdgeDto[], after: OrgEdgeDto[]) => { const d = diffLines(before, after); return d.added.length + d.removed.length + d.moved.length; };

async function revisionRow(c: Tx | Db, tenantId: string, seq: number): Promise<Row | null> {
  return (await c.query(`${REVISIONS} and r.seq = $2`, [tenantId, seq])).rows[0] ?? null;
}
/** The lines of revision `seq` of this tenant; 0 = before any revision (no lines). null when the tenant has no such revision. */
async function linesAt(c: Tx | Db, tenantId: string, seq: number): Promise<OrgEdgeDto[] | null> {
  if (seq === 0) return [];
  const r = (await c.query('select id from org_revisions where tenant_id=$1 and seq=$2', [tenantId, seq])).rows[0];
  return r ? edgesOf(c, Number(r.id)) : null;
}
/** The revision before `seq` that exists (seq − 1 normally; 0 for the first). */
async function previousSeq(c: Tx | Db, tenantId: string, seq: number): Promise<number> {
  return (await c.query('select coalesce(max(seq), 0)::int as s from org_revisions where tenant_id=$1 and seq < $2', [tenantId, seq])).rows[0].s;
}

/**
 * Active missions the caller can see with an instance of one of `agents` (whose manager differs between two revisions).
 * Same rule as the mission list: tenant, not deleted, VISIBLE_SQL; final or archived missions excluded. Read only.
 */
async function impactOf(c: Tx | Db, viewer: { tenantId: string; admin: boolean; userId: string }, agents: string[]): Promise<OrgImpactDto[]> {
  if (!agents.length) return [];
  return (await c.query(
    `select m.id as mission_id, r.title, i.agent_id, i.id as instance_id, m.demo
       from agent_instances i
       join missions m on m.id = i.mission_id
       join mission_revisions r on r.mission_id = m.id and r.revision = m.current_revision
      where m.tenant_id = $1 and i.tenant_id = $1 and m.deleted_at is null and m.archived_at is null and not (m.status = any($4))
        and ${VISIBLE_SQL('$2', '$3')} and i.agent_id = any($5)
      order by m.id, i.agent_id, i.id`,
    [viewer.tenantId, viewer.admin, viewer.userId, FINAL, agents])).rows
    .map((x) => ({ missionId: x.mission_id, title: x.title, agentId: x.agent_id, instanceId: x.instance_id, demo: x.demo }));
}

export default async function historyRoutes(app: FastifyInstance) {
  /** Every revision, oldest first, with its author's name, its source and how many lines changed against the one before. */
  app.get('/organization/revisions', async (req) => {
    const ctx = await requireUser(req);
    const rows: Row[] = (await app.db.query(`${REVISIONS} order by r.seq`, [ctx.tenantId])).rows;
    const edges = (await app.db.query(
      `select e.revision_id, e.supervisor_id, e.subordinate_id, e.edge_type from org_edges e join org_revisions r on r.id = e.revision_id where r.tenant_id=$1`, [ctx.tenantId])).rows;
    const by = new Map<string, OrgEdgeDto[]>();
    for (const e of edges) { const k = String(e.revision_id); by.set(k, [...(by.get(k) ?? []), { supervisorId: e.supervisor_id, subordinateId: e.subordinate_id, edgeType: e.edge_type }]); }
    let prev: OrgEdgeDto[] = [];
    const agents = await coverageAgents(app.db, ctx.tenantId); // cycle 20: each revision's lines against today's agents
    return {
      revisions: rows.map((r) => { const cur = by.get(String(r.id)) ?? []; const s = { ...summary(r, changedCount(prev, cur)), coverage: revisionCoverage(cur, agents) }; prev = cur; return s; }),
    };
  });

  app.get('/organization/revisions/:seq', async (req) => {
    const ctx = await requireUser(req);
    const { seq } = parse(SeqParam, req.params);
    const r = await revisionRow(app.db, ctx.tenantId, seq);
    if (!r) throw notFound('No such organisation revision.');
    const edges = await edgesOf(app.db, Number(r.id));
    const before = (await linesAt(app.db, ctx.tenantId, await previousSeq(app.db, ctx.tenantId, seq)))!;
    const revision: OrgRevisionDetailDto = { ...summary(r, changedCount(before, edges)), edges };
    return { revision };
  });

  app.get('/organization/revisions/:seq/diff', async (req): Promise<OrgDiffDto> => {
    const ctx = await requireUser(req);
    const { seq } = parse(SeqParam, req.params);
    const qs = parse(DiffQs, req.query ?? {});
    const after = await linesAt(app.db, ctx.tenantId, seq);
    if (!after) throw notFound('No such organisation revision.');
    const against = qs.against ?? await previousSeq(app.db, ctx.tenantId, seq);
    const before = await linesAt(app.db, ctx.tenantId, against);
    if (!before) throw notFound(`No organisation revision ${against} to compare with.`);
    const d = diffLines(before, after);
    const changed = [...new Set([...d.moved.map((m) => m.subordinate), ...d.added.map((e) => e.subordinateId), ...d.removed.map((e) => e.subordinateId)])];
    // against 0 (before any revision): every line is new, no agent's manager changed, so nothing is affected (review m1)
    const impact = against === 0 ? [] : await impactOf(app.db, { tenantId: ctx.tenantId, admin: ctx.user.role === 'admin', userId: ctx.user.id }, changed);
    return { seq, against, ...d, impact };
  });

  /**
   * A rollback is a new proposal, never a direct write: its lines are revision `seq`'s, its base the latest revision,
   * its title "Roll back to revision N". Then it is decided like any other proposal (another administrator, stale check).
   */
  app.post('/organization/revisions/:seq/rollback-proposal', async (req, reply) => {
    const ctx = await requireAdmin(req);
    const { seq } = parse(SeqParam, req.params);
    const b = parse(RollbackIn, req.body ?? {});
    const out = await idempotent(app.db, req, ctx, async (c) => {
      await lockProposals(c, ctx.tenantId);
      await expireDue(c, ctx.tenantId);
      const edges = await linesAt(c, ctx.tenantId, seq);
      if (!edges) throw notFound('No such organisation revision.');
      const cur = await latestRevision(c, ctx.tenantId);
      if (seq === cur.seq) throw new ApiError('NOTHING_TO_ROLL_BACK', 422, `Revision ${seq} is the active revision: there is nothing to roll back.`);
      if (!changedCount((await linesAt(c, ctx.tenantId, cur.seq))!, edges))
        throw new ApiError('NOTHING_TO_ROLL_BACK', 422, `Revision ${seq} has the same reporting lines as the active revision ${cur.seq}: there is nothing to roll back.`);
      if ((await pendingWithEdges(c, ctx.tenantId, edges, cur.seq)).length)
        throw new ApiError('DUPLICATE_PROPOSAL', 409, `A proposal with the reporting lines of revision ${seq} is already waiting for a decision.`);
      return createProposal(c, ctx, { title: `Roll back to revision ${seq}`, why: b.why || `Restores the reporting lines of revision ${seq}.`, baseRevision: cur.seq, edges, triggers: b.triggers,
        // a rollback restores a chart that was approved once: its baseline is the chart as it is, and it adds no hop of its own
        baseline: `No change: keep the current organisation, revision ${cur.seq}, as it is.`,
        expectedCost: `Restores the reporting lines of revision ${seq}, a chart that was already approved once, so it adds no new hops by itself.` }, { rollbackTo: seq, settings: app.cfg.orgGuardrails });
    });
    return reply.status(out.status).send(out.body);
  });
}
