// Desktop fit-to-screen check: every route × tab must fill exactly one screen (no .main scroll),
// with a visible .fit-scroll region of reasonable height. Usage: node scripts/fit-check.mjs [w] [h] [shotDir]
import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';
const [, , w = '1672', h = '941', shots = ''] = process.argv;
const base = process.env.BASE || 'http://127.0.0.1:5190';
if (shots) mkdirSync(shots, { recursive: true });
const nav = readFileSync(new URL('../src/config/nav.ts', import.meta.url), 'utf8');
const tabs = {};
for (const m of nav.slice(nav.indexOf('ROUTE_TABS')).matchAll(/^\s+(\w+): \[(.*?)\],?$/gm)) tabs[m[1]] = [...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1]);
const slug = (s) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const routes = Object.entries({ overview: '/overview', missions: '/missions/M-126', agents: '/agents', agentProfile: '/agents/coder-01', browser: '/browser', results: '/results', knowledge: '/knowledge', evolution: '/evolution', models: '/models', users: '/users', governance: '/governance', usage: '/usage', notifications: '/notifications', settings: '/settings', operations: '/operations', help: '/help' });
const only = process.env.ONLY;
const b = await chromium.launch({ executablePath: process.env.PW_CHROME || '/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome' });
const ctx = await b.newContext({ viewport: { width: +w, height: +h } });
await ctx.addInitScript(() => { localStorage.setItem('axion.settings.v1', JSON.stringify({ state: { themeMode: 'dark', skin: 'luminous', motion: 'reduced' }, version: 0 })); });
const p = await ctx.newPage();
let bad = 0;
for (const [key, path] of routes) {
  if (only && !only.split(',').includes(key)) continue;
  for (const t of tabs[key] ?? ['']) {
    const cur = `${path}?tab=${slug(t)}`;
    await p.goto(base + cur, { waitUntil: 'networkidle' });
    await p.waitForTimeout(600);
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
