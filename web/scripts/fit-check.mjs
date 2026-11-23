// Desktop fit-to-screen check: every route × tab must fill exactly one screen (no .main scroll),
// with a visible .fit-scroll region of reasonable height. Usage: node scripts/fit-check.mjs [w] [h] [shotDir]
import { chromium } from 'playwright';
import { signIn, navWait, settle, calm } from './_session.mjs';
import { mkdirSync, readFileSync } from 'node:fs';
const [, , w = '1672', h = '941', shots = ''] = process.argv;
import { resolveBase } from './_base.mjs';
const base = resolveBase();
if (shots) mkdirSync(shots, { recursive: true });
const nav = readFileSync(new URL('../src/config/nav.ts', import.meta.url), 'utf8');
const tabs = {};
for (const m of nav.slice(nav.indexOf('ROUTE_TABS')).matchAll(/^\s+(\w+): \[(.*?)\],?$/gm)) tabs[m[1]] = [...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1]);
const slug = (s) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const routes = Object.entries({ overview: '/overview', missions: '/missions/M-126', agentProfile: '/agents/coder-01', jobSearch: '/plugins/job-search', results: '/results', notifications: '/notifications', settings: '/settings', operations: '/operations', help: '/help' });
const only = process.env.ONLY;
const b = await chromium.launch({ executablePath: process.env.PW_CHROME || '/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome' });
const ctx = await b.newContext({ viewport: { width: +w, height: +h } });
await signIn(ctx);
await ctx.addInitScript(() => { localStorage.setItem('axion.settings.v1', JSON.stringify({ state: { themeMode: 'dark', skin: 'luminous', motion: 'reduced' }, version: 0 })); });
const p = await ctx.newPage();
// self-test hook (c82): FIT_SLOW='<url glob>=<ms>' delays matching requests, to prove the wait below is a condition and not a fixed 600 ms
if (process.env.FIT_SLOW) { const [glob, ms] = process.env.FIT_SLOW.split('='); await ctx.route(glob, async (r) => { await new Promise((x) => setTimeout(x, +ms)); await r.continue(); }); }
/** c82 (H22): the route has rendered when main holds a visible page-frame body (.fit-scroll / .fit-fill); bounded, never a sleep. */
const rendered = (page) => page.waitForFunction(() => { const m = document.querySelector('main'); return !!m && [...m.querySelectorAll('.fit-scroll, .fit-fill')].some((e) => e.offsetParent && e.clientHeight > 0); }, null, { timeout: +(process.env.FIT_RENDER_TIMEOUT || 10000) }).then(() => true, () => false);
let bad = 0;
for (const [key, path] of routes) {
  if (only && !only.split(',').includes(key)) continue;
  // System Operations embeds Agents and Models: check their sub-tabs too (owner update u1)
  const views = (tabs[key] ?? ['']).flatMap((t) => (key === 'operations' && (t === 'Agents' || t === 'Models') ? tabs[t.toLowerCase()].map((x) => [t, x]) : [[t, '']]));
  if (key === 'operations') views.push(['Agents', 'Dimensions', 'process']); // c69: the Process view of the Dimensions tab
  for (const [t, sb, vw] of views) {
    const cur = `${path}?tab=${slug(t)}${sb ? `&sub=${slug(sb)}` : ''}${vw ? `&view=${vw}` : ''}`;
    await p.goto(base + cur, { waitUntil: process.env.FIT_NAV || navWait() }); await settle(p);
    if (!(await rendered(p))) { bad++; console.log('FAIL ' + cur.padEnd(44), 'not rendered: main has no visible .fit-scroll/.fit-fill after the wait (not a fit verdict)'); continue; }
    await calm(p); // every finite animation has finished and two frames have painted (capped at 3 s)
    const r = await p.evaluate(() => {
      const m = document.querySelector('main'); const mr = m.getBoundingClientRect();
      const s = [...document.querySelectorAll('.fit-scroll')].filter((e) => e.offsetParent);
      const pg = document.querySelector('.page')?.getBoundingClientRect();
      return { over: m.scrollHeight - m.clientHeight, regions: s.map((e) => [Math.round(e.clientHeight), e.scrollHeight - e.clientHeight]), pageBottomGap: pg ? Math.round(mr.bottom - pg.bottom) : null };
    });
    const ok = r.over <= 2 && r.regions.length > 0 && r.regions.every(([ch]) => ch >= 200);
    if (!ok) bad++;
    console.log((ok ? 'ok  ' : 'BAD ') + cur.padEnd(44), 'mainOver', r.over, 'regions', JSON.stringify(r.regions), 'gap', r.pageBottomGap);
    if (shots) await p.screenshot({ path: `${shots}/${key}-${slug(t) || 'main'}.png` });
  }
}
console.log(bad ? `${bad} view(s) need work` : 'ALL FIT');
await b.close();
process.exit(bad ? 1 : 0);
