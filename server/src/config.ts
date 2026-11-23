export interface Config {
  databaseUrl: string;
  /** Postgres schema (tests use one per file); defaults to public */
  schema?: string;
  tenantId?: string;
  /** c93: connection pool size of the app (default 10; tests default to AXION_TEST_POOL_MAX, see vitest.config.ts) */
  dbPoolMax?: number;
  logger?: boolean;
  uploadDir?: string;
  /** staffing simulation step in ms (tests shorten it) */
  staffingStepMs?: number;
  /** DEMO conversation simulation step in ms (tests shorten it) */
  conversationSimMs?: number;
  /** where db-backup.sh writes dumps (Operations › Health shows the newest) */
  backupDir?: string;
  /** c49: tests pass the anchor key/file here; in production both come from the environment (AUDIT_ANCHOR_KEY, AUDIT_ANCHOR_FILE) and never from a config object that could be logged */
  auditAnchor?: { key?: string; file?: string; domain?: string };
  /** c64: operator settings for organisation restructures (never routes). 0 or unset = not enforced, except the escalation depth: unset = 6 levels, 0 = not enforced. Env: ORG_COOLDOWN_HOURS, ORG_CHURN_BUDGET, ORG_CHURN_WINDOW_HOURS, ORG_MAX_ESCALATION_LEVELS. */
  orgGuardrails?: OrgGuardrailSettings;
  /** SSE ping interval (tests shorten it) */
  sseHeartbeatMs?: number;
  /** seed demo missions when the first admin appears */
  demoSeed?: boolean;
  /** hook for tests: add routes before ready */
  configure?: (app: import('fastify').FastifyInstance) => void;
  /** trust this Origin besides the request's Host (vite proxy) */
  allowedOrigins?: string[];
  /** per-session write rate limits (tests make them small); defaults in ratelimit.ts */
  writeLimits?: Partial<Record<import('./ratelimit.ts').WriteBucket, import('./ratelimit.ts').WriteLimit>>;
  /** c59: most active items one agent's playbook may hold. An operator setting only (never a route): whole number 1..200, default 25. */
  playbookActiveCap?: number;
}

export interface OrgGuardrailSettings {
  /** after an approved org revision, a further proposal is refused for this many hours */
  cooldownHours?: number;
  /** reporting lines (added + removed + re-pointed) that approved proposals may change inside the window, this one included */
  churnBudget?: number;
  churnWindowHours?: number;
  /** every active agent whose chain the proposal changes must reach the GM within this many levels (unset = 6; 0 = not enforced) */
  maxEscalationLevels?: number;
}
export const DEFAULT_MAX_ESCALATION_LEVELS = 6;
const envInt = (name: string): number | undefined => {
  const v = process.env[name];
  if (v === undefined || v.trim() === '') return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 100000) throw new Error(`${name} must be a whole number from 0 to 100000`);
  return n;
};

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
    orgGuardrails: { cooldownHours: envInt('ORG_COOLDOWN_HOURS'), churnBudget: envInt('ORG_CHURN_BUDGET'), churnWindowHours: envInt('ORG_CHURN_WINDOW_HOURS'), maxEscalationLevels: envInt('ORG_MAX_ESCALATION_LEVELS') },
    allowedOrigins: (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
    playbookActiveCap: process.env.PLAYBOOK_ACTIVE_CAP ? Number(process.env.PLAYBOOK_ACTIVE_CAP) : undefined,
  };
}
