export interface Config {
  databaseUrl: string;
  /** Postgres schema (tests use one per file); defaults to public */
  schema?: string;
  tenantId?: string;
  logger?: boolean;
  uploadDir?: string;
  /** staffing simulation step in ms (tests shorten it) */
  staffingStepMs?: number;
  /** DEMO conversation simulation step in ms (tests shorten it) */
  conversationSimMs?: number;
  /** where db-backup.sh writes dumps (Operations › Health shows the newest) */
  backupDir?: string;
  /** SSE ping interval (tests shorten it) */
  sseHeartbeatMs?: number;
  /** seed demo missions when the first admin appears */
  demoSeed?: boolean;
  /** hook for tests: add routes before ready */
  configure?: (app: import('fastify').FastifyInstance) => void;
  /** trust this Origin besides the request's Host (vite proxy) */
  allowedOrigins?: string[];
}

export const VERSION = '0.5.0';
export const DEFAULT_TENANT = 't-1';

export function configFromEnv(): Config {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set (see server/.env.example)');
  return {
    databaseUrl,
    schema: process.env.DATABASE_SCHEMA || undefined,
    logger: process.env.LOG !== '0',
    uploadDir: process.env.UPLOAD_DIR || undefined,
    demoSeed: process.env.DEMO_SEED === '1',
    allowedOrigins: (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
  };
}
