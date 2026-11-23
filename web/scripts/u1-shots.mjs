// Screenshots of the 2026-11-20 u1 screens, including states that need interaction (dialogs, staffing).
// Usage: node scripts/u1-shots.mjs <outDir> [theme]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { signIn } from './_session.mjs';
const [, , out = 'u1-shots', theme = 'dark'] = process.argv;
mkdirSync(out, { recursive: true });
import { resolveBase } from './_base.mjs';
const base = resolveBase();
const b = await chromium.launch({ executablePath: process.env.PW_CHROME || '/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome' });
const ctx = await b.newContext({ viewport: { width: 1672, height: 941 } });
await signIn(ctx);
await ctx.addInitScript((t) => localStorage.setItem('axion.settings.v1', JSON.stringify({ state: { themeMode: t, skin: 'luminous', motion: 'full' }, version: 0 })), theme);
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
const only = (process.env.ONLY || '').split(',').filter(Boolean);
const extras = (process.env.PATHS || '').split(',').filter(Boolean);
const want = (k) => !only.length || only.includes(k) || extras.some((e) => e.replace(/[^a-z0-9]+/gi, '_') === k);
async function shot(name, path, before) {
  if (!want(name)) return;
  if (path) await p.goto(base + path, { waitUntil: 'networkidle' });
  if (before) await before();
  await p.waitForTimeout(+(process.env.WAIT || 1200));
  await p.screenshot({ path: `${out}/${name}.png` });
}
await shot('add-mission', '/missions', async () => {
  await p.getByRole('button', { name: 'Add mission' }).first().click();
  await p.locator('[data-dialog="DL-01"] textarea').fill('Research our three main competitors and write a short report with sources. Use the attached screenshot and notes.');
  await p.locator('[data-dialog="DL-01"] input[type=file]').setInputFiles([
    { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('Competitors:\n- Acme: pricing page changed\n- Globex: new API\n- Initech: mobile app') },
    { name: 'brief.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') },
    { name: 'call.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('ID3') },
  ]);
});
await shot('staffing', null, async () => {
  if (!want('add-mission')) return;
  await p.locator('[data-dialog="DL-01"] button', { hasText: 'Add mission' }).click();
  await p.waitForTimeout(5200);
});
await shot('activity', '/missions/M-126?tab=activity');
await shot('chat-dock', '/missions/M-126', async () => {
  await p.getByRole('button', { name: /^Chat with the General Manager/ }).click();
  await p.locator('.chat-dock textarea').fill('How is the portal mission going?');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(3200);
});
await shot('agent-chat', '/agents/coder-01?tab=conversations', async () => {
  await p.getByRole('radio', { name: 'Task' }).first().click();
  await p.locator('.ap-direct textarea').fill('Add a dark-mode toggle test to the portal suite.');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(3000);
});
for (const extra of (process.env.PATHS || '').split(',').filter(Boolean)) await shot(extra.replace(/[^a-z0-9]+/gi, '_'), extra);
console.log(errors.length ? errors.join('\n') : 'no errors');
await b.close();
