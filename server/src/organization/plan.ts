import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { tx, type Db, type Tx } from '../db.ts';
import { audit } from '../audit.ts';
import { ApiError, notFound, badRequest } from '../errors.ts';
import { requireUser, requireAdmin } from '../auth/session.ts';
import { parse } from '../auth/routes.ts';
import { expireDue } from './proposals.ts';
import { snapshotTx } from '../company/clock.ts';
import { changeBounds, countObservations, labelOf, unitOf, whyNotPlannable } from './plan-metrics.ts';
import {
  AMENDMENT_REASON_MAX, AMENDMENT_REASON_MIN, PLAN_MAX_GUARDRAILS, PLAN_MIN_N_MAX, PLAN_WHY_MAX, PLAN_WHY_MIN, PLAN_WINDOW_MAX_DAYS, PLAN_WINDOW_MIN_DAYS,
  type ChangePlan, type OrgPlanDto, type PlanSetDto, type PlanAmendmentDto, type PlanObservation, type PlanVerdict,
} from '../../../shared/contracts/src/index.ts';

/**
 * c85 (R5-1, first slice): the plan record of an organisation change proposal. It records what was planned before the change. It is not
 * pre-registration in the statistical sense, and it gives no statistical verdict: the readout only counts observations in two windows.
 *
 *  - set or replace: only while the proposal is pending (PUT .../plan);
 *  - at approval the canonical sha256 of the plan is fixed into the record and audited (proposals.ts, decision), after which the plan cannot change,
 *    not even by a direct write (migration 0058 trigger);
 *  - after approval a change is an amendment row (POST .../plan/amendments): new values, a reason, the actor and the database clock; append-only.
 */
const Metric = z.string().trim().max(120).superRefine((id, ctx) => { const why = whyNotPlannable(id); if (why) ctx.addIssue({ code: 'custom', message: why }); });
const Margin = z.number().finite().positive().max(1_000_000_000);
export const PlanIn = z.object({
  primary: z.object({ metric: Metric, direction: z.enum(['up', 'down']), margin: Margin }).strict(),
  minN: z.number().int().min(1).max(PLAN_MIN_N_MAX),
  windowDays: z.number().int().min(PLAN_WINDOW_MIN_DAYS).max(PLAN_WINDOW_MAX_DAYS),
  guardrails: z.array(z.object({ metric: Metric, margin: Margin }).strict()).max(PLAN_MAX_GUARDRAILS),
  why: z.string().trim().min(PLAN_WHY_MIN, `Write at least ${PLAN_WHY_MIN} characters.`).max(PLAN_WHY_MAX),
}).strict().superRefine((p, ctx) => {
  const seen = new Set<string>([p.primary.metric]);
  p.guardrails.forEach((g, i) => {
    if (seen.has(g.metric)) ctx.addIssue({ code: 'custom', path: ['guardrails', i, 'metric'], message: g.metric === p.primary.metric ? 'The primary metric cannot also be a guardrail.' : 'Each guardrail metric can appear once.' });
    seen.add(g.metric);
  });
});
const AmendIn = z.object({ plan: PlanIn, reason: z.string().trim().min(AMENDMENT_REASON_MIN, `Write at least ${AMENDMENT_REASON_MIN} characters.`).max(AMENDMENT_REASON_MAX), baseAmendments: z.number().int().min(0) }).strict();

const cmp = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);
/** The stored shape: guardrails in locale-independent metric order (the order is not a change). */
export const normPlan = (p: z.infer<typeof PlanIn> | ChangePlan): ChangePlan => ({
  primary: { metric: p.primary.metric, direction: p.primary.direction, margin: p.primary.margin }, minN: p.minN, windowDays: p.windowDays,
  guardrails: [...p.guardrails].sort((a, b) => cmp(a.metric, b.metric)).map((g) => ({ metric: g.metric, margin: g.margin })), why: p.why,
});
/** sha256 of the canonical plan: a fixed key order, guardrails sorted by metric id, version 1. */
export function planSha(p: ChangePlan): string {
  const n = normPlan(p);
  return createHash('sha256').update(JSON.stringify({
    v: 1, primaryMetric: n.primary.metric, direction: n.primary.direction, margin: n.primary.margin, minN: n.minN, windowDays: n.windowDays,
    guardrails: n.guardrails.map((g) => ({ metric: g.metric, margin: g.margin })), why: n.why,
  })).digest('hex');
}
/** Which parts of a plan differ from another. */
export function planChanges(a: ChangePlan, b: ChangePlan): string[] {
  const out: string[] = [];
  if (a.primary.metric !== b.primary.metric) out.push('primary.metric');
  if (a.primary.direction !== b.primary.direction) out.push('primary.direction');
  if (a.primary.margin !== b.primary.margin) out.push('primary.margin');
  if (a.minN !== b.minN) out.push('minN');
  if (a.windowDays !== b.windowDays) out.push('windowDays');
  if (JSON.stringify(normPlan(a).guardrails) !== JSON.stringify(normPlan(b).guardrails)) out.push('guardrails');
  if (a.why !== b.why) out.push('why');
  return out;
}

const iso = (d: unknown) => new Date(d as string).toISOString();
type Q = Tx | Db;

async function observationsFor(c: Q, tenantId: string, plan: ChangePlan, revision: number): Promise<PlanObservation[]> {
  const metrics = [{ role: 'primary' as const, metric: plan.primary.metric }, ...plan.guardrails.map((g) => ({ role: 'guardrail' as const, metric: g.metric }))];
  const out: PlanObservation[] = [];
  for (const m of metrics) {
    const n = await countObservations(c, tenantId, m.metric, revision, plan.windowDays);
    out.push({ role: m.role, metric: m.metric, label: labelOf(m.metric), unit: unitOf(m.metric)?.what ?? '', pre: n.pre, post: n.post, minN: plan.minN, preMet: n.pre >= plan.minN, postMet: n.post >= plan.minN });
  }
  return out;
}

/** The readout of one proposal's plan (counts only). Read only; tenant-checked. */
export async function planReadout(c: Q, tenantId: string, id: string): Promise<OrgPlanDto> {
  const p = (await c.query('select id, status, plan, plan_sha, applied_revision from org_proposals where id=$1 and tenant_id=$2', [id, tenantId])).rows[0];
  if (!p) throw notFound('No such proposal.');
  const checkedAt = new Date((await c.query('select now() as now')).rows[0].now);
  const plan: ChangePlan | null = p.plan ? normPlan(p.plan) : null;
  const amRows = (await c.query(
    `select a.seq, a.plan, a.plan_sha, a.reason, a.created_by, a.created_at, u.name as by_name from org_plan_amendments a left join users u on u.id = a.created_by
      where a.tenant_id=$1 and a.proposal_id=$2 order by a.seq`, [tenantId, id])).rows;
  let before = plan;
  const amendments: PlanAmendmentDto[] = amRows.map((r) => {
    const next = normPlan(r.plan);
    const dto: PlanAmendmentDto = { seq: r.seq, plan: next, sha: r.plan_sha, reason: r.reason, createdBy: r.created_by, createdByName: r.by_name ?? r.created_by, createdAt: iso(r.created_at), changed: before ? planChanges(before, next) : [], afterChange: true };
    before = next;
    return dto;
  });
  const effective = amendments.length ? amendments[amendments.length - 1].plan : plan;
  const base = { proposalId: id, proposalStatus: p.status, plan, sha: plan ? planSha(plan) : null, locked: p.status !== 'pending' && plan !== null, amendments, effectivePlan: effective, amendedAfterChange: amendments.length > 0, checkedAt: iso(checkedAt) };
  if (!plan) return { ...base, change: null, windows: null, observations: [], verdict: 'no_plan', verdictText: 'This proposal has no plan.' };
  const bounds = p.applied_revision === null ? null : await changeBounds(c, tenantId, p.applied_revision, plan.windowDays);
  if (!bounds) return { ...base, change: null, windows: null, observations: [], verdict: 'not_applied', verdictText: p.status === 'pending' ? 'The change has not been approved, so there is nothing to count yet. The plan can still be replaced.' : `The change was never applied (the proposal is ${p.status}), so there is nothing to count.` };
  const observations = await observationsFor(c, tenantId, plan, bounds.revision);
  const short = observations.flatMap((o) => [...(o.preMet ? [] : [`${o.label}: ${o.pre} of ${o.minN} before`]), ...(o.postMet ? [] : [`${o.label}: ${o.post} of ${o.minN} after`])]);
  const ready = bounds.postComplete && short.length === 0;
  const verdict: PlanVerdict = ready ? 'ready_for_analysis' : 'not_enough_evidence';
  const why = [...(bounds.postComplete ? [] : ['the observation window after the change is not complete']), ...short];
  const amended = amendments.length ? ` This plan was amended after the change (${amendments.length} amendment${amendments.length === 1 ? '' : 's'}); the counts above are for the plan as it was locked at approval.` : '';
  const verdictText = (ready ? 'Ready for analysis (not computed in this version). These are counts of observations only; they say nothing about the result of the change.' : `There is not enough evidence yet: ${why.join('; ')}. These are counts of observations only.`) + amended;
  return {
    ...base, change: { revision: bounds.revision, activeFrom: iso(bounds.activeFrom) },
    windows: { pre: { from: iso(bounds.preFrom), to: iso(bounds.activeFrom) }, post: { from: iso(bounds.activeFrom), to: iso(bounds.postTo) }, postComplete: bounds.postComplete },
    observations, verdict, verdictText,
  };
}

/** Called inside the decision transaction of an APPROVAL (the proposal row is locked): fixes the plan's sha. Null when there is no plan. */
export function lockedPlanSha(row: { plan: unknown }): string | null { return row.plan ? planSha(normPlan(row.plan as ChangePlan)) : null; }

export default async function planRoutes(app: FastifyInstance) {
  app.get('/organization/proposals/:id/plan', async (req) => {
    const ctx = await requireUser(req);
    const { id } = req.params as { id: string };
    return snapshotTx(app.db, (c) => planReadout(c, ctx.tenantId, id));
  });

  app.put('/organization/proposals/:id/plan', async (req) => {
    const ctx = await requireAdmin(req);
    const { id } = req.params as { id: string };
    const A = 'org.proposal.plan.set';
    const plan = normPlan(parse(PlanIn, req.body));
    const out = await tx(app.db, async (c): Promise<{ err: ApiError } | { dto: PlanSetDto }> => {
      await expireDue(c, ctx.tenantId);
      const p = (await c.query('select id, status from org_proposals where id=$1 and tenant_id=$2 for update', [id, ctx.tenantId])).rows[0];
      const deny = async (err: ApiError) => { await audit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, action: A, subject: id, result: 'denied', correlationId: ctx.correlationId, detail: { code: err.code } }); return { err }; };
      if (!p) return deny(notFound('No such proposal.'));
      if (p.status !== 'pending') return deny(new ApiError('PLAN_LOCKED', 409, `This proposal is ${p.status}. A plan can be set only while it is pending; after approval a change is an amendment.`));
      await c.query('update org_proposals set plan=$3::jsonb where id=$1 and tenant_id=$2 and status=\'pending\'', [id, ctx.tenantId, JSON.stringify(plan)]);
      await audit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, action: A, subject: id, result: 'ok', correlationId: ctx.correlationId, detail: { planSha: planSha(plan), primary: plan.primary.metric, guardrails: plan.guardrails.length } });
      return { dto: { proposalId: id, plan, sha: planSha(plan), locked: false } };
    });
    if ('err' in out) throw out.err;
    return out.dto;
  });

  app.post('/organization/proposals/:id/plan/amendments', async (req, reply) => {
    const ctx = await requireAdmin(req);
    const { id } = req.params as { id: string };
    const A = 'org.proposal.plan.amend';
    const b = parse(AmendIn, req.body);
    const plan = normPlan(b.plan);
    const out = await tx(app.db, async (c): Promise<{ err: ApiError } | { dto: OrgPlanDto }> => {
      const p = (await c.query('select id, status, plan from org_proposals where id=$1 and tenant_id=$2 for update', [id, ctx.tenantId])).rows[0]; // the row lock serialises amendments of one proposal
      const deny = async (err: ApiError) => { await audit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, action: A, subject: id, result: 'denied', correlationId: ctx.correlationId, detail: { code: err.code } }); return { err }; };
      if (!p) return deny(notFound('No such proposal.'));
      if (p.status !== 'applied') return deny(new ApiError('PLAN_NOT_APPLIED', 409, p.status === 'pending' ? 'This proposal is still pending: replace the plan instead of amending it.' : `This proposal is ${p.status}; there was no change to amend a plan for.`));
      if (!p.plan) return deny(new ApiError('PLAN_MISSING', 409, 'This proposal has no plan to amend.'));
      const prior = (await c.query('select seq, plan from org_plan_amendments where tenant_id=$1 and proposal_id=$2 order by seq desc limit 1', [ctx.tenantId, id])).rows[0];
      const count = prior ? prior.seq as number : 0;
      if (count !== b.baseAmendments) return deny(new ApiError('PROPOSAL_CHANGED', 409, 'The plan was amended meanwhile. Reload it and amend the latest version.'));
      const current = normPlan(prior ? prior.plan : p.plan);
      const changed = planChanges(current, plan);
      if (!changed.length) return deny(badRequest('Nothing changed.', { plan: 'Amend at least one value.' }));
      const sha = planSha(plan);
      await c.query('insert into org_plan_amendments(tenant_id, proposal_id, seq, plan, plan_sha, reason, created_by) values ($1,$2,$3,$4::jsonb,$5,$6,$7)', [ctx.tenantId, id, count + 1, JSON.stringify(plan), sha, b.reason, ctx.user.id]);
      await audit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, action: A, subject: id, result: 'ok', correlationId: ctx.correlationId, detail: { seq: count + 1, planSha: sha, changed } });
      return { dto: await planReadout(c, ctx.tenantId, id) };
    });
    if ('err' in out) throw out.err;
    return reply.status(201).send(out.dto);
  });
}
