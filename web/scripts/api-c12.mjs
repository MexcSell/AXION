// Improvement cycle 12 (theme B2), api mode: previous-period trend and weekly throughput on the Overview scorecard.
// A fresh database shows no trend arrow on any row and an all-zero chart; three real missions (start, cancel: the honest terminal
// state reachable by user actions) then appear in the chart's last week, equal to the server's /company/throughput counts, live.
// Run: ./scripts/api-e2e.sh api-c12.mjs   (ports via E2E_API_PORT / E2E_WEB_PORT)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
process.env.DATA_MODE = 'api'; // _session.mjs reads it at import time
const { signIn, settle } = await import('./_session.mjs');
const base = process.env.BASE;
const SHOTS = process.env.SHOTS || '/tmp/axion-c12'; mkdirSync(SHOTS, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.PW_CHROME || '/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome' });
let bad = 0;
const check = (n, ok, x = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${x ? ' — ' + x : ''}`); };
const until = async (f, ms = 10000) => { const t0 = Date.now(); for (;;) { try { if (await f()) return true; } catch { /* retry */ } if (Date.now() - t0 > ms) return false; await new Promise((r) => setTimeout(r, 150)); } };
const errors = [];
const ctx = await b.newContext({ viewport: { width: 1600, height: 940 } });
await signIn(ctx);
await ctx.addInitScript(() => { try { localStorage.setItem('axion.data-mode', 'api'); localStorage.setItem('axion.settings.v1', JSON.stringify({ state: { themeMode: 'dark' }, version: 0 })); } catch { /* ignore */ } });
const p = await ctx.newPage();
p.on('pageerror', (e) => errors.push(e.message));
const get = async (path) => (await (await ctx.request.get(base + '/api/v1' + path)).json());
let csrf = '';
const post = async (path, data) => { if (!csrf) csrf = (await get('/me')).me.csrf; const r = await ctx.request.post(base + '/api/v1' + path, { data, headers: { 'x-csrf': csrf, 'idempotency-key': `c12-${path}-${Date.now()}-${Math.random()}` } }); return { status: r.status(), body: await r.json().catch(() => ({})) }; };
const chart = async () => (await p.locator('[data-throughput]').getAttribute('data-throughput'))?.split(',') ?? [];
try {
  await p.goto(base + '/overview', { waitUntil: 'domcontentloaded' }); await settle(p);
  await p.locator('[data-scorecard="ready"]').waitFor({ timeout: 15000 });
  await p.locator('[data-tput-ready]').waitFor({ timeout: 15000 });
  const rows = await p.locator('[data-scorecard="ready"] [data-row]').count();
  check('fresh database: 8 rows and no trend arrow on any row', rows === 8 && (await p.locator('.sc-prev.on').count()) === 0 && (await p.locator('[data-trend="up"], [data-trend="down"], [data-trend="flat"]').count()) === 0);
  const c0 = await chart();
  check('fresh database: the chart has 8 weeks, all 0/0', c0.length === 8 && c0.every((x) => x === '0/0'), c0.join(' '));
  const t0 = await get('/company/throughput?weeks=8');
  check('server agrees: 8 weeks of zeros', t0.weeks.length === 8 && t0.weeks.every((w) => w.started === 0 && w.finished === 0));
  const sc0 = await get('/company/scorecard');
  check('server rows carry previous and a null trend', sc0.rows.every((r) => r.trend === null && r.previous && typeof r.previous.n === 'number'));
  check('the ? help for the scorecard explains the trend rule', await (async () => { await p.locator('[data-help-key="company.scorecard"]').first().click(); const ok = await until(async () => /fewer than 3 samples/.test(await p.locator('body').innerText()), 4000); await p.keyboard.press('Escape'); return ok; })());
  for (let i = 0; i < 3; i++) {
    const m = (await post('/missions', { text: `Trend check ${i + 1}: compare two backup tools and list their limits.`, files: [], shared: false })).body.mission;
    for (const action of ['start', 'cancel']) { for (let k = 0; k < 8; k++) { const r = await post(`/missions/${m.id}/actions/${action}`, {}); if (r.status === 200 || (r.status === 409 && action === 'start')) break; await new Promise((r2) => setTimeout(r2, 250)); } }
  }
  const t1 = await get('/company/throughput?weeks=8');
  const want = t1.weeks.map((w) => `${w.started}/${w.finished}`);
  check('server counts 3 started and 3 finished in the last week', want[7] === '3/3' && want.slice(0, 7).every((x) => x === '0/0'), want.join(' '));
  check('the chart follows live and matches the server counts', await until(async () => (await chart()).join(',') === want.join(','), 10000), (await chart()).join(' '));
  const sc1 = await get('/company/scorecard');
  check('still no arrow: the previous period has no evidence (n < 3)', (await p.locator('.sc-prev.on').count()) === 0 && sc1.rows.every((r) => r.trend === null));
  // a mocked server answer with a real trend: the arrow and the previous value show only on the row that has one
  await p.route('**/api/v1/company/scorecard*', async (route) => {
    const r = await route.fetch(); const j = await r.json();
    j.rows = j.rows.map((x) => (x.key === 'failure_rate' ? { ...x, value: 60, n: 5, state: 'ok', previous: { value: 40, n: 4 }, trend: 'up' } : x));
    await route.fulfill({ response: r, json: j });
  });
  await p.goto(base + '/overview', { waitUntil: 'domcontentloaded' }); await settle(p);
  await p.locator('[data-scorecard="ready"]').waitFor({ timeout: 15000 });
  check('a non-null trend shows its arrow and previous value, only on that row', await until(async () => (await p.locator('.sc-prev.on').count()) === 1 && /↑\s*40\.0%/.test(await p.locator('[data-row="failure_rate"] .sc-prev').innerText())));
  await p.screenshot({ path: `${SHOTS}/c12-overview.png` });
} catch (e) { bad++; console.log('FAIL exception — ' + e.message); try { console.log('URL', p.url(), (await p.locator('body').innerText()).slice(0, 400).replace(/\n/g, ' / ')); } catch { /* ignore */ } }
check('no page errors', errors.length === 0, errors.join(' | '));
await b.close();
console.log(bad ? `${bad} FAILED` : 'ALL PASS');
process.exit(bad ? 1 : 0);
