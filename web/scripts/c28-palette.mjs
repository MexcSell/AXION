// Cycle 28: the Ctrl+K palette step, isolated and repeated. Fresh context per run (cold lazy help registry).
// Usage: BASE=http://127.0.0.1:7690 RUNS=20 node scripts/c28-palette.mjs   (exit 1 on any failure)
import { chromium } from 'playwright';
import { signIn } from './_session.mjs';
const base = process.env.BASE || 'http://127.0.0.1:5190';
const runs = Number(process.env.RUNS || 20);
const b = await chromium.launch({ executablePath: process.env.PW_CHROME || '/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome' });
let fails = 0;
for (let i = 1; i <= runs; i++) {
  const ctx = await b.newContext({ viewport: { width: 1672, height: 941 } });
  await signIn(ctx);
  await ctx.addInitScript(() => localStorage.setItem('axion.settings.v1', JSON.stringify({ state: { themeMode: 'dark', skin: 'luminous', motion: 'reduced' }, version: 0 })));
  const p = await ctx.newPage();
  try {
    await p.goto(base + '/missions', { waitUntil: 'domcontentloaded' });
    await p.locator('.mission-row').first().waitFor({ timeout: 20000 });
    await p.keyboard.press('Control+k');
    await p.locator('.palette-input').fill('settings navigation');
    await p.keyboard.press('Enter');
    await p.waitForURL(/\/settings\?tab=navigation/, { timeout: 5000 });
    // a fast typist: no wait between opening, typing and Enter, then the palette must be closed
    await p.locator('.palette-layer').waitFor({ state: 'detached', timeout: 3000 });
    console.log(`run ${i}: PASS`);
  } catch (e) { fails++; console.log(`run ${i}: FAIL url=${p.url()} q=${await p.locator('.palette-input').inputValue().catch(() => '-')} ${String(e.message).split('\n')[0]}`); }
  await ctx.close();
}
await b.close();
console.log(`palette: ${fails}/${runs} failures`);
process.exit(fails ? 1 : 0);
