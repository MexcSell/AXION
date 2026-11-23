// c67: Agent Profile screenshots at 1366x768, both themes. Usage: DATA_MODE=api node scripts/c67-shots.mjs <outDir> <prefix>
import { chromium } from 'playwright';
import { signIn, navWait, settle } from './_session.mjs';
import { mkdirSync } from 'node:fs';
const [, , out = '/tmp/c67-shots', prefix = 'after'] = process.argv;
mkdirSync(out, { recursive: true });
import { resolveBase } from './_base.mjs';
const base = resolveBase();
const b = await chromium.launch({ executablePath: process.env.PW_CHROME || '/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome' });
for (const theme of ['dark', 'light']) {
  const ctx = await b.newContext({ viewport: { width: 1366, height: 768 } });
  await signIn(ctx);
  await ctx.addInitScript((t) => { localStorage.setItem('axion.settings.v1', JSON.stringify({ state: { themeMode: t, skin: 'luminous', motion: 'reduced' }, version: 0 })); }, theme);
  const p = await ctx.newPage();
  await p.goto(`${base}/agents/coder-01?tab=profile`, { waitUntil: navWait() }); await settle(p); await p.waitForTimeout(800);
  await p.screenshot({ path: `${out}/${prefix}-${theme}.png` });
  console.log(`${prefix}-${theme}`, await p.evaluate(() => { const m = document.querySelector('main'); return { over: m.scrollHeight - m.clientHeight, hero: Math.round(document.querySelector('.oa-hero').getBoundingClientRect().height) }; }));
  await ctx.close();
}
await b.close();
