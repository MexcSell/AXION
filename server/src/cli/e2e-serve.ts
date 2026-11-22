/**
 * API for browser end-to-end scripts: 127.0.0.1:5192 on the separate database axion_e2e,
 * emptied and re-migrated on every start, so scripts never touch the real `axion` data
 * (and never take the real administrator seat).
 */
import { buildApp } from '../app.ts';
import { isE2eDatabaseUrl } from './e2e-url.ts';
import { makePool } from '../db.ts';
import { migrate } from '../migrate.ts';
import { rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// e2e uploads never mix with the real ones; emptied on every start like the database
const uploadDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'e2e-uploads');
rmSync(uploadDir, { recursive: true, force: true });

const url = process.env.E2E_DATABASE_URL;
if (!isE2eDatabaseUrl(url)) throw new Error('E2E_DATABASE_URL must point at axion_e2e or axion_e2e<N> (a parallel lane)');
const pool = makePool(url, undefined, 1);
await migrate(pool, 'down', 0);
await migrate(pool, 'up');
await pool.end();
const port = Number(process.env.E2E_PORT || 5192);
// Cycle 14: api-stage6.mjs seeds a paged thread with 130 messages from one session in about two seconds, which the real
// per-session limit (60 messages a minute) refuses. Only this throw-away e2e server lifts the message limit; proposals and
// uploads keep the real defaults, and test/security.test.ts covers every real limit.
// The perf scripts post far more from one session within a minute: api-c22 N=1000 (1,000 + its probes) and api-c26
// (FILL 1,000 + BURST 200 + a 240-message mixed thread). At 1,000 a minute their last posts got 429, so the newest
// message never arrived ("not interactive within the cap", "store has it NO"). 5,000 a minute covers them.
const E2E_WRITE_LIMITS = { messages: { max: 5000, windowMs: 60_000 } };
const start = async () => {
  const a = await buildApp({ databaseUrl: url, logger: false, uploadDir, staffingStepMs: Number(process.env.STAFFING_STEP_MS || 600), demoSeed: process.env.DEMO_SEED !== '0', playbookActiveCap: process.env.PLAYBOOK_ACTIVE_CAP ? Number(process.env.PLAYBOOK_ACTIVE_CAP) : undefined, writeLimits: E2E_WRITE_LIMITS });
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
