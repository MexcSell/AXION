// c66 (R3-4), api mode: the Goodhart guard on the scorecard rows, the KPI tiles and the six-dimension cells. Each row shows (behind a
// shield button / a cue + the note line) its counter-metric, what it does not cover and the "gameable" flag, with a ? that explains it.
// The DOM agrees with GET /company/metric-guard; a human audit above the bar flags a row; nothing grows past one 1366x768 screen.
// Run through scripts/api-e2e.sh (lane ports via E2E_API_PORT/E2E_WEB_PORT). Condition waits only (no networkidle).
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
process.env.DATA_MODE = 'api'; // _session.mjs reads it at load time
const { signIn, settle, calm } = await import('./_session.mjs');
const base = process.env.BASE || 'http://127.0.0.1:5193';
const SHOTS = process.env.SHOTS || `/tmp/axion-api-c66-${new URL(base).port}`;
const DOC = process.env.DOC_SHOT_PREFIX;
mkdirSync(SHOTS, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.PW_CHROME || '/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome' });
const results = [], errors = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); console.log(results[results.length - 1]); };
const until = async (f, ms = 10000, step = 150) => { const t0 = Date.now(); for (;;) { try { if (await f()) return true; } catch { /* retry */ } if (Date.now() - t0 > ms) return false; await new Promise((r) => setTimeout(r, step)); } };
const SC = ['started', 'finished', 'verified_success_rate', 'completed_unverified', 'median_cycle_time_h', 'failure_rate', 'task_recovery_rate', 'waiting_approval_median_h', 'approved_by_non_owner', 'tasks_verified_by_review'];
const KPI = ['kpi.activeMissions', 'kpi.staffedAgents', 'kpi.approvals', 'kpi.success.api'];
const device = { name: 'Chrome on Linux (script)', kind: 'desktop', browser: 'Chrome' };
let adminPage = null;
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
  await ctx.addInitScript((t) => { try { localStorage.setItem('axion.data-mode', 'api'); localStorage.setItem('axion.testhook', '1'); localStorage.setItem('axion.settings.v1', JSON.stringify({ state: { themeMode: t, motion: 'reduced' }, version: 0 })); } catch { /* */ } }, theme);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_CONNECTION|ERR_INTERNET_DISCONNECTED|502|503|504|EventSource/.test(m.text())) errors.push(`${name} console: ${m.text()}`); });
  return { ctx, p };
}
/** Close every open guard and help popover. A first Escape can be spent on a tooltip, so press until none is left (a bounded loop). */
const hit = (loc) => loc.evaluate((e) => e.click()); // a DOM click: a tooltip left over from the last popover must not decide whether the next one opens
const closeAll = async (p) => { for (let i = 0; i < 8; i++) { if ((await p.locator('.gm-pop, .help-pop').count()) === 0) return true; const x = p.locator('.gm-pop [aria-label="Close the guard"], .help-pop [aria-label="Close help"]'); if (await x.count()) await x.last().evaluate((e) => e.click()).catch(() => {}); else await p.keyboard.press('Escape'); await new Promise((r) => setTimeout(r, 200)); } return (await p.locator('.gm-pop, .help-pop').count()) === 0; };
const apiGet = async (p, path) => { const r = await p.request.get(base + '/api/v1' + path); return { status: r.status(), body: await r.json().catch(() => ({})) }; };
const apiPost = async (p, path, data) => { const csrf = (await (await p.request.get(base + '/api/v1/me')).json()).me.csrf; const r = await p.request.post(base + '/api/v1' + path, { headers: { 'x-csrf': csrf }, data }); return { status: r.status(), body: await r.json().catch(() => ({})) }; };

try {
  const admin = await open('Luca');
  const { p } = admin;
  adminPage = p;
  await p.goto(base + '/overview', { waitUntil: 'domcontentloaded' });
  await settle(p);
  await p.locator('[data-scorecard="ready"]').waitFor({ timeout: 20000 });
  await calm(p);
  const guard = (await apiGet(p, '/company/metric-guard')).body;
  const byId = new Map(guard.rows.map((r) => [r.id, r]));
  check('the API has a guard for every scorecard row, KPI tile and dimension cell (at least 30)', guard.rows.length >= 30, `${guard.rows.length}`);

  // ---- scorecard rows
  check('every scorecard row has a guard button', (await Promise.all(SC.map((k) => p.locator(`[data-row="${k}"] [data-guard-key="scorecard.${k}"]`).count()))).every((n) => n === 1));
  check('the weekly throughput has a guard button too', (await p.locator('[data-guard-key="scorecard.throughput"]').count()) === 1);
  check('each button says gameable or not, the same as the server says', (await p.locator('[data-row] [data-guard-key]').evaluateAll((els) => els.map((e) => [e.getAttribute('data-guard-key'), e.getAttribute('data-gameable')]))).every(([id, g]) => g === (byId.get(id).gameable ? '1' : '0')));
  const rowH = await p.locator('[data-row]').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
  check('the guard adds no height: every scorecard row is still 18 px', rowH.length === 10 && rowH.every((h) => h === 18), JSON.stringify(rowH));
  const clipped = await p.evaluate(() => [...document.querySelectorAll('[data-row] [data-guard-key]')].filter((g) => { const r = g.getBoundingClientRect(), row = g.closest('[data-row]').getBoundingClientRect(); return r.width < 12 || r.right > row.right + 0.5 || r.left < row.left; }).map((g) => g.getAttribute('data-guard-key')));
  check('no guard button is clipped or pushed out of its row (a long label gives way, the button does not)', clipped.length === 0, JSON.stringify(clipped));
  await hit(p.locator('[data-guard-key="scorecard.tasks_verified_by_review"]'));
  const pop = p.locator('.gm-pop');
  check('opening it shows the gameable flag in plain words, the counter-metric and what the row does not cover',
    await until(async () => (await pop.count()) === 1 && (await pop.locator('[data-gameable="1"]').count()) === 1, 6000)
    && /agent identity can write/.test(await pop.innerText()) && /Counter-metric/i.test(await pop.innerText()) && (await pop.locator('[data-uncovered]').count()) >= 2);
  const popText = await pop.innerText();
  check('the popover says no agent executes today, names no function, and says who enters the audit labels', /no agent executes today/.test(popText) && !/recordReview|createTag|joinMission/.test(popText) && /entered by an administrator/.test(popText) && /task reviews/.test(popText));
  check('the popover carries a ? that explains "gameable"', (await pop.locator('[data-help-key="guard.gameable"]').count()) === 1);
  await hit(pop.locator('[data-help-key="guard.gameable"]'));
  check('the ? opens its text (display only, R3-3 waits for Q13)', await until(async () => (await p.locator('.help-pop:not(.gm-pop)').count()) === 1 && /Display only/.test(await p.locator('.help-pop:not(.gm-pop)').innerText()), 6000));
  check('both popovers close again (guard, then its help)', await closeAll(p));
  await hit(p.locator('[data-guard-key="scorecard.waiting_approval_median_h"]'));
  check('a row with "no known counter-metric" says so with its reason', await until(async () => (await p.locator('.gm-pop [data-counter-none]').count()) === 1, 6000));
  await closeAll(p);

  // ---- 390 px: a 24 px hit area without a taller row
  await p.setViewportSize({ width: 390, height: 844 });
  await until(async () => (await p.evaluate(() => innerWidth === 390)), 3000);
  const hitSz = await p.evaluate(() => { const g = [...document.querySelectorAll('[data-row] [data-guard-key]')].find((e) => e.getBoundingClientRect().width > 0); const r = g?.closest('[data-row]'); return g ? { w: Math.round(g.getBoundingClientRect().width), h: Math.round(g.getBoundingClientRect().height), row: Math.round(r.getBoundingClientRect().height) } : null; });
  check('at 390 px the compact guard button has a 24 px hit area and its row is still 18 px', !!hitSz && hitSz.w >= 24 && hitSz.h >= 24 && hitSz.row === 18, JSON.stringify(hitSz));
  await p.setViewportSize({ width: 1366, height: 768 });
  await until(async () => (await p.evaluate(() => innerWidth === 1366)), 3000);

  // ---- KPI tiles
  check('each measured KPI tile has a guard button', (await Promise.all(KPI.map((k) => p.locator(`.kt [data-guard-key="${k}"]`).count()))).every((n) => n === 1));
  const tile = await p.evaluate(() => [...document.querySelectorAll('.kt')].map((t) => {
    const g = t.querySelector('.kt-guard'); if (!g) return null;
    const a = g.getBoundingClientRect(), r = t.getBoundingClientRect();
    const ext = (e) => { const rg = document.createRange(); rg.selectNodeContents(e); return rg.getBoundingClientRect(); };
    const hit = [...t.querySelectorAll('.kt-help, .kpi-val, .kt-badge, .kpi-label, .kt-hint, .kpi-delta')].filter((e) => { const c = e.getBoundingClientRect(); return c.width > 0 && !(a.right <= c.left + 0.5 || a.left >= c.right - 0.5 || a.bottom <= c.top + 0.5 || a.top >= c.bottom - 0.5); }).map((e) => e.className);
    return { hit, inside: a.left >= r.left && a.right <= r.right && a.bottom <= r.bottom && a.top >= r.top, h: Math.round(r.height) };
  }));
  check('on a tile the guard sits inside it and covers nothing: not the ?, the value, the n badge, the label or the hint', tile.filter(Boolean).length === 4 && tile.filter(Boolean).every((t) => t.hit.length === 0 && t.inside), JSON.stringify(tile));
  await hit(p.locator('.kt [data-guard-key="kpi.success.api"]'));
  const tileOpen = await until(async () => (await p.locator('.gm-pop [data-uncovered]').count()) >= 2 && /Counter-metric/i.test(await p.locator('.gm-pop').innerText()), 6000);
  check('a tile opens its guard (counter-metric and uncovered qualities)', tileOpen, tileOpen ? '' : `${await p.locator('.gm-pop').count()} popovers, url ${p.url()}`);
  if (!tileOpen) await p.screenshot({ path: `${SHOTS}/c66-tile-debug.png` });
  await closeAll(p);
  const ov = await p.evaluate(() => { const f = document.querySelector('.fit-scroll'); return { inner: f ? f.scrollHeight - f.clientHeight : 0, doc: document.documentElement.scrollHeight - innerHeight, side: document.documentElement.scrollWidth - innerWidth }; });
  check('the Overview still fits 1366x768 (no page scroll)', ov.doc <= 0 && ov.side <= 0 && ov.inner <= 2, JSON.stringify(ov));
  await p.screenshot({ path: `${SHOTS}/c66-overview-dark.png` });
  if (DOC) await p.screenshot({ path: `${DOC}-overview-dark.png` });

  // ---- dimensions tab
  await p.goto(base + '/operations?tab=agents&sub=dimensions', { waitUntil: 'domcontentloaded' });
  await settle(p);
  await p.locator('[data-dimensions="ready"]').waitFor({ timeout: 20000 });
  await calm(p);
  const gameableCells = guard.rows.filter((r) => r.kind === 'dimension' && r.gameable).map((r) => r.id.replace('dimension.', ''));
  const cues = await p.locator('[data-guard-cue]').evaluateAll((els) => els.map((e) => e.getAttribute('data-guard-cue')));
  check('every gameable dimension cell shows the amber cue, and no other cell does', gameableCells.length > 0 && JSON.stringify([...cues].sort()) === JSON.stringify(gameableCells.map((k) => `dimension.${k}`).sort()), `${cues.length} cues, ${gameableCells.length} gameable`);
  const cells = await p.evaluate(() => [...document.querySelectorAll('.dim-cell')].map((c) => ({ over: c.scrollHeight - c.clientHeight, h: Math.round(c.getBoundingClientRect().height), label: (() => { const l = c.querySelector('.dim-cl'); return l ? l.scrollWidth - l.clientWidth : 0; })() })));
  check('every cell is still 37 px, clips nothing and cuts no label', cells.length >= 15 && cells.every((c) => c.h === 37 && c.over <= 0 && c.label <= 0), JSON.stringify(cells.filter((c) => c.h !== 37 || c.over > 0 || c.label > 0)));
  const keyed = await p.locator('[data-cell="cognitive.first_attempt_verified"]');
  await keyed.click();
  const note = p.locator('.dim-note');
  check('selecting a cell puts a guard button and the word "gameable" in the note line', await until(async () => (await note.locator('[data-guard-key="dimension.cognitive.first_attempt_verified"]').count()) === 1 && /gameable/.test(await note.innerText()), 6000));
  await hit(note.locator('[data-guard-key]'));
  check('it opens the counter-metric, the uncovered qualities and the audit state', await until(async () => { const t = await p.locator('.gm-pop').innerText(); return /Counter-metric/i.test(t) && /Does not cover/i.test(t) && /No human audit yet/.test(t); }, 6000));
  await closeAll(p);
  const fit = await p.evaluate(() => { const f = document.querySelector('.fit-scroll'); const nt = document.querySelector('.dim-note').getBoundingClientRect(); return { inner: f ? f.scrollHeight - f.clientHeight : 0, doc: document.documentElement.scrollHeight - innerHeight, side: document.documentElement.scrollWidth - innerWidth, noteBottom: Math.round(nt.bottom), vh: innerHeight, noteH: Math.round(nt.height) }; });
  check('the Dimensions tab still fits 1366x768 with a guard open or selected (no scroll, note line fully on screen, 28 px)', fit.doc <= 0 && fit.side <= 0 && fit.inner <= 2 && fit.noteBottom <= fit.vh && fit.noteH <= 28, JSON.stringify(fit));
  await p.screenshot({ path: `${SHOTS}/c66-dimensions-dark.png` });
  if (DOC) await p.screenshot({ path: `${DOC}-dimensions-dark.png` });

  // ---- audit: a person's labels above the bar flag the row
  // c83: a sample reference is typed (<kind>:<id>) and names a stored record: the missions and tasks and approvals this database really holds
  const refs = [];
  const ms = (await apiGet(p, '/missions')).body.missions ?? [];
  for (const m of ms) refs.push(`mission:${m.id}`);
  for (const m of ms) { if (refs.length >= 100) break; const t = (await apiGet(p, `/missions/${m.id}/tasks`)).body; for (const x of t.tasks ?? []) refs.push(`task:${x.id}`); }
  for (const a of (await apiGet(p, '/approvals')).body.approvals ?? []) refs.push(`approval:${a.id}`);
  const csrf = (await (await p.request.get(base + '/api/v1/me')).json()).me.csrf;
  for (let i = 0; new Set(refs).size < 100 && i < 120; i++) { // too few records: the script creates real missions to label
    const r = await p.request.post(base + '/api/v1/missions', { headers: { 'x-csrf': csrf, 'idempotency-key': `c83-audit-${Date.now()}-${i}` }, data: { text: `c83 audit sample ${i}`, files: [], shared: false } });
    const b = await r.json().catch(() => ({}));
    if (b.mission?.id) refs.push(`mission:${b.mission.id}`);
  }
  const uniq = [...new Set(refs)].slice(0, 100);
  check('the database holds at least 100 records to label (typed references)', uniq.length === 100, `${uniq.length}`);
  const free = await apiPost(p, '/company/metric-audits', { metricId: 'scorecard.verified_success_rate', samples: [{ sampleRef: 's0', metricLabel: true, auditLabel: false }] });
  check('a free-text sample reference is refused (no label stored)', free.status === 400 || free.status === 422, `${free.status}`);
  const samples = uniq.map((sampleRef, i) => ({ sampleRef, metricLabel: true, auditLabel: i >= 22 }));
  const post = await apiPost(p, '/company/metric-audits', { metricId: 'scorecard.verified_success_rate', samples });
  check('an administrator records 100 audit labels (22 disagreeing = 22%)', post.status === 201 && post.body.audit?.flagged === true && post.body.audit?.divergence === 22, JSON.stringify(post.body.audit));
  await p.goto(base + '/overview', { waitUntil: 'domcontentloaded' });
  await settle(p);
  await p.locator('[data-scorecard="ready"]').waitFor({ timeout: 20000 });
  await calm(p);
  await hit(p.locator('[data-guard-key="scorecard.verified_success_rate"]'));
  check('the row now says the audit disagrees, with the share and the bar', await until(async () => (await p.locator('.gm-pop [data-audit-flag]').count()) === 1 && /22%/.test(await p.locator('.gm-pop').innerText()) && /bar: 15%/.test(await p.locator('.gm-pop').innerText()), 8000));
  await p.screenshot({ path: `${SHOTS}/c66-guard-open-dark.png` });
  if (DOC) await p.screenshot({ path: `${DOC}-guard-open-dark.png` });
  await closeAll(p);

  // ---- light theme
  const light = await open('Luca', 'light');
  await light.p.goto(base + '/overview', { waitUntil: 'domcontentloaded' });
  await settle(light.p);
  await light.p.locator('[data-scorecard="ready"]').waitFor({ timeout: 20000 });
  await calm(light.p);
  await hit(light.p.locator('[data-guard-key="scorecard.tasks_verified_by_review"]'));
  await until(async () => (await light.p.locator('.gm-pop').count()) === 1, 6000);
  await light.p.screenshot({ path: `${SHOTS}/c66-guard-open-light.png` });
  if (DOC) await light.p.screenshot({ path: `${DOC}-guard-open-light.png` });
  await light.ctx.close();

  // ---- member: reads the flags, cannot record audits
  const mem = await open('Mina');
  await mem.p.goto(base + '/overview', { waitUntil: 'domcontentloaded' });
  await settle(mem.p);
  await mem.p.locator('[data-scorecard="ready"]').waitFor({ timeout: 20000 });
  check('a member sees the same guard buttons', (await mem.p.locator('[data-row] [data-guard-key]').count()) === 10);
  check('a member cannot record an audit (403)', (await apiPost(mem.p, '/company/metric-audits', { metricId: 'scorecard.finished', samples: samples.slice(0, 2) })).status === 403);
  await mem.ctx.close();
  await admin.ctx.close();
} catch (e) { check('script ran to the end', false, String(e).split('\n').slice(0, 8).join(' | ')); }
console.log(errors.length ? 'PAGE ERRORS:\n' + errors.join('\n') : 'no page errors');
console.log(`${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
writeFileSync(`${SHOTS}/api-c66.txt`, results.join('\n') + '\n');
await b.close();
process.exit(results.some((r) => r.startsWith('FAIL')) || errors.length ? 1 : 0);
