import { buildApp } from './app.ts';
import { configFromEnv } from './config.ts';
import { makePool } from './db.ts';
import { migrate, assertSchemaCurrent } from './migrate.ts';

const cfg = configFromEnv();
const pool = makePool(cfg.databaseUrl, cfg.schema, 1);
// container mode: the Guard runs the migrations as an explicit step; the API only refuses to start on an out-of-date schema
if (process.env.AXION_MIGRATE_ON_START === '0') {
  try { await assertSchemaCurrent(pool); }
  catch (e) { console.error(JSON.stringify({ level: 'error', msg: (e as Error).message })); process.exit(1); }
} else await migrate(pool, 'up');
await pool.end();
// a leader that loses its lock connection must stop at once; Docker restarts the slot and it comes back as a standby
cfg.onLeaderLost = () => { console.error(JSON.stringify({ level: 'error', msg: 'lost the leader lock connection; exiting' })); process.exit(1); };
const app = await buildApp(cfg);
const host = process.env.HOST || '127.0.0.1';
if (host !== '127.0.0.1' && host !== 'localhost') throw new Error('AXION API binds to 127.0.0.1 only');
await app.listen({ host, port: Number(process.env.PORT || 5191) });
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { void app.close().then(() => process.exit(0)); });
