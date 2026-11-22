// Cycle 55 (lane w54): thread follow-ups. Run through scripts/api-e2e.sh. MODE selects the check:
//   MODE=anchor  (default) item 1: after an older page lands, the restored row stays where it was for as long as the rows above
//                it are still being measured (the old 1 s timer let it drift when a measurement came later). Rows are measured late
//                on purpose: window.ResizeObserver callbacks are delayed by RO_DELAY ms (default 3000) after the page request is
//                released, and THROTTLE=N also slows the page's CPU N times (CDP). Samples the row's place every 100 ms for 4 s.
//   MODE=never   item 1 safety exit: rows that are never measured (RO callbacks swallowed) release the anchor after the bounded
//                wait, once, with a console.warn.
// Env: MIXED_N (200), ROUNDS (3), RO_DELAY (3000), LATE_PX (300), LATE_AT (1300), THROTTLE (1), MAX_SHIFT (8, px: the bar of api-c26's I2 check).
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const base = process.env.BASE || 'http://127.0.0.1:5193';
const MODE = process.env.MODE || 'anchor';
const N = Number(process.env.MIXED_N || 200), ROUNDS = Number(process.env.ROUNDS || 3), RO_DELAY = Number(process.env.RO_DELAY || 3000);
const THROTTLE = Number(process.env.THROTTLE || 1), MAX_SHIFT = Number(process.env.MAX_SHIFT || 8);
const LATE_PX = Number(process.env.LATE_PX ?? (MODE === 'never' ? 0 : 300)), LATE_AT = Number(process.env.LATE_AT || 1300);
const TOPPX = Number(process.env.TOPPX || 0);
const load = () => readFileSync('/proc/loadavg', 'utf8').split(' ').slice(0, 3).join(' ');
const until = async (f, ms = 10000, step = 100) => { const t0 = Date.now(); for (;;) { try { if (await f()) return true; } catch { /* retry */ } if (Date.now() - t0 > ms) return false; await new Promise((r) => setTimeout(r, step)); } };
const b = await chromium.launch({ executablePath: process.env.PW_CHROME || '/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome' });
const ctx = await b.newContext({ viewport: { width: 1600, height: 940 } });
await ctx.addInitScript(() => {
  try { localStorage.setItem('axion.data-mode', 'api'); localStorage.setItem('axion.testhook', '1'); } catch { /* ignore */ }
  // a slow device, deterministically: ResizeObserver callbacks arrive window.__roDelay ms late (Infinity: never)
  const Real = window.ResizeObserver;
  window.__roDelay = 0;
  window.ResizeObserver = class extends Real { constructor(cb) { super((ents, ro) => { const d = window.__roDelay; if (!d) cb(ents, ro); else if (d !== Infinity) setTimeout(() => cb(ents, ro), d); }); } };
  window.__warns = [];
  const w = console.warn.bind(console); console.warn = (...a) => { window.__warns.push(a.map(String).join(' ')); w(...a); };
});
const p = await ctx.newPage();
const errors = []; p.on('pageerror', (e) => errors.push(e.message));
if (THROTTLE > 1) await (await ctx.newCDPSession(p)).send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
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
let k = 0; const key = () => `c55-${Date.now()}-${k++}`;
const checks = []; const check = (name, ok, detail = '') => { checks.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };
const held = (mid, tid) => p.evaluate(async ({ mid, tid }) => (await import('/src/api/missionControl.ts')).useMC.getState().byMission[mid]?.threads?.[tid]?.messages?.length ?? 0, { mid, tid });

const made = await api('POST', '/missions', { text: `Cycle 55 anchor ${Date.now()}`, files: [], shared: true }, { 'idempotency-key': key() });
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
const word = (i) => ['alpha', 'migration', 'checkout', 'evidence', 'tokens', 'staging', 'contrast', 'verify'][i % 8];
const pad = (i) => String(i).padStart(4, '0');
const textOf = (i) => { // mixed heights, as api-c26's I2 thread (1 to 20 lines, long paragraphs)
  const kind = i % 7;
  if (kind === 0) return `mixed ${pad(i)} short`;
  if (kind === 1) return `mixed ${pad(i)} ` + Array.from({ length: 90 }, (_, j) => word(i + j)).join(' ');
  if (kind === 2) return `mixed ${pad(i)}\n` + Array.from({ length: 19 }, (_, j) => `line ${j + 1}: ${word(j)}`).join('\n');
  if (kind === 3) return `mixed ${pad(i)} three\nlines\nhere`;
  if (kind === 4) return `mixed ${pad(i)} ` + Array.from({ length: 30 }, (_, j) => word(j * 3)).join(' ');
  if (kind === 5) return `mixed ${pad(i)} ok`;
  return `mixed ${pad(i)}\n` + Array.from({ length: 8 }, (_, j) => `- ${word(i * j)} ${word(j)}`).join('\n');
};
for (let i = 1; i <= N; i += 10) await Promise.all(Array.from({ length: Math.min(10, N - i + 1) }, (_, j) => api('POST', `/threads/${tid}/messages`, { kind: 'command', text: textOf(i + j), to: 'gm' }, { 'idempotency-key': key() })));
await until(async () => (await held(mid, tid)) >= N + 1, 60000, 250);
await p.reload({ waitUntil: 'domcontentloaded' });
await until(async () => (await held(mid, tid)) >= 50, 15000);
const body = p.locator('.conv-main .thread-body');
await until(async () => (await body.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight).catch(() => 999)) < 60, 10000, 100);
await p.waitForTimeout(800); // the first measurements of the newest page land

/** one older page: hold its request, scroll to the top, remember the first visible row, release; sample that row for 4 s */
async function olderPage(delay, keep = false) {
  const before = await held(mid, tid);
  const heldRoutes = [];
  const re = new RegExp(`/api/v1/threads/${tid}/messages\\?.*before=`);
  await p.route(re, (route) => { heldRoutes.push(route); });
  const a = await body.evaluate(async (el, TOPPX) => {
    el.scrollTop = TOPPX;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const box = el.getBoundingClientRect();
    const first = [...el.querySelectorAll('[data-mid]')].find((n) => n.getBoundingClientRect().bottom > box.top + 1);
    return first ? { id: first.getAttribute('data-mid'), top: first.getBoundingClientRect().top - box.top } : null;
  }, TOPPX);
  await until(async () => heldRoutes.length > 0, 8000, 50);
  await p.evaluate((d) => { window.__roDelay = d; }, delay);
  for (const r of heldRoutes) await r.continue().catch(() => undefined);
  await p.unroute(re);
  const landed = await until(async () => (await held(mid, tid)) > before, 15000, 20);
  // a row above the anchor changes size late, before its (delayed) measurement lands: LATE_PX more pixels at LATE_AT ms (an
  // image decoding, a font arriving), and a thread write follows so the thread commits (which is when hold() looks)
  const late = a && LATE_PX > 0 ? (async () => {
    await p.waitForTimeout(LATE_AT);
    const grew = await body.evaluate((el, { id, px }) => { const r = el.querySelector(`[data-mid="${id}"]`)?.previousElementSibling; if (!r?.matches('[data-mid]')) return null; r.style.paddingBottom = `${px}px`; return r.getAttribute('data-mid'); }, { id: a.id, px: LATE_PX });
    await api('POST', `/threads/${tid}/messages`, { kind: 'command', text: `c55 late probe ${Date.now()}`, to: 'gm' }, { 'idempotency-key': key() });
    return grew;
  })() : null;
  const trail = a ? await body.evaluate(async (el, { id, t0 }) => {
    const out = []; const s = performance.now();
    while (performance.now() - s < 4000) {
      const x = el.querySelector(`[data-mid="${id}"]`);
      out.push([Math.round(performance.now() - s), x ? +(x.getBoundingClientRect().top - el.getBoundingClientRect().top - t0).toFixed(1) : null]);
      await new Promise((r) => setTimeout(r, 100));
    }
    return out;
  }, { id: a.id, t0: a.top }) : [];
  const grew = late ? await late : null;
  if (keep) return { landed, a, trail, grew }; // the reader stays put and the callbacks stay swallowed
  await p.evaluate(() => { window.__roDelay = 0; });
  await p.waitForTimeout(600);
  await body.evaluate((el) => { el.scrollTop += 400; });
  await p.waitForTimeout(300);
  return { landed, a, trail, grew };
}

if (MODE === 'anchor') {
  const shifts = [];
  console.log(`load ${load()} · THROTTLE ${THROTTLE} · RO_DELAY ${RO_DELAY} ms · N ${N}`);
  for (let round = 0; round < ROUNDS && await body.evaluate((el) => el.dataset.hasOlder === '1'); round++) {
    const r = await olderPage(RO_DELAY);
    // the grow is a DOM write a commit has not seen yet: samples from LATE_AT + 600 ms (the thread has committed since) are the bar
    const worst = r.trail.filter(([t]) => LATE_PX <= 0 || t < LATE_AT - 100 || t >= LATE_AT + 600).reduce((m, [, d]) => Math.max(m, d == null ? 999 : Math.abs(d)), 0);
    shifts.push(r.landed && r.a ? worst : 999);
    console.log(`  page ${round + 1}: landed ${r.landed} · row ${r.a?.id} · row above grew ${r.grew} · shift over 4 s (every 100 ms): ${r.trail.map(([, d]) => d == null ? '-' : d.toFixed(1)).join(' ')}`);
  }
  check(`the restored row stays within ${MAX_SHIFT} px for 4 s after each older page while rows above it are measured ${RO_DELAY} ms late`, shifts.length >= 2 && shifts.every((x) => x <= MAX_SHIFT), `${shifts.length} pages · worst shift ${shifts.map((x) => x.toFixed(1)).join(' ')} px · load ${load()}`);
  const warns = await p.evaluate(() => window.__warns.filter((w) => /anchor/i.test(w)));
  check('the bounded safety exit did not fire (every row above the anchor was measured in time)', warns.length === 0, warns.join(' | '));
}
if (MODE === 'never') {
  // rows above the anchor never measure (callbacks swallowed): the anchor is released after the bound, once, with a warning
  const r = await olderPage(Infinity, true);
  const t0 = Date.now(), warned = () => p.evaluate(() => window.__warns.filter((w) => /anchor/i.test(w)));
  const quietBefore = (await warned()).length === 0;
  await until(async () => (await warned()).length > 0, 14000, 200);
  await p.waitForTimeout(1500);
  const warns = await warned();
  check('rows that never measure: no release before the bound, then exactly one logged warning', r.landed && quietBefore && warns.length === 1, `first warning ${Math.round((Date.now() - t0) / 100) / 10} s after the 4 s sample · ${JSON.stringify(warns)}`);
}
check('no page errors', errors.length === 0, errors.join(' | '));
await b.close();
process.exit(checks.every(Boolean) ? 0 : 1);
