// Improvement cycle 60 (Phase 2, R2-10), api mode: failure attribution. A failed task of the seeded missions is tagged through the API with an
// attribution (agent, step, "full trace available"); a second, different attribution is added (both are kept); the Tag a failure dialog then shows
// both entries and the count of different views. An attribution on a mission subject is refused (409), a malformed one is 400. Run through
// scripts/api-e2e.sh (lane ports). Condition waits only (no networkidle).
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
const base = process.env.BASE || 'http://127.0.0.1:5193';
const SHOTS = process.env.SHOTS || `/tmp/axion-api-c60-${new URL(base).port}`;
const DOC_SHOT = process.env.DOC_SHOT_C60;
const DOC_SHOT2 = process.env.DOC_SHOT_C60_UNUSED;
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

const key = () => ({ 'idempotency-key': `c60-${Date.now()}-${k++}` });
try {
  await p.goto(base + '/missions', { waitUntil: 'domcontentloaded' });
  await p.getByRole('heading', { name: 'Connect' }).waitFor({ timeout: 15000 });
  await p.getByLabel('Name').fill('Luca');
  await p.getByLabel('Password', { exact: true }).fill('secret-1');
  await p.getByRole('button', { name: /Connect/ }).click();
  await p.locator('.rail-nav').first().waitFor({ timeout: 15000 });
  check('A (first user = administrator) is connected and live', await until(async () => (await p.locator('.conn-badge').getAttribute('data-conn')) === 'live', 15000));
  const missions = ((await apiA('GET', '/missions')).body.missions ?? []).map((m) => m.id);
  const failed = [];
  for (const mid of missions) for (const t of ((await apiA('GET', `/missions/${mid}/tasks`)).body ?? [])) if (t.state === 'failed') failed.push({ mid, id: t.id });
  check('the e2e seed has a failed task', failed.length >= 1, failed.map((f) => f.id).join(', '));
  const first = failed[0];
  const made = await apiA('POST', '/failure-tags', { subjectKind: 'task', subjectId: first.id, modeId: 'FM-2.6', attribution: { agentId: 'writer-agent', stepRef: 'step-3', fullTraceAvailable: true } }, key());
  check('a tag with an attribution is stored (201), one entry, no disagreement', made.status === 201 && made.body.tag.attributions.length === 1 && made.body.tag.attributionDisagreements === 0 && made.body.tag.attributions[0].fullTraceAvailable === true, JSON.stringify(made.body.tag?.attributions?.[0] ?? made.body));
  const second = await apiA('POST', `/failure-tags/${made.body.tag.id}/attributions`, { agentId: 'reviewer-agent', stepRef: 'step-7' }, key());
  check('a second, different attribution is added: both are kept and one disagreement is counted', second.status === 201 && second.body.tag.attributions.length === 2 && second.body.tag.attributionDisagreements === 1, `status ${second.status}`);
  const same = await apiA('POST', `/failure-tags/${made.body.tag.id}/attributions`, { agentId: 'writer-agent', stepRef: 'step-3' }, key());
  check('the same entry by the same person again is 409', same.status === 409 && same.body.code === 'FAILURE_ATTRIBUTION_DUPLICATE');
  const bad = await apiA('POST', `/failure-tags/${made.body.tag.id}/attributions`, { fullTraceAvailable: true }, key());
  check('an attribution that names neither agent nor step is 400', bad.status === 400);
  const mtag = await apiA('POST', '/failure-tags', { subjectKind: 'mission', subjectId: first.mid, modeId: 'FM-1.5' }, key());
  const mattr = await apiA('POST', `/failure-tags/${mtag.body.tag.id}/attributions`, { agentId: 'x' }, key());
  check('attribution on a mission subject is refused (409 ATTRIBUTION_NEEDS_FAILURE)', mtag.status === 201 && mattr.status === 409 && mattr.body.code === 'ATTRIBUTION_NEEDS_FAILURE', `${mtag.status}/${mattr.status}`);
  const got = (await apiA('GET', `/failure-tags?subjectKind=task&subjectId=${first.id}`)).body.tags.find((t) => t.id === made.body.tag.id);
  check('reading the tag again returns both entries, oldest first', got && got.attributions.map((a) => a.agentId).join() === 'writer-agent,reviewer-agent' && got.attributionDisagreements === 1);

  await p.goto(`${base}/missions/${first.mid}?tab=task-flow`, { waitUntil: 'domcontentloaded' });
  const el = p.locator(`[aria-label^="${first.id} "]`).first();
  await el.waitFor({ timeout: 15000 });
  await el.click();
  await p.locator('[data-dialog="DL-13"]').waitFor({ timeout: 8000 });
  await p.locator('[data-dialog="DL-13"] [data-tag-failure]').click();
  const dlg = p.locator('[data-dialog="DL-78"]');
  await dlg.waitFor({ timeout: 8000 });
  const box = dlg.locator(`[data-tag="${made.body.tag.id}"] [data-attributions]`);
  check('the dialog shows both attribution entries and the count of different views', await until(async () => (await box.count()) === 1 && (await box.getAttribute('data-attributions')) === '2' && (await box.getAttribute('data-disagreements')) === '1' && (await box.locator('[data-attribution]').count()) === 2, 10000));
  const txt = await box.innerText();
  check('each entry names the agent, the step, who said it and whether the full trace is claimed', /writer-agent/.test(txt) && /step-3/.test(txt) && /reviewer-agent/.test(txt) && /step-7/.test(txt) && /Luca/.test(txt) && /full trace is available/.test(txt) && /2 different views/.test(txt), txt.replace(/\s+/g, ' ').slice(0, 200));
  await settled();
  if (DOC_SHOT) await p.screenshot({ path: DOC_SHOT });
  await p.screenshot({ path: `${SHOTS}/improve-c60-attribution-dark.png` });
  await p.keyboard.press('Escape'); await p.keyboard.press('Escape');
} catch (e) { check('script ran to the end', false, String(e).split('\n')[0]); }
await p.screenshot({ path: `${SHOTS}/improve-c60-end.png` }).catch(() => {});
console.log(errors.length ? 'PAGE ERRORS:\n' + errors.join('\n') : 'no page errors');
console.log(`${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
writeFileSync(`${SHOTS}/api-c60.txt`, results.join('\n') + '\n');
await b.close();
process.exit(results.some((r) => r.startsWith('FAIL')) || errors.length ? 1 : 0);
