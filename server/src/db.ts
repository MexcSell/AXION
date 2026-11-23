import pg from 'pg';
import { appendFileSync } from 'node:fs';

/**
 * c93 (H14b): the `axion` role is capped (SQLSTATE 53300 "too many connections for role") and every lane shares that cap.
 * Only the ACQUISITION of a connection is retried, only on 53300, a few times with short jittered backoff (under about 3 s in all),
 * and each retry is logged at warn. A query, a transaction or any other error code is never retried: once a connection is held,
 * nothing here runs again. This applies to production too; it is safe because a refused connection never ran any SQL, so
 * retrying it cannot repeat a write, and the wait is bounded, after which the original error surfaces as before.
 */
export function isConnectionCap(e: unknown): boolean {
  const x = e as { code?: unknown; message?: unknown } | null;
  return !!x && (x.code === '53300' || (typeof x.message === 'string' && /too many connections/i.test(x.message)));
}

export interface RetryOpts {
  /** total tries including the first */
  attempts?: number;
  baseMs?: number;
  /** stop retrying when the waits would add up to more than this */
  budgetMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** uniform in [0,1); injectable for tests */
  random?: () => number;
  warn?: (info: { attempt: number; delayMs: number; code: unknown }, msg: string) => void;
}

export async function acquireWithRetry<T>(acquire: () => Promise<T>, o: RetryOpts = {}): Promise<T> {
  const attempts = o.attempts ?? 5, baseMs = o.baseMs ?? 100, budgetMs = o.budgetMs ?? 3000;
  const sleep = o.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  const random = o.random ?? Math.random;
  let waited = 0;
  for (let attempt = 1; ; attempt++) {
    try { return await acquire(); } catch (e) {
      if (!isConnectionCap(e) || attempt >= attempts) throw e;
      const delayMs = Math.round(baseMs * 2 ** (attempt - 1) * (0.5 + random() / 2)); // 50..100 ms, 100..200, 200..400, 400..800
      if (waited + delayMs > budgetMs) throw e;
      waited += delayMs;
      o.warn?.({ attempt, delayMs, code: (e as { code?: unknown }).code }, 'db connection cap hit (53300); retrying the connection');
      await sleep(delayMs);
    }
  }
}

/**
 * Test-only fault injection (active only under vitest): AXION_TEST_FAULT_53300=K makes the first K connection attempts of every pool
 * (and every connectClient call) throw a real-looking 53300 error, so the retry can be proven without holding extra real connections
 * on the shared role. AXION_TEST_NO_RETRY=1 turns the retry off, to show the same runs fail without it.
 */
function faultK(): number { return process.env.VITEST ? Number(process.env.AXION_TEST_FAULT_53300 || 0) : 0; }
function retryOn(): boolean { return !(process.env.VITEST && process.env.AXION_TEST_NO_RETRY === '1'); }
function capError(): Error { return Object.assign(new Error('too many connections for role "axion"'), { code: '53300', severity: 'FATAL' }); }
/** One acquirer per pool (or per client call): the injected faults are counted once for the pool, not per query. */
function guarded<T>(acquire: () => Promise<T>, warn?: DbWarn): () => Promise<T> {
  let left = faultK();
  const a = async () => { if (left > 0) { left--; throw capError(); } return acquire(); };
  const w: NonNullable<DbWarn> = warn ?? defaultWarn;
  // under fault injection each retry is also appended to AXION_TEST_FAULT_LOG (if set), so a run can count them: test apps log nowhere
  const wrapped: DbWarn = left > 0 ? (i, m) => { const f = process.env.AXION_TEST_FAULT_LOG; if (f) try { appendFileSync(f, `${process.env.VITEST_POOL_ID ?? ''} retry ${i?.attempt}\n`); } catch { /* best effort */ } w(i, m); } : w;
  return retryOn() ? () => acquireWithRetry(a, { warn: wrapped }) : a;
}
const defaultWarn: NonNullable<DbWarn> = (info, msg) => console.warn(JSON.stringify({ level: 'warn', msg, ...info }));

export type DbWarn = RetryOpts['warn'];

/** Postgres pool. search_path is set per connection (startup option) so every pooled client sees the same schema. */
/** Test runs (vitest only) default every pool to AXION_TEST_POOL_MAX instead of 10, set once in vitest.config.ts; an explicit `max` still wins. */
function defaultMax(): number { const t = process.env.VITEST ? Number(process.env.AXION_TEST_POOL_MAX || 0) : 0; return t > 0 ? t : 10; }

export function makePool(databaseUrl: string, schema?: string, max: number = defaultMax(), warn?: DbWarn): pg.Pool {
  if (schema && !/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error('bad schema name');
  const pool = new pg.Pool({ connectionString: databaseUrl, max, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000, ...(schema ? { options: `-c search_path=${schema}` } : {}) });
  pool.on('error', () => { /* idle client died; the pool replaces it */ });
  // wrap acquisition (pool.connect, which pool.query also calls); promise and callback forms
  const rawConnect = pool.connect.bind(pool) as (cb?: unknown) => unknown;
  const acquire = guarded(() => rawConnect() as Promise<pg.PoolClient>, warn);
  (pool as unknown as { connect: (cb?: (err: Error | undefined, c?: pg.PoolClient, done?: (e?: unknown) => void) => void) => Promise<pg.PoolClient> | void }).connect = function (cb) {
    const p = acquire();
    if (typeof cb === 'function') {
      p.then((c) => cb(undefined, c, (e?: unknown) => c.release(e as Error | undefined)), (e: Error) => cb(e));
      return;
    }
    return p;
  };
  return pool;
}

/** A standalone client (tests' admin/fixture clients), connected with the same bounded 53300 retry. A failed attempt's client is discarded. */
export async function connectClient(config: pg.ClientConfig, warn?: DbWarn): Promise<pg.Client> {
  return guarded(async () => { const c = new pg.Client(config); try { await c.connect(); } catch (e) { c.end().catch(() => {}); throw e; } return c; }, warn)();
}

export type Db = pg.Pool;
export type Tx = pg.PoolClient;

/** Run fn in one transaction. Nested use is not supported: pass the client down instead. */
export async function tx<T>(pool: Db, fn: (c: Tx) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query(`set local lock_timeout = '5s'`);
    const r = await fn(c);
    await c.query('commit');
    return r;
  } catch (e) {
    try { await c.query('rollback'); } catch { /* connection lost */ }
    throw e;
  } finally {
    c.release();
  }
}
