// c46 (Phase 2, M1), api mode: the six-dimension panel (DL-98).
// Admin: opens it from the Overview scorecard and from Agents > Departments; six rows each with a ?; every cell is a value with
// n and window or "not enough evidence (n = k)"; the DOM agrees with GET /company/dimensions; the department selector and the
// window switch re-read; ? popovers; no total anywhere; fits one 1366x768 screen. Member: same panel, administrator-only cells
// say n = 0. Seeded rows (SQL, e2e database only) give the screenshots real values.
// Run through scripts/api-e2e.sh (lane ports via E2E_API_PORT/E2E_WEB_PORT). Condition waits only (no networkidle).
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
process.env.DATA_MODE = 'api'; // _session.mjs reads it at load time
const { signIn, settle, calm, requireE2eDatabase } = await import('./_session.mjs');
const base = process.env.BASE || 'http://127.0.0.1:5193';
const SHOTS = process.env.SHOTS || `/tmp/axion-api-c46-${new URL(base).port}`;
const DOC = process.env.DOC_SHOT_PREFIX; // e.g. docs/screenshots/improve-c46 -> -light.png / -dark.png
mkdirSync(SHOTS, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.PW_CHROME || '/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome' });
const results = [], errors = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); console.log(results[results.length - 1]); };
const until = async (f, ms = 10000, step = 150) => { const t0 = Date.now(); for (;;) { try { if (await f()) return true; } catch { /* retry */ } if (Date.now() - t0 > ms) return false; await new Promise((r) => setTimeout(r, step)); } };
const KEYS = ['cognitive', 'capability', 'environmental', 'collective', 'knowledge', 'evolutionary'];

let adminPage = null; // the signed-in administrator's page, used to approve a member (a fresh device would wait for device approval)
const device = { name: 'Chrome on Linux (script)', kind: 'desktop', browser: 'Chrome' };
async function open(name, theme = 'dark') {
  const ctx = await b.newContext({ viewport: { width: 1366, height: 768 } });
  if (name === 'Luca') await signIn(ctx, name);
  else {
    const w = await ctx.request.post(base + '/api/v1/auth/connect', { data: { name, password: 'script-pass-1', device } });
    if (w.status() === 202) {
      const csrf = (await (await adminPage.request.get(base + '/api/v1/me')).json()).me.csrf;
      const users = await (await adminPage.request.get(base + '/api/v1/users')).json();
      await adminPage.request.post(base + `/api/v1/users/${users.users.find((x) => x.name === name).id}/approve`, { headers: { 'x-csrf': csrf }, data: {} });
      if ((await ctx.request.get(base + '/api/v1/auth/wait')).status() !== 200) throw new Error('member approval failed');
    }
  }
  await ctx.addInitScript((t) => { try { localStorage.setItem('axion.data-mode', 'api'); localStorage.setItem('axion.testhook', '1'); localStorage.setItem('axion.settings.v1', JSON.stringify({ state: { themeMode: t, motion: 'reduced' }, version: 0 })); } catch { /* ignore */ } }, theme);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_CONNECTION|ERR_INTERNET_DISCONNECTED|502|503|504|EventSource/.test(m.text())) errors.push(`${name} console: ${m.text()}`); });
  return { ctx, p };
}
const dlg = (p) => p.locator('[data-dialog="DL-98"]');
const ready = (p) => p.locator('[data-dialog="DL-98"] [data-dimensions="ready"]');
const apiGet = async (p, path) => { const r = await p.request.get(base + '/api/v1' + path); return { status: r.status(), body: await r.json().catch(() => ({})) }; };

try {
  // ---- seed a few real rows into the e2e database so the panel has values (SELECT/INSERT on the throw-away database only)
  const pg = createRequire(new URL('../../server/package.json', import.meta.url))('pg');
  const db = new pg.Client({ connectionString: requireE2eDatabase() });
  await db.connect();
  const admin = await open('Luca');
  await admin.p.goto(base + '/overview', { waitUntil: 'domcontentloaded' });
  await settle(admin.p);
  const u = (await db.query(`select id, tenant_id from users where name='Luca' limit 1`)).rows[0];
  const T = u.tenant_id, A = u.id;
  await db.query(`insert into missions(id, tenant_id, owner_id, shared, status, demo) values ('C46', $1, $2, true, 'running', false)`, [T, A]);
  await db.query(`insert into mission_revisions(mission_id, revision, title, kind, priority, text, created_by) values ('C46',1,'c46','data','normal','x',$1)`, [A]);
  await db.query(`insert into agent_instances(id, tenant_id, mission_id, agent_id, agent_version_id) select 'C46:coder-01',$1,'C46',d.id,d.active_version_id from agent_definitions d where d.id='coder-01'`, [T]);
  for (let i = 0; i < 5; i++) {
    await db.query(`insert into tasks(id, tenant_id, mission_id, title, status, owner_agent, owner_instance_id, created_at) values ($1,$2,'C46','T','passed','coder-01','C46:coder-01', now() - interval '3 days')`, [`C46T${i}`, T]);
    await db.query(`insert into task_attempts(task_id, attempt_no, started_at, finished_at, result) values ($1,1, now() - interval '2 days', now() - interval '1 day','passed')`, [`C46T${i}`]);
    await db.query(`insert into events(tenant_id, type, mission_id, seq, subject_kind, subject_id, audience, payload, occurred_at) values ($1,'task.stateChanged','C46',$2,'task',$3,'mission',$4, now() - interval '1 day')`, [T, 770000 + i, `C46T${i}`, JSON.stringify({ taskId: `C46T${i}`, from: 'running', to: 'passed' })]);
    if (i < 4) await db.query(`insert into task_reviews(id, tenant_id, mission_id, task_id, reviewer_id, reviewer_kind, reviewer_model_family, producer_id, producer_kind, producer_model_family, principal_id, rubric, verdict, evidence) values ($1,$2,'C46',$3,'rev-x','agent','fam-b','C46:coder-01','agent','fam-a',$4,'[{"criterion":"c","result":"pass"}]','accepted','[{"kind":"note","id":"n"}]')`, [`TR-C46-${i}`, T, `C46T${i}`, A]);
  }
  await db.end();

  // ---- 1. admin opens it from the Overview scorecard
  const { p } = admin;
  adminPage = p;
  await p.goto(base + '/overview', { waitUntil: 'domcontentloaded' });
  await settle(p);
  await p.locator('[data-six-dimensions]').first().click();
  check('admin opens "Six dimensions" from the Overview scorecard', await until(async () => (await ready(p).count()) === 1, 15000));
  await calm(p);

  const rows = p.locator('[data-dimension]');
  check('six rows in the spec order', JSON.stringify(await rows.evaluateAll((els) => els.map((e) => e.getAttribute('data-dimension')))) === JSON.stringify(KEYS));
  check('every row has its own ? help button', (await Promise.all(KEYS.map((k) => p.locator(`[data-dimension="${k}"] [data-help-key="dimensions.${k}"]`).count()))).every((n) => n === 1));
  check('the department selector, the window switch and "reading a cell" each have a ?', (await Promise.all(['dimensions.department', 'dimensions.window', 'dimensions.cell', 'dimensions.panel'].map((k) => dlg(p).locator(`[data-help-key="${k}"]`).count()))).every((n) => n === 1));

  const cellsDom = () => p.locator('[data-cell]').evaluateAll((els) => els.map((e) => ({ key: e.getAttribute('data-cell'), state: e.getAttribute('data-state'), value: e.getAttribute('data-value'), n: e.getAttribute('data-n') === '' ? null : Number(e.getAttribute('data-n')), text: e.innerText, cls: e.className })));
  const dom = await cellsDom();
  check('the panel shows at least 15 cells', dom.length >= 15, `${dom.length}`);
  check('every cell is a value with n and window, "not enough evidence (n = k)", "hidden for your role" or "not measured until Stage 7"', dom.every((c) => (c.state === 'none' ? new RegExp(`not enough evidence \\(n = ${c.n}\\)`).test(c.text) : c.state === 'hidden' ? /hidden for your role/.test(c.text) && c.n === null : c.state === 'unmeasured' ? /not measured/.test(c.text) && c.n === null : c.value !== '' && new RegExp(`n = ${c.n}`).test(c.text) && /(7d|30d|90d|as of now)/.test(c.text))), JSON.stringify(dom.filter((c) => c.state === 'ok').map((c) => c.key)));
  check('no cell face says "n = 0" unless it was measured and empty (hidden and unmeasured show no n)', dom.every((c) => c.state === 'none' || c.state === 'ok' || !/n = /.test(c.text)));
  const seen = dom.find((c) => c.key === 'cognitive.first_attempt_verified');
  check('the seeded rows give a real value: 4 reviewed first-attempt tasks, all verified (100%, n = 4)', seen?.state === 'ok' && seen.value === '100' && seen.n === 4, JSON.stringify(seen));
  const rowsText = await p.locator('.dim-rows').innerText();
  check('no total, score or overall number anywhere in the rows', !/\b(score|overall|composite|total|average)\b/i.test(rowsText));
  check('Environmental holds exactly its two unmeasured cells, each saying "not measured until Stage 7 (browser execution)" on its face',
    JSON.stringify(dom.filter((c) => c.key.startsWith('environmental.')).map((c) => [c.key, c.state, c.n])) === JSON.stringify([['environmental.site_navigation', 'unmeasured', null], ['environmental.model_availability', 'unmeasured', null]])
    && (await p.locator('[data-cell="environmental.site_navigation"]').innerText()).includes('not measured until Stage 7 (browser execution)'));
  check('the context-loss cell is under Cognitive, honestly named', !!(await p.locator('[data-dimension="cognitive"] [data-cell="cognitive.context_loss"]').count()) && (await p.locator('[data-cell="cognitive.context_loss"]').innerText()).includes('Context-loss failures (FM-1.4, FM-2.1)'));
  const lay = await p.locator('[data-state="ok"] .dim-cv').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
  check('the value, n and trend arrow stay on one line in every cell', lay.length > 0 && lay.every((h) => h < 30), JSON.stringify(lay));
  const sizes = await p.evaluate(() => { const b = document.querySelector('[data-state="ok"].low .dim-cv b'); return b ? parseFloat(getComputedStyle(b).fontSize) : null; });
  check('a small-n value (n < 10) is drawn small (15px, not the 19px of a large sample)', sizes !== null && sizes <= 16, `${sizes}`);
  await p.locator('[data-cell="cognitive.first_attempt_verified"]').click();
  check('a click on a cell shows its evidence sentence and scope in the line under the rows (reachable without hover)', await until(async () => { const t = await p.locator('[data-evidence="cognitive.first_attempt_verified"]').innerText(); return /accepted review with evidence/.test(t) && /missions you can see/.test(t); }, 5000));
  await p.locator('[data-cell="evolutionary.promotions"]').click();
  check('a company-wide cell says so, not "missions you can see"', await until(async () => /recorded company-wide/.test(await p.locator('[data-evidence="evolutionary.promotions"]').innerText()), 5000));

  // server agrees with the DOM
  const srv = (await apiGet(p, '/company/dimensions?window=30d')).body;
  const srvCells = srv.dimensions.flatMap((d) => d.cells);
  check('every DOM cell equals the server cell (value, n, state)', srvCells.length === dom.length && srvCells.every((c) => { const d = dom.find((x) => x.key === c.key); return d && d.n === c.n && d.state === c.state && d.value === (c.value === null ? '' : String(c.value)); }));
  check('the response has no score, total or overall field at any level', !/"(score|total|overall|composite|rating)"/i.test(JSON.stringify(srv)));

  // fit one 1366x768 screen
  const fit = await p.evaluate(() => { const m = document.querySelector('[data-dialog="DL-98"]'); const r = m.getBoundingClientRect(); const body = m.querySelector('.modal-body') ?? m; return { top: r.top, bottom: r.bottom, w: r.width, scroll: body.scrollHeight - body.clientHeight, docScroll: document.documentElement.scrollHeight - innerHeight }; });
  check('the panel fits 1366x768 without scrolling', fit.top >= 0 && fit.bottom <= 768 && fit.scroll <= 2, JSON.stringify(fit));
  await p.screenshot({ path: `${SHOTS}/c46-dark.png` });
  if (DOC) await p.screenshot({ path: `${DOC}-dark.png` });

  // ---- 2. department switch and window switch
  const waitReq = (frag) => p.waitForRequest((r) => r.url().includes('/company/dimensions') && r.url().includes(frag), { timeout: 10000 }).catch(() => null);
  let req = waitReq('department=QA');
  await dlg(p).locator('select[aria-label="Department"]').selectOption('QA');
  check('choosing a department re-reads with department=QA', !!(await req));
  check('the panel switches to that department', await until(async () => (await p.locator('[data-dimensions="ready"][data-department="QA"]').count()) === 1, 8000));
  const qa = await cellsDom();
  check('QA has no first-attempt reviews: the cell says n = 0', qa.find((c) => c.key === 'cognitive.first_attempt_verified')?.n === 0);
  await dlg(p).locator('select[aria-label="Department"]').selectOption('Engineering');
  check('Engineering keeps the four reviewed tasks', await until(async () => (await cellsDom()).find((c) => c.key === 'cognitive.first_attempt_verified')?.n === 4, 8000));
  req = waitReq('window=7d');
  await dlg(p).getByRole('radio', { name: '7d' }).click();
  check('the window switch re-reads with window=7d', !!(await req) && await until(async () => (await p.locator('[data-dimensions="ready"][data-window="7d"]').count()) === 1, 8000));
  await dlg(p).getByRole('radio', { name: '30d' }).click();
  await dlg(p).locator('select[aria-label="Department"]').selectOption('');
  await until(async () => (await p.locator('[data-dimensions="ready"][data-window="30d"][data-department=""]').count()) === 1, 8000);

  // ---- 3. ? popovers
  let helpOk = 0;
  for (const k of [...KEYS.map((x) => `dimensions.${x}`), 'dimensions.department', 'dimensions.window', 'dimensions.cell']) {
    await dlg(p).locator(`[data-help-key="${k}"]`).click();
    const ok = await until(async () => (await p.locator('.help-pop').count()) === 1 && (await p.locator('.help-pop').innerText()).length > 80, 6000);
    const txt = ok ? await p.locator('.help-pop').innerText() : '';
    if (ok && (KEYS.some((x) => k === `dimensions.${x}`) ? (k === 'dimensions.environmental' ? /not measured until Stage 7/ : /not enough evidence/).test(txt) : true)) helpOk++;
    await p.keyboard.press('Escape');
    await until(async () => (await p.locator('.help-pop').count()) === 0, 4000);
    if (!(await dlg(p).count())) await p.locator('[data-six-dimensions]').first().click(); // Escape closed the dialog too: reopen
  }
  check('every ? opens a popover with its text (each dimension explains why it may be empty)', helpOk === 9, `${helpOk}/9`);
  if (!(await dlg(p).count())) { await p.locator('[data-six-dimensions]').first().click(); await ready(p).waitFor({ timeout: 10000 }); }

  // ---- 4. light theme screenshot, then from Agents > Departments
  await dlg(p).getByRole('button', { name: /Close/i }).first().click().catch(() => p.keyboard.press('Escape'));
  await until(async () => (await dlg(p).count()) === 0, 5000);
  const light = await open('Luca', 'light');
  await light.p.goto(base + '/operations?tab=agents&sub=departments', { waitUntil: 'domcontentloaded' });
  await settle(light.p);
  await light.p.locator('[data-six-dimensions]').first().click();
  check('Agents > Departments also opens the panel', await until(async () => (await ready(light.p).count()) === 1, 15000));
  await calm(light.p);
  await light.p.screenshot({ path: `${SHOTS}/c46-light.png` });
  if (DOC) await light.p.screenshot({ path: `${DOC}-light.png` });
  await light.ctx.close();

  // ---- 5. member
  const mem = await open('Mina');
  await mem.p.goto(base + '/overview', { waitUntil: 'domcontentloaded' });
  await settle(mem.p);
  await mem.p.locator('[data-six-dimensions]').first().click();
  check('a member opens the panel too', await until(async () => (await ready(mem.p).count()) === 1, 15000));
  await calm(mem.p);
  const md = await mem.p.locator('[data-cell]').evaluateAll((els) => els.map((e) => ({ key: e.getAttribute('data-cell'), state: e.getAttribute('data-state'), n: e.getAttribute('data-n') === '' ? null : Number(e.getAttribute('data-n')), text: e.innerText })));
  const adminOnly = ['capability.site_grants', 'knowledge.lessons_proposed', 'knowledge.lessons_accepted', 'knowledge.lessons_rolled_back'];
  check('administrator-only cells are state "hidden" with no n and say "hidden for your role" on their face (never "n = 0")', adminOnly.every((k) => { const c = md.find((x) => x.key === k); return c && c.state === 'hidden' && c.n === null && /hidden for your role/.test(c.text) && !/n = 0/.test(c.text); }));
  const mu = md.filter((c) => c.key.startsWith('environmental.'));
  check('a member sees the same two unmeasured Environmental cells', mu.length === 2 && mu.every((c) => c.state === 'unmeasured' && c.n === null && /not measured until Stage 7/.test(c.text)));
  const seenM = md.find((c) => c.key === 'cognitive.first_attempt_verified');
  check('the member sees the shared mission\'s values (same as the admin)', seenM?.n === 4 && seenM.state === 'ok');
  const msrv = (await apiGet(mem.p, '/company/dimensions?department=Engineering')).body;
  check('the member can ask for a department; an unknown one is 404', msrv.department === 'Engineering' && (await apiGet(mem.p, '/company/dimensions?department=Nowhere')).status === 404);
  await mem.ctx.close();
  await admin.ctx.close();
} catch (e) { check('script ran to the end', false, String(e).split('\n')[0]); }
console.log(errors.length ? 'PAGE ERRORS:\n' + errors.join('\n') : 'no page errors');
console.log(`${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
writeFileSync(`${SHOTS}/api-c46.txt`, results.join('\n') + '\n');
await b.close();
process.exit(results.some((r) => r.startsWith('FAIL')) || errors.length ? 1 : 0);
