// Cycle 23: screenshots of failed-load states (api mode, mocked 500) for a before/after pixel comparison. OUT=<dir>
import { chromium } from 'playwright';
import { signIn, navWait, settle } from './_session.mjs';
const base = process.env.BASE; const out = process.env.OUT || '/tmp/c23-shots';
const b = await chromium.launch({ executablePath: process.env.PW_CHROME || '/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome' });
const ctx = await b.newContext({ viewport: { width: 1672, height: 941 } });
await signIn(ctx);
await ctx.addInitScript(() => { try { localStorage.setItem('axion.settings.v1', JSON.stringify({ state: { motion: 'reduced' }, version: 0 })); } catch { /* ignore */ } });
const p = await ctx.newPage();
await p.route(/\/api\/v1\/(.*instances|.*proposals|company\/scorecard)/, (r) => r.request().method() !== 'GET' ? r.continue() : r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'internal', message: 'mocked failure' } }) }));
for (const [n, v] of [['overview', '/overview'], ['instances', '/operations?tab=agents&sub=live-instances'], ['proposals', '/operations?tab=agents&sub=proposals']]) {
  await p.goto(base + v, { waitUntil: navWait() }); await settle(p, 1500);
  await p.screenshot({ path: `${out}/${n}.png` });
}
await b.close();
