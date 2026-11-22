// c25's stale-anchor fix, api mode (added by the integrator in batch 5g, when c26's virtualised thread merged).
// A slow older page: the request is held, and meanwhile the reader keeps scrolling down. When the page lands, the row
// the reader is looking at NOW must stay in place (±8 px): the anchor follows the reader (ChatView onScroll re-captures it
// while loadingOlder). Not the row from the moment the request started.
// RED without c25's re-capture line: 334 px in 3/3 rounds; GREEN on the merged tree: 0.1 px.
// Usage: ./scripts/api-e2e.sh api-c25-anchor.mjs   (exit 1 on a FAIL)
import { chromium } from 'playwright';
const base = process.env.BASE || 'http://127.0.0.1:5193';
const until = async (f, ms = 10000, step = 100) => { const t0 = Date.now(); for (;;) { try { if (await f()) return true; } catch { /* retry */ } if (Date.now() - t0 > ms) return false; await new Promise((r) => setTimeout(r, step)); } };
const b = await chromium.launch({ executablePath: process.env.PW_CHROME || '/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome' });
const ctx = await b.newContext({ viewport: { width: 1600, height: 940 } });
await ctx.addInitScript(() => { try { localStorage.setItem('axion.data-mode', 'api'); localStorage.setItem('axion.testhook', '1'); } catch { /* ignore */ } });
const p = await ctx.newPage();
const errors = []; p.on('pageerror', (e) => errors.push(e.message));
await p.goto(base + '/missions', { waitUntil: 'domcontentloaded' });
await p.getByRole('heading', { name: 'Connect' }).waitFor({ timeout: 20000 });
await p.getByLabel('Name').fill('Luca'); await p.getByLabel('Password', { exact: true }).fill('secret-1');
await p.getByRole('button', { name: /Connect/ }).click();
await p.waitForSelector('.rail-nav', { timeout: 20000 });
let csrf = '';
const api = async (method, path, data, headers = {}) => {
  if (!csrf && method !== 'GET') csrf = (await (await p.request.get(base + '/api/v1/me')).json()).me.csrf;
  const r = await p.request.fetch(base + '/api/v1' + path, { method, data, headers: { ...(method !== 'GET' ? { 'x-csrf': csrf } : {}), ...headers } });
  return { status: r.status(), body: await r.json().catch(() => ({})) };
};
let k = 0; const key = () => `c25sa-${Date.now()}-${k++}`;
const made = await api('POST', '/missions', { text: `Stale anchor probe ${Date.now()}`, files: [], shared: true }, { 'idempotency-key': key() });
const mid = made.body.mission.id;
await until(async () => ((await api('GET', `/missions/${mid}/hierarchy`)).body.nodes ?? []).length >= 2, 15000);
await p.goto(`${base}/missions/${mid}?tab=conversations&agent=gm`, { waitUntil: 'domcontentloaded' });
const c = p.locator('.conv-main .composer').first(); await c.waitFor({ timeout: 15000 });
await c.locator('textarea').fill('first command'); await c.getByRole('button', { name: 'Send message' }).click();
let tid; await until(async () => { tid = ((await api('GET', `/missions/${mid}/threads`)).body.threads ?? []).find((t) => t.a === 'human' || t.b === 'human')?.id; return !!tid; }, 10000);
const N = 300;
for (let i = 0; i < N; i += 10) await Promise.all(Array.from({ length: Math.min(10, N - i) }, (_, j) => api('POST', `/threads/${tid}/messages`, { kind: 'command', text: `probe ${String(i + j + 1).padStart(4, '0')} ` + 'word '.repeat(((i + j) % 7) * 9), to: 'gm' }, { 'idempotency-key': key() })));
const held = () => p.evaluate(async ({ mid, tid }) => (await import('/src/api/missionControl.ts')).useMC.getState().byMission[mid]?.threads?.[tid]?.messages?.length ?? 0, { mid, tid });
await p.reload({ waitUntil: 'domcontentloaded' });
await until(async () => (await held()) >= 50, 20000);
await p.waitForTimeout(1500);
const body = p.locator('.conv-main .thread-body');
const firstVisible = (el) => { const box = el.getBoundingClientRect(); const f = [...el.querySelectorAll('[data-mid]')].find((n) => n.getBoundingClientRect().bottom > box.top + 1); return f ? { id: f.getAttribute('data-mid'), top: f.getBoundingClientRect().top - box.top } : null; };
const results = [];
for (let round = 0; round < 3 && await body.evaluate((el) => el.dataset.hasOlder === '1'); round++) {
  const before = await held();
  const hold = []; const re = new RegExp(`/api/v1/threads/${tid}/messages\\?.*before=`);
  await p.route(re, (route) => { hold.push(route); });
  await body.evaluate((el) => { el.scrollTop = 0; });
  const requested = await until(async () => hold.length > 0, 5000, 50);
  // the slow page: the reader keeps scrolling down in small steps while it loads
  for (let i = 0; i < 6; i++) { await body.evaluate((el) => { el.scrollTop += 60; }); await p.waitForTimeout(120); }
  await p.waitForTimeout(300);
  const a = await body.evaluate(`(${firstVisible.toString()})(document.querySelector('.conv-main .thread-body'))`);
  for (const r of hold) await r.continue().catch(() => undefined);
  await p.unroute(re);
  const grew = await until(async () => (await held()) > before, 10000);
  await p.waitForTimeout(800);
  const after = a ? await body.evaluate((el, id) => { const x = el.querySelector(`[data-mid="${id}"]`); return x ? x.getBoundingClientRect().top - el.getBoundingClientRect().top : null; }, a.id) : null;
  const shift = after == null || !a ? 999 : Math.abs(after - a.top);
  results.push({ round, requested, grew, shift: Math.round(shift * 10) / 10 });
  console.log(`  round ${round}: request held ${requested}, page landed ${grew}, row the reader saw last moved ${shift.toFixed(1)} px`);
  await body.evaluate((el) => { el.scrollTop += 400; }); await p.waitForTimeout(300);
}
const ok = results.length >= 2 && results.every((r) => r.requested && r.grew && r.shift <= 8);
console.log(`${ok ? 'PASS' : 'FAIL'} c25 stale anchor: after the reader kept scrolling during a slow older page, the row in view stays put (±8 px) — ${results.map((r) => r.shift).join(' ')} px`);
console.log(errors.length ? `FAIL page errors: ${errors.slice(0, 3).join(' | ')}` : 'PASS no page errors');
await b.close();
process.exit(ok && !errors.length ? 0 : 1);
