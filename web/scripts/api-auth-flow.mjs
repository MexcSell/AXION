// Stage 5, api mode: sign-in against the real server (run through scripts/api-e2e.sh, which resets axion_e2e).
// Admin registers; a second user in ANOTHER browser waits; the admin approves; the waiting browser connects
// without a reload; a new device waits for approval; disabling a user sends them back to Connect (Review Focus #1).
import { chromium } from 'playwright';
const base = process.env.BASE || 'http://127.0.0.1:5193';
const b = await chromium.launch({ executablePath: process.env.PW_CHROME || '/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome' });
const results = [];
const errors = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
const browser = async (label) => {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('axion.data-mode', 'api'); } catch { /* ignore */ } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  return { ctx, p };
};
const connect = async (p, name, pass) => {
  await p.getByLabel('Name').fill(name);
  await p.getByLabel('Password', { exact: true }).fill(pass);
  await p.getByRole('button', { name: /Connect/ }).click();
};
const waitRail = async (p, ms = 10000) => { try { await p.waitForSelector('.rail-nav', { timeout: ms }); return true; } catch { return false; } };

const A = await browser('admin');
await A.p.goto(base + '/missions', { waitUntil: 'domcontentloaded' });
await A.p.getByRole('heading', { name: 'Connect' }).waitFor({ timeout: 10000 });
check('connect screen first (api mode)', true);
check('first-user admin hint from the server', await A.p.getByText('you become the').isVisible());
await connect(A.p, 'Luca', 'secret-1');
check('first user connects as admin', await waitRail(A.p));
await A.p.reload({ waitUntil: 'domcontentloaded' });
check('session survives a reload (HTTP-only cookie)', await waitRail(A.p));

const B = await browser('nova');
await B.p.goto(base + '/missions', { waitUntil: 'domcontentloaded' });
await B.p.getByRole('heading', { name: 'Connect' }).waitFor({ timeout: 10000 });
await connect(B.p, 'Nova Kim', 'nova-pass');
await B.p.getByRole('heading', { name: 'Waiting for approval' }).waitFor({ timeout: 8000 });
check('second user (another browser) waits', true);
await A.p.goto(base + '/settings?tab=users', { waitUntil: 'domcontentloaded' });
const req = A.p.locator('.us-req', { hasText: 'Nova Kim' });
let seen = true;
try { await req.waitFor({ timeout: 10000 }); } catch { seen = false; }
check('admin sees the request', seen);
if (seen) await req.getByRole('button', { name: 'Approve' }).click();
check('waiting browser connects without a reload', await waitRail(B.p, 12000));

// new device for Nova: a third browser
const C = await browser('nova-phone');
await C.p.goto(base + '/missions', { waitUntil: 'domcontentloaded' });
await C.p.getByRole('heading', { name: 'Connect' }).waitFor({ timeout: 10000 });
await connect(C.p, '  nova kim ', 'nova-pass');
let devWait = true;
try { await C.p.getByRole('heading', { name: 'New device needs approval' }).waitFor({ timeout: 8000 }); } catch { devWait = false; }
check('same name in a new browser = new device that waits', devWait);
await A.p.reload({ waitUntil: 'domcontentloaded' });
const dreq = A.p.locator('.us-req', { hasText: 'Nova Kim' });
let dseen = true;
try { await dreq.waitFor({ timeout: 10000 }); } catch { dseen = false; }
check('admin sees the device request', dseen);
if (dseen) await dreq.getByRole('button', { name: 'Approve' }).click();
check('device connects after approval', await waitRail(C.p, 12000));

// wrong password
const D = await browser('intruder');
await D.p.goto(base + '/missions', { waitUntil: 'domcontentloaded' });
await D.p.getByRole('heading', { name: 'Connect' }).waitFor({ timeout: 10000 });
await connect(D.p, 'Luca', 'wrong-pass');
let wrong = true;
try { await D.p.getByRole('alert').filter({ hasText: 'Wrong password' }).waitFor({ timeout: 6000 }); } catch { wrong = false; }
check('wrong password is refused', wrong);

// review I3: a waiting user who is declined learns it (no endless waiting screen)
const T = await browser('tomo');
await T.p.goto(base + '/missions', { waitUntil: 'domcontentloaded' });
await T.p.getByRole('heading', { name: 'Connect' }).waitFor({ timeout: 10000 });
await connect(T.p, 'Tomo Ito', 'tomo-pass');
await T.p.getByRole('heading', { name: 'Waiting for approval' }).waitFor({ timeout: 8000 });
await A.p.goto(base + '/settings?tab=users', { waitUntil: 'domcontentloaded' });
const treq = A.p.locator('.us-req', { hasText: 'Tomo Ito' });
let declined = false;
try { await treq.waitFor({ timeout: 10000 }); await treq.getByRole('button', { name: 'Decline Tomo Ito' }).click(); await T.p.getByRole('heading', { name: 'Request declined' }).waitFor({ timeout: 10000 }); declined = true; } catch { /* reported */ }
check('a declined waiting user sees "Request declined"', declined);

// Review Focus #1: disable Nova while signed in → back to Connect
await A.p.reload({ waitUntil: 'domcontentloaded' });
const row = A.p.locator('.us-user, .us-row, tr', { hasText: 'Nova Kim' }).first();
const disableBtn = row.getByRole('button', { name: /Disable/i });
let disabled = false;
try { await disableBtn.first().waitFor({ timeout: 10000 }); await disableBtn.first().click(); disabled = true; } catch { /* reported below */ }
check('admin can disable Nova', disabled);
await B.p.goto(base + '/missions', { waitUntil: 'domcontentloaded' });
let back = true;
try { await B.p.getByRole('heading', { name: 'Connect' }).waitFor({ timeout: 10000 }); } catch { back = false; }
check('disabled user returns to Connect', back);
check('Connect explains why', (await B.p.getByText(/access was changed|session ended/i).count()) > 0);

await A.p.screenshot({ path: '/tmp/axion-api-e2e/admin-users.png' });
console.log(results.join('\n'));
console.log(errors.length ? 'PAGE ERRORS:\n' + errors.join('\n') : 'no page errors');
console.log(`${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
await b.close();
process.exit(results.some((r) => r.startsWith('FAIL')) || errors.length ? 1 : 0);
