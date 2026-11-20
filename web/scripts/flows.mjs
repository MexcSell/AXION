// End-to-end interaction checks for the core owner flows (DEMO data, no backend).
// Usage: BASE=http://127.0.0.1:5190 node scripts/flows.mjs
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
const base = process.env.BASE || 'http://127.0.0.1:5190';
const b = await chromium.launch({ executablePath: process.env.PW_CHROME || '/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome' });
const ctx = await b.newContext({ viewport: { width: 1672, height: 941 } }); // fresh context = fresh DEMO data
await ctx.addInitScript(() => localStorage.setItem('axion.settings.v1', JSON.stringify({ state: { themeMode: 'dark', skin: 'luminous', motion: 'reduced' }, version: 0 })));
const p = await ctx.newPage(); await p.addInitScript(() => localStorage.setItem('axion.testhook', '1'));
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const results = [];
const step = async (name, fn) => {
  try { await fn(); results.push(`PASS  ${name}`); } catch (e) { results.push(`FAIL  ${name}: ${String(e.message).split('\n')[0]}`); }
};
const expect = async (cond, msg) => { if (!(await cond)) throw new Error(msg); };

await p.goto(base + '/missions', { waitUntil: 'networkidle' });
await p.waitForTimeout(800);

await step('Mission row anatomy: edit beside title, delete at far right, status + AI summary', async () => {
  const row = p.locator('.mission-row').first();
  const t = await row.locator('.mission-title').boundingBox();
  const e = await row.locator('.edit-btn').boundingBox();
  const d = await row.locator('.del-btn').boundingBox();
  const r = await row.boundingBox();
  await expect(e.x > t.x + t.width - 2 && e.x - (t.x + t.width) < 30, 'edit icon not beside title');
  await expect(r.x + r.width - (d.x + d.width) < 20, 'delete icon not at far right');
  await expect(row.locator('.mission-status-line').count(), 'no status line');
  await expect(row.locator('.mission-summary').count(), 'no AI summary');
});

await step('Create mission via 4-step wizard (validation blocks empty goal)', async () => {
  await p.getByRole('button', { name: 'Add Mission' }).first().click();
  await p.waitForSelector('[data-dialog="DL-01"]');
  await p.getByRole('button', { name: 'Next' }).click();
  await expect(p.locator('.field-error').count(), 'validation error not shown');
  await p.locator('[data-dialog="DL-01"] input.input').first().fill('E2E: refresh pricing page');
  await p.locator('[data-dialog="DL-01"] textarea').first().fill('Update the pricing page with the new plans and verify the layout.');
  await p.locator('[data-dialog="DL-01"] input[aria-label="Criterion 1"]').fill('Pricing page preview approved by Owner');
  for (let i = 0; i < 3; i++) await p.getByRole('button', { name: 'Next' }).click();
  await p.getByRole('button', { name: 'Create & Start' }).click();
  await p.waitForTimeout(600);
  await expect(p.locator('.mission-row', { hasText: 'E2E: refresh pricing page' }).count(), 'new mission not in list');
});

await step('Edit mission beside title creates a revision', async () => {
  const row = p.locator('.mission-row', { hasText: 'E2E: refresh pricing page' });
  await row.hover(); await row.locator('.edit-btn').click();
  await p.waitForSelector('[data-dialog="DL-02"]');
  await p.locator('[data-dialog="DL-02"] input.input').first().fill('E2E: refresh pricing page v2');
  await p.getByRole('button', { name: 'Save Revision' }).click();
  await p.waitForTimeout(500);
  await expect(p.locator('.mission-row', { hasText: 'pricing page v2' }).count(), 'title not updated');
});

await step('Delete (archive) from the far-right trash icon', async () => {
  const row = p.locator('.mission-row', { hasText: 'pricing page v2' });
  await row.hover(); await row.locator('.del-btn').click();
  await p.waitForSelector('[data-dialog="DL-03"]');
  await p.locator('[data-dialog="DL-03"] .modal-foot .btn.danger').click();
  await p.waitForTimeout(600);
  await expect((await p.locator('.mission-row', { hasText: 'pricing page v2' }).count()) === 0, 'still in All tab after archive');
  await p.goto(base + '/missions?tab=archived', { waitUntil: 'networkidle' });
  await expect(p.locator('.mission-row', { hasText: 'pricing page v2' }).count(), 'not in Archived');
});

await step('Approve a pending decision updates the governance badge', async () => {
  await p.goto(base + '/control/M-126?tab=approvals', { waitUntil: 'networkidle' });
  const badge = async () => Number((await p.locator('.nav-item', { hasText: 'Governance' }).locator('.badge').textContent().catch(() => '0')) || 0);
  const before = await badge();
  await p.getByRole('button', { name: 'Approve once' }).first().click();
  await p.waitForTimeout(500);
  await expect((await badge()) === before - 1, `badge ${before} -> ${await badge()}`);
});

await step('Hierarchy: click agent → inspector shows its counterparts', async () => {
  await p.goto(base + '/control/M-126?tab=hierarchy', { waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  await p.locator('.hnode', { hasText: 'Tester-01' }).click();
  await p.waitForTimeout(500);
  await expect(p.locator('.mc-inspector .msg-head', { hasText: 'Tester-01' }).count(), 'inspector did not switch');
  await expect(p.locator('.mc-inspector .cp-item', { hasText: 'Superior' }).count(), 'superior counterpart missing');
});

await step('Conversation: send command with image → ack → report upward', async () => {
  await p.goto(base + '/control/M-126?tab=conversations&agent=coder-01', { waitUntil: 'networkidle' });
  writeFileSync('/tmp/claude-0/-home-luca-AXION/a648e987-ffdb-49cc-888b-0956d510792d/scratchpad/e2e.png', Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360f8cfc0f01f0005000201f4a1d10d0000000049454e44ae426082', 'hex'));
  await p.locator('.composer input[type=file][accept="image/*"]').setInputFiles('/tmp/claude-0/-home-luca-AXION/a648e987-ffdb-49cc-888b-0956d510792d/scratchpad/e2e.png');
  await p.locator('.composer textarea').fill('E2E: re-run checkout visual diff');
  await p.keyboard.press('Control+Enter');
  await p.waitForTimeout(3000);
  await expect(p.locator('.bubble.k-ack').last().isVisible(), 'no ack');
  await expect(p.locator('.bubble-row.human .att img').count(), 'image attachment not shown');
  await p.waitForTimeout(4600);
  await expect(p.locator('.bubble.k-report', { hasText: 'E2E: re-run checkout visual diff' }).count(), 'no upward report');
});

await step('Command palette navigates (Ctrl+K)', async () => {
  await p.keyboard.press('Control+k');
  await p.locator('.palette-input').fill('evolution lab');
  await p.keyboard.press('Enter');
  await p.waitForURL(/\/evolution/);
});

await step('Theme toggle switches html data-theme', async () => {
  const before = await p.evaluate(() => document.documentElement.dataset.theme);
  await p.locator('.top-actions button[aria-label^="Theme"]').click();
  await p.waitForTimeout(300);
  const after = await p.evaluate(() => document.documentElement.dataset.theme);
  await expect(before !== after, `${before} -> ${after}`);
});

await step('Help "?" opens a popover with content, Escape closes', async () => {
  await p.goto(base + '/agents', { waitUntil: 'networkidle' });
  await p.locator('.help-btn').first().click();
  await expect(p.locator('.help-pop').isVisible(), 'no popover');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(250);
  await expect((await p.locator('.help-pop').count()) === 0, 'popover still open');
});

await step('Modal focus trap + Escape returns focus', async () => {
  await p.getByRole('button', { name: 'New Agent' }).click();
  await p.waitForSelector('[aria-modal=true]');
  for (let i = 0; i < 30; i++) await p.keyboard.press('Tab');
  await expect(p.evaluate(() => !!document.activeElement?.closest('[aria-modal=true]')), 'focus escaped dialog');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(400);
  await expect((await p.locator('[aria-modal=true]').count()) === 0, 'dialog not closed');
});

await step('Help popover inside a dialog: Tab stays in popover, Esc closes popover then dialog', async () => {
  await p.evaluate(() => window.__axion.openDialog('mission-edit', { missionId: 'M-126' }));
  await p.waitForSelector('[aria-modal=true]'); await p.waitForTimeout(400);
  await p.locator('[aria-modal=true] .help-btn').first().click(); await p.waitForTimeout(300);
  await p.keyboard.press('Tab'); await p.waitForTimeout(100);
  await expect(p.evaluate(() => !!document.activeElement.closest('[data-radix-popper-content-wrapper]')), 'Tab left the popover');
  await p.keyboard.press('Escape'); await p.waitForTimeout(400);
  await expect((await p.locator('.help-pop').count()) === 0 && (await p.locator('[aria-modal=true]').count()) === 1, 'first Escape should close only the popover');
  await p.keyboard.press('Escape'); await p.waitForTimeout(500);
  await expect((await p.locator('[aria-modal=true]').count()) === 0, 'second Escape should close the dialog');
});

console.log(results.join('\n'));
console.log(errors.length ? 'CONSOLE ERRORS:\n' + errors.join('\n') : 'no console errors');
await b.close();
