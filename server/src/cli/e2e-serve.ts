/**
 * API for browser end-to-end scripts: 127.0.0.1:5192 on the separate database axion_e2e,
 * emptied and re-migrated on every start, so scripts never touch the real `axion` data
 * (and never take the real administrator seat).
 */
import { buildApp } from '../app.ts';
import { makePool } from '../db.ts';
import { migrate } from '../migrate.ts';

const url = process.env.E2E_DATABASE_URL;
if (!url || !/\/axion_e2e(\?|$)/.test(url)) throw new Error('E2E_DATABASE_URL must point at axion_e2e');
const pool = makePool(url, undefined, 1);
await migrate(pool, 'down', 0);
await migrate(pool, 'up');
await pool.end();
const app = await buildApp({ databaseUrl: url, logger: false, staffingStepMs: Number(process.env.STAFFING_STEP_MS || 600), demoSeed: process.env.DEMO_SEED !== '0' });
await app.listen({ host: '127.0.0.1', port: Number(process.env.E2E_PORT || 5192) });
console.log('e2e API on 127.0.0.1:' + (process.env.E2E_PORT || 5192));
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { void app.close().then(() => process.exit(0)); });
