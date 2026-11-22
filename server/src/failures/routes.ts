import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { tx } from '../db.ts';
import { requireUser, requireAdmin } from '../auth/session.ts';
import { parse } from '../auth/routes.ts';
import { idempotent } from '../idempotency.ts';
import { SCORECARD_WINDOWS, DETECTION_CHANNELS, FAILURE_MECHANISMS, FAILURE_CONTROLS, DETECTION_NOTE_MAX } from '../../../shared/contracts/src/index.ts';
import { dbWindow } from '../company/clock.ts';
import { FAILURE_SUBJECT_KINDS } from './taxonomy.ts';
import { listFailurePatterns } from './patterns.ts';
import { createTag, createAttribution, decideTag, tagsOfSubject, failureModeCounts } from './service.ts';

/**
 * Improvement cycle 33: failure-mode tags. Any signed-in person tags and decides on subjects of missions they can see (the u1 rule);
 * every tag starts proposed and a person confirms or rejects it once; only confirmed tags are counted (GET /company/failure-modes).
 * c60: a tag may carry attribution (agent, step, "full trace available"), only for a task or task attempt with a recorded failure (409 otherwise); POST /failure-tags/:id/attributions adds another entry.
 * An invalid mode is 400; an unknown, invisible or other-tenant subject is 404; a second decision is 409. Writes are in the rate-limit map.
 */
const Str = z.string().trim();
const AttributionIn = z.object({ agentId: Str.min(1).max(120).optional(), stepRef: Str.min(1).max(120).optional(), fullTraceAvailable: z.boolean().optional() }).strict()
  .refine((a) => a.agentId !== undefined || a.stepRef !== undefined, { message: 'Name an agent, a step, or both.' });
const ids = <T extends readonly { id: string }[]>(l: T) => l.map((x) => x.id) as [T[number]['id'], ...T[number]['id'][]];
const DetectionIn = {
  detectionChannel: z.enum(ids(DETECTION_CHANNELS)).optional(), mechanism: z.enum(ids(FAILURE_MECHANISMS)).optional(),
  controlExpected: z.enum(ids(FAILURE_CONTROLS)).optional(), controlCaught: z.enum(ids(FAILURE_CONTROLS)).optional(), detectionNote: Str.max(DETECTION_NOTE_MAX).optional(),
};
const CreateIn = z.object({ subjectKind: z.enum(FAILURE_SUBJECT_KINDS), subjectId: Str.min(1).max(120), modeId: Str.min(1).max(16), note: Str.max(1000).optional(), attribution: AttributionIn.optional(), ...DetectionIn }).strict()
  .superRefine((b, ctx) => {
    if (!b.detectionNote && [b.mechanism, b.controlExpected, b.controlCaught].includes('other')) ctx.addIssue({ code: 'custom', path: ['detectionNote'], message: 'Say what "something else" was: a note is required.' });
  });
const DecisionIn = z.object({ decision: z.enum(['confirm', 'reject']) }).strict();
const SubjectIn = z.object({ subjectKind: z.enum(FAILURE_SUBJECT_KINDS), subjectId: Str.min(1).max(120) });
const CountsIn = z.object({ window: z.enum(SCORECARD_WINDOWS).default('30d'), includeDemo: z.enum(['0', '1']).default('0') });

export default async function failureRoutes(app: FastifyInstance) {
  app.get('/failure-tags', async (req) => {
    const ctx = await requireUser(req);
    const q = parse(SubjectIn, req.query ?? {});
    return tx(app.db, (c) => tagsOfSubject(c, ctx, q.subjectKind, q.subjectId));
  });

  app.post('/failure-tags', async (req, reply) => {
    const ctx = await requireUser(req);
    const b = parse(CreateIn, req.body);
    const out = await idempotent(app.db, req, ctx, async (c) => {
      const tag = await createTag(c, { tenantId: ctx.tenantId, viewer: ctx, taggedBy: ctx.user.id, taggedByKind: 'user', correlationId: ctx.correlationId }, { kind: b.subjectKind, subjectId: b.subjectId, modeId: b.modeId, note: b.note, attribution: b.attribution,
        detectionChannel: b.detectionChannel, mechanism: b.mechanism, controlExpected: b.controlExpected, controlCaught: b.controlCaught, detectionNote: b.detectionNote });
      return { status: 201, body: { tag } };
    });
    return reply.status(out.status).send(out.body);
  });

  // c60: one more attribution entry on a tag (append-only; two views that differ both stay)
  app.post('/failure-tags/:id/attributions', async (req, reply) => {
    const ctx = await requireUser(req);
    const { id } = req.params as { id: string };
    const b = parse(AttributionIn, req.body);
    const out = await idempotent(app.db, req, ctx, async (c) => {
      const tag = await createAttribution(c, { tenantId: ctx.tenantId, viewer: ctx, attributedBy: ctx.user.id, attributedByKind: 'user', correlationId: ctx.correlationId }, id, b);
      return { status: 201, body: { tag } };
    });
    return reply.status(out.status).send(out.body);
  });

  app.post('/failure-tags/:id/decision', async (req) => {
    const ctx = await requireUser(req);
    const { id } = req.params as { id: string };
    const b = parse(DecisionIn, req.body);
    const out = await tx(app.db, (c) => decideTag(c, ctx, id, b.decision));
    if ('err' in out) throw out.err;
    return out;
  });

  // c63: the recurrence patterns that opened a candidate in c41's lesson review (administrators only: it spans every mission of the tenant)
  app.get('/company/failure-patterns', async (req) => {
    const ctx = await requireAdmin(req);
    return tx(app.db, (c) => listFailurePatterns(c, ctx.tenantId));
  });

  app.get('/company/failure-modes', async (req) => {
    const ctx = await requireUser(req);
    const q = parse(CountsIn, req.query ?? {});
    return tx(app.db, async (c) => failureModeCounts(c, ctx, await dbWindow(c, q.window), q.includeDemo === '1'));
  });
}
