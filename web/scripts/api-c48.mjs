// Cycle 48 (lane w47), api mode: the approvals UI follows the policy tiers (server canDecide).
// Admin and member sessions. Covers every decision surface (Notifications card, decision dialog, mission Approvals tab, Overview queue),
// no request from a blocked control, the ? popovers, aria-describedby, no 403 in the member's network log, 1366x768 fit, an admin who can still decide.
// Run through scripts/api-e2e.sh (DEMO seed on). Screenshots: SHOTS (default /tmp/axion-c48), light and dark.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const base = process.env.BASE || 'http://127.0.0.1:5193';
const SHOTS = process.env.SHOTS || '/tmp/axion-c48';
mkdirSync(SHOTS, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.PW_CHROME || '/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome' });
const results = [];
const errors = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); console.log(results[results.length - 1]); };
const until = async (f, ms = 10000, step = 100) => { const t0 = Date.now(); for (;;) { try { if (await f()) return true; } catch { /* retry */ } if (Date.now() - t0 > ms) return false; await new Promise((r) => setTimeout(r, step)); } };
const frame = (p) => p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))));
const net = { decisions: [], forbidden: [] }; // member session only
const open = async (label, theme = 'dark') => {
  const ctx = await b.newContext({ viewport: { width: 1366, height: 768 } });
  await ctx.addInitScript(([th]) => { try { localStorage.setItem('axion.data-mode', 'api'); localStorage.setItem('axion.testhook', '1'); if (!localStorage.getItem('axion.settings.v1')) localStorage.setItem('axion.settings.v1', JSON.stringify({ state: { themeMode: th, skin: 'luminous', motion: 'reduced' }, version: 0 })); } catch { /* ignore */ } }, [theme]);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_CONNECTION|EventSource|50[234]|403|409/.test(m.text())) errors.push(`${label} console: ${m.text()}`); });
  return { ctx, p };
};
const connect = async (p, name, pass) => {
  await p.getByRole('heading', { name: 'Connect' }).waitFor({ timeout: 15000 });
  await p.getByLabel('Name').fill(name);
  await p.getByLabel('Password', { exact: true }).fill(pass);
  await p.getByRole('button', { name: /Connect/ }).click();
};
const apiOf = (p) => {
  let csrf = '';
  return async (method, path, data, headers = {}) => {
    if (!csrf && method !== 'GET') csrf = (await (await p.request.get(base + '/api/v1/me')).json()).me.csrf;
    const r = await p.request.fetch(base + '/api/v1' + path, { method, data, headers: { ...(method !== 'GET' ? { 'x-csrf': csrf } : {}), ...headers } });
    return { status: r.status(), body: await r.json().catch(() => ({})) };
  };
};
const fits = (p) => p.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1 && document.documentElement.scrollWidth <= window.innerWidth + 1);
const settled = (p) => until(() => p.evaluate(() => [...document.querySelectorAll('.nt-appr, .approval-mini, .oa-appr')].every((e) => getComputedStyle(e).opacity === '1')), 5000);
const gated = async (loc) => (await loc.getAttribute('aria-disabled')) === 'true';
const reasonOf = (p, loc) => loc.getAttribute('aria-describedby').then((id) => (id ? p.locator(`[id="${id}"]`).innerText() : ''));
let k = 0;
const key = () => `c48-${Date.now()}-${k++}`;
try {
  const A = await open('A');
  await A.p.goto(base + '/missions', { waitUntil: 'domcontentloaded' });
  await connect(A.p, 'Luca', 'secret-1');
  await A.p.waitForSelector('.rail-nav', { timeout: 20000 });
  const apiA = apiOf(A.p);

  const B = await open('B');
  B.p.on('request', (r) => { if (/\/approvals\/[^/]+\/decision/.test(r.url()) && r.method() === 'POST') net.decisions.push(r.url()); });
  B.p.on('response', (r) => { if (r.url().includes('/api/') && r.status() === 403) net.forbidden.push(`${r.status()} ${r.url()}`); });
  await B.p.goto(base + '/missions', { waitUntil: 'domcontentloaded' });
  await connect(B.p, 'Mina', 'mina-pass');
  await B.p.getByRole('heading', { name: 'Waiting for approval' }).waitFor({ timeout: 10000 });
  const mina = ((await apiA('GET', '/users')).body.users ?? []).find((u) => u.name === 'Mina');
  await apiA('POST', `/users/${mina.id}/approve`, {});
  check('Mina connects after approval', await until(async () => (await B.p.locator('.rail-nav').count()) > 0, 15000));
  const apiB = apiOf(B.p);
  const aR2 = ((await apiA('GET', '/approvals')).body.approvals ?? []).find((a) => a.status === 'pending' && a.riskTier === 'R2');
  if (aR2) await apiA('POST', `/missions/${aR2.missionId}/share`, { shared: true }, { 'idempotency-key': key() });

  // ---- the server's flag
  const listB = (await apiB('GET', '/approvals')).body.approvals ?? [];
  const pend = listB.filter((a) => a.status === 'pending');
  const r3 = pend.filter((a) => a.riskTier === 'R3' || a.riskTier === 'R4');
  const r2 = pend.filter((a) => a.riskTier === 'R2');
  check('the server sends canDecide + reason: member false/tier_requires_admin on R3/R4, true on R2', r3.length > 0 && r2.length > 0 && r3.every((a) => a.canDecide === false && a.decideBlockedReason === 'tier_requires_admin') && r2.every((a) => a.canDecide === true && a.decideBlockedReason === null), `R3/R4 ${r3.length}, R2 ${r2.length}`);
  const listA = (await apiA('GET', '/approvals')).body.approvals ?? [];
  check('the server sends canDecide true to the admin on every pending request', listA.filter((a) => a.status === 'pending').every((a) => a.canDecide === true));

  // ---- surface 1: Notifications card
  await B.p.goto(base + '/notifications?tab=pending', { waitUntil: 'domcontentloaded' });
  const cards = B.p.locator('.nt-appr');
  await cards.first().waitFor({ timeout: 10000 });
  const gc = cards.filter({ has: B.p.locator('.chip', { hasText: /^R[34]$/ }) }).first();
  const appr = gc.getByRole('button', { name: 'Approve' }), deny = gc.getByRole('button', { name: 'Deny' });
  check('card: Approve and Deny are disabled (aria-disabled) on R3/R4', await gated(appr) && await gated(deny) && await appr.isDisabled() && await deny.isDisabled());
  check('card: aria-describedby points at the visible reason "Needs an administrator"', /needs an administrator/i.test(await reasonOf(B.p, appr)) && /needs an administrator/i.test(await reasonOf(B.p, deny)));
  await appr.focus(); const focusable = await B.p.evaluate(() => document.activeElement?.getAttribute('aria-describedby') != null);
  check('card: the blocked button is keyboard-focusable (reason reachable by screen reader)', focusable);
  await appr.click({ force: true }); await deny.click({ force: true }); await frame(B.p);
  check('card: clicking blocked Approve/Deny sends no request and opens no dialog', net.decisions.length === 0 && (await B.p.locator('[data-dialog="DL-48"]').count()) === 0);
  await gc.locator('[data-help-key="approval.gate"]').click();
  const pop = B.p.locator('.help-pop');
  check('card: the gate ? opens and explains why', await until(async () => /administrator/i.test(await pop.innerText()) && /same check|server/i.test(await pop.innerText())));
  await B.p.keyboard.press('Escape');
  await gc.locator('[data-help-key="approval.tiers"]').click();
  check('card: the tiers ? opens and explains R0 to R4', await until(async () => { const t = await pop.innerText(); return ['R0', 'R1', 'R2', 'R3', 'R4'].every((x) => t.includes(x)) && /administrator/i.test(t); }));
  await B.p.screenshot({ path: `${SHOTS}/member-tiers-help-dark.png` });
  await B.p.keyboard.press('Escape');
  check('card: member page fits 1366x768', await fits(B.p));
  await settled(B.p);
  await B.p.screenshot({ path: `${SHOTS}/member-card-dark.png` });

  // ---- requester_cannot_decide (only the server's reason text is rendered; the response is rewritten in the browser for this one case)
  await B.p.route('**/api/v1/approvals', async (route) => {
    const res = await route.fetch(); const j = await res.json();
    for (const a of j.approvals ?? []) if (a.riskTier === 'R2' && a.status === 'pending') { a.canDecide = false; a.decideBlockedReason = 'requester_cannot_decide'; }
    await route.fulfill({ response: res, json: j });
  });
  await B.p.goto(base + '/notifications?tab=pending', { waitUntil: 'domcontentloaded' });
  const rc = B.p.locator('.nt-appr').filter({ has: B.p.locator('.chip', { hasText: /^R2$/ }) }).first();
  await rc.waitFor({ timeout: 10000 });
  check('card: requester_cannot_decide shows "You requested this; someone else must decide" and blocks', /someone else must decide/i.test(await reasonOf(B.p, rc.getByRole('button', { name: 'Approve' }))) && await gated(rc.getByRole('button', { name: 'Approve' })));
  await B.p.unroute('**/api/v1/approvals');

  // ---- surface 2: decision dialog
  await B.p.goto(base + '/notifications?tab=pending', { waitUntil: 'domcontentloaded' });
  await B.p.locator('.nt-appr').first().waitFor({ timeout: 10000 });
  await B.p.locator('.nt-appr').filter({ has: B.p.locator('.chip', { hasText: /^R[34]$/ }) }).first().getByRole('button', { name: 'Details' }).click();
  const dlg = B.p.locator('[data-dialog="DL-48"]');
  await dlg.waitFor({ timeout: 8000 });
  const da = dlg.getByRole('button', { name: /Approve/ }), dd = dlg.getByRole('button', { name: /Deny/ });
  check('dialog: Approve and Deny blocked with the reason and a ?', await gated(da) && await gated(dd) && /administrator/i.test(await reasonOf(B.p, da)) && (await dlg.locator('[data-help-key="approval.gate"]').count()) === 1);
  await da.click({ force: true }); await dd.click({ force: true }); await frame(B.p);
  check('dialog: clicking them sends nothing and the dialog stays', net.decisions.length === 0 && (await dlg.count()) === 1);
  await B.p.screenshot({ path: `${SHOTS}/member-dialog-dark.png` });
  await B.p.keyboard.press('Escape');

  // ---- surface 3: mission Approvals tab
  await B.p.goto(base + `/missions/${r3[0].missionId}`, { waitUntil: 'domcontentloaded' });
  await B.p.getByRole('tab', { name: /Approvals/ }).click();
  const mini = B.p.locator('.approval-mini').first();
  await mini.waitFor({ timeout: 10000 });
  const ma = mini.getByRole('button', { name: /Approve once/ });
  check('mission tab: Approve once / Deny blocked with the reason on R3/R4', await gated(ma) && await gated(mini.getByRole('button', { name: 'Deny' })) && /administrator/i.test(await reasonOf(B.p, ma)));
  await ma.click({ force: true }); await frame(B.p);
  check('mission tab: clicking sends nothing', net.decisions.length === 0);
  check('mission tab fits 1366x768', await fits(B.p));
  await B.p.screenshot({ path: `${SHOTS}/member-mission-dark.png` });

  // ---- surface 4: Overview Approval Queue
  await B.p.goto(base + '/overview', { waitUntil: 'domcontentloaded' });
  const q = B.p.locator('.oa-appr').first();
  await q.waitFor({ timeout: 10000 });
  const rows = B.p.locator('.oa-appr');
  const n = await rows.count();
  let blockedRows = 0, openRows = 0;
  for (let i = 0; i < n; i++) { const ap = rows.nth(i).locator('button[aria-label^="Approve"]'); if (await gated(ap)) blockedRows++; else openRows++; }
  check('overview queue: rows of R3/R4 requests are blocked, and a click sends nothing', blockedRows > 0, `blocked ${blockedRows}, open ${openRows}`);
  const bad = rows.locator('button[aria-label^="Approve"][aria-disabled="true"]').first();
  await bad.click({ force: true }); await frame(B.p);
  check('overview queue: clicking a blocked icon sends nothing', net.decisions.length === 0);
  check('overview fits 1366x768', await fits(B.p));
  await settled(B.p);
  await B.p.screenshot({ path: `${SHOTS}/member-overview-dark.png` });

  // ---- member still decides an R2
  await B.p.goto(base + '/notifications?tab=pending', { waitUntil: 'domcontentloaded' });
  const r2Card = B.p.locator('.nt-appr').filter({ has: B.p.locator('.chip', { hasText: /^R2$/ }) }).first();
  await r2Card.waitFor({ timeout: 10000 });
  check('member: an R2 card is enabled and has no gate note', !(await gated(r2Card.getByRole('button', { name: 'Approve' }))) && (await r2Card.locator('[data-help-key="approval.gate"]').count()) === 0);
  await r2Card.getByRole('button', { name: 'Approve' }).click();
  check('member: approving an R2 sends one decision and it succeeds', await until(async () => net.decisions.length === 1 && ((await apiB('GET', '/approvals')).body.approvals ?? []).some((a) => a.id === r2[0].id && a.status === 'approved'), 8000));

  // ---- admin still decides
  await A.p.goto(base + '/notifications?tab=pending', { waitUntil: 'domcontentloaded' });
  const aCard = A.p.locator('.nt-appr').filter({ has: A.p.locator('.chip', { hasText: /^R3$/ }) }).first();
  await aCard.waitFor({ timeout: 10000 });
  check('admin: Approve and Deny are enabled on R3, no gate note, nothing changed', !(await gated(aCard.getByRole('button', { name: 'Approve' }))) && !(await gated(aCard.getByRole('button', { name: 'Deny' }))) && (await aCard.locator('[data-help-key="approval.gate"]').count()) === 0);
  await A.p.screenshot({ path: `${SHOTS}/admin-dark.png` });
  const before = ((await apiA('GET', '/approvals')).body.approvals ?? []).filter((a) => a.status === 'pending').length;
  await aCard.getByRole('button', { name: 'Approve' }).click();
  check('admin: approving an R3 decides it on the server', await until(async () => ((await apiA('GET', '/approvals')).body.approvals ?? []).filter((a) => a.status === 'pending').length === before - 1, 8000), `${before} -> ${before - 1}`);

  // ---- the member's whole network log
  check('no 403 (POLICY_DENIED) in the member browser network log', net.forbidden.length === 0, net.forbidden.slice(0, 3).join(' | '));

  // ---- light-mode screenshots
  const L = B;
  await L.p.evaluate(() => localStorage.setItem('axion.settings.v1', JSON.stringify({ state: { themeMode: 'light', skin: 'luminous', motion: 'reduced' }, version: 0 })));
  await L.p.goto(base + '/notifications?tab=pending', { waitUntil: 'domcontentloaded' });
  await L.p.locator('.nt-appr').first().waitFor({ timeout: 10000 });
  await settled(L.p);
  await L.p.screenshot({ path: `${SHOTS}/member-card-light.png` });
  const lg = L.p.locator('.nt-appr').filter({ has: L.p.locator('.chip', { hasText: /^R[34]$/ }) }).first();
  await lg.locator('[data-help-key="approval.tiers"]').click();
  await L.p.locator('.help-pop').waitFor({ timeout: 5000 });
  await L.p.screenshot({ path: `${SHOTS}/member-tiers-help-light.png` });
  check('light mode: member card fits 1366x768', await fits(L.p));
} catch (e) {
  check('script ran to the end', false, String(e && e.message || e).slice(0, 300));
}
check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await b.close();
const failed = results.filter((r) => r.startsWith('FAIL')).length;
console.log(`\n${results.length - failed} PASS, ${failed} FAIL`);
process.exit(failed ? 1 : 0);
