// Improvement cycle 1 (theme A), api mode: organisation change proposals, end to end in three browsers.
// A (admin) proposes in Agents › Proposals and sees the server's dry run; B (second admin) approves; C (member) sees the
// proposals read-only and then watches Agents › Directory › Hierarchy pick up the new reporting line WITHOUT a reload.
// Improvement cycle 2 (theme B): the company scorecard. A fresh database shows "not enough evidence"; three real missions
// are driven to a final state with API user actions only (start, then cancel: complete/fail are system-only, so canceled
// is the honest terminal state reachable here); the Overview tile, the scorecard panel and the Missions header then show the
// server's numbers with n, live. A DEMO mission canceled the same way is counted only with "include DEMO missions" on.
// Improvement cycle 3 (theme C): agent reliability measured from recorded tasks. A fresh agent says "not enough evidence (0 of 5)";
// user actions on DEMO tasks (reassign, retry) make the open profile re-read live but never count (DEMO excluded).
// Pass-threshold 3b (n ≥ 5 reached through the API) is NOT MET: real missions have no tasks and passed/failed are system-only.
// SUPPLEMENTARY, a test-only seam like the c01 expiry step: real finished task rows written into axion_e2e show how the profile,
// list row and card render a server value, and user actions (reassign, retry) on those rows change it live.
// Run through scripts/api-e2e.sh (API 5192 on axion_e2e, reset on start; Vite 5193). Screenshots: SHOTS.
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { calm, requireE2eDatabase, inventedNumbers, DECISION_BUTTON } from './_session.mjs';
const base = process.env.BASE || 'http://127.0.0.1:5193';
const SHOTS = process.env.SHOTS || '/tmp/axion-api-e2e';
// the committed screenshots are written only on request: DOC_SHOT=docs/screenshots/improve-c01-proposals-dark.png,
// DOC_SHOT_C02=docs/screenshots/improve-c02-scorecard-dark.png, DOC_SHOT_C03=docs/screenshots/improve-c03-reliability-dark.png
const DOC_SHOT = process.env.DOC_SHOT;
const DOC_SHOT_C02 = process.env.DOC_SHOT_C02;
const DOC_SHOT_C03 = process.env.DOC_SHOT_C03;
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
  // in-flight GET /organization/proposals of this page (the c01 expiry step waits until every browser's re-read is done)
  let reads = 0;
  const isRead = (r) => r.method() === 'GET' && /\/api\/v1\/organization\/proposals(\?|$)/.test(r.url());
  p.on('request', (r) => { if (isRead(r)) reads++; });
  const doneRead = (r) => { if (isRead(r)) reads = Math.max(0, reads - 1); };
  p.on('requestfinished', doneRead); p.on('requestfailed', doneRead);
  p.proposalReads = () => reads;
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

  // ------------------------------------------------------------ c02: a fresh database has no evidence (no real mission exists yet)
  const tile = (p) => p.locator('.kt[aria-label^="Verified Success:"]');
  const staffedTile = (p) => p.locator('.kt[aria-label^="Staffed Agents:"]');
  const staffedFromServer = async () => {
    const ms = (await apiA('GET', '/missions')).body.missions;
    const live = new Set(ms.filter((m) => !m.demo && ['running', 'planning', 'verifying', 'waiting'].includes(m.status)).map((m) => m.id));
    return new Set(((await apiA('GET', '/agent-instances')).body.instances ?? []).filter((i) => !i.simulated && !i.endedAt && live.has(i.missionId)).map((i) => i.agentId)).size;
  };
  const scRow = (p, key) => p.locator(`[data-scorecard="ready"] [data-row="${key}"]`);
  await A.p.goto(base + '/overview', { waitUntil: 'domcontentloaded' });
  await A.p.locator('[data-scorecard="ready"]').waitFor({ timeout: 15000 });
  const sc0 = (await apiA('GET', '/company/scorecard')).body;
  const r0 = sc0.rows?.find((r) => r.key === 'verified_success_rate');
  check('c02 fresh database: the server has no evidence (verified success null, n=0, state none, demo excluded, 30d)', sc0.window === '30d' && sc0.includeDemo === false && r0?.value === null && r0?.n === 0 && r0?.state === 'none');
  check('c02 fresh database: the tile says "not enough evidence" with no %, n=0 under it',
    await until(async () => (await tile(A.p).getAttribute('aria-label')) === 'Verified Success: not enough evidence' && (await tile(A.p).locator('[data-kpi-n="0"]').count()) === 1, 8000)
      && !/%/.test(await tile(A.p).locator('.kpi-val').innerText()));
  check('c02 fresh database: the scorecard row shows "—" and n=0', (await scRow(A.p, 'verified_success_rate').getAttribute('data-state')) === 'none' && (await scRow(A.p, 'verified_success_rate').locator('.sc-val').innerText()) === '—' && (await scRow(A.p, 'verified_success_rate').locator('.sc-n').innerText()) === 'n=0');
  const top0 = await A.p.locator('.topboard').innerText();
  check('c02 api mode: no invented company numbers on the top board (no Tokens Today, no 96.4%, no trend delta, no DEMO health ring, no fixture "Active Agents")',
    !/Tokens Today|96\.4|Mission Success|Active Agents/.test(top0) && (await A.p.locator('.topboard .kpi-delta').count()) === 0 && (await A.p.locator('.cc-health[aria-label="Company health"]').count()) === 0);
  const staffed0 = await staffedFromServer();
  check('c02 fix I1: the agents tile counts staffed agents from the server (live real instances on real active missions): 0 on a fresh database',
    staffed0 === 0 && await until(async () => (await staffedTile(A.p).getAttribute('aria-label')) === `Staffed Agents: ${staffed0}` && (await staffedTile(A.p).locator(`[data-kpi-staffed="${staffed0}"]`).count()) === 1, 8000));
  // fix round m1: every other fixture-backed panel on the api-mode Overview is tagged DEMO
  const demoPanels = { pulse: ['Active Agents', 'Recent Verified Outcomes', 'Mission Pipeline', 'Verified Completions'], activity: ['Live Activity', 'Events by type', 'Most active agents'], health: ['System Health', 'Event Freshness', 'Queue Depth', 'Connectivity Checks'] };
  const untagged = [];
  for (const [t, titles] of Object.entries(demoPanels)) {
    await A.p.goto(base + `/overview?tab=${t}`, { waitUntil: 'domcontentloaded' });
    await A.p.locator('[data-scorecard="ready"]').waitFor({ timeout: 15000 });
    await calm(A.p);
    for (const title of titles) {
      const panel = A.p.locator('section.panel', { has: A.p.locator('h2.panel-title', { hasText: title }) }).first();
      if ((await panel.locator('.panel-head .demo-tag').count()) === 0) untagged.push(`${t}: ${title}`);
    }
  }
  check('c02 fix m1: every fixture-backed Overview panel carries a DEMO tag in api mode', untagged.length === 0, untagged.join(', '));
  await A.p.goto(base + '/overview', { waitUntil: 'domcontentloaded' });
  await A.p.locator('[data-scorecard="ready"]').waitFor({ timeout: 15000 });
  // 8 rows of cycle 2, plus cycle 38's two at the end (approved_by_non_owner, tasks_verified_by_review)
  check('c02 the scorecard panel lists all 10 rows with a ? each', (await A.p.locator('[data-scorecard="ready"] [data-row]').count()) === 10 && (await A.p.locator('[data-scorecard="ready"] [data-row] [data-help-key^="scorecard."]').count()) === 10);
  await A.p.goto(base + '/missions', { waitUntil: 'domcontentloaded' });
  await A.p.locator('.mw-list-head').waitFor({ timeout: 10000 });
  // ABSENCE WAIT (kept, 600 ms as before): asserting the list header never shows a success rate once the list has loaded; no condition can signal "never".
  await A.p.waitForTimeout(600);
  check('c02 fresh database: the Missions list header shows no success rate', !/%|success/.test(await A.p.locator('.mw-list-head').innerText()));
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
    await until(async () => (await card(C.p, P1.id).count()) === 1, 10000) && (await card(C.p, P1.id).getByRole('button', { name: DECISION_BUTTON }).count()) === 0 && (await card(C.p, P1.id).getByLabel(/Decision note/).count()) === 0);

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
  await calm(C.p);
  await C.p.screenshot({ path: `${SHOTS}/improve-c01-hierarchy-C.png` });

  // ------------------------------------------------------------ stale P2: shown as stale, can't be approved, can be rejected
  check('P2 is marked stale (rev 2 is active) and its Approve is off', await until(async () => (await card(B.p, P2.id).getByText('stale: rev 2 is active').count()) === 1 && await card(B.p, P2.id).getByRole('button', { name: 'Approve', exact: true }).isDisabled(), 10000));
  const stale = await apiOf(B.p)('POST', `/organization/proposals/${P2.id}/decision`, { decision: 'approve', sha: P2.sha });
  check('approving the stale proposal through the API is 409 ORG_CHANGED', stale.status === 409 && stale.body.code === 'ORG_CHANGED');
  const self = await apiA('POST', `/organization/proposals/${P2.id}/decision`, { decision: 'approve', sha: P2.sha });
  check('the author approving is 403 SELF_APPROVAL', self.status === 403 && self.body.code === 'SELF_APPROVAL');
  await card(B.p, P2.id).getByRole('button', { name: 'Reject', exact: true }).click();
  check('B rejects the stale proposal', await until(async () => (await apiA('GET', '/organization/proposals')).body.proposals.find((x) => x.id === P2.id)?.status === 'rejected', 8000));

  // ------------------------------------------------------------ c04: organisation history, before/after diff, rollback through a proposal
  // Revisions 1 (seed) and 2 (P1: Coder-01 moved from the GM to Ops-01) exist and nothing is pending. A opens History, sees the
  // diff of revision 2, proposes a rollback to revision 1 (an ordinary proposal), B approves it, revision 3 equals revision 1 and
  // C's Hierarchy shows the old line again, live. Running instances are read (SELECT only) from the lane's e2e database before
  // and after: their managers never change.
  const e2eUrl = requireE2eDatabase();
  const norm4 = (es) => es.map((e) => `${e.supervisorId}>${e.subordinateId}:${e.edgeType}`).sort().join('|');
  const rev1 = (await apiA('GET', '/organization/revisions/1')).body.revision;
  const rev2 = (await apiA('GET', '/organization/revisions/2')).body.revision;
  check('c04 server: revision 1 is the seed, revision 2 came from P1 (by Bea), 1 line changed', rev1?.source?.kind === 'seed' && rev2?.appliedFromProposal === P1.id && rev2?.createdByName === 'Bea' && rev2?.changed === 1);
  const hist = (p) => p.locator('[data-org-history]');
  const revCard = (p, seq) => p.locator(`[data-org-history] [data-revision="${seq}"]`);
  const diffBox = (p, seq) => p.locator(`[data-org-history] [data-diff="${seq}"][data-diff-state="ready"]`);
  await A.p.getByRole('radio', { name: 'History', exact: true }).click();
  await hist(A.p).waitFor({ timeout: 10000 });
  check('c04 A opens History: one card per revision, newest first (2, 1); revision 2 names P1 and "1 line changed", revision 1 says seed',
    await until(async () => JSON.stringify(await A.p.locator('[data-org-history] [data-revision]').evaluateAll((els) => els.map((e) => e.getAttribute('data-revision')))) === '["2","1"]', 8000)
      && (await revCard(A.p, 2).getAttribute('data-source')) === 'proposal' && (await revCard(A.p, 2).innerText()).includes(P1.title) && (await revCard(A.p, 2).innerText()).includes('1 line changed')
      && (await revCard(A.p, 2).innerText()).includes('by Bea') && (await revCard(A.p, 1).getAttribute('data-source')) === 'seed' && (await revCard(A.p, 1).innerText()).includes('seed'));
  const d2 = (await apiA('GET', '/organization/revisions/2/diff')).body;
  check('c04 server diff of revision 2: exactly one moved line (Coder-01: GM → Ops-01), nothing added or removed', d2.against === 1 && JSON.stringify(d2.moved) === JSON.stringify([{ subordinate: 'coder-01', from: 'gm', to: 'ops-01' }]) && d2.added.length === 0 && d2.removed.length === 0);
  check('c04 A sees the diff of revision 2 (selected, the active one): exactly that moved line, no added or removed line',
    await until(async () => (await diffBox(A.p, 2).count()) === 1, 8000)
      && (await diffBox(A.p, 2).locator('[data-moved]').count()) === 1 && (await diffBox(A.p, 2).locator('[data-moved="coder-01"][data-from="gm"][data-to="ops-01"]').count()) === 1
      && (await diffBox(A.p, 2).locator('[data-line]').count()) === 0 && /Coder-01\s*:\s*GM\s*Ops-01/.test(await diffBox(A.p, 2).locator('[data-moved]').innerText()));
  const shownImpact = await diffBox(A.p, 2).locator('[data-impact-mission]').evaluateAll((els) => els.map((e) => e.getAttribute('data-impact-mission')));
  check('c04 the affected active missions are the server\'s (visible, not final), each a link to its mission', shownImpact.join(',') === d2.impact.map((x) => x.missionId).join(',')
    && (await diffBox(A.p, 2).locator('[data-impact-mission] a[href^="/missions/"]').count()) === d2.impact.length
    && d2.impact.every((x) => x.agentId === 'coder-01'), `${d2.impact.length} affected: ${shownImpact.join(',')}`);
  check('c04 the active revision (2) has no rollback button', (await diffBox(A.p, 2).getByRole('button', { name: 'Propose rollback to this revision' }).count()) === 0);
  await revCard(A.p, 1).click();
  await diffBox(A.p, 1).waitFor({ timeout: 8000 });
  const rb = () => diffBox(A.p, 1).getByRole('button', { name: 'Propose rollback to this revision' });
  check('c04 A selects revision 1: compared with no revision (all lines new), and A gets "Propose rollback to this revision"', (await diffBox(A.p, 1).locator('[data-line="add"]').count()) === rev1.edges.length && (await rb().count()) === 1);
  // instances of running missions, read before the rollback (SELECT only)
  const pg4 = createRequire(new URL('../../server/package.json', import.meta.url))('pg');
  const managers = async () => { const db = new pg4.Client({ connectionString: e2eUrl }); await db.connect(); try { return (await db.query('select id, manager_instance_id from agent_instances order by id')).rows; } finally { await db.end(); } };
  const inst0 = await managers();
  await diffBox(A.p, 1).getByLabel('Why roll back to revision 1').fill('Ops-01 is overloaded: Coder-01 goes back to the GM.');
  await rb().click();
  const PR = await (async () => { let x; await until(async () => (x = (await apiA('GET', '/organization/proposals')).body.proposals.find((p) => p.title === 'Roll back to revision 1')), 8000); return x; })();
  check('c04 server: a pending proposal "Roll back to revision 1" on base 2 by Luca, its lines exactly revision 1\'s', PR?.status === 'pending' && PR.baseRevision === 2 && PR.createdByName === 'Luca' && norm4(PR.edges) === norm4(rev1.edges) && PR.why.startsWith('Ops-01 is overloaded'));
  check('c04 A is switched to Proposals (Pending) with the new proposal highlighted; its dry run shows the reverse move (+ GM → Coder-01, − Ops-01 → Coder-01)',
    await until(async () => (await A.p.locator(`[data-proposals] [data-proposal="${PR.id}"][data-highlight="1"]`).count()) === 1, 8000)
      && (await A.p.getByRole('radio', { name: /^Pending/ }).getAttribute('aria-checked')) === 'true'
      && (await card(A.p, PR.id).locator('[data-line="add"][data-from="gm"][data-to="coder-01"]').count()) === 1 && (await card(A.p, PR.id).locator('[data-line="rm"][data-from="ops-01"][data-to="coder-01"]').count()) === 1
      && (await card(A.p, PR.id).locator('[data-dry-run="ok"]').count()) === 1 && (await card(A.p, PR.id).getByRole('button', { name: 'Approve', exact: true }).count()) === 0);
  // 409: the same rollback again is a duplicate; the server message shows inline
  await A.p.getByRole('radio', { name: 'History', exact: true }).click();
  await revCard(A.p, 1).click();
  await diffBox(A.p, 1).waitFor({ timeout: 8000 });
  await rb().click();
  check('c04 409 DUPLICATE_PROPOSAL: a second rollback to revision 1 shows the server message inline', await until(async () => /already waiting for a decision/.test(await diffBox(A.p, 1).locator('[role="alert"]').innerText()), 8000));
  // C keeps watching the Hierarchy (revision 2, Coder-01 under Ops-01): a fresh no-reload marker
  check('c04 C\'s hierarchy is still on revision 2', (await C.p.locator('[data-org-revision]').getAttribute('data-org-revision')) === '2');
  await C.p.evaluate(() => { window.__noReload = 'c04'; });
  const cNavs0 = cNavs;
  // B approves it from its Proposals (All) list
  await card(B.p, PR.id).waitFor({ timeout: 10000 });
  check('c04 B sees the rollback proposal live with Approve (B is not the author)', (await card(B.p, PR.id).getByRole('button', { name: 'Approve', exact: true }).count()) === 1);
  await card(B.p, PR.id).getByRole('button', { name: 'Approve', exact: true }).click();
  check('c04 B approves: applied as rev 3', await until(async () => (await B.p.locator(`[data-proposal="${PR.id}"][data-status="applied"]`).getByText('applied as rev 3').count()) === 1, 10000));
  const rev3 = (await apiA('GET', '/organization/revisions/3')).body.revision;
  check('c04 server: revision 3 has the same lines as revision 1 and came from the rollback proposal', norm4(rev3?.edges ?? []) === norm4(rev1.edges) && rev3.appliedFromProposal === PR.id && rev3.source?.title === 'Roll back to revision 1');
  check('c04 C\'s Hierarchy shows the old line again (revision 3, Coder-01 under the GM), live, without reload',
    await until(async () => (await C.p.locator('[data-org-revision]').getAttribute('data-org-revision')) === '3' && (await C.p.locator('[data-agent="coder-01"]').getAttribute('data-manager')) === 'gm', 12000)
      && (await C.p.locator('path[data-from="gm"][data-to="coder-01"]').count()) === 1 && (await C.p.evaluate(() => window.__noReload)) === 'c04' && cNavs === cNavs0);
  check('c04 A\'s History shows revision 3 live (newest first), from "Roll back to revision 1", with the reverse move',
    await until(async () => (await A.p.locator('[data-org-history] [data-revision]').first().getAttribute('data-revision')) === '3' && (await A.p.locator('[data-history-latest="3"]').count()) === 1, 10000)
      && (await revCard(A.p, 3).innerText()).includes('Roll back to revision 1'));
  // 422, the natural way (review m4): revision 1 now has the same lines as the active revision 3, so there is nothing to roll back
  await revCard(A.p, 1).click();
  await diffBox(A.p, 1).waitFor({ timeout: 8000 });
  await rb().click();
  check('c04 422 NOTHING_TO_ROLL_BACK: revision 1 equals the active revision 3; the server message shows inline', await until(async () => /same reporting lines as the active revision 3: there is nothing to roll back/.test(await diffBox(A.p, 1).locator('[role="alert"]').innerText()), 8000));
  check('c04 revision 1 (the first) lists no affected mission: every line was new, nobody\'s manager changed', (await diffBox(A.p, 1).locator('[data-impact="none"]').innerText()).includes('The first revision'));
  await revCard(A.p, 3).click();
  check('c04 the diff of revision 3: Coder-01: Ops-01 → GM, and the same affected missions', await until(async () => (await diffBox(A.p, 3).locator('[data-moved="coder-01"][data-from="ops-01"][data-to="gm"]').count()) === 1, 8000)
    && (await diffBox(A.p, 3).locator('[data-impact-mission]').count()) === d2.impact.length);
  const inst1 = await managers();
  check('c04 running missions untouched: every instance keeps manager_instance_id after the rollback (e2e database, SELECT only)', inst0.length > 0 && JSON.stringify(inst1.filter((x) => inst0.some((y) => y.id === x.id))) === JSON.stringify(inst0), `${inst0.length} instances`);
  const txt4 = await hist(A.p).innerText();
  // c04's intent: the History panel invents no numbers (no percentages, no latency/token figures, no estimates). Since c20 the panel
  // legitimately shows the server's structure facts ("Structure in this revision", the word "coverage" in help), so the word alone is
  // no longer banned: what stays forbidden is a coverage CLAIM, i.e. the word next to a figure, ratio, percentage or score.
  const claim4 = /\d+\s*%|latency|tokens|estimate|coverage\W{0,3}(?:score|rate|ratio|level|index|of\s+\d|\d)|\d+(?:\.\d+)?\s*(?:\/\s*\d+\s*)?(?:of\s+\d+\s*)?(?:%\s*)?coverage/i.exec(txt4);
  check('c04 nothing invented in the History view (no percentages, no latency/tokens/estimates, no coverage figure or score; the word coverage alone is allowed)', !claim4, claim4 ? `found: ${claim4[0]}` : '');
  check('c04 the History panel head (title, Proposals | History switch) is on screen', await A.p.locator('[data-org-history] .panel-head').isVisible() && await A.p.locator('[data-org-history] .panel-head').evaluate((el) => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }));
  // the screenshot: no toasts, the agent boards folded (unfolded again after), the pointer away
  for (const x of await A.p.getByRole('button', { name: 'Dismiss notification' }).all()) await x.click().catch(() => {});
  await until(async () => (await A.p.getByRole('button', { name: 'Dismiss notification' }).count()) === 0, 5000);
  const boards = A.p.getByRole('button', { name: /agent boards/i }).first();
  await boards.click({ timeout: 2000 }).catch(() => {});
  await A.p.mouse.move(5, 5);
  // settled: no toast, the agent boards folded, the diff card fully shown (its enter animation done), no element of the panel still animating
  const settled4 = async () => (await A.p.getByRole('button', { name: 'Dismiss notification' }).count()) === 0
    && (await A.p.locator('.bottomboard.folded').count()) === 1 && (await A.p.locator('.bottomboard .bb-grid').count()) === 0 // fold animation finished
    && (await diffBox(A.p, 3).evaluate((el) => getComputedStyle(el).opacity === '1' && el.getAnimations({ subtree: true }).every((a) => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity)));
  await until(settled4, 6000);
  if (process.env.DOC_SHOT_C04) await A.p.screenshot({ path: process.env.DOC_SHOT_C04 });
  await A.p.screenshot({ path: `${SHOTS}/improve-c04-history-A.png` });
  await boards.click({ timeout: 2000 }).catch(() => {});
  await A.p.setViewportSize({ width: 1366, height: 768 });
  let fit4 = {};
  const fits4 = async () => { fit4 = await A.p.evaluate(() => { const d = document.scrollingElement; return { iw: innerWidth, over: d.scrollHeight - d.clientHeight, w: d.scrollWidth - d.clientWidth }; }); return fit4.iw === 1366 && fit4.over <= 1 && fit4.w <= 1; };
  check('c04 at 1366x768 the History view fits (no page scroll, no sideways scroll), the diff visible', await until(fits4, 6000) && await diffBox(A.p, 3).isVisible(), JSON.stringify(fit4));
  await A.p.screenshot({ path: `${SHOTS}/improve-c04-history-1366x768.png` });
  await A.p.setViewportSize({ width: 1600, height: 940 });
  await A.p.getByRole('radio', { name: 'Proposals', exact: true }).click();
  await A.p.locator('[data-proposals]').waitFor({ timeout: 8000 });
  // C (member) reads the same history: read only, no rollback button; her impact list is her own view's (server)
  await C.p.goto(base + PROPOSALS, { waitUntil: 'domcontentloaded' });
  await C.p.getByRole('radio', { name: 'History', exact: true }).click();
  await C.p.locator('[data-org-history]').waitFor({ timeout: 10000 });
  await revCard(C.p, 2).click();
  const dC = (await apiOf(C.p)('GET', '/organization/revisions/2/diff')).body;
  check('c04 member C: History is read only (Read only chip, no rollback button on the earlier revision 2), the diff shows the missions she can see',
    await until(async () => (await diffBox(C.p, 2).count()) === 1, 8000) && (await C.p.locator('[data-org-history]').getByText('Read only', { exact: true }).count()) === 1
      && (await C.p.getByRole('button', { name: 'Propose rollback to this revision' }).count()) === 0
      && JSON.stringify(await diffBox(C.p, 2).locator('[data-impact-mission]').evaluateAll((els) => els.map((e) => e.getAttribute('data-impact-mission')))) === JSON.stringify(dC.impact.map((x) => x.missionId)), `${dC.impact.length} visible to C`);

  // ------------------------------------------------------------ expiry: the server's message stays on the card after its status changes
  // Only the e2e database (axion_e2e, emptied on every API start) is touched, to move one proposal's expiry into the past.
  // (e2eUrl: read and guarded in the c04 step above)
  const g2 = (await apiA('GET', '/organization/graph')).body;
  const P3 = (await apiA('POST', '/organization/proposals', { title: 'Designer-01 under Ops-01', why: '', baseRevision: g2.revision.seq, edges: g2.edges.map((e) => (e.subordinateId === 'designer-01' ? { ...e, supervisorId: 'ops-01' } : e)) }, { 'idempotency-key': `c01-p3-${Date.now()}` })).body.proposal;
  await B.p.getByRole('radio', { name: /^Pending/ }).click();
  await card(B.p, P3.id).waitFor({ timeout: 10000 });
  // Deterministic, no timing luck (cycle 8): any read of the proposals list that B's page makes after the expiry below would
  // expire P3 on the server and take its card out of the Pending filter before the Approve click. So B's reads of that list are
  // held at the network from here until the click has been made; the decision POST is not held. Every read B made earlier has
  // already been answered with P3 pending (the card is on screen), and nothing else can change B's DOM.
  let openGate; const gate = new Promise((r) => { openGate = r; });
  const holdReads = async (route) => { if (route.request().method() !== 'GET') return route.continue(); await gate; await route.continue().catch(() => undefined); };
  await B.p.route(/\/api\/v1\/organization\/proposals(\?.*)?$/, holdReads);
  check('c01 expiry step: P3 is pending in A and B', await until(async () => (await A.p.locator(`[data-proposal="${P3.id}"][data-status="pending"]`).count()) === 1
    && (await B.p.locator(`[data-proposal="${P3.id}"][data-status="pending"]`).count()) === 1, 10000));
  const pg = createRequire(new URL('../../server/package.json', import.meta.url))('pg');
  const db = new pg.Client({ connectionString: e2eUrl });
  await db.connect();
  await db.query(`update org_proposals set expires_at = now() - interval '1 minute' where id=$1 and status='pending'`, [P3.id]);
  await db.end();
  await card(B.p, P3.id).getByRole('button', { name: 'Approve', exact: true }).click();
  openGate(); // the decision is on its way; B's re-reads may now be answered (P3 is expired on the server)
  check('PROPOSAL_EXPIRED: the server message stays on the card although it left the Pending filter, and the card says Expired',
    await until(async () => (await card(B.p, P3.id).locator('[role="alert"]').innerText()).includes('expired') && (await card(B.p, P3.id).getAttribute('data-status')) === 'expired', 8000));
  await B.p.unroute(/\/api\/v1\/organization\/proposals(\?.*)?$/, holdReads);
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
  check('nothing invented: no percentage and no number beside coverage, latency or tokens on the proposal cards', inventedNumbers(txt).length === 0, inventedNumbers(txt).join(' | '));
  check('member C reading via the API gets the same five proposals (four of cycle 1, the c04 rollback)', (await apiOf(C.p)('GET', '/organization/proposals')).body.proposals?.length === 5);
  await A.p.getByRole('button', { name: /agent boards/i }).first().click({ timeout: 2000 }).catch(() => {}); // more room for the cards
  await calm(A.p);
  if (DOC_SHOT) await A.p.screenshot({ path: DOC_SHOT });
  await A.p.screenshot({ path: `${SHOTS}/improve-c01-proposals-A.png` });

  // ------------------------------------------------------------ c02: three real missions reach a final state (API user actions), live
  await A.p.goto(base + '/overview', { waitUntil: 'domcontentloaded' });
  await A.p.locator('[data-scorecard="ready"]').waitFor({ timeout: 15000 });
  await A.p.evaluate(() => { window.__noReload = 'c02'; });
  const act = async (id, action) => {
    for (let i = 0; i < 8; i++) {
      const r = await apiA('POST', `/missions/${id}/actions/${action}`, {}, { 'idempotency-key': `c02-${id}-${action}-${i}-${Date.now()}` });
      if (r.status === 200) return r.body.mission;
      if (r.status === 409 && action === 'start' && (await apiA('GET', `/missions/${id}`)).body.mission?.serverStatus === 'running') return null; // the staffing step started it meanwhile
      await new Promise((res) => setTimeout(res, 250));
    }
    throw new Error(`${action} ${id} failed`);
  };
  const real = [];
  for (let i = 0; i < 3; i++) {
    const m = (await apiA('POST', '/missions', { text: `Scorecard check ${i + 1}: compare two backup tools and list their limits.`, files: [], shared: false }, { 'idempotency-key': `c02-new-${i}-${Date.now()}` })).body.mission;
    await act(m.id, 'start');
    await act(m.id, 'cancel');
    real.push(m.id);
  }
  const sc1 = (await apiA('GET', '/company/scorecard')).body;
  const by1 = Object.fromEntries(sc1.rows.map((r) => [r.key, r]));
  check('c02 the server counts the 3 canceled missions: finished 3, verified success 0% with n=3 (ok), failure rate 100%, 3 missions started',
    by1.finished.value === 3 && by1.verified_success_rate.state === 'ok' && by1.verified_success_rate.value === 0 && by1.verified_success_rate.n === 3 && by1.failure_rate.value === 100 && by1.started.value === 3,
    JSON.stringify(sc1.rows.map((r) => [r.key, r.value, r.n])));
  check('c02 the tile follows live (no reload): the server value 0.0% with n=3',
    await until(async () => (await tile(A.p).getAttribute('aria-label')) === `Verified Success: ${by1.verified_success_rate.value}%` && (await tile(A.p).locator(`[data-kpi-n="${by1.verified_success_rate.n}"]`).count()) === 1, 10000)
      && (await tile(A.p).locator('.kpi-val').innerText()).trim() === '0.0%');
  check('c02 the panel rows show the server values and n',
    await until(async () => (await scRow(A.p, 'verified_success_rate').getAttribute('data-value')) === '0' && (await scRow(A.p, 'verified_success_rate').getAttribute('data-n')) === '3'
      && (await scRow(A.p, 'finished').locator('.sc-val').innerText()) === '3' && (await scRow(A.p, 'failure_rate').locator('.sc-val').innerText()) === '100.0%'
      && (await scRow(A.p, 'median_cycle_time_h').getAttribute('data-n')) === String(by1.median_cycle_time_h.n), 8000));
  check('c02 the evidence sentence is the server\'s', by1.verified_success_rate.evidence === '0 of 3 finished missions verified · 0 completed unverified');
  check('c02 A did not reload', (await A.p.evaluate(() => window.__noReload)) === 'c02');
  await A.p.setViewportSize({ width: 1366, height: 650 }); // short screens hide tile hints: the n must stay visible
  await calm(A.p);
  check('c02 at 1366x650 the tile still shows its n (n=3 beside 0.0%)', await tile(A.p).locator('[data-kpi-n="3"]').isVisible());
  await A.p.screenshot({ path: `${SHOTS}/improve-c02-overview-1366x650.png` });
  await A.p.setViewportSize({ width: 1600, height: 940 });
  await calm(A.p);

  // ------------------------------------------------------------ c02: DEMO missions are excluded by default
  const all = (await apiA('GET', '/missions')).body.missions;
  const dm = all.find((m) => m.demo && ['running', 'paused', 'planning', 'verifying', 'waiting_approval', 'queued'].includes(m.serverStatus));
  await act(dm.id, 'cancel');
  const sc2 = Object.fromEntries((await apiA('GET', '/company/scorecard')).body.rows.map((r) => [r.key, r]));
  const sc2d = await apiA('GET', '/company/scorecard?includeDemo=1');
  const by2d = Object.fromEntries(sc2d.body.rows.map((r) => [r.key, r]));
  check(`c02 a canceled DEMO mission (${dm.id}) is not counted by default; with includeDemo=1 it is`, sc2.finished.value === 3 && by2d.finished.value === 4 && sc2d.body.includeDemo === true, `default ${sc2.finished.value}, with DEMO ${by2d.finished.value}`);
  // ABSENCE WAIT (kept, 900 ms as before): asserting the panel does NOT change (still 3 finished) after the cancel; no condition can signal "never".
  await A.p.waitForTimeout(900);
  check('c02 the panel still shows 3 finished (DEMO off) and no DEMO tag', (await scRow(A.p, 'finished').locator('.sc-val').innerText()) === '3' && (await A.p.locator('[data-scorecard] .demo-tag').count()) === 0);
  await A.p.getByRole('switch', { name: 'Include DEMO missions' }).click();
  check('c02 "include DEMO missions" on: the panel is tagged DEMO and counts 4 finished (the server value)',
    await until(async () => (await A.p.locator('[data-scorecard="ready"][data-demo="1"] .demo-tag').count()) === 1 && (await scRow(A.p, 'finished').locator('.sc-val').innerText()) === String(by2d.finished.value), 8000));
  check('c02 the tile stays on the default (DEMO excluded): n=3', (await tile(A.p).locator('[data-kpi-n="3"]').count()) === 1);
  await A.p.getByRole('radio', { name: '90d' }).click();
  check('c02 the 90d window is read from the server', await until(async () => (await A.p.locator('[data-scorecard="ready"][data-window="90d"]').count()) === 1, 8000));
  await A.p.getByRole('radio', { name: '30d' }).click();
  await A.p.getByRole('switch', { name: 'Include DEMO missions' }).click();
  await until(async () => (await A.p.locator('[data-scorecard="ready"][data-demo="0"][data-window="30d"]').count()) === 1, 8000);
  await calm(A.p);
  if (DOC_SHOT_C02) await A.p.screenshot({ path: DOC_SHOT_C02 });
  await A.p.screenshot({ path: `${SHOTS}/improve-c02-overview-A.png` });
  await A.p.goto(base + '/missions', { waitUntil: 'domcontentloaded' });
  check('c02 the Missions list header shows the server rate with n', await until(async () => (await A.p.locator('.mw-list-head [data-list-success="0"][data-n="3"]').count()) === 1 && (await A.p.locator('.mw-list-head').innerText()).includes('0.0% verified success (n=3)'), 8000));
  const memberSc = (await apiOf(C.p)('GET', '/company/scorecard')).body.rows.find((r) => r.key === 'finished');
  check('c02 member C cannot see the admin\'s private missions: finished 0', memberSc?.value === 0);

  // ------------------------------------------------------------ c02 fix I1: a real mission being staffed shows up in the agents tile, live
  await A.p.goto(base + '/overview', { waitUntil: 'domcontentloaded' });
  await A.p.locator('[data-scorecard="ready"]').waitFor({ timeout: 15000 });
  const m4 = (await apiA('POST', '/missions', { text: 'Scorecard check 4: list the steps to rotate the backup keys.', files: [], shared: false }, { 'idempotency-key': `c02-new-4-${Date.now()}` })).body.mission;
  let staffedN = 0;
  await until(async () => (staffedN = await staffedFromServer()) >= 2, 15000, 300); // the GM and the executor have joined
  check('c02 fix I1: the agents tile follows the server count of staffed agents live (a new real mission is staffed)',
    staffedN >= 1 && await until(async () => { const n = await staffedFromServer(); return (await staffedTile(A.p).getAttribute('aria-label')) === `Staffed Agents: ${n}` && n >= 1; }, 10000), `server ${staffedN}, tile ${await staffedTile(A.p).getAttribute('aria-label')}`);
  await act(m4.id, 'cancel');
  check('c02 fix I1: after the cancel the tile drops back to the server count (0)', await until(async () => (await staffedFromServer()) === 0 && (await staffedTile(A.p).getAttribute('aria-label')) === 'Staffed Agents: 0', 10000));
  // ------------------------------------------------------------ c03: agent reliability measured from recorded task history
  // Honest limits (see c03-report): real missions get no tasks yet (the only task rows are the DEMO seed's simulated ones) and
  // passed/failed are system-only. So the user-action part proves the empty state, DEMO exclusion and the live re-read; the
  // value with n ≥ 5 is proven only in the server route tests; pass-threshold 3b is NOT MET in the browser. The SUPPLEMENTARY
  // step below renders a value from fixture rows written only into axion_e2e (a test-only seam, not evidence for 3b).
  const relStat = (p) => p.locator('.oa-hero-side [data-reliability]');
  const relText = async (p) => (await relStat(p).locator('[data-reliability-text]').innerText()).trim();
  const relOfApi = async (call, id, qs = '') => (await call('GET', `/agents/${id}${qs}`)).body.agent?.reliability;
  let agentReads = 0;
  A.p.on('request', (r) => { if (r.method() === 'GET' && /\/api\/v1\/agents(\?|$)/.test(r.url())) agentReads++; });
  // a fresh agent (created through the API; its profile is opened for the first time)
  const fresh = (await apiA('GET', '/agents')).body.agents.find((a) => a.id === 'archivist-01')
    ?? (await apiA('POST', '/agents', { name: 'Archivist-01', role: 'archivist', dept: 'Operations', duty: 'Keeps the archive', model: 'claude-sonnet-5-5' }, { 'idempotency-key': `c03-agent-${Date.now()}` })).body.agent;
  check('c03 server: every agent carries reliability {value, n, window 90d, evidence, includesSimulated false}',
    (await apiA('GET', '/agents')).body.agents.every((a) => a.reliability && 'value' in a.reliability && a.reliability.window === '90d' && a.reliability.includesSimulated === false && typeof a.reliability.evidence === 'string'));
  await A.p.goto(base + `/agents/${fresh.id}`, { waitUntil: 'domcontentloaded' });
  await relStat(A.p).waitFor({ timeout: 15000 });
  check('c03 a fresh agent shows "not enough evidence (0 of 5)" with no value',
    (await relStat(A.p).getAttribute('data-reliability')) === 'none' && (await relStat(A.p).getAttribute('data-reliability-n')) === '0' && (await relText(A.p)) === 'not enough evidence (0 of 5)'
      && (await relStat(A.p).locator('.oa-rel-val b').innerText()).trim() === '–');
  check('c03 the Reliability stat has its own ? (definition) and a "measured" chip, no DEMO tag',
    (await relStat(A.p).locator('[data-help-key="agent.reliability"]').count()) === 1 && (await relStat(A.p).locator('.demo-tag.measured').count()) === 1 && (await relStat(A.p).getByText('DEMO', { exact: true }).count()) === 0);
  await relStat(A.p).locator('[data-help-key="agent.reliability"]').click();
  check('c03 the ? explains the definition (first attempt, reassigned away, canceled not counted, the handover rule, 5 needed)',
    await until(async () => { const t = await A.p.locator('.help-pop').innerText(); return /first attempt/.test(t) && /reassigned away/.test(t) && /canceled by a person/.test(t) && /never adds a failure to the receiving agent/.test(t) && /below 5/.test(t); }, 4000));
  await A.p.keyboard.press('Escape');

  // a seeded agent with many DEMO (simulated) tasks: the default excludes them; the DEMO fixture numbers keep their DEMO chip
  const coderSim = await relOfApi(apiA, 'coder-01', '?includeSimulated=1');
  const coderReal = await relOfApi(apiA, 'coder-01');
  // fix round m2: DEMO fixture tasks have no recorded attempts, so their passes are left out even with includeSimulated=1 (and say so)
  check('c03 server: Coder-01\'s DEMO tasks appear only with includeSimulated=1 (passes without a recorded attempt: not counted); by default nothing',
    coderSim?.includesSimulated === true && /passed with no recorded attempt of its own \(not counted\)/.test(coderSim.evidence) && /DEMO tasks included/.test(coderSim.evidence)
      && coderReal?.n === 0 && coderReal.value === null && !/not counted/.test(coderReal.evidence), `with DEMO: ${coderSim?.evidence}; default: ${coderReal?.evidence}`);
  await A.p.goto(base + '/agents/coder-01', { waitUntil: 'domcontentloaded' });
  await relStat(A.p).waitFor({ timeout: 15000 });
  check('c03 Coder-01 profile: Reliability "not enough evidence (0 of 5)" (DEMO tasks are not evidence)', (await relText(A.p)) === 'not enough evidence (0 of 5)');
  check('c03 the DEMO metrics still carry their DEMO chip beside it (hero), grade and OVR still shown from the fixture',
    (await A.p.locator('.oa-hero-main .demo-tag', { hasText: 'DEMO' }).count()) >= 1 && (await A.p.locator('.oa-grade b').innerText()).trim() !== '' && (await A.p.locator('.oa-kv-big').getByText('Verified success').count()) === 1);
  await A.p.getByRole('tab', { name: 'Capabilities' }).click();
  check('c03 the radar stays DEMO-tagged', await until(async () => (await A.p.locator('section.panel', { has: A.p.locator('h2.panel-title', { hasText: 'Capability Radar' }) }).locator('.demo-tag', { hasText: 'DEMO' }).count()) === 1, 6000));
  await A.p.getByRole('tab', { name: 'Profile' }).click();

  // user actions on DEMO tasks: reassign a failed one away from its owner, then retry it; the profile re-reads live, stays at n=0
  await A.p.evaluate(() => { window.__noReload = 'c03'; });
  const demoTask = (await apiA('GET', '/missions/M-125/tasks')).body.find((t) => t.state === 'failed');
  const fromAgent = demoTask?.owner;
  const toInst = ((await apiA('GET', '/missions/M-125/hierarchy')).body.nodes ?? []).find((n) => n.agentId === 'coder-01' && n.agentId !== fromAgent)?.instanceId;
  const before = await relOfApi(apiA, fromAgent, '?includeSimulated=1');
  const reads0 = agentReads;
  const re = await apiA('POST', `/tasks/${demoTask.id}/reassign`, { toInstanceId: toInst }, { 'idempotency-key': `c03-re-${Date.now()}` });
  check(`c03 user action: reassign DEMO task ${demoTask?.id} (failed) from ${fromAgent} to Coder-01`, re.status === 200, `status ${re.status}`);
  check('c03 live: the open profile re-reads the agents after task.delegated (no reload)', await until(async () => agentReads > reads0, 6000) && (await A.p.evaluate(() => window.__noReload)) === 'c03', `${agentReads - reads0} reads`);
  const after = await relOfApi(apiA, fromAgent, '?includeSimulated=1');
  const coderAfter = await relOfApi(apiA, 'coder-01', '?includeSimulated=1');
  // fix round I2: every outcome counts against the owner at that time; Coder-01 never attempted it, so it gets no failure
  check(`c03 server, with DEMO tasks: the failed task now counts against ${fromAgent} as "reassigned away"; Coder-01 (no own attempt) is not charged; by default nothing changes`,
    after.n === before.n && !/reassigned away/.test(before.evidence) && /1 reassigned away/.test(after.evidence) && coderAfter.n === coderSim.n
      && /1 taken over after failing elsewhere \(not counted\)/.test(coderAfter.evidence)
      && (await relOfApi(apiA, fromAgent)).n === 0 && (await relOfApi(apiA, 'coder-01')).n === 0, `${fromAgent}: "${before.evidence}" → "${after.evidence}"; Coder-01 n ${coderSim.n} → ${coderAfter.n}`);
  const reads1 = agentReads;
  const rt = await apiA('POST', `/tasks/${demoTask.id}/retry`, {}, { 'idempotency-key': `c03-rt-${Date.now()}` });
  check('c03 user action: retry it (failed → queued for retry, no longer finished): the profile re-reads after task.stateChanged',
    rt.status === 200 && await until(async () => agentReads > reads1, 6000), `status ${rt.status}`);
  check(`c03 server, with DEMO tasks: the retried task is open again, so it left the evidence of ${fromAgent} (open tasks are not evidence)`,
    (await relOfApi(apiA, fromAgent, '?includeSimulated=1')).n === before.n - 1 && (await relOfApi(apiA, 'coder-01', '?includeSimulated=1')).n === coderSim.n);
  // ABSENCE WAIT (kept, 600 ms as before): asserting the Coder-01 profile does NOT change after the retry re-read; no condition can signal "never".
  await A.p.waitForTimeout(600);
  check('c03 Coder-01 profile still says "not enough evidence (0 of 5)" (real tasks only), no reload', (await relText(A.p)) === 'not enough evidence (0 of 5)' && (await A.p.evaluate(() => window.__noReload)) === 'c03');

  // ------------------------------------------------------------ c03 SUPPLEMENTARY fixture step (axion_e2e only; not evidence for 3b)
  // passed/failed are system-only and real missions have no tasks yet, so finished real task rows are written straight into the
  // e2e database (a test-only seam, like the c01 expiry step and the server route tests). User actions on them then move the value.
  const mR = (await apiA('POST', '/missions', { text: 'Reliability check: compare two log shippers and list their limits.', files: [], shared: false }, { 'idempotency-key': `c03-new-${Date.now()}` })).body.mission;
  await act(mR.id, 'start');
  let team = [];
  await until(async () => (team = ((await apiA('GET', `/missions/${mR.id}/hierarchy`)).body.nodes ?? [])).length >= 2, 15000, 300);
  const lead = team.find((n) => n.agentId === 'gm');
  const exec = team.find((n) => n.agentId !== 'gm');
  check('c03 a real mission is staffed (GM + an executor instance)', !!lead && !!exec, team.map((n) => n.agentId).join(', '));
  const pgc = createRequire(new URL('../../server/package.json', import.meta.url))('pg');
  const db3 = new pgc.Client({ connectionString: e2eUrl });
  await db3.connect();
  const tn = (await db3.query('select tenant_id from missions where id=$1', [mR.id])).rows[0].tenant_id;
  // the executor: 3 first-time passes, 2 failures (one attempt each); the GM: 1 failure
  const rows3 = [['R1', 'passed', exec], ['R2', 'passed', exec], ['R3', 'passed', exec], ['R4', 'failed', exec], ['R5', 'failed', exec], ['R6', 'failed', lead]];
  for (const [sfx, st, n] of rows3) {
    const id = `T-${mR.id}-${sfx}`;
    await db3.query(`insert into tasks(id, tenant_id, mission_id, title, status, owner_agent, owner_instance_id, simulated) values ($1,$2,$3,$4,$5,$6,$7,false)`, [id, tn, mR.id, `Reliability fixture ${sfx}`, st, n.agentId, n.instanceId]);
    await db3.query(`insert into task_attempts(task_id, attempt_no, started_at, finished_at, result) values ($1,1, now() - interval '1 hour', now(), $2)`, [id, st]);
  }
  await db3.end();
  const SFX = 'last 90 days · from missions you can see';
  await A.p.goto(base + `/agents/${exec.agentId}`, { waitUntil: 'domcontentloaded' });
  await relStat(A.p).waitFor({ timeout: 15000 });
  const srv = await relOfApi(apiA, exec.agentId);
  check(`c03 supplementary (fixture rows): the server measures ${exec.agentId} at 3 of 5 → 60`, srv?.n === 5 && srv.value === 60 && srv.evidence === `3 of 5 finished tasks passed first time · 2 failed · ${SFX}`, JSON.stringify(srv));
  const shows = async (p, value, n) => (await relStat(p).getAttribute('data-reliability')) === 'ok' && (await relStat(p).getAttribute('data-reliability-value')) === String(value)
    && (await relStat(p).getAttribute('data-reliability-n')) === String(n) && (await relStat(p).locator('.oa-rel-val b').innerText()).trim() === `${value}%` && (await relText(p)) === `n=${n} · last 90 days`;
  check('c03 supplementary: the profile renders the server\'s value and n (60%, n=5 · last 90 days)', await until(() => shows(A.p, 60, 5), 8000), await relText(A.p).catch(() => '?'));
  check(`c03 ${exec.agentId}'s DEMO fixture numbers keep their DEMO chip next to the measured value`, (await A.p.locator('.oa-hero-main .demo-tag', { hasText: 'DEMO' }).count()) >= 1);
  await calm(A.p);
  if (DOC_SHOT_C03) await A.p.screenshot({ path: DOC_SHOT_C03 });
  await A.p.screenshot({ path: `${SHOTS}/improve-c03-profile-A.png` });
  // user action: the GM's failed task R6 is reassigned to the executor. Fix round I2: the failure stays the GM's; the executor gets none
  await A.p.evaluate(() => { window.__noReload = 'c03b'; });
  const readsR6 = agentReads;
  const re6 = await apiA('POST', `/tasks/T-${mR.id}-R6/reassign`, { toInstanceId: exec.instanceId }, { 'idempotency-key': `c03-re6-${Date.now()}` });
  const srv6 = await relOfApi(apiA, exec.agentId);
  check('c03 user action: reassigning the GM\'s failed task to the executor adds no failure to the executor (still 3 of 5 → 60; "taken over … not counted")',
    re6.status === 200 && srv6.n === 5 && srv6.value === 60 && srv6.evidence === `3 of 5 finished tasks passed first time · 2 failed · 1 taken over after failing elsewhere (not counted) · ${SFX}`, JSON.stringify(srv6));
  check('c03 the GM is charged one "reassigned away" (server)', /1 reassigned away/.test((await relOfApi(apiA, 'gm')).evidence) && (await relOfApi(apiA, 'gm')).n === 1);
  check('c03 live: the profile re-reads after task.delegated and still shows 60%, n=5 (no reload)', await until(async () => agentReads > readsR6, 6000) && await until(() => shows(A.p, 60, 5), 4000) && (await A.p.evaluate(() => window.__noReload)) === 'c03b');
  // fit: the profile still fits one screen at 1366x768 with the stat (hero + tab bar visible, no page scroll)
  await A.p.setViewportSize({ width: 1366, height: 768 });
  await calm(A.p);
  const fit = await A.p.evaluate(() => { const d = document.scrollingElement; const tb = document.querySelector('.oa-tabbar')?.getBoundingClientRect(); return { over: d.scrollHeight - d.clientHeight, tabBottom: tb ? Math.round(tb.bottom) : -1, h: innerHeight }; });
  check('c03 at 1366x768 the profile fits (no page scroll) and the stat and the tab bar are on screen', fit.over <= 1 && fit.tabBottom > 0 && fit.tabBottom <= fit.h && await relStat(A.p).isVisible(), JSON.stringify(fit));
  await A.p.screenshot({ path: `${SHOTS}/improve-c03-profile-1366x768.png` });
  await A.p.setViewportSize({ width: 1600, height: 940 });
  await calm(A.p);
  // the member C cannot see the admin's private mission: her view of the same agent has no evidence
  const cRel = await relOfApi(apiOf(C.p), exec.agentId);
  check('c03 member C does not count the admin\'s private mission (server: n=0)', cRel?.n === 0 && cRel.value === null);
  await C.p.goto(base + `/agents/${exec.agentId}`, { waitUntil: 'domcontentloaded' });
  await relStat(C.p).waitFor({ timeout: 15000 });
  check('c03 member C\'s profile of the same agent says "not enough evidence (0 of 5)"', await until(async () => (await relText(C.p)) === 'not enough evidence (0 of 5)', 6000));
  // Directory: list row and card chips
  await A.p.goto(base + '/operations?tab=agents&sub=directory&view=list', { waitUntil: 'domcontentloaded' });
  await A.p.locator('.ag-table').waitFor({ timeout: 15000 });
  const rowOf = (p, name) => p.locator('.ag-table tbody tr', { hasText: name }).first();
  const execName = (await apiA('GET', `/agents/${exec.agentId}`)).body.agent.name;
  check('c03 Directory list: each row carries a reliability chip by the name; the executor\'s shows 60% (n=5), the fresh agent "—"',
    await until(async () => (await A.p.locator('.ag-table tbody tr td:first-child [data-reliability-chip]').count()) === (await A.p.locator('.ag-table tbody tr').count())
      && (await rowOf(A.p, execName).locator('[data-reliability-chip="ok"][data-reliability-n="5"]').innerText()).includes('60%')
      && (await rowOf(A.p, fresh.name).locator('[data-reliability-chip="none"][data-reliability-n="0"]').innerText()).includes('—'), 8000));
  await rowOf(A.p, execName).locator('[data-reliability-chip]').hover();
  check('c03 the list chip tooltip carries n and the evidence sentence', await until(async () => /n=5 of 5 needed · 3 of 5 finished tasks passed first time/.test(await A.p.locator('.tooltip').first().innerText()), 4000));
  await A.p.goto(base + '/operations?tab=agents&sub=directory&view=cards', { waitUntil: 'domcontentloaded' });
  await A.p.locator('.agent-card').first().waitFor({ timeout: 15000 });
  const cardOf = (p, name) => p.locator('.agent-card', { has: p.locator('.agent-name', { hasText: new RegExp(`^${name}$`) }) });
  check('c03 Directory cards: the executor\'s card chip shows 60%, the fresh agent\'s "—"',
    await until(async () => (await cardOf(A.p, execName).locator('[data-reliability-chip="ok"]').innerText()).includes('60%') && (await cardOf(A.p, fresh.name).locator('[data-reliability-chip="none"]').innerText()).includes('—'), 8000));
  // user action: retry the executor's failed task R5 → it is open again, so it leaves the evidence; the open profile drops live to 4 of 5
  await A.p.goto(base + `/agents/${exec.agentId}`, { waitUntil: 'domcontentloaded' });
  await relStat(A.p).waitFor({ timeout: 15000 });
  await until(() => shows(A.p, 60, 5), 8000);
  await A.p.evaluate(() => { window.__noReload = 'c03c'; });
  const rt5 = await apiA('POST', `/tasks/T-${mR.id}-R5/retry`, {}, { 'idempotency-key': `c03-rt5-${Date.now()}` });
  check('c03 user action: retry R5; live, without a reload, the profile goes from 60% (n=5) to "not enough evidence (4 of 5)" — the server\'s value',
    rt5.status === 200 && (await relOfApi(apiA, exec.agentId)).n === 4
      && await until(async () => (await relStat(A.p).getAttribute('data-reliability')) === 'none' && (await relText(A.p)) === 'not enough evidence (4 of 5)', 8000)
      && (await A.p.evaluate(() => window.__noReload)) === 'c03c', await relText(A.p).catch(() => '?'));
} catch (e) { check('script ran to the end', false, String(e).split('\n')[0]); }
for (const [X, l] of [[A, 'A'], [B, 'B'], [C, 'C']]) await X?.p.screenshot({ path: `${SHOTS}/improve-c01-end-${l}.png` }).catch(() => {});
console.log(errors.length ? 'PAGE ERRORS:\n' + errors.join('\n') : 'no page errors');
console.log(`${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
writeFileSync(`${SHOTS}/api-improve.txt`, results.join('\n') + '\n');
await b.close();
process.exit(results.some((r) => r.startsWith('FAIL')) || errors.length ? 1 : 0);
