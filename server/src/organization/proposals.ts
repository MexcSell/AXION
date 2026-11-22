import type { FastifyInstance } from 'fastify';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { tx, type Db, type Tx } from '../db.ts';
import { audit } from '../audit.ts';
import { ApiError, notFound, forbidden } from '../errors.ts';
import { requireUser, requireAdmin, type Ctx } from '../auth/session.ts';
import { parse } from '../auth/routes.ts';
import { idempotent } from '../idempotency.ts';
import { emit } from '../events/hooks.ts';
import { createOrgRevision, edgesOf, latestRevision as latest, lockOrg } from '../agents/org.ts';
import { validateOrg, type EdgeIn } from './validate.ts';
import { dryRunCoverage } from './coverageRoutes.ts';
import type { OrgDryRun, OrgProposalDto } from '../../../shared/contracts/src/index.ts';

/**
 * Improvement cycle 1: organisation change proposals. An administrator proposes the full set of reporting lines
 * against the latest revision (baseRevision = org_revisions.seq); the server stores its dry run. Another administrator
 * approves it, which appends exactly one org revision in the same transaction (compare-and-set on status='pending'),
 * or rejects it. Expiry happens on read and on decision (no timers). Every write and every refused decision is audited.
 */
const STORED_EDGE = z.object({ supervisor: z.string(), subordinate: z.string(), edge_type: z.string() });
type StoredEdge = z.infer<typeof STORED_EDGE>;
const Id = z.string().trim().min(1).max(60);
const EdgesIn = z.array(z.object({ supervisorId: Id, subordinateId: Id, edgeType: z.literal('reports_to').default('reports_to') }).strict()).max(500); // the only edge type there is
const CreateIn = z.object({ title: z.string().trim().min(1).max(120), why: z.string().trim().max(2000).default(''), baseRevision: z.number().int().min(0), edges: EdgesIn }).strict();
const DecisionIn = z.object({ decision: z.enum(['approve', 'reject']), note: z.string().trim().max(1000).optional(), sha: z.string().max(128) }).strict();

/** Locale-independent order (it feeds the sha). */
const cmp = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);
const toStored = (edges: EdgeIn[]): StoredEdge[] => edges
  .map((e) => ({ supervisor: e.supervisorId, subordinate: e.subordinateId, edge_type: e.edgeType ?? 'reports_to' }))
  .sort((a, b) => cmp(a.subordinate, b.subordinate) || cmp(a.supervisor, b.supervisor) || cmp(a.edge_type, b.edge_type));
const fromStored = (edges: StoredEdge[]): EdgeIn[] => edges.map((e) => ({ supervisorId: e.supervisor, subordinateId: e.subordinate, edgeType: e.edge_type }));
/** sha256 of the canonical title + why + base revision + sorted edges. */
export function payloadSha(p: { title: string; why: string; baseRevision: number; edges: StoredEdge[] }) {
  const edges = toStored(fromStored(p.edges)).map((e) => [e.supervisor, e.subordinate, e.edge_type]);
  return createHash('sha256').update(JSON.stringify([p.title, p.why, p.baseRevision, edges])).digest('hex');
}

async function dryRun(c: Tx | Db, tenantId: string, edges: EdgeIn[], currentId: number | null): Promise<OrgDryRun> {
  const agents = (await c.query('select id, status, dept, role from agent_definitions where tenant_id=$1', [tenantId])).rows;
  const current = currentId === null ? [] : await edgesOf(c, currentId);
  // cycle 20: the coverage block is facts for the reader (its own key); it never adds an error or a warning, so `ok` is unchanged
  return { ...validateOrg(edges, agents, current), coverage: await dryRunCoverage(c, tenantId, edges, current) };
}

const SELECT = `select p.*, cu.name as created_by_name, du.name as decided_by_name from org_proposals p
  left join users cu on cu.id = p.created_by left join users du on du.id = p.decided_by`;
const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : null);
const dto = (r: any): OrgProposalDto => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
  id: r.id, title: r.title, why: r.why, baseRevision: r.base_revision, edges: fromStored(r.edges).map((e) => ({ ...e, edgeType: e.edgeType! })), sha: r.payload_sha,
  status: r.status, createdBy: r.created_by, createdByName: r.created_by_name ?? r.created_by, createdAt: iso(r.created_at)!, expiresAt: iso(r.expires_at)!,
  decidedBy: r.decided_by, decidedByName: r.decided_by ? (r.decided_by_name ?? r.decided_by) : null, decidedAt: iso(r.decided_at), decisionNote: r.decision_note,
  appliedRevision: r.applied_revision, result: r.result,
});
const one = async (c: Tx, tenantId: string, id: string) => dto((await c.query(`${SELECT} where p.id=$1 and p.tenant_id=$2`, [id, tenantId])).rows[0]);

/** Pending proposals past expires_at become 'expired' (audited, announced). Runs on read and on every decision. */
export async function expireDue(c: Tx, tenantId: string) {
  const gone = (await c.query(`update org_proposals set status='expired', decided_at=now() where tenant_id=$1 and status='pending' and expires_at <= now() returning id`, [tenantId])).rows;
  for (const { id } of gone) {
    const correlationId = 'org-expire-' + id;
    await audit(c, { tenantId, actor: 'system', action: 'org.proposal.expire', subject: id, result: 'ok', correlationId });
    await emit(c, { tenantId, actorKind: 'system', actor: 'system', correlationId, type: 'org.proposalDecided', subject: id, subjectKind: 'org', payload: { status: 'expired' } });
  }
  return gone.length;
}

const staleBase = (seq: number, base: number) => new ApiError('ORG_CHANGED', 409, `The organisation changed meanwhile (revision ${seq} is active, this was made on ${base}). Start again from the current chart.`);
/** Serialises proposal creation per tenant (re-entrant within one transaction). */
export const lockProposals = (c: Tx, tenantId: string) => c.query('select pg_advisory_xact_lock(hashtext($1))', ['org-prop:' + tenantId]);

/**
 * The one way a proposal is stored (POST /organization/proposals and, cycle 4, the rollback proposal): lock, expire,
 * stale-base check, duplicate check (same sha pending), server dry run, insert, audit, announce. Runs inside idempotent().
 * `rollbackTo` (cycle 4) only adds the target revision to the audit detail and the event payload.
 */
export async function createProposal(c: Tx, ctx: Ctx, b: { title: string; why: string; baseRevision: number; edges: EdgeIn[] }, opts: { rollbackTo?: number } = {}) {
  await lockProposals(c, ctx.tenantId);
  await expireDue(c, ctx.tenantId);
  const cur = await latest(c, ctx.tenantId);
  if (cur.seq !== b.baseRevision) throw staleBase(cur.seq, b.baseRevision);
  const edges = toStored(b.edges);
  const sha = payloadSha({ title: b.title, why: b.why, baseRevision: b.baseRevision, edges });
  if ((await c.query(`select 1 from org_proposals where tenant_id=$1 and payload_sha=$2 and status='pending'`, [ctx.tenantId, sha])).rowCount)
    throw new ApiError('DUPLICATE_PROPOSAL', 409, 'The same proposal is already waiting for a decision.');
  const result = await dryRun(c, ctx.tenantId, b.edges, cur.id);
  const id = 'OP-' + randomBytes(16).toString('hex').toUpperCase(); // 128-bit
  await c.query(
    `insert into org_proposals(id, tenant_id, title, why, base_revision, edges, payload_sha, created_by, result) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [id, ctx.tenantId, b.title, b.why, b.baseRevision, JSON.stringify(edges), sha, ctx.user.id, JSON.stringify(result)]);
  const rb = opts.rollbackTo !== undefined ? { rollbackTo: opts.rollbackTo } : {};
  const detail = { baseRevision: b.baseRevision, added: result.added.length, removed: result.removed.length, errors: result.errors.length, warnings: result.warnings.length, ...rb };
  await audit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, action: 'org.proposal.create', subject: id, result: 'ok', correlationId: ctx.correlationId, detail });
  await emit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, correlationId: ctx.correlationId, type: 'org.proposalCreated', subject: id, subjectKind: 'org', payload: { title: b.title, baseRevision: b.baseRevision, ok: result.ok, ...rb } });
  return { status: 201, body: { proposal: await one(c, ctx.tenantId, id) } };
}

/** The pending proposals of a tenant on base revision `base` whose stored lines equal `edges` (any title or why). A stale one
    (older base) does not count: it can only be rejected or withdrawn, so it must not block a fresh proposal. */
export async function pendingWithEdges(c: Tx, tenantId: string, edges: EdgeIn[], base: number) {
  return (await c.query(`select id from org_proposals where tenant_id=$1 and status='pending' and base_revision=$3 and edges = $2::jsonb`, [tenantId, JSON.stringify(toStored(edges)), base])).rows.map((r) => r.id as string);
}

export default async function proposalRoutes(app: FastifyInstance) {
  app.get('/organization/proposals', async (req) => {
    const ctx = await requireUser(req);
    return tx(app.db, async (c) => {
      await expireDue(c, ctx.tenantId);
      const rows = (await c.query(`${SELECT} where p.tenant_id=$1 order by p.created_at desc, p.id limit 200`, [ctx.tenantId])).rows;
      return { proposals: rows.map(dto), activeRevision: (await latest(c, ctx.tenantId)).seq };
    });
  });

  app.post('/organization/proposals', async (req, reply) => {
    const ctx = await requireAdmin(req);
    const b = parse(CreateIn, req.body);
    if ((req.query as { dryRun?: string }).dryRun === '1') { // stores nothing, needs no Idempotency-Key
      const cur = await latest(app.db, ctx.tenantId);
      if (cur.seq !== b.baseRevision) throw staleBase(cur.seq, b.baseRevision);
      return { result: await dryRun(app.db, ctx.tenantId, b.edges, cur.id), baseRevision: cur.seq };
    }
    const out = await idempotent(app.db, req, ctx, (c) => createProposal(c, ctx, b));
    return reply.status(out.status).send(out.body);
  });

  /** A refusal is audited and the transaction still commits (expiry included); the error is thrown after commit. */
  const refuse = async (c: Tx, ctx: Ctx, action: string, id: string, err: ApiError) => {
    await audit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, action, subject: id, result: 'denied', correlationId: ctx.correlationId, detail: { code: err.code } });
    return { err };
  };

  app.post('/organization/proposals/:id/decision', async (req) => {
    const ctx = await requireAdmin(req);
    const { id } = req.params as { id: string };
    const b = parse(DecisionIn, req.body);
    const A = 'org.proposal.decide';
    const out = await tx(app.db, async (c): Promise<{ err: ApiError } | { proposal: OrgProposalDto }> => {
      // lock order: organisation revision lock, then the proposal row (POST /agents takes the revision lock too)
      await lockOrg(c, ctx.tenantId);
      await expireDue(c, ctx.tenantId);
      const p = (await c.query('select * from org_proposals where id=$1 and tenant_id=$2 for update', [id, ctx.tenantId])).rows[0];
      if (!p) return refuse(c, ctx, A, id, notFound('No such proposal.'));
      if (p.created_by === ctx.user.id) return refuse(c, ctx, A, id, new ApiError('SELF_APPROVAL', 403, 'You made this proposal. Another administrator must decide it; you can withdraw it.'));
      if (p.status === 'expired') return refuse(c, ctx, A, id, new ApiError('PROPOSAL_EXPIRED', 409, 'This proposal expired without a decision. Make a new one from the current chart.'));
      if (p.status !== 'pending') return refuse(c, ctx, A, id, new ApiError('PROPOSAL_NOT_PENDING', 409, `This proposal is already ${p.status}.`));
      const edges = STORED_EDGE.array().parse(p.edges);
      if (b.sha !== p.payload_sha || payloadSha({ title: p.title, why: p.why, baseRevision: p.base_revision, edges }) !== p.payload_sha)
        return refuse(c, ctx, A, id, new ApiError('PROPOSAL_CHANGED', 409, 'This proposal is not the one you reviewed. Reload it and review it again.'));
      const note = b.note || null;
      if (b.decision === 'reject') {
        const u = await c.query(`update org_proposals set status='rejected', decided_by=$2, decided_at=now(), decision_note=$3 where id=$1 and tenant_id=$4 and status='pending' returning id`, [id, ctx.user.id, note, ctx.tenantId]);
        if (!u.rowCount) throw new ApiError('PROPOSAL_NOT_PENDING', 409, 'This proposal was decided meanwhile.');
        await audit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, action: A, subject: id, result: 'ok', correlationId: ctx.correlationId, detail: { decision: 'reject' } });
        await emit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, correlationId: ctx.correlationId, type: 'org.proposalDecided', subject: id, subjectKind: 'org', payload: { status: 'rejected' } });
        return { proposal: await one(c, ctx.tenantId, id) };
      }
      const cur = await latest(c, ctx.tenantId);
      if (cur.seq !== p.base_revision) return refuse(c, ctx, A, id, new ApiError('ORG_CHANGED', 409, `The organisation changed since this proposal was made (revision ${cur.seq} is active, it was made on ${p.base_revision}). It can only be rejected or withdrawn.`));
      const check = await dryRun(c, ctx.tenantId, fromStored(edges), cur.id);
      if (!check.ok) return refuse(c, ctx, A, id, new ApiError('ORG_INVALID', 422, `This proposal cannot be applied: ${check.errors[0].message}`));
      const rev = await createOrgRevision(c, { tenantId: ctx.tenantId, edges: fromStored(edges), expectSeq: p.base_revision, note: `Proposal ${id}: ${p.title}`, createdBy: ctx.user.id }); // validates the chart again
      const u = await c.query(
        `update org_proposals set status='applied', decided_by=$2, decided_at=now(), decision_note=$3, applied_revision=$4 where id=$1 and tenant_id=$5 and status='pending' returning id`,
        [id, ctx.user.id, note, rev.seq, ctx.tenantId]);
      if (!u.rowCount) throw new ApiError('PROPOSAL_NOT_PENDING', 409, 'This proposal was decided meanwhile.'); // rolls the revision back
      await audit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, action: A, subject: id, result: 'ok', correlationId: ctx.correlationId, detail: { decision: 'approve', revision: rev.seq } });
      await audit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, action: 'org.revision.apply', subject: String(rev.seq), result: 'ok', correlationId: ctx.correlationId, detail: { proposal: id, from: p.base_revision, edges: edges.length } });
      await emit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, correlationId: ctx.correlationId, type: 'org.proposalDecided', subject: id, subjectKind: 'org', payload: { status: 'applied', revision: rev.seq } });
      await emit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, correlationId: ctx.correlationId, type: 'org.revisionApplied', subject: String(rev.seq), subjectKind: 'org', payload: { proposalId: id, revision: rev.seq, previous: p.base_revision } });
      return { proposal: await one(c, ctx.tenantId, id) };
    });
    if ('err' in out) throw out.err;
    return out;
  });

  app.post('/organization/proposals/:id/withdraw', async (req) => {
    const ctx = await requireAdmin(req);
    const { id } = req.params as { id: string };
    const A = 'org.proposal.withdraw';
    const out = await tx(app.db, async (c): Promise<{ err: ApiError } | { proposal: OrgProposalDto }> => {
      await expireDue(c, ctx.tenantId);
      const p = (await c.query('select * from org_proposals where id=$1 and tenant_id=$2 for update', [id, ctx.tenantId])).rows[0];
      if (!p) return refuse(c, ctx, A, id, notFound('No such proposal.'));
      if (p.created_by !== ctx.user.id) return refuse(c, ctx, A, id, forbidden('Only the author can withdraw a proposal.'));
      if (p.status === 'expired') return refuse(c, ctx, A, id, new ApiError('PROPOSAL_EXPIRED', 409, 'This proposal already expired.'));
      if (p.status !== 'pending') return refuse(c, ctx, A, id, new ApiError('PROPOSAL_NOT_PENDING', 409, `This proposal is already ${p.status}.`));
      const u = await c.query(`update org_proposals set status='withdrawn', decided_by=$2, decided_at=now() where id=$1 and tenant_id=$3 and status='pending' returning id`, [id, ctx.user.id, ctx.tenantId]);
      if (!u.rowCount) throw new ApiError('PROPOSAL_NOT_PENDING', 409, 'This proposal was decided meanwhile.');
      await audit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, action: A, subject: id, result: 'ok', correlationId: ctx.correlationId });
      await emit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, correlationId: ctx.correlationId, type: 'org.proposalDecided', subject: id, subjectKind: 'org', payload: { status: 'withdrawn' } });
      return { proposal: await one(c, ctx.tenantId, id) };
    });
    if ('err' in out) throw out.err;
    return out;
  });
}
