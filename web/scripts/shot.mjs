// Usage: node scripts/shot.mjs <path> <out.png> [width] [height] [theme] [skin] [fullPage]
import { chromium } from 'playwright';
import { signIn } from './_session.mjs';
const [, , path = '/missions', out = 'shot.png', w = '1672', h = '941', theme = 'dark', skin = 'luminous', full = ''] = process.argv;
const base = process.env.BASE || 'http://127.0.0.1:5190';
const b = await chromium.launch({ executablePath: process.env.PW_CHROME || '/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome' });
const ctx = await b.newContext({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
await signIn(ctx);
await ctx.addInitScript(([theme, skin]) => {
  localStorage.setItem('axion.settings.v1', JSON.stringify({ state: { themeMode: theme, skin, motion: 'full', density: 'comfortable', textScale: 'md', highContrast: false, accent: 'default', railCollapsed: false, particles: true, language: 'en', timezone: 'UTC', companyName: 'AXION AI Company', avatar: { faceMode: 'emblem', eyes: 'round', expression: 'happy', antenna: true, outline: true, glow: 0.8, hueShift: 0 } }, version: 0 }));
}, [theme, skin]);
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
p.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await p.goto(base + path, { waitUntil: 'networkidle' });
await p.waitForTimeout(+(process.env.WAIT || 1800));
await p.screenshot({ path: out, fullPage: !!full });
if (errors.length) console.log(errors.join('\n'));
await b.close();
