// c71: where does a scorecard read spend its time? Run after c71-scale.ts has seeded axion_e2e14 (never wipes anything).
import pg from 'pg';
import { loadavg } from 'node:os';
import { loadInput } from '../src/company/routes.ts';
import { computeScorecard, computeThroughput } from '../src/company/scorecard.ts';
import { dbWindow, snapshotTx, dbNow } from '../src/company/clock.ts';
const url = process.env.E2E_DATABASE_URL!;
if (new URL(url).pathname !== '/axion_e2e14') throw new Error('own DB only');
const pool = new pg.Pool({ connectionString: url, max: 2 });
const db = pool as any;
const uid = (await pool.query(`select id from users where role='admin' limit 1`)).rows[0].id;
const ctx = { tenantId: 't-1', user: { id: uid, role: 'admin' } } as any;
for (let i = 0; i < 4; i++) {
  await snapshotTx(db, async (c) => {
    const w = await dbWindow(c, '30d');
    let t = performance.now();
    const input = await loadInput(c, ctx, false);
    const tl = performance.now() - t; t = performance.now();
    computeScorecard(input, { ...w, includeDemo: false });
    const ts = performance.now() - t; t = performance.now();
    computeThroughput(input, { weeks: 8, to: await dbNow(c), includeDemo: false });
    const tt = performance.now() - t;
    console.log(`load ${tl.toFixed(0)} ms  computeScorecard ${ts.toFixed(0)} ms  computeThroughput ${tt.toFixed(0)} ms  rows ${input.transitions.length}/${input.tasks.length}/${input.reviews!.length}  load1 ${loadavg()[0].toFixed(1)}`);
  });
}
await pool.end();
