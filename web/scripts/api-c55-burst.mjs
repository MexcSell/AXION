// Cycle 55 (lane w54), items 2 and 4: the cost of a live burst in an open thread, with DOM-only conditions so the same script
// runs on the dev server and on a production build (`vite preview`: there is no `import('/src/...')` there). A thread is
// filled with FILL messages (default 1,000), the reader sits at the bottom, a Chromium trace covers BURST live messages
// (default 200, posted 10 at a time). Printed per rep, with the 1-minute load average:
//   - the whole-trace long-task total and worst (the c22 summariser, as api-c26 and the c44 report use),
//   - forced layouts: `Layout` and `UpdateLayoutTree` trace events that carry a JavaScript stack (the trace category
//     disabled-by-default-devtools.timeline.stack), grouped by the first frame of the page's own code. Dev only: a
//     production build has minified names, so only the totals are meaningful there.
// Run through scripts/api-e2e.sh. Env: REPS (3), FILL (1000), BURST (200), TRACE_DIR, LABEL (printed), MAX_FORCED_HOLD_MS (optional:
// exit 1 when the forced layouts attributed to ChatView's hold/record add up to more than this many ms per burst).
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
const base = process.env.BASE || 'http://127.0.0.1:5193';
const REPS = Number(process.env.REPS || 3), FILL = Number(process.env.FILL || 1000), BURST = Number(process.env.BURST || 200);
const DIR = process.env.TRACE_DIR || '/tmp/axion-c55', LABEL = process.env.LABEL || '';
const MAX_FORCED_HOLD = process.env.MAX_FORCED_HOLD_MS ? Number(process.env.MAX_FORCED_HOLD_MS) : null;
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
const errors = []; p.on('pageerror', (e) => errors.push(e.message));
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
let k = 0; const key = () => `c55b-${Date.now()}-${k++}`;
const blocks = () => p.locator('.conv-main .minimap .mm-block').count(); // one block per message the page holds
const quiet = (ms, cap) => until(() => p.evaluate((ms) => { const l = window.__lt; const end = l.length ? Math.max(...l.map(([s, d]) => s + d)) : 0; return performance.now() - end > ms; }, ms), cap, 200);
const burst = async (tid, n, tag) => { for (let i = 0; i < n; i += 10) await Promise.all(Array.from({ length: Math.min(10, n - i) }, (_, j) => api('POST', `/threads/${tid}/messages`, { kind: 'command', text: `${tag} ${String(i + j + 1).padStart(4, '0')}`, to: 'gm' }, { 'idempotency-key': key() }))); };
const newestVisible = (text) => p.evaluate((text) => { const body = document.querySelector('.conv-main .thread-body'); if (!body) return false; const box = body.getBoundingClientRect(); const n = [...body.querySelectorAll('[data-mid]')].reverse().find((e) => e.textContent.includes(text)); if (!n) return false; const r = n.getBoundingClientRect(); return r.bottom > box.top && r.top < box.bottom; }, text);

/** forced layouts in a trace: events with a JavaScript stack, by the first frame of the page's own code */
function forced(file) {
  const ev = JSON.parse(readFileSync(file, 'utf8')).traceEvents;
  const out = { n: 0, ms: 0, by: {}, all: { layout: 0, layoutMs: 0, style: 0, styleMs: 0 } };
  for (const e of ev) {
    if (e.ph !== 'X' || (e.name !== 'Layout' && e.name !== 'UpdateLayoutTree')) continue;
    const ms = (e.dur || 0) / 1000;
    if (e.name === 'Layout') { out.all.layout++; out.all.layoutMs += ms; } else { out.all.style++; out.all.styleMs += ms; }
    const st = e.args?.beginData?.stackTrace ?? e.args?.stackTrace;
    if (!st?.length) continue;
    const f = st.find((x) => /\/src\/|assets\//.test(x.url ?? '')) ?? st[0];
    const fi = st.indexOf(f), up = st.slice(fi + 1).find((x) => /\/src\//.test(x.url ?? ''));
    const name = `${f.functionName || '(anonymous)'} ${String(f.url ?? '').replace(/^.*\/(src|assets)\//, '$1/')}:${f.lineNumber}${up && /\b(hold|record)\b/.test(f.functionName ?? '') ? ` <- ${up.functionName || '(anonymous)'}:${up.lineNumber}` : ''}`;
    out.n++; out.ms += ms; (out.by[name] ??= { n: 0, ms: 0 }); out.by[name].n++; out.by[name].ms += ms;
  }
  return out;
}
const runs = [];
for (let rep = 1; rep <= REPS; rep++) {
  const made = await api('POST', '/missions', { text: `Cycle 55 burst ${Date.now()}`, files: [], shared: true }, { 'idempotency-key': key() });
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
  await burst(tid, FILL, 'fill');
  const filled = await until(async () => (await blocks()) >= FILL + 1, 180000, 250);
  await quiet(1500, 180000);
  await p.locator('.conv-main .thread-body').evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await quiet(800, 20000);
  const have = await blocks();
  const d0 = await p.locator('.conv-main .thread-body').evaluate((el) => [Math.round(el.scrollHeight - el.scrollTop - el.clientHeight), el.scrollTop, el.scrollHeight, el.clientHeight]);
  console.log('  before the burst: distance/scrollTop/scrollHeight/clientHeight', d0.join(' '));
  const file = `${DIR}/trace-${rep}.json`;
  const loadBefore = load();
  await b.startTracing(p, { path: file, categories: ['toplevel', 'devtools.timeline', 'disabled-by-default-devtools.timeline', 'disabled-by-default-devtools.timeline.stack', 'v8.execute', 'disabled-by-default-v8.cpu_profiler'] });
  await p.evaluate(() => 0); await quiet(300, 10000);
  const tb = Date.now();
  await burst(tid, BURST, 'live');
  const caught = await until(async () => (await blocks()) >= have + BURST, 180000, 100);
  const caughtMs = Date.now() - tb;
  await quiet(1000, 120000);
  await b.stopTracing();
  const loadAfter = load();
  const dist = await p.locator('.conv-main .thread-body').evaluate((el) => Math.round(el.scrollHeight - el.scrollTop - el.clientHeight));
  const pinned = await newestVisible(`live ${String(BURST).padStart(4, '0')}`) || await p.locator('.conv-main .thread-body').evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight < 60);
  let trace; try { trace = JSON.parse(execFileSync('node', ['scripts/api-c22.mjs'], { env: { ...process.env, SUMMARISE: file }, maxBuffer: 64 << 20 }).toString()); } catch (e) { trace = { skipped: e.message.split('\n')[0] }; }
  const f = forced(file);
  if (!process.env.KEEP_TRACES) rmSync(file, { force: true });
  const hold = Object.entries(f.by).filter(([n]) => /\b(hold|record)\b/.test(n)).reduce((s, [, v]) => ({ n: s.n + v.n, ms: s.ms + v.ms }), { n: 0, ms: 0 });
  runs.push({ rep, long: trace.long, f, hold, caught, pinned });
  console.log(`${LABEL} rep ${rep} · load ${loadBefore} -> ${loadAfter} · filled ${filled} (${have} held) · burst ${BURST}: store has it ${caught ? caughtMs + ' ms' : 'NO'} · still pinned ${pinned} (${dist} px from the bottom)`);
  console.log(`  whole trace long tasks: ${trace.long ? `${trace.long.count}, total ${trace.long.totalMs} ms, worst ${trace.long.worstMs} ms` : trace.skipped}`);
  console.log(`  layout events: Layout ${f.all.layout} (${f.all.layoutMs.toFixed(0)} ms), UpdateLayoutTree ${f.all.style} (${f.all.styleMs.toFixed(0)} ms) · with a JS stack (forced): ${f.n}, ${f.ms.toFixed(0)} ms · by hold/record: ${hold.n}, ${hold.ms.toFixed(0)} ms`);
  for (const [n, v] of Object.entries(f.by).sort((x, y) => y[1].ms - x[1].ms).slice(0, 6)) console.log(`    ${v.ms.toFixed(0).padStart(6)} ms ${String(v.n).padStart(4)}x  ${n}`);
  if (trace.top) for (const t of trace.top.filter((t) => /scrollTop|scrollHeight|getBoundingClientRect|offsetTop|offsetHeight/.test(t.fn)).slice(0, 4)) console.log(`    self ${String(t.ms).padStart(6)} ms  ${t.fn}`);
}
const mean = (a) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
console.log(`${LABEL} SUMMARY ${REPS} reps · long-task total mean ${mean(runs.map((r) => r.long?.totalMs ?? 0)).toFixed(0)} ms · forced layouts by hold/record mean ${mean(runs.map((r) => r.hold.n)).toFixed(1)} (${mean(runs.map((r) => r.hold.ms)).toFixed(0)} ms) · all forced mean ${mean(runs.map((r) => r.f.n)).toFixed(1)} (${mean(runs.map((r) => r.f.ms)).toFixed(0)} ms)`);
// `pinned` is printed, not gated: after a fast burst the reader is not at the bottom any more on the base too (c55 concern)
const ok = runs.every((r) => r.caught) && errors.length === 0 && (MAX_FORCED_HOLD == null || runs.every((r) => r.hold.ms <= MAX_FORCED_HOLD));
console.log(`${ok ? 'PASS' : 'FAIL'} burst complete, no page errors${MAX_FORCED_HOLD != null ? `, forced-layout time in hold/record <= ${MAX_FORCED_HOLD} ms` : ''}${errors.length ? ' — ' + errors.join(' | ') : ''}`);
await b.close();
process.exit(ok ? 0 : 1);
