// Improvement cycle 39 (Phase 2, O1), api mode: mission ledgers, after Magentic-One (arXiv 2411.04468).
// A (admin) opens the Ledger tab of a real mission, writes v1 and v2 of the task ledger through the Edit dialog and sees the
// diff; B (second admin) saves v3 meanwhile, so A's next save shows the conflict UI (keep mine / load theirs); the stall
// badge turns on after three check-ins without progress; C (member) sees the ledgers read only; a DEMO mission shows the
// DEMO label. Escape and Cancel close the dialog. The tab fits one screen.
// Run through scripts/api-e2e.sh (lane ports). Condition waits only (no networkidle, no fixed sleeps).
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
const base = process.env.BASE || 'http://127.0.0.1:5193';
const SHOTS = process.env.SHOTS || `/tmp/axion-api-c39-${new URL(base).port}`;
const DOC_SHOT = process.env.DOC_SHOT_C39;
mkdirSync(SHOTS, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.PW_CHROME || '/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome' });
const results = [];
const errors = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); console.log(results[results.length - 1]); };
const until = async (f, ms = 10000, step = 150) => { const t0 = Date.now(); for (;;) { try { if (await f()) return true; } catch { /* retry */ } if (Date.now() - t0 > ms) return false; await new Promise((r) => setTimeout(r, step)); } };
const VW = Number(process.env.VW || 1600), VH = Number(process.env.VH || 940);
const browser = async (label) => {
  const ctx = await b.newContext({ viewport: { width: VW, height: VH } });
  await ctx.addInitScript(() => { try { localStorage.setItem('axion.data-mode', 'api'); localStorage.setItem('axion.testhook', '1'); if (!localStorage.getItem('axion.settings.v1')) localStorage.setItem('axion.settings.v1', JSON.stringify({ state: { themeMode: 'dark' }, version: 0 })); } catch { /* ignore */ } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_CONNECTION|ERR_INTERNET_DISCONNECTED|502|503|504|EventSource|409/.test(m.text())) errors.push(`${label} console: ${m.text()}`); });
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
const key = () => ({ 'idempotency-key': `c39-${Date.now()}-${k++}` });
const settled = (p) => until(async () => (await p.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running' && a.effect?.getComputedTiming().iterations !== Infinity).length)) === 0, 8000, 100);
const fits = (p) => p.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1 && document.documentElement.scrollWidth <= window.innerWidth + 1);
let A, B, C;
try {
  A = await browser('A');
  await A.p.goto(base + '/missions', { waitUntil: 'domcontentloaded' });
  await connect(A.p, 'Luca', 'secret-1');
  check('A (first user = administrator) is connected and live', await live(A.p));
  const apiA = apiOf(A.p);
  const join = async (label, name, pass, admin) => {
    const Y = await browser(label);
    await Y.p.goto(base + '/missions', { waitUntil: 'domcontentloaded' });
    await connect(Y.p, name, pass);
    await Y.p.getByRole('heading', { name: 'Waiting for approval' }).waitFor({ timeout: 10000 });
    const u = ((await apiA('GET', '/users')).body.users ?? []).find((x) => x.name === name);
    await apiA('POST', `/users/${u.id}/approve`, {});
    if (admin) await apiA('PATCH', `/users/${u.id}`, { role: 'admin' });
    await Y.p.locator('.rail-nav').first().waitFor({ timeout: 15000 });
    return Y;
  };
  B = await join('B', 'Bea', 'bea-pass', true);
  C = await join('C', 'Mina', 'mina-pass', false);
  const apiB = apiOf(B.p), apiC = apiOf(C.p);
  const created = await apiA('POST', '/missions', { text: 'Compare three vendors and recommend one.', files: [], shared: true }, key());
  const id = created.body.mission?.id;
  check('a shared real mission exists', !!id, id);
  const ledgers = async () => (await apiA('GET', `/missions/${id}/ledgers`)).body;
  const URL = `${base}/missions/${id}?tab=ledger`;

  // ---------------------------------------------------------------- open the ledger: empty, with help and attribution
  await A.p.goto(URL, { waitUntil: 'domcontentloaded' });
  check('A: the Ledger tab opens and both ledgers are empty', await until(async () => (await A.p.locator('[data-ledger-state="ready"]').count()) === 1 && (await A.p.getByText('No task ledger yet').count()) === 1 && (await A.p.getByText('No progress ledger yet').count()) === 1, 15000));
  check('A: the tab has ? help and links to the Magentic-One paper', (await A.p.locator('[data-help-key="ledger.overview"]').count()) === 1 && (await A.p.locator('a[href="https://arxiv.org/abs/2411.04468"]').count()) === 1);

  // ---------------------------------------------------------------- Edit dialog: Escape and Cancel exits, then v1
  const edit = () => A.p.getByRole('button', { name: 'Edit task ledger' }).click();
  const dlg = () => A.p.locator('[data-ledger-editor="task"]');
  await edit();
  await dlg().waitFor({ timeout: 8000 });
  check('the dialog shows the Save button off until something changes', await A.p.getByRole('button', { name: /^Save version 1/ }).isDisabled());
  await A.p.keyboard.press('Escape');
  check('Escape closes the Edit dialog', await until(async () => (await A.p.locator('[data-ledger-editor]').count()) === 0, 5000));
  await edit(); await dlg().waitFor({ timeout: 8000 });
  await A.p.getByRole('button', { name: 'Cancel', exact: true }).click();
  check('Cancel closes the Edit dialog', await until(async () => (await A.p.locator('[data-ledger-editor]').count()) === 0, 5000));
  check('nothing was saved by closing', ((await ledgers()).versions.task.length) === 0);

  await edit(); await dlg().waitFor({ timeout: 8000 });
  await A.p.locator('#ld-given').fill('Budget is 5k | brief\nDeadline is Friday');
  await A.p.locator('#ld-guesses').fill('Vendor A is cheaper');
  await A.p.getByRole('button', { name: 'Add step', exact: true }).click();
  await A.p.getByLabel('Step s1 text').fill('Collect three quotes');
  await A.p.getByRole('button', { name: 'Add step', exact: true }).click();
  await A.p.getByLabel('Step s2 text').fill('Compare the quotes');
  await A.p.getByLabel('Step s2 owner').fill('analyst-01');
  check('every dialog field has a ? help trigger', (await Promise.all(['ledger.fact.given', 'ledger.fact.to_look_up', 'ledger.fact.to_derive', 'ledger.fact.guesses', 'ledger.edit'].map((x) => A.p.locator(`[data-help-key="${x}"]`).count()))).every((n) => n >= 1));
  await A.p.getByRole('button', { name: /^Save version 1/ }).click();
  check('v1 is saved: the card says v1 by Luca and shows the facts and steps',
    await until(async () => (await A.p.locator('[data-version-label="task"]').innerText()).startsWith('v1 · Luca') && (await A.p.locator('[data-fact-group="given"] li').count()) === 2 && (await A.p.locator('[data-step]').count()) === 2, 10000));
  check('the server holds v1 with the source kept', await until(async () => { const l = (await ledgers()).ledgers.task; return l?.version === 1 && l.body.facts.given[0].source === 'brief'; }, 5000));

  // ---------------------------------------------------------------- v2 and the diff
  await edit(); await dlg().waitFor({ timeout: 8000 });
  await A.p.locator('#ld-to_look_up').fill('Vendor C delivery time');
  await A.p.getByLabel('Step s1 status').selectOption('done');
  await A.p.getByRole('button', { name: /^Save version 2/ }).click();
  check('v2 is saved and shown', await until(async () => (await A.p.locator('[data-version-label="task"]').innerText()).startsWith('v2 · Luca') && (await A.p.locator('[data-fact-group="to_look_up"] li').count()) === 1, 10000));
  check('History: the diff v1 to v2 lists the added fact and the step status change',
    await until(async () => { const t = await A.p.locator('[data-ledger-diff]').innerText(); return /To look up/.test(t) && /Vendor C delivery time/.test(t) && /Step s1 status/.test(t) && /todo/.test(t) && /done/.test(t); }, 8000));
  check('History lists both versions', (await A.p.locator('[data-ledger-history] [data-version]').count()) === 2);

  // ---------------------------------------------------------------- conflict: B saves v3 while A edits
  await edit(); await dlg().waitFor({ timeout: 8000 });
  await A.p.locator('#ld-to_derive').fill('Total cost over two years');
  const cur = (await ledgers()).ledgers.task.body;
  const b3 = await apiB('POST', `/missions/${id}/ledgers/task`, { baseVersion: 2, body: { ...cur, facts: { ...cur.facts, given: [...cur.facts.given, { text: 'Bea: vendor B is out' }] } } });
  check('B saved v3 meanwhile', b3.status === 201 && b3.body.ledger.version === 3);
  await A.p.getByRole('button', { name: /^Save version 3/ }).click();
  check('A (second session) sees the conflict UI naming version 3, and nothing was saved',
    await until(async () => (await A.p.locator('[data-ledger-conflict]').count()) === 1 && /version 3/.test(await A.p.locator('[data-ledger-conflict]').innerText()), 8000) && (await ledgers()).versions.task.length === 3);
  check('the conflict banner shows what the other session changed (Bea\'s added fact)', (await A.p.locator('[data-ledger-conflict-diff]').count()) === 1 && /Bea: vendor B is out/.test(await A.p.locator('[data-ledger-conflict-diff]').innerText()));
  await A.p.screenshot({ path: `${SHOTS}/improve-c39-conflict-dark.png` });
  await A.p.getByRole('button', { name: /Save mine as the next version/ }).click();
  check('saving mine as the next version: Save now says version 4', await until(async () => !(await A.p.getByRole('button', { name: /^Save version 4/ }).isDisabled()), 5000));
  await A.p.getByRole('button', { name: /^Save version 4/ }).click();
  check('v4 is my form (not merged): my derived fact, without Bea\'s fact; Bea\'s v3 stays in History',
    await until(async () => { const l = (await ledgers()).ledgers.task; return l?.version === 4 && !l.body.facts.given.some((f) => f.text.startsWith('Bea')) && l.body.facts.to_derive[0]?.text === 'Total cost over two years'; }, 8000)
      && (await apiA('GET', `/missions/${id}/ledgers/task/3`)).body.ledger.body.facts.given.some((f) => f.text.startsWith('Bea')));
  // the other path: load theirs
  await edit(); await dlg().waitFor({ timeout: 8000 });
  await A.p.locator('#ld-guesses').fill('A guess that will be discarded');
  await apiB('POST', `/missions/${id}/ledgers/task`, { baseVersion: 4, body: { ...(await ledgers()).ledgers.task.body, steps: [] } });
  await A.p.getByRole('button', { name: /^Save version 5/ }).click();
  await A.p.locator('[data-ledger-conflict]').waitFor({ timeout: 8000 });
  await A.p.getByRole('button', { name: /Load their version/ }).click();
  check('Load their version drops my edit and shows theirs (no steps, old guess)',
    await until(async () => (await A.p.locator('#ld-guesses').inputValue()) === 'Vendor A is cheaper' && (await A.p.locator('[data-ledger-steps] .ld-step').count()) === 0 && (await A.p.locator('[data-ledger-conflict]').count()) === 0, 5000));
  await A.p.getByRole('button', { name: 'Cancel', exact: true }).click();
  check('the live view of A follows to v5', await until(async () => (await A.p.locator('[data-version-label="task"]').innerText()).startsWith('v5 · Bea'), 8000));

  // ---------------------------------------------------------------- progress ledger and the stall badge
  const pr = (base_, o) => apiA('POST', `/missions/${id}/ledgers/progress`, { baseVersion: base_, body: { satisfied: false, looping: false, progressing: true, notes: '', ...o } });
  check('a check-in with a stall field is 400 (the server owns the counter)', (await pr(0, { stall: 3 })).status === 400);
  await A.p.getByRole('button', { name: 'Edit progress ledger' }).click();
  await A.p.locator('[data-ledger-editor="progress"]').waitFor({ timeout: 8000 });
  await A.p.locator('#ld-speaker').fill('gm');
  await A.p.locator('#ld-instr').fill('Ask the analyst for the quotes');
  await A.p.getByRole('button', { name: /^Save version 1/ }).click();
  check('progress v1 is shown: progressing, not stalled, next speaker gm',
    await until(async () => (await A.p.locator('[data-flag="Making progress"][data-on="yes"]').count()) === 1 && (await A.p.locator('[data-stall="ok"]').count()) === 1 && /gm/.test(await A.p.locator('.ld-next').innerText()), 10000));
  check('2 non-progressing check-ins: still not stalled', (await pr(1, { progressing: false })).status === 201 && (await pr(2, { progressing: false })).status === 201 && await until(async () => (await A.p.locator('[data-stall="ok"]').count()) === 1 && /2 of 3/.test(await A.p.locator('[data-stall]').innerText()), 8000));
  check('the 3rd flags the mission as stalled (live, no reload), in A and in the member session C',
    (await pr(3, { progressing: false })).status === 201 && await until(async () => (await A.p.locator('[data-stall="stalled"]').count()) === 1, 8000));
  check('stall policy and counter come from the server', await (async () => { const g = await ledgers(); return g.stall.stalled === true && g.stall.counter === 3 && g.policy.nonProgressing === 3 && g.ledgers.progress.body.stall === 3; })());

  // ---------------------------------------------------------------- member: read only, live
  await C.p.goto(URL, { waitUntil: 'domcontentloaded' });
  check('C (member) sees the ledgers and the stall badge', await until(async () => (await C.p.locator('[data-ledger-state="ready"]').count()) === 1 && (await C.p.locator('[data-stall="stalled"]').count()) === 1 && (await C.p.locator('[data-version-label="task"]').count()) === 1, 15000));
  check('C has Edit and Check in disabled', (await C.p.getByRole('button', { name: 'Edit task ledger' }).isDisabled()) && (await C.p.getByRole('button', { name: 'Edit progress ledger' }).isDisabled()));
  check('a member write is 403', (await apiC('POST', `/missions/${id}/ledgers/task`, { baseVersion: 5, body: { facts: { given: [], to_look_up: [], to_derive: [], guesses: [] }, steps: [] } })).status === 403);
  const prv = await apiA('POST', '/missions', { text: 'Private mission for Luca only.', files: [], shared: false }, key());
  check('a private mission\'s ledgers are 404 for C', (await apiC('GET', `/missions/${prv.body.mission.id}/ledgers`)).status === 404);

  // ---------------------------------------------------------------- fit and the screenshot
  await A.p.goto(URL, { waitUntil: 'domcontentloaded' });
  await A.p.locator('[data-ledger-state="ready"]').waitFor({ timeout: 15000 });
  await settled(A.p);
  check(`the Ledger tab fits one screen (no page scroll) at ${VW}x${VH}`, await fits(A.p));
  await A.p.screenshot({ path: `${SHOTS}/improve-c39-ledger-dark.png` });
  if (DOC_SHOT) await A.p.screenshot({ path: DOC_SHOT });

  // ---------------------------------------------------------------- a DEMO mission shows the DEMO sample
  const demoId = ((await apiA('GET', '/missions')).body.missions ?? []).find((m) => m.demo)?.id;
  await A.p.goto(`${base}/missions/${demoId}?tab=ledger`, { waitUntil: 'domcontentloaded' });
  check('a DEMO mission shows the DEMO tag on its sample ledger', await until(async () => (await A.p.locator('[data-ledger-state="ready"]').count()) === 1 && (await A.p.locator('.ld-top .demo-tag').count()) === 1 && (await A.p.locator('[data-fact-group="guesses"]').innerText()).includes('DEMO'), 15000));
  await settled(A.p);
  await A.p.screenshot({ path: `${SHOTS}/improve-c39-demo-dark.png` });
} catch (e) { check('script ran to the end', false, String(e).split('\n')[0]); }
for (const [Y, l] of [[A, 'A'], [B, 'B'], [C, 'C']]) await Y?.p.screenshot({ path: `${SHOTS}/improve-c39-end-${l}.png` }).catch(() => {});
console.log(errors.length ? 'PAGE ERRORS:\n' + errors.join('\n') : 'no page errors');
console.log(`${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
writeFileSync(`${SHOTS}/api-c39.txt`, results.join('\n') + '\n');
await b.close();
process.exit(results.some((r) => r.startsWith('FAIL')) || errors.length ? 1 : 0);
