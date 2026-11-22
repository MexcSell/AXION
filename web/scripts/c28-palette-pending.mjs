// Cycle 28 fix round (I1): an Enter pressed while the lazy help registry loads must not act after the palette closed.
// The registry chunk is held. A: Enter, Escape, release -> no navigation, no dialog. B: Enter, click a result, release -> exactly one navigation.
// Usage: BASE=http://127.0.0.1:7690 node scripts/c28-palette-pending.mjs (dev server)
import { chromium } from 'playwright';
import { signIn } from './_session.mjs';
const base = process.env.BASE || 'http://127.0.0.1:5190';
const b = await chromium.launch({ executablePath: process.env.PW_CHROME || '/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome' });
let fails = 0;
for (const variant of ['escape', 'click']) {
  const ctx = await b.newContext({ viewport: { width: 1672, height: 941 } }); await signIn(ctx);
  const p = await ctx.newPage();
  let release; const gate = new Promise((r) => { release = r; });
  await p.route(/\/src\/help\/registry/, async (route) => { await gate; await route.continue().catch(() => {}); });
  try {
    await p.goto(base + '/missions', { waitUntil: 'domcontentloaded' });
    await p.locator('.mission-row').first().waitFor({ timeout: 20000 });
    const h0 = await p.evaluate(() => history.length);
    await p.keyboard.press('Control+k');
    await p.locator('.palette-input').fill('settings navigation');
    await p.keyboard.press('Enter'); // registry held: Enter waits
    if (!/\/missions/.test(p.url())) throw new Error('Enter acted before the registry arrived');
    if (variant === 'escape') await p.keyboard.press('Escape');
    else await p.locator('.palette-item', { hasText: 'Settings › Navigation' }).first().click();
    if (variant === 'click') await p.waitForURL(/\/settings\?tab=navigation/);
    release();
    await p.waitForFunction(() => performance.getEntriesByType('resource').some((e) => /help\/registry/.test(e.name) && e.responseEnd > 0), null, { timeout: 10000 });
    await p.waitForTimeout(600);
    const h1 = await p.evaluate(() => history.length);
    const dialogs = await p.locator('[aria-modal=true]').count();
    if (variant === 'escape') { if (!/\/missions/.test(p.url()) || h1 !== h0 || dialogs) throw new Error(`surprise action after Escape: ${p.url()} history ${h0}->${h1} dialogs ${dialogs}`); }
    else if (h1 !== h0 + 1 || dialogs) throw new Error(`expected exactly one navigation: history ${h0}->${h1} dialogs ${dialogs}`);
    console.log(`PASS ${variant}`);
  } catch (e) { fails++; console.log(`FAIL ${variant}: ${String(e.message).split('\n')[0]}`); }
  release(); await ctx.close();
}
await b.close(); process.exit(fails ? 1 : 0);
