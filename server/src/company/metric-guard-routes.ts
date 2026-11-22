import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser, requireAdmin } from '../auth/session.ts';
import { parse } from '../auth/routes.ts';
import { tx, type Db, type Tx } from '../db.ts';
import { audit } from '../audit.ts';
import { ApiError } from '../errors.ts';
import { guardRows, METRIC_BY_ID, PROMOTION_NOTE, type MetricAuditResult, type MetricAuditState, type MetricGuardDto } from '../../../shared/contracts/src/index.ts';
import { auditState, type AuditSample } from './metric-audit.ts';

/**
 * Improvement cycle 66 (R3-4).
 * GET /company/metric-guard: any signed-in user. The row registry (counter-metric, uncovered quality dimensions, inputs), the derived
 * "gameable" flag, and per row the aggregate of the human audit labels (counts and divergence only: no sample reference leaves the server).
 * POST /company/metric-audits: administrators only. Appends labels (what the metric said, what a person found) for the samples of one
 * row; the latest label of a sample counts. Display only: no score, tier, approval or promotion reads any of this.
 */
const AuditIn = z.object({
  metricId: z.string().trim().min(1).max(120),
  samples: z.array(z.object({ sampleRef: z.string().trim().min(1).max(120), metricLabel: z.boolean(), auditLabel: z.boolean(), note: z.string().trim().max(300).optional() }).strict()).min(1).max(200),
}).strict();

/** The latest label of each (metric, sample), as aggregated per metric. Times are the database's. */
async function auditStates(c: Db | Tx, tenantId: string): Promise<Map<string, MetricAuditState>> {
  const rows = (await c.query(
    `select distinct on (metric_id, sample_ref) metric_id, sample_ref, metric_label, audit_label, audited_at
       from metric_audit_labels where tenant_id=$1 order by metric_id, sample_ref, id desc`, [tenantId])).rows;
  const by = new Map<string, { samples: AuditSample[]; last: number }>();
  for (const r of rows) {
    const e = by.get(r.metric_id) ?? { samples: [], last: 0 };
    e.samples.push({ ref: r.sample_ref, metricLabel: r.metric_label, auditLabel: r.audit_label });
    e.last = Math.max(e.last, new Date(r.audited_at).getTime());
    by.set(r.metric_id, e);
  }
  return new Map([...by].map(([id, e]) => [id, auditState(e.samples, new Date(e.last).toISOString())]));
}
const NONE = auditState([]);

export default async function metricGuardRoutes(app: FastifyInstance) {
  app.get('/company/metric-guard', async (req): Promise<MetricGuardDto> => {
    const ctx = await requireUser(req);
    const states = await auditStates(app.db, ctx.tenantId);
    return { rows: guardRows().map((g) => ({ ...g, audit: states.get(g.id) ?? NONE })), promotionNote: PROMOTION_NOTE };
  });

  app.post('/company/metric-audits', async (req, reply) => {
    const ctx = await requireAdmin(req);
    const b = parse(AuditIn, req.body);
    if (!METRIC_BY_ID.has(b.metricId)) throw new ApiError('VALIDATION', 422, 'Some fields are not valid.', { fieldErrors: { metricId: 'Not a registered scorecard, KPI or dimension row.' } });
    const refs = b.samples.map((s) => s.sampleRef);
    if (new Set(refs).size !== refs.length) throw new ApiError('VALIDATION', 422, 'Some fields are not valid.', { fieldErrors: { samples: 'A sample appears twice in one request; send the later label in a later request.' } });
    const out = await tx(app.db, async (c): Promise<MetricAuditResult> => {
      for (const s of b.samples) {
        await c.query(`insert into metric_audit_labels(tenant_id, metric_id, sample_ref, metric_label, audit_label, audited_by, note) values ($1,$2,$3,$4,$5,$6,$7)`,
          [ctx.tenantId, b.metricId, s.sampleRef, s.metricLabel, s.auditLabel, ctx.user.id, s.note ?? null]);
      }
      await audit(c, { tenantId: ctx.tenantId, actor: ctx.user.id, action: 'metric.audit', subject: b.metricId, result: 'ok', correlationId: ctx.correlationId, detail: { samples: b.samples.length, disagreements: b.samples.filter((s) => s.metricLabel !== s.auditLabel).length } });
      return { recorded: b.samples.length, audit: (await auditStates(c, ctx.tenantId)).get(b.metricId)! };
    });
    return reply.status(201).send(out);
  });
}
