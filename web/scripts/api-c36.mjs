// Improvement cycle 36 (Phase 2 · P4), api mode: site grants with an exact-origin normaliser.
// A (admin) opens Settings > Browser > Site grants, tries hostile origins in the dialog (the refusal reason shows live and the
// Grant button stays off), grants an exact origin (a messy spelling is stored in its normal form), sees it listed with a
// countdown, then revokes it. The API refuses hostile origins with 422, a member gets 403, and nothing hostile is ever stored.
// Run through scripts/api-e2e.sh (lane ports: E2E_API_PORT/E2E_WEB_PORT). Condition waits only (no networkidle, no fixed sleeps).
// The committed screenshots are written only on request: DOC_SHOT_C36=docs/screenshots/improve-c36-site-grants-dark.png
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
const base = process.env.BASE || 'http://127.0.0.1:5193';
const SHOTS = process.env.SHOTS || `/tmp/axion-api-c36-${new URL(base).port}`;
const DOC_SHOT = process.env.DOC_SHOT_C36;
mkdirSync(SHOTS, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.PW_CHROME || '/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome' });
const results = [];
const errors = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); console.log(results[results.length - 1]); };
const until = async (f, ms = 10000, step = 150) => { const t0 = Date.now(); for (;;) { try { if (await f()) return true; } catch { /* retry */ } if (Date.now() - t0 > ms) return false; await new Promise((r) => setTimeout(r, step)); } };
const browser = async (label, vw = Number(process.env.VW || 1600), vh = Number(process.env.VH || 940)) => {
  const ctx = await b.newContext({ viewport: { width: vw, height: vh } });
  await ctx.addInitScript(() => { try { localStorage.setItem('axion.data-mode', 'api'); localStorage.setItem('axion.testhook', '1'); if (!localStorage.getItem('axion.settings.v1')) localStorage.setItem('axion.settings.v1', JSON.stringify({ state: { themeMode: 'dark' }, version: 0 })); } catch { /* ignore */ } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_CONNECTION|ERR_INTERNET_DISCONNECTED|502|503|504|EventSource/.test(m.text())) errors.push(`${label} console: ${m.text()}`); });
  return { ctx, p };
};
const connect = async (p, name, pass) => {
  await p.getByRole('heading', { name: 'Connect' }).waitFor({ timeout: 15000 });
  await p.getByLabel('Name').fill(name);
  await p.getByLabel('Password', { exact: true }).fill(pass);
  await p.getByRole('button', { name: /Connect/ }).click();
};
const live = (p) => until(async () => (await p.locator('.conn-badge').getAttribute('data-conn')) === 'live', 15000);
const apiOf = (p) => {
  let csrf = '';
  return async (method, path, data, headers = {}) => {
    if (!csrf && method !== 'GET') csrf = (await (await p.request.get(base + '/api/v1/me')).json()).me.csrf;
    const r = await p.request.fetch(base + '/api/v1' + path, { method, data, headers: { ...(method !== 'GET' ? { 'x-csrf': csrf } : {}), ...headers } });
    return { status: r.status(), body: await r.json().catch(() => ({})) };
  };
};
let k = 0;
const key = () => ({ 'idempotency-key': `c36-${Date.now()}-${k++}` });
const hours = (h) => new Date(Date.now() + h * 3600_000).toISOString();
let A, C;
try {
  A = await browser('A');
  await A.p.goto(base + '/missions', { waitUntil: 'domcontentloaded' });
  await connect(A.p, 'Luca', 'secret-1');
  check('A (first user = administrator) is connected and live', await live(A.p));
  const apiA = apiOf(A.p);
  C = await browser('C');
  await C.p.goto(base + '/missions', { waitUntil: 'domcontentloaded' });
  await connect(C.p, 'Mina', 'mina-pass');
  await C.p.getByRole('heading', { name: 'Waiting for approval' }).waitFor({ timeout: 10000 });
  const u = ((await apiA('GET', '/users')).body.users ?? []).find((x) => x.name === 'Mina');
  await apiA('POST', `/users/${u.id}/approve`, {});
  await C.p.locator('.rail-nav').first().waitFor({ timeout: 15000 });
  const apiC = apiOf(C.p);
  const mid = (await apiA('POST', '/missions', { text: 'Check the pricing page on the vendor site.', files: [], shared: false }, key())).body.mission.id;
  check('a mission exists for the grant', !!mid, mid);

  // ---------------------------------------------------- the panel, empty
  await A.p.goto(base + '/settings?tab=browser', { waitUntil: 'domcontentloaded' });
  check('Settings > Browser shows the Site grants panel, empty, with its ? help and the R3 chip',
    await until(async () => (await A.p.locator('[data-site-grants="ready"]').count()) === 1 && (await A.p.getByText('No site grants').count()) === 1, 15000)
      && (await A.p.locator('[data-help-key="browser.originGrant"]').count()) >= 1 && (await A.p.getByText('R3 · administrator approves').count()) === 1);
  const mc = await C.p.goto(base + '/settings?tab=browser', { waitUntil: 'domcontentloaded' }).then(() => C.p.getByRole('heading', { name: 'Browser defaults' }).waitFor({ timeout: 15000 })).then(() => true).catch(() => false);
  check('C (member) sees no Site grants panel', mc && (await C.p.locator('[data-site-grants]').count()) === 0);

  // ---------------------------------------------------- the dialog refuses hostile origins live
  await A.p.getByRole('button', { name: 'Grant a site', exact: true }).click();
  const dlg = A.p.locator('[role="dialog"]').first();
  await dlg.locator('#sg-origin').waitFor({ timeout: 8000 });
  check('the dialog has ? help on origin, mission, actions and expiry', (await Promise.all(['grants.origin', 'grants.mission', 'grants.capabilities', 'grants.expiry'].map((k2) => dlg.locator(`[data-help-key="${k2}"]`).count()))).every((n) => n >= 1));
  check('Grant site is off while the origin is empty', await dlg.getByRole('button', { name: 'Grant site' }).isDisabled());
  const hostile = [
    ['https://good.com@evil.com', /user name or password/i],
    ['https://127.0.0.1', /IP addresses/i],
    ['https://pаypal.com', /mixes alphabets/i],
    ['http://example.com', /Only https/i],
    ['https://*.example.com', /Wildcards/i],
    ['https://metadata.google.internal', /metadata/i],
    ['https://example.com/login', /no path/i],
  ];
  let allRefused = true;
  for (const [o, re] of hostile) {
    await dlg.locator('#sg-origin').fill(o);
    const ok = await until(async () => { const el = dlg.locator('[data-origin-check="refused"]'); return (await el.count()) === 1 && re.test(await el.innerText()); }, 6000)
      && await dlg.getByRole('button', { name: 'Grant site' }).isDisabled() && (await dlg.locator('[data-normal-form]').count()) === 0;
    if (!ok) allRefused = false;
    check(`dialog refuses ${JSON.stringify(o)} with its reason and keeps Grant site off`, ok);
  }
  await A.p.screenshot({ path: `${SHOTS}/improve-c36-dialog-refused.png` });
  check('every hostile try was refused live', allRefused);
  check('nothing was stored by the refused tries', ((await apiA('GET', '/site-grants')).body.grants ?? []).length === 0);

  // ---------------------------------------------------- a messy but harmless spelling is accepted and shown in normal form
  await dlg.locator('#sg-origin').fill('HTTPS://Example.COM:443/');
  check('a messy spelling is accepted and the normal form is shown: https://example.com',
    await until(async () => (await dlg.locator('[data-origin-check="ok"]').count()) === 1 && (await dlg.locator('[data-normal-form]').innerText()).includes('https://example.com'), 6000));
  await dlg.locator('#sg-mission').selectOption(mid);
  await dlg.getByRole('button', { name: 'screenshot' }).click();
  await dlg.locator('#sg-exp').selectOption('2h');
  await A.p.screenshot({ path: `${SHOTS}/improve-c36-dialog-ok.png` });
  await dlg.getByRole('button', { name: 'Grant site' }).click();
  check('the dialog closes after Grant site', await until(async () => (await dlg.count()) === 0, 8000));
  const g1 = ((await apiA('GET', '/site-grants')).body.grants ?? [])[0];
  check('the server stored the normal form, the mission, read + screenshot, an expiry about 2 hours out, state active, tier R3',
    g1?.origin === 'https://example.com' && g1.missionId === mid && g1.capabilities.join() === 'read,screenshot' && g1.state === 'active' && g1.tier === 'R3'
      && Math.abs(new Date(g1.expiresAt).getTime() - (Date.now() + 7200_000)) < 120_000);
  const row = A.p.locator(`[data-grant="${g1?.id}"]`);
  check('A sees the grant listed: origin, mission, actions, Active chip, time left',
    await until(async () => (await row.count()) === 1 && (await row.getAttribute('data-origin')) === 'https://example.com' && (await row.getAttribute('data-state')) === 'active', 8000)
      && /left/.test(await row.innerText()) && (await row.innerText()).includes(mid));
  check('the panel counts 1 active of 1', (await A.p.locator('[data-active-count="1"]').count()) === 1);
  if (DOC_SHOT) { await A.p.screenshot({ path: DOC_SHOT }); }
  await A.p.screenshot({ path: `${SHOTS}/improve-c36-listed.png` });

  // ---------------------------------------------------- the API holds the same line
  const bad = await apiA('POST', '/site-grants', { origin: 'https://good.com@evil.com', missionId: mid, capabilities: ['read'], expiresAt: hours(1) }, key());
  check('POST of a hostile origin is 422 with the reason, and nothing new is stored', bad.status === 422 && /user name or password/i.test(bad.body.fieldErrors?.origin ?? '') && ((await apiA('GET', '/site-grants')).body.grants ?? []).length === 1);
  check('an expiry beyond 30 days is 422; a missing expiry is 400',
    (await apiA('POST', '/site-grants', { origin: 'https://example.org', missionId: mid, capabilities: ['read'], expiresAt: hours(24 * 31) }, key())).status === 422
      && (await apiA('POST', '/site-grants', { origin: 'https://example.org', missionId: mid, capabilities: ['read'] }, key())).status === 400);
  check('a duplicate grant for the same mission and origin is 409', (await apiA('POST', '/site-grants', { origin: 'https://example.com/', missionId: mid, capabilities: ['read'], expiresAt: hours(1) }, key())).status === 409);
  check('a member cannot list, validate, grant or revoke (403)',
    (await apiC('GET', '/site-grants')).status === 403 && (await apiC('GET', '/site-grants/validate?origin=https://example.com')).status === 403
      && (await apiC('POST', '/site-grants', { origin: 'https://example.org', missionId: mid, capabilities: ['read'], expiresAt: hours(1) }, key())).status === 403
      && (await apiC('POST', `/site-grants/${g1.id}/revoke`, {})).status === 403);

  // ---------------------------------------------------- revoke through the UI
  await row.getByRole('button', { name: /^Revoke the grant for/ }).click();
  await row.getByLabel(/^Reason for revoking/).fill('Pricing check finished');
  await row.getByRole('button', { name: 'Revoke', exact: true }).click();
  check('the server revoked it: state revoked, by Luca, with the reason',
    await until(async () => { const g = ((await apiA('GET', '/site-grants')).body.grants ?? [])[0]; return g?.state === 'revoked' && g.revokedByName === 'Luca' && g.reason === 'Pricing check finished'; }, 8000));
  check('the row now shows Revoked with who and why; no Revoke control is left; the count is 0 active',
    await until(async () => (await row.getAttribute('data-state')) === 'revoked' && (await row.locator('[data-revoked]').innerText()).includes('Pricing check finished') && (await row.getByRole('button', { name: /^Revoke the grant for/ }).count()) === 0 && (await A.p.locator('[data-active-count="0"]').count()) === 1, 8000));
  check('revoking again is 409', (await apiA('POST', `/site-grants/${g1.id}/revoke`, {})).status === 409);
  const overflow = (p) => p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check(`no horizontal overflow on Settings > Browser at ${process.env.VW || 1600}px`, !(await overflow(A.p)));
  const fit = await A.p.evaluate(() => { const m = document.querySelector('main'); return { sh: m.scrollHeight, ch: m.clientHeight, doc: document.documentElement.scrollHeight, win: window.innerHeight }; });
  check('the page still fits one screen (main does not scroll)', fit.sh <= fit.ch + 2 && fit.doc <= fit.win + 2, JSON.stringify(fit));
  await A.p.screenshot({ path: `${SHOTS}/improve-c36-revoked.png` });
} catch (e) { check('script ran to the end', false, String(e).split('\n')[0]); }
for (const [Y, l] of [[A, 'A'], [C, 'C']]) await Y?.p.screenshot({ path: `${SHOTS}/improve-c36-end-${l}.png` }).catch(() => {});
console.log(errors.length ? 'PAGE ERRORS:\n' + errors.join('\n') : 'no page errors');
console.log(`${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
writeFileSync(`${SHOTS}/api-c36.txt`, results.join('\n') + '\n');
await b.close();
process.exit(results.some((r) => r.startsWith('FAIL')) || errors.length ? 1 : 0);
