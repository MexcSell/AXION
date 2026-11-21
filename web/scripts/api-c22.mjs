// Cycle 22 (lane w20): long conversation threads load fast. Measures, in api mode, how long a thread page takes from
// `page.reload()` to interactive (composer focusable, newest message visible) after N messages were posted to the open
// thread (the api-stage6 pattern: a 10-wide POST burst while the page shows the thread), and again once the page is idle.
// Optional Chromium trace per size (TRACE=1): main-thread long tasks and the top functions by self time.
// Run through scripts/api-e2e.sh. Env: SIZES (default "130,1000"), REPS (default 3), CAP_MS (default 180000),
// TRACE_DIR (default /tmp/axion-c22), TRACE=1 traces the first rep of each size.
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
const base = process.env.BASE || 'http://127.0.0.1:5193';
const SIZES = (process.env.SIZES || '130,1000').split(',').map(Number);
const REPS = Number(process.env.REPS || 3);
const CAP = Number(process.env.CAP_MS || 180000);
const DIR = process.env.TRACE_DIR || '/tmp/axion-c22';
const TRACE = process.env.TRACE === '1';
mkdirSync(DIR, { recursive: true });
if (process.env.SUMMARISE) { console.log(JSON.stringify(summarise(process.env.SUMMARISE, {}), null, 1)); process.exit(0); }
const load = () => readFileSync('/proc/loadavg', 'utf8').split(' ').slice(0, 3).join(' ');
const until = async (f, ms = 10000, step = 100) => { const t0 = Date.now(); for (;;) { try { if (await f()) return true; } catch { /* retry */ } if (Date.now() - t0 > ms) return false; await new Promise((r) => setTimeout(r, step)); } };

const b = await chromium.launch({ executablePath: process.env.PW_CHROME || '/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome' });
const ctx = await b.newContext({ viewport: { width: 1600, height: 940 } });
await ctx.addInitScript(() => { try { localStorage.setItem('axion.data-mode', 'api'); localStorage.setItem('axion.testhook', '1'); } catch { /* ignore */ } });
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
const key = () => `c22-${Date.now()}-${k++}`;

/** A real mission with a human↔GM thread, opened in the page. */
async function freshThread() {
  const made = await api('POST', '/missions', { text: `Cycle 22 long thread ${Date.now()}`, files: [], shared: true }, { 'idempotency-key': key() });
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
/** reload → commit, and → interactive (the composer takes focus and the newest message is inside the thread viewport) */
async function timedReload(newest) {
  const t0 = Date.now();
  let commit = null, interactive = null, err = '';
  try {
    await p.reload({ waitUntil: 'commit', timeout: CAP });
    commit = Date.now() - t0;
    const ok = await until(() => p.evaluate((text) => {
      const ta = document.querySelector('.conv-main .composer textarea');
      if (!ta || ta.disabled) return false;
      ta.focus();
      if (document.activeElement !== ta) return false;
      const body = document.querySelector('.conv-main .thread-body');
      if (!body) return false;
      const box = body.getBoundingClientRect();
      const n = [...body.querySelectorAll('[data-mid]')].reverse().find((e) => e.textContent.includes(text));
      if (!n) return false;
      const r = n.getBoundingClientRect();
      return r.bottom > box.top && r.top < box.bottom;
    }, newest), Math.max(1000, CAP - commit), 50);
    if (ok) interactive = Date.now() - t0; else err = 'not interactive within the cap';
  } catch (e) { err = e.message.split('\n')[0]; }
  return { commit, interactive, err };
}

/**
 * Long tasks on the renderer main thread (top-level trace slices merged into busy intervals; ≥ 50 ms counts as long)
 * and the CPU profile: top functions by self time, and the app's own functions by inclusive time.
 */
const TOP = new Set(['RunTask', 'ThreadControllerImpl::RunTask', 'FunctionCall', 'RunMicrotasks', 'EventDispatch', 'TimerFire', 'FireAnimationFrame', 'UpdateLayoutTree', 'Layout', 'Paint', 'ParseHTML', 'EvaluateScript', 'v8.compile', 'HitTest', 'Commit', 'PrePaint', 'Layerize']);
function summarise(file, marks) {
  const size = statSync(file).size;
  if (size > 480_000_000) return { skipped: `trace too large to parse (${size} B)`, marks };
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  const ev = parsed.traceEvents ?? parsed;
  const mains = new Set(ev.filter((e) => e.ph === 'M' && e.name === 'thread_name' && e.args?.name === 'CrRendererMain').map((e) => `${e.pid}:${e.tid}`));
  const t0 = ev.reduce((m, e) => (e.ts > 0 && e.ts < m ? e.ts : m), Infinity);
  const slices = ev.filter((e) => e.ph === 'X' && TOP.has(e.name) && mains.has(`${e.pid}:${e.tid}`) && e.dur > 0).map((e) => [e.ts, e.ts + e.dur]).sort((a, b) => a[0] - b[0]);
  const busy = [];
  for (const [a, z] of slices) { const l = busy[busy.length - 1]; if (l && a <= l[1] + 1000) l[1] = Math.max(l[1], z); else busy.push([a, z]); } // gaps under 1 ms join
  const long = busy.filter(([a, z]) => z - a >= 50_000).map(([a, z]) => ({ at: Math.round((a - t0) / 1000), ms: Math.round((z - a) / 1000) }));
  const self = new Map(), incl = new Map(), nodes = new Map();
  let total = 0;
  const nm = (cf) => `${cf.functionName || '(anonymous)'} ${(cf.url || (cf.scriptId ? '' : '(native)')).replace(/^.*\/(node_modules\/\.vite\/deps|src)\//, '$1/').replace(/\?.*$/, '')}:${(cf.lineNumber ?? 0) + 1}`;
  for (const e of ev) {
    if (e.name !== 'ProfileChunk') continue;
    const cp = e.args?.data?.cpuProfile;
    if (!cp) continue;
    for (const n of cp.nodes ?? []) nodes.set(`${e.id}:${n.id}`, { cf: n.callFrame, parent: n.parent != null ? `${e.id}:${n.parent}` : null });
    const dt = e.args.data.timeDeltas ?? [];
    (cp.samples ?? []).forEach((smp, i) => {
      const d = (dt[i] ?? 0) / 1000;
      let key = `${e.id}:${smp}`, first = true;
      const seen = new Set();
      while (key && nodes.has(key)) {
        const n = nodes.get(key), name = nm(n.cf);
        if (first) { self.set(name, (self.get(name) ?? 0) + d); first = false; }
        if (!seen.has(name)) { incl.set(name, (incl.get(name) ?? 0) + d); seen.add(name); }
        key = n.parent;
      }
      total += d;
    });
  }
  const rank = (m, re) => [...m.entries()].filter(([n]) => !re || re.test(n)).filter(([n]) => !/^\((idle|program|root)\)/.test(n)).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([n, ms]) => ({ fn: n, ms: Math.round(ms) }));
  return {
    long: { count: long.length, totalMs: long.reduce((s, x) => s + x.ms, 0), worstMs: long.reduce((s, x) => Math.max(s, x.ms), 0), list: long },
    sampledMs: Math.round(total), top: rank(self), app: rank(incl, / src\//), marks,
  };
}

const out = { base, at: new Date().toISOString(), runs: [] };
for (const n of SIZES) {
  // REPS timed runs without tracing, then (TRACE=1) one extra traced run that is not counted (the profiler slows it down)
  for (let rep = 1; rep <= REPS + (TRACE ? 1 : 0); rep++) {
    const tracing = rep > REPS;
    const { mid, tid } = await freshThread();
    const traceFile = `${DIR}/trace-${n}.json`;
    if (tracing) await b.startTracing(p, { path: traceFile, categories: ['toplevel', 'devtools.timeline', 'v8.execute', 'disabled-by-default-v8.cpu_profiler'] });
    const tb = Date.now();
    const loadBefore = load();
    await burst(tid, n, 'long message');
    const burstMs = Date.now() - tb;
    const afterBurst = await timedReload(`long message ${String(n).padStart(4, '0')}`);
    const marks = { burstMs, reloadAt: burstMs, commitAt: afterBurst.commit != null ? burstMs + afterBurst.commit : null, interactiveAt: afterBurst.interactive != null ? burstMs + afterBurst.interactive : null };
    if (tracing) await b.stopTracing();
    // the same thread, reloaded again once the page is idle (no backlog)
    const idle = afterBurst.interactive != null ? await timedReload(`long message ${String(n).padStart(4, '0')}`) : { commit: null, interactive: null, err: 'skipped' };
    console.log(`N=${n} ${tracing ? 'traced run (not counted)' : `rep ${rep}`} · load ${loadBefore} · burst ${burstMs} ms · after-burst reload: commit ${afterBurst.commit ?? '-'} ms, interactive ${afterBurst.interactive ?? '-'} ms ${afterBurst.err} · idle reload: commit ${idle.commit ?? '-'} ms, interactive ${idle.interactive ?? '-'} ms ${idle.err}`);
    let trace = null;
    if (tracing) {
      try { trace = summarise(traceFile, marks); } catch (e) { trace = { skipped: `trace not parsed: ${e.message}` }; }
      if (trace.skipped) console.log(`  ${trace.skipped}`);
      else {
        console.log(`  long tasks (≥50 ms, renderer main): ${trace.long.count}, total ${trace.long.totalMs} ms, worst ${trace.long.worstMs} ms · sampled JS ${trace.sampledMs} ms`);
        const inReload = trace.long.list.filter((x) => x.at + x.ms >= marks.reloadAt && (marks.interactiveAt == null || x.at <= marks.interactiveAt));
        console.log(`  long tasks between reload and interactive (trace clock ≈ burst start): ${inReload.length}, total ${inReload.reduce((q, x) => q + x.ms, 0)} ms, worst ${inReload.reduce((q, x) => Math.max(q, x.ms), 0)} ms; busy until ${trace.long.list.length ? Math.max(...trace.long.list.map((x) => x.at + x.ms)) : 0} ms`);
        console.log('  top self time:'); for (const t of trace.top.slice(0, 12)) console.log(`    ${String(t.ms).padStart(7)} ms  ${t.fn}`);
        console.log('  app functions, inclusive:'); for (const t of trace.app.slice(0, 8)) console.log(`    ${String(t.ms).padStart(7)} ms  ${t.fn}`);
      }
    }
    out.runs.push({ n, rep: tracing ? 'traced' : rep, mid, load: loadBefore, burstMs, afterBurst, idle, trace });
    if (afterBurst.interactive == null && !tracing) { console.log('  (not interactive within the cap; the remaining untraced reps of this size are skipped)'); rep = REPS; }
  }
}
out.errors = errors;
writeFileSync(`${DIR}/c22-${Date.now()}.json`, JSON.stringify(out, null, 1));
console.log(`page errors: ${errors.length}${errors.length ? ' — ' + errors.slice(0, 3).join(' | ') : ''}`);
await b.close();
