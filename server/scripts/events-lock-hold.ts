/**
 * c49 one-off for BACKLOG P5c: how long is the events advisory lock held? Runs ONLY against this lane's own axion_e2e<N>
 * (emptied and re-migrated). It drives write load through the real app (POST /missions, which emits events and audits, plus
 * message posts), and times, per transaction, from the moment the events lock is GRANTED (the lock query returns) to the
 * transaction's commit/rollback returning. A transaction that takes the lock twice counts from the first grant. Wait time
 * (the lock query itself) is reported separately: that is the queueing other writers feel.
 * Observation only: no lock behaviour is changed.
 * Run: /home/luca/AXION-lanes/heavy.sh npx tsx --env-file=.env scripts/events-lock-hold.ts
 */
import pg from 'pg';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { basename, resolve } from 'node:path';
import { buildApp } from '../src/app.ts';
import { migrate } from '../src/migrate.ts';
import { Browser } from '../test/helpers.ts';

const url = process.env.E2E_DATABASE_URL;
// scale-guard maps lane N to axion_e2eN, but reused lanes (w48 -> axion_e2e4) break that; so: a lane worktree and an axion_e2e<N> database
if (!/^AXION-w\d+$/.test(basename(resolve(join(import.meta.dirname, '..', '..')))) || !/\/axion_e2e\d+$/.test(url ?? '')) throw new Error('events-lock-hold runs only in a lane worktree against its axion_e2e<N> database');
const TOTAL = Number(process.env.WRITES || 600);
const CONC = Number(process.env.CONC || 12);

const holds: number[] = []; const waits: number[] = [];
const grantedAt = new WeakMap<object, number>();
const proto = pg.Client.prototype as any;
const orig = proto.query;
proto.query = function (this: pg.Client, ...args: any[]) {
  const text = typeof args[0] === 'string' ? args[0] : args[0]?.text;
  const isLock = typeof text === 'string' && text.includes(':axion-events');
  const isEnd = typeof text === 'string' && /^\s*(commit|rollback)\s*$/i.test(text);
  if (!isLock && !isEnd) return orig.apply(this, args);
  const t0 = performance.now();
  const p = orig.apply(this, args);
  if (!p || typeof p.then !== 'function') return p;
  return p.then((r: unknown) => {
    const t1 = performance.now();
    if (isLock && !grantedAt.has(this)) { waits.push(t1 - t0); grantedAt.set(this, t1); }
    if (isEnd && grantedAt.has(this)) { holds.push(t1 - grantedAt.get(this)!); grantedAt.delete(this); }
    return r;
  }, (e: unknown) => { grantedAt.delete(this); throw e; });
};

const pool = new pg.Pool({ connectionString: url, max: 2 });
await migrate(pool, 'down', 0); await migrate(pool, 'up'); await pool.end();
const app = await buildApp({ databaseUrl: url!, logger: false, uploadDir: mkdtempSync(join(tmpdir(), 'axion-lockhold-')), demoSeed: false, staffingStepMs: 600 });
const admin = new Browser(app);
if ((await admin.connect('Luca', 'pass1234')).status !== 200) throw new Error('connect failed');
holds.length = 0; waits.length = 0;
let next = 0; let failed = 0;
const t0 = performance.now();
await Promise.all(Array.from({ length: CONC }, async () => {
  for (;;) {
    const i = next++; if (i >= TOTAL) return;
    const r = await admin.req('POST', '/missions', { text: `Lock-hold probe mission ${i}: check the pricing page.`, files: [], shared: false }, { 'idempotency-key': `lh-${i}` });
    if (r.status >= 300) failed++;
  }
}));
const secs = (performance.now() - t0) / 1000;
await new Promise((r) => setTimeout(r, 3000)); // let the staffing sim's own transactions finish too
const q = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN; };
const f = (n: number) => n.toFixed(2);
console.log(`writes: ${TOTAL} at concurrency ${CONC} in ${f(secs)} s (${f(TOTAL / secs)}/s), failed ${failed}`);
console.log(`events-lock transactions observed: ${holds.length}`);
console.log(`HOLD ms  (lock granted -> commit returned): p50 ${f(q(holds, .5))}  p95 ${f(q(holds, .95))}  p99 ${f(q(holds, .99))}  MAX ${f(Math.max(...holds))}`);
console.log(`WAIT ms  (lock query itself, queueing):     p50 ${f(q(waits, .5))}  p95 ${f(q(waits, .95))}  p99 ${f(q(waits, .99))}  MAX ${f(Math.max(...waits))}`);
await app.close();
process.exit(0);
