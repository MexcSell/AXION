import Fastify, { type FastifyInstance, type FastifyError } from 'fastify';
import { randomUUID } from 'node:crypto';
import { makePool, type Db } from './db.ts';
import { ApiError } from './errors.ts';
import { type Config, VERSION, DEFAULT_TENANT } from './config.ts';
import cookie from '@fastify/cookie';
import authRoutes from './auth/routes.ts';
import missionRoutes from './missions/routes.ts';
import uploadRoutes from './missions/uploads.ts';
import multipart from '@fastify/multipart';
import streamRoutes, { startListener } from './events/stream.ts';
import approvalRoutes from './approvals/routes.ts';
import notificationRoutes from './notifications/routes.ts';
import { startStaffingSim } from './missions/staffing-sim.ts';
import { seedDemo } from './seed/demo.ts';
import opsRoutes from './ops/routes.ts';
import { checkOrigin } from './auth/session.ts';

declare module 'fastify' {
  interface FastifyInstance { db: Db; cfg: Required<Pick<Config, 'tenantId'>> & Config; onFirstAdmin?: (userId: string) => Promise<void> }
}

export async function buildApp(cfg: Config): Promise<FastifyInstance> {
  const app = Fastify({
    logger: cfg.logger ? { level: 'info', redact: ['req.headers.cookie', 'req.headers["x-csrf"]', 'res.headers["set-cookie"]'] } : false,
    genReqId: () => randomUUID(),
    bodyLimit: 1_000_000,
    trustProxy: '127.0.0.1',
  });
  const db = makePool(cfg.databaseUrl, cfg.schema);
  app.decorate('db', db);
  app.decorate('cfg', { tenantId: DEFAULT_TENANT, ...cfg });
  app.addHook('onClose', async () => { await db.end(); });

  app.addHook('onSend', async (_req, reply) => {
    reply.header('cache-control', 'no-store');
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('x-frame-options', 'DENY');
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
    req.log.error({ err }, 'unhandled error');
    return reply.status(500).send({ code: 'INTERNAL', message: 'Something went wrong on the server. Try again.', correlationId, retryable: true });
  });
  app.setNotFoundHandler((req, reply) => reply.status(404).send({ code: 'NOT_FOUND', message: 'Not found.', correlationId: String(req.id), retryable: false }));

  await app.register(cookie);
  app.addHook('onRequest', async (req) => { if (req.url.startsWith('/api/')) checkOrigin(req, cfg.allowedOrigins); });
  await app.register(multipart, { preservePath: true, limits: { fileSize: 25 * 1024 * 1024, files: 1, fields: 4 } });
  await app.register(authRoutes, { prefix: '/api/v1' });
  await app.register(missionRoutes, { prefix: '/api/v1' });
  await app.register(uploadRoutes, { prefix: '/api/v1' });
  app.decorate('eventBus', startListener(app, cfg.databaseUrl));
  app.decorate('sse', { clients: 0 });
  await app.register(streamRoutes, { prefix: '/api/v1' });
  await app.register(approvalRoutes, { prefix: '/api/v1' });
  await app.register(notificationRoutes, { prefix: '/api/v1' });
  await app.register(opsRoutes, { prefix: '/api/v1' });

  app.get('/api/v1/health', async () => {
    let up = false;
    try { await db.query('select 1'); up = true; } catch { /* reported below */ }
    return { ok: up, db: up ? 'up' : 'down', version: VERSION };
  });

  startStaffingSim(app, cfg.staffingStepMs ?? 1500);
  if (cfg.demoSeed) app.onFirstAdmin = async (adminId) => { try { await seedDemo(db, app.cfg.tenantId, adminId); } catch (e) { app.log.error({ err: e }, 'demo seed failed'); } };
  cfg.configure?.(app);
  await app.ready();
  return app;
}
