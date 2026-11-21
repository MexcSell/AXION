// Before/after screenshots for cycle 7: Missions, Agents, and a ? help popover. Usage: node scripts/shot-c07.mjs <prefix>  (BASE env)
import { chromium } from 'playwright';
import { signIn } from './_session.mjs';
const prefix = process.argv[2];
const base = process.env.BASE;
const b = await chromium.launch({ executablePath: process.env.CHROME });
const ctx = await b.newContext({ viewport: { width: 1672, height: 941 } });
await signIn(ctx);
await ctx.addInitScript(() => localStorage.setItem('axion.settings.v1', JSON.stringify({ state: { themeMode: 'dark', skin: 'luminous', motion: 'subtle', particles: false, graphics: 'page' }, version: 0 })));
const p = await ctx.newPage();
for (const [name, path] of [['missions', '/missions'], ['agents', '/agents']]) { await p.goto(base + path, { waitUntil: 'networkidle' }); await p.waitForTimeout(2500); await p.screenshot({ path: `${prefix}-${name}.png` }); }
await p.goto(base + '/missions', { waitUntil: 'networkidle' }); await p.waitForTimeout(2500);
await p.waitForSelector('.help-btn', { timeout: 20000 }); await p.locator('.help-btn').first().click(); await p.waitForTimeout(900);
await p.screenshot({ path: `${prefix}-help.png` });
await b.close();
