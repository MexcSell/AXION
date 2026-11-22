// Cycle 44 fix round: a lone message right after a burst is not held back by the adaptive conversation flush.
// A burst of BURST messages (default 200) is posted into an open thread; after a pause (PAUSE ms, default 150: longer than
// the flush's stream gap) one more message is posted. The time from the start of that POST to the message being in the
// app's store must be at most MAX_MS (default 200; the flush is 60 ms, the POST and the stream add the rest), and the same
// probe on a quiet thread (no burst) is printed beside it. Run through scripts/api-e2e.sh. No fixed sleeps except the pause itself.
import { chromium } from 'playwright';
const base = process.env.BASE || 'http://127.0.0.1:5193';
const BURST = Number(process.env.BURST || 200), PAUSE = Number(process.env.PAUSE || 150), MAX_MS = Number(process.env.MAX_MS || 200), PROBES = Number(process.env.PROBES || 5);
const until = async (f, ms = 10000, step = 100) => { const t0 = Date.now(); for (;;) { try { if (await f()) return true; } catch { /* retry */ } if (Date.now() - t0 > ms) return false; await new Promise((r) => setTimeout(r, step)); } };
const b = await chromium.launch({ executablePath: process.env.PW_CHROME || '/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome' });
const ctx = await b.newContext({ viewport: { width: 1600, height: 940 } });
await ctx.addInitScript(() => { try { localStorage.setItem('axion.data-mode', 'api'); localStorage.setItem('axion.testhook', '1'); } catch { /* ignore */ } });
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
let k = 0; const key = () => `c44-${Date.now()}-${k++}`;
const made = await api('POST', '/missions', { text: `Cycle 44 flush latency ${Date.now()}`, files: [], shared: true }, { 'idempotency-key': key() });
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
const held = () => p.evaluate(async ({ mid, tid }) => (await import('/src/api/missionControl.ts')).useMC.getState().byMission[mid]?.threads?.[tid]?.messages?.length ?? 0, { mid, tid });
/** time from the start of a POST (made inside the page, one clock) to the message being in the store */
const probe = (text, pause) => p.evaluate(async ({ mid, tid, text, pause, csrf, k }) => {
  const { useMC } = await import('/src/api/missionControl.ts');
  const has = () => (useMC.getState().byMission[mid]?.threads?.[tid]?.messages ?? []).some((m) => m.text === text);
  if (pause) await new Promise((r) => setTimeout(r, pause));
  const t0 = performance.now();
  const res = await fetch(`/api/v1/threads/${tid}/messages`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf': csrf, 'idempotency-key': k }, body: JSON.stringify({ kind: 'command', text, to: 'gm' }) });
  while (!has()) { if (performance.now() - t0 > 5000) return { ok: false, status: res.status }; await new Promise((r) => setTimeout(r, 2)); }
  return { ok: true, ms: performance.now() - t0, status: res.status };
}, { mid, tid, text, pause, csrf, k: key() });
const checks = []; const check = (name, ok, detail = '') => { checks.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };
await api('GET', '/me'); // csrf
const quiet = []; for (let i = 0; i < PROBES; i++) quiet.push((await probe(`c44 quiet ${i}`, 400)).ms);
for (let i = 0; i < BURST; i += 10) await Promise.all(Array.from({ length: 10 }, (_, j) => api('POST', `/threads/${tid}/messages`, { kind: 'command', text: `c44 burst ${i + j}`, to: 'gm' }, { 'idempotency-key': key() })));
await until(async () => (await held()) >= BURST + 1 + PROBES, 60000, 100);
const after = [];
for (let i = 0; i < PROBES; i++) {
  // bring the flush's adaptive state up again with a short burst, then pause and probe
  await Promise.all(Array.from({ length: 10 }, (_, j) => api('POST', `/threads/${tid}/messages`, { kind: 'command', text: `c44 re-burst ${i}-${j}`, to: 'gm' }, { 'idempotency-key': key() })));
  const r = await probe(`c44 after burst ${i}`, PAUSE); after.push(r.ms ?? Infinity);
}
const f = (a) => a.map((x) => x.toFixed(0)).join(' ');
const worst = Math.max(...after), qmax = Math.max(...quiet);
check(`a lone message ${PAUSE} ms after a burst is in the store within ${MAX_MS} ms`, worst <= MAX_MS, `after a burst: ${f(after)} ms · quiet control: ${f(quiet)} ms`);
check('the burst arrived whole (no message lost)', (await held()) >= BURST + 1 + PROBES * 12, `held ${await held()}`);
check('no page errors', errors.length === 0, errors.join(' | '));
await b.close();
process.exit(checks.every(Boolean) ? 0 : 1);
