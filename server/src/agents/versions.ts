import type { FastifyInstance } from 'fastify';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { tx, type Tx } from '../db.ts';
import { audit } from '../audit.ts';
import { ApiError, notFound, forbidden } from '../errors.ts';
import { requireUser, requireAdmin, type Ctx } from '../auth/session.ts';
import { parse } from '../auth/routes.ts';
import { idempotent } from '../idempotency.ts';
import { emit } from '../events/hooks.ts';
import { getAgent, lockAgent, lockAndReadAgent, promptHash, switchVersion, type AgentBase } from './service.ts';
import { attachReliability } from './reliability.ts';
import type { AgentVersionDto, VersionConfig, VersionDiff, VersionProposalDto } from '../../../shared/contracts/src/index.ts';

/**
 * Improvement cycle 5: agent version proposals, promote and rollback under governance (spec §4.11, §10.9, Stage 10;
 * subnet-scout evolution.py: promotion bound to the base, 409 if the agent changed since, rollback restores a version).
 *
 * An administrator proposes a candidate {model, skills, tools} against the agent's active version (the base). Another
 * administrator promotes it: in one transaction under the agent lock (lockAgent, the same lock PATCH /agents/:id takes)
 * the checks run in this order: still pending, the base is still active (409 AGENT_CHANGED), the reviewed sha matches
 * (409 PROPOSAL_CHANGED), not expired (409 PROPOSAL_EXPIRED). Promote then adds a new immutable version through the
 * Stage 6 path (addVersion) and makes it active. Rollback adds a new version equal to an earlier one (append-only: no
 * version is deleted or reused). Running instances keep their pinned agent_version_id throughout.
 * Every write and every refused decision is audited. No evaluation numbers exist yet: the DTO says so (evaluation: null).
 */
const Str = z.string().trim();
const List = z.array(Str.min(1).max(80)).max(50);
const Config = z.object({ model: Str.min(1).max(120), skills: List, tools: List }).strict();
const CreateIn = z.object({ title: Str.min(1).max(120), hypothesis: Str.min(1).max(2000), candidate: Config, baseVersionId: z.string().max(64) }).strict();
const DecisionIn = z.object({ decision: z.enum(['promote', 'reject']), sha: z.string().max(128), note: Str.max(1000).optional() }).strict();
const RollbackIn = z.object({ toVersionId: z.string().max(64), why: Str.min(1).max(1000) }).strict();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TTL_DAYS = 14;

const uniq = (xs: string[]) => [...new Set(xs.map((x) => x.trim()).filter(Boolean))];
/** Trimmed model; skills and tools trimmed, empty ones dropped, de-duplicated (first position kept). */
export const normalizeConfig = (c: VersionConfig): VersionConfig => ({ model: c.model.trim(), skills: uniq(c.skills), tools: uniq(c.tools) });

/** base → candidate. Skills and tools are sets: a different order is no change. */
export function configDiff(a: VersionConfig, b: VersionConfig): VersionDiff {
  const minus = (x: string[], y: string[]) => x.filter((v) => !y.includes(v));
  const skillsAdded = minus(uniq(b.skills), uniq(a.skills)), skillsRemoved = minus(uniq(a.skills), uniq(b.skills));
  const toolsAdded = minus(uniq(b.tools), uniq(a.tools)), toolsRemoved = minus(uniq(a.tools), uniq(b.tools));
  const model = a.model !== b.model ? { from: a.model, to: b.model } : null;
  return { skillsAdded, skillsRemoved, toolsAdded, toolsRemoved, model, changed: !!model || skillsAdded.length + skillsRemoved.length + toolsAdded.length + toolsRemoved.length > 0 };
}

const cfgOf = (x: { model: string; skills: unknown; tools: unknown }): VersionConfig => ({ model: x.model, skills: x.skills as string[], tools: x.tools as string[] });
/** What a decision is bound to: the agent, the base (id and config sha), the candidate, the title and the hypothesis. */
export function proposalSha(r: { agent_id: string; base_version_id: string; base_sha: string; candidate: VersionConfig; title: string; hypothesis: string }) {
  return createHash('sha256').update(JSON.stringify([r.agent_id, r.base_version_id, r.base_sha, r.candidate.model, r.candidate.skills, r.candidate.tools, r.title, r.hypothesis])).digest('hex');
}

const SELECT = `select p.*, d.name as agent_name, d.active_version_id, bv.label as base_label, bv.model as base_model, bv.skills as base_skills, bv.tools as base_tools,
    pv.label as promoted_label, cu.name as created_by_name, du.name as decided_by_name
  from agent_version_proposals p
  join agent_definitions d on d.id = p.agent_id
  join agent_versions bv on bv.id = p.base_version_id
  left join agent_versions pv on pv.id = p.promoted_version_id
  left join users cu on cu.id = p.created_by
  left join users du on du.id = p.decided_by`;
const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : null);
const dto = (r: any): VersionProposalDto => { // eslint-disable-line @typescript-eslint/no-explicit-any
  const base = cfgOf({ model: r.base_model, skills: r.base_skills, tools: r.base_tools }), candidate = cfgOf(r.candidate);
  return {
    id: r.id, agentId: r.agent_id, agentName: r.agent_name, title: r.title, hypothesis: r.hypothesis,
    baseVersionId: r.base_version_id, baseVersionLabel: r.base_label, baseSha: r.base_sha, base,
    candidate, candidateSha: r.candidate_sha, diff: configDiff(base, candidate), sha: proposalSha({ ...r, candidate }),
    status: r.status, activeVersionId: r.active_version_id, stale: r.status === 'pending' && r.active_version_id !== r.base_version_id,
    createdBy: r.created_by, createdByName: r.created_by_name ?? r.created_by, createdAt: iso(r.created_at)!, expiresAt: iso(r.expires_at)!,
    decidedBy: r.decided_by, decidedByName: r.decided_by ? (r.decided_by_name ?? r.decided_by) : null, decidedAt: iso(r.decided_at), note: r.note,
    promotedVersionId: r.promoted_version_id, promotedVersionLabel: r.promoted_label ?? null, evaluation: null,
  };
};
const one = async (c: Tx, tenantId: string, id: string) => dto((await c.query(`${SELECT} where p.id=$1 and p.tenant_id=$2`, [id, tenantId])).rows[0]);

const decided = (c: Tx, tenantId: string, agentId: string, actor: string, correlationId: string, payload: Record<string, unknown>, actorKind?: 'system') =>
  emit(c, { tenantId, actor, actorKind, correlationId, type: 'agent.versionProposalDecided', subject: agentId, subjectKind: 'agent', payload });

/** Pending proposals past expires_at become 'expired' (audited, announced). Runs on read and on create. */
export async function expireDue(c: Tx, tenantId: string) {
  const gone = (await c.query(`update agent_version_proposals set status='expired', decided_at=now() where tenant_id=$1 and status='pending' and expires_at <= now() returning id, agent_id`, [tenantId])).rows;
  for (const g of gone) await expired(c, tenantId, g.id, g.agent_id);
  return gone.length;
}
async function expired(c: Tx, tenantId: string, id: string, agentId: string) {
  const correlationId = 'agent-version-expire-' + id;
  await audit(c, { tenantId, actor: 'system', action: 'agent.version.expire', subject: id, result: 'ok', correlationId, detail: { agentId } });
  await decided(c, tenantId, agentId, 'system', correlationId, { proposalId: id, status: 'expired' }, 'system');
}
/** This one proposal, if it is pending and past expires_at (the database clock decides). */
async function expireOne(c: Tx, tenantId: string, id: string) {
  const r = (await c.query(`update agent_version_proposals set status='expired', decided_at=now() where id=$1 and tenant_id=$2 and status='pending' and expires_at <= now() returning agent_id`, [id, tenantId])).rows[0];
  if (r) await expired(c, tenantId, id, r.agent_id);
  return !!r;
}

/** Announce a new active version the way PATCH /agents/:id does (the catalog and every open profile refresh on these). */
async function announceVersion(c: Tx, ctx: Ctx, agentId: string, v: AgentVersionDto, previousVersionId: string, diff: VersionDiff, extra: Record<string, unknown>) {
  const fields = [diff.model && 'model', (diff.skillsAdded.length || diff.skillsRemoved.length) && 'skills', (diff.toolsAdded.length || diff.toolsRemoved.length) && 'tools'].filter(Boolean);
  await audit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, action: 'agent.version', subject: agentId, result: 'ok', correlationId: ctx.correlationId, detail: { seq: v.seq, label: v.label, from: previousVersionId, ...extra } });
  await emit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, correlationId: ctx.correlationId, type: 'agent.versionCreated', subject: agentId, subjectKind: 'agent', payload: { versionId: v.id, label: v.label, seq: v.seq, previousVersionId, ...extra } });
  await emit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, correlationId: ctx.correlationId, type: 'agent.updated', subject: agentId, subjectKind: 'agent', payload: { fields, versionId: v.id } });
}

const viewerOf = (ctx: Ctx) => ({ tenantId: ctx.tenantId, admin: ctx.user.role === 'admin', userId: ctx.user.id });
const withRel = async (c: Tx, ctx: Ctx, a: AgentBase) => (await attachReliability(c, viewerOf(ctx), [a], false))[0];

export default async function versionRoutes(app: FastifyInstance) {
  app.get('/version-proposals', async (req) => {
    const ctx = await requireUser(req);
    return tx(app.db, async (c) => {
      await expireDue(c, ctx.tenantId);
      const rows = (await c.query(`${SELECT} where p.tenant_id=$1 order by p.created_at desc, p.id limit 200`, [ctx.tenantId])).rows;
      return { proposals: rows.map(dto) };
    });
  });

  app.get('/agents/:id/version-proposals', async (req) => {
    const ctx = await requireUser(req);
    const { id } = req.params as { id: string };
    return tx(app.db, async (c) => {
      if (!(await c.query('select 1 from agent_definitions where id=$1 and tenant_id=$2', [id, ctx.tenantId])).rowCount) throw notFound('No such agent.');
      await expireDue(c, ctx.tenantId);
      const rows = (await c.query(`${SELECT} where p.tenant_id=$1 and p.agent_id=$2 order by p.created_at desc, p.id limit 200`, [ctx.tenantId, id])).rows;
      return { proposals: rows.map(dto) };
    });
  });

  app.post('/agents/:id/version-proposals', async (req, reply) => {
    const ctx = await requireAdmin(req);
    const { id } = req.params as { id: string };
    const b = parse(CreateIn, req.body);
    const out = await idempotent(app.db, req, ctx, async (c) => {
      const cur = await lockAndReadAgent(c, ctx.tenantId, id);
      if (!cur) throw notFound('No such agent.');
      if (b.baseVersionId !== cur.versionId) throw new ApiError('AGENT_CHANGED', 409, `${cur.name} changed meanwhile (${cur.versionLabel} is active now). Start again from the active version.`);
      await expireDue(c, ctx.tenantId);
      const base = cfgOf(cur), candidate = normalizeConfig(b.candidate);
      const diff = configDiff(base, candidate);
      if (!diff.changed) throw new ApiError('CANDIDATE_UNCHANGED', 422, 'The candidate is the same as the active version: change the model, a skill or a tool.');
      const candidateSha = promptHash(candidate.model, candidate.skills, candidate.tools);
      if ((await c.query(`select 1 from agent_version_proposals where tenant_id=$1 and agent_id=$2 and candidate_sha=$3 and status='pending'`, [ctx.tenantId, id, candidateSha])).rowCount)
        throw new ApiError('DUPLICATE_PROPOSAL', 409, 'The same candidate is already waiting for a decision.');
      const baseSha = (await c.query('select prompt_hash from agent_versions where id=$1', [cur.versionId])).rows[0].prompt_hash as string;
      const pid = 'VP-' + randomBytes(16).toString('hex').toUpperCase(); // 128-bit
      await c.query(
        `insert into agent_version_proposals(id, tenant_id, agent_id, base_version_id, base_sha, candidate, candidate_sha, title, hypothesis, created_by, expires_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now() + make_interval(days => $11))`,
        [pid, ctx.tenantId, id, cur.versionId, baseSha, JSON.stringify(candidate), candidateSha, b.title, b.hypothesis, ctx.user.id, TTL_DAYS]);
      const detail = { agentId: id, baseVersionId: cur.versionId, baseLabel: cur.versionLabel, skillsAdded: diff.skillsAdded, skillsRemoved: diff.skillsRemoved, toolsAdded: diff.toolsAdded, toolsRemoved: diff.toolsRemoved, model: diff.model };
      await audit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, action: 'agent.version.propose', subject: pid, result: 'ok', correlationId: ctx.correlationId, detail });
      await emit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, correlationId: ctx.correlationId, type: 'agent.versionProposed', subject: id, subjectKind: 'agent', payload: { proposalId: pid, title: b.title, baseVersionId: cur.versionId } });
      return { status: 201, body: { proposal: await one(c, ctx.tenantId, pid) } };
    });
    return reply.status(out.status).send(out.body);
  });

  /** A refusal is audited and the transaction still commits (an expiry included); the error is thrown after commit. */
  const refuse = async (c: Tx, ctx: Ctx, action: string, id: string, err: ApiError) => {
    await audit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, action, subject: id, result: 'denied', correlationId: ctx.correlationId, detail: { code: err.code } });
    return { err };
  };

  app.post('/version-proposals/:pid/decision', async (req) => {
    const ctx = await requireAdmin(req);
    const { pid } = req.params as { pid: string };
    const b = parse(DecisionIn, req.body);
    const A = 'agent.version.decide';
    const out = await tx(app.db, async (c): Promise<{ err: ApiError } | { proposal: VersionProposalDto }> => {
      const head = (await c.query('select agent_id from agent_version_proposals where id=$1 and tenant_id=$2', [pid, ctx.tenantId])).rows[0];
      if (!head) return refuse(c, ctx, A, pid, notFound('No such proposal.'));
      await lockAgent(c, ctx.tenantId, head.agent_id); // lock order: the agent, then the proposal row
      const p = (await c.query('select * from agent_version_proposals where id=$1 and tenant_id=$2 for update', [pid, ctx.tenantId])).rows[0];
      if (p.created_by === ctx.user.id) return refuse(c, ctx, A, pid, new ApiError('SELF_APPROVAL', 403, 'You proposed this version. Another administrator must decide it; you can withdraw it.'));
      // 1. still pending
      if (p.status === 'expired') return refuse(c, ctx, A, pid, new ApiError('PROPOSAL_EXPIRED', 409, 'This proposal expired without a decision. Propose it again from the active version.'));
      if (p.status !== 'pending') return refuse(c, ctx, A, pid, new ApiError('PROPOSAL_NOT_PENDING', 409, `This proposal is already ${p.status}.`));
      // 2. the base is still the active version (promote only: a stale proposal can still be rejected)
      const cur = (await getAgent(c, ctx.tenantId, p.agent_id, false, true))!;
      if (b.decision === 'promote' && cur.versionId !== p.base_version_id)
        return refuse(c, ctx, A, pid, new ApiError('AGENT_CHANGED', 409, `${cur.name} changed since this was proposed (${cur.versionLabel} is active now). It can only be rejected or withdrawn.`));
      // 3. the proposal is the one that was reviewed, and its stored candidate is intact
      const candidate = cfgOf(Config.parse(p.candidate));
      if (b.sha !== proposalSha({ ...p, candidate }) || p.candidate_sha !== promptHash(candidate.model, candidate.skills, candidate.tools))
        return refuse(c, ctx, A, pid, new ApiError('PROPOSAL_CHANGED', 409, 'This proposal is not the one you reviewed. Reload it and review it again.'));
      // 4. not expired
      if (await expireOne(c, ctx.tenantId, pid)) return refuse(c, ctx, A, pid, new ApiError('PROPOSAL_EXPIRED', 409, 'This proposal expired without a decision. Propose it again from the active version.'));
      const note = b.note || null;
      if (b.decision === 'reject') {
        const u = await c.query(`update agent_version_proposals set status='rejected', decided_by=$2, decided_at=now(), note=$3 where id=$1 and tenant_id=$4 and status='pending' returning id`, [pid, ctx.user.id, note, ctx.tenantId]);
        if (!u.rowCount) throw new ApiError('PROPOSAL_NOT_PENDING', 409, 'This proposal was decided meanwhile.');
        await audit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, action: A, subject: pid, result: 'ok', correlationId: ctx.correlationId, detail: { decision: 'reject', agentId: p.agent_id } });
        await decided(c, ctx.tenantId, p.agent_id, ctx.user.id, ctx.correlationId, { proposalId: pid, status: 'rejected' });
        return { proposal: await one(c, ctx.tenantId, pid) };
      }
      const v = await switchVersion(c, { agentId: p.agent_id, ...candidate, createdBy: ctx.user.id }); // the Stage 6 version path
      const u = await c.query(
        `update agent_version_proposals set status='promoted', decided_by=$2, decided_at=now(), note=$3, promoted_version_id=$4 where id=$1 and tenant_id=$5 and status='pending' returning id`,
        [pid, ctx.user.id, note, v.id, ctx.tenantId]);
      if (!u.rowCount) throw new ApiError('PROPOSAL_NOT_PENDING', 409, 'This proposal was decided meanwhile.'); // rolls the version back
      await audit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, action: A, subject: pid, result: 'ok', correlationId: ctx.correlationId, detail: { decision: 'promote', agentId: p.agent_id, fromVersionId: p.base_version_id, newVersionId: v.id, label: v.label } });
      await emit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, correlationId: ctx.correlationId, type: 'agent.versionPromoted', subject: p.agent_id, subjectKind: 'agent', payload: { proposalId: pid, versionId: v.id, label: v.label, previousVersionId: p.base_version_id } });
      await announceVersion(c, ctx, p.agent_id, v, p.base_version_id, configDiff(cfgOf(cur), candidate), { proposalId: pid });
      return { proposal: await one(c, ctx.tenantId, pid) };
    });
    if ('err' in out) throw out.err;
    return out;
  });

  app.post('/version-proposals/:pid/withdraw', async (req) => {
    const ctx = await requireAdmin(req);
    const { pid } = req.params as { pid: string };
    const A = 'agent.version.withdraw';
    const out = await tx(app.db, async (c): Promise<{ err: ApiError } | { proposal: VersionProposalDto }> => {
      const p = (await c.query('select * from agent_version_proposals where id=$1 and tenant_id=$2 for update', [pid, ctx.tenantId])).rows[0];
      if (!p) return refuse(c, ctx, A, pid, notFound('No such proposal.'));
      if (p.created_by !== ctx.user.id) return refuse(c, ctx, A, pid, forbidden('Only the author can withdraw a proposal.'));
      if (p.status === 'expired' || await expireOne(c, ctx.tenantId, pid)) return refuse(c, ctx, A, pid, new ApiError('PROPOSAL_EXPIRED', 409, 'This proposal already expired.'));
      if (p.status !== 'pending') return refuse(c, ctx, A, pid, new ApiError('PROPOSAL_NOT_PENDING', 409, `This proposal is already ${p.status}.`));
      const u = await c.query(`update agent_version_proposals set status='withdrawn', decided_by=$2, decided_at=now() where id=$1 and tenant_id=$3 and status='pending' returning id`, [pid, ctx.user.id, ctx.tenantId]);
      if (!u.rowCount) throw new ApiError('PROPOSAL_NOT_PENDING', 409, 'This proposal was decided meanwhile.');
      await audit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, action: A, subject: pid, result: 'ok', correlationId: ctx.correlationId, detail: { agentId: p.agent_id } });
      await decided(c, ctx.tenantId, p.agent_id, ctx.user.id, ctx.correlationId, { proposalId: pid, status: 'withdrawn' });
      return { proposal: await one(c, ctx.tenantId, pid) };
    });
    if ('err' in out) throw out.err;
    return out;
  });

  app.post('/agents/:id/rollback', async (req) => {
    const ctx = await requireAdmin(req);
    const { id } = req.params as { id: string };
    const b = parse(RollbackIn, req.body);
    const out = await idempotent(app.db, req, ctx, async (c) => {
      const cur = await lockAndReadAgent(c, ctx.tenantId, id);
      if (!cur) throw notFound('No such agent.');
      const target = UUID.test(b.toVersionId) ? (await c.query('select * from agent_versions where id=$1', [b.toVersionId])).rows[0] : undefined;
      if (!target || target.agent_id !== id) throw new ApiError('VERSION_NOT_OF_AGENT', 422, `That version does not belong to ${cur.name}.`);
      if (target.id === cur.versionId) throw new ApiError('ALREADY_ACTIVE', 422, `${target.label} is already the active version.`);
      const to = cfgOf(target), diff = configDiff(cfgOf(cur), to);
      if (!diff.changed) throw new ApiError('SAME_CONFIG', 422, `${cur.name} already runs the configuration of ${target.label} (${cur.versionLabel}).`);
      const v = await switchVersion(c, { agentId: id, ...to, createdBy: ctx.user.id }); // a NEW version: nothing is deleted or reused
      const detail = { why: b.why, fromVersionId: cur.versionId, fromLabel: cur.versionLabel, toVersionId: target.id, toLabel: target.label, newVersionId: v.id, newLabel: v.label };
      await audit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, action: 'agent.rollback', subject: id, result: 'ok', correlationId: ctx.correlationId, detail });
      await emit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, correlationId: ctx.correlationId, type: 'agent.rolledBack', subject: id, subjectKind: 'agent', payload: { versionId: v.id, label: v.label, toVersionId: target.id, toLabel: target.label, previousVersionId: cur.versionId, why: b.why } });
      await announceVersion(c, ctx, id, v, cur.versionId, diff, { rollbackOf: target.id });
      return { status: 200, body: { agent: await withRel(c, ctx, (await getAgent(c, ctx.tenantId, id))!), version: v } };
    });
    return out.body;
  });
}
