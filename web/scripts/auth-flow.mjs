// Register → wait → admin approves in another tab → waiting tab connects automatically (owner update 2026-11-20 u1).
// Usage: node scripts/auth-flow.mjs   (needs the dev server; BASE=... for preview)
import { chromium } from 'playwright';
import { demoMode } from './_session.mjs';
import { resolveBase } from './_base.mjs';
const base = resolveBase();
const b = await chromium.launch({ executablePath: process.env.PW_CHROME || '/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome' });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
await demoMode(ctx); // this script checks the in-browser DEMO accounts; scripts/api-auth-flow.mjs checks the server
const errors = [];
const results = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };
const admin = await ctx.newPage();
admin.on('pageerror', (e) => errors.push('admin: ' + e.message));
await admin.goto(base + '/missions', { waitUntil: 'networkidle' });
check('connect screen shown first', await admin.getByRole('heading', { name: 'Connect' }).isVisible());
check('first-user admin hint', await admin.getByText('you become the').isVisible());
await admin.getByLabel('Name').fill('Luca');
await admin.getByLabel('Password', { exact: true }).fill('secret-1');
await admin.getByRole('button', { name: /Connect/ }).click();
await admin.waitForSelector('.rail-nav', { timeout: 8000 });
check('first user connects as admin', await admin.locator('.rail-nav').first().isVisible());

const user = await ctx.newPage(); // new tab: same browser/device, separate session
user.on('pageerror', (e) => errors.push('user: ' + e.message));
await user.goto(base + '/missions', { waitUntil: 'networkidle' });
await user.getByLabel('Name').fill('Nova Kim');
await user.getByLabel('Password', { exact: true }).fill('nova-pass');
await user.getByRole('button', { name: /Connect/ }).click();
await user.getByRole('heading', { name: 'Waiting for approval' }).waitFor({ timeout: 8000 });
check('second user waits for approval', true);

await admin.goto(base + '/settings?tab=users', { waitUntil: 'networkidle' });
const req = admin.locator('.us-req', { hasText: 'Nova Kim' });
await req.waitFor({ timeout: 8000 });
check('admin sees the request', await req.isVisible());
await req.getByRole('button', { name: 'Approve' }).click();
await user.waitForSelector('.rail-nav', { timeout: 10000 });
check('waiting tab connects automatically after approval', await user.locator('.rail-nav').first().isVisible());
// --- visibility: the member sees shared missions, not the admin's private ones
await user.goto(base + '/missions', { waitUntil: 'networkidle' });
await user.locator('.mission-row').first().waitFor({ timeout: 8000 });
const sees = async (id) => (await user.locator(`.mission-row[data-mission="${id}"]`).count()) > 0;
check('member sees a shared mission (M-126)', await sees('M-126'));
check('member does not see a private mission (M-127)', !(await sees('M-127')));
await user.goto(base + '/missions/M-127', { waitUntil: 'networkidle' });
check('private mission link shows "not shared with you"', (await user.getByText('is not shared with you').count()) > 0);
await user.goto(base + '/notifications', { waitUntil: 'networkidle' });
check('notices about private missions are hidden (M-132 origin grant)', (await user.getByText('Origin grant requested').count()) === 0);
await user.goto(base + '/settings?tab=users', { waitUntil: 'networkidle' });
check('member has no admin approvals panel', (await user.getByRole('heading', { name: 'Approvals' }).count()) === 0 && (await user.getByText('My profile').count()) > 0);
// --- cross-tab: a mission the member adds appears in the admin's tab without a reload
await admin.goto(base + '/missions', { waitUntil: 'networkidle' });
await user.goto(base + '/missions', { waitUntil: 'networkidle' });
await user.getByRole('button', { name: 'Add mission' }).first().click();
await user.locator('[data-dialog="DL-01"] textarea').fill('Member mission: research two job boards for remote React work.');
await user.locator('[data-dialog="DL-01"] button', { hasText: 'Add mission' }).click();
let cross = true;
try { await admin.locator('.mission-row', { hasText: 'Member mission' }).waitFor({ timeout: 8000 }); } catch { cross = false; }
check('member-added mission reaches the admin tab live', cross);
// --- the member can use every main screen without errors
for (const path of ['/missions', '/notifications?tab=news', '/notifications?tab=pending', '/settings?tab=navigation', '/plugins/job-search', '/plugins/job-search?tab=jobs', '/operations?tab=vms', '/operations?tab=agents&sub=lineage', '/agents/coder-01?tab=conversations']) {
  await user.goto(base + path, { waitUntil: 'networkidle' });
  await user.waitForTimeout(400);
}
check('member tour of main screens', errors.length === 0, errors.length ? errors[0] : '9 screens');
await user.getByRole('button', { name: /Account menu/ }).click();
await user.getByRole('menuitem', { name: 'Sign out' }).click();
await user.getByRole('heading', { name: 'Connect' }).waitFor({ timeout: 5000 });
check('sign out returns to Connect', true);
await user.getByLabel('Name').fill('Nova Kim');
await user.getByLabel('Password', { exact: true }).fill('wrong');
await user.getByRole('button', { name: /Connect/ }).click();
await user.getByRole('alert').waitFor({ timeout: 5000 });
check('wrong password rejected', (await user.getByRole('alert').innerText()).includes('Wrong password'));
// --- migration: a browser holding v1 DEMO data (budget/cost, no owner) still loads (owner update u1)
const fixtures = await admin.evaluate(async () => (await import('/src/data/missions.ts')).MISSIONS).catch(() => null);
if (fixtures) {
  const legacy = fixtures.map((m, i) => { const { ownerId, shared, content, ...rest } = m; void ownerId; void shared; void content; return { ...rest, cost: 12.5, budget: 50, agentIds: i === 0 ? [...rest.agentIds, 'finance-01'] : rest.agentIds }; });
  const ctx2 = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await demoMode(ctx2);
  await ctx2.addInitScript((blob) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('axion.demo-data.v1', blob); sessionStorage.setItem('seeded', '1'); } localStorage.setItem('axion.demo-autologin', 'Luca'); },
    JSON.stringify({ state: { missions: legacy, approvalDecisions: {}, readNotifications: {}, extraMessages: {} }, version: 1 }));
  const mp = await ctx2.newPage(); const merr = [];
  mp.on('pageerror', (e) => merr.push(e.message));
  await mp.goto(base + '/missions/M-126', { waitUntil: 'networkidle' });
  await mp.waitForTimeout(800);
  const rows = await mp.locator('.mission-row').count();
  const migrated = await mp.evaluate(() => { const s = JSON.parse(localStorage.getItem('axion.demo-data.v1')); return { v: s.version, m: s.state.missions[0] }; });
  check('v1 → v2 migration loads the old missions', rows > 5 && merr.length === 0, `${rows} rows${merr[0] ? ' · ' + merr[0] : ''}`);
  check('migration drops funds, adds owner/content, maps finance-01', migrated.v === 2 && migrated.m.budget === undefined && !!migrated.m.ownerId && !!migrated.m.content && !migrated.m.agentIds.includes('finance-01'));
  await ctx2.close();
} else check('v1 → v2 migration (needs the dev server for fixtures)', false, 'could not import fixtures');
console.log(results.join('\n'));
console.log(errors.length ? 'ERRORS\n' + errors.join('\n') : 'NO PAGE ERRORS');
await b.close();
// exit code: non-zero when any check failed or the page logged an error
process.exit(results.some((r) => r.startsWith('FAIL')) || errors.length ? 1 : 0);
