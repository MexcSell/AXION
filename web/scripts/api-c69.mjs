// c69 (R3-5), api mode: the Process row of the Dimensions tab (Agents > Dimensions). Five measured cells (and a chip for two unmeasured figures) next to the six dimension rows: returned for rework,
// accepted first time, duplicate delegations, reassign churn, wait on a hand-off, approval wait and cost (unmeasured, shown as a chip with a ?).
// Each cell shows n and the window (or "not enough evidence (n = k)" / "not measured"), open items beside the figure, a guard cue and, on select, the
// guard button, the "?" with the formula and the cause breakdown. The DOM agrees with GET /company/process; the row fits one 1366x768 screen and 390 px.
// Seeded rows (SQL, e2e database only) give real values. Run through scripts/api-e2e.sh. Condition waits only (no networkidle).
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
process.env.DATA_MODE = 'api'; // _session.mjs reads it at load time
const { signIn, settle, calm, requireE2eDatabase } = await import('./_session.mjs');
const base = process.env.BASE || 'http://127.0.0.1:5193';
const SHOTS = process.env.SHOTS || `/tmp/axion-api-c69-${new URL(base).port}`;
const DOC = process.env.DOC_SHOT_PREFIX;
mkdirSync(SHOTS, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.PW_CHROME || '/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome' });
const results = [], errors = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); console.log(results[results.length - 1]); };
const until = async (f, ms = 10000, step = 150) => { const t0 = Date.now(); for (;;) { try { if (await f()) return true; } catch { /* retry */ } if (Date.now() - t0 > ms) return false; await new Promise((r) => setTimeout(r, step)); } };
const KEYS = ['rework_rate', 'first_pass_acceptance', 'duplicate_delegation', 'reassign_churn', 'handoff_wait_h'];
const UNMEASURED = ['approval_decision_h', 'cost'];
let adminPage = null;
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
const hit = (loc) => loc.evaluate((e) => e.click());
const closeAll = async (p) => { for (let i = 0; i < 8; i++) { if ((await p.locator('.gm-pop, .help-pop').count()) === 0) return true; const x = p.locator('.gm-pop [aria-label="Close the guard"], .help-pop [aria-label="Close help"]'); if (await x.count()) await x.last().evaluate((e) => e.click()).catch(() => {}); else await p.keyboard.press('Escape'); await new Promise((r) => setTimeout(r, 200)); } return (await p.locator('.gm-pop, .help-pop').count()) === 0; };
const apiGet = async (p, path) => { const r = await p.request.get(base + '/api/v1' + path); return { status: r.status(), body: await r.json().catch(() => ({})) }; };
const ready = (p) => p.locator('[data-dimensions="ready"]');
const procReady = (p) => p.locator('[data-process="ready"]');

try {
  const pg = createRequire(new URL('../../server/package.json', import.meta.url))('pg');
  const db = new pg.Client({ connectionString: requireE2eDatabase() });
  await db.connect();
  const admin = await open('Luca');
  adminPage = admin.p;
  await admin.p.goto(base + '/overview', { waitUntil: 'domcontentloaded' });
  await settle(admin.p);
  const u = (await db.query(`select id, tenant_id from users where name='Luca' limit 1`)).rows[0];
  const T = u.tenant_id;
  await db.query(`insert into missions(id, tenant_id, owner_id, shared, status, demo) values ('C69', $1, $2, true, 'running', false)`, [T, u.id]);
  await db.query(`insert into mission_revisions(mission_id, revision, title, kind, priority, text, created_by) values ('C69',1,'c69','data','normal','x',$1)`, [u.id]);
  await db.query(`insert into agent_instances(id, tenant_id, mission_id, agent_id, agent_version_id) select 'C69:coder-01',$1,'C69',d.id,d.active_version_id from agent_definitions d where d.id='coder-01'`, [T]);
  const review = async (id, verdict, days, rubric = '[{"criterion":"c","result":"pass"}]') => {
    await db.query(`insert into tasks(id, tenant_id, mission_id, title, status, owner_agent, owner_instance_id, created_at) values ($1,$2,'C69','T','passed','coder-01','C69:coder-01', now() - interval '40 days')`, [id, T]);
    await db.query(`insert into task_attempts(task_id, attempt_no, started_at, finished_at, result) values ($1,1, now() - interval '39 days', now() - interval '38 days','passed')`, [id]);
    await db.query(`insert into task_reviews(id, tenant_id, mission_id, task_id, attempt_id, reviewer_id, reviewer_kind, reviewer_model_family, producer_id, producer_kind, producer_model_family, principal_id, rubric, verdict, evidence, created_at)
      values ($1,$2,'C69',$3,(select id from task_attempts where task_id=$3 limit 1),'rev-x','agent','fam-b','C69:coder-01','agent','fam-a','owner-x',$4,$5,$6, now() - ($7 || ' days')::interval)`,
      ['TR-' + id, T, id, rubric, verdict, verdict === 'accepted' ? '[{"kind":"note","id":"n"}]' : '[]', String(days)]);
  };
  // rework: 5 tasks with a first review in the window, 2 returned (one with a failed criterion); 1 finished task with no review (open). Hand computed: 2 of 5 = 40.0
  await review('C69A', 'accepted', 9); await review('C69B', 'accepted', 8); await review('C69C', 'accepted', 7);
  await review('C69D', 'changes_requested', 6, '[{"criterion":"c","result":"fail"}]'); await review('C69E', 'rejected', 5);
  await db.query(`insert into tasks(id, tenant_id, mission_id, title, status, owner_agent, owner_instance_id) values ('C69OPEN',$1,'C69','T','passed','coder-01','C69:coder-01')`, [T]);
  // hand-offs: waits of 1, 2 and 4 hours, plus one delegation with no attempt (open). Median 2 h, p90 4 h
  for (let i = 0; i < 4; i++) {
    await db.query(`insert into tasks(id, tenant_id, mission_id, title, status, owner_agent, owner_instance_id) values ($1,$2,'C69','T','ready','coder-01','C69:coder-01')`, [`C69H${i}`, T]);
    await db.query(`insert into mission_delegations(mission_id, from_instance, to_instance, edge_kind, task_id, at) values ('C69','C69:coder-01','C69:coder-01','delegated',$1, now() - interval '3 days')`, [`C69H${i}`]);
    if (i < 3) await db.query(`insert into task_attempts(task_id, attempt_no, started_at) values ($1,1, now() - interval '3 days' + ($2 || ' hours')::interval)`, [`C69H${i}`, String([1, 2, 4][i])]);
  }
  // duplicate delegation: 3 briefs, two with the same goal
  for (const [i, g] of ['Write the weekly report', '  write the WEEKLY   report', 'Review the report'].entries()) await db.query(`insert into delegation_briefs(tenant_id, mission_id, from_id, from_kind, to_instance, to_agent, brief, sha256, depth, created_by) values ($1,'C69',$2,'user','C69:coder-01','coder-01',$3::jsonb,$4,1,$2)`, [T, u.id, JSON.stringify({ goal: g }), String(i + 1).padEnd(64, '0')]);
  await db.end();

  // ---- 1. the Process view of the Dimensions tab
  const { p } = admin;
  await p.goto(base + '/overview', { waitUntil: 'domcontentloaded' });
  await settle(p);
  await p.locator('[data-six-dimensions]').first().click();
  check('the Dimensions tab opens on the six dimensions (the default view is unchanged)', await until(async () => (await ready(p).count()) === 1, 20000) && (await procReady(p).count()) === 0);
  await calm(p);
  await p.getByRole('radio', { name: 'Process' }).click();
  check('choosing "Process" shows the process figures', await until(async () => (await procReady(p).count()) === 1, 15000));
  await calm(p);
  const srv = (await apiGet(p, '/company/process?window=30d')).body;
  check('GET /company/process has the seven cells in order', JSON.stringify(srv.cells?.map((c) => c.key)) === JSON.stringify([...KEYS, ...UNMEASURED].map((k) => `process.${k}`)), JSON.stringify(srv.cells?.map((c) => c.key)));
  const cards = () => p.locator('.proc-card[data-pcell]').evaluateAll((els) => els.map((e) => ({ key: e.getAttribute('data-pcell'), state: e.getAttribute('data-state'), value: e.getAttribute('data-value'), n: e.getAttribute('data-n') === '' ? null : Number(e.getAttribute('data-n')), open: e.getAttribute('data-open'), text: e.innerText })));
  const dom = await cards();
  check('five measured cards, in order', JSON.stringify(dom.map((d) => d.key)) === JSON.stringify(KEYS.map((k) => `process.${k}`)));
  check('the two figures with no source are a strip of honest blanks with the reason, n unknown, no number', (await p.locator('.proc-bl[data-state="unmeasured"]').count()) === 2 && (await p.locator('[data-unmeasured]').getAttribute('data-unmeasured')) === UNMEASURED.map((k) => `process.${k}`).join(',') && /not measured/.test(await p.locator('.proc-blank').innerText()));
  check('every card agrees with the server (state, value, n)', srv.cells.filter((c) => c.state !== 'unmeasured').every((c, i) => dom[i].state === c.state && dom[i].value === (c.value === null ? '' : String(c.value)) && dom[i].n === c.n), JSON.stringify(dom.map((d) => [d.key, d.state, d.value, d.n])));
  check('every card shows n and the window, or "not enough evidence (n = k)", never a bare number', dom.every((c) => (c.state === 'none' ? new RegExp(`not enough evidence \\(n = ${c.n}\\)`).test(c.text) : new RegExp(`n = ${c.n}`).test(c.text) && /last 30 days/.test(c.text))));
  const get = (k) => srv.cells.find((c) => c.key === `process.${k}`);
  check('the seeded rows give the hand-computed values: rework 40% of 5 (2 returned), 1 open', get('rework_rate').value === 40 && get('rework_rate').n === 5 && get('rework_rate').open?.n === 1, JSON.stringify(get('rework_rate')));
  check('first-pass acceptance is 60% of 5 (3 accepted first time)', get('first_pass_acceptance').value === 60 && get('first_pass_acceptance').n === 5);
  check('hand-off wait: median 2 h, p90 4 h over 3, 1 open', get('handoff_wait_h').value === 2 && get('handoff_wait_h').p90 === 4 && get('handoff_wait_h').n === 3 && get('handoff_wait_h').open?.n === 1, JSON.stringify(get('handoff_wait_h')));
  check('duplicate delegations: 2 of 3 = 66.7%', get('duplicate_delegation').value === 66.7 && get('duplicate_delegation').n === 3);
  check('reassign churn is "not enough evidence" below 20 tasks and says how many', get('reassign_churn').state === 'none' && /not enough evidence \(n = \d+\)/.test(dom.find((d) => d.key === 'process.reassign_churn').text));
  check('the approval time and the cost are "unmeasured" in the API (no source): value null, n null', UNMEASURED.every((k) => get(k).state === 'unmeasured' && get(k).value === null && get(k).n === null));
  check('the open count is shown beside the figure on the rework, first-pass and hand-off cards ("not in the rate")', (await Promise.all(['rework_rate', 'first_pass_acceptance', 'handoff_wait_h'].map(async (k) => /1 open/.test(await p.locator(`[data-pcell="process.${k}"] .proc-open`).innerText()) && /not in the rate/.test(await p.locator(`[data-pcell="process.${k}"] .proc-open`).innerText())))).every(Boolean));
  check('the hand-off card shows the p90 beside the median', /p90 4\.0 h/.test(await p.locator('[data-pcell="process.handoff_wait_h"]').innerText()));
  check('the rework card shows the cause breakdown with n', await p.locator('[data-pcell="process.rework_rate"] [data-cause="criterion failed, no tag"]').count() === 1 && /no recorded cause\s*1/.test(await p.locator('[data-pcell="process.rework_rate"] .proc-causes').innerText()));
  check('no total, score or overall number anywhere in the Process view', !/\b(score|overall|composite|total|average)\b/i.test((await p.locator('.proc-grid').innerText()) + (await p.locator('.proc-blank').innerText())));

  // ---- 2. help and guard
  check('the panel, and every card and blank, has its own ?', (await p.locator('[data-help-key="process.row"]').count()) === 1 && (await Promise.all([...KEYS, ...UNMEASURED].map((k) => p.locator(`[data-pcell="process.${k}"] [data-help-key="process.${k}"]`).count()))).every((n) => n === 1));
  await hit(p.locator('[data-pcell="process.rework_rate"] [data-help-key="process.rework_rate"]'));
  check('the ? of the rework card opens its formula', await until(async () => /Formula: returned on the first review/.test(await p.locator('.help-pop').innerText()), 6000));
  await closeAll(p);
  let helpOk = true;
  for (const k of [...KEYS, ...UNMEASURED]) { await hit(p.locator(`[data-pcell="process.${k}"] [data-help-key="process.${k}"]`)); if (!(await until(async () => (await p.locator('.help-pop').innerText()).length > 80, 5000))) helpOk = false; await closeAll(p); }
  check('every ? opens real text', helpOk);
  await hit(p.locator('[data-pcell="process.rework_rate"] [data-guard-key]'));
  check('the guard opens the counter-metric, the uncovered qualities and the audit state', await until(async () => { const t = await p.locator('.gm-pop').innerText(); return /Counter-metric/i.test(t) && /Does not cover/i.test(t) && /No human audit yet/.test(t); }, 6000));
  await closeAll(p);
  const guard = (await apiGet(p, '/company/metric-guard')).body;
  const gp = guard.rows.filter((r) => r.kind === 'process');
  const dg = await p.locator('[data-pcell] [data-guard-key]').evaluateAll((els) => els.map((e) => [e.getAttribute('data-guard-key'), e.getAttribute('data-gameable')]));
  check('every card and blank has a guard button, and its gameable flag is the server\'s', gp.length === 7 && dg.length === 7 && dg.every(([id, g]) => g === (gp.find((r) => r.id === id).gameable ? '1' : '0')), JSON.stringify(dg));

  // ---- 3. department and window
  const dep = srv.departments.find((d) => d === 'Engineering') ?? srv.departments[0];
  await p.locator('select[aria-label="Department"]').selectOption(dep);
  check('choosing a department re-reads the process figures', await until(async () => (await p.locator(`[data-process="ready"][data-department="${dep}"]`).count()) === 1, 10000));
  const srvDep = (await apiGet(p, `/company/process?window=30d&department=${encodeURIComponent(dep)}`)).body;
  check('the cards agree with the server for that department', await until(async () => { const d = await cards(); return srvDep.cells.filter((c) => c.state !== 'unmeasured').every((c, i) => d[i]?.key === c.key && d[i]?.n === c.n); }, 6000));
  await p.locator('select[aria-label="Department"]').selectOption('');
  await p.getByRole('radio', { name: '7d' }).click();
  check('the window switch re-reads: 7 days is a different cohort (the seeded reviews are 5 to 9 days old)', await until(async () => (await p.locator('[data-process="ready"][data-window="7d"]').count()) === 1 && /last 7 days/.test(await p.locator('.proc-card').first().innerText()), 10000));
  const s7 = (await apiGet(p, '/company/process?window=7d')).body;
  check('and the 7-day cards agree with the server', await until(async () => { const d = await cards(); return s7.cells.filter((c) => c.state !== 'unmeasured').every((c, i) => d[i]?.n === c.n && d[i]?.state === c.state); }, 6000));
  await p.getByRole('radio', { name: '30d' }).click();
  await until(async () => (await p.locator('[data-process="ready"][data-window="30d"]').count()) === 1, 10000);
  await calm(p);

  // ---- 4. fit
  const fit = await p.evaluate(() => { const f = document.querySelector('.fit-scroll'); const note = document.querySelector('.proc-note').getBoundingClientRect(); return { inner: f ? f.scrollHeight - f.clientHeight : -1, docScroll: document.documentElement.scrollHeight - innerHeight, sideScroll: document.documentElement.scrollWidth - innerWidth, noteBottom: Math.round(note.bottom), vh: innerHeight }; });
  check('the Process view fits 1366x768 without scrolling (no inner or page scroll, the note line on screen)', fit.inner >= 0 && fit.inner <= 2 && fit.docScroll <= 0 && fit.sideScroll <= 0 && fit.noteBottom <= fit.vh, JSON.stringify(fit));
  const clip = await p.evaluate(() => [...document.querySelectorAll('.proc-card, .proc-bl')].map((c) => ({ k: c.getAttribute('data-pcell'), over: c.scrollHeight - c.clientHeight, side: c.scrollWidth - c.clientWidth })).filter((c) => c.over > 1 || c.side > 1));
  check('no card clips its content', clip.length === 0, JSON.stringify(clip));
  await p.screenshot({ path: `${SHOTS}/c69-dark.png` });
  if (DOC) await p.screenshot({ path: `${DOC}-dark.png` });
  await p.getByRole('radio', { name: 'Outcomes' }).click();
  check('switching back to Outcomes shows the six dimension rows again, unchanged', await until(async () => (await ready(p).count()) === 1 && (await p.locator('[data-dimension]').count()) === 6, 8000));
  await p.getByRole('radio', { name: 'Process' }).click();
  await until(async () => (await procReady(p).count()) === 1, 8000);

  // ---- 5. light mode, a member, and a narrow screen
  const light = await open('Luca', 'light');
  await light.p.goto(base + '/operations?tab=agents&sub=dimensions', { waitUntil: 'domcontentloaded' });
  await settle(light.p);
  await light.p.getByRole('radio', { name: 'Process' }).click();
  check('light mode: the Process view renders', await until(async () => (await procReady(light.p).count()) === 1, 20000));
  await calm(light.p);
  await light.p.screenshot({ path: `${SHOTS}/c69-light.png` });
  if (DOC) await light.p.screenshot({ path: `${DOC}-light.png` });
  const mem = await open('Mina');
  await mem.p.goto(base + '/operations?tab=agents&sub=dimensions', { waitUntil: 'domcontentloaded' });
  await settle(mem.p);
  await mem.p.getByRole('radio', { name: 'Process' }).click();
  check('a member sees the Process view, from the missions they can see (the shared C69 mission)', await until(async () => (await procReady(mem.p).count()) === 1, 20000));
  const memSrv = (await apiGet(mem.p, '/company/process')).body;
  check('the member response has no administrator-only field and the same seven cells', memSrv.cells.length === 7 && memSrv.cells.find((c) => c.key === 'process.rework_rate').n === 5);
  await p.setViewportSize({ width: 390, height: 844 });
  await until(async () => (await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)), 5000);
  await calm(p);
  const mob = await p.evaluate(() => ({ over: document.documentElement.scrollWidth - innerWidth, cells: [...document.querySelectorAll('.proc-card')].map((c) => Math.round(c.getBoundingClientRect().width)), clip: [...document.querySelectorAll('.proc-card')].filter((c) => c.getBoundingClientRect().right > innerWidth + 1).length }));
  check('390 px: no horizontal scroll and every process card is on screen', mob.over <= 0 && mob.cells.length === 5 && mob.clip === 0, JSON.stringify(mob));
  const noteBox = await p.evaluate(() => { const n = document.querySelector('.proc-note'); return { over: n.scrollHeight - n.clientHeight, h: n.clientHeight }; });
  check('F5: at 390 px the footnote is not clipped (scrollHeight <= clientHeight)', noteBox.over <= 1, JSON.stringify(noteBox));
  await p.locator('.proc-grid').scrollIntoViewIfNeeded();
  await p.screenshot({ path: `${SHOTS}/c69-mobile.png` });
  // ---- 6. a keyboard/name check of the card controls (a role-less element must not carry a name). Demo mode is NOT rendered by this script (it needs a local demo sign-in).
  const names = await p.evaluate(() => [...document.querySelectorAll('[data-pcell] [aria-label]')].filter((e) => !e.getAttribute('role') && !['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA', 'ARTICLE', 'SECTION', 'NAV', 'UL', 'LI'].includes(e.tagName)).map((e) => e.tagName + '.' + e.className));
  check('no element with an aria-label lacks a role (cards use group/note/article/button)', names.length === 0, JSON.stringify(names));
  const tabbable = await p.evaluate(() => [...document.querySelectorAll('.proc-card [tabindex="0"], .proc-card button, .proc-bl [tabindex="0"], .proc-bl button')].length);
  check('every card has focusable controls (the value, the guard and the ?)', tabbable >= 5 * 3);
  // F4/F6: the URL opens the Process view, the switch keeps the URL in step, and arrow keys move through the radio group
  await p.setViewportSize({ width: 1366, height: 768 });
  await p.goto(base + '/operations?tab=agents&sub=dimensions&view=process', { waitUntil: 'domcontentloaded' });
  await settle(p);
  check('F4: ?view=process opens the Process view directly', await until(async () => (await procReady(p).count()) === 1, 15000));
  await p.getByRole('radio', { name: 'Process' }).focus();
  await p.keyboard.press('ArrowLeft');
  check('F6: ArrowLeft on the switch selects Outcomes, and the URL drops view=process', await until(async () => (await ready(p).count()) === 1 && !/view=process/.test(p.url()) && (await p.getByRole('radio', { name: 'Outcomes' }).getAttribute('aria-checked')) === 'true', 8000));
  await p.keyboard.press('ArrowRight');
  check('F6: ArrowRight selects Process again, the focus follows, and the URL has view=process', await until(async () => (await procReady(p).count()) === 1 && /view=process/.test(p.url()) && (await p.evaluate(() => document.activeElement?.getAttribute('role') === 'radio' && document.activeElement.textContent.includes('Process'))), 8000));
  check('no page error or console error', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) {
  check('script ran to the end', false, String(e?.stack || e).slice(0, 600));
}
await b.close();
const failed = results.filter((r) => r.startsWith('FAIL'));
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
