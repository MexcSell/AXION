import pg from 'pg';

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
 * c98 (H14c): the test knobs are options, never environment checks. `acquireHook(n)` runs before every connection attempt of one pool (or one
 * connectClient call), n counting from 1; a test makes it throw to inject a failure. `retry: false` turns the 53300 retry off. `max` is the pool size
 * when the caller passes none. Production passes none of these, so none of this code is reached there.
 */
export interface PoolOpts {
  acquireHook?: (attempt: number) => void | Promise<void>;
  retry?: boolean;
  max?: number;
}
let poolDefaults: PoolOpts = {};
/** Test setup (vitest setupFiles) sets the defaults every makePool/connectClient without an explicit option uses. Production never calls it. */
export function setPoolDefaults(o: PoolOpts): void { poolDefaults = { ...o }; }

const defaultWarn: NonNullable<DbWarn> = (info, msg) => console.warn(JSON.stringify({ level: 'warn', msg, ...info }));
/** One acquirer per pool (or per client call): the hook's attempt counter is kept once for the pool, not per query. */
function guarded<T>(acquire: () => Promise<T>, warn: DbWarn | undefined, o: PoolOpts): () => Promise<T> {
  const hook = o.acquireHook ?? poolDefaults.acquireHook;
  let n = 0;
  const a = hook ? async () => { await hook(++n); return acquire(); } : acquire;
  return (o.retry ?? poolDefaults.retry) === false ? a : () => acquireWithRetry(a, { warn: warn ?? defaultWarn });
}

export type DbWarn = RetryOpts['warn'];

/** Postgres pool. search_path is set per connection (startup option) so every pooled client sees the same schema. */
export function makePool(databaseUrl: string, schema?: string, max?: number, warn?: DbWarn, opts: PoolOpts = {}): pg.Pool {
  if (schema && !/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error('bad schema name');
  const size = max ?? opts.max ?? poolDefaults.max ?? 10;
  const pool = new pg.Pool({ connectionString: databaseUrl, max: size, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000, ...(schema ? { options: `-c search_path=${schema}` } : {}) });
  pool.on('error', () => { /* idle client died; the pool replaces it */ });
  // wrap acquisition (pool.connect, which pool.query also calls); promise and callback forms
  const rawConnect = pool.connect.bind(pool) as (cb?: unknown) => unknown;
  const acquire = guarded(() => rawConnect() as Promise<pg.PoolClient>, warn, opts);
  type Cb = (err: Error | undefined, c?: pg.PoolClient, done?: (e?: unknown) => void) => void;
  (pool as unknown as { connect: (cb?: Cb) => Promise<pg.PoolClient> | void }).connect = function (cb) {
    const p = acquire();
    if (typeof cb === 'function') {
      // c98 (H14c-2): a throwing callback must not become an unhandled rejection (pg-pool lets it surface as an uncaught exception): rethrow on nextTick
      const call = (...a: Parameters<Cb>) => { try { cb(...a); } catch (e) { process.nextTick(() => { throw e; }); } };
      p.then((c) => call(undefined, c, (e?: unknown) => c.release(e as Error | undefined)), (e: Error) => call(e));
      return;
    }
    return p;
  };
  return pool;
}

/** A standalone client (tests' admin/fixture clients), connected with the same bounded 53300 retry. A failed attempt's client is discarded. */
export async function connectClient(config: pg.ClientConfig, warn?: DbWarn, opts: PoolOpts = {}): Promise<pg.Client> {
  return guarded(async () => { const c = new pg.Client(config); try { await c.connect(); } catch (e) { c.end().catch(() => {}); throw e; } return c; }, warn, opts)();
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
