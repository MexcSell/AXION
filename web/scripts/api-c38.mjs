// Improvement cycle 38 (Phase 2 · O3), api mode: independent task review, producer != verifier.
// A (the administrator, who owns the DEMO missions) opens a task of a shared mission: the Review action is disabled and its
// ? explains why. B (a member, approved by A) opens the same task, reviews it (Escape and Cancel leave the dialog without
// recording anything, then accepts it with criteria marked and a link as evidence), sees the verdict chip, and the scorecard
// row "Tasks verified by review" (include DEMO on) goes up by exactly one with n+1, live. A sees the chip live.
// Run through scripts/api-e2e.sh (lane ports: E2E_API_PORT/E2E_WEB_PORT). Condition waits only (no networkidle).
// Screenshots: SHOTS (default /tmp/axion-api-c38-PORT); DOC_SHOT_C38=docs/screenshots/improve-c38-review-dark.png writes the committed one.
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
const base = process.env.BASE || 'http://127.0.0.1:5193';
const SHOTS = process.env.SHOTS || `/tmp/axion-api-c38-${new URL(base).port}`;
const DOC_SHOT = process.env.DOC_SHOT_C38;
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
const settled = (p) => until(async () => (await p.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running' && a.effect?.getComputedTiming().iterations !== Infinity).length)) === 0, 8000, 100);
let k = 0;
const key = () => ({ 'idempotency-key': `c38-${Date.now()}-${k++}` });
let A, B;
try {
  A = await browser('A');
  await A.p.goto(base + '/missions', { waitUntil: 'domcontentloaded' });
  await connect(A.p, 'Luca', 'secret-1');
  check('A (first user = administrator, owner of the DEMO missions) is connected and live', await live(A.p));
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

  // ------------------------------------------------------------ pick a shared DEMO mission with an owned task
  const ms = ((await apiB('GET', '/missions')).body.missions ?? []).filter((m) => m.shared !== false);
  let mission = null, task = null;
  for (const m of ms) {
    const ts = (await apiB('GET', `/missions/${m.id}/tasks`)).body;
    const t = Array.isArray(ts) ? ts.find((x) => x.owner) : null;
    if (t) { mission = m.id; task = t; break; }
  }
  check('B can see a shared mission with an owned task', !!task, `${mission} ${task?.id}`);
  const tasksUrl = `${base}/missions/${mission}?tab=task-flow`;
  const openTask = async (Y) => {
    await Y.p.goto(tasksUrl, { waitUntil: 'domcontentloaded' });
    await Y.p.locator(`[aria-label^="${task.id} "]`).first().click({ timeout: 15000 });
    await Y.p.locator('[role="dialog"]').first().waitFor({ timeout: 8000 });
    await until(async () => (await Y.p.locator('[data-review-list="ready"]').count()) === 1, 10000);
    return Y.p.locator('[role="dialog"]').first();
  };
  const reviewsOf = async () => (await apiA('GET', `/tasks/${task.id}/reviews`)).body;
  const before = await reviewsOf();
  check('the server says A (the mission owner) cannot review and B can; the task has no review yet',
    before.canReview?.allowed === false && before.canReview.code === 'REVIEW_NOT_INDEPENDENT' && (await apiB('GET', `/tasks/${task.id}/reviews`)).body.canReview?.allowed === true && before.reviews.length === 0);

  // ------------------------------------------------------------ the scorecard row, B's Overview, DEMO included
  const B2 = { ctx: B.ctx, p: await B.ctx.newPage() }; // a second tab of the same signed-in session
  B2.p.on('pageerror', (e) => errors.push(`B2: ${e.message}`));
  await B2.p.goto(base + '/overview', { waitUntil: 'domcontentloaded' });
  const row = (p) => p.locator('[data-row="tasks_verified_by_review"]');
  await B2.p.locator('[data-scorecard]').waitFor({ timeout: 15000 });
  await B2.p.getByRole('switch', { name: 'Include DEMO missions' }).click();
  check('the scorecard lists "Approved by a non-owner" and "Tasks verified by review" as separate rows, with n',
    await until(async () => (await B2.p.locator('[data-row="approved_by_non_owner"]').count()) === 1 && (await row(B2.p).count()) === 1 && (await row(B2.p).getAttribute('data-n')) !== null, 12000));
  const v0 = Number(await row(B2.p).getAttribute('data-value')), n0 = Number(await row(B2.p).getAttribute('data-n'));

  // ------------------------------------------------------------ A, the producer's side: Review is disabled, its ? explains
  const da = await openTask(A);
  const actA = da.locator('[data-review-action]');
  check('A (mission owner): the Review button is disabled, with the reason code from the server',
    (await actA.getAttribute('data-review-action')) === 'disabled' && (await actA.getAttribute('data-review-code')) === 'REVIEW_NOT_INDEPENDENT' && await da.getByRole('button', { name: 'Review', exact: true }).isDisabled());
  check('A: the Review action carries its ? help (review.who)', (await actA.locator('[data-help-key="review.who"]').count()) === 1);
  await actA.locator('[data-help-key="review.who"]').first().click();
  check('A: the ? explains why a producer or commissioner cannot review', await until(async () => /commissioned|produced/i.test(await A.p.locator('body').innerText()) && (await A.p.getByText(/independent/i).count()) > 0, 8000));
  await A.p.keyboard.press('Escape');
  check('A: the task shows "No review yet"', await until(async () => (await A.p.getByText(/No review yet/).count()) >= 1, 6000));
  await A.p.screenshot({ path: `${SHOTS}/improve-c38-producer-disabled.png` });

  // ------------------------------------------------------------ B reviews
  const db = await openTask(B);
  const actB = db.locator('[data-review-action]');
  check('B: the Review button is enabled', (await actB.getAttribute('data-review-action')) === 'enabled' && !(await db.getByRole('button', { name: 'Review', exact: true }).isDisabled()));
  await db.getByRole('button', { name: 'Review', exact: true }).click();
  const dlg = B.p.locator('[data-dialog="DL-80"]');
  await dlg.waitFor({ timeout: 8000 });
  check('the review dialog is DL-80 and its controls have ? help (verdict, criteria, evidence)',
    (await Promise.all(['review.verdict', 'review.rubric', 'review.evidence', 'review.dialog'].map((h) => B.p.locator(`[data-dialog="DL-80"] [data-help-key="${h}"]`).count()))).every((n) => n >= 1));
  check('Record review stays off until a verdict, every criterion and (to accept) evidence are given', await dlg.getByRole('button', { name: 'Record review' }).isDisabled());
  await until(async () => dlg.evaluate((el) => el.contains(document.activeElement)), 4000); // focus moves into the dialog on its own
  await B.p.keyboard.press('Escape');
  const closedByEsc = await until(async () => (await B.p.locator('[data-dialog="DL-80"]').count()) === 0, 6000);
  check('Escape closes the dialog and records nothing', closedByEsc && (await reviewsOf()).reviews.length === 0, `closed=${closedByEsc} dialogs=${await B.p.locator('[role="dialog"]').count()}`);
  await db.getByRole('button', { name: 'Review', exact: true }).click();
  await dlg.waitFor({ timeout: 8000 });
  await dlg.getByRole('button', { name: 'Cancel', exact: true }).click();
  check('Cancel closes the dialog and records nothing', await until(async () => (await B.p.locator('[data-dialog="DL-80"]').count()) === 0, 6000) && (await reviewsOf()).reviews.length === 0);

  await db.getByRole('button', { name: 'Review', exact: true }).click();
  await dlg.waitFor({ timeout: 8000 });
  await until(async () => (await dlg.locator('[data-crit]').count()) > 0, 8000);
  await dlg.getByRole('radio', { name: /Accepted/ }).click();
  const nCrit = await dlg.locator('[data-crit]').count();
  for (let i = 0; i < nCrit; i++) {
    const c = dlg.locator(`[data-crit="${i}"]`);
    if ((await c.locator('input[aria-label^="Criterion"]').count()) === 1) await c.locator('input[aria-label^="Criterion"]').fill('The output is attached and opens');
    await c.getByRole('radio', { name: 'Pass', exact: true }).click();
  }
  check('with every criterion passed but no evidence, accepting is still refused (button off, hint shown)',
    await dlg.getByRole('button', { name: 'Record review' }).isDisabled() && /evidence/i.test(await dlg.locator('[data-dialog-hint]').innerText()));
  await dlg.getByLabel('Evidence link').fill('https://example.com/report');
  await dlg.getByRole('button', { name: 'Add link' }).click();
  await B.p.screenshot({ path: `${SHOTS}/improve-c38-dialog.png` });
  if (DOC_SHOT) await B.p.screenshot({ path: DOC_SHOT });
  await dlg.getByRole('button', { name: 'Record review' }).click();
  check('the dialog closes after Record review', await until(async () => (await B.p.locator('[data-dialog="DL-80"]').count()) === 0, 8000));
  const after = await reviewsOf();
  check('the server stored one accepted review by Mia (user), producer an agent with a derived model family, evidence one link',
    after.reviews.length === 1 && after.reviews[0].verdict === 'accepted' && after.reviews[0].reviewer.name === 'Mia' && after.reviews[0].reviewer.kind === 'user'
      && after.reviews[0].producer.kind === 'agent' && !!after.reviews[0].producer.modelFamily && after.reviews[0].evidence.length === 1 && after.reviews[0].evidence[0].kind === 'url');
  check('B: the task drawer lists the review with an "Accepted" chip and the reviewer', await until(async () => (await db.locator('.rv-item[data-verdict="accepted"]').count()) === 1 && /Mia/.test(await db.locator('.rv-item').innerText()), 8000));
  check('the reviewer agreement says "not enough evidence" with n (no bare number)', /not enough evidence \(n=0\)/.test(await db.locator('.rv-item').innerText()));
  await settled(B.p);
  await B.p.screenshot({ path: `${SHOTS}/improve-c38-reviewed.png` });

  // ------------------------------------------------------------ the scorecard moved, exactly
  check('the scorecard row "Tasks verified by review" went up by exactly one and n by one, live (B Overview)',
    await until(async () => Number(await row(B2.p).getAttribute('data-value')) === v0 + 1 && Number(await row(B2.p).getAttribute('data-n')) === n0 + 1, 12000), `${v0}/${n0} -> ${v0 + 1}/${n0 + 1}`);
  await settled(B2.p);
  await B2.p.screenshot({ path: `${SHOTS}/improve-c38-scorecard.png` });

  // ------------------------------------------------------------ the producer's side sees it, still cannot review
  const da2 = await openTask(A);
  check('A: sees the "Accepted" chip by Mia, and Review is still disabled', (await da2.locator('.rv-item[data-verdict="accepted"]').count()) === 1 && (await da2.locator('[data-review-action]').getAttribute('data-review-action')) === 'disabled');
  const forged = await apiA('POST', `/tasks/${task.id}/reviews`, { verdict: 'accepted', rubric: [{ criterion: 'x', result: 'pass', note: '' }], evidence: [{ kind: 'url', ref: 'https://example.com' }] }, key());
  check('A posting a review directly is refused: 403 REVIEW_NOT_INDEPENDENT', forged.status === 403 && forged.body.code === 'REVIEW_NOT_INDEPENDENT');
  const overflow = async (p) => p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check(`no horizontal overflow with the drawer open (A) at ${process.env.VW || 1600}px`, !(await overflow(A.p)));
} catch (e) { check('script ran to the end', false, String(e).split('\n')[0]); }
for (const [Y, l] of [[A, 'A'], [B, 'B']]) await Y?.p.screenshot({ path: `${SHOTS}/improve-c38-end-${l}.png` }).catch(() => {});
console.log(errors.length ? 'PAGE ERRORS:\n' + errors.join('\n') : 'no page errors');
console.log(`${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
writeFileSync(`${SHOTS}/api-c38.txt`, results.join('\n') + '\n');
await b.close();
process.exit(results.some((r) => r.startsWith('FAIL')) || errors.length ? 1 : 0);
