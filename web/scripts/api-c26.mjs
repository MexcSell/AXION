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
await ctx.addInitScript(({ MINIMAP_OFF, DEBUG }) => {
  try { localStorage.setItem('axion.data-mode', 'api'); localStorage.setItem('axion.testhook', '1'); } catch { /* ignore */ }
  window.__lt = [];
  window.__scrolls = []; const t00 = performance.now();
  if (DEBUG) document.addEventListener('scroll', (e) => { const el = e.target; if (el?.classList?.contains('thread-body') && window.__scrolls.length < 60) window.__scrolls.push([Math.round(performance.now() - t00), Math.round(el.scrollTop), el.scrollHeight, el.clientHeight, el.querySelectorAll('[data-mid]').length]); }, true);
  if (MINIMAP_OFF) try { localStorage.setItem('axion.thread.minimap', '0'); } catch { /* ignore */ }
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true }); } catch { /* ignore */ }
}, { MINIMAP_OFF: process.env.MINIMAP === '0', DEBUG: !!process.env.DEBUG_PIN }); // MINIMAP=0: diagnosis only (the minimap hidden); DEBUG_PIN=1: log the thread's scroll events
// COMMITS=1 (diagnosis): count React commits and which components rendered in them, through the DevTools hook
if (process.env.COMMITS === '1') await ctx.addInitScript(() => {
  window.__commits = { n: 0, by: {} };
  // like React DevTools: a fiber rendered when it performed work; a subtree whose child list was not cloned bailed out
  const walk = (f) => { for (let x = f; x; x = x.sibling) { if ((x.flags & 1) && x.type && typeof x.type !== 'string') { const nm = x.type.displayName || x.type.name || x.type.type?.name || x.type.render?.name || '?'; window.__commits.by[nm] = (window.__commits.by[nm] ?? 0) + 1; } if (x.child && !(x.alternate && x.alternate.child === x.child)) walk(x.child); } };
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = { supportsFiber: true, renderers: new Map(), inject() { return 1; }, onScheduleFiberRoot() {}, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {}, checkDCE() {},
    onCommitFiberRoot(_id, root) { if (!window.__commitsOn) return; window.__commits.n++; walk(root.current.child); } };
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
const held = (mid, tid) => p.evaluate(async ({ mid, tid }) => (await import('/src/api/missionControl.ts')).useMC.getState().byMission[mid]?.threads?.[tid]?.messages?.length ?? 0, { mid, tid });
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

/**
 * Behaviour checks on a long open thread (CHECKS=1, the default; run on the last rep's thread, or on a fresh one with
 * REPS=0): the rendered window stays small, the minimap has one block per message, every message is reachable (a walk
 * from the top to the bottom renders each one, in order, with no blank viewport), aria-posinset / aria-setsize, keyboard
 * moves between messages (Home / End / ↑), the focused row stays mounted, and the scroll position holds still.
 */
const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok: !!ok, detail }); console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };
const storeIds = (mid, tid) => p.evaluate(async ({ mid, tid }) => (await import('/src/api/missionControl.ts')).useMC.getState().byMission[mid]?.threads?.[tid]?.messages.map((m) => m.id) ?? [], { mid, tid });
async function behaviour(mid, tid) {
  const body = p.locator('.conv-main .thread-body');
  // after a reload (newest page only) the thread is pinned to the bottom, and stays there once rows are measured
  await p.reload({ waitUntil: 'domcontentloaded' });
  await until(async () => (await held(mid, tid)) >= 50, 15000);
  if (process.env.DEBUG_PIN) { await p.waitForTimeout(3000); console.log('DEBUG scroll log', JSON.stringify(await p.evaluate(() => window.__scrolls))); }
  const trail = [];
  for (let i = 0; i < 12; i++) { trail.push(await body.evaluate((el) => Math.round(el.scrollHeight - el.scrollTop - el.clientHeight)).catch(() => null)); await p.waitForTimeout(250); }
  check('after a reload the thread is pinned to the bottom, and stays there for 3 s while rows are measured', trail.every((d) => d != null && d < 60), `distance from the bottom every 250 ms: ${trail.join(' ')}`);
  await p.locator('.conv-main .composer').first().waitFor({ timeout: 10000 });
  // load the whole thread back (the rest of the checks walk all of it): scroll to the top until nothing older is left
  for (let i = 0; i < 60 && await body.evaluate((el) => el.dataset.hasOlder === '1'); i++) { await body.evaluate((el) => { el.scrollTop = 0; }); await p.waitForTimeout(250); await body.evaluate((el) => { el.scrollTop += 200; }); await p.waitForTimeout(100); }
  const ids = await storeIds(mid, tid);
  const rows = await p.locator('.conv-main .thread-body [data-mid]').count();
  check(`the rendered window stays small: DOM rows ${rows} for ${ids.length} messages (at most 80)`, ids.length >= FILL && rows <= 80, `${rows} rows`);
  const blockIds = await p.locator('.conv-main .minimap .mm-block').evaluateAll((els) => els.map((e) => e.getAttribute('data-mm')));
  check('the minimap has one block per message, in order (block ids = the thread\'s ids)', blockIds.length === ids.length && blockIds.every((x, i) => x === ids[i]), `${blockIds.length} blocks / ${ids.length} messages`);
  const w = await body.evaluate(async (el) => {
    const raf = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    el.scrollTop = 0; await raf(); await raf();
    const seen = [], set = new Set(); let dupSnap = 0, blank = 0, steps = 0;
    const first = el.querySelector('[data-mid]');
    const top = { id: first?.getAttribute('data-mid'), pos: first?.getAttribute('aria-posinset'), size: first?.getAttribute('aria-setsize'), role: first?.getAttribute('role') };
    for (;;) {
      await raf();
      const box = el.getBoundingClientRect();
      const rs = [...el.querySelectorAll('[data-mid]')];
      const ids = rs.map((r) => r.getAttribute('data-mid'));
      if (new Set(ids).size !== ids.length) dupSnap++;
      if (!rs.some((r) => { const b = r.getBoundingClientRect(); return b.bottom > box.top + 1 && b.top < box.bottom - 1; })) blank++;
      for (const id of ids) if (!set.has(id)) { set.add(id); seen.push(id); }
      steps++;
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 2 || steps > 4000) break;
      el.scrollTop += Math.round(el.clientHeight * 0.8);
    }
    const rs = [...el.querySelectorAll('[data-mid]')], last = rs[rs.length - 1];
    return { seen, dupSnap, blank, steps, top, bottom: { id: last?.getAttribute('data-mid'), pos: last?.getAttribute('aria-posinset'), size: last?.getAttribute('aria-setsize') } };
  });
  const idx = new Map(ids.map((x, i) => [x, i]));
  const ordered = w.seen.every((x, i) => i === 0 || idx.get(x) > idx.get(w.seen[i - 1]));
  check('every message is reachable: a walk from the top to the bottom renders each one, in order, never a blank viewport', w.seen.length === ids.length && w.seen.every((x) => idx.has(x)) && ordered && w.dupSnap === 0 && w.blank === 0,
    `${w.seen.length}/${ids.length} rendered in ${w.steps} steps · in order ${ordered} · duplicate snapshots ${w.dupSnap} · blank viewports ${w.blank}`);
  check('rows are articles with their place in the thread: first aria-posinset 1, aria-setsize = the thread\'s length; last = setsize',
    w.top.id === ids[0] && w.top.role === 'article' && w.top.pos === '1' && Number(w.top.size) === ids.length && w.bottom.id === ids[ids.length - 1] && Number(w.bottom.pos) === ids.length && Number(w.bottom.size) === ids.length,
    `top ${w.top.role} ${w.top.pos}/${w.top.size} · bottom ${w.bottom.pos}/${w.bottom.size}`);
  // keyboard: Tab-reachable row (roving tabindex), Home / End / ↑ move focus between messages, mounting them
  const active = () => p.evaluate(() => { const a = document.activeElement; return a?.getAttribute('data-mid') ? { id: a.getAttribute('data-mid'), pos: a.getAttribute('aria-posinset') } : null; });
  const roving = await body.evaluate((el) => el.querySelectorAll('[data-mid][tabindex="0"]').length);
  await body.evaluate((el) => el.querySelector('[data-mid][tabindex="0"]')?.focus());
  await p.keyboard.press('Home');
  const home = await until(async () => (await active())?.id === ids[0], 3000) ? await active() : await active();
  await p.keyboard.press('End');
  const end = await until(async () => (await active())?.id === ids[ids.length - 1], 3000) ? await active() : await active();
  await p.keyboard.press('ArrowUp');
  const up = await until(async () => (await active())?.id === ids[ids.length - 2], 3000) ? await active() : await active();
  check('keyboard: exactly one row is in the Tab order; Home, End and ↑ move focus to the first, last and previous message', roving === 1 && home?.id === ids[0] && end?.id === ids[ids.length - 1] && up?.id === ids[ids.length - 2],
    `tabbable rows ${roving} · Home → ${home?.pos} · End → ${end?.pos} · ↑ → ${up?.pos}`);
  await p.keyboard.press('Home');
  await until(async () => (await active())?.id === ids[0], 3000);
  await body.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await p.waitForTimeout(400);
  const kept = await p.evaluate((id) => document.activeElement?.getAttribute('data-mid') === id && !!document.querySelector(`.conv-main .thread-body [data-mid="${id}"]`), ids[0]);
  check('the row holding focus stays mounted when it scrolls far out of view', kept);
  // focus inside a row (a bubble's button) keeps the row mounted but does not move the Tab stop
  const tabBefore = await body.evaluate((el) => el.querySelector('[data-mid][tabindex="0"]')?.getAttribute('data-mid'));
  await body.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await p.waitForTimeout(300);
  const btnRow = await body.evaluate((el) => { const rs = [...el.querySelectorAll('[data-mid]')]; const r = rs[rs.length - 3]; r?.querySelector('button')?.focus(); return r?.getAttribute('data-mid'); });
  await p.waitForTimeout(200);
  const tabAfter = await body.evaluate((el) => el.querySelector('[data-mid][tabindex="0"]')?.getAttribute('data-mid'));
  check('focus on a button inside a message does not move the Tab stop (one tabbable row, unchanged)', !!btnRow && tabAfter === tabBefore && (await body.evaluate((el) => el.querySelectorAll('[data-mid][tabindex="0"]').length)) === 1, `before ${tabBefore} · after ${tabAfter} · focused row ${btnRow}`);
  // switching Full / Compact from the middle of the thread leaves rows in the viewport (no blank view)
  const filled = () => body.evaluate((el) => { const box = el.getBoundingClientRect(); return [...el.querySelectorAll('[data-mid]')].some((r) => { const b = r.getBoundingClientRect(); return b.bottom > box.top + 1 && b.top < box.bottom - 1; }); });
  await body.evaluate((el) => { el.scrollTop = Math.round(el.scrollHeight * 0.5); });
  await p.waitForTimeout(300);
  const seg = p.locator('.conv-main .thread-head [role=radiogroup][aria-label="Thread view"]');
  await seg.getByRole('radio', { name: /Compact/ }).click();
  await p.waitForTimeout(400);
  const c1 = await filled();
  await seg.getByRole('radio', { name: /Full/ }).click();
  await p.waitForTimeout(400);
  const c2 = await filled();
  check('switching to Compact and back to Full from the middle of the thread leaves messages in view', c1 && c2, `compact ${c1} · full ${c2}`);
  // the log is not a live region (rows mounted by scrolling would be read out): a message that arrives from someone else
  // is announced by the thread's status line instead (injected through the app's own store, as api-c22's batching checks do)
  const said = await p.evaluate(async ({ mid, tid }) => {
    const mc = await import('/src/api/missionControl.ts');
    const th = mc.useMC.getState().byMission[mid]?.threads?.[tid];
    const seq = Math.max(...th.messages.map((m) => m.seq ?? 0)) + 1;
    const text = `c26 announcer probe ${Date.now()}`;
    const message = { id: `c26-ann-${seq}`, from: 'gm', to: 'human:x', kind: 'reply', text, agoMin: 0, ts: Date.now(), seq, simulated: false };
    mc.onMissionControlEvent('conversation.messageCreated', { id: 'c26', seq: null, type: 'conversation.messageCreated', tenantId: 't', missionId: mid, actor: { kind: 'agent', id: 'gm' }, subject: { kind: 'thread', id: tid }, occurredAt: new Date().toISOString(), payload: { threadId: tid, message } });
    const t0 = Date.now();
    while (Date.now() - t0 < 3000) {
      const st = [...document.querySelectorAll('.conv-main .thread > [role=status]')].map((e) => e.textContent).join(' | ');
      if (st.includes(text)) return { ok: true, st, live: document.querySelector('.conv-main .thread-body')?.getAttribute('aria-live') };
      await new Promise((r) => setTimeout(r, 50));
    }
    return { ok: false, st: [...document.querySelectorAll('.conv-main .thread > [role=status]')].map((e) => e.textContent).join(' | ') };
  }, { mid, tid });
  check('a message from someone else is announced by the thread\'s status line (the log itself is aria-live=off)', said.ok && said.live === 'off', `status "${(said.st ?? '').slice(0, 90)}" · log aria-live ${said.live}`);
  // the scroll position holds still while rows are measured (estimates corrected above the viewport)
  const pick = () => body.evaluate((el) => { const box = el.getBoundingClientRect(); const r = [...el.querySelectorAll('[data-mid]')].find((x) => x.getBoundingClientRect().bottom > box.top + 1); return r ? { id: r.getAttribute('data-mid'), top: r.getBoundingClientRect().top - box.top } : null; });
  await body.evaluate((el) => { el.scrollTop = Math.round(el.scrollHeight * 0.37); });
  await p.waitForTimeout(150);
  const a = await pick();
  await body.evaluate((el) => { el.scrollTop -= 1200; });
  await p.waitForTimeout(300);
  await body.evaluate((el) => { el.scrollTop += 1200; });
  await p.waitForTimeout(600);
  const b2 = await body.evaluate((el, id) => { const x = el.querySelector(`[data-mid="${id}"]`); return x ? x.getBoundingClientRect().top - el.getBoundingClientRect().top : null; }, a?.id);
  check('scrolling up 1,200 px and back puts the same message at the same place (within 3 px)', a && b2 != null && Math.abs(b2 - a.top) <= 3, `shift ${a && b2 != null ? Math.abs(b2 - a.top).toFixed(1) : '-'} px`);
}

const runs = [];
for (let rep = 1; rep <= REPS; rep++) {
  const { mid, tid } = await freshThread();
  const tf = Date.now();
  await burst(tid, FILL, 'fill');
  const filled = await until(async () => (await held(mid, tid)) >= FILL + 1, 180000, 250);
  await quiet(1500, 180000);
  const fillMs = Date.now() - tf;
  await p.locator('.conv-main .thread-body').evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await quiet(800, 20000);
  // FLOOR=<tab> (diagnosis): the same burst with the mission open on another tab (no thread on screen): the cost that does
  // not come from the thread view at all
  // FLOOR=1: another conversation partner's thread is shown instead (same page, same store updates, the burst's thread
  // is not on screen)
  if (process.env.FLOOR) {
    const items = p.locator('.conv-main .cp-item');
    const n = await items.count();
    for (let i = 0; i < n; i++) { const it = items.nth(i); if (!(await it.evaluate((e) => !!e.querySelector('.cp-sel') || e.getAttribute('aria-current') === 'true' || e.classList.contains('on')))) { await it.click(); break; } }
    await quiet(1500, 30000);
    console.log(`  FLOOR: thread on screen now: ${(await p.locator('.conv-main .thread-head').innerText()).replace(/\s+/g, ' ').slice(0, 60)}`);
  }
  const before = { held: await held(mid, tid), rows: await p.locator('.conv-main .thread-body [data-mid]').count(), blocks: await p.locator('.conv-main .minimap .mm-block').count() };
  const traceFile = `${DIR}/trace-burst-${rep}.json`;
  const loadBefore = load();
  const lt0 = await p.evaluate(() => performance.now());
  await p.evaluate(() => { window.__commitsOn = true; if (window.__commits) window.__commits = { n: 0, by: {} }; });
  await b.startTracing(p, { path: traceFile, categories: ['toplevel', 'devtools.timeline', 'v8.execute', 'disabled-by-default-v8.cpu_profiler'] });
  // starting the profiler costs the page one ~200 ms task at its next JavaScript (V8.InvokeApiInterruptCallbacks): run some
  // JavaScript now and let it pass, then mark the burst's start in the trace; the burst window is counted from the mark
  await p.evaluate(() => 0);
  await quiet(300, 10000);
  await p.evaluate(() => console.timeStamp('c26-burst-start'));
  const tb = Date.now();
  await burst(tid, BURST, 'live');
  const burstMs = Date.now() - tb;
  // caught up: the store holds the whole burst, then no long task for 1 s (the render backlog is done)
  const caught = process.env.FLOOR ? true : await until(async () => (await held(mid, tid)) >= before.held + BURST, 180000, 100);
  const caughtMs = Date.now() - tb;
  await quiet(1000, 120000);
  const settledMs = Date.now() - tb;
  await b.stopTracing();
  const commits = await p.evaluate(() => { window.__commitsOn = false; return window.__commits ?? null; });
  if (commits) console.log(`  React commits during the burst: ${commits.n} · renders by component: ${Object.entries(commits.by).sort((x, y) => y[1] - x[1]).slice(0, 25).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  // still pinned: the newest message is in the viewport without scrolling (the reader was at the bottom)
  const pinned = await newestVisible(`live ${String(BURST).padStart(4, '0')}`) || await p.locator('.conv-main .thread-body').evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight < 60);
  const lt = await p.evaluate((t0) => window.__lt.filter(([s]) => s >= t0), lt0);
  const after = { held: await held(mid, tid), rows: await p.locator('.conv-main .thread-body [data-mid]').count(), blocks: await p.locator('.conv-main .minimap .mm-block').count() };
  let trace;
  try { trace = JSON.parse(execFileSync('node', ['scripts/api-c22.mjs'], { env: { ...process.env, SUMMARISE: traceFile }, maxBuffer: 64 << 20 }).toString()); } catch (e) { trace = { skipped: e.message.split('\n')[0] }; }
  // the burst window: the c22 long tasks that end after the burst-start mark (same clock as the summariser: the trace's
  // first timestamp); the whole trace is reported beside it
  if (trace.long) {
    try {
      const ev = JSON.parse(readFileSync(traceFile, 'utf8')).traceEvents;
      const t0 = ev.reduce((m, e) => (e.ts > 0 && e.ts < m ? e.ts : m), Infinity);
      const mark = ev.find((e) => e.name === 'TimeStamp' && e.args?.data?.message === 'c26-burst-start');
      const at = mark ? (mark.ts - t0) / 1000 : 0;
      const w = trace.long.list.filter((x) => x.at + x.ms > at);
      trace.whole = { count: trace.long.count, totalMs: trace.long.totalMs, worstMs: trace.long.worstMs };
      trace.window = { markAt: Math.round(at), found: !!mark, count: w.length, totalMs: w.reduce((q, x) => q + x.ms, 0), worstMs: w.reduce((q, x) => Math.max(q, x.ms), 0) };
    } catch (e) { trace.window = { error: e.message }; }
  }
  if (!process.env.KEEP_TRACES) rmSync(traceFile, { force: true });
  const po = { count: lt.length, totalMs: Math.round(lt.reduce((s, [, d]) => s + d, 0)), worstMs: Math.round(lt.reduce((s, [, d]) => Math.max(s, d), 0)) };
  const r = { rep, mid, tid, load: loadBefore, filled, fillMs, before, after, burstMs, caught, caughtMs, settledMs, pinned, trace: trace.long ? { count: trace.window?.count, totalMs: trace.window?.totalMs, worstMs: trace.window?.worstMs, window: trace.window, whole: trace.whole, list: trace.long.list, sampledMs: trace.sampledMs, packages: trace.packages, top: trace.top?.slice(0, 12), app: trace.app?.slice(0, 8) } : trace, longtaskObserver: po };
  runs.push(r);
  console.log(`rep ${rep} · load ${loadBefore} · fill ${FILL} in ${fillMs} ms (held ${before.held}, DOM rows ${before.rows}, minimap blocks ${before.blocks}) · burst ${BURST} posted in ${burstMs} ms, store has it ${caught ? caughtMs + ' ms' : 'NO'}, quiet at ${settledMs} ms, still pinned ${pinned} (held ${after.held}, DOM rows ${after.rows}, blocks ${after.blocks})`);
  if (trace.long) {
    console.log(`  trace long tasks (>=50 ms, renderer main), burst window (from the mark at ${trace.window?.markAt} ms${trace.window?.found ? '' : ', MARK NOT FOUND'}): ${trace.window?.count}, total ${trace.window?.totalMs} ms, worst ${trace.window?.worstMs} ms · whole trace: ${trace.long.count}, total ${trace.long.totalMs} ms, worst ${trace.long.worstMs} ms · sampled JS ${trace.sampledMs} ms`);
    console.log(`  self time by package: ${trace.packages.map((x) => `${x.pkg} ${x.ms}`).join(' · ')}`);
    console.log('  top self time:'); for (const t of trace.top.slice(0, 10)) console.log(`    ${String(t.ms).padStart(7)} ms  ${t.fn}`);
    console.log('  app functions, inclusive:'); for (const t of trace.app.slice(0, 6)) console.log(`    ${String(t.ms).padStart(7)} ms  ${t.fn}`);
  } else console.log(`  trace: ${trace.skipped}`);
  console.log(`  PerformanceObserver longtask: ${po.count}, total ${po.totalMs} ms, worst ${po.worstMs} ms`);
}
/**
 * Fix round I1: minimap blocks of rows that were never rendered are drawn at an estimated size. Their widths must sit
 * within ±25 % of the measured mean of their kind (blocks of the rows on screen), so the minimap is not a staircase that
 * depends on how far the reader scrolled. Run with the reader at the bottom of a long thread.
 */
async function widths(mid, tid, label) {
  const body = p.locator('.conv-main .thread-body');
  await body.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await p.waitForTimeout(900); // measurements land within 400 ms (debounced), then the minimap renders
  const kinds = Object.fromEntries(await p.evaluate(async ({ mid, tid }) => ((await import('/src/api/missionControl.ts')).useMC.getState().byMission[mid]?.threads?.[tid]?.messages ?? []).map((m) => [m.id, m.kind]), { mid, tid }));
  const r = await p.evaluate((kinds) => {
    const shown = new Set([...document.querySelectorAll('.conv-main .thread-body [data-mid]')].map((e) => e.getAttribute('data-mid')));
    const per = {};
    for (const b of document.querySelectorAll('.conv-main .minimap .mm-block')) {
      const id = b.getAttribute('data-mm'), k = kinds[id] ?? '?', w = b.getBoundingClientRect().width;
      const x = (per[k] ??= { on: [], off: [] });
      (shown.has(id) ? x.on : x.off).push(w);
    }
    const out = [];
    for (const [k, { on, off }] of Object.entries(per)) {
      if (!on.length || !off.length) continue;
      const m = on.reduce((q, v) => q + v, 0) / on.length;
      const bad = off.filter((w) => Math.abs(w - m) > m * 0.25);
      out.push({ k, mean: +m.toFixed(1), off: off.length, bad: bad.length, min: +Math.min(...off).toFixed(1), max: +Math.max(...off).toFixed(1) });
    }
    return out;
  }, kinds);
  const off = r.reduce((q, x) => q + x.off, 0), bad = r.reduce((q, x) => q + x.bad, 0);
  check(`I1 ${label}: minimap blocks of rows not on screen are within ±25 % of the measured mean width of their kind`, off > 0 && bad === 0 && r.every((x) => x.mean > 4),
    r.map((x) => `${x.k}: mean ${x.mean} px, ${x.off} off-screen ${x.min}–${x.max} px, ${x.bad} outside`).join(' · '));
}

/**
 * Fix round I2: a thread with mixed heights (1 to 20 lines, long single paragraphs, image attachments), so the estimates
 * are wrong and the code that absorbs wrong estimates runs: older pages keep the visible message in place (±8 px), the
 * bottom pin survives late measurements, keyboard focus lands on the focused row, the minimap stays aligned, and a walk
 * renders every message with no blank viewport.
 */
async function mixed() {
  const { mid, tid } = await freshThread();
  const png = async (w, h, hue) => Buffer.from((await p.evaluate(({ w, h, hue }) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.fillStyle = `hsl(${hue} 70% 50%)`; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; g.fillRect(w / 4, h / 4, w / 2, h / 2); return c.toDataURL('image/png'); }, { w, h, hue })).split(',')[1], 'base64');
  const upload = async (i) => {
    if (!csrf) csrf = (await (await p.request.get(base + '/api/v1/me')).json()).me.csrf;
    const r = await p.request.fetch(base + '/api/v1/uploads', { method: 'POST', headers: { 'x-csrf': csrf }, multipart: { file: { name: `mixed-${i}.png`, mimeType: 'image/png', buffer: await png(120 + (i % 5) * 60, 80 + (i % 3) * 90, (i * 37) % 360) } } });
    return (await r.json()).id;
  };
  const word = (i) => ['alpha', 'migration', 'checkout', 'evidence', 'tokens', 'staging', 'contrast', 'verify'][i % 8];
  const textOf = (i) => {
    const kind = i % 7;
    if (kind === 0) return `mixed ${String(i).padStart(4, '0')} short`;
    if (kind === 1) return `mixed ${String(i).padStart(4, '0')} ` + Array.from({ length: 90 }, (_, j) => word(i + j)).join(' '); // one long paragraph
    if (kind === 2) return `mixed ${String(i).padStart(4, '0')}\n` + Array.from({ length: 19 }, (_, j) => `line ${j + 1}: ${word(j)}`).join('\n'); // 20 lines
    if (kind === 3) return `mixed ${String(i).padStart(4, '0')} three\nlines\nhere`;
    if (kind === 4) return `mixed ${String(i).padStart(4, '0')} ` + Array.from({ length: 30 }, (_, j) => word(j * 3)).join(' ');
    if (kind === 5) return `mixed ${String(i).padStart(4, '0')} ok`;
    return `mixed ${String(i).padStart(4, '0')}\n` + Array.from({ length: 8 }, (_, j) => `- ${word(i * j)} ${word(j)}`).join('\n');
  };
  const N = Number(process.env.MIXED_N || 240);
  for (let i = 1; i <= N; i += 10) {
    await Promise.all(Array.from({ length: Math.min(10, N - i + 1) }, async (_, j) => {
      const n = i + j;
      const uploadIds = n % 6 === 0 ? [await upload(n)] : [];
      return api('POST', `/threads/${tid}/messages`, { kind: 'command', text: textOf(n), to: 'gm', uploadIds }, { 'idempotency-key': key() });
    }));
  }
  const body = p.locator('.conv-main .thread-body');
  await until(async () => (await held(mid, tid)) >= N + 1, 60000, 250);
  // (1) a reload: the newest page, pinned, and it stays pinned while rows and images are measured
  await p.reload({ waitUntil: 'domcontentloaded' });
  await until(async () => (await held(mid, tid)) >= 50, 15000);
  const trail = [];
  for (let i = 0; i < 12; i++) { trail.push(await body.evaluate((el) => Math.round(el.scrollHeight - el.scrollTop - el.clientHeight)).catch(() => null)); await p.waitForTimeout(250); }
  check('I2 mixed heights: after a reload the thread is pinned to the bottom and stays there for 3 s', trail.every((d) => d != null && d < 60), `distance from the bottom: ${trail.join(' ')}`);
  // (2) older pages: hold the page request until the visible message has been recorded, then check it stays put (±8 px)
  const shifts = [];
  for (let round = 0; round < 6 && await body.evaluate((el) => el.dataset.hasOlder === '1'); round++) {
    const before = await held(mid, tid);
    const heldRoutes = [];
    const olderRe = new RegExp(`/api/v1/threads/${tid}/messages\\?.*before=`);
    await p.route(olderRe, (route) => { heldRoutes.push(route); });
    const a = await body.evaluate(async (el) => {
      el.scrollTop = 0;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const box = el.getBoundingClientRect();
      const first = [...el.querySelectorAll('[data-mid]')].find((n) => n.getBoundingClientRect().bottom > box.top + 1);
      return first ? { id: first.getAttribute('data-mid'), top: first.getBoundingClientRect().top - box.top, rows: [...el.querySelectorAll('[data-mid]')].map((x) => x.getAttribute('data-mid') + '@' + Math.round(x.getBoundingClientRect().top - box.top)).join(','), st: el.scrollTop } : null;
    });
    if (process.env.DEBUG_PIN) console.log('DEBUG test capture', JSON.stringify(a));
    await until(async () => heldRoutes.length > 0, 5000, 50);
    for (const r of heldRoutes) await r.continue().catch(() => undefined);
    await p.unroute(olderRe);
    await until(async () => (await held(mid, tid)) > before, 8000);
    if (process.env.DEBUG_PIN && a) console.log('DEBUG anchor trail', JSON.stringify(await body.evaluate(async (el, id) => { const out = []; const t0 = performance.now(); while (performance.now() - t0 < 900) { const x = el.querySelector(`[data-mid="${id}"]`); out.push([Math.round(performance.now() - t0), x ? +(x.getBoundingClientRect().top - el.getBoundingClientRect().top).toFixed(1) : null, Math.round(el.scrollTop), el.querySelectorAll('[data-mid]').length]); await new Promise((r) => setTimeout(r, 40)); } return out; }, a.id)), 'captured', a.id, a.top, JSON.stringify(await p.evaluate(() => window.__dbg?.slice(-6))));
    await p.waitForTimeout(700); // measurements of the new rows land (≤ 400 ms) and are absorbed
    const after = a ? await body.evaluate((el, id) => { const x = el.querySelector(`[data-mid="${id}"]`); return x ? x.getBoundingClientRect().top - el.getBoundingClientRect().top : null; }, a.id) : null;
    shifts.push(after == null || !a ? 999 : Math.abs(after - a.top));
    await body.evaluate((el) => { el.scrollTop += 400; });
    await p.waitForTimeout(250);
  }
  check('I2 mixed heights: each older page keeps the visible message in place (±8 px), the request held until it was recorded', shifts.length >= 3 && shifts.every((x) => x <= 8), `${shifts.length} pages · shifts ${shifts.map((x) => x.toFixed(1)).join(' ')} px`);
  // load the rest
  for (let i = 0; i < 20 && await body.evaluate((el) => el.dataset.hasOlder === '1'); i++) { await body.evaluate((el) => { el.scrollTop = 0; }); await p.waitForTimeout(300); await body.evaluate((el) => { el.scrollTop += 300; }); await p.waitForTimeout(100); }
  const ids = await storeIds(mid, tid);
  // (3) every message reachable, no blank viewport, on wrong estimates
  const w = await body.evaluate(async (el) => {
    const raf = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    el.scrollTop = 0; await raf(); await raf();
    const seen = [], set = new Set(); let blank = 0, steps = 0;
    for (;;) {
      await raf();
      const box = el.getBoundingClientRect();
      const rs = [...el.querySelectorAll('[data-mid]')];
      if (!rs.some((r) => { const b = r.getBoundingClientRect(); return b.bottom > box.top + 1 && b.top < box.bottom - 1; })) blank++;
      for (const r of rs) { const id = r.getAttribute('data-mid'); if (!set.has(id)) { set.add(id); seen.push(id); } }
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 2 || ++steps > 3000) break;
      el.scrollTop += Math.round(el.clientHeight * 0.8);
    }
    return { seen, blank, steps };
  });
  check('I2 mixed heights: a walk from the top renders every message in order with no blank viewport', w.seen.length === ids.length && w.seen.every((x, i) => x === ids[i]) && w.blank === 0, `${w.seen.length}/${ids.length} in ${w.steps} steps · blank ${w.blank}`);
  // (4) keyboard: Home, End and a run of ↑ each land on a row that is inside the viewport and holds focus
  const landed = async () => p.evaluate(() => {
    const a = document.activeElement, el = document.querySelector('.conv-main .thread-body');
    if (!a?.getAttribute('data-mid') || !el) return null;
    const b = a.getBoundingClientRect(), box = el.getBoundingClientRect();
    return { id: a.getAttribute('data-mid'), visible: b.top >= box.top - 1 && Math.min(b.bottom, b.top + box.height) <= box.bottom + 1 };
  });
  await body.evaluate((el) => el.querySelector('[data-mid][tabindex="0"]')?.focus());
  const keys = [];
  for (const [k, want] of [['Home', ids[0]], ['End', ids[ids.length - 1]], ['Home', ids[0]]]) {
    await p.keyboard.press(k);
    await until(async () => (await landed())?.id === want, 3000);
    await p.waitForTimeout(150);
    const l = await landed(); keys.push(`${k} ${l?.id === want && l.visible ? 'ok' : JSON.stringify(l)}`);
  }
  for (let i = 0; i < 25; i++) await p.keyboard.press('ArrowDown');
  await p.waitForTimeout(300);
  const l25 = await landed(); keys.push(`↓×25 ${l25?.id === ids[25] && l25.visible ? 'ok' : JSON.stringify(l25)}`);
  check('I2 mixed heights: keyboard focus scrolls the focused message into view (Home, End, Home, ↓×25)', keys.every((x) => x.endsWith(' ok')), keys.join(' · '));
  // (5) the minimap stays aligned with the rendered rows (blocks matched by id, as drawn), at the top and the middle
  const aligned = async () => { await p.waitForTimeout(700); return p.evaluate(() => {
    const layer = document.querySelector('.conv-main .minimap .mm-blocks'), el = document.querySelector('.conv-main .thread-body');
    if (!layer || !el) return { bad: -1 };
    const y0 = layer.getBoundingClientRect().top;
    const at = new Map([...document.querySelectorAll('.conv-main .minimap .mm-block')].map((b) => [b.getAttribute('data-mm'), b.getBoundingClientRect().top - y0]));
    const rows = [...el.querySelectorAll('[data-mid]')].map((w) => [w.getAttribute('data-mid'), (w.querySelector('.bubble-row') ?? w).offsetTop]);
    const [lid, ltop] = rows[rows.length - 1] ?? [];
    const s = lid && at.has(lid) ? at.get(lid) / Math.max(ltop, 1) : 0;
    const bad = rows.filter(([id, top]) => !at.has(id) || Math.abs(at.get(id) - top * s) > 1.5);
    return { bad: bad.length, n: rows.length, s: +s.toFixed(4) };
  }); };
  await body.evaluate((el) => { el.scrollTop = Math.round(el.scrollHeight * 0.45); });
  const mid1 = await aligned();
  await body.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  const bot1 = await aligned();
  check('I2 mixed heights: minimap blocks sit where their rendered rows are (±1.5 px), middle and bottom', mid1.bad === 0 && bot1.bad === 0 && mid1.n > 0, `middle ${mid1.bad}/${mid1.n} off · bottom ${bot1.bad}/${bot1.n} off · scale ${bot1.s}`);
  return { mid, tid };
}

let last = runs[runs.length - 1];
if (process.env.CHECKS !== '0') {
  try {
    if (!last) { const t = await freshThread(); await burst(t.tid, FILL, 'fill'); await until(async () => (await held(t.mid, t.tid)) >= FILL + 1, 180000, 250); await quiet(1000, 120000); last = t; }
    // SHOT=<file.png> (report): the conversation pane, pinned to the bottom, then scrolled to the middle (<file>-mid.png)
    if (process.env.SHOT) {
      const pane = p.locator('.conv-main').first();
      await p.locator('.conv-main .thread-body').evaluate((el) => { el.scrollTop = el.scrollHeight; });
      await p.waitForTimeout(1200);
      await pane.screenshot({ path: process.env.SHOT });
      await p.locator('.conv-main .thread-body').evaluate((el) => { el.scrollTop = Math.round(el.scrollHeight * 0.5); });
      await p.waitForTimeout(1500);
      await pane.screenshot({ path: process.env.SHOT.replace(/\.png$/, '-mid.png') });
    }
    await widths(last.mid, last.tid, 'reader at the bottom');
    // the same after the thread's width changes (cached heights and estimates are learned again)
    const w0 = await p.locator('.conv-main .thread-body').evaluate((el) => el.clientWidth);
    await p.setViewportSize({ width: 1480, height: 940 });
    await p.waitForTimeout(300);
    console.log(`  (thread width ${w0} → ${await p.locator('.conv-main .thread-body').evaluate((el) => el.clientWidth)} px)`);
    await widths(last.mid, last.tid, 'after the thread got narrower');
    await p.setViewportSize({ width: 1600, height: 940 });
    await behaviour(last.mid, last.tid);
    if (process.env.MIXED !== '0') await mixed();
  } catch (e) { check('behaviour checks ran', false, e.message.split('\n')[0]); }
  console.log(`behaviour checks: ${checks.filter((c) => c.ok).length}/${checks.length} passed`);
}
const tot = runs.map((r) => r.trace?.totalMs).filter((x) => x != null), worst = runs.map((r) => r.trace?.worstMs).filter((x) => x != null);
const mean = (a) => (a.length ? Math.round(a.reduce((s, x) => s + x, 0) / a.length) : null);
const wtot = runs.map((r) => r.trace?.whole?.totalMs).filter((x) => x != null), wworst = runs.map((r) => r.trace?.whole?.worstMs).filter((x) => x != null);
console.log(`summary (burst window): long-task total per rep ${tot.join(' / ')} ms (mean ${mean(tot)}) · worst task per rep ${worst.join(' / ')} ms · whole trace: total ${wtot.join(' / ')} (mean ${mean(wtot)}), worst ${wworst.join(' / ')} · page errors ${errors.length}${errors.length ? ' — ' + errors.slice(0, 3).join(' | ') : ''}`);
const miss = runs.filter((r) => !r.caught || r.trace?.totalMs == null || (MAX_TOTAL != null && r.trace.totalMs > MAX_TOTAL) || (MAX_WORST != null && r.trace.worstMs > MAX_WORST));
for (const r of miss) console.log(`THRESHOLD MISS rep ${r.rep}: total ${r.trace?.totalMs} ms (max ${MAX_TOTAL}), worst ${r.trace?.worstMs} ms (max ${MAX_WORST}), caught up ${r.caught}`);
if (miss.length || errors.length || tot.length < REPS || checks.some((c) => !c.ok)) process.exitCode = 1;
writeFileSync(`${DIR}/c26-${Date.now()}.json`, JSON.stringify({ base, at: new Date().toISOString(), FILL, BURST, runs, checks, errors }, null, 1));
await b.close();
