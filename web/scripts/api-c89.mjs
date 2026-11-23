// Improvement cycle 89 (BACKLOG U8), api mode: the screens for change plans (c85) and forecasts (c86). Run through scripts/api-e2e.sh.
// Users: Luca (administrator, proposes and owns the DEMO missions), Omar (a second administrator, decides), Mia (member).
//  1. Plans: Omar sees the Change plan section of a planned proposal (metric label, direction, margin, minimum n, window, guardrail, why, short sha),
//     a dropped planSha is refused with a plain message, then he approves it and the request carries planSha; the readout shows counts per window and
//     "not enough evidence yet"; an amendment is called out as made after the change. Mia (member) sees no plan section and the server refuses her the plan.
//  2. Forecasts: Mia records one forecast before the first review (UI), cannot make a second (a stale form gets a plain refusal), reviews the task and
//     sees her Brier. Her "My forecasts" tab honours the floors (a bin's rate from n>=5, skill from 20 with a baseline). Luca sees none of her scores;
//     an administrator reads one person at a time.
//  3. No page text prints null, undefined or NaN; every number has a ? help.
// Screenshots (dark and light, 1366x768 and 390 px) go to SHOTS (default /tmp/axion-api-c89); the committed ones are in docs/improve/cycles/c89 (DOC_SHOTS=1).
process.env.DATA_MODE ||= 'api';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const { signIn, settle } = await import('./_session.mjs');
const base = process.env.BASE || 'http://127.0.0.1:5193';
const SHOTS = process.env.SHOTS || '/tmp/axion-api-c89';
mkdirSync(SHOTS, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.PW_CHROME || '/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome' });
let bad = 0;
const check = (name, ok, extra = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };
const until = async (f, ms = 10000, step = 150) => { const t0 = Date.now(); for (;;) { try { if (await f()) return true; } catch { /* retry */ } if (Date.now() - t0 > ms) return false; await new Promise((r) => setTimeout(r, step)); } };
const errors = [];
const ctxs = {};
const cookiesOf = {};
let adminApi;
const open = async (name, vw = 1366, vh = 768, theme = 'dark') => {
  const ctx = await b.newContext({ viewport: { width: vw, height: vh } });
  await ctx.addInitScript(() => { try { localStorage.setItem('axion.data-mode', 'api'); } catch { /* ignore */ } });
  if (cookiesOf[name]) await ctx.addCookies(cookiesOf[name]);
  else if (name === 'Luca') await signIn(ctx, 'Luca');
  else {
    // a member of this script: connect, have Luca approve the user and the device, then wait for it
    const device = { name: 'Chrome on Linux (script)', kind: 'desktop', browser: 'Chrome' };
    const c = await ctx.request.post(base + '/api/v1/auth/connect', { data: { name, password: 'script-pass-1', device } });
    if (c.status() === 202) {
      const users = (await adminApi('GET', '/users')).body.users;
      await adminApi('POST', `/users/${users.find((u) => u.name === name).id}/approve`, {});
      if ((await ctx.request.get(base + '/api/v1/auth/wait')).status() !== 200) throw new Error(`${name} was not approved`);
    } else if (c.status() !== 200) throw new Error(`${name} connect: ${c.status()}`);
  }
  cookiesOf[name] ||= await ctx.cookies();
  await ctx.addInitScript((t) => { try { localStorage.setItem('axion.testhook', '1'); localStorage.setItem('axion.settings.v1', JSON.stringify({ state: { themeMode: t, motion: 'reduced' }, version: 0 })); } catch { /* ignore */ } }, theme);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|EventSource|ERR_|409|403|404/.test(m.text())) errors.push(`${name} console: ${m.text()}`); });
  return { ctx, p };
};
let k = 0;
const apiOf = (p) => {
  let csrf = '';
  return async (method, path, data, headers = {}) => {
    if (!csrf && method !== 'GET') csrf = (await (await p.request.get(base + '/api/v1/me')).json()).me.csrf;
    const r = await p.request.fetch(base + '/api/v1' + path, { method, data, headers: { ...(method !== 'GET' ? { 'x-csrf': csrf, 'idempotency-key': `c89-${Date.now()}-${k++}` } : {}), ...headers } });
    return { status: r.status(), body: await r.json().catch(() => ({})) };
  };
};
const BAD_WORDS = /\b(null|undefined|NaN)\b/;
const claimWords = /\b(significant(ly)?|proved|proven|pre-?registered|pre-?registration)\b/i;
const goto = async (p, path) => { await p.goto(base + path, { waitUntil: 'domcontentloaded' }); await settle(p); };
try {
  const A = await open('Luca');
  adminApi = apiOf(A.p);
  await goto(A.p, '/overview');
  const O = await open('Omar'), M = await open('Mia');
  Object.assign(ctxs, { A, O, M });
  await goto(A.p, '/overview');
  const apiA = apiOf(A.p), apiM = apiOf(M.p);
  const users = (await apiA('GET', '/users')).body.users;
  const omar = users.find((u) => u.name === 'Omar'), mia = users.find((u) => u.name === 'Mia');
  await apiA('PATCH', `/users/${omar.id}`, { role: 'admin' });
  await goto(O.p, '/overview'); await goto(M.p, '/overview');
  const apiO = apiOf(O.p);
  check('c89 Luca and Omar are administrators, Mia is a member', (await apiO('GET', '/users')).status === 200 && (await apiM('GET', '/users')).status === 403);

  // ============================================================ 1. change plans
  const g = (await apiA('GET', '/organization/graph')).body;
  const moved = (sub, sup) => g.edges.map((e) => (e.subordinateId === sub ? { ...e, supervisorId: sup } : e));
  const mk = async (title, edges) => (await apiA('POST', '/organization/proposals', { title, why: '', baseRevision: g.revision.seq, edges, baseline: 'No change: keep today\'s reporting lines as they are.', expectedCost: 'One extra hop for escalations from the moved agent.' })).body.proposal;
  const P1 = await mk('Tester under Ops (planned)', moved('tester-01', 'ops-01'));
  const P2 = await mk('Coder under Ops (no plan)', moved('coder-01', 'ops-01'));
  check('c89 two proposals were created through the API', !!P1?.id && !!P2?.id, `${P1?.id} ${P2?.id}`);
  const PLAN = { primary: { metric: 'scorecard.tasks_verified_by_review', direction: 'up', margin: 5 }, minN: 3, windowDays: 14, guardrails: [{ metric: 'process.rework_rate', margin: 2 }], why: 'Fewer hops should get tasks verified sooner; we plan to count reviews before and after.' };
  const put = await apiA('PUT', `/organization/proposals/${P1.id}/plan`, PLAN);
  check('c89 a plan was set through the API (PUT, pending)', put.status === 200 && /^[0-9a-f]{64}$/.test(put.body.sha ?? ''), String(put.status));
  const sha = put.body.sha;

  const pageO = O.p;
  await goto(pageO, '/operations?tab=agents&sub=proposals');
  const c1 = pageO.locator(`[data-proposal="${P1.id}"]`), c2 = pageO.locator(`[data-proposal="${P2.id}"]`);
  await c1.waitFor({ timeout: 15000 });
  check('c89 the planned proposal shows a Change plan section to an administrator', await until(async () => (await c1.locator('[data-plan-state="plan"]').count()) === 1, 10000));
  const sec = c1.locator('[data-plan-state="plan"]');
  const secText = await sec.innerText();
  check('c89 the section shows the metric label, direction, margin, minimum n, window, guardrail label and the why',
    /Tasks verified by review/i.test(secText) && /\bup\b/.test(secText) && /margin 5/.test(secText) && /min n 3 per window/.test(secText) && /14 days/.test(secText) && /rework/i.test(secText) && /Fewer hops should get tasks verified/.test(secText), secText.replace(/\s+/g, ' ').slice(0, 260));
  check('c89 the sha is shown short, with the full sha in its title, and has a copy button', (await sec.locator(`[data-plan-sha="${sha}"]`).count()) === 1 && (await sec.locator(`[data-plan-sha]`).innerText()) === sha.slice(0, 10) && (await sec.getByRole('button', { name: 'Copy plan sha' }).count()) === 1);
  await sec.getByRole('button', { name: 'Copy plan sha' }).click();
  check('c89 copying the sha raises no page error', errors.length === 0, errors.join('|'));
  check('c89 the plan-less proposal says so plainly', await until(async () => (await c2.locator('[data-plan-state="none"]').count()) === 1, 8000));
  check('c89 the Change plan section has ? helps (section, primary, window, guardrails, why, sha)', (await Promise.all(['plan.section', 'plan.primary', 'plan.window', 'plan.guardrails', 'plan.why', 'plan.sha'].map((h) => sec.locator(`[data-help-key="${h}"]`).count()))).every((n) => n >= 1));
  await sec.locator('[data-help-key="plan.section"]').first().click();
  check('c89 the plan ? help opens with its text', await until(async () => /written before|planned before/i.test(await pageO.locator('.help-pop').innerText()), 5000));
  await pageO.keyboard.press('Escape');
  check('c89 no "significant", "proved" or "pre-registered" in the section', !claimWords.test(secText));

  // a decision that leaves out planSha is refused, and the card says so in plain words (the request is edited on its way out)
  await pageO.route('**/api/v1/organization/proposals/*/decision', async (route) => {
    const req = route.request();
    const body = JSON.parse(req.postData() ?? '{}');
    delete body.planSha; await route.continue({ postData: JSON.stringify(body) });
  });
  await c1.getByRole('button', { name: 'Approve', exact: true }).click();
  check('c89 an approval without planSha shows a plain message (PLAN_SHA_REQUIRED), not a raw code', await until(async () => /has a change plan/i.test(await c1.locator('[role="alert"]').first().innerText()) && !/PLAN_SHA|null|undefined/.test(await c1.locator('[role="alert"]').first().innerText()), 8000));
  await pageO.unroute('**/api/v1/organization/proposals/*/decision');
  // now the real approval: the request must carry planSha
  const sent = pageO.waitForRequest((r) => /\/decision$/.test(r.url()) && r.method() === 'POST', { timeout: 15000 });
  await c1.getByRole('button', { name: 'Approve', exact: true }).click();
  const req = await sent;
  const sentBody = JSON.parse(req.postData() ?? '{}');
  check('c89 approving a planned proposal sends planSha, equal to the sha on the card', sentBody.planSha === sha, `${sentBody.planSha?.slice(0, 10)} vs ${sha.slice(0, 10)}`);
  check('c89 the proposal is applied', await until(async () => (await pageO.locator(`[data-proposal="${P1.id}"]`).getAttribute('data-status').catch(() => null)) === 'applied' || (await c1.count()) === 0, 12000));
  await pageO.getByRole('radio', { name: 'All' }).click();
  const a1 = pageO.locator(`[data-proposal="${P1.id}"]`);
  await a1.locator('[data-plan-readout]').waitFor({ timeout: 12000 });
  const ro = await a1.locator('[data-plan-readout]').innerText();
  check('c89 the applied card has a readout with counts per window and "not enough evidence yet"', /not enough evidence yet/i.test(ro) && (await a1.locator('[data-plan-obs]').count()) === 2 && /pre \d+ \/ 3/.test(ro) && /post \d+ \/ 3/.test(ro), ro.replace(/\s+/g, ' ').slice(0, 300));
  check('c89 the readout says "counts only", never "ready" or a verdict word', !/ready for analysis/i.test(ro) && !claimWords.test(ro));
  check('c89 the plan is locked at approval', /locked at approval/.test(await a1.innerText()));
  const al = (await apiA('GET', `/organization/proposals/${P1.id}/plan`)).body;
  check('c89 the server agrees: locked, sha unchanged, verdict not_enough_evidence', al.locked === true && al.sha === sha && al.verdict === 'not_enough_evidence' && al.shaMatches === true, al.verdict);

  // an amendment after the change is called out plainly
  const am = await apiA('POST', `/organization/proposals/${P1.id}/plan/amendments`, { plan: { ...PLAN, minN: 4, why: 'Raised the minimum after seeing how few reviews a window holds, to avoid a thin comparison.' }, reason: 'The first minimum was too small to compare two windows honestly.', baseAmendments: 0 });
  check('c89 an amendment was recorded through the API', am.status === 201 || am.status === 200, String(am.status));
  await goto(pageO, '/operations?tab=agents&sub=proposals');
  await pageO.getByRole('radio', { name: 'All' }).click();
  await a1.locator('[data-plan-amendments]').waitFor({ timeout: 12000 });
  const amt = await a1.locator('[data-plan-amendments]').innerText();
  check('c89 the amendment is shown with its reason and "amended after the change"', /amended after the change/i.test(amt) && /too small to compare/.test(amt) && /minimum n/.test(amt), amt.replace(/\s+/g, ' ').slice(0, 220));
  check('c89 the readout counts still use the locked plan (minimum 3)', /\/ 3/.test(await a1.locator('[data-plan-readout]').innerText()));

  // a member sees no plan section; the server refuses her the plan
  await goto(M.p, '/operations?tab=agents&sub=proposals');
  await M.p.getByRole('radio', { name: 'All' }).click();
  await M.p.locator(`[data-proposal="${P1.id}"]`).waitFor({ timeout: 15000 });
  check('c89 a member sees the proposals but no Change plan section and no plan sha', (await M.p.locator('[data-plan-state]').count()) === 0 && (await M.p.locator('[data-plan-sha]').count()) === 0 && !(await M.p.locator('[data-proposals]').innerText()).includes(sha.slice(0, 10)));
  const mp = await apiM('GET', `/organization/proposals/${P1.id}/plan`);
  check('c89 the server refuses a member the plan (403)', mp.status === 403, String(mp.status));

  // ============================================================ 2. forecasts
  const ms = ((await apiM('GET', '/missions')).body.missions ?? []).filter((m) => m.shared !== false);
  const cand = [];
  for (const m of ms) {
    const ts = (await apiM('GET', `/missions/${m.id}/tasks`)).body;
    if (!Array.isArray(ts)) continue;
    for (const t of ts.filter((x) => x.owner)) {
      const r = (await apiM('GET', `/tasks/${t.id}/reviews`)).body;
      if (r.canReview?.allowed && r.reviews.length === 0) cand.push({ mission: m.id, task: t, canAccept: !!r.canAccept });
    }
  }
  check('c89 Mia can review at least one task', cand.length >= 1, `${cand.length} reviewable tasks`);
  const main = cand.find((c) => c.canAccept) ?? cand[0];
  const review = (c, verdict) => apiM('POST', `/tasks/${c.task.id}/reviews`, verdict === 'accepted'
    ? { verdict, rubric: [{ criterion: 'The output is attached and opens', result: 'pass', note: '' }], evidence: [{ kind: 'url', ref: 'https://example.com/report' }] }
    : { verdict, rubric: [{ criterion: 'The output meets its criteria', result: 'fail', note: 'checked' }], evidence: [] });
  const openTask = async (Y, c) => {
    await goto(Y.p, `/missions/${c.mission}?tab=task-flow`);
    await Y.p.locator(`[aria-label^="${c.task.id} "]`).first().click({ timeout: 15000 });
    await Y.p.locator('[role="dialog"]').first().waitFor({ timeout: 8000 });
    await until(async () => (await Y.p.locator('[data-review-list="ready"]').count()) === 1, 10000);
    return Y.p.locator('[role="dialog"]').first();
  };
  // a second tab of Mia, opened BEFORE she forecasts, so its form goes stale
  const M2 = { p: await M.ctx.newPage() }; M2.p.on('pageerror', (e) => errors.push(`M2: ${e.message}`));
  const d2 = await openTask(M2, main);
  const dm = await openTask(M, main);
  check('c89 before the first review the task drawer shows "Your forecast" with a 1..99 control', await until(async () => (await dm.locator('[data-forecast="form"]').count()) === 1, 8000) && (await dm.locator('[data-forecast-range]').getAttribute('min')) === '1' && (await dm.locator('[data-forecast-range]').getAttribute('max')) === '99');
  check('c89 it says, before submitting, that a forecast is final', /cannot be edited or repeated/i.test(await dm.locator('[data-forecast-final-note]').innerText()));
  check('c89 the control has ? helps (forecast, percent, final)', (await dm.locator('[data-help-key="forecast.control"]').count()) >= 1 && (await dm.locator('[data-help-key="forecast.percent"]').count()) >= 1);
  await dm.locator('[data-forecast-input]').fill('80');
  check('c89 the button names the percent', /80%/.test(await dm.locator('[data-forecast-submit]').innerText()));
  await M.p.screenshot({ path: `${SHOTS}/forecast-form-dark-1366.png` });
  await dm.locator('[data-forecast-submit]').click();
  check('c89 after recording, the drawer shows the locked forecast, 80%, waiting for the first review', await until(async () => (await dm.locator('[data-forecast="open"] [data-forecast-pct="80"]').count()) === 1, 8000));
  check('c89 the form is gone (no second forecast offered)', (await dm.locator('[data-forecast-range]').count()) === 0);
  const dup = await apiM('POST', `/tasks/${main.task.id}/forecasts`, { probability: 0.3 });
  check('c89 a second forecast through the API is refused (409, exists)', dup.status === 409 && dup.body.fieldErrors?.forecast === 'exists', `${dup.status} ${JSON.stringify(dup.body.fieldErrors)}`);
  await d2.locator('[data-forecast-input]').fill('30');
  await d2.locator('[data-forecast-submit]').click();
  check('c89 a stale form gets a plain refusal, not a raw code', await until(async () => /already recorded a forecast/i.test(await d2.locator('[data-forecast-error]').innerText()), 8000) && !BAD_WORDS.test(await d2.locator('[data-forecast-error]').innerText()));
  const mine0 = (await apiM('GET', '/me/forecasts')).body;
  check('c89 the ledger still has one forecast for the task, at 0.80', mine0.forecasts.filter((f) => f.taskId === main.task.id).length === 1 && mine0.forecasts.find((f) => f.taskId === main.task.id).probability === 0.8);
  await M2.p.close();

  // Mia reviews it; the drawer then shows her forecast, the outcome and her Brier
  const verdict = main.canAccept ? 'accepted' : 'rejected';
  const rv = await review(main, verdict);
  check('c89 Mia recorded the first review', rv.status === 201 || rv.status === 200, String(rv.status));
  const o = verdict === 'accepted' ? 1 : 0, brier = ((0.8 - o) ** 2).toFixed(3);
  check(`c89 after the review the drawer shows the forecast, the outcome (${verdict}) and Brier ${brier}`,
    await until(async () => (await dm.locator('[data-forecast="resolved"] [data-forecast-result]').count()) === 1 && (await dm.locator(`[data-forecast-brier="${brier}"]`).count()) === 1 && (verdict === 'accepted' ? /First review: accepted/ : /not accepted/).test(await dm.locator('[data-forecast-result]').innerText()), 12000), brier);
  check('c89 the result has a ? help', (await dm.locator('[data-help-key="forecast.result"]').count()) >= 1);
  await settle(M.p);
  await M.p.screenshot({ path: `${SHOTS}/forecast-result-dark-1366.png` });
  await M.p.keyboard.press('Escape');

  // five more forecasts in the 61-80 bin, then reviews (rejected: a finished task can always be rejected), so one bin reaches n=5
  const more = cand.filter((c) => c !== main).slice(0, 5);
  for (const c of more) { const f = await apiM('POST', `/tasks/${c.task.id}/forecasts`, { probability: 0.7 }); if (f.status !== 201) console.log('seed forecast', f.status, JSON.stringify(f.body)); await review(c, 'rejected'); }
  const led = (await apiM('GET', '/me/forecasts')).body;
  const bin = (l, lo) => l.calibration.find((x) => Math.round(x.lo * 100) === lo);
  console.log(`seeded: ${led.counts.resolved} resolved, bin 61-80 n=${bin(led, 61).n}, skill ${led.skill.text}`);
  const reached = bin(led, 61).n >= 5;
  check('c89 the seeded record has a bin below the floor and a skill below 20', bin(led, 1).n < 5 && led.skill.state === 'not_enough_evidence');

  // My forecasts (Settings tab)
  await goto(M.p, '/settings?tab=forecasts');
  await M.p.locator('[data-forecasts]').waitFor({ timeout: 15000 });
  const fc = M.p.locator('[data-forecasts]');
  check('c89 My forecasts shows count, mean Brier and mean log loss from the API', await until(async () => { const t = await fc.innerText(); return t.includes(String(led.counts.total)) && t.includes(led.meanBrier.toFixed(3)) && t.includes(led.meanLogLoss.toFixed(3)); }, 8000), `brier ${led.meanBrier.toFixed(3)} log ${led.meanLogLoss.toFixed(3)}`);
  for (const b0 of led.calibration) {
    const lo = Math.round(b0.lo * 100), hi = Math.round(b0.hi * 100);
    const el = M.p.locator(`[data-fc-bin="${lo}-${hi}"]`);
    const shown = (await el.getAttribute('data-rate')) === 'shown';
    check(`c89 calibration ${lo}-${hi}%: n=${b0.n}, rate ${b0.n >= 5 ? 'shown' : 'hidden (floor 5)'}`, shown === (b0.n >= 5) && (await el.getAttribute('data-n')) === String(b0.n) && (!shown || (await el.innerText()).includes(`accepted ${Math.round(b0.rate * 100)}%`)));
  }
  check('c89 a bin below the floor says how many forecasts it has, and never a rate', (await M.p.locator('[data-fc-bin][data-rate="hidden"]').first().innerText()).length > 0 && !/accepted \d+%/.test((await M.p.locator('[data-fc-bin][data-rate="hidden"]').first().innerText())));
  if (!reached) console.log('NOTE: not enough reviewable tasks in the demo seed to put 5 forecasts in one bin; the shown-rate branch is covered only by n<5 here');
  const skillTxt = await M.p.locator('[data-forecasts] .kt', { hasText: 'Skill against the baseline' }).innerText();
  check(`c89 skill reads "${led.skill.text}" (below 20 with a baseline), no number`, skillTxt.includes(led.skill.text) && !/-?\d\.\d\d\b/.test(skillTxt.replace(led.skill.text, '')), skillTxt.replace(/\s+/g, ' '));
  check('c89 the method text is the API\'s', (await M.p.locator('[data-fc-method]').innerText()).includes(led.method.slice(0, 80)));
  check('c89 the page has ? helps on the numbers and controls (count, Brier, log, skill, calibration, bins, list, method)', (await Promise.all(['forecasts.count', 'forecasts.brier', 'forecasts.log', 'forecasts.skill', 'forecasts.calibration', 'forecasts.bin', 'forecasts.list', 'forecasts.method'].map((h) => M.p.locator(`[data-forecasts] [data-help-key="${h}"]`).count()))).every((n) => n >= 1));
  await M.p.locator('[data-forecasts] [data-help-key="forecasts.skill"]').first().click();
  check('c89 the skill ? explains the 20-forecast floor', await until(async () => /20/.test(await M.p.locator('.help-pop').innerText()), 5000));
  await M.p.keyboard.press('Escape');
  check('c89 My forecasts lists the forecast on the main task with its Brier', (await M.p.locator(`[data-fc-item="${main.task.id}"]`).innerText()).includes(brier));
  const fit = await M.p.evaluate(() => { const m = document.querySelector('main'); return { over: m.scrollHeight - m.clientHeight, side: document.documentElement.scrollWidth - innerWidth }; });
  check('c89 My forecasts fits one screen at 1366x768 (only the tab content scrolls)', fit.over <= 2 && fit.side <= 0, JSON.stringify(fit));
  await M.p.screenshot({ path: `${SHOTS}/forecasts-dark-1366.png` });

  // no other person's scores; one person at a time for administrators
  const forecastersRoute = await apiA('GET', '/forecasts');
  check('c89 there is no route that lists forecasters (404)', forecastersRoute.status === 404, String(forecastersRoute.status));
  const lm = (await apiA('GET', '/me/forecasts')).body;
  check('c89 Luca\'s own ledger has none of Mia\'s forecasts', lm.counts.total === 0 && lm.forecasts.length === 0 && lm.forecaster.name === 'Luca');
  await goto(A.p, '/settings?tab=forecasts');
  await A.p.locator('[data-forecasts]').waitFor({ timeout: 15000 });
  const lt = await A.p.locator('[data-forecasts]').innerText();
  check('c89 Luca\'s My forecasts shows no forecast and none of Mia\'s numbers', (await A.p.locator('[data-fc-item]').count()) === 0 && !lt.includes('Mia') && !lt.includes(main.task.id));
  const openA = await openTask(A, main);
  check('c89 Luca (who can see the task) is offered his own empty form, not Mia\'s forecast', await until(async () => (await openA.locator('[data-forecast]').getAttribute('data-forecast')) === 'closed', 8000) && !/80%/.test(await openA.locator('[data-forecast]').innerText()));
  await A.p.keyboard.press('Escape');
  check('c89 a member cannot read another person\'s forecasts (403)', (await apiM('GET', `/users/${omar.id}/forecasts`)).status === 403);
  await goto(A.p, '/settings?tab=users');
  await A.p.locator(`[data-user-forecasts="${mia.id}"]`).click();
  const ud = A.p.locator('[data-dialog="DL-101"]');
  await ud.waitFor({ timeout: 10000 });
  check('c89 an administrator opens ONE person\'s forecasts from Settings > Users, and sees Mia\'s record', await until(async () => (await ud.locator('[data-fc-item]').count()) === led.counts.total, 10000) && /Forecasts of Mia/.test(await ud.innerText()));
  await A.p.keyboard.press('Escape');
  await M.p.goto(base + '/settings?tab=users', { waitUntil: 'domcontentloaded' }); await settle(M.p);
  check('c89 a member has no per-person forecasts button', (await M.p.locator('[data-user-forecasts]').count()) === 0);

  // ============================================================ 3. no null / undefined / NaN anywhere visited
  const pages = [[O.p, '/operations?tab=agents&sub=proposals'], [M.p, '/settings?tab=forecasts'], [A.p, '/settings?tab=forecasts']];
  for (const [p, path] of pages) { await goto(p, path); check(`c89 ${path} prints no null, undefined or NaN`, !BAD_WORDS.test(await p.locator('main').innerText())); }

  // ============================================================ screenshots: dark and light, 1366x768 and 390
  const shoot = async (name, vw, vh, theme, path, pre) => {
    const X = await open(name, vw, vh, theme);
    try { await goto(X.p, path); if (pre) await pre(X.p); await settle(X.p); await X.p.screenshot({ path: `${SHOTS}/${name === 'Omar' ? 'plan' : 'forecasts'}-${theme}-${vw}.png` }); } finally { await X.ctx.close(); }
  };
  for (const [vw, vh] of [[1366, 768], [390, 844]]) for (const theme of ['dark', 'light']) {
    await shoot('Omar', vw, vh, theme, '/operations?tab=agents&sub=proposals', async (p) => { await p.getByRole('radio', { name: 'All' }).click(); await p.locator('[data-plan-readout]').first().waitFor({ timeout: 12000 }); await p.locator('[data-plan-readout]').first().scrollIntoViewIfNeeded(); });
    await shoot('Mia', vw, vh, theme, '/settings?tab=forecasts', async (p) => { await p.locator('[data-forecasts]').waitFor({ timeout: 12000 }); });
  }
  check('c89 screenshots written (dark and light, 1366 and 390)', true);
  check('c89 no page errors', errors.length === 0, errors.join(' | '));
} catch (e) { check('c89 script ran to the end', false, String(e.stack ?? e).split('\n').slice(0, 3).join(' | ')); }
for (const [n, X] of Object.entries(ctxs)) await X.p?.screenshot({ path: `${SHOTS}/end-${n}.png` }).catch(() => {});
console.log(errors.length ? 'PAGE ERRORS:\n' + errors.join('\n') : 'no page errors');
console.log(bad ? `FAILED: ${bad}` : 'all checks passed');
await b.close();
process.exit(bad || errors.length ? 1 : 0);
