import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { audit } from '../audit.ts';
import type { Db, Tx } from '../db.ts';
import { ApiError, notFound } from '../errors.ts';
import { requireAdmin } from '../auth/session.ts';
import { parse } from '../auth/routes.ts';
import { idempotent } from '../idempotency.ts';
import { advisoryXactLock } from '../locks.ts';
import { boundActionOf, consumeApproval } from '../approvals/service.ts';
import { isGuardedPath, normalisePath, releaseDigest } from './guard.ts';
import type { LastGoodDto, ReleaseDto, ReleaseMarkDto, ReleasesDto } from '../../../shared/contracts/src/index.ts';

/**
 * Release, last-good and rollback-target RECORDS (c76 R1; PARKED for owner decision Q11). Administrators only.
 * HARD RULE: no route here, or anywhere, releases, deploys, restarts or rolls back, and none stores or serves a file. A record says what a person
 * says happened. The one guardrail: a release record whose change touches the policy, approvals, audit, locks or migrations is refused unless an
 * approved R4 request bound to that exact release (tenant, version, paths) is named; that approval is spent by the record.
 */
const IssueIn = z.object({
  version: z.string().regex(/^[0-9A-Za-z][0-9A-Za-z._+-]{0,63}$/),
  what: z.string().trim().min(1).max(1000),
  changePaths: z.array(z.string().max(1000)).min(1).max(200),
  fromApprovals: z.array(z.string().min(1).max(64)).max(50).optional(),
  guardrailApprovalId: z.string().min(1).max(64).optional(),
}).strict();
const MarkIn = z.object({
  kind: z.enum(['last_good', 'rollback_target']),
  targetReleaseId: z.string().max(64).optional(),
  reason: z.string().trim().min(1).max(500).optional(),
}).strict();
const ID = /^REL-[0-9A-F]{32}$/;
const iso = (d: unknown) => new Date(d as string).toISOString();
type Q = Db | Tx;

const dto = (r: Record<string, any>): ReleaseDto => ({
  id: r.id, version: r.version, what: r.what, changePaths: [...r.change_paths], guardedPaths: [...r.guarded_paths], fromApprovals: [...r.from_approvals],
  guardrailApprovalId: r.guardrail_approval_id, releasedBy: r.released_by, releasedByName: r.by_name ?? r.released_by, createdAt: iso(r.created_at),
});
const markDto = (r: Record<string, any>): ReleaseMarkDto => ({
  id: String(r.id), releaseId: r.release_id, version: r.version, kind: r.kind, targetReleaseId: r.target_release_id, targetVersion: r.target_version ?? null,
  markedBy: r.marked_by, markedByName: r.by_name ?? r.marked_by, reason: r.reason, createdAt: iso(r.created_at),
});
const lastGoodDto = (r: Record<string, any>): LastGoodDto => ({ id: String(r.id), releaseId: r.release_id, version: r.version, markedBy: r.marked_by, markedByName: r.by_name ?? r.marked_by, reason: r.reason, createdAt: iso(r.created_at) });
const REL = `select r.*, u.name as by_name from releases r left join users u on u.id = r.released_by`;
const MARK = `select m.*, r.version, tr.version as target_version, u.name as by_name from release_marks m join releases r on r.id = m.release_id
  left join releases tr on tr.id = m.target_release_id left join users u on u.id = m.marked_by`;

/** Why a named approval does not authorise this release, or null when it does. Read-only; the authoritative check repeats under the row lock. */
async function approvalProblem(q: Q, tenantId: string, id: string, digest: string, recorderId: string, lock = false): Promise<string | null> {
  const a = (await q.query(`select *, (expires_at <= now()) as db_expired from approval_requests where id=$1 and tenant_id=$2 ${lock ? 'for update' : ''}`, [id, tenantId])).rows[0];
  if (!a) return 'approval_not_found';
  if (a.risk !== 'R4') return 'approval_not_r4';
  if (a.state !== 'approved') return 'approval_not_approved';
  if (a.consumed_at) return 'approval_already_used';
  if (a.db_expired) return 'approval_expired';
  if (a.payload?.releaseDigest !== digest) return 'approval_not_bound_to_this_release';
  // F1: a release needs a second person. The one who decided the R4 request cannot be the one who records the release.
  if ((await q.query(`select 1 from approval_decisions where approval_id=$1 and decision='approved' and decided_by=$2`, [id, recorderId])).rowCount) return 'approval_decided_by_recorder';
  return null;
}

/** One error per refusal reason: a recorder who decided the approval is SELF_APPROVAL (needs a second person), every other reason is POLICY_DENIED. */
const refusal = (why: string) => why === 'approval_decided_by_recorder'
  ? new ApiError('SELF_APPROVAL', 403, 'You decided this approval, so someone else must record this release. A guarded release needs a second administrator.')
  : new ApiError('POLICY_DENIED', 403, `The named approval does not authorise this release (${why}).`);

export default async function releaseRoutes(app: FastifyInstance) {
  app.get('/releases', async (req): Promise<ReleasesDto> => {
    const ctx = await requireAdmin(req);
    const [rels, good, targets, marks] = await Promise.all([
      app.db.query(`${REL} where r.tenant_id=$1 order by r.created_at desc, r.id limit 200`, [ctx.tenantId]),
      app.db.query(`${MARK} where m.tenant_id=$1 and m.kind='last_good' order by m.id desc limit 1`, [ctx.tenantId]),
      app.db.query(`${MARK} where m.id in (select distinct on (release_id) id from release_marks where tenant_id=$1 and kind='rollback_target' order by release_id, id desc) order by m.id desc`, [ctx.tenantId]),
      app.db.query(`${MARK} where m.tenant_id=$1 order by m.id desc limit 100`, [ctx.tenantId]),
    ]);
    return { releases: rels.rows.map(dto), lastGood: good.rows[0] ? lastGoodDto(good.rows[0]) : null, rollbackTargets: targets.rows.map(markDto), marks: marks.rows.map(markDto) };
  });

  app.post('/releases', async (req, reply) => {
    const ctx = await requireAdmin(req);
    const b = parse(IssueIn, req.body);
    const paths: string[] = [];
    for (const p of b.changePaths) {
      const n = normalisePath(p);
      if (!n.ok) throw new ApiError('VALIDATION', 422, 'Some fields are not valid.', { fieldErrors: { changePaths: n.reason } });
      if (!paths.includes(n.path)) paths.push(n.path);
    }
    const guarded = paths.filter(isGuardedPath).sort();
    const digest = releaseDigest(ctx.tenantId, b.version, paths);
    const deny = async (reason: string) => {
      await audit(app.db, { tenantId: ctx.tenantId, actor: ctx.user.id, action: 'release.record', subject: b.version, result: 'denied', correlationId: ctx.correlationId, detail: { reason, guardedPaths: guarded, guardrailApprovalId: b.guardrailApprovalId ?? null } });
      throw guarded.length && !b.guardrailApprovalId
        ? new ApiError('POLICY_DENIED', 403, 'This release changes guarded paths (policy, approvals, audit, locks or migrations). It needs an approved R4 request bound to this release.')
        : refusal(reason);
    };
    if (guarded.length && !b.guardrailApprovalId) await deny('guarded_paths_need_r4_approval');
    if (guarded.length) { const why = await approvalProblem(app.db, ctx.tenantId, b.guardrailApprovalId!, digest, ctx.user.id); if (why) await deny(why); }
    if (!guarded.length && b.guardrailApprovalId) throw new ApiError('VALIDATION', 422, 'Some fields are not valid.', { fieldErrors: { guardrailApprovalId: 'This release touches no guarded path, so it carries no guardrail approval.' } });
    const from = [...new Set(b.fromApprovals ?? [])];
    const out = await idempotent(app.db, req, ctx, async (c) => {
      if (from.length) {
        const ok = (await c.query(`select id from approval_requests where tenant_id=$1 and id = any($2::text[]) and state='approved'`, [ctx.tenantId, from])).rows.map((r) => r.id);
        const missing = from.filter((x) => !ok.includes(x));
        if (missing.length) throw new ApiError('VALIDATION', 422, 'Some fields are not valid.', { fieldErrors: { fromApprovals: `Not an approved request of this company: ${missing.join(', ')}.` } });
      }
      await advisoryXactLock(c, `release:${ctx.tenantId}:${b.version}`);
      if ((await c.query('select 1 from releases where tenant_id=$1 and version=$2', [ctx.tenantId, b.version])).rowCount) throw new ApiError('CONFLICT', 409, `Version ${b.version} already has a release record.`);
      if (guarded.length) {
        const why = await approvalProblem(c, ctx.tenantId, b.guardrailApprovalId!, digest, ctx.user.id, true);
        if (why) throw refusal(why);
        const row = (await c.query('select * from approval_requests where id=$1', [b.guardrailApprovalId])).rows[0];
        await consumeApproval(c, { approvalId: row.id, action: boundActionOf(row), by: ctx.user.id });
      }
      const id = 'REL-' + randomBytes(16).toString('hex').toUpperCase();
      await c.query(`insert into releases(id, tenant_id, version, what, change_paths, guarded_paths, from_approvals, guardrail_approval_id, released_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [id, ctx.tenantId, b.version, b.what, paths, guarded, from, guarded.length ? b.guardrailApprovalId : null, ctx.user.id]);
      await audit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, action: 'release.record', subject: id, result: 'ok', correlationId: ctx.correlationId,
        detail: { version: b.version, changePaths: paths.length, guardedPaths: guarded, guardrailApprovalId: guarded.length ? b.guardrailApprovalId : null, fromApprovals: from, recordOnly: true } });
      return { status: 201, body: { release: dto((await c.query(`${REL} where r.id=$1`, [id])).rows[0]) } };
    });
    return reply.status(out.status).send(out.body);
  });

  app.post('/releases/:id/marks', async (req, reply) => {
    const ctx = await requireAdmin(req);
    const { id } = req.params as { id: string };
    const b = parse(MarkIn, req.body);
    if ((b.kind === 'rollback_target') !== (b.targetReleaseId !== undefined)) throw new ApiError('VALIDATION', 422, 'Some fields are not valid.', { fieldErrors: { targetReleaseId: b.kind === 'rollback_target' ? 'A rollback target names the release to return to.' : 'Only a rollback target names another release.' } });
    const out = await idempotent(app.db, req, ctx, async (c) => {
      const has = async (rid: string) => ID.test(rid) && (await c.query('select 1 from releases where id=$1 and tenant_id=$2', [rid, ctx.tenantId])).rowCount;
      if (!(await has(id))) throw notFound('No such release.');
      if (b.targetReleaseId !== undefined) {
        if (!(await has(b.targetReleaseId))) throw notFound('No such release to return to.');
        if (b.targetReleaseId === id) throw new ApiError('VALIDATION', 422, 'Some fields are not valid.', { fieldErrors: { targetReleaseId: 'A release cannot be its own rollback target.' } });
        const good = (await c.query(`select 1 from release_marks where tenant_id=$1 and release_id=$2 and kind='last_good' limit 1`, [ctx.tenantId, b.targetReleaseId])).rowCount;
        if (!good) throw new ApiError('VALIDATION', 422, 'Some fields are not valid.', { fieldErrors: { targetReleaseId: 'Only a release that was once marked last good can be a rollback target.' } });
      }
      await advisoryXactLock(c, `release-marks:${ctx.tenantId}`);
      const mid = (await c.query(`insert into release_marks(tenant_id, release_id, kind, target_release_id, marked_by, reason) values ($1,$2,$3,$4,$5,$6) returning id`,
        [ctx.tenantId, id, b.kind, b.targetReleaseId ?? null, ctx.user.id, b.reason ?? null])).rows[0].id;
      await audit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, action: 'release.mark', subject: id, result: 'ok', correlationId: ctx.correlationId,
        detail: { kind: b.kind, targetReleaseId: b.targetReleaseId ?? null, reason: b.reason ?? null, recordOnly: true } });
      return { status: 201, body: { mark: markDto((await c.query(`${MARK} where m.id=$1`, [mid])).rows[0]) } };
    });
    return reply.status(out.status).send(out.body);
  });
}
