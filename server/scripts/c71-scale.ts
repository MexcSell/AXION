/**
 * c71 (P6) scale bench. Runs ONLY against an e2e database (axion_e2e or axion_e2e<N>, E2E_DATABASE_URL, needs CONFIRM_WIPE=1): empties it, migrates, seeds N tasks
 * (test/c71-scale-fixtures.ts) and times every company route, printing the load average next to each timing.
 * Run: CONFIRM_WIPE=1 /home/luca/AXION-lanes/heavy.sh npx tsx --env-file=.env scripts/c71-scale.ts 5000 25000
 * Optional: C71_REF=1 also times the frozen pre-c71 reference (test/c71-reference.ts) interleaved with the live route.
 */
import pg from 'pg';
import { mkdtempSync } from 'node:fs';
import { loadavg, tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/app.ts';
import { migrate } from '../src/migrate.ts';
import { Browser } from '../test/helpers.ts';
import { assertC71Wipe } from './c71-guard.ts';
import { seedScale } from '../test/c71-scale-fixtures.ts';
import { snapshotTx, dbWindow, dbNow } from '../src/company/clock.ts';
import { computeScorecard as scV0, computeThroughput as thV0 } from '../test/c71-reference/scorecard-v0.ts';
import { loadInputV0 } from '../test/c71-reference/load-v0.ts';

const url = process.env.E2E_DATABASE_URL;
assertC71Wipe(url, process.env.CONFIRM_WIPE); // empties the database: e2e names only, no query string, CONFIRM_WIPE=1 (scripts/c71-guard.ts)
const sizes = process.argv.slice(2).map(Number).filter(Boolean);
const TPM = Number(process.env.C71_TPM ?? 10);
const RUNS = Number(process.env.C71_RUNS ?? 12);
const ROUTES = process.env.C71_ROUTE ? [process.env.C71_ROUTE] : ['/company/scorecard?window=30d', '/company/scorecard?window=90d', '/company/throughput?weeks=8', '/company/dimensions?window=30d', '/departments', '/company/failure-modes?window=30d'];
const pool = new pg.Pool({ connectionString: url, max: 3 });
const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(s.length * p) - 1)]; };

for (const n of sizes) {
  await migrate(pool, 'down', 0);
  await migrate(pool, 'up');
  const app = await buildApp({ databaseUrl: url!, logger: false, uploadDir: mkdtempSync(join(tmpdir(), 'axion-c71-')), demoSeed: false });
  const admin = new Browser(app);
  if ((await admin.connect('Luca', 'pass1234')).status !== 200) throw new Error('connect failed');
  const mem = new Browser(app, '127.0.0.2');
  if ((await mem.connect('Bea', 'pass1234')).status !== 202) throw new Error('member wait');
  const users = (await admin.req('GET', '/users')).body.users as { id: string; name: string }[];
  const A = users.find((u) => u.name === 'Luca')!.id, B = users.find((u) => u.name === 'Bea')!.id;
  await admin.req('POST', `/users/${B}/approve`);
  await mem.connect('Bea', 'pass1234');
  const t0 = Date.now();
  await seedScale(pool, { tasks: n, adminId: A, memberId: B, perMission: TPM });
  const c = (await pool.query(`select (select count(*) from missions) m, (select count(*) from tasks) t, (select count(*) from task_attempts) a, (select count(*) from task_reviews) r, (select count(*) from events) e, (select count(*) from delegation_briefs) b`)).rows[0];
  console.log(`\n== ${n} tasks (${TPM} per mission) seeded in ${((Date.now() - t0) / 1000).toFixed(1)}s`, JSON.stringify(c));
  const who: [string, Browser][] = [['admin', admin], ['member', mem]];
  for (const [label, br] of who) for (const ep of ROUTES) {
    for (let i = 0; i < 2; i++) await br.req('GET', ep);
    const ts: number[] = []; let bytes = 0; const ld: number[] = [];
    for (let i = 0; i < RUNS; i++) { const a = performance.now(); const r = await br.req('GET', ep); ts.push(performance.now() - a); ld.push(loadavg()[0]); if (r.status !== 200) throw new Error(ep + ' ' + r.status + JSON.stringify(r.body)); bytes = r.raw.body.length; }
    console.log(`${String(n).padStart(6)} ${label.padEnd(6)} ${ep.padEnd(36)} p50 ${pct(ts, 0.5).toFixed(0).padStart(5)} ms  p95 ${pct(ts, 0.95).toFixed(0).padStart(5)} ms  ${bytes} B  load1 ${loadavg()[0].toFixed(1)}`);
  }
  if (process.env.C71_REF) {
    // BEFORE/AFTER interleaved on the same data, one call each in turn, so both see the same machine load.
    // scorecard + throughput: the frozen pre-c71 read (test/c71-reference) vs the live code. dimensions: migration 0053's index dropped vs present.
    const ctx = { tenantId: 't-1', user: { id: A, role: 'admin' } } as any;
    const db = app.db;
    const cases: Record<string, [() => Promise<unknown>, () => Promise<unknown>]> = {
      'scorecard 30d': [
        () => snapshotTx(db, async (c) => scV0(await loadInputV0(c, ctx, false), { ...(await dbWindow(c, '30d')), includeDemo: false })),
        () => admin.req('GET', '/company/scorecard?window=30d')],
      'throughput 8w': [
        () => snapshotTx(db, async (c) => thV0(await loadInputV0(c, ctx, false), { weeks: 8, to: await dbNow(c), includeDemo: false })),
        () => admin.req('GET', '/company/throughput?weeks=8')],
      'dimensions 30d': [
        async () => { await pool.query('drop index if exists approval_decisions_approval'); await admin.req('GET', '/company/dimensions?window=30d'); },
        async () => { await pool.query('create index if not exists approval_decisions_approval on approval_decisions (approval_id, decided_at)'); await pool.query('analyze approval_decisions'); await admin.req('GET', '/company/dimensions?window=30d'); }],
    };
    for (const [name, [before, after]] of Object.entries(cases)) {
      const tb: number[] = [], ta: number[] = [], lb: number[] = [], la: number[] = [];
      if (name.startsWith('dimensions')) { await after(); }
      for (let i = 0; i < RUNS; i++) {
        let a = performance.now(); if (name.startsWith('dimensions')) { await pool.query('drop index if exists approval_decisions_approval'); a = performance.now(); await admin.req('GET', '/company/dimensions?window=30d'); } else await before(); tb.push(performance.now() - a); lb.push(loadavg()[0]);
        if (name.startsWith('dimensions')) { await pool.query('create index if not exists approval_decisions_approval on approval_decisions (approval_id, decided_at)'); await pool.query('analyze approval_decisions'); }
        a = performance.now(); if (name.startsWith('dimensions')) await admin.req('GET', '/company/dimensions?window=30d'); else await after(); ta.push(performance.now() - a); la.push(loadavg()[0]);
      }
      const m = (xs: number[]) => (xs.reduce((x, y) => x + y, 0) / xs.length).toFixed(1);
      console.log(`${String(n).padStart(6)} INTERLEAVED ${name.padEnd(15)} BEFORE p50 ${pct(tb, 0.5).toFixed(0).padStart(5)} p95 ${pct(tb, 0.95).toFixed(0).padStart(5)} ms (load ${m(lb)})   AFTER p50 ${pct(ta, 0.5).toFixed(0).padStart(5)} p95 ${pct(ta, 0.95).toFixed(0).padStart(5)} ms (load ${m(la)})`);
    }
  }
  await app.close();
}
await pool.end();
