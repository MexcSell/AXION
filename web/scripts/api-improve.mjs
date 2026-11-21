// Improvement cycle 1 (theme A), api mode: organisation change proposals, end to end in three browsers.
// A (admin) proposes in Agents › Proposals and sees the server's dry run; B (second admin) approves; C (member) sees the
// proposals read-only and then watches Agents › Directory › Hierarchy pick up the new reporting line WITHOUT a reload.
// Run through scripts/api-e2e.sh (API 5192 on axion_e2e, reset on start; Vite 5193). Screenshots: SHOTS.
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const base = process.env.BASE || 'http://127.0.0.1:5193';
const SHOTS = process.env.SHOTS || '/tmp/axion-api-e2e';
// the committed screenshot is written only on request: DOC_SHOT=docs/screenshots/improve-c01-proposals-dark.png
const DOC_SHOT = process.env.DOC_SHOT;
mkdirSync(SHOTS, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.PW_CHROME || '/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome' });
const results = [];
const errors = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); console.log(results[results.length - 1]); };
const until = async (f, ms = 10000, step = 150) => { const t0 = Date.now(); for (;;) { try { if (await f()) return true; } catch { /* retry */ } if (Date.now() - t0 > ms) return false; await new Promise((r) => setTimeout(r, step)); } };
const browser = async (label) => {
  const ctx = await b.newContext({ viewport: { width: 1600, height: 940 } });
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
const PROPOSALS = '/operations?tab=agents&sub=proposals';
const HIERARCHY = '/operations?tab=agents&sub=directory&view=hierarchy';
const card = (p, id) => p.locator(`[data-proposal="${id}"]`);
let A, B, C;
try {
  // ------------------------------------------------------------ three people: A admin, B second admin, C member
  A = await browser('A');
  await A.p.goto(base + '/missions', { waitUntil: 'domcontentloaded' });
  await connect(A.p, 'Luca', 'secret-1');
  check('A (first user = administrator) is connected and live', await live(A.p));
  const apiA = apiOf(A.p);
  const join = async (label, name, pass, admin) => {
    const X = await browser(label);
    await X.p.goto(base + '/missions', { waitUntil: 'domcontentloaded' });
    await connect(X.p, name, pass);
    await X.p.getByRole('heading', { name: 'Waiting for approval' }).waitFor({ timeout: 10000 });
    const u = ((await apiA('GET', '/users')).body.users ?? []).find((x) => x.name === name);
    await apiA('POST', `/users/${u.id}/approve`, {});
    if (admin) await apiA('PATCH', `/users/${u.id}`, { role: 'admin' });
    await X.p.locator('.rail-nav').first().waitFor({ timeout: 15000 });
    return X;
  };
  B = await join('B', 'Bea', 'bea-pass', true);
  C = await join('C', 'Mina', 'mina-pass', false);
  check('B (second administrator) and C (member) are connected and live', (await live(B.p)) && (await live(C.p)));
  const g0 = (await apiA('GET', '/organization/graph')).body;
  check('the chart starts at revision 1 with Coder-01 reporting to the GM', g0.revision?.seq === 1 && g0.edges.find((e) => e.subordinateId === 'coder-01')?.supervisorId === 'gm');

  // ------------------------------------------------------------ C (member) waits on Proposals: read-only
  await C.p.goto(base + PROPOSALS, { waitUntil: 'domcontentloaded' });
  await C.p.locator('[data-proposals]').waitFor({ timeout: 10000 });
  check('C (member) sees the proposals panel read-only: no "New proposal", a Read only chip',
    await until(async () => (await C.p.getByText('Read only', { exact: true }).count()) > 0) && (await C.p.getByRole('button', { name: 'New proposal', exact: true }).count()) === 0);
  check('api mode: the Proposals panel carries no DEMO tag and no stage stepper', (await C.p.locator('[data-proposals] .demo-tag').count()) === 0 && (await C.p.locator('[data-proposals] .oa-stepper').count()) === 0);

  // ------------------------------------------------------------ A proposes through the dialog and sees the dry run
  await A.p.goto(base + PROPOSALS, { waitUntil: 'domcontentloaded' });
  await A.p.getByRole('button', { name: 'New proposal', exact: true }).click();
  const dlg = A.p.locator('[role="dialog"]').first();
  await dlg.getByText('from org revision 1').waitFor({ timeout: 10000 });
  await dlg.getByLabel('Agent 1', { exact: true }).selectOption('coder-01');
  await dlg.getByLabel('New manager 1', { exact: true }).selectOption('ops-01');
  check('the dialog shows the server dry run before submit: checks passed, Ops-01 → Coder-01 added, GM → Coder-01 removed',
    await until(async () => (await dlg.locator('[data-dialog-dry-run="done"] [data-dry-run="ok"]').count()) === 1
      && (await dlg.locator('[data-line="add"][data-from="ops-01"][data-to="coder-01"]').count()) === 1
      && (await dlg.locator('[data-line="rm"][data-from="gm"][data-to="coder-01"]').count()) === 1, 8000));
  // a second change that would loop is shown as an error by the dry run, then removed again
  await dlg.getByRole('button', { name: 'Add change' }).click();
  await dlg.getByLabel('Agent 2', { exact: true }).selectOption('ops-01');
  await dlg.getByLabel('New manager 2', { exact: true }).selectOption('coder-01');
  check('a loop in the dialog is a red dry-run error (CYCLE)', await until(async () => (await dlg.locator('[data-dialog-dry-run="done"] [data-dry-run="errors"] [data-issue="CYCLE"]').count()) > 0, 8000));
  await dlg.getByRole('button', { name: 'Remove change 2' }).click();
  await until(async () => (await dlg.locator('[data-dialog-dry-run="done"] [data-dry-run="ok"]').count()) === 1, 8000);
  await dlg.getByLabel('Why', { exact: true }).fill('Ops reviews every release: Coder-01 reports there.');
  await dlg.getByRole('button', { name: 'Submit proposal' }).click();
  check('the dialog closes after submit', await until(async () => (await dlg.count()) === 0, 8000));
  const list1 = (await apiA('GET', '/organization/proposals')).body.proposals;
  const P1 = list1[0];
  check('the server stored one pending proposal by Luca on base revision 1', list1.length === 1 && P1.status === 'pending' && P1.baseRevision === 1 && P1.createdByName === 'Luca' && P1.result.ok);
  check('A sees the card with its dry run, base revision and a Withdraw (not Approve) button',
    await until(async () => (await card(A.p, P1.id).count()) === 1 && (await card(A.p, P1.id).locator('[data-line="add"][data-from="ops-01"]').count()) === 1
      && (await card(A.p, P1.id).getByText('base rev 1').count()) === 1 && (await card(A.p, P1.id).getByRole('button', { name: 'Withdraw', exact: true }).count()) === 1
      && (await card(A.p, P1.id).getByRole('button', { name: 'Approve', exact: true }).count()) === 0, 8000));
  check('C (member) sees the new proposal arrive live, without any decision buttons',
    await until(async () => (await card(C.p, P1.id).count()) === 1, 10000) && (await card(C.p, P1.id).locator('button').count()) === 0);

  // ------------------------------------------------------------ a second proposal on the same base (made through the API)
  const P2r = await apiA('POST', '/organization/proposals', { title: 'Writer-01 under Ops-01', why: '', baseRevision: 1, edges: g0.edges.map((e) => (e.subordinateId === 'writer-01' ? { ...e, supervisorId: 'ops-01' } : e)) }, { 'idempotency-key': `c01-${Date.now()}` });
  const P2 = P2r.body.proposal;
  check('a second proposal on the same base is stored', P2r.status === 201 && P2?.baseRevision === 1);

  // ------------------------------------------------------------ C now watches the hierarchy (the last navigation in C)
  await C.p.goto(base + HIERARCHY, { waitUntil: 'domcontentloaded' });
  check('C\'s hierarchy shows org revision 1 and Coder-01 under the GM',
    await until(async () => (await C.p.locator('[data-org-revision]').getAttribute('data-org-revision')) === '1' && (await C.p.locator('[data-agent="coder-01"]').getAttribute('data-manager')) === 'gm', 10000));
  await C.p.evaluate(() => { window.__noReload = 'c01'; });
  let cNavs = 0;
  C.p.on('framenavigated', (f) => { if (f === C.p.mainFrame()) cNavs++; });

  // ------------------------------------------------------------ B decides: server errors inline, then approve
  await B.p.goto(base + PROPOSALS, { waitUntil: 'domcontentloaded' });
  await card(B.p, P1.id).waitFor({ timeout: 10000 });
  await B.p.getByRole('radio', { name: 'All', exact: true }).click(); // decided cards stay in view
  check('B (not the author) gets Approve and Reject with a note field', (await card(B.p, P1.id).getByRole('button', { name: 'Approve', exact: true }).count()) === 1 && (await card(B.p, P1.id).getByRole('button', { name: 'Reject', exact: true }).count()) === 1 && (await card(B.p, P1.id).getByLabel(/Decision note/).count()) === 1);
  // a decision request whose sha does not match is refused by the server: its message shows inline on the card
  await B.ctx.route(/\/organization\/proposals\/[^/]+\/decision$/, (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    return route.continue({ postData: JSON.stringify({ ...body, sha: '0'.repeat(64) }) });
  });
  await card(B.p, P2.id).getByRole('button', { name: 'Approve', exact: true }).click();
  check('PROPOSAL_CHANGED: the server message shows inline on the card', await until(async () => (await card(B.p, P2.id).locator('[role="alert"]').innerText()).includes('not the one you reviewed'), 8000));
  await B.ctx.unroute(/\/organization\/proposals\/[^/]+\/decision$/);
  await card(B.p, P1.id).getByLabel(/Decision note/).fill('Agreed in the Monday review.');
  await card(B.p, P1.id).getByRole('button', { name: 'Approve', exact: true }).click();
  check('B approves: the card says Applied, applied as rev 2', await until(async () => (await B.p.locator(`[data-proposal="${P1.id}"][data-status="applied"]`).getByText('applied as rev 2').count()) === 1, 10000));
  const g1 = (await apiA('GET', '/organization/graph')).body;
  check('the server\'s active revision is 2 with Coder-01 under Ops-01', g1.revision?.seq === 2 && g1.edges.find((e) => e.subordinateId === 'coder-01')?.supervisorId === 'ops-01');

  // ------------------------------------------------------------ C: the hierarchy follows live, no reload
  check('C\'s hierarchy shows revision 2 and Coder-01 reporting to Ops-01 — live',
    await until(async () => (await C.p.locator('[data-org-revision]').getAttribute('data-org-revision')) === '2' && (await C.p.locator('[data-agent="coder-01"]').getAttribute('data-manager')) === 'ops-01', 12000),
    `revision ${await C.p.locator('[data-org-revision]').getAttribute('data-org-revision').catch(() => '?')}, manager ${await C.p.locator('[data-agent="coder-01"]').getAttribute('data-manager').catch(() => '?')}`);
  check('C did not reload or navigate', (await C.p.evaluate(() => window.__noReload)) === 'c01' && cNavs === 0, `${cNavs} navigations`);
  check('C draws the new line Ops-01 → Coder-01', (await C.p.locator('path[data-from="ops-01"][data-to="coder-01"]').count()) === 1);
  await C.p.waitForTimeout(700);
  await C.p.screenshot({ path: `${SHOTS}/improve-c01-hierarchy-C.png` });

  // ------------------------------------------------------------ stale P2: shown as stale, can't be approved, can be rejected
  check('P2 is marked stale (rev 2 is active) and its Approve is off', await until(async () => (await card(B.p, P2.id).getByText('stale: rev 2 is active').count()) === 1 && await card(B.p, P2.id).getByRole('button', { name: 'Approve', exact: true }).isDisabled(), 10000));
  const stale = await apiOf(B.p)('POST', `/organization/proposals/${P2.id}/decision`, { decision: 'approve', sha: P2.sha });
  check('approving the stale proposal through the API is 409 ORG_CHANGED', stale.status === 409 && stale.body.code === 'ORG_CHANGED');
  const self = await apiA('POST', `/organization/proposals/${P2.id}/decision`, { decision: 'approve', sha: P2.sha });
  check('the author approving is 403 SELF_APPROVAL', self.status === 403 && self.body.code === 'SELF_APPROVAL');
  await card(B.p, P2.id).getByRole('button', { name: 'Reject', exact: true }).click();
  check('B rejects the stale proposal', await until(async () => (await apiA('GET', '/organization/proposals')).body.proposals.find((x) => x.id === P2.id)?.status === 'rejected', 8000));

  // ------------------------------------------------------------ expiry: the server's message stays on the card after its status changes
  // Only the e2e database (axion_e2e, emptied on every API start) is touched, to move one proposal's expiry into the past.
  const e2eUrl = /^E2E_DATABASE_URL=(.*)$/m.exec(readFileSync(new URL('../../server/.env', import.meta.url), 'utf8'))?.[1]?.trim().replace(/^['"]|['"]$/g, '');
  if (!e2eUrl || !/\/axion_e2e(\?|$)/.test(e2eUrl)) throw new Error('E2E_DATABASE_URL must point at axion_e2e');
  const g2 = (await apiA('GET', '/organization/graph')).body;
  const P3 = (await apiA('POST', '/organization/proposals', { title: 'Designer-01 under Ops-01', why: '', baseRevision: g2.revision.seq, edges: g2.edges.map((e) => (e.subordinateId === 'designer-01' ? { ...e, supervisorId: 'ops-01' } : e)) }, { 'idempotency-key': `c01-p3-${Date.now()}` })).body.proposal;
  await B.p.getByRole('radio', { name: /^Pending/ }).click();
  await card(B.p, P3.id).waitFor({ timeout: 10000 });
  const pg = createRequire(new URL('../../server/package.json', import.meta.url))('pg');
  const db = new pg.Client({ connectionString: e2eUrl });
  await db.connect();
  await db.query(`update org_proposals set expires_at = now() - interval '1 minute' where id=$1 and status='pending'`, [P3.id]);
  await db.end();
  await card(B.p, P3.id).getByRole('button', { name: 'Approve', exact: true }).click();
  check('PROPOSAL_EXPIRED: the server message stays on the card although it left the Pending filter, and the card says Expired',
    await until(async () => (await card(B.p, P3.id).locator('[role="alert"]').innerText()).includes('expired') && (await card(B.p, P3.id).getAttribute('data-status')) === 'expired', 8000));
  await B.p.getByRole('radio', { name: 'All', exact: true }).click();

  // ------------------------------------------------------------ fix round: a new agent is a new org revision, so a pending proposal turns stale live
  const g3 = (await apiA('GET', '/organization/graph')).body;
  const P4 = (await apiA('POST', '/organization/proposals', { title: 'Tester-01 under Ops-01', why: '', baseRevision: g3.revision.seq, edges: g3.edges.map((e) => (e.subordinateId === 'tester-01' ? { ...e, supervisorId: 'ops-01' } : e)) }, { 'idempotency-key': `c01-p4-${Date.now()}` })).body.proposal;
  await card(B.p, P4.id).waitFor({ timeout: 10000 });
  check('a fresh proposal is not stale and can be approved', (await card(B.p, P4.id).getByText(/^stale/).count()) === 0 && !(await card(B.p, P4.id).getByRole('button', { name: 'Approve', exact: true }).isDisabled()));
  const na = await apiA('POST', '/agents', { name: 'Archivist-01', role: 'archivist', dept: 'Operations', duty: 'Keeps the archive', model: 'claude-sonnet-5-5' }, { 'idempotency-key': `c01-agent-${Date.now()}` });
  check('creating an agent (a new org revision) marks the pending proposal stale live, Approve off', na.status === 201 && await until(async () => (await card(B.p, P4.id).getByText(`stale: rev ${g3.revision.seq + 1} is active`).count()) === 1 && await card(B.p, P4.id).getByRole('button', { name: 'Approve', exact: true }).isDisabled(), 10000));
  await apiA('POST', `/organization/proposals/${P4.id}/withdraw`, {});

  // ------------------------------------------------------------ A: live status, honest content, screenshot
  await A.p.getByRole('radio', { name: 'All', exact: true }).click();
  check('A sees both decisions live (Applied, Rejected) without reload', await until(async () => (await A.p.locator(`[data-proposal="${P1.id}"][data-status="applied"]`).count()) === 1 && (await A.p.locator(`[data-proposal="${P2.id}"][data-status="rejected"]`).count()) === 1, 10000));
  check('A\'s card shows who decided and the note', (await card(A.p, P1.id).innerText()).includes('Applied by Bea') && (await card(A.p, P1.id).innerText()).includes('Agreed in the Monday review.'));
  const txt = await A.p.locator('[data-proposals]').innerText();
  check('nothing invented: no percentages (coverage, latency, tokens) on the proposal cards', !/\d+\s*%/.test(txt) && !/coverage|latency|tokens/i.test(txt));
  check('member C reading via the API gets the same four proposals', (await apiOf(C.p)('GET', '/organization/proposals')).body.proposals?.length === 4);
  await A.p.getByRole('button', { name: /agent boards/i }).first().click({ timeout: 2000 }).catch(() => {}); // more room for the cards
  await A.p.waitForTimeout(900);
  if (DOC_SHOT) await A.p.screenshot({ path: DOC_SHOT });
  await A.p.screenshot({ path: `${SHOTS}/improve-c01-proposals-A.png` });
} catch (e) { check('script ran to the end', false, String(e).split('\n')[0]); }
for (const [X, l] of [[A, 'A'], [B, 'B'], [C, 'C']]) await X?.p.screenshot({ path: `${SHOTS}/improve-c01-end-${l}.png` }).catch(() => {});
console.log(errors.length ? 'PAGE ERRORS:\n' + errors.join('\n') : 'no page errors');
console.log(`${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
writeFileSync(`${SHOTS}/api-improve.txt`, results.join('\n') + '\n');
await b.close();
process.exit(results.some((r) => r.startsWith('FAIL')) || errors.length ? 1 : 0);
