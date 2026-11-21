// Cycle 28: the palette's first open, typed into the instant the input exists (before React's passive effects run).
// A MutationObserver (microtask, same task as the commit) types the query and presses Enter; the query must survive
// and Enter must open the page for the typed query. Usage: BASE=... node scripts/c28-palette-fast.mjs
import { chromium } from 'playwright';
import { signIn } from './_session.mjs';
const base = process.env.BASE || 'http://127.0.0.1:5190';
const runs = Number(process.env.RUNS || 5);
const b = await chromium.launch({ executablePath: process.env.PW_CHROME || '/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome' });
let fails = 0;
for (let i = 1; i <= runs; i++) {
  const ctx = await b.newContext({ viewport: { width: 1672, height: 941 } });
  await signIn(ctx);
  const p = await ctx.newPage();
  try {
    await p.goto(base + '/missions', { waitUntil: 'domcontentloaded' });
    await p.locator('.mission-row').first().waitFor({ timeout: 20000 });
    await p.evaluate(() => {
      const mo = new MutationObserver(() => {
        const el = document.querySelector('.palette-input');
        if (!el) return;
        mo.disconnect();
        const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        set.call(el, 'settings navigation'); el.dispatchEvent(new Event('input', { bubbles: true }));
        window.__typed = true;
      });
      mo.observe(document.body, { childList: true, subtree: true });
    });
    await p.keyboard.press('Control+k');
    await p.waitForFunction(() => window.__typed === true);
    await p.waitForTimeout(400); // let React settle, then judge what the user would see
    const q = await p.locator('.palette-input').inputValue();
    if (q !== 'settings navigation') throw new Error(`query wiped: "${q}"`);
    await p.keyboard.press('Enter');
    await p.waitForURL(/\/settings\?tab=navigation/, { timeout: 5000 });
    await p.locator('.palette-layer').waitFor({ state: 'detached', timeout: 3000 });
    await p.keyboard.press('Control+k'); // reopened: starts empty
    await p.locator('.palette-input').waitFor();
    const again = await p.locator('.palette-input').inputValue();
    if (again !== '') throw new Error(`reopened with stale query "${again}"`);
    console.log(`run ${i}: PASS`);
  } catch (e) { fails++; console.log(`run ${i}: FAIL url=${p.url()} ${String(e.message).split('\n')[0]}`); }
  await ctx.close();
}
await b.close();
console.log(`palette-fast: ${fails}/${runs} failures`);
process.exit(fails ? 1 : 0);
