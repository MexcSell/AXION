// Cycle 27 (lane w25), api mode: two small honesty/usability fixes from earlier reviews.
//  1. c06 m10: the Working / Learning / Evolving tiles above the System Operations tabs carry a DEMO tag in api mode.
//  2. Stage 6 ledger (T6 M7): a notification route /x?chat=admin&tab=... opens the admin chat but keeps the rest of the query and the hash.
// Run through scripts/api-e2e.sh. Condition waits only.
import { chromium } from 'playwright';
const base = process.env.BASE || 'http://127.0.0.1:5193';
const b = await chromium.launch({ executablePath: process.env.PW_CHROME || '/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome' });
const ctx = await b.newContext({ viewport: { width: 1600, height: 940 } });
await ctx.addInitScript(() => { try { localStorage.setItem('axion.data-mode', 'api'); localStorage.setItem('axion.testhook', '1'); } catch { /* ignore */ } });
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
let fails = 0;
const check = (name, ok, extra = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };
const until = async (f, ms = 10000, step = 100) => { const t0 = Date.now(); for (;;) { try { if (await f()) return true; } catch { /* retry */ } if (Date.now() - t0 > ms) return false; await new Promise((r) => setTimeout(r, step)); } };
try {
  await p.goto(base + '/missions', { waitUntil: 'domcontentloaded' });
  await p.getByRole('heading', { name: 'Connect' }).waitFor({ timeout: 20000 });
  await p.getByLabel('Name').fill('Luca');
  await p.getByLabel('Password', { exact: true }).fill('secret-1');
  await p.getByRole('button', { name: /Connect/ }).click();
  await p.waitForSelector('.rail-nav', { timeout: 20000 });

  // 1. DEMO tags on the three fixture tiles (and not on the first tile, which counts the real catalog)
  await p.goto(base + '/operations?tab=agents', { waitUntil: 'domcontentloaded' });
  await p.locator('.kpi').first().waitFor({ timeout: 15000 });
  const tile = (label) => p.locator('.kpi', { has: p.locator('.kpi-label', { hasText: new RegExp(`^${label}$`) }) });
  for (const l of ['Working', 'Learning', 'Evolving']) {
    const ok = await until(async () => (await tile(l).locator('.demo-tag').count()) === 1, 8000);
    check(`c06 m10: the ${l} tile carries a DEMO tag in api mode`, ok);
  }
  check('c06 m10: the Agents tile is not tagged', (await tile('Agents').locator('.demo-tag').count()) === 0);

  // 2. ?chat=admin keeps the other query parameters and the hash
  await p.goto(base + '/operations?tab=agents&sub=development&chat=admin#top', { waitUntil: 'domcontentloaded' });
  check('ledger T6 M7: the admin chat opens', await until(async () => (await p.locator('[data-dialog="chat-dock"]').count()) === 1, 10000));
  const u = () => new URL(p.url());
  check('ledger T6 M7: ?chat is removed, tab and sub stay, the hash stays', await until(async () => { const x = u(); return !x.searchParams.has('chat') && x.searchParams.get('tab') === 'agents' && x.searchParams.get('sub') === 'development' && x.hash === '#top'; }, 8000), p.url());
  check('no page errors', errors.length === 0, errors.join(' | '));
} finally { await b.close(); }
process.exit(fails ? 1 : 0);
