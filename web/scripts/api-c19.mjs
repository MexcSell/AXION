// Improvement cycle 19 (theme C), api mode: mentoring plans, recorded and honest, in three browsers.
// A (admin) starts a plan for an agent from Agent Profile > Mentoring (mentor, skill, milestones, re-evaluation date);
// B (second admin) sees it live in Agents > Development, ticks a milestone; C (member) watches both live without a
// reload and sees no controls (read only). A closes the plan; it moves to History and Start a plan is free again.
// The re-evaluation line says "Needs evaluation data"; no percentage appears anywhere.
// Run through scripts/api-e2e.sh (lane ports: E2E_API_PORT/E2E_WEB_PORT). Condition waits only (no networkidle).
// The committed screenshot is written only on request: DOC_SHOT_C19=docs/screenshots/improve-c19-mentoring-dark.png
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
const base = process.env.BASE || 'http://127.0.0.1:5193';
const SHOTS = process.env.SHOTS || `/tmp/axion-api-c19-${new URL(base).port}`;
const DOC_SHOT = process.env.DOC_SHOT_C19;
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
const DEV = '/operations?tab=agents&sub=development';
const settled = (p) => until(async () => (await p.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running' && a.effect?.getComputedTiming().iterations !== Infinity).length)) === 0, 8000, 100);
let k = 0;
const key = () => ({ 'idempotency-key': `c19-${Date.now()}-${k++}` });
const X = 'coder-01';
const inDays = (d) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
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
  check('B (second administrator) and C (member) are connected and live', (await live(B.p)) && (await live(C.p)));
  const apiB = apiOf(B.p), apiC = apiOf(C.p);
  const plansOf = async () => ((await apiA('GET', `/agents/${X}/mentoring`)).body.plans ?? []);

  // ------------------------------------------------------------ B and C wait: Development and the profile are empty
  await B.p.goto(base + DEV, { waitUntil: 'domcontentloaded' });
  check('B: Development shows the Mentoring plans panel, empty at first',
    await until(async () => (await B.p.locator('[data-dev-mentoring="ready"]').count()) === 1 && (await B.p.getByText('No active mentoring plans').count()) === 1, 12000));
  await C.p.goto(base + `/agents/${X}?tab=mentoring`, { waitUntil: 'domcontentloaded' });
  check('C (member): the profile Mentoring tab is empty and read only (no Start a plan button)',
    await until(async () => (await C.p.locator('[data-mentoring="ready"]').count()) === 1 && (await C.p.getByText('No active mentoring plan').count()) >= 1, 12000)
      && (await C.p.getByRole('button', { name: 'Start a plan', exact: true }).count()) === 0 && (await C.p.getByText('Read only').count()) >= 1);

  // ------------------------------------------------------------ A starts a plan through the dialog
  await A.p.goto(base + `/agents/${X}?tab=mentoring`, { waitUntil: 'domcontentloaded' });
  await A.p.locator('[data-mentoring="ready"]').waitFor({ timeout: 15000 });
  await A.p.getByRole('button', { name: 'Start a plan', exact: true }).click();
  const dlg = A.p.locator('[role="dialog"]').first();
  await dlg.locator('#mp-skill').waitFor({ timeout: 8000 });
  check('the dialog preselects Mentor-01 and offers no agent as its own mentor',
    (await dlg.locator('#mp-mentor').inputValue()) === 'mentor-01' && (await dlg.locator('#mp-mentor').locator('option[value="' + X + '"]').count()) === 0);
  check('Record plan stays off until the skill and a milestone are given', await dlg.getByRole('button', { name: 'Record plan' }).isDisabled());
  await dlg.locator('#mp-skill').fill('Code review');
  await dlg.getByLabel('Milestone 1', { exact: true }).fill('Read the review rubric');
  await dlg.getByRole('button', { name: 'Add milestone' }).click();
  await dlg.getByLabel('Milestone 2', { exact: true }).fill('Review three pull requests');
  await dlg.getByRole('button', { name: 'Add milestone' }).click();
  await dlg.getByLabel('Milestone 3', { exact: true }).fill('Explain one rejected change');
  const due = inDays(21);
  await dlg.locator('#mp-date').fill(due);
  check('every dialog control has a ? help trigger (mentor, skill, date, milestones)', (await Promise.all(['mentoring.mentor', 'mentoring.skill', 'mentoring.reeval', 'mentoring.milestones'].map((k) => dlg.locator(`[data-help-key="${k}"]`).count()))).every((n) => n >= 1));
  await A.p.screenshot({ path: `${SHOTS}/improve-c19-dialog.png` });
  await dlg.getByRole('button', { name: 'Record plan' }).click();
  check('the dialog closes after Record plan', await until(async () => (await dlg.count()) === 0, 8000));
  const p1 = (await plansOf())[0];
  check('the server stored it: active, mentor-01, 3 milestones none done, evaluation null, no gain field',
    p1?.status === 'active' && p1.mentorId === 'mentor-01' && p1.skill === 'Code review' && p1.milestones.length === 3 && p1.milestonesDone === 0 && p1.reevalOn === due && p1.evaluation === null && !('gain' in p1));
  const card = (pg) => pg.locator(`[data-mentoring-plan="${p1.id}"]`);
  check('A sees the plan card: skill, mentor, "0 of 3 milestones done", the re-evaluation date and "Needs evaluation data"',
    await until(async () => (await card(A.p).count()) === 1, 8000)
      && (await card(A.p).locator('[data-progress="0/3"]').count()) === 1 && (await card(A.p).locator(`[data-reeval="${due}"]`).count()) === 1
      && (await card(A.p).innerText()).includes('Mentor-01') && (await card(A.p).innerText()).includes('Needs evaluation data'));
  check('Start a plan is disabled while a plan is active', await until(async () => await A.p.getByRole('button', { name: 'Start a plan', exact: true }).isDisabled(), 6000));
  const again = await apiA('POST', `/agents/${X}/mentoring`, { mentorId: 'mentor-01', skill: 'Other', milestones: ['x'], reevalOn: due }, key());
  check('a second active plan for the same agent is 409 MENTORING_ACTIVE', again.status === 409 && again.body.code === 'MENTORING_ACTIVE');
  const selfMentor = await apiA('POST', `/agents/${X}/mentoring`, { mentorId: X, skill: 'Other', milestones: ['x'], reevalOn: due }, key());
  check('the agent as its own mentor is 422', selfMentor.status === 422);

  // ------------------------------------------------------------ live in the other browsers
  check('B (Development, no reload) shows the plan: agent, skill, mentor and progress',
    await until(async () => (await card(B.p).count()) === 1 && (await card(B.p).innerText()).includes('Coder-01') && (await card(B.p).locator('[data-progress="0/3"]').count()) === 1, 10000));
  check('C (member, profile, no reload) shows the plan, with no tick, Complete or Cancel controls',
    await until(async () => (await card(C.p).count()) === 1, 10000)
      && (await card(C.p).getByRole('button').filter({ hasText: /Complete|Cancel plan/ }).count()) === 0 && (await card(C.p).getByRole('button', { name: /^Mark milestone/ }).count()) === 0);
  check('the Development card agrees with the profile', (await B.p.locator('[data-dev-mentoring] [data-mentoring-plan]').count()) === 1);

  // ------------------------------------------------------------ B ticks a milestone
  const m1 = p1.milestones[0];
  await card(B.p).getByRole('button', { name: /^Mark milestone 1 done/ }).click();
  check('B ticks milestone 1: the server records who and when',
    await until(async () => { const p = (await plansOf())[0]; return p.milestonesDone === 1 && p.milestones[0].doneByName === 'Bea' && !!p.milestones[0].doneAt; }, 8000));
  check('B\'s card: "1 of 3 milestones done", milestone 1 by Bea; the tick button is gone',
    await until(async () => (await card(B.p).locator('[data-progress="1/3"]').count()) === 1 && (await card(B.p).locator('[data-milestone="1"] [data-done-by="Bea"]').count()) === 1
      && (await card(B.p).getByRole('button', { name: /^Mark milestone 1 done/ }).count()) === 0, 8000));
  check('A (profile) and C (member) see it live: 1 of 3, done by Bea',
    await until(async () => (await card(A.p).locator('[data-progress="1/3"]').count()) === 1 && (await card(C.p).locator('[data-progress="1/3"]').count()) === 1 && (await card(C.p).locator('[data-milestone="1"] [data-done-by="Bea"]').count()) === 1, 10000));
  const tickAgain = await apiB('POST', `/mentoring/${p1.id}/milestones/${m1.id}/done`);
  check('ticking it again is 409', tickAgain.status === 409);
  const memberTick = await apiC('POST', `/mentoring/${p1.id}/milestones/${p1.milestones[1].id}/done`);
  check('a member ticking is 403', memberTick.status === 403);
  const memberStart = await apiC('POST', `/agents/${X}/mentoring`, { mentorId: 'mentor-01', skill: 'x', milestones: ['x'], reevalOn: due }, key());
  check('a member starting a plan is 403', memberStart.status === 403);

  // ------------------------------------------------------------ screenshots (active) and no horizontal overflow
  await settled(A.p);
  await A.p.screenshot({ path: `${SHOTS}/improve-c19-profile-dark.png` });
  if (DOC_SHOT) await A.p.screenshot({ path: DOC_SHOT });
  const overflow = async (p) => p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1 || [...document.querySelectorAll('[data-mentoring-plan]')].some((e) => e.scrollWidth > e.clientWidth + 1));
  check(`no horizontal overflow on the profile Mentoring tab (A) at ${process.env.VW || 1600}px`, !(await overflow(A.p)));
  await settled(B.p);
  await B.p.screenshot({ path: `${SHOTS}/improve-c19-development-dark.png` });
  check(`no horizontal overflow on Development (B) at ${process.env.VW || 1600}px`, !(await overflow(B.p)));
  check('no percentage or "gain" is shown on the plan card', !/%|gain/i.test(await card(A.p).innerText()));

  // ------------------------------------------------------------ A closes the plan: History, and a new plan is possible
  await card(A.p).getByRole('button', { name: 'Cancel plan' }).click();
  await card(A.p).getByLabel('Closing note for Code review').fill('Mentor is reassigned');
  await card(A.p).getByRole('button', { name: 'Confirm cancel' }).click();
  check('the server closed it: cancelled by Luca with the note; milestone 1 still done',
    await until(async () => { const p = (await plansOf())[0]; return p.status === 'cancelled' && p.closedByName === 'Luca' && p.note === 'Mentor is reassigned' && p.milestonesDone === 1; }, 8000));
  check('A: the plan moved to History (cancelled), no active plan, Start a plan is enabled again',
    await until(async () => (await A.p.locator('[data-history="list"] [data-mentoring-plan][data-status="cancelled"]').count()) === 1 && (await A.p.getByText('No active mentoring plan').count()) >= 1
      && !(await A.p.getByRole('button', { name: 'Start a plan', exact: true }).isDisabled()), 10000));
  check('B (Development) lost the card live', await until(async () => (await B.p.locator(`[data-dev-mentoring] [data-mentoring-plan="${p1.id}"]`).count()) === 0 && (await B.p.getByText('No active mentoring plans').count()) === 1, 10000));
  check('C (member) sees it in History live, with the note', await until(async () => (await C.p.locator('[data-history="list"] [data-status="cancelled"]').count()) === 1 && (await C.p.locator('[data-history="list"]').innerText()).includes('Mentor is reassigned'), 10000));
  const closeAgain = await apiA('POST', `/mentoring/${p1.id}/close`, { outcome: 'completed', note: '' });
  check('closing a closed plan is 409 PLAN_CLOSED', closeAgain.status === 409 && closeAgain.body.code === 'PLAN_CLOSED');
  await settled(A.p);
  await A.p.screenshot({ path: `${SHOTS}/improve-c19-history-dark.png` });
} catch (e) { check('script ran to the end', false, String(e).split('\n')[0]); }
for (const [Y, l] of [[A, 'A'], [B, 'B'], [C, 'C']]) await Y?.p.screenshot({ path: `${SHOTS}/improve-c19-end-${l}.png` }).catch(() => {});
console.log(errors.length ? 'PAGE ERRORS:\n' + errors.join('\n') : 'no page errors');
console.log(`${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
writeFileSync(`${SHOTS}/api-c19.txt`, results.join('\n') + '\n');
await b.close();
process.exit(results.some((r) => r.startsWith('FAIL')) || errors.length ? 1 : 0);
