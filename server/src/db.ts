import pg from 'pg';

/** Postgres pool. search_path is set per connection (startup option) so every pooled client sees the same schema. */
export function makePool(databaseUrl: string, schema?: string, max = 10): pg.Pool {
  if (schema && !/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error('bad schema name');
  const pool = new pg.Pool({ connectionString: databaseUrl, max, ...(schema ? { options: `-c search_path=${schema}` } : {}) });
  pool.on('error', () => { /* idle client died; the pool replaces it */ });
  return pool;
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
