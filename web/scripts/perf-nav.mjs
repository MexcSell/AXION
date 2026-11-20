// Page-switch speed + idle frame-rate check. Usage: node scripts/perf-nav.mjs [base]
// Env: CHROME=<chromium path> (if Playwright's own build is missing), ROUTES=/a,/b,...
// "switch" = click → the new page is mounted, loaded (no skeleton) and fully opaque.
import { chromium } from 'playwright';
import { signIn } from './_session.mjs';
const BASE = process.argv[2] || process.env.BASE || 'http://127.0.0.1:5190';
const log = (...a) => process.stderr.write(a.join(' ') + '\n');
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
await signIn(ctx);
// experiments: SETTINGS='{"particles":false}' merges into the persisted settings; CSS='...' injects a stylesheet
if (process.env.SETTINGS) await ctx.addInitScript((p) => { const k = 'axion.settings.v1'; let v; try { v = JSON.parse(localStorage.getItem(k)); } catch { v = null; } v = v || { state: {}, version: 0 }; Object.assign(v.state, JSON.parse(p)); localStorage.setItem(k, JSON.stringify(v)); }, process.env.SETTINGS);
if (process.env.CSS) await ctx.addInitScript((c) => document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = c; document.head.append(s); }), process.env.CSS);
const page = await ctx.newPage();
if (process.env.THROTTLE) { const cdp = await ctx.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: +process.env.THROTTLE }); }
await page.goto(BASE + '/overview', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.route-view', { timeout: 20000 });
await page.waitForTimeout(+(process.env.SETTLE || 2500));

const fps = () => page.evaluate(() => new Promise((r) => {
  const t = []; let last = performance.now(); const end = last + 3000;
  const f = (n) => { t.push(n - last); last = n; if (n < end) requestAnimationFrame(f); else r({ fps: +(1000 / (t.reduce((a, b) => a + b, 0) / t.length)).toFixed(1), worstMs: +Math.max(...t).toFixed(1) }); };
  requestAnimationFrame(f);
}));
log('idle /overview:', JSON.stringify(await fps()));

const routes = (process.env.ROUTES || '/missions,/notifications,/settings,/overview,/missions,/settings,/overview').split(',');
const res = [], times = [];
for (const to of routes) {
  const t = await page.evaluate((to) => new Promise((resolve) => {
    const old = document.querySelector('.route-view');
    const t0 = performance.now(), dl = t0 + 5000; let tm = 0, tl = 0;
    const a = document.querySelector(`.rail a[href^="${to}"]`) || document.querySelector(`a[href^="${to}"]`);
    if (a) a.click(); else { history.pushState({}, '', to); dispatchEvent(new PopStateEvent('popstate')); }
    const check = () => {
      const v = document.querySelectorAll('.route-view'); const rv = v[v.length - 1];
      if (!tm && rv && rv !== old) tm = performance.now() - t0;
      if (tm && !tl && rv.firstElementChild && !rv.querySelector('[aria-busy="true"]')) tl = performance.now() - t0;
      const ok = v.length === 1 && rv !== old && rv.firstElementChild && !rv.querySelector('[aria-busy="true"]') && getComputedStyle(rv).opacity === '1' && getComputedStyle(rv).transform === 'none';
      if (ok) resolve([performance.now() - t0, tm, tl]);
      else if (performance.now() > dl) resolve(`TIMEOUT v=${v.length} same=${rv === old} op=${rv && getComputedStyle(rv).opacity} tf=${rv && getComputedStyle(rv).transform}`);
      else requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  }), to);
  if (typeof t === 'string') res.push(`${to}: ${t}`); else { res.push(`${to}: ${t[0].toFixed(0)}ms (mount ${t[1].toFixed(0)}, loaded ${t[2].toFixed(0)})`); times.push(t[0]); }
  await page.waitForTimeout(700);
}
log(res.join('  '));
times.sort((a, b) => a - b);
if (times.length) log('median switch ms:', times[times.length >> 1].toFixed(0));
await browser.close();
