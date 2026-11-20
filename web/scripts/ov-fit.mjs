// Overview strict fit: no page scroll, no tab-region overflow, no visible inner scroller.
// Usage: node scripts/ov-fit.mjs [shotDir]   (sizes via SIZES="1672x941,1366x768")
import { chromium } from 'playwright';
import { signIn, navWait, settle } from './_session.mjs';
import { mkdirSync } from 'node:fs';
const shots = process.argv[2] || '';
if (shots) mkdirSync(shots, { recursive: true });
const base = process.env.BASE || 'http://127.0.0.1:5190';
const sizes = (process.env.SIZES || '1920x1080,1672x941,1536x864,1440x900,1366x768,1280x760,1536x730,1366x650').split(',').map((s) => s.split('x').map(Number));
const tabs = (process.env.TABS || 'pulse,portfolio,activity,health').split(',');
const motion = process.env.MOTION || 'reduced';
const b = await chromium.launch({ executablePath: process.env.PW_CHROME || '/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome' });
let bad = 0;
for (const [w, h] of sizes) {
  const ctx = await b.newContext({ viewport: { width: w, height: h } });
  await signIn(ctx);
  await ctx.addInitScript((m) => { localStorage.setItem('axion.settings.v1', JSON.stringify({ state: { themeMode: 'dark', skin: 'luminous', motion: m }, version: 0 })); }, motion);
  const p = await ctx.newPage();
  for (const t of tabs) {
    await p.goto(`${base}/overview?tab=${t}`, { waitUntil: navWait() }); await settle(p);
    await p.waitForTimeout(+(process.env.WAIT || 900));
    const r = await p.evaluate(() => {
      const m = document.querySelector('main');
      const reg = document.querySelector('[role=tabpanel]');
      const inner = [...document.querySelectorAll('main *')].filter((e) => {
        if (!e.offsetParent) return false; const s = getComputedStyle(e);
        return /(auto|scroll)/.test(s.overflowY) && e.scrollHeight - e.clientHeight > 1;
      }).map((e) => (e.className && String(e.className).slice(0, 40)) + ':' + (e.scrollHeight - e.clientHeight));
      return { main: m.scrollHeight - m.clientHeight, reg: reg ? reg.scrollHeight - reg.clientHeight : null, regH: reg ? Math.round(reg.clientHeight) : null, inner };
    });
    const ok = r.main <= 1 && (r.reg ?? 0) <= 1 && r.inner.length === 0;
    if (!ok) bad++;
    console.log((ok ? 'ok  ' : 'BAD ') + `${w}x${h}`.padEnd(10) + t.padEnd(10), 'main', r.main, 'reg', r.reg, 'h', r.regH, r.inner.join(' | '));
    if (shots) await p.screenshot({ path: `${shots}/${w}x${h}-${t}.png` });
  }
  await ctx.close();
}
console.log(bad ? `${bad} view(s) scroll` : 'NO SCROLL ANYWHERE');
await b.close();
