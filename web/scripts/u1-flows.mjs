// Flows for the 2026-11-20 u1 owner update: rail, search everything, chat dock, job sites, news, mission sharing.
// Usage: node scripts/u1-flows.mjs   (needs the dev server; BASE=... for preview)
import { chromium } from 'playwright';
import { signIn } from './_session.mjs';
import { resolveBase } from './_base.mjs';
const base = resolveBase();
const b = await chromium.launch({ executablePath: process.env.PW_CHROME || '/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome' });
const ctx = await b.newContext({ viewport: { width: 1672, height: 941 } });
await signIn(ctx);
await ctx.addInitScript(() => localStorage.setItem('axion.settings.v1', JSON.stringify({ state: { motion: 'reduced' }, version: 0 })));
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
const results = [];
async function step(name, fn) {
  try { await fn(); results.push(`PASS  ${name}`); } catch (e) { results.push(`FAIL  ${name}: ${String(e.message ?? e).split('\n')[0]}`); }
}
const expect = (ok, msg) => { if (!ok) throw new Error(msg); };

await step('Rail: top shows Missions/Notifications/Settings only, Job Search in plug-ins', async () => {
  await p.goto(base + '/missions', { waitUntil: 'networkidle' });
  const top = await p.locator('.rail-top .nav-label').allInnerTexts();
  expect(JSON.stringify(top) === JSON.stringify(['Missions', 'Notifications', 'Settings']), `top = ${top}`);
  expect((await p.locator('.rail-plugins .nav-label').allInnerTexts()).includes('Job Search'), 'Job Search missing');
});

await step('Settings › Navigation: showing Overview adds it to the rail; hiding Job Search removes it', async () => {
  await p.goto(base + '/settings?tab=navigation', { waitUntil: 'networkidle' });
  await p.getByRole('switch', { name: 'Show Overview in the rail' }).click();
  await p.getByRole('switch', { name: 'Show Job Search in the rail' }).click();
  await p.waitForTimeout(300);
  expect((await p.locator('.rail-top .nav-label').allInnerTexts()).includes('Overview'), 'Overview not shown');
  expect(!(await p.locator('.rail-plugins .nav-label').allInnerTexts()).includes('Job Search'), 'Job Search still shown');
  await p.getByRole('button', { name: 'Defaults' }).click();
});

await step('Search everything: VMs, job sites, agents by duty, help, models', async () => {
  for (const [q, group] of [['vm-gpu', 'VMs'], ['upwork', 'Job Search'], ['mobile app development', 'Agents'], ['lineage', 'Help'], ['sonnet', 'Models'], ['competitor', 'Missions']]) {
    await p.keyboard.press('Control+k');
    await p.locator('.palette-input').fill(q);
    await p.waitForTimeout(150);
    const groups = await p.locator('.palette-group').allInnerTexts();
    expect(groups.map((g) => g.toLowerCase()).includes(group.toLowerCase()), `"${q}" → ${groups.join(', ')}`);
    await p.keyboard.press('Escape');
  }
});

await step('Chat dock: message the GM → GM replies', async () => {
  await p.getByRole('button', { name: /^Chat with the General Manager/ }).click();
  await p.locator('.chat-dock textarea').fill('What needs my decision?');
  await p.keyboard.press('Enter');
  await p.waitForFunction(() => [...document.querySelectorAll('.chat-dock .bubble-meta b')].filter((b) => b.textContent === 'GM').length >= 2, null, { timeout: 8000 });
  await p.getByRole('button', { name: 'Close chat' }).click();
});

await step('Job Search: add a site URL → it is listed and investigated', async () => {
  await p.goto(base + '/plugins/job-search', { waitUntil: 'networkidle' });
  await p.getByLabel('Job site URL').fill('remoteok.com');
  await p.keyboard.press('Enter');
  await p.locator('.js-site', { hasText: 'remoteok.com' }).waitFor({ timeout: 5000 });
  await p.waitForFunction(() => document.querySelector('.js-url')?.textContent?.includes('remoteok.com'), null, { timeout: 5000 });
});

await step('News: add a news item → it appears first', async () => {
  await p.goto(base + '/notifications?tab=news', { waitUntil: 'networkidle' });
  await p.getByRole('button', { name: 'Add news' }).click();
  await p.locator('[role="dialog"] input').first().fill('E2E news headline');
  await p.locator('[role="dialog"] textarea').fill('Body of the news.');
  await p.getByRole('button', { name: 'Post' }).click();
  await p.locator('.news-title', { hasText: 'E2E news headline' }).waitFor({ timeout: 5000 });
});

await step('Mission share toggle flips private ↔ shared', async () => {
  await p.goto(base + '/missions/M-127', { waitUntil: 'networkidle' });
  const btn = p.locator('.mw-header .mw-share').first();
  const before = await btn.getAttribute('aria-pressed');
  await btn.click();
  await p.waitForTimeout(300);
  expect((await btn.getAttribute('aria-pressed')) !== before, 'share state did not change');
});

await step('Old links redirect: /agents, /models, /browser, /users', async () => {
  for (const [from, to] of [['/agents?tab=development', /operations\?.*tab=agents.*sub=development/], ['/models', /operations\?.*tab=models/], ['/browser', /plugins\/job-search/], ['/users', /settings\?tab=users/]]) {
    await p.goto(base + from, { waitUntil: 'networkidle' });
    expect(to.test(p.url()), `${from} → ${p.url()}`);
  }
});

console.log(results.join('\n'));
console.log(errors.length ? 'ERRORS\n' + errors.join('\n') : 'no console errors');
await b.close();
// exit code: non-zero when any check failed or the page logged an error
process.exit(results.some((r) => r.startsWith('FAIL')) || errors.length ? 1 : 0);
