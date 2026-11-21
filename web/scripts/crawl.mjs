// Visits every route × tab, records console/page errors, screenshots each.
// Usage: node scripts/crawl.mjs [outDir] [theme] [skin] [width] [height]
import { chromium } from 'playwright';
import { signIn, navWait, settle } from './_session.mjs';
import { mkdirSync, readFileSync } from 'node:fs';
const [, , out = 'crawl', theme = 'dark', skin = 'luminous', w = '1672', h = '941'] = process.argv;
const base = process.env.BASE || 'http://127.0.0.1:5190';
mkdirSync(out, { recursive: true });
const nav = readFileSync(new URL('../src/config/nav.ts', import.meta.url), 'utf8');
const tabsBlock = nav.slice(nav.indexOf('ROUTE_TABS'));
const tabs = {};
for (const m of tabsBlock.matchAll(/^\s+(\w+): \[(.*?)\],?$/gm)) tabs[m[1]] = [...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1]);
const slug = (s) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const routes = Object.entries({ overview: '/overview', missions: '/missions/M-126', agentProfile: '/agents/coder-01', jobSearch: '/plugins/job-search', results: '/results', notifications: '/notifications', settings: '/settings', operations: '/operations', help: '/help' });
const b = await chromium.launch({ executablePath: process.env.PW_CHROME || '/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome' });
const ctx = await b.newContext({ viewport: { width: +w, height: +h } });
await signIn(ctx);
await ctx.addInitScript(([theme, skin]) => { localStorage.setItem('axion.settings.v1', JSON.stringify({ state: { themeMode: theme, skin, motion: 'reduced' }, version: 0 })); }, [theme, skin]);
const p = await ctx.newPage();
let cur = '';
const problems = [];
p.on('pageerror', (e) => problems.push(`${cur} PAGEERROR ${e.message}`));
p.on('console', (m) => { if (m.type() === 'error' || (m.type() === 'warning' && /Unknown dialog/.test(m.text()))) problems.push(`${cur} ${m.type().toUpperCase()} ${m.text().slice(0, 200)}`); });
let n = 0;
for (const [key, path] of routes) {
  // System Operations embeds Agents and Models: crawl their sub-tabs too (?sub=, owner update u1)
  const views = (tabs[key] ?? ['']).flatMap((t) => (key === 'operations' && (t === 'Agents' || t === 'Models') ? tabs[t.toLowerCase()].map((s) => [t, s]) : [[t, '']]));
  for (const [t, sb] of views) {
    cur = `${path}?tab=${slug(t)}${sb ? `&sub=${slug(sb)}` : ''}`;
    await p.goto(base + cur, { waitUntil: navWait() }); await settle(p);
    await p.waitForTimeout(500);
    const empty = await p.evaluate(() => (document.querySelector('main')?.innerText ?? '').trim().length);
    if (empty < 40) problems.push(`${cur} EMPTY main content (${empty} chars)`);
    if (await p.locator('text=under construction').count()) problems.push(`${cur} PLACEHOLDER`);
    await p.screenshot({ path: `${out}/${key}-${slug(t) || 'main'}${sb ? '-' + slug(sb) : ''}.png` });
    n++;
  }
}
console.log(`visited ${n} route/tab views`);
console.log(problems.length ? problems.join('\n') : 'NO PROBLEMS');
await b.close();
process.exit(problems.length ? 1 : 0);
