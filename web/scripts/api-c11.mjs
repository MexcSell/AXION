// Improvement cycle 11 (theme A4), api mode: new real missions are staffed by the active organisation.
// A (admin) creates a mission before any change; A proposes "Writer-01 under Analyst-01, Coder-01 under Designer-01";
// B (second admin) approves it in Agents › Proposals. A's Add mission dialog then previews the new executor (a website
// mission is led by Designer-01, the Engineering head above Coder-01), A adds a research mission through the dialog, and
// its Hierarchy draws Writer-01 under Analyst-01. The mission created before the change keeps Writer-01 under Researcher-01.
// Run through scripts/api-e2e.sh (a fresh stack per script). DOC_SHOT=<png> writes the committed screenshot.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const base = process.env.BASE || 'http://127.0.0.1:5193';
const SHOTS = process.env.SHOTS || '/tmp/axion-api-e2e';
const DOC_SHOT = process.env.DOC_SHOT;
mkdirSync(SHOTS, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.PW_CHROME || '/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome' });
const results = [];
const errors = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); console.log(results[results.length - 1]); };
const until = async (f, ms = 10000, step = 150) => { const t0 = Date.now(); for (;;) { try { if (await f()) return true; } catch { /* retry */ } if (Date.now() - t0 > ms) return false; await new Promise((r) => setTimeout(r, step)); } };
const browser = async (label) => {
  const ctx = await b.newContext({ viewport: { width: 1600, height: 940 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('axion.data-mode', 'api'); if (!localStorage.getItem('axion.settings.v1')) localStorage.setItem('axion.settings.v1', JSON.stringify({ state: { themeMode: 'dark' }, version: 0 })); } catch { /* ignore */ } });
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
const node = (p, agent, parent) => p.locator(`.hnode[data-agent="${agent}"][data-parent="${parent}"]`);
const staffedOnServer = async (api, id) => (await api('GET', `/missions/${id}`)).body.mission?.staffing?.stage === 'working';
let A, B;
try {
  // ------------------------------------------------------------ A admin, B second admin
  A = await browser('A');
  await A.p.goto(base + '/missions', { waitUntil: 'domcontentloaded' });
  await connect(A.p, 'Luca', 'secret-1');
  check('A (first user = administrator) is connected and live', await live(A.p));
  const apiA = apiOf(A.p);
  B = await browser('B');
  await B.p.goto(base + '/missions', { waitUntil: 'domcontentloaded' });
  await connect(B.p, 'Bea', 'bea-pass');
  await B.p.getByRole('heading', { name: 'Waiting for approval' }).waitFor({ timeout: 10000 });
  const bea = ((await apiA('GET', '/users')).body.users ?? []).find((x) => x.name === 'Bea');
  await apiA('POST', `/users/${bea.id}/approve`, {});
  await apiA('PATCH', `/users/${bea.id}`, { role: 'admin' });
  await B.p.locator('.rail-nav').first().waitFor({ timeout: 15000 });
  check('B (second administrator) is connected and live', await live(B.p));

  // ------------------------------------------------------------ a mission staffed before the change
  const before = (await apiA('POST', '/missions', { text: 'Research competitor pricing.', files: [], shared: false }, { 'idempotency-key': 'c11-before' })).body.mission;
  check('a research mission created before the change is staffed by the server', !!before?.id && await until(() => staffedOnServer(apiA, before.id), 15000), before?.id);

  // ------------------------------------------------------------ A proposes, B approves in the UI
  const g0 = (await apiA('GET', '/organization/graph')).body;
  const moves = { 'writer-01': 'analyst-01', 'coder-01': 'designer-01' };
  const edges = g0.edges.map((e) => (moves[e.subordinateId] ? { ...e, supervisorId: moves[e.subordinateId] } : e));
  const P = (await apiA('POST', '/organization/proposals', { title: 'Writers under Analyst, Coder under Designer', why: 'c11 browser check.', baseRevision: g0.revision.seq, edges }, { 'idempotency-key': 'c11-prop' })).body.proposal;
  check('A proposed the change (pending)', P?.status === 'pending', P?.id);
  await B.p.goto(base + '/operations?tab=agents&sub=proposals', { waitUntil: 'domcontentloaded' });
  const card = B.p.locator(`[data-proposal="${P.id}"]`);
  await card.getByRole('button', { name: 'Approve', exact: true }).waitFor({ timeout: 15000 });
  await card.getByRole('button', { name: 'Approve', exact: true }).click();
  check('B approves in Agents › Proposals: applied as rev 2', await until(async () => (await B.p.locator(`[data-proposal="${P.id}"][data-status="applied"]`).getByText('applied as rev 2').count()) === 1, 10000));
  const g1 = (await apiA('GET', '/organization/graph')).body;
  check('the active org revision is 2 with the new lines', g1.revision?.seq === 2 && g1.edges.some((e) => e.subordinateId === 'writer-01' && e.supervisorId === 'analyst-01') && g1.edges.some((e) => e.subordinateId === 'coder-01' && e.supervisorId === 'designer-01'));

  // ------------------------------------------------------------ the Add mission dialog previews the org's choice
  await A.p.goto(base + '/missions', { waitUntil: 'domcontentloaded' });
  await A.p.locator('.rail-nav').first().waitFor({ timeout: 15000 });
  const flow = A.p.locator('[data-dialog="DL-01"] .ma-flow');
  await until(async () => { await A.p.getByRole('button', { name: 'Add mission' }).first().click(); return (await A.p.locator('[data-dialog="DL-01"]').count()) === 1; }, 10000, 600);
  const dlg = A.p.locator('[data-dialog="DL-01"]');
  await dlg.locator('textarea').fill('Build a website landing page for the shop.');
  check('the dialog previews Designer-01 (Engineering head above Coder-01) as the executor of a website mission, after the catalog follows rev 2',
    await until(async () => (await flow.innerText()).includes('Designer-01'), 10000), (await flow.innerText().catch(() => '')).replace(/\s+/g, ' '));
  await dlg.locator('textarea').fill('Research competitor pricing.');
  check('the dialog previews Researcher-01 for a research mission (R&D head)', await until(async () => (await flow.innerText()).includes('Researcher-01'), 6000));
  await dlg.locator('button', { hasText: 'Add mission' }).click();
  check('A lands on the new mission', await until(async () => /\/missions\/M-\d+/.test(A.p.url()), 10000));
  const after = (A.p.url().match(/\/missions\/(M-\d+)/) || [])[1];
  check('the new mission is staffed by the server', !!after && await until(() => staffedOnServer(apiA, after), 15000), after);
  const m = (await apiA('GET', `/missions/${after}`)).body.mission;
  check('the server recorded the org revision it staffed from (rev 2, R&D, head)', m?.staffing?.org?.revision === 2 && m.staffing.org.dept === 'R&D' && m.staffing.org.executorFrom === 'head', JSON.stringify(m?.staffing?.org));

  // ------------------------------------------------------------ the hierarchy shows the new structure
  await A.p.goto(`${base}/missions/${after}?tab=hierarchy`, { waitUntil: 'domcontentloaded' });
  check('the new mission\'s Hierarchy draws Writer-01 under Analyst-01', await until(async () => (await node(A.p, 'writer-01', 'analyst-01').count()) === 1, 12000),
    `${await A.p.locator('.hnode').count()} nodes`);
  check('…and Analyst-01 under the executor Researcher-01, the executor under the GM', (await node(A.p, 'analyst-01', 'researcher-01').count()) === 1 && (await node(A.p, 'researcher-01', 'gm').count()) === 1);
  const h = (await apiA('GET', `/missions/${after}/hierarchy`)).body;
  check('the server hierarchy agrees (writer-01 parent = analyst-01 instance)', h.nodes?.find((x) => x.agentId === 'writer-01')?.parent === `${after}:analyst-01`);
  await A.p.waitForTimeout(900); // node entry animation finishes before the screenshot
  await A.p.screenshot({ path: `${SHOTS}/improve-c11-hierarchy-after.png` });
  if (DOC_SHOT) await A.p.screenshot({ path: DOC_SHOT });

  await A.p.goto(`${base}/missions/${before.id}?tab=hierarchy`, { waitUntil: 'domcontentloaded' });
  check('the mission staffed before the change keeps Writer-01 under Researcher-01', await until(async () => (await node(A.p, 'writer-01', 'researcher-01').count()) === 1, 12000)
    && (await node(A.p, 'writer-01', 'analyst-01').count()) === 0);
  await A.p.screenshot({ path: `${SHOTS}/improve-c11-hierarchy-before.png` });
} catch (e) {
  check('script ran to the end', false, e instanceof Error ? e.message : String(e));
} finally {
  await b.close();
}
check('no page errors', errors.length === 0, errors.slice(0, 5).join(' | '));
const fails = results.filter((r) => r.startsWith('FAIL')).length;
console.log(`\napi-c11: ${results.length - fails}/${results.length} passed`);
process.exit(fails ? 1 : 0);
