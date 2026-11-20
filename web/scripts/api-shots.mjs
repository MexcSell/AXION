// Stage 5 screenshots (api mode, e2e stack): Connect, waiting, Missions live, Operations › AXION server — dark and light.
// Run: ./scripts/api-e2e.sh api-shots.mjs   → docs/screenshots/stage5-*.png
import { chromium } from 'playwright';
const base = process.env.BASE || 'http://127.0.0.1:5193';
const out = new URL('../docs/screenshots/', import.meta.url).pathname;
const b = await chromium.launch({ executablePath: process.env.PW_CHROME || '/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome' });
const until = async (f, ms = 12000) => { const t0 = Date.now(); for (;;) { try { if (await f()) return true; } catch { /* retry */ } if (Date.now() - t0 > ms) return false; await new Promise((r) => setTimeout(r, 150)); } };
const page = async (theme) => {
  const ctx = await b.newContext({ viewport: { width: 1600, height: 940 } });
  await ctx.addInitScript((t) => { try { localStorage.setItem('axion.data-mode', 'api'); if (!sessionStorage.getItem('themed')) { localStorage.setItem('axion.settings.v1', JSON.stringify({ state: { themeMode: t, motion: 'reduced' }, version: 0 })); sessionStorage.setItem('themed', '1'); } } catch { /* ignore */ } }, theme);
  return ctx.newPage();
};
const setTheme = async (p, t) => { await p.evaluate((t) => { const k = 'axion.settings.v1'; const v = JSON.parse(localStorage.getItem(k) || '{"state":{},"version":0}'); v.state.themeMode = t; localStorage.setItem(k, JSON.stringify(v)); }, t); await p.reload({ waitUntil: 'domcontentloaded' }); };
const connect = async (p, name, pass) => {
  await p.getByRole('heading', { name: 'Connect' }).waitFor({ timeout: 15000 });
  await p.getByLabel('Name').fill(name); await p.getByLabel('Password', { exact: true }).fill(pass);
  await p.getByRole('button', { name: /Connect/ }).click();
};
const shots = [];
const shot = async (p, name) => { await p.waitForTimeout(700); await p.screenshot({ path: out + `stage5-${name}.png` }); shots.push(name); };

const A = await page('dark');
await A.goto(base + '/missions', { waitUntil: 'domcontentloaded' });
await A.getByRole('heading', { name: 'Connect' }).waitFor({ timeout: 15000 });
await shot(A, 'connect-dark');
await connect(A, 'Luca', 'secret-1');
await A.waitForSelector('.rail-nav', { timeout: 15000 });

for (const theme of ['dark', 'light']) {
  const B = await page(theme);
  await B.goto(base + '/missions', { waitUntil: 'domcontentloaded' });
  if (theme === 'light') await shot(B, 'connect-light');
  await connect(B, theme === 'dark' ? 'Mina' : 'Kenji', 'pass-1234');
  await B.getByRole('heading', { name: 'Waiting for approval' }).waitFor({ timeout: 10000 });
  await shot(B, `waiting-${theme}`);
  if (theme === 'light') await setTheme(A, 'light');
  await A.goto(base + '/missions/M-126', { waitUntil: 'domcontentloaded' });
  await until(async () => (await A.locator('.conn-badge[data-conn="live"]').count()) > 0 && (await A.locator('.mission-row').count()) > 5);
  await shot(A, `missions-live-${theme}`);
  await A.goto(base + '/operations?tab=services', { waitUntil: 'domcontentloaded' });
  await until(async () => (await A.locator('[data-testid="server-health"]').count()) > 0);
  await shot(A, `ops-health-${theme}`);
  await A.goto(base + '/settings?tab=users', { waitUntil: 'domcontentloaded' });
  await until(async () => (await A.locator('.us-req').count()) > 0);
  await shot(A, `users-approvals-${theme}`);
}
console.log('shots:', shots.join(', '));
await b.close();
