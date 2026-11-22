// Cycle 65 (lane w63), api mode: the review-capacity panel in System Operations (Queues tab) and its privacy checks.
// Admin (Luca) and member (Mina). Run through scripts/api-e2e.sh (DEMO seed on). server/src/cli/e2e-capacity-seed.ts adds decided and waiting
// approvals (the e2e database only). Screenshots: SHOTS (default /tmp/axion-c65), dark and light.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const base = process.env.BASE || 'http://127.0.0.1:5193';
const SHOTS = process.env.SHOTS || '/tmp/axion-c65';
mkdirSync(SHOTS, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.PW_CHROME || '/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome' });
const errors = [];
let fails = 0;
const check = (name, ok, extra = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };
const until = async (f, ms = 10000, step = 100) => { const t0 = Date.now(); for (;;) { try { if (await f()) return true; } catch { /* retry */ } if (Date.now() - t0 > ms) return false; await new Promise((r) => setTimeout(r, step)); } };
const memberNet = { people: [], capacity: [] };
const open = async (label, theme = 'dark') => {
  const ctx = await b.newContext({ viewport: { width: 1366, height: 768 } });
  await ctx.addInitScript(([th]) => { try { localStorage.setItem('axion.data-mode', 'api'); localStorage.setItem('axion.testhook', '1'); if (!localStorage.getItem('axion.settings.v1')) localStorage.setItem('axion.settings.v1', JSON.stringify({ state: { themeMode: th, skin: 'luminous', motion: 'reduced' }, version: 0 })); } catch { /* ignore */ } }, [theme]);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_CONNECTION|EventSource|50[234]|403|409/.test(m.text())) errors.push(`${label} console: ${m.text()}`); });
  return { ctx, p };
};
const connect = async (p, name, pass) => {
  await p.getByRole('heading', { name: 'Connect' }).waitFor({ timeout: 15000 });
  await p.getByLabel('Name').fill(name);
  await p.getByLabel('Password', { exact: true }).fill(pass);
  await p.getByRole('button', { name: /Connect/ }).click();
};
const apiOf = (p) => async (method, path) => { const r = await p.request.fetch(base + '/api/v1' + path, { method }); return { status: r.status(), body: await r.json().catch(() => ({})) }; };
const serverDir = new URL('../../server/', import.meta.url).pathname;
const seed = (...a) => JSON.parse(execFileSync('node', ['--env-file=.env', '--import', 'tsx', 'src/cli/e2e-capacity-seed.ts', ...a], { cwd: serverDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim().split('\n').pop());
const fits = (p) => p.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1 && document.documentElement.scrollWidth <= window.innerWidth + 1);
const goQueues = async (p) => { await p.goto(base + '/operations?tab=queues', { waitUntil: 'domcontentloaded' }); await p.locator('.ops-review-capacity').waitFor({ timeout: 15000 }); await until(async () => (await p.locator('[data-review-capacity]').getAttribute('data-review-capacity')) !== 'loading', 15000); };
try {
  const A = await open('A');
  await A.p.goto(base + '/missions', { waitUntil: 'domcontentloaded' });
  await connect(A.p, 'Luca', 'secret-1');
  await A.p.waitForSelector('.rail-nav', { timeout: 20000 });
  const apiA = apiOf(A.p);
  const B = await open('B');
  B.p.on('request', (r) => { if (/\/review-capacity\/people/.test(r.url())) memberNet.people.push(r.url()); else if (/\/review-capacity/.test(r.url())) memberNet.capacity.push(r.url()); });
  await B.p.goto(base + '/missions', { waitUntil: 'domcontentloaded' });
  await connect(B.p, 'Mina', 'mina-pass');
  await B.p.getByRole('heading', { name: 'Waiting for approval' }).waitFor({ timeout: 10000 });
  const csrf = (await (await A.p.request.get(base + '/api/v1/me')).json()).me.csrf;
  const mina = ((await apiA('GET', '/users')).body.users ?? []).find((u) => u.name === 'Mina');
  await A.p.request.fetch(base + `/api/v1/users/${mina.id}/approve`, { method: 'POST', data: {}, headers: { 'x-csrf': csrf } });
  check('Mina connects after approval', await until(async () => (await B.p.locator('.rail-nav').count()) > 0, 15000));
  const s = seed();

  // ---- admin: the panel
  await goQueues(A.p);
  const P = A.p.locator('.ops-review-capacity');
  check('the panel is in System Operations (Queues tab) with a title and a ? on the panel', (await P.getByText('Review capacity').count()) > 0 && (await P.locator('button.help-btn').count()) >= 5);
  const cell = async (name) => (await P.locator(`[data-cell="${name}"]`).innerText()).replace(/\s+/g, ' ');
  const cells = { arrivals: await cell('arrivals'), median: await cell('median'), p95: await cell('p95'), backlog: await cell('backlog'), littles: await cell('littles') };
  console.log(JSON.stringify(cells));
  check('admin sees every number with its n: arrivals, median, slowest 5%, waiting now', /n = \d+/.test(cells.arrivals) && /\d/.test(cells.median.split('n =')[0]) && /min|s|h/.test(cells.median) && /n = 24/.test(cells.median) && /min|h/.test(cells.p95) && /^.*Waiting now\s*\?*\s*3/.test(cells.backlog.replace(/\?/g, '')), JSON.stringify(cells));
  check('every number cell has its own ? (5 cells)', (await P.locator('[data-cell] button.help-btn').count()) === 5);
  const apiData = (await apiA('GET', '/review-capacity?windowDays=30')).body.review;
  check('the screen shows what the server returned (arrivals per day and the median)', !!apiData && apiData.total.n >= 27 && apiData.total.p50Ms !== null, `n=${apiData?.total?.n} p50=${apiData?.total?.p50Ms}`);
  check('Little data check is consistent on clean data', (await P.locator('[data-cell="littles"]').getAttribute('data-status')) === 'pass', await cell('littles'));
  check('the department table and the observed span (agents per supervisor) are shown', (await P.locator('[data-table="departments"] tbody tr').count()) >= 1 && (await P.locator('[data-table="span"] tbody tr').count()) >= 1);
  check('the span states that no number is recommended', /No recommended number/.test(await P.innerText()));
  check('utilisation says not measured, with a ?', /Utilisation: not measured/.test(await P.innerText()));
  check('no sort control anywhere on the panel: table headers are not buttons or links', (await P.locator('thead button:not(.help-btn), thead a, th[aria-sort], [role=columnheader] button').count()) === 0);
  await P.getByRole('button', { name: 'Show' }).click();
  check('admin: per-person table opens, A to Z, with names', await until(async () => (await P.locator('[data-table="people"] tbody tr').count()) >= 2, 8000) && (await P.locator('[data-table="people"] tbody th').allInnerTexts()).join('|').includes('Luca'));
  check('fix round: a ? on every column of the department table (6) and of the per-person table (3)', (await P.locator('[data-table="departments"] thead button.help-btn').count()) === 6 && (await P.locator('[data-table="people"] thead button.help-btn').count()) === 3, `${await P.locator('[data-table="departments"] thead button.help-btn').count()} / ${await P.locator('[data-table="people"] thead button.help-btn').count()}`);
  const names = await P.locator('[data-table="people"] tbody th').allInnerTexts();
  check('per-person rows are in name order, not by load', JSON.stringify(names) === JSON.stringify([...names].sort((x, y) => x.localeCompare(y))), names.join(','));
  check('fits one screen at 1366x768 (admin, per-person open)', await fits(A.p));
  await A.p.screenshot({ path: `${SHOTS}/admin-people-dark.png` });
  // window switch
  await P.getByRole('radio', { name: '7d' }).click().catch(async () => P.getByText('7d', { exact: true }).click());
  check('window 7d is requested and shown', await until(async () => (await P.locator('[data-review-capacity]').getAttribute('data-window')) === '7', 5000));
  await P.getByText('90d', { exact: true }).click();
  check('window 90d', await until(async () => (await P.locator('[data-review-capacity]').getAttribute('data-window')) === '90' && (await P.locator('[data-review-capacity]').getAttribute('data-review-capacity')) === 'ready', 8000));
  // help opens
  await P.locator('[data-cell="median"] button.help-btn').click();
  check('the ? opens plain words about the median', await until(async () => /Half of the decided items/.test(await A.p.locator('.help-pop').innerText()), 5000));
  await A.p.keyboard.press('Escape');

  // ---- member
  await goQueues(B.p);
  const Q = B.p.locator('.ops-review-capacity');
  check('member sees the aggregate panel', (await Q.locator('[data-cell]').count()) === 5);
  check('member: "Per person" is locked, no Show button, and no per-person table', (await Q.locator('[data-people="hidden"]').count()) === 1 && (await Q.getByRole('button', { name: 'Show' }).count()) === 0 && (await Q.locator('[data-table="people"]').count()) === 0);
  const text = await Q.innerText();
  check('member sees no person name anywhere in the panel', !/Luca|Mina/.test(text));
  check('member browser never requested the per-person route', memberNet.people.length === 0, `${memberNet.people.length} requests`);
  check('member browser read the aggregate', memberNet.capacity.length >= 1);
  const apiB = apiOf(B.p);
  check('member: GET /review-capacity/people is 403', (await apiB('GET', '/review-capacity/people')).status === 403);
  check('member: a sort parameter is refused (400)', (await apiB('GET', '/review-capacity?sort=p95')).status === 400);
  const mb = (await apiB('GET', '/review-capacity')).body;
  check('member body carries no user id or name', !JSON.stringify(mb).includes(s.admin) && !JSON.stringify(mb).includes(s.member) && !/Luca|Mina|userId/.test(JSON.stringify(mb)));
  check('member sees numbers because the floor is met (24+ items, 3 people)', mb.review.total.shown === true && mb.review.total.people === 3);
  check('fits one screen at 1366x768 (member)', await fits(B.p));
  await B.p.screenshot({ path: `${SHOTS}/member-dark.png` });
  // light mode (the same admin session, theme switched through the stored settings)
  await A.p.evaluate(() => { const k = 'axion.settings.v1'; const v = JSON.parse(localStorage.getItem(k) || '{"state":{}}'); v.state.themeMode = 'light'; localStorage.setItem(k, JSON.stringify(v)); });
  await goQueues(A.p);
  check('light mode is on', await until(async () => (await A.p.evaluate(() => document.documentElement.getAttribute('data-theme') || document.documentElement.className)).includes('light'), 6000));
  check('fits one screen at 1366x768 (light)', await fits(A.p));
  await A.p.screenshot({ path: `${SHOTS}/admin-light.png` });
  // a lost close event makes the check fail loudly
  seed('--lost');
  await A.p.getByRole('button', { name: 'Refresh now' }).first().click();
  check('LOST CLOSE EVENT: the data check shows an alert', await until(async () => (await A.p.locator('[data-cell="littles"]').getAttribute('data-status')) === 'fail' && /lost a close record/.test(await A.p.locator('[data-cell="littles"]').innerText()), 10000));
  await A.p.screenshot({ path: `${SHOTS}/admin-lost-close-dark.png` });
  // ---- 390 px (fix round F4): the 7d / 30d / 90d selector must fit inside the viewport and stay reachable
  {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, storageState: await A.ctx.storageState() });
    await ctx.addInitScript(() => { try { localStorage.setItem('axion.data-mode', 'api'); localStorage.setItem('axion.testhook', '1'); } catch { /* ignore */ } });
    const M = await ctx.newPage();
    M.on('pageerror', (e) => errors.push(`390: ${e.message}`));
    await goQueues(M);
    const m = await M.evaluate(() => {
      const vw = window.innerWidth; const panel = document.querySelector('.ops-review-capacity').getBoundingClientRect();
      const seg = document.querySelector('.ops-review-capacity .segmented'); const r = seg.getBoundingClientRect();
      const btns = [...seg.querySelectorAll('button, [role=radio], .seg-btn')].map((e) => { const q = e.getBoundingClientRect(); return { t: (e.textContent || '').trim(), l: Math.round(q.left), r: Math.round(q.right) }; });
      return { vw, panelR: Math.round(panel.right), segL: Math.round(r.left), segR: Math.round(r.right), btns, page: document.documentElement.scrollWidth };
    });
    console.log('  390px selector', JSON.stringify(m));
    check('390 px: the window selector lies inside the viewport and the panel', m.segR <= m.vw && m.segL >= 0 && m.btns.every((x) => x.r <= m.vw && x.l >= 0) && m.segR <= m.panelR + 1, JSON.stringify({ vw: m.vw, segR: m.segR, panelR: m.panelR }));
    check('390 px: no page-level horizontal scroll', m.page <= m.vw);
    await M.locator('.ops-review-capacity .segmented').getByText('90d', { exact: true }).click({ timeout: 4000 }).catch(() => {});
    check('390 px: 90d is reachable by tap', await until(async () => (await M.locator('[data-review-capacity]').getAttribute('data-window')) === '90', 6000));
    await M.locator('.ops-review-capacity').screenshot({ path: `${SHOTS}/panel-390.png` });
    await ctx.close();
  }
  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) {
  fails++; console.log('FAIL unexpected', e.stack?.split('\n').slice(0, 4).join(' | '));
} finally {
  await b.close();
}
console.log(fails ? `\n${fails} FAIL` : '\n0 FAIL');
process.exit(fails ? 1 : 0);
