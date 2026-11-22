// c47 (E1b), api mode: evaluation evidence on agent version proposals.
// Runs and results are RECORDS written straight into the throw-away e2e database (nothing is executed, no model is called).
// A (admin) proposes on four agents; B (second admin) sees in Agents › Development: the outcome chip, n and the refusal
// list, the `?`, the override field (only when the candidate is not verified better), Promote disabled for a worse one,
// the 409s, an override that is audited and shown on the proposal, and a verified candidate promoting with no override.
// The page must fit a 1366x768 screen (no page scroll, no sideways scroll). Run through scripts/api-e2e.sh. Condition waits only.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const base = process.env.BASE || 'http://127.0.0.1:5193';
const SHOTS = process.env.SHOTS || `/tmp/axion-api-c47-${new URL(base).port}`;
const DOC = process.env.DOC_SHOTS_C47; // a folder for the committed screenshots, on request
mkdirSync(SHOTS, { recursive: true }); if (DOC) mkdirSync(DOC, { recursive: true });
process.loadEnvFile(fileURLToPath(new URL('../../server/.env', import.meta.url)));
const pg = createRequire(import.meta.url)('../../server/node_modules/pg');
const db = new pg.Pool({ connectionString: process.env.E2E_DATABASE_URL, max: 2 });
const b = await chromium.launch({ executablePath: process.env.PW_CHROME || '/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome' });
const results = [];
const errors = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); console.log(results[results.length - 1]); };
const until = async (f, ms = 10000, step = 150) => { const t0 = Date.now(); for (;;) { try { if (await f()) return true; } catch { /* retry */ } if (Date.now() - t0 > ms) return false; await new Promise((r) => setTimeout(r, step)); } };
const browser = async (label, vw = 1366, vh = 768) => {
  const ctx = await b.newContext({ viewport: { width: vw, height: vh } });
  await ctx.addInitScript(() => { try { localStorage.setItem('axion.data-mode', 'api'); localStorage.setItem('axion.testhook', '1'); if (!localStorage.getItem('axion.settings.v1')) localStorage.setItem('axion.settings.v1', JSON.stringify({ state: { themeMode: 'dark' }, version: 0 })); } catch { /* ignore */ } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_CONNECTION|ERR_INTERNET_DISCONNECTED|502|503|504|EventSource|409|400/.test(m.text())) errors.push(`${label} console: ${m.text()}`); });
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
const settled = (p) => until(async () => (await p.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running' && a.effect?.getComputedTiming().iterations !== Infinity).length)) === 0, 8000, 100);
const DEV = '/operations?tab=agents&sub=development';
let k = 0;
const key = () => ({ 'idempotency-key': `c47-${Date.now()}-${k++}` });

// ---- fixtures: records only (the same shape as server/test/eval-fixtures.ts)
async function dataset(id, split, tenant, n = 12) {
  await db.query(`insert into eval_datasets(id, tenant_id, name, version, split) values ($1,$2,$1,1,$3)`, [id, tenant, split]);
  for (let i = 0; i < n; i++) await db.query(`insert into eval_cases(dataset_id, case_id, input, expected) values ($1,$2,$3,$4)`, [id, 'c' + String(i + 1).padStart(2, '0'), JSON.stringify({ q: i }), JSON.stringify({ a: i * 2 })]);
  await db.query(`select eval_freeze_dataset($1)`, [id]);
}
async function run(id, tenant, ds, subject, scores, judge, evaluator) {
  await db.query(`insert into eval_runs(id, tenant_id, dataset_id, subject_version_id, subject_proposal_id, k, judge_model_family, evaluator_id) values ($1,$2,$3,$4,$5,1,$6,$7)`, [id, tenant, ds, subject.version ?? null, subject.proposal ?? null, judge, evaluator]);
  for (const [i, s] of scores.entries()) await db.query(`insert into eval_results(run_id, case_id, attempt, score, cost_units, trace) values ($1,$2,1,$3,1,'{"steps":[]}')`, [id, 'c' + String(i + 1).padStart(2, '0'), s]);
  await db.query(`update eval_runs set finished_at = now() where id=$1`, [id]);
}
const LOW = Array(12).fill(40), HIGH = Array.from({ length: 12 }, (_, i) => 72 + (i % 3));

let A, B;
try {
  A = await browser('A');
  await A.p.goto(base + '/missions', { waitUntil: 'domcontentloaded' });
  await connect(A.p, 'Luca', 'secret-1');
  check('A (first user = administrator) is connected and live', await live(A.p));
  const apiA = apiOf(A.p);
  B = await browser('B');
  await B.p.goto(base + '/missions', { waitUntil: 'domcontentloaded' });
  await connect(B.p, 'Bea', 'bea-pass');
  await B.p.getByRole('heading', { name: 'Waiting for approval' }).waitFor({ timeout: 10000 });
  const users = (await apiA('GET', '/users')).body.users ?? [];
  const bea = users.find((x) => x.name === 'Bea'), luca = users.find((x) => x.name === 'Luca');
  await apiA('POST', `/users/${bea.id}/approve`, {});
  await apiA('PATCH', `/users/${bea.id}`, { role: 'admin' });
  await B.p.locator('.rail-nav').first().waitFor({ timeout: 15000 });
  check('B (second administrator) is connected and live', await live(B.p));
  const apiB = apiOf(B.p);

  // ---- four agents, one proposal each (a promotion on one agent never makes another agent's proposal stale)
  const agents = ((await apiA('GET', '/agents')).body.agents ?? []).filter((a) => a.id !== 'gm').slice(0, 4);
  const names = ['Verified', 'Plain', 'Refused', 'Worse'];
  const P = [];
  for (const [i, a] of agents.entries()) {
    const d = (await apiA('GET', `/agents/${a.id}`)).body.agent;
    const r = await apiA('POST', `/agents/${a.id}/version-proposals`, { title: `${names[i]} candidate`, hypothesis: `Sample hypothesis ${i}.`, candidate: { model: d.model, skills: [...d.skills, 'C47-' + i], tools: d.tools }, baseVersionId: d.versionId }, key());
    P.push({ ...r.body.proposal, agent: d });
  }
  check('setup: four proposals on four agents, none has an evaluation yet', P.length === 4 && P.every((p) => p.id && p.evaluation === null));
  const tenant = (await db.query(`select tenant_id from agent_version_proposals where id=$1`, [P[0].id])).rows[0].tenant_id;
  await dataset('C47-HOLDOUT', 'holdout', tenant); await dataset('C47-DEV', 'dev', tenant);
  const J = 'zzjudge-1';
  // [0] verified better on the holdout; [1] no runs; [2] dev dataset + evaluator = author (refused); [3] significantly worse
  await run('C47-B0', tenant, 'C47-HOLDOUT', { version: P[0].baseVersionId }, LOW, J, bea.id); await run('C47-C0', tenant, 'C47-HOLDOUT', { proposal: P[0].id }, HIGH, J, bea.id);
  await run('C47-B2', tenant, 'C47-DEV', { version: P[2].baseVersionId }, LOW, J, luca.id); await run('C47-C2', tenant, 'C47-DEV', { proposal: P[2].id }, HIGH, J, luca.id);
  await run('C47-B3', tenant, 'C47-HOLDOUT', { version: P[3].baseVersionId }, HIGH, J, bea.id); await run('C47-C3', tenant, 'C47-HOLDOUT', { proposal: P[3].id }, LOW, J, bea.id);

  // ---- B reads Development
  await B.p.goto(base + DEV, { waitUntil: 'domcontentloaded' });
  const card = (i) => B.p.locator(`[data-version-proposal="${P[i].id}"]`);
  check('B sees all four cards', await until(async () => (await B.p.locator('[data-version-proposal]').count()) === 4, 15000));
  const ev = (i) => card(i).locator('[data-evaluation]');
  check('verified: the chip says Verified better, n = 12, no refusal list, no override field',
    (await ev(0).getAttribute('data-evaluation')) === 'verified_better' && (await card(0).locator('[data-eval-outcome="verified_better"]').innerText()).includes('Verified better')
      && (await card(0).locator('[data-eval-n="12"]').count()) === 1 && (await card(0).locator('[data-eval-refusals]').count()) === 0 && (await card(0).locator('[data-override-reason]').count()) === 0);
  check('no runs: the card says there is no evaluation yet and asks for an override reason',
    (await ev(1).getAttribute('data-evaluation')) === 'none' && (await card(1).getByText('No evaluation yet.').count()) === 1 && (await card(1).locator('[data-override-reason]').count()) === 1);
  check('refused: Inconclusive chip and the refusal list names not_holdout, dev_holdout_reuse and evaluator_is_author',
    (await ev(2).getAttribute('data-evaluation')) === 'inconclusive' && (await card(2).locator('[data-eval-refusals] [data-refusal]').count()) >= 3
      && (await card(2).locator('[data-refusal="not_holdout"]').count()) === 1 && (await card(2).locator('[data-refusal="dev_holdout_reuse"]').count()) === 1 && (await card(2).locator('[data-refusal="evaluator_is_author"]').count()) === 1
      && (await card(2).locator('[data-override-reason]').count()) === 1);
  check('worse: the chip says Worse, Promote is disabled, no override field',
    (await ev(3).getAttribute('data-evaluation')) === 'worse' && await card(3).getByRole('button', { name: 'Promote', exact: true }).isDisabled() && (await card(3).locator('[data-override-reason]').count()) === 0);
  check('every evaluation block, and the "no evaluation" one, has the ?', (await B.p.locator('[data-evaluation] [data-help-key="agent.version.evaluation"]').count()) === 4);
  await card(2).locator('[data-help-key="agent.version.evaluation"]').click();
  check('the ? explains "measured on a frozen holdout; inconclusive is not a loss"', await until(async () => (await B.p.getByText(/Measured on a frozen holdout/).count()) > 0 && (await B.p.getByText(/Inconclusive is not a loss/i).count()) > 0, 8000));
  await B.p.keyboard.press('Escape');
  check('the override field has its own ?', (await card(1).locator('[data-help-key="agent.version.override"]').count()) === 1);

  // ---- the action (override field + Promote) is visible without scrolling the panel
  const inView = (loc) => loc.evaluate((el) => {
    const r = el.getBoundingClientRect();
    let a = el.parentElement;
    while (a && a !== document.documentElement) { const o = getComputedStyle(a).overflowY; if ((o === 'auto' || o === 'scroll' || o === 'hidden') && a.scrollHeight > a.clientHeight + 1) break; a = a.parentElement; }
    const c = a && a !== document.documentElement ? a.getBoundingClientRect() : { top: 0, bottom: innerHeight };
    return r.top >= c.top - 1 && r.bottom <= c.bottom + 1 && r.bottom <= innerHeight;
  });
  await settled(B.p);
  check('with an evaluation on the card, its override field and Promote are visible without scrolling the panel',
    await inView(card(2).locator('[data-override-reason]')) && await inView(card(2).getByRole('button', { name: 'Promote', exact: true })) && await inView(card(2).getByRole('button', { name: 'Reject', exact: true })));
  // ---- fits 1366x768: the page itself never scrolls, nothing sideways
  await settled(B.p);
  const fit = await B.p.evaluate(() => ({ page: document.documentElement.scrollHeight - innerHeight, side: document.documentElement.scrollWidth - innerWidth, w: innerWidth, h: innerHeight }));
  check('fits 1366x768: no page scroll and no sideways scroll', fit.w === 1366 && fit.h === 768 && fit.page <= 0 && fit.side <= 0, JSON.stringify(fit));
  await B.p.screenshot({ path: `${SHOTS}/c47-pending-dark-1366x768.png` });
  if (DOC) await B.p.screenshot({ path: `${DOC}/c47-pending-dark-1366x768.png` });

  // ---- the gate in the UI
  await card(1).getByRole('button', { name: 'Promote', exact: true }).click();
  check('Promote with no override reason: refused inline (409), still pending', await until(async () => /at least 10 characters/.test(await card(1).locator('[data-card-error]').innerText()), 8000) && (await card(1).getAttribute('data-status')) === 'pending');
  await card(1).locator('[data-override-reason]').fill('too short');
  await card(1).getByRole('button', { name: 'Promote', exact: true }).click();
  check('a 9-character reason is refused too', await until(async () => /at least 10 characters/.test(await card(1).locator('[data-card-error]').innerText()), 8000) && (await card(1).getAttribute('data-status')) === 'pending');
  await B.p.getByText('All', { exact: true }).click(); // promoted cards leave the Pending filter: keep them listed
  const REASON = 'Reviewed by hand, no measured set covers it.';
  await card(1).locator('[data-override-reason]').fill(REASON);
  check('the counter reaches 10', (await card(1).locator('[data-override-count]').innerText()).startsWith(String(REASON.length)));
  await card(1).getByRole('button', { name: 'Promote', exact: true }).click();
  check('with the override reason it promotes, and the reason is shown on the proposal', await until(async () => (await card(1).getAttribute('data-status')) === 'promoted' && (await card(1).locator('[data-override-shown]').innerText()).includes(REASON), 10000));
  const au = (await db.query(`select result, detail from audit_events where action='agent.version.decide' and subject=$1 and result='ok'`, [P[1].id])).rows;
  check('the audit row holds the reason and no evaluation', au.length === 1 && au[0].detail.overrideReason === REASON && au[0].detail.evaluation === null);

  await card(0).getByRole('button', { name: 'Promote', exact: true }).click();
  check('the verified candidate promotes with no override', await until(async () => (await card(0).getAttribute('data-status')) === 'promoted' && (await card(0).locator('[data-override-shown]').count()) === 0, 10000));
  const au0 = (await db.query(`select detail from audit_events where action='agent.version.decide' and subject=$1 and result='ok'`, [P[0].id])).rows;
  check('its audit row records the verified outcome and the dataset hash', au0.length === 1 && au0[0].detail.evaluation.outcome === 'verified_better' && /^[0-9a-f]{64}$/.test(au0[0].detail.evaluation.datasetSha) && au0[0].detail.overrideReason === undefined);

  // ---- API: worse is refused even with an override; a caller cannot set the evidence
  const cur = ((await apiB('GET', '/version-proposals')).body.proposals ?? []);
  const evSha = (i) => cur.find((p) => p.id === P[i].id).evaluationSha;
  const w = await apiB('POST', `/version-proposals/${P[3].id}/decision`, { decision: 'promote', sha: P[3].sha, evaluationSha: evSha(3), overrideReason: 'I disagree with the measurement.' });
  check('API: promoting a worse candidate is 409 EVAL_WORSE even with an override', w.status === 409 && w.body.code === 'EVAL_WORSE');
  const fake = await apiB('POST', `/version-proposals/${P[2].id}/decision`, { decision: 'promote', sha: P[2].sha, evaluationSha: evSha(2), overrideReason: 'a fake hash is no reason', observedSha256: 'f'.repeat(64) });
  check('API: a fake hash in the request is refused (400)', fake.status === 400);
  const still = ((await apiB('GET', '/version-proposals')).body.proposals ?? []);
  check('API: the evaluations did not change and the other two are still pending', still.find((p) => p.id === P[3].id)?.evaluation.outcome === 'worse' && still.find((p) => p.id === P[2].id)?.evaluation.outcome === 'inconclusive' && still.filter((p) => p.status === 'pending').length === 2);
  const shot = async (name) => { await settled(B.p); await B.p.screenshot({ path: `${SHOTS}/${name}.png` }); if (DOC) await B.p.screenshot({ path: `${DOC}/${name}.png` }); };
  const themed = async (mode) => {
    await B.p.evaluate((m) => localStorage.setItem('axion.settings.v1', JSON.stringify({ state: { themeMode: m }, version: 0 })), mode);
    await B.p.reload({ waitUntil: 'domcontentloaded' });
    await B.p.locator('[data-version-proposals="ready"]').waitFor({ timeout: 15000 });
  };
  for (const mode of ['dark', 'light']) {
    await themed(mode);
    if (mode === 'light') await shot('c47-pending-light-1366x768');
    await B.p.getByText('Decided', { exact: true }).click();
    check(`${mode}: after a reload the override reason is still on the promoted card`, await until(async () => (await card(1).locator('[data-override-shown]').count()) === 1, 12000));
    await card(1).scrollIntoViewIfNeeded();
    await shot(`c47-decided-override-${mode}-1366x768`);
  }
  check('no page errors or console errors', errors.length === 0, errors.join(' | '));
} catch (e) {
  check('script ran to the end', false, String(e?.stack ?? e).split('\n').slice(0, 4).join(' / '));
} finally {
  await db.end().catch(() => undefined);
  await b.close();
}
const bad = results.filter((r) => r.startsWith('FAIL')).length;
console.log(`\n${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
