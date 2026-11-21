// First-load JS for a route (gzip). Usage: node scripts/first-load.mjs [base] ; env ROUTE=/missions, CHROME=<path>
// Method: sign in, then load ROUTE fresh and record every JavaScript response until the page is mounted and not busy
// (before the idle preloader runs). Sizes are the gzip of the served file. Also prints the static set from dist/index.html.
import { chromium } from 'playwright';
import { gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { signIn } from './_session.mjs';
const BASE = process.argv[2] || process.env.BASE || 'http://127.0.0.1:5591';
const ROUTE = process.env.ROUTE || '/missions';
const gz = (b) => gzipSync(b).length;
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
await signIn(ctx);
const page = await ctx.newPage();
const seen = new Map(); let recording = false;
page.on('response', async (r) => { if (!recording) return; const u = new URL(r.url()); if (!/\.js$/.test(u.pathname)) return; try { seen.set(u.pathname, gz(await r.body())); } catch { /* ignore */ } });
recording = true;
await page.goto(BASE + ROUTE, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => { const v = document.querySelector('.route-view'); return v && v.firstElementChild && !v.querySelector('[aria-busy="true"]'); }, null, { timeout: 20000 });
await page.waitForTimeout(300); recording = false;
await page.waitForTimeout(200);
let total = 0; for (const [p, s] of [...seen].sort((a, b) => b[1] - a[1])) { console.log(String(s).padStart(8), p); total += s; }
console.log('NETWORK first-load JS gzip bytes:', total, `(${(total / 1024).toFixed(1)} kB, ${seen.size} files)`);
try {
  const html = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
  const files = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.js)"/g)].map((m) => m[1]);
  let t = 0; for (const f of files) t += gz(readFileSync(new URL('../dist' + f, import.meta.url)));
  console.log('STATIC (index.html entry + modulepreload) gzip bytes:', t, `(${(t / 1024).toFixed(1)} kB, ${files.length} files)`);
} catch (e) { console.log('static: n/a', e.message); }
await browser.close();
