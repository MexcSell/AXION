import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { tx, type Tx } from '../db.ts';
import { audit } from '../audit.ts';
import { ApiError, notFound } from '../errors.ts';
import { requireAdmin } from '../auth/session.ts';
import { parse } from '../auth/routes.ts';
import { idempotent } from '../idempotency.ts';
import { emit } from '../events/hooks.ts';
import { normaliseOrigin, REFUSAL_TEXT } from './origin.ts';
import { GRANTABLE, MAX_GRANT_MS, assertNormal, checkOrigin, decideGrant, newGrantId } from './service.ts';
import type { SiteGrantDto, SiteGrantState } from '../../../shared/contracts/src/index.ts';
import { advisoryXactLock } from '../locks.ts';

/**
 * Site grants (c36, spec §11 site_grants, browser.originGrant). Administrators only. Issuing a grant is an R3 action: it goes
 * through evaluate() with kind origin-grant, and the administrator who issues it is the approver the policy names. An expiry is
 * required and capped at 30 days. A grant is never edited: it can be revoked once. Every refusal of a hostile origin is audited.
 */
const IssueIn = z.object({
  origin: z.string().max(2048),
  missionId: z.string().trim().min(1).max(64),
  capabilities: z.array(z.enum(GRANTABLE)).min(1).max(GRANTABLE.length),
  expiresAt: z.string().max(40),
}).strict();
const RevokeIn = z.object({ reason: z.string().trim().max(500).optional() }).strict();
const ID = /^SG-[0-9A-F]{32}$/;
const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : null);

// c70 (H11b): the state is judged by the database clock (`db_expired`, same statement as the row), never by Date.now()
const SELECT = `select g.*, (g.expires_at <= now()) as db_expired, iu.name as issued_by_name, ru.name as revoked_by_name from site_grants g
  left join users iu on iu.id = g.issued_by left join users ru on ru.id = g.revoked_by`;
function dto(r: Record<string, any>): SiteGrantDto {
  const state: SiteGrantState = r.revoked_at ? 'revoked' : r.db_expired ? 'expired' : 'active';
  return {
    id: r.id, missionId: r.mission_id, origin: r.exact_origin, capabilities: [...r.capabilities], issuedBy: r.issued_by, issuedByName: r.issued_by_name ?? r.issued_by,
    issuedAt: iso(r.issued_at)!, expiresAt: iso(r.expires_at)!, state, revokedAt: iso(r.revoked_at), revokedBy: r.revoked_by, revokedByName: r.revoked_by ? (r.revoked_by_name ?? r.revoked_by) : null,
    reason: r.reason, tier: 'R3',
  };
}
const one = async (c: Tx, tenantId: string, id: string) => { const r = (await c.query(`${SELECT} where g.id=$1 and g.tenant_id=$2`, [id, tenantId])).rows[0]; return r ? dto(r) : undefined; };

export default async function grantRoutes(app: FastifyInstance) {
  app.get('/site-grants', async (req) => {
    const ctx = await requireAdmin(req);
    const q = req.query as { mission?: string };
    const rows = (await app.db.query(`${SELECT} where g.tenant_id=$1 ${q.mission ? 'and g.mission_id=$2' : ''} order by g.issued_at desc, g.id limit 200`, q.mission ? [ctx.tenantId, q.mission] : [ctx.tenantId])).rows;
    return { grants: rows.map((r) => dto(r)), maxDays: 30, capabilities: GRANTABLE };
  });

  // Pure check of the same rules the issue route applies: no database, no network, nothing stored. The dialog calls it as you type.
  app.get('/site-grants/validate', async (req) => {
    await requireAdmin(req);
    const o = (req.query as { origin?: unknown }).origin;
    return checkOrigin(typeof o === 'string' ? o : undefined);
  });

  app.post('/site-grants', async (req, reply) => {
    const ctx = await requireAdmin(req);
    const b = parse(IssueIn, req.body);
    const n = normaliseOrigin(b.origin);
    if (!n.ok) {
      await audit(app.db, { tenantId: ctx.tenantId, actor: ctx.user.id, action: 'grant.issue', subject: 'origin', result: 'denied', correlationId: ctx.correlationId, detail: { reason: n.reason, input: JSON.stringify(b.origin.slice(0, 120)) } }); // escaped: jsonb cannot hold a NUL
      throw new ApiError('VALIDATION', 422, 'That origin cannot be granted.', { fieldErrors: { origin: REFUSAL_TEXT[n.reason] } });
    }
    const exp = /^\d{4}-\d{2}-\d{2}T[0-9:.]+(Z|[+-]\d{2}:\d{2})$/.test(b.expiresAt) ? Date.parse(b.expiresAt) : NaN; // a zone is required: no server-local guessing
    if (!Number.isFinite(exp)) throw new ApiError('VALIDATION', 422, 'Some fields are not valid.', { fieldErrors: { expiresAt: 'An expiry date and time with a time zone (for example 2026-12-01T10:00:00Z) is required.' } });
    // c70 (H11b): "in the future" and the 30-day cap are judged by the database clock, in SQL, in one statement (also gives the clock decideGrant is handed)
    const clk = (await app.db.query(`select (extract(epoch from now()) * 1000)::float8 as now_ms, ($1::timestamptz <= now()) as past, ($1::timestamptz > now() + ($2::float8 * interval '1 millisecond')) as far`, [new Date(exp).toISOString(), MAX_GRANT_MS])).rows[0];
    const now = Number(clk.now_ms);
    if (clk.past) throw new ApiError('VALIDATION', 422, 'Some fields are not valid.', { fieldErrors: { expiresAt: 'The expiry must be in the future.' } });
    if (clk.far) throw new ApiError('VALIDATION', 422, 'Some fields are not valid.', { fieldErrors: { expiresAt: 'A grant lasts at most 30 days.' } });
    const decision = decideGrant(n.origin, b.missionId, { id: ctx.user.id, role: ctx.user.role }, now);
    if (decision.outcome === 'deny') {
      await audit(app.db, { tenantId: ctx.tenantId, actor: ctx.user.id, action: 'grant.issue', subject: n.origin, result: 'denied', correlationId: ctx.correlationId, detail: { reasons: decision.reasons, policyVersion: decision.policyVersion } });
      throw new ApiError('POLICY_DENIED', 403, 'The policy does not allow this grant.');
    }
    const out = await idempotent(app.db, req, ctx, async (c) => {
      const m = (await c.query('select 1 from missions where id=$1 and tenant_id=$2 and deleted_at is null', [b.missionId, ctx.tenantId])).rowCount;
      if (!m) throw new ApiError('VALIDATION', 422, 'Some fields are not valid.', { fieldErrors: { missionId: 'No such mission.' } });
      await advisoryXactLock(c, `site-grant:${ctx.tenantId}:${b.missionId}:${n.origin}`); // two concurrent issues of the same grant: one waits, then sees the other
      const dup = (await c.query(`select expires_at from site_grants where tenant_id=$1 and mission_id=$2 and exact_origin=$3 and revoked_at is null and expires_at > now()`, [ctx.tenantId, b.missionId, n.origin])).rows[0];
      if (dup) throw new ApiError('CONFLICT', 409, `This mission already has a grant for ${n.origin} until ${new Date(dup.expires_at).toISOString()}. Revoke it first to change it.`);
      const id = newGrantId();
      const caps = [...new Set(b.capabilities)];
      await c.query(`insert into site_grants(id, tenant_id, mission_id, exact_origin, capabilities, issued_by, issued_at, expires_at) values ($1,$2,$3,$4,$5,$6,now(),$7)`,
        [id, ctx.tenantId, b.missionId, assertNormal(n.origin), caps, ctx.user.id, new Date(exp).toISOString()]); // issued_at is the database clock, the one expires_at is compared with
      await audit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, action: 'grant.issue', subject: id, result: 'ok', correlationId: ctx.correlationId,
        detail: { origin: n.origin, missionId: b.missionId, capabilities: caps, expiresAt: new Date(exp).toISOString(), tier: decision.tier, approver: decision.approver, approverId: ctx.user.id, approval: 'issuer is approver (single-admin approval)', policyVersion: decision.policyVersion, reasons: decision.reasons } });
      await emit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, correlationId: ctx.correlationId, type: 'grant.issued', subject: id, adminOnly: true, payload: { grantId: id, missionId: b.missionId, origin: n.origin } });
      return { status: 201, body: { grant: await one(c, ctx.tenantId, id), decision: { tier: decision.tier, approver: decision.approver, policyVersion: decision.policyVersion, reasons: decision.reasons } } };
    });
    return reply.status(out.status).send(out.body);
  });

  app.post('/site-grants/:id/revoke', async (req) => {
    const ctx = await requireAdmin(req);
    const { id } = req.params as { id: string };
    const b = parse(RevokeIn, req.body ?? {});
    const out = await tx(app.db, async (c): Promise<{ err: ApiError } | { grant: SiteGrantDto }> => {
      const refuse = async (err: ApiError) => { await audit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, action: 'grant.revoke', subject: id.slice(0, 40), result: 'denied', correlationId: ctx.correlationId, detail: { code: err.code } }); return { err }; };
      const g = ID.test(id) ? (await c.query('select * from site_grants where id=$1 and tenant_id=$2 for update', [id, ctx.tenantId])).rows[0] : undefined;
      if (!g) return refuse(notFound('No such grant.'));
      if (g.revoked_at) return refuse(new ApiError('CONFLICT', 409, 'This grant was already revoked.'));
      await c.query('update site_grants set revoked_at=now(), revoked_by=$2, reason=$3 where id=$1', [id, ctx.user.id, b.reason ?? null]);
      await audit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, action: 'grant.revoke', subject: id, result: 'ok', correlationId: ctx.correlationId, detail: { origin: g.exact_origin, missionId: g.mission_id, reason: b.reason ?? null } });
      await emit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, correlationId: ctx.correlationId, type: 'grant.revoked', subject: id, adminOnly: true, payload: { grantId: id, missionId: g.mission_id, origin: g.exact_origin } });
      return { grant: (await one(c, ctx.tenantId, id))! };
    });
    if ('err' in out) throw out.err;
    return out;
  });
}
