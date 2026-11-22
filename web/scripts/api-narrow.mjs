import { chromium } from 'playwright';
import { signIn, settle, calm } from './_session.mjs';
const b = await chromium.launch({ executablePath: '/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome' });
for (const w of [390, 900, 1280]) {
  const ctx = await b.newContext({ viewport: { width: w, height: 800 } });
  await signIn(ctx);
  const p = await ctx.newPage();
  await p.goto(process.env.BASE + '/missions', { waitUntil: 'domcontentloaded' }); await settle(p); await p.waitForSelector('.topbar-inner', { timeout: 15000 }); await calm(p);
  const over = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const bar = await p.evaluate(() => { const t = document.querySelector('.topbar-inner'); return t ? t.scrollWidth - t.clientWidth : -1; });
  console.log(`${w}px page overflow ${over}px, top bar overflow ${bar}px`);
  await p.screenshot({ path: `/tmp/axion-api-e2e/narrow-${w}.png` });
  await ctx.close();
}
await b.close();
