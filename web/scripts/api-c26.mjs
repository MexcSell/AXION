// Cycle 26 (lane w24): virtualised conversation threads. Measures, in api mode, main-thread busy time while a live burst
// of BURST messages (default 200) arrives in an open thread that already holds FILL messages (default 1,000), with the
// reader pinned to the bottom. Method of cycle 22 (scripts/api-c22.mjs): a Chromium trace over the burst, top-level
// renderer-main slices merged into busy periods (gaps under 1 ms join), >= 50 ms counts as a long task; the trace is
// summarised by `SUMMARISE=<trace> node scripts/api-c22.mjs`. A PerformanceObserver('longtask') count is printed beside it.
// Run through scripts/api-e2e.sh. Env: REPS (3), FILL (1000), BURST (200), TRACE_DIR (/tmp/axion-c26),
// MAX_TOTAL_MS / MAX_WORST_MS (optional thresholds: any rep above them exits 1).
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
const base = process.env.BASE || 'http://127.0.0.1:5193';
const REPS = Number(process.env.REPS || 3);
const FILL = Number(process.env.FILL || 1000);
const BURST = Number(process.env.BURST || 200);
const DIR = process.env.TRACE_DIR || '/tmp/axion-c26';
const MAX_TOTAL = process.env.MAX_TOTAL_MS ? Number(process.env.MAX_TOTAL_MS) : null;
const MAX_WORST = process.env.MAX_WORST_MS ? Number(process.env.MAX_WORST_MS) : null;
mkdirSync(DIR, { recursive: true });
const load = () => readFileSync('/proc/loadavg', 'utf8').split(' ').slice(0, 3).join(' ');
const until = async (f, ms = 10000, step = 100) => { const t0 = Date.now(); for (;;) { try { if (await f()) return true; } catch { /* retry */ } if (Date.now() - t0 > ms) return false; await new Promise((r) => setTimeout(r, step)); } };

const b = await chromium.launch({ executablePath: process.env.PW_CHROME || '/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome' });
const ctx = await b.newContext({ viewport: { width: 1600, height: 940 } });
await ctx.addInitScript(() => {
  try { localStorage.setItem('axion.data-mode', 'api'); localStorage.setItem('axion.testhook', '1'); } catch { /* ignore */ }
  window.__lt = [];
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true }); } catch { /* ignore */ }
});
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
await p.goto(base + '/missions', { waitUntil: 'domcontentloaded' });
await p.getByRole('heading', { name: 'Connect' }).waitFor({ timeout: 20000 });
await p.getByLabel('Name').fill('Luca');
await p.getByLabel('Password', { exact: true }).fill('secret-1');
await p.getByRole('button', { name: /Connect/ }).click();
await p.waitForSelector('.rail-nav', { timeout: 20000 });
let csrf = '';
const api = async (method, path, data, headers = {}) => {
  if (!csrf && method !== 'GET') csrf = (await (await p.request.get(base + '/api/v1/me')).json()).me.csrf;
  const r = await p.request.fetch(base + '/api/v1' + path, { method, data, headers: { ...(method !== 'GET' ? { 'x-csrf': csrf } : {}), ...headers } });
  return { status: r.status(), body: await r.json().catch(() => ({})) };
};
let k = 0;
const key = () => `c26-${Date.now()}-${k++}`;

async function freshThread() {
  const made = await api('POST', '/missions', { text: `Cycle 26 long thread ${Date.now()}`, files: [], shared: true }, { 'idempotency-key': key() });
  const mid = made.body.mission.id;
  await until(async () => ((await api('GET', `/missions/${mid}/hierarchy`)).body.nodes ?? []).length >= 2, 15000);
  await p.goto(`${base}/missions/${mid}?tab=conversations&agent=gm`, { waitUntil: 'domcontentloaded' });
  const c = p.locator('.conv-main .composer').first();
  await c.waitFor({ timeout: 15000 });
  await c.locator('textarea').fill('first command');
  await c.getByRole('button', { name: 'Send message' }).click();
  let tid;
  await until(async () => { tid = ((await api('GET', `/missions/${mid}/threads`)).body.threads ?? []).find((t) => t.a === 'human' || t.b === 'human')?.id; return !!tid; }, 10000);
  await until(async () => (await p.locator('.conv-main .bubble-note').count()) > 0, 10000);
  return { mid, tid };
}
const burst = async (tid, n, tag) => {
  for (let i = 0; i < n; i += 10) {
    await Promise.all(Array.from({ length: Math.min(10, n - i) }, (_, j) => api('POST', `/threads/${tid}/messages`, { kind: 'command', text: `${tag} ${String(i + j + 1).padStart(4, '0')}`, to: 'gm' }, { 'idempotency-key': key() })));
  }
};
/** messages the open page holds for the thread (the app's own store, the module the app loaded) */
const held = (mid, tid) => p.evaluate(async ({ mid, tid }) => (await import('/src/api/missionControl.ts')).useMC.getState().byMission[mid]?.threads?.[tid]?.messages.length ?? 0, { mid, tid });
/** the newest message is rendered inside the thread viewport */
const newestVisible = (text) => p.evaluate((text) => {
  const body = document.querySelector('.conv-main .thread-body');
  if (!body) return false;
  const box = body.getBoundingClientRect();
  const n = [...body.querySelectorAll('[data-mid]')].reverse().find((e) => e.textContent.includes(text));
  if (!n) return false;
  const r = n.getBoundingClientRect();
  return r.bottom > box.top && r.top < box.bottom;
}, text);
/** no long task for `ms` (PerformanceObserver), i.e. the page has caught up */
const quiet = (ms, cap) => until(() => p.evaluate((ms) => { const l = window.__lt; const end = l.length ? Math.max(...l.map(([s, d]) => s + d)) : 0; return performance.now() - end > ms; }, ms), cap, 200);

const runs = [];
for (let rep = 1; rep <= REPS; rep++) {
  const { mid, tid } = await freshThread();
  const tf = Date.now();
  await burst(tid, FILL, 'fill');
  const filled = await until(async () => (await held(mid, tid)) >= FILL + 1 && (await newestVisible(`fill ${String(FILL).padStart(4, '0')}`)), 180000, 250);
  await quiet(1500, 180000);
  const fillMs = Date.now() - tf;
  await p.locator('.conv-main .thread-body').evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await quiet(800, 20000);
  const before = { held: await held(mid, tid), rows: await p.locator('.conv-main .thread-body [data-mid]').count(), blocks: await p.locator('.conv-main .minimap .mm-block').count() };
  const traceFile = `${DIR}/trace-burst-${rep}.json`;
  const loadBefore = load();
  const lt0 = await p.evaluate(() => performance.now());
  await b.startTracing(p, { path: traceFile, categories: ['toplevel', 'devtools.timeline', 'v8.execute', 'disabled-by-default-v8.cpu_profiler'] });
  const tb = Date.now();
  await burst(tid, BURST, 'live');
  const burstMs = Date.now() - tb;
  const caught = await until(async () => (await held(mid, tid)) >= before.held + BURST && (await newestVisible(`live ${String(BURST).padStart(4, '0')}`)), 180000, 100);
  const caughtMs = Date.now() - tb;
  await quiet(1000, 60000);
  await b.stopTracing();
  const lt = await p.evaluate((t0) => window.__lt.filter(([s]) => s >= t0), lt0);
  const after = { held: await held(mid, tid), rows: await p.locator('.conv-main .thread-body [data-mid]').count(), blocks: await p.locator('.conv-main .minimap .mm-block').count() };
  let trace;
  try { trace = JSON.parse(execFileSync('node', ['scripts/api-c22.mjs'], { env: { ...process.env, SUMMARISE: traceFile }, maxBuffer: 64 << 20 }).toString()); } catch (e) { trace = { skipped: e.message.split('\n')[0] }; }
  if (!process.env.KEEP_TRACES) rmSync(traceFile, { force: true });
  const po = { count: lt.length, totalMs: Math.round(lt.reduce((s, [, d]) => s + d, 0)), worstMs: Math.round(lt.reduce((s, [, d]) => Math.max(s, d), 0)) };
  const r = { rep, mid, tid, load: loadBefore, filled, fillMs, before, after, burstMs, caught, caughtMs, trace: trace.long ? { count: trace.long.count, totalMs: trace.long.totalMs, worstMs: trace.long.worstMs, list: trace.long.list, sampledMs: trace.sampledMs, packages: trace.packages, top: trace.top?.slice(0, 12), app: trace.app?.slice(0, 8) } : trace, longtaskObserver: po };
  runs.push(r);
  console.log(`rep ${rep} · load ${loadBefore} · fill ${FILL} in ${fillMs} ms (held ${before.held}, DOM rows ${before.rows}, minimap blocks ${before.blocks}) · burst ${BURST} posted in ${burstMs} ms, caught up ${caught ? caughtMs + ' ms' : 'NO'} (held ${after.held}, DOM rows ${after.rows}, blocks ${after.blocks})`);
  if (trace.long) {
    console.log(`  trace long tasks (>=50 ms, renderer main): ${trace.long.count}, total ${trace.long.totalMs} ms, worst ${trace.long.worstMs} ms · sampled JS ${trace.sampledMs} ms`);
    console.log(`  self time by package: ${trace.packages.map((x) => `${x.pkg} ${x.ms}`).join(' · ')}`);
    console.log('  top self time:'); for (const t of trace.top.slice(0, 10)) console.log(`    ${String(t.ms).padStart(7)} ms  ${t.fn}`);
    console.log('  app functions, inclusive:'); for (const t of trace.app.slice(0, 6)) console.log(`    ${String(t.ms).padStart(7)} ms  ${t.fn}`);
  } else console.log(`  trace: ${trace.skipped}`);
  console.log(`  PerformanceObserver longtask: ${po.count}, total ${po.totalMs} ms, worst ${po.worstMs} ms`);
}
const tot = runs.map((r) => r.trace?.totalMs).filter((x) => x != null), worst = runs.map((r) => r.trace?.worstMs).filter((x) => x != null);
const mean = (a) => (a.length ? Math.round(a.reduce((s, x) => s + x, 0) / a.length) : null);
console.log(`summary: long-task total per rep ${tot.join(' / ')} ms (mean ${mean(tot)}) · worst task per rep ${worst.join(' / ')} ms · page errors ${errors.length}${errors.length ? ' — ' + errors.slice(0, 3).join(' | ') : ''}`);
const miss = runs.filter((r) => !r.caught || r.trace?.totalMs == null || (MAX_TOTAL != null && r.trace.totalMs > MAX_TOTAL) || (MAX_WORST != null && r.trace.worstMs > MAX_WORST));
for (const r of miss) console.log(`THRESHOLD MISS rep ${r.rep}: total ${r.trace?.totalMs} ms (max ${MAX_TOTAL}), worst ${r.trace?.worstMs} ms (max ${MAX_WORST}), caught up ${r.caught}`);
if (miss.length || errors.length || tot.length < REPS) process.exitCode = 1;
writeFileSync(`${DIR}/c26-${Date.now()}.json`, JSON.stringify({ base, at: new Date().toISOString(), FILL, BURST, runs, errors }, null, 1));
await b.close();
