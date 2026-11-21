// End-to-end interaction checks for the core owner flows (DEMO data, no backend).
// Usage: BASE=http://127.0.0.1:5190 node scripts/flows.mjs
import { chromium } from 'playwright';
import { signIn } from './_session.mjs';
import { writeFileSync } from 'node:fs';
const base = process.env.BASE || 'http://127.0.0.1:5190';
const b = await chromium.launch({ executablePath: process.env.PW_CHROME || '/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome' });
const ctx = await b.newContext({ viewport: { width: 1672, height: 941 } }); // fresh context = fresh DEMO data
await signIn(ctx);
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

await step('Add mission: content only (text + file) → GM appoints executor → agents join', async () => {
  await p.getByRole('button', { name: 'Add Mission' }).first().click().catch(() => p.getByRole('button', { name: 'Add mission' }).first().click());
  await p.waitForSelector('[data-dialog="DL-01"]');
  await expect(await p.locator('[data-dialog="DL-01"] button', { hasText: 'Add mission' }).isDisabled(), 'empty content must not be addable');
  await p.locator('[data-dialog="DL-01"] textarea').first().fill('E2E: refresh pricing page. Research the three plans and update the website page.');
  await p.locator('[data-dialog="DL-01"] input[type=file]').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('Plan A 9 / Plan B 19') });
  await p.waitForSelector('[data-dialog="DL-01"] .ma-file');
  await p.locator('[data-dialog="DL-01"] button', { hasText: 'Add mission' }).click();
  await p.waitForTimeout(900);
  await expect(p.locator('.mission-row', { hasText: 'E2E: refresh pricing page' }).count(), 'new mission not in list');
  await p.waitForSelector('.stf', { timeout: 5000 });
  await p.waitForFunction(() => document.querySelectorAll('.stf-mini:not(.ghost)').length >= 1, null, { timeout: 12000 });
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
  // the open mission stays visible but pinned (outside the filter); any other archived row disappears
  const left = p.locator('.mission-row', { hasText: 'pricing page v2' });
  await expect((await left.count()) === 0 || (await left.locator('.mw-pin').count()) === 1, 'still in All tab after archive (and not pinned)');
  await p.goto(base + '/missions?filter=archived', { waitUntil: 'networkidle' });
  await expect(p.locator('.mission-row', { hasText: 'pricing page v2' }).count(), 'not in Archived');
});

await step('Approve a pending decision updates the approvals count', async () => {
  await p.goto(base + '/missions/M-126?tab=approvals', { waitUntil: 'networkidle' });
  // Governance was removed (owner update u1); the bell's label carries the pending-approvals count.
  const badge = async () => Number(((await p.locator('.top-actions button[aria-label^="Notifications"]').getAttribute('aria-label')) ?? '').match(/(\d+) approvals/)?.[1] ?? 0);
  const before = await badge();
  await p.getByRole('button', { name: 'Approve once' }).first().click();
  await p.waitForTimeout(500);
  await expect((await badge()) === before - 1, `badge ${before} -> ${await badge()}`);
});

await step('Hierarchy: click agent → conversation pane beside the graph shows its counterparts', async () => {
  await p.goto(base + '/missions/M-126?tab=hierarchy', { waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  await p.locator('.hnode', { hasText: 'Tester-01' }).click();
  await p.waitForTimeout(500);
  await expect(p.locator('.hier-conv .msg-head', { hasText: 'Tester-01' }).count(), 'hierarchy conversation pane did not switch');
  await expect(p.locator('.hier-conv .cp-item', { hasText: 'Superior' }).count(), 'superior counterpart missing');
  await expect((await p.locator('.modal, [role=dialog]').count()) === 0, 'a conversation drawer opened on node click');
});

await step('Missions: no team tree under the mission, no page-wide conversation pane', async () => {
  await p.goto(base + '/missions/M-126?tab=overview', { waitUntil: 'networkidle' });
  await p.waitForTimeout(600);
  await expect((await p.locator('.mw-list .team-row').count()) === 0, 'agents still unfold below the mission');
  await expect((await p.locator('.hier-conv, .mc-inspector').count()) === 0, 'conversation pane shown outside Hierarchy');
});

await step('Conversations: mission agents pane on the left switches the thread', async () => {
  await p.goto(base + '/missions/M-126?tab=conversations', { waitUntil: 'networkidle' });
  await p.waitForTimeout(600);
  await p.locator('.conv-views [role="radio"]').last().click(); // A–Z list view (Graph is the default)
  await p.locator('.conv-agents .team-row', { hasText: 'Planner-01' }).click();
  await p.waitForTimeout(500);
  await expect(p.locator('.conv-main .msg-head', { hasText: 'Planner-01' }).count(), 'thread did not switch to Planner-01');
  await expect(/agent=planner-01/.test(p.url()), 'agent not in URL');
});

await step('Dividers: drag resizes panes, clamps, and persists across reload', async () => {
  const drag = async (sel, dx) => {
    const b = await p.locator(sel).first().boundingBox();
    await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await p.mouse.down();
    await p.mouse.move(b.x + b.width / 2 + dx / 2, b.y + b.height / 2, { steps: 4 });
    await p.mouse.move(b.x + b.width / 2 + dx, b.y + b.height / 2, { steps: 4 });
    await p.mouse.up();
    await p.waitForTimeout(150);
  };
  const w = async (sel) => (await p.locator(sel).first().boundingBox()).width;
  await p.goto(base + '/missions/M-126?tab=conversations', { waitUntil: 'networkidle' });
  await p.waitForTimeout(600);
  for (const [pane, sep] of [['.conv-agents', '.conv-split > .splitter'], ['.cp-col', '.msg-main.wide > .splitter'], ['.mw-list', '.mw-split']]) {
    const before = await w(pane);
    await drag(sep, 30);
    const after = await w(pane);
    await expect(Math.abs(after - before - 30) <= 3, `${pane} ${before} -> ${after} (wanted +30)`);
    await drag(sep, 4000);
    const big = await w(pane), parent = (await p.locator(sep).first().evaluate((e) => e.parentElement.clientWidth));
    await expect(big <= parent * .6, `${pane} not clamped at max (${big} of ${parent})`);
    await drag(sep, -4000);
    await expect((await w(pane)) >= 165, `${pane} not clamped at min`);
    await drag(sep, 40);
  }
  const keep = await w('.conv-agents');
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(600);
  await expect(Math.abs((await w('.conv-agents')) - keep) <= 2, 'agents pane width not persisted');
  await p.goto(base + '/missions/M-126?tab=hierarchy', { waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  const hb = await w('.hier-conv');
  await drag('.hier-split > .splitter', -100);
  await expect(Math.abs((await w('.hier-conv')) - hb - 100) <= 3, `hierarchy conversation ${hb} -> ${await w('.hier-conv')} (wanted +100)`);
  await p.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('axion.split.')).forEach((k) => localStorage.removeItem(k)));
});

await step('Conversation: send command with image → ack → report upward', async () => {
  await p.goto(base + '/missions/M-126?tab=conversations&agent=coder-01', { waitUntil: 'networkidle' });
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
  await p.locator('.palette-input').fill('settings navigation');
  await p.keyboard.press('Enter');
  await p.waitForURL(/\/settings\?tab=navigation/);
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

await step('u1 · Search finds every kind of element (agent, VM, job site, help)', async () => {
  await p.goto(base + '/missions', { waitUntil: 'networkidle' });
  await p.keyboard.press('Control+k');
  await p.locator('.palette-input').fill('upwork');
  await p.waitForTimeout(250);
  const groups = (await p.locator('.palette-group').allInnerTexts()).map((g) => g.toLowerCase());
  await expect(groups.includes('agents') && groups.includes('job search'), `groups: ${groups.join(', ')}`);
  await p.locator('.palette-input').fill('vm-gpu');
  await p.keyboard.press('Enter');
  await p.waitForURL(/\/operations\?tab=vms/);
});

await step('u1 · Settings › Navigation shows a hidden screen in the rail', async () => {
  await p.goto(base + '/settings?tab=navigation', { waitUntil: 'networkidle' });
  await expect((await p.locator('.rail-top .nav-item', { hasText: 'Overview' }).count()) === 0, 'Overview should be hidden by default');
  await p.getByRole('switch', { name: 'Show Overview in the rail' }).click();
  await p.waitForTimeout(300);
  await expect(p.locator('.rail-top .nav-item', { hasText: 'Overview' }).count(), 'Overview not shown after toggle');
  await p.getByRole('switch', { name: 'Show Overview in the rail' }).click();
});

await step('u1 · Job Search: add a site → its agent starts investigating', async () => {
  await p.goto(base + '/plugins/job-search', { waitUntil: 'networkidle' });
  await p.getByLabel('Job site URL').fill('remoteok.com');
  await p.getByRole('button', { name: 'Add site and start searching' }).click();
  await p.waitForSelector('.js-site.on >> text=remoteok.com', { timeout: 5000 });
  await p.waitForFunction(() => document.querySelectorAll('.js-step').length > 0, null, { timeout: 8000 });
});

await step('u1 · News: post news, it appears for everyone', async () => {
  await p.goto(base + '/notifications?tab=news', { waitUntil: 'networkidle' });
  await p.getByRole('button', { name: 'Add news' }).click();
  await p.locator('.modal input.input').first().fill('E2E news headline');
  await p.locator('.modal textarea').fill('Posted by the flow test.');
  await p.getByRole('button', { name: 'Post' }).click();
  await p.waitForSelector('.news-card >> text=E2E news headline', { timeout: 4000 });
});

await step('u1 · Chat dock: GM answers', async () => {
  await p.getByRole('button', { name: /^Chat with the General Manager/ }).click();
  await p.locator('.chat-dock textarea').fill('status please');
  await p.keyboard.press('Enter');
  await p.waitForFunction(() => [...document.querySelectorAll('.chat-dock .bubble-row.left')].length >= 2, null, { timeout: 6000 });
  await p.keyboard.press('Escape');
});

await step('u1 · VMs: create a VM', async () => {
  await p.goto(base + '/operations?tab=vms', { waitUntil: 'networkidle' });
  await p.getByRole('button', { name: 'Create VM' }).click();
  await p.locator('.modal input.input').first().fill('vm-e2e');
  await p.locator('.modal').getByRole('button', { name: 'Create' }).click();
  await p.waitForSelector('.vm-card >> text=vm-e2e', { timeout: 4000 });
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
// exit code: non-zero when any check failed or the page logged an error
process.exit(results.some((r) => r.startsWith('FAIL')) || errors.length ? 1 : 0);
