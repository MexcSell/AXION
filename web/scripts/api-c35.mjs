// Cycle 35 (lane w33), api mode: approval binding v2 in the UI.
// A member sees Approve/Deny disabled on R3/R4 cards with a `?` that says "needs an administrator", and still decides R2;
// the server refuses her anyway; an administrator can decide; the card shows tier, effect, target and origin.
// Run through scripts/api-e2e.sh (DEMO seed on). Screenshots: SHOTS (default /tmp/axion-c35).
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const base = process.env.BASE || 'http://127.0.0.1:5193';
const SHOTS = process.env.SHOTS || '/tmp/axion-c35';
mkdirSync(SHOTS, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.PW_CHROME || '/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome' });
const results = [];
const errors = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); console.log(results[results.length - 1]); };
const until = async (f, ms = 10000, step = 100) => { const t0 = Date.now(); for (;;) { try { if (await f()) return true; } catch { /* retry */ } if (Date.now() - t0 > ms) return false; await new Promise((r) => setTimeout(r, step)); } };
const open = async (label) => {
  const ctx = await b.newContext({ viewport: { width: 1600, height: 940 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('axion.data-mode', 'api'); localStorage.setItem('axion.testhook', '1'); } catch { /* ignore */ } });
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
let k = 0;
const key = () => `c35-${Date.now()}-${k++}`;
try {
  const A = await open('A');
  await A.p.goto(base + '/missions', { waitUntil: 'domcontentloaded' });
  await connect(A.p, 'Luca', 'secret-1');
  await A.p.waitForSelector('.rail-nav', { timeout: 20000 });
  const apiA = apiOf(A.p);

  const B = await open('B');
  await B.p.goto(base + '/missions', { waitUntil: 'domcontentloaded' });
  await connect(B.p, 'Mina', 'mina-pass');
  await B.p.getByRole('heading', { name: 'Waiting for approval' }).waitFor({ timeout: 10000 });
  const mina = ((await apiA('GET', '/users')).body.users ?? []).find((u) => u.name === 'Mina');
  await apiA('POST', `/users/${mina.id}/approve`, {});
  check('Mina connects after approval', await until(async () => (await B.p.locator('.rail-nav').count()) > 0, 15000));
  const apiB = apiOf(B.p);

  // an R2 approval lives on a private DEMO mission: the administrator shares that mission so the member can see it
  const aR2 = ((await apiA('GET', '/approvals')).body.approvals ?? []).find((a) => a.status === 'pending' && a.riskTier === 'R2');
  if (aR2) await apiA('POST', `/missions/${aR2.missionId}/share`, { shared: true }, { 'idempotency-key': key() });
  const list = (await apiB('GET', '/approvals')).body.approvals ?? [];
  const r3 = list.filter((a) => a.status === 'pending' && (a.riskTier === 'R3' || a.riskTier === 'R4'));
  const r2 = list.filter((a) => a.status === 'pending' && a.riskTier === 'R2');
  check('Mina sees pending R3/R4 and R2 approvals of shared missions', r3.length > 0 && r2.length > 0, `R3/R4 ${r3.length}, R2 ${r2.length}`);
  check('the server sends binding v2 with tier, effect and approver', r3.every((a) => a.digestVersion === 2 && a.effect && a.approver === 'admin' && a.consumed === false));

  // ---- member: disabled buttons + help on R3/R4
  await B.p.goto(base + '/notifications?tab=pending', { waitUntil: 'domcontentloaded' });
  const cards = B.p.locator('.nt-appr');
  await cards.first().waitFor({ timeout: 10000 });
  const gatedCard = cards.filter({ has: B.p.locator('.chip', { hasText: /^R[34]$/ }) }).first();
  await gatedCard.waitFor({ timeout: 8000 });
  check('member: Approve and Deny are disabled on an R3/R4 card', await gatedCard.getByRole('button', { name: 'Approve' }).isDisabled() && await gatedCard.getByRole('button', { name: 'Deny' }).isDisabled());
  const q = gatedCard.locator('[data-help-key="approval.gate"]');
  check('member: the card has a ? that names the reason', (await q.count()) === 1);
  await q.click();
  const pop = B.p.locator('.help-pop');
  check('member: the ? says it needs an administrator and why', await until(async () => /administrator/i.test(await pop.innerText()) && /live|who can do what|hard-to-undo/i.test(await pop.innerText())));
  await B.p.screenshot({ path: `${SHOTS}/member-gated.png` });
  await B.p.keyboard.press('Escape');
  const facts = await gatedCard.locator('[data-testid="approval-facts"]').innerText();
  check('the card shows the tier, the effect and who decides', /R3|R4/.test(facts) && /Administrator decides/.test(facts), facts.replace(/\n/g, ' | '));
  const fits = await B.p.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1 && document.documentElement.scrollWidth <= window.innerWidth + 1);
  check('the member page fits one screen', fits);

  // ---- member still decides R2
  const r2Card = cards.filter({ has: B.p.locator('.chip', { hasText: /^R2$/ }) }).first();
  check('member: an R2 card has enabled buttons and no gate help', (await r2Card.count()) === 1 && !(await r2Card.getByRole('button', { name: 'Approve' }).isDisabled()) && (await r2Card.locator('[data-help-key="approval.gate"]').count()) === 0);

  // ---- the server refuses the member anyway
  const t3 = r3[0];
  const refused = await apiB('POST', `/approvals/${t3.id}/decision`, { decision: 'approved', digest: t3.digest, reason: '' }, { 'idempotency-key': key() });
  check('the server refuses the member on R3/R4 (403 POLICY_DENIED)', refused.status === 403 && refused.body.code === 'POLICY_DENIED', `${refused.status} ${refused.body.code}`);

  // ---- target and origin appear on the card when the server has them (response rewritten in the browser only)
  await B.p.route('**/api/v1/approvals', async (route) => {
    const res = await route.fetch();
    const j = await res.json();
    if (j.approvals?.length) { j.approvals[0].target = 'homepage-preview'; j.approvals[0].origin = 'https://status.example.com'; }
    await route.fulfill({ response: res, json: j });
  });
  await B.p.goto(base + '/notifications?tab=pending', { waitUntil: 'domcontentloaded' });
  check('the card shows the exact target and origin', await until(async () => { const t = await B.p.locator('[data-testid="approval-facts"]').allInnerTexts(); return t.some((x) => x.includes('homepage-preview') && x.includes('https://status.example.com')); }));
  await B.p.screenshot({ path: `${SHOTS}/member-facts.png` });
  await B.p.unroute('**/api/v1/approvals');

  // ---- the dialog and the mission card also disable
  await B.p.goto(base + '/notifications?tab=pending', { waitUntil: 'domcontentloaded' });
  await B.p.locator('.nt-appr').first().waitFor({ timeout: 10000 });
  const g2 = B.p.locator('.nt-appr').filter({ has: B.p.locator('.chip', { hasText: /^R[34]$/ }) }).first();
  await g2.getByRole('button', { name: 'Details' }).click();
  const dlg = B.p.locator('[data-dialog="DL-48"]');
  await dlg.waitFor({ timeout: 8000 });
  check('member: the decision dialog disables Approve and Deny and has the ?', await dlg.getByRole('button', { name: /Approve/ }).isDisabled() && await dlg.getByRole('button', { name: /Deny/ }).isDisabled() && (await dlg.locator('[data-help-key="approval.gate"]').count()) === 1);
  await B.p.screenshot({ path: `${SHOTS}/member-dialog.png` });
  await B.p.keyboard.press('Escape');

  // ---- administrator decides
  await A.p.goto(base + '/notifications?tab=pending', { waitUntil: 'domcontentloaded' });
  const aCard = A.p.locator('.nt-appr').filter({ has: A.p.locator('.chip', { hasText: /^R3$/ }) }).first();
  await aCard.waitFor({ timeout: 10000 });
  check('admin: Approve and Deny are enabled on R3 and there is no gate help', !(await aCard.getByRole('button', { name: 'Approve' }).isDisabled()) && (await aCard.locator('[data-help-key="approval.gate"]').count()) === 0);
  await A.p.screenshot({ path: `${SHOTS}/admin.png` });
  const before = (await apiA('GET', '/approvals')).body.approvals.filter((a) => a.status === 'pending').length;
  await aCard.getByRole('button', { name: 'Approve' }).click();
  check('admin: approving an R3 card decides it on the server', await until(async () => ((await apiA('GET', '/approvals')).body.approvals ?? []).filter((a) => a.status === 'pending').length === before - 1, 8000), `${before} → ${before - 1}`);
  check('the member card list drops it live', await until(async () => { const l = (await apiB('GET', '/approvals')).body.approvals ?? []; return l.filter((a) => a.status === 'approved').length >= 1; }, 8000));
} catch (e) {
  check('script ran to the end', false, String(e && e.message || e).slice(0, 300));
}
check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await b.close();
const failed = results.filter((r) => r.startsWith('FAIL')).length;
console.log(`\n${results.length - failed} PASS, ${failed} FAIL`);
process.exit(failed ? 1 : 0);
