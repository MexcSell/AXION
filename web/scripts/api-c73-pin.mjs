// Cycle 73 (lane w71), item P2c: a reader pinned to the bottom of an open thread stays pinned through a fast live burst
// (BURST live messages posted 10 at a time into a thread of FILL messages). Before the fix the reader ended 15-17k px above the
// bottom with `pinned` false (found by c55). Also: a reader who scrolls UP in the middle of a burst is not pulled back down.
// Dev server only (api-e2e.sh); the checks are DOM-only. Env: REPS (1), FILL (300), BURST (200).
// The scroll log (printed always) lists the scroll events that left the reader more than 40 px from the bottom while it followed.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const base = process.env.BASE || 'http://127.0.0.1:5193';
const REPS = Number(process.env.REPS || 1), FILL = Number(process.env.FILL || 300), BURST = Number(process.env.BURST || 200);
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
let k = 0; const key = () => `c73p-${Date.now()}-${k++}`;
const blocks = () => p.locator('.conv-main .minimap .mm-block').count(); // one block per message the page holds
// the burst is posted 10 at a time in parallel, so its last text is not always the newest row: the newest row is the last one rendered
const lastRowVisible = () => p.evaluate(() => { const body = document.querySelector('.conv-main .thread-body'); const rows = body ? [...body.querySelectorAll('[data-mid]')] : []; const n = rows[rows.length - 1]; if (!n) return false; const box = body.getBoundingClientRect(), r = n.getBoundingClientRect(); return r.bottom > box.top && r.top < box.bottom; });
const quiet = (ms, cap) => until(() => p.evaluate((ms) => { const l = window.__lt; const end = l.length ? Math.max(...l.map(([s, d]) => s + d)) : 0; return performance.now() - end > ms; }, ms), cap, 200);
const burst = async (tid, n, tag) => { for (let i = 0; i < n; i += 10) await Promise.all(Array.from({ length: Math.min(10, n - i) }, (_, j) => api('POST', `/threads/${tid}/messages`, { kind: 'command', text: `${tag} ${String(i + j + 1).padStart(4, '0')}`, to: 'gm' }, { 'idempotency-key': key() }))); };
const newestVisible = (text) => p.evaluate((text) => { const body = document.querySelector('.conv-main .thread-body'); if (!body) return false; const box = body.getBoundingClientRect(); const n = [...body.querySelectorAll('[data-mid]')].reverse().find((e) => e.textContent.includes(text)); if (!n) return false; const r = n.getBoundingClientRect(); return r.bottom > box.top && r.top < box.bottom; }, text);

const runs = [];
let fails = 0;
const check = (name, ok, detail) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); if (!ok) fails++; };
for (let rep = 1; rep <= REPS; rep++) {
  const made = await api('POST', '/missions', { text: `Cycle 73 pin ${Date.now()}`, files: [], shared: true }, { 'idempotency-key': key() });
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
  await until(async () => (await blocks()) >= FILL + 1, 180000, 250);
  await quiet(1500, 180000);
  await p.locator('.conv-main .thread-body').evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await quiet(800, 20000);
  const have = await blocks();
  await p.locator('.conv-main .thread-body').evaluate((el) => { window.__minDist = 0; window.__scrolls = 0; window.__log = []; let last = el.scrollTop; el.addEventListener('scroll', () => { window.__scrolls++; const d = Math.round(el.scrollHeight - el.scrollTop - el.clientHeight); if (d >= 40 && window.__log.length < 5) window.__log.push({ n: window.__scrolls, d, dir: el.scrollTop > last ? 'down' : el.scrollTop < last ? 'up' : 'same', t: Math.round(performance.now()) }); last = el.scrollTop; }, { passive: true }); });
  const tb = Date.now();
  await burst(tid, BURST, 'live');
  const caught = await until(async () => (await blocks()) >= have + BURST, 180000, 100);
  const caughtMs = Date.now() - tb;
  await quiet(1000, 120000);
  const dist = async () => p.locator('.conv-main .thread-body').evaluate((el) => Math.round(el.scrollHeight - el.scrollTop - el.clientHeight));
  const d = await dist();
  const visible = await lastRowVisible();
  const pill = await p.locator('.new-pill').count();
  console.log(`rep ${rep} · load ${load()} · ${FILL} filled, ${BURST} live in ${caughtMs} ms (store has it ${caught}) · ${d} px from the bottom · newest visible ${visible} · "new" pill ${pill}`);
  console.log('  scroll events that left the reader >= 40 px from the bottom (first 5):', JSON.stringify(await p.evaluate(() => ({ scrolls: window.__scrolls, log: window.__log }))));
  check('the whole live burst arrived', caught);
  check('after a fast live burst the reader is still pinned: the newest message is in view, within 60 px of the bottom, no "N new" pill', visible && d < 60 && pill === 0, `${d} px from the bottom, newest visible ${visible}, pill ${pill}`);
  // and it follows one more message afterwards
  await burst(tid, 1, 'after');
  const followed = await until(async () => newestVisible('after 0001'), 8000, 100);
  check('and still follows the next single message', followed, `${await dist()} px from the bottom`);
  // a reader who scrolls up in the middle of a burst stays where they are (the pin must not pull them back down)
  const have2 = await blocks();
  const UP = Math.max(60, Math.floor(BURST / 2));
  const pending = burst(tid, UP, 'upburst');
  await until(async () => (await blocks()) >= have2 + 20, 60000, 50);
  await p.locator('.conv-main .thread-body').evaluate((el) => { window.__ev = []; let last = el.scrollTop; el.addEventListener('scroll', () => { const d = Math.round(el.scrollHeight - el.scrollTop - el.clientHeight); window.__ev.push([Math.round(performance.now()), d, el.scrollTop > last ? 'down' : 'up']); last = el.scrollTop; }, { passive: true }); });
  const box = await p.locator('.conv-main .thread-body').boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await p.mouse.wheel(0, -1500);
  await pending;
  await until(async () => (await blocks()) >= have2 + UP, 180000, 100);
  await quiet(1000, 120000);
  const d2 = await dist();
  if (process.env.DEBUG_UP) console.log('  scroll events after the wheel (t, distance, dir):', JSON.stringify(await p.evaluate(() => window.__ev)));
  check('a reader who scrolls up in the middle of a burst is not pulled back to the bottom', d2 > 1000, `${d2} px from the bottom after the burst`);
}
check('no page errors', errors.length === 0, errors.join(' | '));
await b.close();
process.exit(fails ? 1 : 0);
