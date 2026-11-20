import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { buildApp } from '../src/app.ts';
import { migrate } from '../src/migrate.ts';
import type { FastifyInstance } from 'fastify';

export const TEST_DB = () => {
  const u = process.env.TEST_DATABASE_URL;
  if (!u) throw new Error('TEST_DATABASE_URL missing (server/.env)');
  return u;
};

/** A fresh Postgres schema inside axion_test, migrated to the latest version. */
export async function makeSchema(opts: { migrate?: boolean } = {}) {
  const schema = 't_' + randomBytes(6).toString('hex');
  const admin = new pg.Client({ connectionString: TEST_DB() });
  await admin.connect();
  await admin.query(`create schema ${schema}`);
  await admin.end();
  const pool = new pg.Pool({ connectionString: TEST_DB(), options: `-c search_path=${schema}`, max: 4 });
  if (opts.migrate !== false) await migrate(pool, 'up');
  const drop = async () => {
    await pool.end();
    const c = new pg.Client({ connectionString: TEST_DB() });
    await c.connect();
    await c.query(`drop schema ${schema} cascade`);
    await c.end();
  };
  return { schema, pool, drop };
}

export interface TestApp { app: FastifyInstance; schema: string; pool: pg.Pool; close: () => Promise<void> }

export async function makeTestApp(over: Record<string, unknown> = {}): Promise<TestApp> {
  const s = await makeSchema();
  const app = await buildApp({ databaseUrl: TEST_DB(), schema: s.schema, logger: false, ...over });
  return { app, schema: s.schema, pool: s.pool, close: async () => { await app.close(); await s.drop(); } };
}
