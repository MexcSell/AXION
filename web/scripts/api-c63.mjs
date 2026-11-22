// Improvement cycle 63 (Phase 2, R3-8), api mode: detection fields on failure tags, the missing share and the "found only by a person" share, at 1366x768.
// Run through scripts/api-e2e.sh (lane ports). Condition waits only (no networkidle).
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
const base = process.env.BASE || 'http://127.0.0.1:5193';
const SHOTS = process.env.SHOTS || `/tmp/axion-api-c63-${new URL(base).port}`;
const DOC_SHOT = process.env.DOC_SHOT_C63;
const DOC_SHOT2 = process.env.DOC_SHOT_C63_UNUSED;
mkdirSync(SHOTS, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.PW_CHROME || '/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome' });
const results = [];
const errors = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); console.log(results[results.length - 1]); };
const until = async (f, ms = 10000, step = 150) => { const t0 = Date.now(); for (;;) { try { if (await f()) return true; } catch { /* retry */ } if (Date.now() - t0 > ms) return false; await new Promise((r) => setTimeout(r, step)); } };
const ctx = await b.newContext({ viewport: { width: Number(process.env.VW || 1366), height: Number(process.env.VH || 768) } });
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
const key = () => ({ 'idempotency-key': `c63-${Date.now()}-${k++}` });
const dlg = () => p.locator('[data-dialog="DL-78"]');
/** the dialog must fit the screen: inside the viewport, and no scrollable region of its own that hides content */
const fit = async () => p.evaluate(() => {
  const d = document.querySelector('[data-dialog="DL-78"]'); const r = d.getBoundingClientRect();
  const scrolls = [d, ...d.querySelectorAll('*')].filter((e) => { const o = getComputedStyle(e).overflowY; return (o === 'auto' || o === 'scroll') && e.scrollHeight > e.clientHeight + 1; }).map((e) => `${e.className || e.tagName}:${e.scrollHeight}>${e.clientHeight}`);
  return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), vw: innerWidth, vh: innerHeight, scrolls };
});
try {
  await p.goto(base + '/missions', { waitUntil: 'domcontentloaded' });
  await p.getByRole('heading', { name: 'Connect' }).waitFor({ timeout: 15000 });
  await p.getByLabel('Name').fill('Luca');
  await p.getByLabel('Password', { exact: true }).fill('secret-1');
  await p.getByRole('button', { name: /Connect/ }).click();
  await p.locator('.rail-nav').first().waitFor({ timeout: 15000 });
  check('connected and live', await until(async () => (await p.locator('.conn-badge').getAttribute('data-conn')) === 'live', 15000));
  const missions = ((await apiA('GET', '/missions')).body.missions ?? []).map((m) => m.id);
  const failed = [];
  for (const mid of missions) for (const t of ((await apiA('GET', `/missions/${mid}/tasks`)).body ?? [])) if (t.state === 'failed') failed.push({ mid, id: t.id });
  check('the e2e seed has a failed task', failed.length >= 1, failed.map((f) => f.id).join(', '));
  const first = failed[0];

  // API rules of the new fields
  const bad = await apiA('POST', '/failure-tags', { subjectKind: 'mission', subjectId: first.mid, modeId: 'FM-1.5', detectionChannel: 'psychic' }, key());
  check('an unknown detection channel is 400', bad.status === 400);
  const noNote = await apiA('POST', '/failure-tags', { subjectKind: 'mission', subjectId: first.mid, modeId: 'FM-1.5', mechanism: 'other' }, key());
  check('"something else" without a note is 400', noNote.status === 400);
  const forged = await apiA('POST', '/failure-tags', { subjectKind: 'mission', subjectId: first.mid, modeId: 'FM-1.5', detectionChannel: 'test', detectedAfterSeconds: 3 }, key());
  check('detected-after cannot be sent by the caller (400)', forged.status === 400);

  await p.goto(`${base}/missions/${first.mid}?tab=task-flow`, { waitUntil: 'domcontentloaded' });
  const el = p.locator(`[aria-label^="${first.id} "]`).first();
  await el.waitFor({ timeout: 15000 });
  await el.click();
  await p.locator('[data-dialog="DL-13"]').waitFor({ timeout: 8000 });
  await p.locator('[data-dialog="DL-13"] [data-tag-failure]').click();
  await dlg().waitFor({ timeout: 8000 });
  const form = dlg().locator('[data-detection-form]');
  check('the dialog shows four optional questions, each with a ? and a "Not recorded" default', await form.locator('select').count() === 4 && await form.locator('.help-btn').count() === 5
    && (await form.locator('select').evaluateAll((s) => s.every((x) => x.value === ''))));
  check('every select lists its plain-words values', await form.locator('#ft-channel option').count() === 6 && await form.locator('#ft-mech option').count() === 8 && await form.locator('#ft-ce option').count() === 8);
  await dlg().locator('[data-mode="FM-1.1"]').click();
  await form.locator('#ft-mech').selectOption('other');
  check('"something else" asks for a note and the Tag button waits for it', await until(async () => (await form.locator('[data-detect-note]').count()) === 1 && await dlg().locator('[data-tag-submit]').isDisabled()));
  await form.locator('[data-detect-note]').fill('A vendor changed a field');
  check('with the note the Tag button is enabled', await until(async () => !(await dlg().locator('[data-tag-submit]').isDisabled())));
  await form.locator('#ft-mech').selectOption('instructions');
  await form.locator('#ft-channel').selectOption('human_review');
  await form.locator('#ft-ce').selectOption('test');
  await form.locator('#ft-cc').selectOption('none');
  check('choosing a value adds a ? for that value (4 values chosen: 9 help buttons)', await until(async () => (await form.locator('.help-btn').count()) === 9));
  await form.locator('[data-help-key="failure.detect.channel.human_review"]').click();
  check('the ? beside a value explains it in plain words', await until(async () => /opened the result, read it and saw that it was wrong/.test(await p.locator('.help-pop').innerText())));
  await p.keyboard.press('Escape');
  const f1 = await fit();
  check('the dialog with the form fits 1366x768 (inside the viewport, no hidden scrolling)', f1.top >= 0 && f1.bottom <= f1.vh && f1.left >= 0 && f1.right <= f1.vw && f1.scrolls.length === 0, JSON.stringify(f1));
  await settled();
  await p.screenshot({ path: `${SHOTS}/improve-c63-form-dark.png` });
  await dlg().locator('[data-tag-submit]').click();
  const row = dlg().locator('[data-tag][data-mode-id="FM-1.1"]');
  check('the tag is stored and shows how it was found, what failed and the two checks', await until(async () => {
    if ((await row.count()) !== 1) return false; const t = await row.innerText();
    return (await row.locator('[data-detection]').getAttribute('data-detection')) === 'human_review' && /Found by\s+A person looking at the result/.test(t) && /The instructions/.test(t) && /Should have caught it:\s+An automated test/.test(t) && /Did:\s+None/.test(t);
  }));
  const tagId = await row.getAttribute('data-tag');
  check('the form is cleared after tagging', await form.locator('select').evaluateAll((s) => s.every((x) => x.value === '')));
  await row.locator('[data-decide="confirm"]').click();
  const hs = dlg().locator('[data-human-only]');
  check('below 5 failures with a channel the share is "—", with n and the window', await until(async () => (await hs.count()) === 1 && (await hs.getAttribute('data-human-only')) === 'null' && (await hs.getAttribute('data-human-only-n')) === '1'
    && /—/.test(await hs.locator('[data-human-share]').innerText()) && /n=1, last 30 days, needs 5/.test(await hs.innerText())), (await hs.innerText().catch(() => '')).replace(/\n/g, ' | '));
  check('the missing count is shown, not hidden (0 of 1 lack a "found by")', /not recorded: 0 of 1 \(0%\)/.test(await hs.innerText()));

  // four more confirmed tags with a channel (mission subjects take no failure time): 3 of 5 were found by a person
  const more = [['FM-2.1', 'human_review'], ['FM-2.2', 'test'], ['FM-2.3', 'human_review'], ['FM-3.1', 'audit']];
  for (const [mode, ch] of more) {
    const r = await apiA('POST', '/failure-tags', { subjectKind: 'mission', subjectId: first.mid, modeId: mode, detectionChannel: ch }, key());
    await apiA('POST', `/failure-tags/${r.body.tag.id}/decision`, { decision: 'confirm' });
  }
  check('at 5 failures with a channel the share is a number: 3 of 5 = 60%', await until(async () => (await hs.getAttribute('data-human-only-n')) === '5' && (await hs.locator('[data-human-share]').innerText()).trim() === '60%' && /n=5, last 30 days/.test(await hs.innerText()), 12000), (await hs.innerText().catch(() => '')).replace(/\n/g, ' | '));
  const m = (await apiA('GET', '/company/failure-modes?window=30d&includeDemo=1')).body;
  check('the server agrees: humanOnly 3/5, missing 0, minN 5', m.detection.humanOnly.humanReview === 3 && m.detection.humanOnly.withChannel === 5 && m.detection.humanOnly.share === 0.6 && m.detection.humanOnly.minN === 5, JSON.stringify(m.detection.humanOnly));
  await apiA('POST', '/failure-tags', { subjectKind: 'mission', subjectId: first.mid, modeId: 'FM-3.3' }, key()).then((r) => apiA('POST', `/failure-tags/${r.body.tag.id}/decision`, { decision: 'confirm' }));
  check('a confirmed tag with no channel raises the missing count (1 of 6, 17%) and leaves the share alone', await until(async () => /not recorded: 1 of 6 \(17%\)/.test(await hs.innerText()) && (await hs.locator('[data-human-share]').innerText()).trim() === '60%', 12000), (await hs.innerText().catch(() => '')).replace(/\n/g, ' | '));
  await hs.locator('[data-help-key="failure.humanOnly"]').click();
  check('the ? on the share says what it is, that n is shown and that it gives no rate', await until(async () => /Found only by a person/.test(await p.locator('.help-pop').innerText()) && /gives no expected rate/.test(await p.locator('.help-pop').innerText())));
  await p.keyboard.press('Escape');
  const f2 = await fit();
  check('the dialog with a tag, counts and the share still fits 1366x768', f2.top >= 0 && f2.bottom <= f2.vh && f2.scrolls.length === 0, JSON.stringify(f2));
  await settled();
  await p.screenshot({ path: `${SHOTS}/improve-c63-counts-dark.png` });
  // light mode
  await p.keyboard.press('Escape'); await p.keyboard.press('Escape');
  await p.evaluate(() => { try { const s = JSON.parse(localStorage.getItem('axion.settings.v1')); s.state.themeMode = 'light'; localStorage.setItem('axion.settings.v1', JSON.stringify(s)); } catch {} });
  await p.reload({ waitUntil: 'domcontentloaded' });
  const el2 = p.locator(`[aria-label^="${first.id} "]`).first();
  await el2.waitFor({ timeout: 15000 }); await el2.click();
  await p.locator('[data-dialog="DL-13"]').waitFor({ timeout: 8000 });
  await p.locator('[data-dialog="DL-13"] [data-tag-failure]').click();
  await dlg().waitFor({ timeout: 8000 });
  await dlg().locator('[data-human-only]').waitFor({ timeout: 10000 });
  const f3 = await fit();
  check('light mode: the dialog fits 1366x768 too', f3.top >= 0 && f3.bottom <= f3.vh && f3.scrolls.length === 0, JSON.stringify(f3));
  await settled();
  await p.screenshot({ path: `${SHOTS}/improve-c63-counts-light.png` });
  if (DOC_SHOT) await p.screenshot({ path: DOC_SHOT });
  check('the tag is reachable through the API with every field', (await apiA('GET', `/failure-tags?subjectKind=task&subjectId=${first.id}`)).body.tags.some((t) => t.id === tagId && t.detectionChannel === 'human_review' && t.mechanism === 'instructions' && t.controlExpected === 'test' && t.controlCaught === 'none'));
  await p.keyboard.press('Escape'); await p.keyboard.press('Escape');
} catch (e) { check('script ran to the end', false, String(e).split('\n')[0]); }
await p.screenshot({ path: `${SHOTS}/improve-c63-end.png` }).catch(() => {});
console.log(errors.length ? 'PAGE ERRORS:\n' + errors.join('\n') : 'no page errors');
console.log(`${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
writeFileSync(`${SHOTS}/api-c63.txt`, results.join('\n') + '\n');
await b.close();
process.exit(results.some((r) => r.startsWith('FAIL')) || errors.length ? 1 : 0);
