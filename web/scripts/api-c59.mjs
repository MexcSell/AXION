// Improvement cycle 59 (R2-5), api mode: origin-bound memory and skill records, the contribution log, the active cap and fixture-only
// retirement proposals, in three browsers (A administrator, B second administrator, C member). Run with PLAYBOOK_ACTIVE_CAP=3 (the e2e
// server reads it), through scripts/api-e2e.sh. Fixtures (an agent-written lesson, skill outcome scores) are inserted with psql into the
// lane's e2e database, because no route writes them. Condition waits only (no networkidle).
import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const base = process.env.BASE || 'http://127.0.0.1:5193';
const SHOTS = process.env.SHOTS || `/tmp/axion-api-c59-${new URL(base).port}`;
const DOC_SHOT = process.env.DOC_SHOT_C41;
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
let k = 0;
const key = () => ({ 'idempotency-key': `c59-${Date.now()}-${k++}` });
const X = 'coder-01';
const CAP = 3;
let A, B, C;
const view = async (p, name) => { await p.getByRole('radio', { name }).click(); };
const panel = (p) => p.locator('[data-dev-playbooks]');
const e2eUrl = () => { try { return /^E2E_DATABASE_URL=(.*)$/m.exec(readFileSync('../server/.env', 'utf8'))?.[1].trim(); } catch { return null; } };
const sql = (q) => { const r = spawnSync('psql', [e2eUrl(), '-v', 'ON_ERROR_STOP=1', '-q', '-t', '-A', '-c', q], { encoding: 'utf8' }); if (r.status !== 0) throw new Error('psql: ' + (r.stderr || '').slice(0, 200)); return r.stdout.trim(); };
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
    return { ...Y, id: u.id };
  };
  B = await join('B', 'Bea', 'bea-pass', true);
  C = await join('C', 'Mina', 'mina-pass', false);
  check('B (second administrator) and C (member) are connected and live', (await live(B.p)) && (await live(C.p)));
  const apiB = apiOf(B.p), apiC = apiOf(C.p);
  const me = (await apiA('GET', '/me')).body.me;

  // ------------------------------------------------------------ origin chips: human entry, derived, agent-written
  const propose = async (api, text, sources = [{ kind: 'review', id: 'REV-59' }]) => (await api('POST', `/agents/${X}/lessons`, { text, sources }, key()));
  const accept = async (api, id) => api('POST', `/lessons/${id}/decision`, { decision: 'accept', baseVersion: ((await apiA('GET', `/agents/${X}/playbook`)).body.playbook.version) });
  const h1 = (await propose(apiC, 'Prefer role locators over css selectors.')).body.lesson;
  check('a lesson a member enters through the app is human_entry / human (server-set)', h1.originChannel === 'human_entry' && h1.originClass === 'human');
  const smuggle = await apiC('POST', `/agents/${X}/lessons`, { text: 'Smuggled origin', sources: [{ kind: 'review', id: 'R' }], originClass: 'human' }, key());
  check('a request body that names an origin is refused: 400', smuggle.status === 400);
  check('B accepts it (v1)', (await accept(apiB, h1.id)).status === 200);
  sql(`insert into lesson_candidates(id,tenant_id,agent_id,role,text,sources,proposed_by,proposed_by_kind,submitted_by,sha256) values ('LC-AGENT-59','t-1','${X}','dev','Pin the browser version in checks.','[{"kind":"note","id":"tester-01"}]','tester-01','agent','${me.id}','${'a'.repeat(64)}')`);
  const d1 = (await propose(apiA, 'A person summarises the agent lesson: pin browser versions.', [{ kind: 'lesson', id: 'LC-AGENT-59' }])).body.lesson;
  check('a person summarising an agent-written lesson gets a derived record at class agent', d1.originChannel === 'derived' && d1.originClass === 'agent');
  const cLearn = (await propose(apiC, 'Citing a lesson she cannot see', [{ kind: 'lesson', id: 'LC-AGENT-59' }]));
  check('a member cannot cite a lesson she cannot open: 404', cLearn.status === 404);
  for (const Y of [A, B, C]) await Y.p.goto(base + DEV, { waitUntil: 'domcontentloaded' });
  check('the playbook lists the accepted item with an origin chip "human" and the cap chip "active 1 of 3" with a ?',
    await until(async () => (await A.p.locator('[data-playbook-item] [data-origin="human"]').count()) === 1 && (await A.p.locator('[data-cap="3"]').getAttribute('data-active-count')) === '1', 12000)
      && (await A.p.locator('[data-cap="3"] [data-help-key="playbook.cap"]').count()) === 1);
  await view(A.p, /Candidates/);
  check('Candidates shows the agent-written lesson as "agent" and the summary as "agent · derived", each with a Log button',
    await until(async () => (await A.p.locator('[data-lesson="LC-AGENT-59"] [data-origin="agent"]').count()) === 1 && (await A.p.locator(`[data-lesson="${d1.id}"] [data-origin="agent"][data-origin-channel="derived"]`).count()) === 1, 10000)
      && (await A.p.locator(`[data-lesson="${d1.id}"]`).getByRole('button', { name: /contribution log/ }).count()) === 1);
  await A.p.locator(`[data-lesson="${d1.id}"]`).getByRole('button', { name: /Show the contribution log/ }).click();
  check('opening the Log lists who proposed it (the append-only contribution log), with a ?', await until(async () => (await A.p.locator(`[data-contrib-log="${d1.id}"] [data-contrib="proposed"]`).count()) === 1, 8000) && (await A.p.locator('[data-help-key="playbook.log"]').count()) >= 1);
  await A.p.screenshot({ path: `${SHOTS}/c59-candidates.png` });

  // ------------------------------------------------------------ the dialog says a cited record makes a derived record
  await A.p.getByRole('button', { name: 'Propose a lesson', exact: true }).click();
  const dlg = A.p.locator('[role="dialog"]').first();
  await dlg.locator('#lc-text').waitFor({ timeout: 8000 });
  await dlg.getByLabel('Source 1 kind', { exact: true }).selectOption('lesson');
  check('choosing a lesson as the source explains that the record is derived, with a ?', await until(async () => (await dlg.locator('[data-derived-note] [data-help-key="playbook.origin"]').count()) === 1, 6000));
  await A.p.keyboard.press('Escape');
  check('the dialog closes', await until(async () => (await dlg.count()) === 0, 6000));

  // ------------------------------------------------------------ the cap
  const h2 = (await propose(apiC, 'Retry flaky uploads once before failing.')).body.lesson;
  const h3 = (await propose(apiC, 'Keep screenshots under two megabytes.')).body.lesson;
  const h4 = (await propose(apiC, 'Name test files after the feature they cover.')).body.lesson;
  check('B accepts two more: the playbook holds 3 of 3', (await accept(apiB, h2.id)).status === 200 && (await accept(apiB, h3.id)).status === 200);
  const over = await accept(apiB, h4.id);
  check('the fourth accept is refused: 409 ACTIVE_CAP_REACHED, the lesson stays proposed', over.status === 409 && over.body.code === 'ACTIVE_CAP_REACHED' && (await apiA('GET', `/lessons/${h4.id}`)).body.lesson.status === 'proposed');
  await view(A.p, /Candidates/);
  check('A (no reload): the cap chip reads "active 3 of 3" and Accept is disabled with the reason and a ? (Reject still works)',
    await until(async () => (await A.p.locator('[data-cap="3"]').getAttribute('data-at-cap')) === '1', 10000)
      && await until(async () => { const c = A.p.locator(`[data-lesson="${h4.id}"]`); return (await c.count()) === 1 && (await c.getByRole('button', { name: /^Accept lesson/ }).isDisabled()) && !(await c.getByRole('button', { name: /^Reject lesson/ }).isDisabled()) && (await c.locator('[data-help-key="playbook.cap"]').count()) === 1; }, 8000));
  await A.p.screenshot({ path: `${SHOTS}/c59-cap.png` });
  check('C (member) sees the cap chip too', (await (async () => { await view(C.p, /^Playbook/); return until(async () => (await C.p.locator('[data-cap="3"]').count()) === 1, 8000); })()));
  await view(A.p, /^Playbook/);
  check('the playbook items carry their origin chips and each has a Log', await until(async () => (await A.p.locator('[data-playbook-item] [data-origin]').count()) === 3 && (await A.p.locator('[data-playbook-item]').first().getByRole('button', { name: /contribution log/ }).count()) === 1, 8000));
  await A.p.locator('[data-playbook-item]').first().getByRole('button', { name: /Show the contribution log/ }).click();
  check('a playbook item\'s Log shows proposed then accepted (Bea, v1)', await until(async () => (await A.p.locator(`[data-contrib-log="${h1.id}"] li`).count()) === 2 && (await A.p.locator(`[data-contrib-log="${h1.id}"]`).innerText()).includes('accepted'), 8000));
  await A.p.screenshot({ path: `${SHOTS}/c59-playbook.png` });

  // ------------------------------------------------------------ retirement proposals (fixture-only)
  const skill = (await apiB('POST', '/skills', { name: 'Triage a failing check', description: 'Find the cause of a red check.', steps: [{ kind: 'observe', detail: 'Name the failing selector' }], preconditions: [], sources: [{ kind: 'review', id: 'REV-59' }] }, key())).body.skill;
  check('a skill entered by a person is human_entry / human', skill.originChannel === 'human_entry' && skill.originClass === 'human');
  await apiA('POST', `/skills/${skill.id}/approve`, {});
  await view(A.p, /Skills/);
  check('Skills (administrator): the retirement strip says "fixture only" and "no outcome data yet", with a ?, and the skill shows its origin chip',
    await until(async () => (await A.p.locator('[data-retirement="none"]').count()) === 1 && (await A.p.locator('[data-retirement="none"]').innerText()).includes('no outcome data yet')
      && (await A.p.locator('[data-retirement="none"] [data-help-key="skills.retirement"]').count()) === 1 && (await A.p.locator(`[data-skill="${skill.id}"] [data-origin="human"]`).count()) === 1, 12000));
  await view(C.p, /Skills/);
  check('C (member) sees no retirement strip', await until(async () => (await C.p.locator(`[data-skill="${skill.id}"]`).count()) === 1, 8000) && (await C.p.locator('[data-retirement]').count()) === 0);
  sql(`insert into skill_outcomes(tenant_id, skill_id, score, n) values ('t-1','${skill.id}',0.10,8)`);
  await A.p.goto(base + DEV, { waitUntil: 'domcontentloaded' });
  await view(A.p, /Skills/);
  const prop = A.p.locator(`[data-retirement-proposal="${skill.id}"]`);
  check('with a fixture score below the floor a proposal appears (score and n labelled fixture), the strip still says "no outcome data yet" and the skill is still approved',
    await until(async () => (await prop.count()) === 1 && (await prop.innerText()).includes('fixture') && (await A.p.locator('[data-retirement]').innerText()).includes('no outcome data yet'), 12000) && (await A.p.locator(`[data-skill="${skill.id}"]`).getAttribute('data-status')) === 'approved');
  await A.p.screenshot({ path: `${SHOTS}/c59-retirement.png` });
  await prop.getByRole('button', { name: /^Keep skill/ }).click();
  check('Keep: the proposal goes away, the skill stays approved, and its log says kept', await until(async () => (await prop.count()) === 0, 10000)
    && ((await apiA('GET', `/skills/${skill.id}`)).body.skill.status === 'approved')
    && (await apiA('GET', `/skills/${skill.id}/contributions`)).body.contributions.some((c) => c.action === 'retirement_kept'));
  sql(`insert into skill_outcomes(tenant_id, skill_id, score, n) values ('t-1','${skill.id}',0.05,9)`);
  await A.p.goto(base + DEV, { waitUntil: 'domcontentloaded' });
  await view(A.p, /Skills/);
  check('a new, lower score proposes it again', await until(async () => (await prop.count()) === 1, 12000));
  await prop.getByRole('button', { name: /^Retire skill/ }).click();
  check('Retire (a person\'s click): the skill is retired and the proposal is gone', await until(async () => (await prop.count()) === 0, 10000) && (await apiA('GET', `/skills/${skill.id}`)).body.skill.status === 'retired');
  check('no page errors or console errors in any browser', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) {
  check('the run did not throw', false, String(e).slice(0, 400));
  for (const [n, Y] of [['A', A], ['B', B], ['C', C]]) if (Y) await Y.p.screenshot({ path: `${SHOTS}/c59-fail-${n}.png` }).catch(() => {});
}
await b.close();
const failed = results.filter((r) => r.startsWith('FAIL')).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
