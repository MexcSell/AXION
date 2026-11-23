// Cycle 73 fix round (P4c): the public suffix tile in System Operations shows the age, the 90-day warning, and an explicit
// "Age unavailable" warning when the server could not read the age (publicSuffix null) instead of hiding the tile.
// Run through scripts/api-e2e.sh. The health response is patched in the page (real server, three variants).
import { chromium } from 'playwright';
import { signIn, navWait, settle } from './_session.mjs';
const base = process.env.BASE;
const b = await chromium.launch({ executablePath: process.env.PW_CHROME || '/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome' });
const ctx = await b.newContext({ viewport: { width: 1672, height: 941 } });
await signIn(ctx);
const p = await ctx.newPage();
let fails = 0;
const check = (n, ok, d) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ' — ' + d : ''}`); if (!ok) fails++; };
let patch = (x) => x;
await p.route(/\/api\/v1\/operations\/health$/, async (route) => { const r = await route.fetch(); const j = await r.json(); await route.fulfill({ response: r, json: patch(j) }); });
const variants = [
  ['fresh', (j) => j, { stale: 'false', un: 'false', text: /\d+ d old/ }],
  ['stale (120 days)', (j) => ({ ...j, publicSuffix: { ...j.publicSuffix, ageDays: 120, stale: true } }), { stale: 'true', un: 'false', text: /120 d old/, sub: /older than 90 days/ }],
  ['age unavailable (null)', (j) => ({ ...j, publicSuffix: null }), { stale: 'true', un: 'true', text: /Age unavailable/, sub: /do not assume it is fresh/ }],
];
for (const [name, fn, want] of variants) {
  patch = fn;
  await p.goto(base + '/operations?tab=Services', { waitUntil: navWait() }); await settle(p, 400);
  const tile = p.locator('[data-testid="psl-age"]');
  await tile.waitFor({ timeout: 20000 }).catch(() => {});
  const n = await tile.count();
  const txt = n ? await tile.innerText() : '';
  const help = n ? await tile.locator('[data-help-key="ops.publicSuffix"]').count() : 0;
  check(`${name}: the tile is shown with the right state`, n === 1 && (await tile.getAttribute('data-stale')) === want.stale && (await tile.getAttribute('data-unavailable')) === want.un && want.text.test(txt) && (!want.sub || want.sub.test(txt)) && help >= 1, `tile ${n}, "${txt.replace(/\s+/g, ' ')}", help buttons ${help}`);
}
await b.close();
process.exit(fails ? 1 : 0);
