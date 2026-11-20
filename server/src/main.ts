import { buildApp } from './app.ts';
import { configFromEnv } from './config.ts';
import { makePool } from './db.ts';
import { migrate } from './migrate.ts';

const cfg = configFromEnv();
const pool = makePool(cfg.databaseUrl, cfg.schema, 1);
await migrate(pool, 'up');
await pool.end();
const app = await buildApp(cfg);
const host = process.env.HOST || '127.0.0.1';
if (host !== '127.0.0.1' && host !== 'localhost') throw new Error('AXION API binds to 127.0.0.1 only');
await app.listen({ host, port: Number(process.env.PORT || 5191) });
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { void app.close().then(() => process.exit(0)); });
