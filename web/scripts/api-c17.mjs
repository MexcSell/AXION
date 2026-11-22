// Cycle 17 (api mode): every "What's new" guide page has a working deep link. Opens each page from its own URL
// (/help?tab=new-features&f=<key>), checks the right page is selected, follows "Open it" and checks it lands on the
// right route/tab. Also: the Help page fits one screen. Run: ./scripts/api-e2e.sh api-c17.mjs
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { signIn, settle } from './_session.mjs';
const base = process.env.BASE || 'http://127.0.0.1:5193';
const src = readFileSync(new URL('../src/help/whatsnew.ts', import.meta.url), 'utf8');
const items = [...src.matchAll(/key: '(\w+)', group:[\s\S]*?route: '([^']+)', lands: '([^']+)'[\s\S]*?\n  \},/g)].map((m) => ({ key: m[1], route: m[2], lands: m[3], after: (m[0].match(/afterMerge: '([^']+)'/) || [])[1] }));
const b = await chromium.launch({ executablePath: process.env.PW_CHROME || '/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome' });
const results = []; const errors = [];
const check = (n, ok, x = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${x ? ' — ' + x : ''}`); };
const until = async (f, ms = 10000) => { const t0 = Date.now(); for (;;) { try { if (await f()) return true; } catch { /* retry */ } if (Date.now() - t0 > ms) return false; await new Promise((r) => setTimeout(r, 150)); } };
const ctx = await b.newContext({ viewport: { width: 1672, height: 941 } });
await signIn(ctx);
const p = await ctx.newPage();
p.on('pageerror', (e) => errors.push(e.message));
check('parsed 14 guide pages from the content file', items.length === 14, String(items.length));
for (const it of items) {
  await p.goto(`${base}/help?tab=new-features&f=${it.key}`, { waitUntil: 'domcontentloaded' }); await settle(p, 100);
  const shown = await until(async () => (await p.locator(`[data-wn-detail="${it.key}"]`).count()) === 1 && (await p.locator(`[data-wn="${it.key}"][aria-selected="true"]`).count()) === 1);
  const link = p.locator(`[data-wn-open="${it.key}"]`);
  const href = shown ? await link.getAttribute('href') : null;
  check(`${it.key}: the page opens from its own URL and its link points at ${it.route}`, shown && href === it.route, `href ${href}`);
  if (!shown) continue;
  await link.click();
  const want = new URL(it.route, base);
  const landed = await until(async () => {
    const u = new URL(p.url());
    // legacy redirects (e.g. /agents) may rewrite the path, so the route's own path or the Operations page is accepted
    if (!(u.pathname === want.pathname || (want.pathname === '/agents' && u.pathname === '/operations'))) return false;
    for (const [k, v] of want.searchParams) { if (k !== 'chat' && u.searchParams.get(k) !== v) return false; }
    if (it.lands === 'dock') return (await p.locator('[data-dialog="chat-dock"]').count()) > 0;
    if (want.searchParams.has('sub')) return (await p.locator('[role="tab"][aria-selected="true"]', { hasText: it.lands }).count()) > 0; // the Operations sub-tab
    return (await p.locator(`[role="tabpanel"][aria-label="${it.lands}"]`).count()) > 0;
  }, 15000);
  if (it.after) { // runs after merge of cycles 4 to 6: skip (not fail) while the feature's screen is not in this build
    if (it.key === 'history') await p.getByRole('radio', { name: 'History', exact: true }).first().click({ timeout: 5000 }).catch(() => {}); // c04's view switch is a radio group
    const there = await until(async () => (await p.locator(it.after).count()) > 0, 5000);
    if (!there) { console.log(`SKIP ${it.key}: runs after merge (${it.after} not in this build)`); continue; }
    check(`${it.key}: the merged screen is there (${it.after})`, true);
  }
  check(`${it.key}: the link lands on ${it.route} (${it.lands})`, landed, p.url().replace(base, ''));
}
// one screen: no scrolling of the page itself, on the guide and on the other Help tabs
for (const [w, h] of [[1672, 941], [1440, 900]]) {
  await p.setViewportSize({ width: w, height: h });
  for (const t of ['new-features', 'guides', 'context-help']) {
    await p.goto(`${base}/help?tab=${t}`, { waitUntil: 'domcontentloaded' }); await settle(p, 400);
    await until(async () => (await p.locator('.fit-scroll:visible').count()) > 0, 8000);
    const r = await p.evaluate(() => { const m = document.querySelector('main'); const s = [...document.querySelectorAll('.fit-scroll')].filter((e) => e.offsetParent); return { over: m.scrollHeight - m.clientHeight, ch: s.map((e) => e.clientHeight) }; });
    check(`Help ${t} fits one screen at ${w}x${h}`, r.over <= 2 && r.ch.length > 0 && r.ch.every((c) => c >= 200), JSON.stringify(r));
  }
}
check('no page errors', errors.length === 0, errors.join(' | '));
await b.close();
process.exit(results.every(Boolean) ? 0 : 1);
