// Cycle 58 (lane w57), api mode: Rule-of-Two flags in the approval dialog, and the approval-quality records (admin only per approver).
// Admin (Luca) and member (Mina) sessions. Run through scripts/api-e2e.sh (DEMO seed on). The demo has four approvals and the statistics need five decisions, so it adds four more through server/src/cli/e2e-extra-approvals.ts. Screenshots: SHOTS (default /tmp/axion-c58), dark and light.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const base = process.env.BASE || 'http://127.0.0.1:5193';
const SHOTS = process.env.SHOTS || '/tmp/axion-c58';
mkdirSync(SHOTS, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.PW_CHROME || '/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome' });
const errors = [];
let fails = 0;
const check = (name, ok, extra = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };
const until = async (f, ms = 10000, step = 100) => { const t0 = Date.now(); for (;;) { try { if (await f()) return true; } catch { /* retry */ } if (Date.now() - t0 > ms) return false; await new Promise((r) => setTimeout(r, step)); } };
const frame = (p) => p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))));
const memberNet = { approvers: [], quality: [] };
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
const inView = (p, sel) => p.evaluate((s) => { const r = document.querySelector(s)?.getBoundingClientRect(); return !!r && r.top >= -1 && r.bottom <= window.innerHeight + 1 && r.left >= -1 && r.right <= window.innerWidth + 1; }, sel);
let k = 0;
const key = () => `c58-${Date.now()}-${k++}`;
try {
  const A = await open('A');
  await A.p.goto(base + '/missions', { waitUntil: 'domcontentloaded' });
  await connect(A.p, 'Luca', 'secret-1');
  await A.p.waitForSelector('.rail-nav', { timeout: 20000 });
  const apiA = apiOf(A.p);
  const B = await open('B');
  B.p.on('request', (r) => { if (/\/approvals\/quality\/approvers/.test(r.url())) memberNet.approvers.push(r.url()); else if (/\/approvals\/quality/.test(r.url())) memberNet.quality.push(r.url()); });
  await B.p.goto(base + '/missions', { waitUntil: 'domcontentloaded' });
  await connect(B.p, 'Mina', 'mina-pass');
  await B.p.getByRole('heading', { name: 'Waiting for approval' }).waitFor({ timeout: 10000 });
  const mina = ((await apiA('GET', '/users')).body.users ?? []).find((u) => u.name === 'Mina');
  await apiA('POST', `/users/${mina.id}/approve`, {});
  check('Mina connects after approval', await until(async () => (await B.p.locator('.rail-nav').count()) > 0, 15000));
  const apiB = apiOf(B.p);

  execFileSync('node', ['--env-file=.env', '--import', 'tsx', 'src/cli/e2e-extra-approvals.ts', '4'], { cwd: new URL('../../server/', import.meta.url).pathname, stdio: 'inherit' });

  // ---- server data: every request carries the server-derived record
  const list0 = (await apiA('GET', '/approvals')).body.approvals ?? [];
  const r2ok = list0.length > 0 && list0.every((a) => a.ruleOfTwo && ['untrustedInput', 'sensitiveAccess', 'canChangeState'].every((f) => typeof a.ruleOfTwo.flags[f] === 'boolean') && a.ruleOfTwo.fired === (a.ruleOfTwo.flags.untrustedInput && a.ruleOfTwo.flags.sensitiveAccess && a.ruleOfTwo.flags.canChangeState));
  check('every approval carries ruleOfTwo from the server (three booleans, fired = all three)', r2ok, `${list0.length} approvals`);
  check('nothing decided yet: no decisionRecord anywhere', list0.every((a) => a.decisionRecord === null));

  // ---- the approval dialog shows the flags in plain words, with a ?
  const target = list0.find((a) => a.status === 'pending' && a.riskTier === 'R3');
  const rewrite = (fired) => async (route) => {
    const res = await route.fetch(); const j = await res.json();
    for (const a of j.approvals ?? []) if (a.id === target.id) a.ruleOfTwo = fired
      ? { flags: { untrustedInput: true, sensitiveAccess: true, canChangeState: true }, because: { untrustedInput: ['site grant for https://example.com'], sensitiveAccess: ['action release (infra)'], canChangeState: ['action release (infra)'] }, fired: true, rule: 'rule_of_two', policyVersion: 1 }
      : { flags: { untrustedInput: false, sensitiveAccess: true, canChangeState: true }, because: { untrustedInput: [], sensitiveAccess: ['action release (infra)'], canChangeState: ['action release (infra)'] }, fired: false, rule: null, policyVersion: 1 };
    await route.fulfill({ response: res, json: j });
  };
  const showDialog = async (P, theme, fired) => {
    await P.route('**/api/v1/approvals', rewrite(fired));
    await P.goto(base + '/notifications?tab=pending', { waitUntil: 'domcontentloaded' });
    const card = P.locator('.nt-appr').filter({ hasText: target.title }).first();
    await card.waitFor({ timeout: 10000 });
    await card.getByRole('button', { name: 'Details' }).click();
    const dlg = P.locator('[data-dialog="DL-48"]');
    await dlg.waitFor({ timeout: 8000 });
    await dlg.locator('[data-testid="approval-rule-of-two"]').waitFor({ timeout: 8000 });
    await P.unroute('**/api/v1/approvals');
    return dlg;
  };
  const dlg = await showDialog(A.p, 'dark', true);
  const note = dlg.locator('[data-testid="approval-rule-of-two"]');
  const txt = await note.innerText();
  check('dialog: flags in plain words, fired state named', (await note.getAttribute('data-fired')) === 'yes' && /Reads content nobody vetted/.test(txt) && /Reaches live systems or sensitive data/.test(txt) && /Can change things or contact the outside/.test(txt) && /person must decide/.test(txt), txt.replace(/\s+/g, ' ').slice(0, 160));
  check('dialog: three flags, all on', (await note.locator('[data-on="yes"]').count()) === 3);
  check('dialog: a flag hover/title names its source', /site grant for https:\/\/example\.com/.test((await note.locator('[data-flag="untrustedInput"]').getAttribute('title')) ?? ''));
  await note.locator('[data-help-key="approval.ruleOfTwo"]').click();
  const pop = A.p.locator('.help-pop');
  check('dialog: the ? opens and says it is a heuristic, a stopgap', await until(async () => { const t = await pop.innerText(); return /heuristic/i.test(t) && /stopgap/i.test(t) && /never from what the agent or the requester wrote/i.test(t); }));
  await A.p.screenshot({ path: `${SHOTS}/dialog-flags-help-dark.png` });
  await A.p.keyboard.press('Escape');
  await A.p.waitForTimeout(0);
  check('dialog: fits inside 1366x768', await inView(A.p, '[data-dialog="DL-48"]'));
  await frame(A.p);
  await A.p.screenshot({ path: `${SHOTS}/dialog-flags-fired-dark.png` });
  await A.p.keyboard.press('Escape');
  const dlg2 = await showDialog(A.p, 'dark', false);
  check('dialog: not fired reads "Not all three at once" with two flags on', (await dlg2.locator('[data-testid="approval-rule-of-two"]').getAttribute('data-fired')) === 'no' && /Not all three at once/.test(await dlg2.locator('[data-testid="approval-rule-of-two"]').innerText()) && (await dlg2.locator('[data-on="yes"]').count()) === 2);
  await frame(A.p);
  await A.p.screenshot({ path: `${SHOTS}/dialog-flags-notfired-dark.png` });
  await A.p.keyboard.press('Escape');

  // ---- approval quality: before any decision
  await A.p.goto(base + '/notifications?tab=pending', { waitUntil: 'domcontentloaded' });
  await A.p.locator('[data-open-approval-quality]').click();
  const q = A.p.locator('[data-dialog="DL-100"]');
  await q.waitFor({ timeout: 8000 });
  await q.locator('[data-approval-quality="ready"]').waitFor({ timeout: 8000 });
  check('quality (admin, no decisions): "not enough evidence" with n = 0, no numbers', (await q.locator('[data-cell="rate"]').getAttribute('data-enough')) === 'no' && /not enough evidence/.test(await q.locator('[data-cell="rate"]').innerText()) && /n = 0/.test(await q.locator('[data-cell="rate"]').innerText()));
  check('quality: the window and the ? are shown', /last 30 days/.test(await q.innerText()) && (await q.locator('[data-help-key="approval.quality"]').count()) === 1);
  await frame(A.p);
  await A.p.screenshot({ path: `${SHOTS}/quality-empty-admin-dark.png` });
  await A.p.keyboard.press('Escape');

  // ---- admin decides every pending approval, quickly (R2 and above)
  const pend = list0.filter((a) => a.status === 'pending');
  const results = [];
  for (const [i, a] of pend.entries()) {
    const want = i % 4 === 3 ? 'denied' : 'approved';
    const r = await apiA('POST', `/approvals/${a.id}/decision`, { decision: want, digest: a.digest, reason: 'c58' }, { 'idempotency-key': key() });
    results.push({ id: a.id, want, status: r.status, state: r.body?.approval?.state, rec: r.body?.approval?.decisionRecord });
  }
  check(`admin decided ${pend.length} requests and every decision came out exactly as chosen (no flag changed any)`, pend.length >= 5 && results.every((r) => r.status === 200 && r.state === r.want), `${results.filter((r) => r.state === r.want).length}/${results.length}`);
  const flagged = results.filter((r) => r.rec?.fastBulk).length;
  check('the quick run is flagged (advisory) on at least one decision', flagged >= 1, `${flagged} flagged`);
  check('flagged decisions stood: still approved/denied as chosen', results.filter((r) => r.rec?.fastBulk).every((r) => r.state === r.want));
  const listA = (await apiA('GET', '/approvals')).body.approvals ?? [];
  const listB = (await apiB('GET', '/approvals')).body.approvals ?? [];
  const decided = listA.filter((a) => pend.some((p) => p.id === a.id));
  check('admin sees decisionRecord (latency, queue, flag) on decided requests', decided.length > 0 && decided.every((a) => a.decisionRecord && typeof a.decisionRecord.latencyMs === 'number' && a.decisionRecord.queueSize >= 1));
  check('a member never gets decisionRecord', listB.filter((a) => pend.some((p) => p.id === a.id)).every((a) => a.decisionRecord === null));
  check('member API: per-approver route is refused with 403', (await apiB('GET', '/approvals/quality/approvers')).status === 403);
  const qa = (await apiB('GET', '/approvals/quality')).body.quality;
  check('member API: the aggregate has numbers and names nobody', qa && qa.n >= 5 && qa.enough === true && typeof qa.approvalRate === 'number' && !JSON.stringify(qa).includes('Luca') && !('approvers' in qa));

  // ---- admin dialog with numbers and the per-approver table
  await A.p.goto(base + '/notifications?tab=pending', { waitUntil: 'domcontentloaded' });
  await A.p.locator('[data-open-approval-quality]').click();
  const q2 = A.p.locator('[data-dialog="DL-100"]');
  await q2.locator('[data-approval-quality="ready"]').waitFor({ timeout: 8000 });
  check('quality (admin): numbers shown, enough evidence', (await q2.locator('[data-cell="rate"]').getAttribute('data-enough')) === 'yes' && /%/.test(await q2.locator('[data-cell="rate"]').innerText()) && /\d/.test(await q2.locator('[data-cell="latency"]').innerText()));
  check('quality (admin): per-approver table lists Luca with n and a rate', await until(async () => (await q2.locator('[data-approvers="table"] [data-approver="Luca"]').count()) === 1) && /%/.test(await q2.locator('[data-approver="Luca"]').innerText()));
  check('quality (admin): fits 1366x768', await inView(A.p, '[data-dialog="DL-100"]'));
  await q2.getByRole('radio', { name: '7d' }).click();
  check('quality: switching the window re-reads (7d)', await until(async () => /last 7 days/.test(await q2.innerText())));
  await q2.locator('[data-help-key="approval.quality.approvers"]').click();
  check('quality: per-approver ? says administrators only and advisory', await until(async () => { const t = await A.p.locator('.help-pop').innerText(); return /administrators/i.test(t) && /advisory|never used to approve/i.test(t); }));
  await A.p.keyboard.press('Escape');
  await q2.getByRole('radio', { name: '30d' }).click();
  await frame(A.p);
  await A.p.screenshot({ path: `${SHOTS}/quality-admin-dark.png` });
  await A.p.keyboard.press('Escape');

  // ---- admin Resolved tab shows the record line; member does not
  await A.p.goto(base + '/notifications?tab=resolved', { waitUntil: 'domcontentloaded' });
  check('admin: Resolved decisions show "decided … after it was asked" lines', await until(async () => (await A.p.locator('[data-decision-record]').count()) > 0));
  check('admin: a quick run line says advisory only', flagged === 0 || (await A.p.locator('[data-decision-record="fast"]').count()) > 0);
  await B.p.goto(base + '/notifications?tab=resolved', { waitUntil: 'domcontentloaded' });
  await B.p.locator('.nt-two').waitFor({ timeout: 10000 });
  await frame(B.p);
  check('member: Resolved shows no decision records', (await B.p.locator('[data-decision-record]').count()) === 0);

  // ---- member dialog: aggregates only
  await B.p.goto(base + '/notifications?tab=pending', { waitUntil: 'domcontentloaded' });
  await B.p.locator('[data-open-approval-quality]').click();
  const q3 = B.p.locator('[data-dialog="DL-100"]');
  await q3.locator('[data-approval-quality="ready"]').waitFor({ timeout: 8000 });
  check('quality (member): totals shown', (await q3.locator('[data-cell="rate"]').getAttribute('data-enough')) === 'yes');
  check('quality (member): per-approver table is not rendered and says administrators only', (await q3.locator('[data-approvers="table"]').count()) === 0 && (await q3.locator('[data-approvers="hidden"]').count()) === 1 && !/Luca/.test(await q3.innerText()));
  check('quality (member): the browser never asked for the per-approver route', memberNet.approvers.length === 0 && memberNet.quality.length >= 1, `${memberNet.quality.length} aggregate reads`);
  check('quality (member): fits 1366x768', await inView(B.p, '[data-dialog="DL-100"]'));
  await frame(B.p);
  await B.p.screenshot({ path: `${SHOTS}/quality-member-dark.png` });
  await B.p.keyboard.press('Escape');

  // ---- light mode (the same admin session: a second sign-in would be a new device)
  await A.p.evaluate(() => { const s = JSON.parse(localStorage.getItem('axion.settings.v1') || '{"state":{}}'); s.state.themeMode = 'light'; localStorage.setItem('axion.settings.v1', JSON.stringify(s)); });
  const L = A;
  await L.p.goto(base + '/notifications?tab=pending', { waitUntil: 'domcontentloaded' });
  await L.p.locator('[data-open-approval-quality]').click();
  const q4 = L.p.locator('[data-dialog="DL-100"]');
  await q4.locator('[data-approval-quality="ready"]').waitFor({ timeout: 8000 });
  await q4.locator('[data-approver="Luca"]').waitFor({ timeout: 8000 });
  await frame(L.p);
  await L.p.screenshot({ path: `${SHOTS}/quality-admin-light.png` });
  await L.p.keyboard.press('Escape');
  await L.p.goto(base + '/notifications?tab=resolved', { waitUntil: 'domcontentloaded' });
  await L.p.locator('[data-decision-record]').first().waitFor({ timeout: 8000 });
  await L.p.screenshot({ path: `${SHOTS}/resolved-record-light.png` });
  check('light: resolved tab fits 1366x768', await fits(L.p));

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) {
  fails++;
  console.log('FAIL script error — ' + (e?.stack ?? e));
} finally {
  await b.close();
}
console.log(fails ? `RESULT: ${fails} FAIL` : 'RESULT: all PASS');
process.exit(fails ? 1 : 0);
