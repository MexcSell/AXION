// Improvement cycle 33 (Phase 2, E3), api mode: failure-mode tagging with the MAST taxonomy, in the browser.
// A (administrator) opens a failed task of the seeded missions, chooses Tag failure, picks a category and a mode (each mode has a ?
// with the paper's definition), tags it (proposed), confirms it, and sees the count go to 1 with n shown. Then every other failed
// or retried task of the seed is tagged through the API: each can carry a tag, and the count stays 1 (proposed tags are not counted).
// The dialog has two tested exits (Escape, Close). Run through scripts/api-e2e.sh (lane ports). Condition waits only (no networkidle).
// The committed screenshots are written only on request: DOC_SHOT_C33=docs/screenshots/improve-c33-tag-failure-dark.png
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
const base = process.env.BASE || 'http://127.0.0.1:5193';
const SHOTS = process.env.SHOTS || `/tmp/axion-api-c33-${new URL(base).port}`;
const DOC_SHOT = process.env.DOC_SHOT_C33;
const DOC_SHOT2 = process.env.DOC_SHOT_C33_COUNTS;
mkdirSync(SHOTS, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.PW_CHROME || '/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome' });
const results = [];
const errors = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); console.log(results[results.length - 1]); };
const until = async (f, ms = 10000, step = 150) => { const t0 = Date.now(); for (;;) { try { if (await f()) return true; } catch { /* retry */ } if (Date.now() - t0 > ms) return false; await new Promise((r) => setTimeout(r, step)); } };
const ctx = await b.newContext({ viewport: { width: Number(process.env.VW || 1600), height: Number(process.env.VH || 940) } });
await ctx.addInitScript(() => { try { localStorage.setItem('axion.data-mode', 'api'); localStorage.setItem('axion.testhook', '1'); if (!localStorage.getItem('axion.settings.v1')) localStorage.setItem('axion.settings.v1', JSON.stringify({ state: { themeMode: 'dark' }, version: 0 })); } catch { /* ignore */ } });
const p = await ctx.newPage();
p.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_CONNECTION|ERR_INTERNET_DISCONNECTED|502|503|504|EventSource/.test(m.text())) errors.push(`console: ${m.text()}`); });
let csrf = '';
const apiA = async (method, path, data, headers = {}) => {
  if (!csrf && method !== 'GET') csrf = (await (await p.request.get(base + '/api/v1/me')).json()).me.csrf;
  const r = await p.request.fetch(base + '/api/v1' + path, { method, data, headers: { ...(method !== 'GET' ? { 'x-csrf': csrf } : {}), ...headers } });
  return { status: r.status(), body: await r.json().catch(() => ({})) };
};
const settled = () => until(async () => (await p.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running' && a.effect?.getComputedTiming().iterations !== Infinity).length)) === 0, 8000, 100);
let k = 0;
const key = () => ({ 'idempotency-key': `c33-${Date.now()}-${k++}` });
const TAXO = { FC1: ['FM-1.1', 'FM-1.2', 'FM-1.3', 'FM-1.4', 'FM-1.5'], FC2: ['FM-2.1', 'FM-2.2', 'FM-2.3', 'FM-2.4', 'FM-2.5', 'FM-2.6'], FC3: ['FM-3.1', 'FM-3.2', 'FM-3.3'] };
try {
  await p.goto(base + '/missions', { waitUntil: 'domcontentloaded' });
  await p.getByRole('heading', { name: 'Connect' }).waitFor({ timeout: 15000 });
  await p.getByLabel('Name').fill('Luca');
  await p.getByLabel('Password', { exact: true }).fill('secret-1');
  await p.getByRole('button', { name: /Connect/ }).click();
  await p.locator('.rail-nav').first().waitFor({ timeout: 15000 });
  check('A (first user = administrator) is connected and live', await until(async () => (await p.locator('.conn-badge').getAttribute('data-conn')) === 'live', 15000));

  // ------------------------------------------------------------ the seed's failed tasks (DEMO missions, simulated tasks)
  const missions = ((await apiA('GET', '/missions')).body.missions ?? []).map((m) => m.id);
  const failed = [];
  for (const mid of missions) for (const t of ((await apiA('GET', `/missions/${mid}/tasks`)).body ?? [])) if (t.state === 'failed') failed.push({ mid, id: t.id, title: t.title });
  check('the e2e seed has a failed task to tag', failed.length >= 1, `${failed.length} failed task(s): ${failed.map((f) => f.id).join(', ')}`);
  const first = failed[0];
  const counts = async (qs = 'window=30d&includeDemo=1') => (await apiA('GET', `/company/failure-modes?${qs}`)).body;
  const c0 = await counts();
  check('before any tag: n=0 and every count is null (not 0)', c0.n === 0 && c0.categories.every((c) => c.count === null && c.modes.every((m) => m.count === null)), `n=${c0.n}`);

  // ------------------------------------------------------------ open the failed task, choose Tag failure
  const openTask = async (t) => {
    await p.goto(`${base}/missions/${t.mid}?tab=task-flow`, { waitUntil: 'domcontentloaded' });
    const el = p.locator(`[aria-label^="${t.id} "]`).first();
    await el.waitFor({ timeout: 15000 });
    await el.click();
    await p.locator('[data-dialog="DL-13"]').waitFor({ timeout: 8000 });
  };
  await openTask(first);
  const tagBtn = p.locator('[data-dialog="DL-13"] [data-tag-failure]');
  check('the failed task\'s dialog offers "Tag failure"', await until(async () => (await tagBtn.count()) === 1, 8000));
  await tagBtn.click();
  const dlg = p.locator('[data-dialog="DL-78"]');
  await dlg.waitFor({ timeout: 8000 });
  check('the Tag a failure dialog (DL-78) opens with its taxonomy picker', await until(async () => (await dlg.locator('[data-mode-picker]').count()) === 1 && (await dlg.locator('[data-failure-counts="ready"]').count()) === 1, 10000));
  check('the dialog states the source and the version', /arXiv 2503\.13657/.test(await dlg.innerText()) && /mast-arxiv-2503\.13657v3/.test(await dlg.innerText()));
  check('Tag failure stays off until a mode is chosen', await dlg.locator('[data-tag-submit]').isDisabled());
  // every category: its modes, each with a ? help carrying the paper's definition
  let modesOk = true; const seen = [];
  for (const [cid, ids] of Object.entries(TAXO)) {
    await dlg.getByRole('radio', { name: new RegExp(`^${cid} `) }).click();
    const got = await dlg.locator('[data-mode]').evaluateAll((els) => els.map((e) => e.getAttribute('data-mode')));
    const helps = await Promise.all(ids.map((id) => dlg.locator(`[data-help-key="failure.mode.${id}"]`).count()));
    modesOk &&= JSON.stringify(got) === JSON.stringify(ids) && helps.every((n) => n === 1); seen.push(`${cid}:${got.length}`);
  }
  check('the three categories list 5, 6 and 3 modes, each mode with its own ? help', modesOk, seen.join(' '));
  await dlg.getByRole('radio', { name: /^FC1 / }).click();
  await dlg.locator('[data-help-key="failure.mode.FM-1.3"]').click();
  check('the ? of FM-1.3 quotes the paper (Step repetition: "Unnecessary reiteration of previously completed steps")',
    await until(async () => /Unnecessary reiteration of previously completed steps/.test(await p.locator('.help-pop').first().innerText()) && /FM-1\.3: Step repetition/.test(await p.locator('.help-pop').first().innerText()), 6000));
  await p.keyboard.press('Escape');
  check('Escape closes the ? popover and keeps the dialog', await until(async () => (await p.locator('.help-pop').count()) === 0 && (await dlg.count()) === 1, 4000));
  await dlg.locator('[data-mode="FM-1.3"]').click();
  await dlg.locator('#ft-note').fill('The header was rebuilt three times');
  check('the chosen mode\'s definition is shown with the note field', /Unnecessary reiteration/.test(await dlg.innerText()));
  await settled();
  if (DOC_SHOT) await p.screenshot({ path: DOC_SHOT });
  await p.screenshot({ path: `${SHOTS}/improve-c33-dialog-dark.png` });
  await dlg.locator('[data-tag-submit]').click();
  const row = dlg.locator(`[data-tag][data-mode-id="FM-1.3"]`);
  check('the tag appears as Proposed, with the note and who tagged it', await until(async () => (await row.count()) === 1 && (await row.getAttribute('data-status')) === 'proposed' && /Luca/.test(await row.innerText()) && /rebuilt three times/.test(await row.innerText()), 8000));
  const t1 = (await apiA('GET', `/failure-tags?subjectKind=task&subjectId=${first.id}`)).body;
  check('the server stored one proposed tag of the current taxonomy version on that task', t1.tags?.length === 1 && t1.tags[0].status === 'proposed' && t1.tags[0].modeId === 'FM-1.3' && t1.tags[0].taxonomyVersion === 'mast-arxiv-2503.13657v3' && t1.subject.failed === true);
  check('a proposed tag is not counted: n stays 0 and "1 proposed, not counted" is shown', await until(async () => (await dlg.locator('[data-failure-n]').getAttribute('data-failure-n')) === '0' && /1 proposed, not counted/.test(await dlg.locator('[data-failure-counts]').innerText()), 8000));

  // ------------------------------------------------------------ confirm it: the count goes to 1 with n shown
  await row.locator('[data-decide="confirm"]').click();
  check('after Confirm the tag is Confirmed (no buttons left) and decided by Luca', await until(async () => (await row.getAttribute('data-status')) === 'confirmed' && (await row.locator('[data-decide]').count()) === 0 && /Luca/.test(await row.innerText()), 8000));
  check('the count goes to 1 with n shown: n=1 and FC1 = 1', await until(async () => (await dlg.locator('[data-failure-n]').getAttribute('data-failure-n')) === '1' && /n=1/.test(await dlg.locator('[data-failure-counts]').innerText()) && /FC1 1/.test(await dlg.locator('[data-failure-counts]').innerText()), 8000));
  await dlg.locator('[data-mode="FM-1.3"]').click();
  check('choosing FM-1.3 shows its own count: 1', await until(async () => (await dlg.locator('[data-mode-total]').count()) === 1 && (await dlg.locator('[data-mode-total]').innerText()) === '1', 6000));
  check('the counts row is tagged DEMO (the seeded mission is a DEMO sample)', (await dlg.locator('[data-failure-counts] .demo-tag').count()) >= 1);
  const c1 = await counts();
  check('the server agrees: n=1, FM-1.3 = 1, FC1 = 1, FC2 = 0, FC3 = 0, window 30d', c1.n === 1 && c1.window === '30d' && c1.categories.find((c) => c.id === 'FC1').count === 1 && c1.categories.find((c) => c.id === 'FC2').count === 0 && c1.categories.find((c) => c.id === 'FC3').count === 0
    && c1.categories[0].modes.find((m) => m.id === 'FM-1.3').count === 1);
  const c1nodemo = await counts('window=30d&includeDemo=0');
  check('without DEMO the same count is null (DEMO tags never leak into real numbers)', c1nodemo.n === 0 && c1nodemo.categories.every((c) => c.count === null));
  await settled();
  if (DOC_SHOT2) await p.screenshot({ path: DOC_SHOT2 });
  await p.screenshot({ path: `${SHOTS}/improve-c33-counts-dark.png` });
  const dupe = await apiA('POST', '/failure-tags', { subjectKind: 'task', subjectId: first.id, modeId: 'FM-1.3' }, key());
  check('the same mode on the same task again is 409', dupe.status === 409 && dupe.body.code === 'FAILURE_TAG_DUPLICATE');
  const twice = await apiA('POST', `/failure-tags/${t1.tags[0].id}/decision`, { decision: 'reject' });
  check('a second decision is 409 and the tag stays confirmed', twice.status === 409 && twice.body.code === 'FAILURE_TAG_DECIDED' && (await apiA('GET', `/failure-tags?subjectKind=task&subjectId=${first.id}`)).body.tags[0].status === 'confirmed');

  // ------------------------------------------------------------ dialog exits: Close button, then Escape
  await dlg.getByRole('button', { name: 'Close', exact: true }).click();
  check('exit 1: the Close button closes the dialog (the task dialog stays)', await until(async () => (await dlg.count()) === 0 && (await p.locator('[data-dialog="DL-13"]').count()) === 1, 5000));
  await p.locator('[data-dialog="DL-13"] [data-tag-failure]').click();
  await dlg.waitFor({ timeout: 8000 });
  check('reopened: the confirmed tag is listed (read from the server)', await until(async () => (await dlg.locator('[data-tag][data-status="confirmed"]').count()) === 1, 8000));
  await p.keyboard.press('Escape');
  check('exit 2: Escape closes the dialog', await until(async () => (await dlg.count()) === 0, 5000));
  await p.keyboard.press('Escape');

  // ------------------------------------------------------------ the same task, once retried, still offers Tag failure
  const rr = await apiA('POST', `/tasks/${first.id}/retry`, undefined, key());
  check('the failed task is retried through the API (it is queued for retry and no longer "failed")', rr.status === 200 || rr.status === 201, `status ${rr.status}`);
  const retriedT = first;
  check('the server reports it as retried, not failed', await until(async () => { const s = (await apiA('GET', `/failure-tags?subjectKind=task&subjectId=${first.id}`)).body.subject; return s?.retried === true && s?.failed === false; }, 6000));
  await openTask(retriedT);
  check('the retried task (queued for retry, no longer "failed") offers "Tag failure" too', await until(async () => (await p.locator('[data-dialog="DL-13"] [data-tag-failure]').count()) === 1, 8000));
  await p.locator('[data-dialog="DL-13"] [data-tag-failure]').click();
  await dlg.waitFor({ timeout: 8000 });
  await dlg.getByRole('radio', { name: /^FC3 / }).click();
  await dlg.locator('[data-mode="FM-3.2"]').click();
  await dlg.locator('[data-tag-submit]').click();
  check('tagging the retried task works (Proposed)', await until(async () => (await dlg.locator('[data-tag][data-mode-id="FM-3.2"][data-status="proposed"]').count()) === 1, 8000));
  await dlg.locator('[data-tag][data-mode-id="FM-3.2"] [data-decide="reject"]').click();
  check('Reject: the tag is Rejected and the count stays n=1', await until(async () => (await dlg.locator('[data-tag][data-mode-id="FM-3.2"]').getAttribute('data-status')) === 'rejected' && (await dlg.locator('[data-failure-n]').getAttribute('data-failure-n')) === '1', 8000));
  await p.keyboard.press('Escape'); await p.keyboard.press('Escape');

  // ------------------------------------------------------------ every other failed or retried task of the seed can carry a tag
  const rest = [];
  for (const mid of missions) for (const t of ((await apiA('GET', `/missions/${mid}/tasks`)).body ?? [])) { const s = (await apiA('GET', `/failure-tags?subjectKind=task&subjectId=${t.id}`)).body.subject; if (s?.failed || s?.retried) rest.push({ mid, id: t.id }); }
  let tagged = 0; const bad = [];
  for (const t of rest) {
    const r = await apiA('POST', '/failure-tags', { subjectKind: 'task', subjectId: t.id, modeId: 'FM-2.3', note: 'e2e sweep' }, key());
    if (r.status === 201 && r.body.tag.status === 'proposed') tagged++; else bad.push(`${t.id}:${r.status}`);
  }
  check(`every failed or retried task in the seed (${rest.length}) takes one more tag, each proposed (${tagged} of ${rest.length})`, rest.length >= 1 && tagged === rest.length, bad.join(' '));
  const c2 = await counts();
  check('proposed tags are not counted: n is still 1', c2.n === 1 && c2.proposed >= tagged, `n=${c2.n} proposed=${c2.proposed}`);
  const bogus = await apiA('POST', '/failure-tags', { subjectKind: 'task', subjectId: first.id, modeId: 'FM-9.9' }, key());
  check('an unknown mode is 400 over HTTP', bogus.status === 400);
  const ghost = await apiA('POST', '/failure-tags', { subjectKind: 'task', subjectId: 'T-NOPE', modeId: 'FM-1.1' }, key());
  check('an unknown subject is 404 over HTTP', ghost.status === 404);
} catch (e) { check('script ran to the end', false, String(e).split('\n')[0]); }
await p.screenshot({ path: `${SHOTS}/improve-c33-end.png` }).catch(() => {});
console.log(errors.length ? 'PAGE ERRORS:\n' + errors.join('\n') : 'no page errors');
console.log(`${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
writeFileSync(`${SHOTS}/api-c33.txt`, results.join('\n') + '\n');
await b.close();
process.exit(results.some((r) => r.startsWith('FAIL')) || errors.length ? 1 : 0);
