// c51 fix F1 (api mode): the task drawer's Reassign button is for an administrator or the mission owner only.
// A non-owner member sees it disabled with a visible reason (aria-describedby), clicking opens no dialog and sends no request;
// the administrator, who owns the demo missions, can still reassign through the dialog (a member who owns a mission is tested on the server).
// Run through scripts/api-e2e.sh (lane ports: E2E_API_PORT/E2E_WEB_PORT). Condition waits only (no networkidle).
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
const base = process.env.BASE || 'http://127.0.0.1:5193';
const SHOTS = process.env.SHOTS || `/tmp/axion-api-c51-${new URL(base).port}`;
mkdirSync(SHOTS, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.PW_CHROME || '/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome' });
const results = [];
const errors = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); console.log(results[results.length - 1]); };
const until = async (f, ms = 10000, step = 150) => { const t0 = Date.now(); for (;;) { try { if (await f()) return true; } catch { /* retry */ } if (Date.now() - t0 > ms) return false; await new Promise((r) => setTimeout(r, step)); } };
const browser = async (label) => {
  const ctx = await b.newContext({ viewport: { width: Number(process.env.VW || 1600), height: Number(process.env.VH || 940) } });
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
const key = () => ({ 'idempotency-key': `c51-${Date.now()}-${k++}` });
let k = 0;
let A, B;
const REASON = /Only an administrator or the mission owner can reassign/;
const WHY = 'c51 e2e reassign';
try {
  A = await browser('A');
  await A.p.goto(base + '/missions', { waitUntil: 'domcontentloaded' });
  await connect(A.p, 'Luca', 'secret-1');
  check('A (administrator) is connected and live', await live(A.p));
  const apiA = apiOf(A.p);
  B = await browser('B');
  await B.p.goto(base + '/missions', { waitUntil: 'domcontentloaded' });
  await connect(B.p, 'Mia', 'mia-pass');
  await B.p.getByRole('heading', { name: 'Waiting for approval' }).waitFor({ timeout: 10000 });
  const mia = ((await apiA('GET', '/users')).body.users ?? []).find((x) => x.name === 'Mia');
  await apiA('POST', `/users/${mia.id}/approve`, {});
  await B.p.locator('.rail-nav').first().waitFor({ timeout: 15000 });
  check('B (member Mia) is approved, connected and live', await live(B.p));
  const apiB = apiOf(B.p);
  const agents = (await apiA('GET', '/agents')).body.agents;
  const nameOf = (id) => agents.find((a) => a.id === id).name;
  const movableIn = async (api, mid) => {
    const ts = (await api('GET', `/missions/${mid}/tasks`)).body;
    const hier = (await api('GET', `/missions/${mid}/hierarchy`)).body;
    const t = (Array.isArray(ts) ? ts : []).find((x) => !['running', 'passed', 'canceled'].includes(x.state) && x.owner);
    const to = t && hier.nodes.find((n) => n.agentId !== 'gm' && n.agentId !== t.owner);
    return t && to ? { task: t, to } : null;
  };
  const openTask = async (Y, mid, id) => {
    await Y.p.goto(`${base}/missions/${mid}?tab=task-flow`, { waitUntil: 'domcontentloaded' });
    await Y.p.locator(`[aria-label^="${id} "]`).first().click({ timeout: 15000 });
    await Y.p.locator('[role="dialog"]').first().waitFor({ timeout: 8000 });
  };

  // ---- B is not the owner of a shared DEMO mission (A owns the demo missions)
  const shared = ((await apiB('GET', '/missions')).body.missions ?? []).filter((m) => m.shared !== false);
  let demo = null;
  for (const m of shared) { const x = await movableIn(apiB, m.id); if (x) { demo = { mid: m.id, ...x }; break; } }
  check('B sees a shared mission owned by A with a movable task', !!demo, demo ? `${demo.mid} ${demo.task.id}` : '');
  await openTask(B, demo.mid, demo.task.id);
  const btn = B.p.getByTestId('reassign-btn');
  check('B (member, not the owner): Reassign is disabled', await until(async () => (await btn.count()) === 1 && await btn.isDisabled(), 8000));
  const why = B.p.getByTestId('reassign-why');
  check('B: the reason is visible', (await why.count()) === 1 && REASON.test(await why.innerText()) && await why.isVisible());
  check('B: the button points at the reason with aria-describedby', (await btn.getAttribute('aria-describedby')) === (await why.getAttribute('id')));
  const reqs = [];
  B.p.on('request', (r) => { if (/\/reassign/.test(r.url())) reqs.push(r.url()); });
  await btn.click({ force: true }).catch(() => {});
  await B.p.waitForTimeout(400);
  check('B: clicking opens no dialog and sends no request', reqs.length === 0 && (await B.p.locator('[role="dialog"]').filter({ hasText: 'Delegate / reassign task' }).count()) === 0);
  await B.p.screenshot({ path: `${SHOTS}/c51-member-disabled.png` });
  const forged = await apiB('POST', `/tasks/${demo.task.id}/reassign`, { toInstanceId: demo.to.instanceId, brief: { goal: 'Take over', acceptance: ['Done well'], capabilities: [{ kind: 'read' }], escalation: 'Ask the owner' } }, key());
  check('B: the server refuses the same reassign with 403 too', forged.status === 403, `${forged.status}`);

  const reassign = async (Y, mid, x, label) => {
    await openTask(Y, mid, x.task.id);
    const rb = Y.p.getByTestId('reassign-btn');
    check(`${label}: Reassign is enabled and no reason is shown`, await rb.isEnabled() && (await Y.p.getByTestId('reassign-why').count()) === 0);
    await rb.click();
    await Y.p.getByRole('button', { name: new RegExp(`^.*${nameOf(x.to.agentId)}`) }).first().click();
    await Y.p.getByPlaceholder(/needs browser specialist/).fill(WHY);
    await Y.p.getByLabel('Acceptance criteria').fill('The reassigned result is attached');
    await Y.p.getByRole('button', { name: 'Submit Reassignment' }).click();
    return until(async () => (await (label === 'A' ? apiA : apiB)('GET', `/tasks/${x.task.id}`)).body.task?.owner === x.to.agentId, 10000);
  };
  // ---- the administrator can still reassign (on the demo mission)
  check('A (administrator and owner of the demo mission) reassigns through the dialog', await reassign(A, demo.mid, demo, 'A'));

  // The mission owner as a member is covered on the server (c51-review-hardening.test.ts): real missions have no tasks, so the browser can only reach the demo missions, which the administrator owns.
  const overflow = await B.p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check('no horizontal overflow', !overflow);
} catch (e) { check('script ran to the end', false, String(e).split('\n')[0]); }
for (const [Y, l] of [[A, 'A'], [B, 'B']]) await Y?.p.screenshot({ path: `${SHOTS}/c51-end-${l}.png` }).catch(() => {});
console.log(errors.length ? 'PAGE ERRORS:\n' + errors.join('\n') : 'no page errors');
console.log(`${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
writeFileSync(`${SHOTS}/api-c51.txt`, results.join('\n') + '\n');
await b.close();
process.exit(results.some((r) => r.startsWith('FAIL')) || errors.length ? 1 : 0);
