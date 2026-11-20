/**
 * API for browser end-to-end scripts: 127.0.0.1:5192 on the separate database axion_e2e,
 * emptied and re-migrated on every start, so scripts never touch the real `axion` data
 * (and never take the real administrator seat).
 */
import { buildApp } from '../app.ts';
import { makePool } from '../db.ts';
import { migrate } from '../migrate.ts';
import { rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// e2e uploads never mix with the real ones; emptied on every start like the database
const uploadDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'e2e-uploads');
rmSync(uploadDir, { recursive: true, force: true });

const url = process.env.E2E_DATABASE_URL;
if (!url || !/\/axion_e2e(\?|$)/.test(url)) throw new Error('E2E_DATABASE_URL must point at axion_e2e');
const pool = makePool(url, undefined, 1);
await migrate(pool, 'down', 0);
await migrate(pool, 'up');
await pool.end();
const port = Number(process.env.E2E_PORT || 5192);
const start = async () => {
  const a = await buildApp({ databaseUrl: url, logger: false, uploadDir, staffingStepMs: Number(process.env.STAFFING_STEP_MS || 600), demoSeed: process.env.DEMO_SEED !== '0' });
  await a.listen({ host: '127.0.0.1', port });
  return a;
};
let app = await start();
console.log('e2e API on 127.0.0.1:' + port);
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { void app.close().then(() => process.exit(0)); });
// SIGUSR2 = simulated server restart for the browser checks: every connection drops, the port is down
// for RESTART_DOWN_MS, then a fresh app starts on the same database (nothing is reset).
process.on('SIGUSR2', () => {
  void (async () => {
    console.log('restart: closing');
    app.server.closeAllConnections?.();
    await app.close();
    await new Promise((r) => setTimeout(r, Number(process.env.RESTART_DOWN_MS || 3000)));
    app = await start();
    console.log('restart: listening again');
  })();
});
