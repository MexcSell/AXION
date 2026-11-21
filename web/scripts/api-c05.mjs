// Improvement cycle 5 (theme C), api mode: agent version proposals, promote and rollback, end to end in three browsers.
// A (admin) proposes a candidate version of an agent (new skill) in Agent Profile › Evolution › Versions and sees the
// before/after diff; B (second admin) sees it live in Agents › Development and promotes it; C (member) watches the agent's
// active version become v(n+1) WITHOUT a reload while the running mission's instance still shows v(n); B rolls back,
// which creates v(n+2) with v(n)'s configuration, and C sees it live. The author cannot promote (403 SELF_APPROVAL); a
// proposal whose base changed answers 409 AGENT_CHANGED, shown inline on the card.
// Run through scripts/api-e2e.sh (lane ports: E2E_API_PORT/E2E_WEB_PORT). Condition waits only (no networkidle).
// The committed screenshot is written only on request: DOC_SHOT_C05=docs/screenshots/improve-c05-versions-dark.png
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
const base = process.env.BASE || 'http://127.0.0.1:5193';
const SHOTS = process.env.SHOTS || `/tmp/axion-api-c05-${new URL(base).port}`;
const DOC_SHOT = process.env.DOC_SHOT_C05;
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
const DEV = '/operations?tab=agents&sub=development';
let k = 0;
const key = () => ({ 'idempotency-key': `c05-${Date.now()}-${k++}` });
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
  const apiB = apiOf(B.p);

  // ------------------------------------------------------------ an agent with an instance on a running mission
  const missions = (await apiA('GET', '/missions')).body.missions ?? [];
  const running = new Set(missions.filter((m) => m.status === 'running').map((m) => m.id));
  const insts = ((await apiA('GET', '/agent-instances')).body.instances ?? []).filter((i) => running.has(i.missionId) && i.agentId !== 'gm' && !i.endedAt);
  const inst = insts.find((i) => i.agentId === 'coder-01') ?? insts[0];
  const X = inst?.agentId;
  const ag0 = (await apiA('GET', `/agents/${X}`)).body.agent;
  const vN = ag0?.versionLabel;
  check('setup: an agent has an instance on a running mission, pinned to the active version v(n)', !!inst && inst.versionLabel === vN, `${X} · ${inst?.id} · ${vN}`);

  // ------------------------------------------------------------ C (member) watches the agent's profile
  const activeDd = (p) => p.locator('dt', { hasText: 'Active version' }).locator('xpath=following-sibling::dd[1]');
  const instChip = (p) => p.locator(`[data-current-missions] [data-instance="${inst.id}"]`);
  await C.p.goto(base + `/agents/${X}`, { waitUntil: 'domcontentloaded' });
  check('C sees the active version v(n) and the running instance pinned to v(n)',
    await until(async () => (await activeDd(C.p).innerText()).startsWith(vN) && (await instChip(C.p).innerText()).includes(vN), 12000));

  // ------------------------------------------------------------ B waits on Agents › Development (api mode)
  await B.p.goto(base + DEV, { waitUntil: 'domcontentloaded' });
  check('api mode: Development shows the server\'s version proposals (no DEMO ladder), empty at first',
    await until(async () => (await B.p.locator('[data-dev-proposals] [data-version-proposals="ready"]').count()) === 1, 12000)
      && (await B.p.locator('.dev-ladder').count()) === 0 && (await B.p.getByText('No version proposals waiting').count()) === 1);

  // ------------------------------------------------------------ A proposes through the dialog and sees the diff
  await A.p.goto(base + `/agents/${X}?tab=evolution`, { waitUntil: 'domcontentloaded' });
  await A.p.locator('[data-versions]').waitFor({ timeout: 15000 });
  check('A\'s Versions list marks v(n) active', await until(async () => (await A.p.locator(`[data-versions] [data-version="${vN}"][data-active="1"]`).count()) === 1, 8000));
  await A.p.getByRole('button', { name: 'Propose a change', exact: true }).click();
  const dlg = A.p.locator('[role="dialog"]').first();
  await dlg.getByText(`from ${vN}`).waitFor({ timeout: 10000 });
  await dlg.getByLabel('New skill', { exact: true }).fill('Svelte');
  await dlg.getByLabel('New skill', { exact: true }).press('Enter');
  check('the dialog shows the before/after diff: + Svelte (skill), no model change, and no evaluation numbers',
    await until(async () => (await dlg.locator('[data-dialog-diff] [data-diff="skill-add"][data-value="Svelte"]').count()) === 1, 6000)
      && (await dlg.locator('[data-dialog-diff] [data-diff="model"]').count()) === 0
      && (await dlg.getByText('No evaluation yet. Evaluations run once agents execute.').count()) === 1);
  check('Submit stays off until a hypothesis is given', await dlg.getByRole('button', { name: 'Submit proposal' }).isDisabled());
  await dlg.getByLabel('Hypothesis').fill('Svelte work no longer waits for a second coder.');
  await dlg.getByRole('button', { name: 'Submit proposal' }).click();
  check('the dialog closes after submit', await until(async () => (await dlg.count()) === 0, 8000));
  const p1 = ((await apiA('GET', `/agents/${X}/version-proposals`)).body.proposals ?? [])[0];
  check('the server stored it: pending, base v(n), candidate = active skills + Svelte, evaluation null',
    p1?.status === 'pending' && p1.baseVersionLabel === vN && JSON.stringify(p1.candidate.skills) === JSON.stringify([...ag0.skills, 'Svelte']) && p1.evaluation === null);
  const card = (p) => p.locator(`[data-version-proposal="${p1.id}"]`);
  check('A (the author) sees Withdraw on the card, no Promote', await until(async () => (await card(A.p).getByRole('button', { name: 'Withdraw', exact: true }).count()) === 1, 8000)
    && (await card(A.p).getByRole('button', { name: 'Promote', exact: true }).count()) === 0);
  const self = await apiA('POST', `/version-proposals/${p1.id}/decision`, { decision: 'promote', sha: p1.sha });
  check('the author promoting their own proposal is 403 SELF_APPROVAL', self.status === 403 && self.body.code === 'SELF_APPROVAL');

  // ------------------------------------------------------------ B sees it live and promotes
  check('B\'s Development list shows the proposal live (no reload): agent, hypothesis, + Svelte, author, Promote/Reject, "No evaluation yet"',
    await until(async () => (await card(B.p).count()) === 1, 10000)
      && (await card(B.p).innerText()).includes(ag0.name) && (await card(B.p).innerText()).includes('Svelte work no longer waits')
      && (await card(B.p).locator('[data-diff="skill-add"][data-value="Svelte"]').count()) === 1 && (await card(B.p).innerText()).includes('by Luca')
      && (await card(B.p).getByRole('button', { name: 'Promote', exact: true }).count()) === 1 && (await card(B.p).getByRole('button', { name: 'Reject', exact: true }).count()) === 1
      && (await card(B.p).getByText('No evaluation yet. Evaluations run once agents execute.').count()) === 1);
  const devTab = (p) => p.getByRole('tab', { name: /^Development/ }).first();
  check('api mode: the Development sub-tab counts the server\'s pending proposals (1), not fixture growth', await until(async () => /^Development\s*\(?1\)?$/.test((await devTab(B.p).innerText()).replace(/\s+/g, ' ').trim()), 8000), await devTab(B.p).innerText().catch(() => '?'));
  await card(B.p).getByRole('button', { name: 'Promote', exact: true }).click();
  const ag1 = await (async () => { let a; await until(async () => { a = (await apiA('GET', `/agents/${X}`)).body.agent; return a.versionLabel !== vN; }, 8000); return a; })();
  const vN1 = ag1.versionLabel;
  check('B promotes: the server made v(n+1) active with the candidate skills (parent = v(n))',
    vN1 !== vN && ag1.skills.includes('Svelte') && ag1.versions.find((v) => v.id === ag1.versionId)?.parentVersionId === ag0.versionId, `${vN} → ${vN1}`);
  check('B\'s card leaves Pending live and shows under Decided as Promoted, with the new version',
    await until(async () => (await card(B.p).count()) === 0, 8000)
      && (await B.p.getByRole('radio', { name: 'Decided' }).or(B.p.getByRole('button', { name: 'Decided', exact: true })).first().click().then(() => true))
      && await until(async () => (await card(B.p).count()) === 1 && (await card(B.p).getAttribute('data-status')) === 'promoted' && (await card(B.p).innerText()).includes(vN1) && (await card(B.p).innerText()).includes('Promoted by Bea'), 8000));

  // ------------------------------------------------------------ C (third browser, no reload): v(n+1) active, the instance stays on v(n)
  check('C sees the active version become v(n+1) live while the running instance still shows v(n)',
    await until(async () => (await activeDd(C.p).innerText()).startsWith(vN1) && (await instChip(C.p).innerText()).includes(vN), 10000));
  check('the server agrees: the instance is still pinned to v(n)', (await apiA('GET', `/agent-instances/${encodeURIComponent(inst.id)}`)).body.instance?.versionLabel === vN);
  check('A\'s Versions list (live): v(n+1) active, v(n) marked last good',
    await until(async () => (await A.p.locator(`[data-versions] [data-version="${vN1}"][data-active="1"]`).count()) === 1 && (await A.p.locator(`[data-versions] [data-version="${vN}"][data-last-good="1"]`).count()) === 1, 8000));

  // ------------------------------------------------------------ B rolls back to v(n)
  await B.p.goto(base + `/agents/${X}?tab=evolution`, { waitUntil: 'domcontentloaded' });
  await B.p.locator(`[data-versions] [data-version="${vN}"][data-last-good="1"]`).waitFor({ timeout: 15000 });
  await B.p.getByRole('button', { name: `Roll back to this version (${vN})` }).click();
  const rb = B.p.locator('[role="dialog"]').first();
  await rb.getByLabel('Reason').waitFor({ timeout: 8000 });
  check('the rollback dialog shows what changes back: − Svelte', await until(async () => (await rb.locator('[data-dialog-diff] [data-diff="skill-rm"][data-value="Svelte"]').count()) === 1, 8000));
  await rb.getByLabel('Reason').fill('Reviews got slower with the new skill.');
  await rb.getByRole('button', { name: 'Roll back', exact: true }).click();
  check('the rollback dialog closes', await until(async () => (await rb.count()) === 0, 8000));
  const ag2 = await (async () => { let a; await until(async () => { a = (await apiA('GET', `/agents/${X}`)).body.agent; return a.versionLabel !== vN1; }, 8000); return a; })();
  const vN2 = ag2.versionLabel;
  const vRow = ag0.versions.find((v) => v.id === ag0.versionId);
  check('rollback created v(n+2) (a new id) with v(n)\'s configuration, parent = v(n+1); v(n) is unchanged',
    vN2 !== vN && vN2 !== vN1 && ag2.versionId !== ag0.versionId && JSON.stringify(ag2.skills) === JSON.stringify(ag0.skills) && ag2.model === ag0.model && JSON.stringify(ag2.tools) === JSON.stringify(ag0.tools)
      && ag2.versions.find((v) => v.id === ag2.versionId)?.parentVersionId === ag1.versionId && JSON.stringify(ag2.versions.find((v) => v.id === ag0.versionId)) === JSON.stringify(vRow), `${vN1} → ${vN2}`);
  check('C sees v(n+2) live; the running instance still shows v(n)',
    await until(async () => (await activeDd(C.p).innerText()).startsWith(vN2) && (await instChip(C.p).innerText()).includes(vN), 10000));
  check('A\'s Versions list (live): v(n+2) active, v(n+1) last good', await until(async () => (await A.p.locator(`[data-versions] [data-version="${vN2}"][data-active="1"]`).count()) === 1 && (await A.p.locator(`[data-versions] [data-version="${vN1}"][data-last-good="1"]`).count()) === 1, 8000));

  // ------------------------------------------------------------ 409s: a stale base at creation, and a proposal whose base changed
  const stale = await apiA('POST', `/agents/${X}/version-proposals`, { title: 'Old base', hypothesis: 'x', candidate: { model: ag2.model, skills: [...ag2.skills, 'Elm'], tools: ag2.tools }, baseVersionId: ag1.versionId }, key());
  check('proposing from a version that is no longer active is 409 AGENT_CHANGED', stale.status === 409 && stale.body.code === 'AGENT_CHANGED');
  const p2 = (await apiA('POST', `/agents/${X}/version-proposals`, { title: 'Add Elm', hypothesis: 'Typed views.', candidate: { model: ag2.model, skills: [...ag2.skills, 'Elm'], tools: ag2.tools }, baseVersionId: ag2.versionId }, key())).body.proposal;
  const patched = await apiA('PATCH', `/agents/${X}`, { skills: [...ag2.skills, 'Go'] }, { 'if-match': String(ag2.rowVersion) });
  await B.p.goto(base + DEV, { waitUntil: 'domcontentloaded' });
  const c2 = B.p.locator(`[data-version-proposal="${p2?.id}"]`);
  check('a proposal whose base changed is marked stale on B\'s card', patched.status === 200 && await until(async () => (await c2.innerText()).includes('stale'), 10000));
  await c2.getByRole('button', { name: 'Promote', exact: true }).click();
  check('promoting it is refused (409 AGENT_CHANGED) and the error shows inline on the card', await until(async () => /changed since this was proposed/.test(await c2.locator('[data-card-error]').innerText()), 8000));
  const p2s = ((await apiB('GET', `/agents/${X}/version-proposals`)).body.proposals ?? []).find((p) => p.id === p2.id);
  check('the server kept it pending', p2s?.status === 'pending' && p2s.stale === true);

  // ------------------------------------------------------------ member C: read only; screenshot
  await C.p.goto(base + `/agents/${X}?tab=evolution`, { waitUntil: 'domcontentloaded' });
  await C.p.locator('[data-versions]').waitFor({ timeout: 15000 });
  check('C (member) sees versions and proposals but no Propose / Roll back / Promote buttons', await until(async () => (await C.p.locator('[data-version-proposals="ready"]').count()) === 1, 8000)
    && (await C.p.getByRole('button', { name: 'Propose a change', exact: true }).count()) === 0 && (await C.p.getByRole('button', { name: /^Roll back to this version/ }).count()) === 0 && (await C.p.getByRole('button', { name: 'Promote', exact: true }).count()) === 0);
  await A.p.goto(base + `/agents/${X}?tab=evolution`, { waitUntil: 'domcontentloaded' });
  await A.p.locator(`[data-versions] [data-active="1"]`).waitFor({ timeout: 15000 });
  await until(async () => (await A.p.locator('[data-version-proposals="ready"] [data-version-proposal]').count()) >= 2, 8000);
  await A.p.waitForTimeout(900); // entrance animations
  await A.p.screenshot({ path: `${SHOTS}/improve-c05-versions-dark.png` });
  if (DOC_SHOT) await A.p.screenshot({ path: DOC_SHOT });
  await B.p.screenshot({ path: `${SHOTS}/improve-c05-development-dark.png` });
} catch (e) { check('script ran to the end', false, String(e).split('\n')[0]); }
for (const [X, l] of [[A, 'A'], [B, 'B'], [C, 'C']]) await X?.p.screenshot({ path: `${SHOTS}/improve-c05-end-${l}.png` }).catch(() => {});
console.log(errors.length ? 'PAGE ERRORS:\n' + errors.join('\n') : 'no page errors');
console.log(`${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
writeFileSync(`${SHOTS}/api-c05.txt`, results.join('\n') + '\n');
await b.close();
process.exit(results.some((r) => r.startsWith('FAIL')) || errors.length ? 1 : 0);
