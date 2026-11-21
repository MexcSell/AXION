// Stage 5, api mode: missions, sharing, live updates, approvals and a server restart, with two users in two browsers.
// Run through scripts/api-e2e.sh (API 5192 on axion_e2e, reset on start, DEMO seed on; Vite 5193). Needs API_PID.
import { chromium } from 'playwright';
import { calm } from './_session.mjs';
import { writeFileSync } from 'node:fs';
const base = process.env.BASE || 'http://127.0.0.1:5193';
const API_PID = Number(process.env.API_PID || 0);
const b = await chromium.launch({ executablePath: process.env.PW_CHROME || '/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome' });
const results = [];
const errors = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };
const until = async (f, ms = 10000, step = 150) => { const t0 = Date.now(); for (;;) { try { if (await f()) return true; } catch { /* retry */ } if (Date.now() - t0 > ms) return false; await new Promise((r) => setTimeout(r, step)); } };
const browser = async (label) => {
  const ctx = await b.newContext({ viewport: { width: 1600, height: 940 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('axion.data-mode', 'api'); localStorage.setItem('axion.testhook', '1'); } catch { /* ignore */ } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_CONNECTION|502|504|EventSource/.test(m.text())) errors.push(`${label} console: ${m.text()}`); });
  return { ctx, p };
};
const connect = async (p, name, pass) => {
  await p.getByRole('heading', { name: 'Connect' }).waitFor({ timeout: 15000 });
  await p.getByLabel('Name').fill(name);
  await p.getByLabel('Password', { exact: true }).fill(pass);
  await p.getByRole('button', { name: /Connect/ }).click();
};
const row = (p, id) => p.locator(`.mission-row[data-mission="${id}"]`);
const hasRow = async (p, id) => (await row(p, id).count()) > 0;
const conn = (p) => p.locator('.conn-badge').getAttribute('data-conn');

let A, B, newId;
try {
// --- A: first admin (the e2e server seeds the DEMO missions on this first sign-up)
A = await browser('A');
await A.p.goto(base + '/missions', { waitUntil: 'domcontentloaded' });
await connect(A.p, 'Luca', 'secret-1');
await A.p.waitForSelector('.rail-nav', { timeout: 15000 });
check('A connected and the badge says live', await until(async () => (await conn(A.p)) === 'live'));
check('DEMO missions seeded on the server (M-126 listed with a DEMO tag)', await until(async () => (await row(A.p, 'M-126').count()) > 0 && (await row(A.p, 'M-126').locator('.demo-tag').count()) > 0));

// --- B: second user in another browser, approved by A
B = await browser('B');
await B.p.goto(base + '/missions', { waitUntil: 'domcontentloaded' });
await connect(B.p, 'Mina', 'mina-pass');
await B.p.getByRole('heading', { name: 'Waiting for approval' }).waitFor({ timeout: 10000 });
await A.p.goto(base + '/settings?tab=users', { waitUntil: 'domcontentloaded' });
const req = A.p.locator('.us-req', { hasText: 'Mina' });
check('A sees Mina waiting (live, no reload)', await until(async () => (await req.count()) > 0, 10000));
await req.getByRole('button', { name: 'Approve' }).click();
check('B connects after approval', await until(async () => (await B.p.locator('.rail-nav').count()) > 0, 12000));
await B.p.goto(base + '/missions', { waitUntil: 'domcontentloaded' });
check('B sees shared DEMO missions only (M-126 yes, M-127 no)', await until(async () => (await hasRow(B.p, 'M-126')) && !(await hasRow(B.p, 'M-127'))));

// --- A adds a private mission with an image
await A.p.goto(base + '/missions', { waitUntil: 'domcontentloaded' });
await A.p.getByRole('button', { name: 'Add mission' }).first().click();
const dlg = A.p.locator('[data-dialog="DL-01"]');
await dlg.locator('textarea').fill('Research two competitor websites and summarise their pricing pages.');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
await A.p.locator('input[type="file"]').setInputFiles({ name: 'pricing.png', mimeType: 'image/png', buffer: png });
await dlg.locator('button', { hasText: 'Add mission' }).click();
check('A lands on the new mission', await until(async () => /\/missions\/M-\d+/.test(A.p.url()), 10000));
newId = (A.p.url().match(/\/missions\/(M-\d+)/) || [])[1];
check('new mission id comes from the server (above M-136)', !!newId && Number(newId.slice(2)) > 136, newId);
check('staffing runs on the server (GM appoints the executor, agents join)', await until(async () => (await A.p.getByText(/appointed|brought|joined/i).count()) > 0, 10000));
// ABSENCE WAIT (kept): asserting that a live event does NOT reach B; no condition can signal "never".
await B.p.waitForTimeout(800);
check('B does not see A\'s private mission', !(await hasRow(B.p, newId)));

// --- A shares it → appears for B live
await A.p.locator('.mw-share').first().click();
check('shared mission appears for B without a reload', await until(async () => hasRow(B.p, newId), 8000));
await B.p.goto(`${base}/missions/${newId}`, { waitUntil: 'domcontentloaded' });
await B.p.locator('.mw-share').first().waitFor({ timeout: 8000 });
check('B cannot flip the share switch', await B.p.locator('.mw-share').first().isDisabled());
check('B sees the attached image from the server', await until(async () => (await B.p.locator(`img[src*="/api/v1/uploads/"]`).count()) > 0 || (await B.p.getByText('pricing.png').count()) > 0, 6000));

// --- B pauses it → A sees paused live
await until(async () => !(await B.p.getByRole('button', { name: 'Pause' }).first().isDisabled()), 8000);
await B.p.getByRole('button', { name: 'Pause' }).first().click();
await B.p.locator('[data-dialog="DL-05"] button', { hasText: 'Pause' }).last().click();
await A.p.goto(`${base}/missions/${newId}`, { waitUntil: 'domcontentloaded' });
check('A sees B\'s pause live', await until(async () => (await row(A.p, newId).textContent())?.includes('Paused'), 8000));

// --- an approval decided by A updates B's badge
const bellCount = async (p) => { const l = await p.getByRole('button', { name: /^Notifications \(/ }).getAttribute('aria-label'); return Number((l?.match(/(\d+) approvals/) || [])[1] ?? -1); };
const before = await bellCount(B.p);
await A.p.goto(base + '/notifications?tab=pending', { waitUntil: 'domcontentloaded' });
const card = A.p.locator('.nt-appr', { hasText: 'M-126' }).first();
await card.waitFor({ timeout: 8000 });
await card.getByRole('button', { name: /^Approve/ }).click();
check('A\'s approval decision reaches B\'s badge live', await until(async () => (await bellCount(B.p)) === before - 1, 8000), `${before} → ${await bellCount(B.p)}`);

// --- server restart in the middle: reconnecting → live, nothing lost or doubled, the draft survives
await B.p.goto(base + '/missions', { waitUntil: 'domcontentloaded' });
await B.p.getByRole('button', { name: 'Add mission' }).first().click();
const draft = 'Half-typed draft that must survive a server restart';
await B.p.locator('[data-dialog="DL-01"] textarea').fill(draft);
const countRows = async (p) => p.locator('.mission-row').count();
await A.p.goto(base + '/missions', { waitUntil: 'domcontentloaded' });
  await until(async () => (await countRows(A.p)) > 0);
  const rowsBefore = await countRows(A.p);
if (API_PID) process.kill(API_PID, 'SIGUSR2');
check('badge shows reconnecting while the API is down', !!API_PID && await until(async () => ['reconnecting', 'stale'].includes(await conn(B.p)), 8000, 100));
check('badge returns to live after the restart', await until(async () => (await conn(B.p)) === 'live', 20000, 200));
check('the half-typed draft is intact', (await B.p.locator('[data-dialog="DL-01"] textarea').inputValue()) === draft);
await B.p.keyboard.press('Escape');
check('no duplicate or lost rows after reconnect', await until(async () => (await countRows(A.p)) === rowsBefore, 6000), `${rowsBefore} → ${await countRows(A.p)}`);
await A.p.reload({ waitUntil: 'domcontentloaded' });
check('missions persist across the restart (new mission still there, still paused)', await until(async () => (await row(A.p, newId).textContent())?.includes('Paused'), 10000));

// --- Review Focus #2: A un-shares while B has it open → B leaves with a toast
await B.p.goto(`${base}/missions/${newId}`, { waitUntil: 'domcontentloaded' });
await B.p.locator('.mw-share').first().waitFor({ timeout: 8000 });
await A.p.goto(`${base}/missions/${newId}`, { waitUntil: 'domcontentloaded' });
await A.p.locator('.mw-share').first().click();
check('B is moved off the mission with a toast', await until(async () => (await B.p.getByText(`${newId} is no longer available`).count()) > 0 && !B.p.url().includes(newId), 8000));
check('B no longer lists it', await until(async () => !(await hasRow(B.p, newId)), 5000));


  // --- review I1: an action the server refuses rolls back to the true state (not the optimistic one)
  await B.p.goto(base + '/missions/M-133', { waitUntil: 'domcontentloaded' });
  await until(async () => (await row(B.p, 'M-133').count()) > 0);
  await B.p.evaluate(() => window.__axion.data.getState().setMissionStatus('M-133', 'paused'));
  check('a refused pause shows an error and rolls back', await until(async () => (await B.p.getByText('Not changed').count()) > 0 && (await B.p.evaluate(() => window.__axion.data.getState().missions.find((m) => m.id === 'M-133')?.status)) === 'completed', 6000));

  // --- review I5: revoked while the link is down → back to Connect when it returns (not a stale badge forever)
  await B.ctx.setOffline(true);
  if (API_PID) process.kill(API_PID, 'SIGUSR2'); // drop every open stream while B is offline
  await until(async () => (await fetch(base + '/api/v1/health').then((r) => r.ok).catch(() => false)) === false, 8000, 100);
  await until(async () => fetch(base + '/api/v1/health').then((r) => r.ok).catch(() => false), 20000, 200);
  await A.p.goto(base + '/settings?tab=users', { waitUntil: 'domcontentloaded' });
  const dis = A.p.getByRole('button', { name: 'Disable Mina' });
  await dis.waitFor({ timeout: 8000 });
  await dis.click();
  await until(async () => (await A.p.getByRole('button', { name: 'Enable Mina' }).count()) > 0, 8000); // the row shows the disabled state
  await B.ctx.setOffline(false);
  check('a user disabled while offline returns to Connect once back online', await until(async () => (await B.p.getByRole('heading', { name: 'Connect' }).count()) > 0, 45000, 300));
} catch (e) { check('script ran to the end', false, String(e).split('\n')[0]); }
await A?.p.screenshot({ path: '/tmp/axion-api-e2e/missions-live-A.png' }).catch(() => {});
await B?.p.screenshot({ path: '/tmp/axion-api-e2e/missions-live-B.png' }).catch(() => {});
console.log(results.join('\n'));
console.log(errors.length ? 'PAGE ERRORS:\n' + errors.join('\n') : 'no page errors');
console.log(`${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
writeFileSync('/tmp/axion-api-e2e/api-flows.txt', results.join('\n') + '\n');
await b.close();
process.exit(results.some((r) => r.startsWith('FAIL')) || errors.length ? 1 : 0);
