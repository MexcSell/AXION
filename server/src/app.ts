import Fastify, { type FastifyInstance, type FastifyError } from 'fastify';
import { randomUUID } from 'node:crypto';
import { makePool, type Db } from './db.ts';
import { ApiError } from './errors.ts';
import { type Config, VERSION, DEFAULT_TENANT } from './config.ts';
import cookie from '@fastify/cookie';
import authRoutes from './auth/routes.ts';
import missionRoutes from './missions/routes.ts';
import ledgerRoutes from './missions/ledger-routes.ts';
import uploadRoutes from './missions/uploads.ts';
import multipart from '@fastify/multipart';
import streamRoutes, { startListener } from './events/stream.ts';
import approvalRoutes from './approvals/routes.ts';
import capacityRoutes from './capacity/routes.ts';
import notificationRoutes from './notifications/routes.ts';
import { startStaffingSim } from './missions/staffing-sim.ts';
import { seedDemo } from './seed/demo.ts';
import opsRoutes from './ops/routes.ts';
import haltRoutes from './ops/halts.ts';
import auditRoutes from './audit-routes.ts';
import { sweepExpired } from './approvals/service.ts';
import { tx } from './db.ts';
import { checkOrigin } from './auth/session.ts';
import agentRoutes from './agents/routes.ts';
import proposalRoutes from './organization/proposals.ts';
import planRoutes from './organization/plan.ts';
import versionRoutes from './agents/versions.ts';
import historyRoutes from './organization/history.ts';
import mentoringRoutes from './agents/mentoring.ts';
import playbookRoutes from './agents/playbooks.ts';
import retirementRoutes from './agents/retirement.ts';
import coverageRoutes from './organization/coverageRoutes.ts';
import { seedCompany } from './agents/seed.ts';
import instanceRoutes from './instances/routes.ts';
import taskRoutes from './tasks/routes.ts';
import conversationRoutes from './conversations/routes.ts';
import directRoutes from './conversations/direct.ts';
import { chatResponder, type ChatResponder } from './conversations/responder.ts';
import { ModelRouter } from './cloud/router.ts';
import chatModelRoutes from './cloud/chat-model-routes.ts';
import { startConversationSim } from './conversations/sim.ts';
import { backfillMissionControl } from './instances/backfill.ts';
import companyRoutes from './company/routes.ts';
import departmentRoutes from './company/departments-routes.ts';
import dimensionRoutes from './company/dimensions-routes.ts';
import processRoutes from './company/process-routes.ts';
import metricGuardRoutes from './company/metric-guard-routes.ts';
import forecastRoutes from './forecasts/routes.ts';
import policyRoutes from './policy/routes.ts';
import grantRoutes from './grants/routes.ts';
import delegationRoutes from './delegation/routes.ts';
import staffingRetryRoutes from './missions/staffing-retry.ts';
import { API_CSP, API_SECURITY_HEADERS } from './http-headers.ts';
import { installWriteLimits } from './ratelimit.ts';
import failureRoutes from './failures/routes.ts';
import releaseRoutes from './releases/routes.ts';
import artifactRoutes from './artifacts/routes.ts';
import attentionRoutes from './attention/routes.ts';
import cloudModelRoutes from './cloud/routes.ts';

declare module 'fastify' {
  interface FastifyInstance { routeTable: { method: string; url: string; bodyLimit?: number }[]; db: Db; cfg: Required<Pick<Config, 'tenantId'>> & Config; onFirstAdmin?: (userId: string) => Promise<void>; chatResponder: ChatResponder; modelRouter: ModelRouter }
}

export async function buildApp(cfg: Config): Promise<FastifyInstance> {
  const app = Fastify({
    logger: cfg.logger ? { level: 'info', redact: ['req.headers.cookie', 'req.headers["x-csrf"]', 'res.headers["set-cookie"]'] } : false,
    genReqId: () => randomUUID(),
    bodyLimit: 1_000_000,
    trustProxy: false, // review I1: never take the client address from X-Forwarded-For
  });
  const db = makePool(cfg.databaseUrl, cfg.schema, cfg.dbPoolMax, (o, m) => app.log.warn(o, m));
  app.decorate('db', db);
  app.decorate('cfg', { tenantId: DEFAULT_TENANT, ...cfg });
  app.addHook('onClose', async () => { await db.end(); });
  // owner 2026-11-25: the GM and agent chats are answered by the chat model (Claude 2 unless CHAT_MODEL names another cloud model)
  // owner 2026-11-25: administrators order the chat models in Settings › AI Chat; the router replaces an unusable model with the next one
  const router = new ModelRouter(cfg.cloudModels ?? [], cfg.chatModelId ?? 'claude-2');
  app.decorate('modelRouter', router);
  const responder = chatResponder(app, router);
  app.decorate('chatResponder', responder);
  app.addHook('onReady', async () => { await responder.sweep().catch((err) => app.log.error({ err }, 'chat responder sweep failed')); });
  app.addHook('preClose', async () => { await responder.close(); });
  // every route as registered (tests check that each write route keeps the CSRF, Origin and body-limit rules)
  const routeTable: { method: string; url: string; bodyLimit?: number }[] = [];
  app.decorate('routeTable', routeTable);
  app.addHook('onRoute', (r) => { for (const m of [r.method].flat()) routeTable.push({ method: m, url: r.url, bodyLimit: r.bodyLimit }); });

  app.addHook('onSend', async (_req, reply) => {
    reply.header('cache-control', 'no-store');
    reply.headers(API_SECURITY_HEADERS);
    if (!reply.hasHeader('content-security-policy')) reply.header('content-security-policy', API_CSP); // uploads keep their sandbox
  });

  app.setErrorHandler((err: FastifyError | ApiError, req, reply) => {
    const correlationId = String(req.id);
    if (err instanceof ApiError) {
      return reply.status(err.status).send({ code: err.code, message: err.message, correlationId, retryable: err.opts.retryable ?? false, ...(err.opts.fieldErrors ? { fieldErrors: err.opts.fieldErrors } : {}) });
    }
    const fe = err as FastifyError;
    if (fe.statusCode === 429) return reply.status(429).send({ code: 'RATE_LIMITED', message: 'Too many attempts. Wait a minute and try again.', correlationId, retryable: true });
    if (fe.validation || (fe.statusCode && fe.statusCode >= 400 && fe.statusCode < 500)) {
      return reply.status(fe.statusCode ?? 400).send({ code: fe.statusCode === 413 ? 'UPLOAD_REJECTED' : 'BAD_REQUEST', message: fe.statusCode === 413 ? 'The request is too large.' : 'The request could not be read.', correlationId, retryable: false });
    }
    // c81 (MR4): text the database cannot store (a NUL byte in an id, a lone surrogate) is the caller's malformed input, not a server fault
    if (['22021', '22P05'].includes(String((err as { code?: unknown }).code))) { req.log.warn({ err }, 'database refused the text of a request (NUL byte or unencodable character)'); return reply.status(400).send({ code: 'BAD_REQUEST', message: 'The request could not be read.', correlationId, retryable: false }); }
    req.log.error({ err }, 'unhandled error');
    return reply.status(500).send({ code: 'INTERNAL', message: 'Something went wrong on the server. Try again.', correlationId, retryable: true });
  });
  app.setNotFoundHandler((req, reply) => reply.status(404).send({ code: 'NOT_FOUND', message: 'Not found.', correlationId: String(req.id), retryable: false }));

  await app.register(cookie);
  app.addHook('onRequest', async (req) => { if (req.url.startsWith('/api/')) checkOrigin(req, cfg.allowedOrigins); });
  installWriteLimits(app, cfg.writeLimits); // cycle 14: per-session limits on messages, proposals and uploads
  await app.register(multipart, { preservePath: true, limits: { fileSize: 25 * 1024 * 1024, files: 1, fields: 4 } });
  await app.register(authRoutes, { prefix: '/api/v1' });
  await app.register(missionRoutes, { prefix: '/api/v1' });
  await app.register(ledgerRoutes, { prefix: '/api/v1' });
  await app.register(uploadRoutes, { prefix: '/api/v1' });
  app.decorate('eventBus', startListener(app, cfg.databaseUrl));
  app.decorate('sse', { clients: 0 });
  await app.register(streamRoutes, { prefix: '/api/v1' });
  await app.register(approvalRoutes, { prefix: '/api/v1' });
  await app.register(capacityRoutes, { prefix: '/api/v1' });
  await app.register(notificationRoutes, { prefix: '/api/v1' });
  await app.register(opsRoutes, { prefix: '/api/v1' });
  await app.register(haltRoutes, { prefix: '/api/v1' }); // Phase A (A2): halt records (administrators; nothing executes)
  await app.register(auditRoutes, { prefix: '/api/v1' });
  await app.register(agentRoutes, { prefix: '/api/v1' });
  await app.register(proposalRoutes, { prefix: '/api/v1' });
  await app.register(planRoutes, { prefix: '/api/v1' });
  await app.register(versionRoutes, { prefix: '/api/v1' });
  await app.register(historyRoutes, { prefix: '/api/v1' });
  await app.register(mentoringRoutes, { prefix: '/api/v1' });
  await app.register(playbookRoutes, { prefix: '/api/v1' });
  await app.register(retirementRoutes, { prefix: '/api/v1' }); // c59: retirement proposals (fixture-only)
  await app.register(coverageRoutes, { prefix: '/api/v1' });
  await app.register(instanceRoutes, { prefix: '/api/v1' });
  await app.register(taskRoutes, { prefix: '/api/v1' });
  await app.register(conversationRoutes, { prefix: '/api/v1' });
  await app.register(directRoutes, { prefix: '/api/v1' });
  await app.register(companyRoutes, { prefix: '/api/v1' });
  await app.register(departmentRoutes, { prefix: '/api/v1' });
  await app.register(dimensionRoutes, { prefix: '/api/v1' });
  await app.register(processRoutes, { prefix: '/api/v1' });
  await app.register(metricGuardRoutes, { prefix: '/api/v1' });
  await app.register(forecastRoutes, { prefix: '/api/v1' });
  await app.register(policyRoutes, { prefix: '/api/v1' });
  await app.register(grantRoutes, { prefix: '/api/v1' });
  await app.register(failureRoutes, { prefix: '/api/v1' });
  await app.register(releaseRoutes, { prefix: '/api/v1' });
  await app.register(artifactRoutes, { prefix: '/api/v1' });
  await app.register(attentionRoutes, { prefix: '/api/v1' });
  await app.register(delegationRoutes, { prefix: '/api/v1' });
  await app.register(staffingRetryRoutes, { prefix: '/api/v1' });
  await app.register(cloudModelRoutes, { prefix: '/api/v1' }); // owner 2026-11-24: the live cloud model (admin prompts only)
  await app.register(chatModelRoutes, { prefix: '/api/v1' }); // owner 2026-11-25: Settings › AI Chat (chat model order, usage)
  await tx(db, (c) => seedCompany(c, app.cfg.tenantId)); // decision E1: company data, idempotent, independent of DEMO_SEED
  await tx(db, (c) => backfillMissionControl(c, app.cfg.tenantId, app.log)); // Stage 6: instances, delegations and tasks for missions that predate them (idempotent)

  app.get('/api/v1/health', async () => {
    let up = false;
    try { await db.query('select 1'); up = true; } catch { /* reported below */ }
    return { ok: up, db: up ? 'up' : 'down', version: VERSION };
  });

  startStaffingSim(app, cfg.staffingStepMs ?? 1500);
  if (cfg.demoSeed || cfg.conversationSimMs !== undefined) startConversationSim(app, cfg.conversationSimMs ?? 1200);
  // review I4: expired approvals are settled every minute, even when nobody opens the approvals list
  const sweep = setInterval(() => { void tx(db, (c) => sweepExpired(c)).then((ids) => ids.forEach((id) => app.onMissionChanged?.(id, 'running'))).catch(() => {}); }, 60_000);
  sweep.unref();
  app.addHook('onClose', async () => clearInterval(sweep));
  if (cfg.demoSeed) app.onFirstAdmin = async (adminId) => { try { await seedDemo(db, app.cfg.tenantId, adminId); } catch (e) { app.log.error({ err: e }, 'demo seed failed'); } };
  cfg.configure?.(app);
  await app.ready();
  return app;
}
