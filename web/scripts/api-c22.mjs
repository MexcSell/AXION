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
const TOP = new Set(['RunTask', 'ThreadControllerImpl::RunTask', 'FunctionCall', 'RunMicrotasks', 'EventDispatch', 'TimerFire', 'FireAnimationFrame', 'UpdateLayoutTree', 'Layout', 'Paint', 'ParseHTML', 'EvaluateScript', 'v8.compile', 'HitTest', 'Commit', 'PrePaint', 'Layerize']);
if (process.env.SUMMARISE) { console.log(JSON.stringify(summarise(process.env.SUMMARISE, {}), null, 1)); process.exit(0); }
const load = () => readFileSync('/proc/loadavg', 'utf8').split(' ').slice(0, 3).join(' ');
const until = async (f, ms = 10000, step = 100) => { const t0 = Date.now(); for (;;) { try { if (await f()) return true; } catch { /* retry */ } if (Date.now() - t0 > ms) return false; await new Promise((r) => setTimeout(r, step)); } };

const b = await chromium.launch({ executablePath: process.env.PW_CHROME || '/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome' });
const ctx = await b.newContext({ viewport: { width: 1600, height: 940 } });
await ctx.addInitScript(() => { try { localStorage.setItem('axion.data-mode', 'api'); localStorage.setItem('axion.testhook', '1'); } catch { /* ignore */ } });
let p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
/** A page stuck past the cap is closed (its renderer would block the next rep) and replaced; the session cookie stays in the context. */
async function replacePage() {
  await p.close({ runBeforeUnload: false }).catch(() => undefined);
  p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(base + '/missions', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('.rail-nav', { timeout: 30000 });
}
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
  const bySlice = new Map();
  for (const e of ev) if (e.ph === 'X' && e.dur > 0 && mains.has(`${e.pid}:${e.tid}`) && TOP.has(e.name) && e.name !== 'RunTask' && e.name !== 'ThreadControllerImpl::RunTask') bySlice.set(e.name, (bySlice.get(e.name) ?? 0) + e.dur / 1000);
  const self = new Map(), incl = new Map(), nodes = new Map(), pkg = new Map();
  const pkgOf = (cf) => { const u = cf.url || ''; if (!u) return cf.functionName === '(garbage collector)' ? 'gc' : 'native'; if (/\/src\//.test(u)) return 'app'; if (/react-dom/.test(u)) return 'react-dom'; if (/motion|framer/.test(u)) return 'motion'; if (/jsx|react-[A-Za-z0-9_]+\.js|\/react\.js/.test(u)) return 'react'; if (/zustand/.test(u)) return 'zustand'; return u.replace(/^.*\/(deps\/)?/, '').replace(/\?.*$/, ''); };
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
        if (first) { self.set(name, (self.get(name) ?? 0) + d); pkg.set(pkgOf(n.cf), (pkg.get(pkgOf(n.cf)) ?? 0) + d); first = false; }
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
    packages: [...pkg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([n, ms]) => ({ pkg: n, ms: Math.round(ms) })),
    slices: [...bySlice.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([n, ms]) => ({ slice: n, ms: Math.round(ms) })),
  };
}

/** No behaviour change (rep 1 of each size, after the idle reload): draft kept, pinned to the bottom, minimap, paging anchor. */
const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok: !!ok, detail }); console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };
async function behaviour(n, mid, tid) {
  const body = p.locator('.conv-main .thread-body');
  // cycle 26: the thread is virtualised (only the rows near the viewport are in the DOM). Loaded messages are read from the
  // app's store; the minimap blocks carry their message's id (data-mm)
  const loaded = () => p.evaluate(async ({ mid, tid }) => (await import('/src/api/missionControl.ts')).useMC.getState().byMission[mid]?.threads?.[tid]?.messages?.map((m) => m.id) ?? [], { mid, tid });
  const blockIds = () => p.locator('.conv-main .minimap .mm-block').evaluateAll((els) => els.map((e) => e.getAttribute('data-mm')));
  check(`N=${n}: after the reload the thread is pinned to the bottom`, await until(() => body.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight < 60), 5000));
  const blocks = async () => { const [b, m] = [await blockIds(), await loaded()]; return [b.length, m.length, b.every((x, i) => x === m[i])]; };
  check(`N=${n}: the minimap has one block per loaded message`, await until(async () => { const [b, m, same] = await blocks(); return b === m && m > 0 && same; }, 5000), (await blocks()).slice(0, 2).join(' blocks / ') + ' loaded');
  const draft = `c22 draft ${Date.now()}`;
  await p.locator('.conv-main .composer textarea').fill(draft);
  await p.reload({ waitUntil: 'domcontentloaded' });
  check(`N=${n}: an unsent draft survives a reload`, await until(async () => (await p.locator('.conv-main .composer textarea').inputValue()) === draft, 15000));
  await p.locator('.conv-main .composer textarea').fill('');
  await until(async () => (await loaded()).length >= 50, 10000);
  // cycle 26 fix round: the store can hold the page a moment before the thread has rendered and pinned it; scroll to the
  // top only once the rows are on screen and pinned (otherwise the pin lands after the jump and no older page is asked for)
  await until(() => body.evaluate((el) => el.querySelectorAll('[data-mid]').length > 0 && el.scrollHeight - el.scrollTop - el.clientHeight < 60), 5000);
  const before = (await loaded()).length;
  const a = await body.evaluate(async (el) => {
    // cycle 26: the thread is virtualised; the rows at the top render on the frame after the jump (the reader sees them then)
    el.scrollTop = 0;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const box = el.getBoundingClientRect();
    const first = [...el.querySelectorAll('[data-mid]')].find((x) => x.getBoundingClientRect().bottom > box.top);
    return { id: first.getAttribute('data-mid'), top: first.getBoundingClientRect().top - box.top };
  });
  const grew = await until(async () => (await loaded()).length > before, 8000);
  await p.waitForTimeout(400);
  const after = await body.evaluate((el, id) => { const x = el.querySelector(`[data-mid="${id}"]`); return x ? x.getBoundingClientRect().top - el.getBoundingClientRect().top : null; }, a.id);
  const all = await blockIds();
  check(`N=${n}: scrolling up loads the next older page, the top message stays put, no duplicates`, grew && after != null && Math.abs(after - a.top) <= 4 && new Set(all).size === all.length, `${before} → ${all.length} rows, shift ${after == null ? '-' : Math.abs(after - a.top).toFixed(1)} px`);

  // fix round I1: a row replaced at the same length (my message's local copy → the server's copy) is still watched by the
  // minimap: when that row later changes size, its block follows, and every block sits where its row is
  const probe = `c22 minimap probe ${Date.now()}`;
  await body.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await p.locator('.conv-main .composer textarea').fill(probe);
  await p.locator('.conv-main .composer').getByRole('button', { name: 'Send message' }).click();
  const rowOf = (t) => body.evaluate((el, x) => { const r = [...el.querySelectorAll('[data-mid]')].find((w) => w.textContent.includes(x)); return r ? r.getAttribute('data-mid') : null; }, t);
  const replaced = await until(async () => { const id = await rowOf(probe); return !!id && !id.startsWith('local-'); }, 10000);
  await until(async () => { const [bl, m] = await blocks(); return bl === m; }, 3000);
  // cycle 26: block geometry as drawn (the blocks sit in a scaled layer), not their style strings
  const lastBlockH = () => p.evaluate(() => { const bl = [...document.querySelectorAll('.conv-main .minimap .mm-block')]; return bl.length ? bl[bl.length - 1].getBoundingClientRect().height : 0; });
  const h0 = await lastBlockH();
  await body.evaluate((el, x) => { const r = [...el.querySelectorAll('[data-mid]')].find((w) => w.textContent.includes(x)); (r.querySelector('.bubble-row') ?? r).style.minHeight = '480px'; }, probe);
  const followed = await until(async () => (await lastBlockH()) > h0 * 2, 3000);
  const h1 = await lastBlockH();
  // every rendered row has its block where the row is (cycle 26: matched by message id; only rendered rows have a DOM
  // position to compare with)
  const misplaced = await p.evaluate(() => {
    const layer = document.querySelector('.conv-main .minimap .mm-blocks');
    if (!layer) return -1;
    const y0 = layer.getBoundingClientRect().top;
    const rows = [...document.querySelectorAll('.conv-main .thread-body [data-mid]')].map((w) => [w.getAttribute('data-mid'), (w.querySelector('.bubble-row') ?? w).offsetTop]);
    const at = new Map([...document.querySelectorAll('.conv-main .minimap .mm-block')].map((b) => [b.getAttribute('data-mm'), b.getBoundingClientRect().top - y0]));
    if (!rows.length || rows.some(([id]) => !at.has(id))) return -1;
    const [lastId, lastTop] = rows[rows.length - 1];
    const s = at.get(lastId) / Math.max(lastTop, 1);
    return rows.filter(([id, top]) => Math.abs(at.get(id) - top * s) > 1.5).length;
  });
  check(`N=${n}: I1 the minimap follows a row replaced at the same length (sent message → server copy), blocks aligned with rows`, replaced && followed && misplaced === 0, `replaced ${replaced} · last block ${h0.toFixed(1)} → ${h1.toFixed(1)} px · misplaced blocks ${misplaced}`);
}

/**
 * Fix round M3: batching order, on the app's own store in the page (the module the app loaded, imported by its dev URL).
 * (1) a receipt before its message is a no-op, a receipt after it applies, receipts never go back, nothing is applied
 * before the flush; (2) a gap reset (reconnect re-read with more than a page missing) with a batch still queued applies
 * the queued event first and then restarts from the fresh page, and nothing stale is applied after it.
 */
async function batching() {
  const { mid } = await freshThread();
  const pageSeqs = Array.from({ length: 50 }, (_, i) => 160 - i); // newest first, like the server
  const dto = (seq, status) => ({ id: `c22-m${seq}`, from: 'human:c22', to: 'gm', kind: 'command', text: `m${seq}`, agoMin: 0, ts: Date.now(), seq, simulated: false, ...(status ? { status } : {}) });
  await p.route('**/api/v1/threads/T-c22/messages*', (r) => r.fulfill({ json: { messages: pageSeqs.map((q) => dto(q)), hasMore: true, nextBefore: 111 } }));
  const r = await p.evaluate(async ({ mid, d1, d2, d3, d4, d5 }) => {
    const mc = await import('/src/api/missionControl.ts');
    const same = !!mc.useMC.getState().byMission[mid];
    const ev = (type, payload) => ({ id: 'c22', seq: null, type, tenantId: 't', missionId: mid, actor: { kind: 'human', id: 'c22' }, subject: { kind: 'thread', id: 'T-c22' }, occurredAt: new Date().toISOString(), payload });
    const th = () => mc.useMC.getState().byMission[mid]?.threads?.['T-c22'];
    const wait = async (f, ms = 3000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (f()) return true; await new Promise((x) => setTimeout(x, 20)); } return f(); };
    mc.useMC.setState((s) => ({ byMission: { ...s.byMission, [mid]: { ...s.byMission[mid], threads: { ...s.byMission[mid].threads,
      'T-c22': { id: 'T-c22', key: 'c22|probe', kind: 'human-agent', a: '', b: '', count: 2, unread: 0, last: mc.toMsg(d2), messages: [mc.toMsg(d1), mc.toMsg(d2)], hasMore: false, nextBefore: null, loading: false, loadingOlder: false } } } } }));
    const created = (m) => mc.onMissionControlEvent('conversation.messageCreated', ev('conversation.messageCreated', { threadId: 'T-c22', message: m }));
    const receipt = (id, state) => mc.onMissionControlEvent('conversation.receipt', ev('conversation.receipt', { threadId: 'T-c22', messageId: id, state }));
    receipt('c22-m3', 'delivered'); // before its message: nothing to update
    created(d3);
    created(d4);
    receipt('c22-m4', 'acknowledged');
    receipt('c22-m4', 'delivered'); // receipts never go back
    const heldUntilFlush = th().messages.length === 2;
    await wait(() => th().messages.length === 4);
    const a = th();
    const one = { same, heldUntilFlush, ids: a.messages.map((m) => m.id).join(','), status: a.messages.map((m) => m.status ?? '-').join(','), count: a.count, last: a.last?.id };
    created(d5); // queued when the reconnect re-read (gap reset) starts
    mc.refreshLoadedMissionControl();
    await wait(() => th().messages[0]?.seq === 111);
    const b = th();
    await new Promise((x) => setTimeout(x, 200)); // a stale batch must not land after the reset
    const c = th();
    const seqs = c.messages.map((m) => m.seq);
    const two = { reset: b.messages[0]?.seq === 111, n: c.messages.length, ascending: seqs.every((q, i) => i === 0 || q === seqs[i - 1] + 1), first: seqs[0], lastSeq: seqs[seqs.length - 1], hasMore: c.hasMore, nextBefore: c.nextBefore, count: c.count, last: c.last?.id, stable: b === c };
    return { one, two };
  }, { mid, d1: dto(1), d2: dto(2), d3: dto(3, 'queued'), d4: dto(4, 'queued'), d5: dto(5, 'queued') });
  await p.unroute('**/api/v1/threads/T-c22/messages*');
  const o = r.one, t = r.two;
  check('M3 batching: the test runs on the app\'s own store', o.same);
  check('M3 batching: queued events are not applied before the flush', o.heldUntilFlush);
  check('M3 batching: receipt before its message is a no-op, after it applies, never goes back; order and count kept',
    o.ids === 'c22-m1,c22-m2,c22-m3,c22-m4' && o.status === '-,-,queued,acknowledged' && o.count === 4 && o.last === 'c22-m4', `${o.ids} · ${o.status} · count ${o.count} · last ${o.last}`);
  check('M3 batching: a gap reset with a batch pending applies it first, then restarts from the fresh page; nothing stale lands after',
    t.reset && t.n === 50 && t.ascending && t.first === 111 && t.lastSeq === 160 && t.hasMore === true && t.nextBefore === 111 && t.count === 5 && t.last === 'c22-m160' && t.stable,
    `${t.n} rows seq ${t.first}…${t.lastSeq} · hasMore ${t.hasMore} · next ${t.nextBefore} · count ${t.count} · last ${t.last} · stable ${t.stable}`);
}

const out = { base, at: new Date().toISOString(), runs: [] };
// M4: thresholds from the brief (reload → interactive after the burst), e.g. MAX_MS=130:3000,1000:5000; any miss, FAIL or page error exits 1
const MAX = new Map((process.env.MAX_MS ?? '130:3000,1000:5000').split(',').filter(Boolean).map((x) => x.split(':').map(Number)));
try {
if (process.env.CHECKS !== '0') { try { await batching(); } catch (e) { check('M3 batching checks ran', false, e.message.split('\n')[0]); } }
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
        console.log(`  self time by package: ${trace.packages.map((x) => `${x.pkg} ${x.ms}`).join(' · ')}`);
        console.log('  top self time:'); for (const t of trace.top.slice(0, 12)) console.log(`    ${String(t.ms).padStart(7)} ms  ${t.fn}`);
        console.log('  app functions, inclusive:'); for (const t of trace.app.slice(0, 8)) console.log(`    ${String(t.ms).padStart(7)} ms  ${t.fn}`);
      }
    }
    out.runs.push({ n, rep: tracing ? 'traced' : rep, mid, load: loadBefore, burstMs, afterBurst, idle, trace });
    if (rep === 1 && idle.interactive != null && process.env.CHECKS !== '0') { try { await behaviour(n, mid, tid); } catch (e) { check(`N=${n}: behaviour checks ran`, false, e.message.split('\n')[0]); } }
    if (afterBurst.interactive == null) { console.log(`  (not interactive within the ${CAP} ms cap: reported as >cap; the page is replaced)`); await replacePage(); }
  }
}
} finally {
out.errors = errors;
out.checks = checks;
if (checks.length) console.log(`behaviour checks: ${checks.filter((c) => c.ok).length}/${checks.length} passed`);
const misses = out.runs.filter((x) => x.rep !== 'traced' && MAX.has(x.n) && (x.afterBurst.interactive == null || x.afterBurst.interactive > MAX.get(x.n)));
for (const x of misses) console.log(`THRESHOLD MISS N=${x.n} rep ${x.rep}: ${x.afterBurst.interactive ?? '>cap'} ms > ${MAX.get(x.n)} ms`);
if (misses.length || checks.some((c) => !c.ok) || errors.length) process.exitCode = 1;
writeFileSync(`${DIR}/c22-${Date.now()}.json`, JSON.stringify(out, null, 1));
console.log(`page errors: ${errors.length}${errors.length ? ' — ' + errors.slice(0, 3).join(' | ') : ''}`);
await b.close();
}
