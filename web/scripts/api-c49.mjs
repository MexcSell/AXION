// Improvement cycle 49 (Phase 2 · P5b), api mode: the audit anchor tile on System Operations (Services).
// Admin A: before any checkpoint the tile says "not verifiable"; after the operator CLI (npm run audit:anchor) it says Matches;
// after the newest audit row is deleted behind the app's back (trigger switched off, as a database-level tamperer would) it says
// "rows were removed". The API shows a member 403 and never returns the key, the file path or a hash. 1366x768 fit is measured.
// Run through scripts/api-e2e.sh (lane ports). Condition waits only. Reads the lane's own server/.env (E2E DB must be axion_e2e<N>).
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const base = process.env.BASE || 'http://127.0.0.1:5193';
const SHOTS = process.env.SHOTS || `/tmp/axion-api-c49-${new URL(base).port}`;
const DOC_SHOT = process.env.DOC_SHOT_C49;
mkdirSync(SHOTS, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.PW_CHROME || '/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome' });
const results = [];
const errors = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); console.log(results[results.length - 1]); };
const until = async (f, ms = 10000, step = 150) => { const t0 = Date.now(); for (;;) { try { if (await f()) return true; } catch { /* retry */ } if (Date.now() - t0 > ms) return false; await new Promise((r) => setTimeout(r, step)); } };
const browser = async (label, vw = Number(process.env.VW || 1600), vh = Number(process.env.VH || 940)) => {
  const ctx = await b.newContext({ viewport: { width: vw, height: vh } });
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
let k = 0;
const key = () => ({ 'idempotency-key': `c49-${Date.now()}-${k++}` });
const hours = (h) => new Date(Date.now() + h * 3600_000).toISOString();

const envFile = Object.fromEntries(readFileSync(new URL('../../server/.env', import.meta.url), 'utf8').split('\n').filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const E2E = envFile.E2E_DATABASE_URL;
if (!/\/axion_e2e\d*$/.test(E2E || '')) throw new Error('E2E_DATABASE_URL must be an axion_e2e<N> database');
const KEY = envFile.AUDIT_ANCHOR_KEY, FILE = envFile.AUDIT_ANCHOR_FILE;
if (!KEY || KEY.length < 32 || !FILE) throw new Error('the lane server/.env needs AUDIT_ANCHOR_KEY and AUDIT_ANCHOR_FILE');
rmSync(FILE, { force: true });
const cli = (script, args = []) => { try { return { code: 0, out: execFileSync('node', ['--import', 'tsx', `src/cli/${script}.ts`, ...args], { cwd: new URL('../../server/', import.meta.url).pathname, env: { ...process.env, DATABASE_URL: E2E, DATABASE_SCHEMA: '', AUDIT_ANCHOR_KEY: KEY, AUDIT_ANCHOR_FILE: FILE, LOG: '0' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }; } catch (e) { return { code: e.status, out: String(e.stdout) + String(e.stderr) }; } };
const pg = createRequire(new URL('../../server/package.json', import.meta.url))('pg');
const tile = (p) => p.locator('[data-testid="audit-anchor"]');
const status = async (p) => (await tile(p).count()) ? await tile(p).getAttribute('data-status') : null;
const reload = async (p) => { await p.goto(base + '/operations?tab=Services', { waitUntil: 'domcontentloaded' }); };
let A, C;
try {
  A = await browser('A', Number(process.env.VW || 1366), Number(process.env.VH || 768));
  await A.p.goto(base + '/missions', { waitUntil: 'domcontentloaded' });
  await connect(A.p, 'Luca', 'secret-1');
  check('A (first user = administrator) is connected and live', await live(A.p));
  const apiA = apiOf(A.p);
  C = await browser('C');
  await C.p.goto(base + '/missions', { waitUntil: 'domcontentloaded' });
  await connect(C.p, 'Mina', 'mina-pass');
  await C.p.getByRole('heading', { name: 'Waiting for approval' }).waitFor({ timeout: 10000 });
  const u = ((await apiA('GET', '/users')).body.users ?? []).find((x) => x.name === 'Mina');
  await apiA('POST', `/users/${u.id}/approve`, {});
  await C.p.locator('.rail-nav').first().waitFor({ timeout: 15000 });
  const apiC = apiOf(C.p);

  await reload(A.p);
  check('before any checkpoint the tile says "not verifiable" (anchor_missing), not a pass',
    await until(async () => (await status(A.p)) === 'anchor_missing', 12000) && /Not verifiable/.test(await tile(A.p).innerText()), await tile(A.p).innerText().catch(() => '-'));
  check('the ? help is on the tile and opens', await (async () => { await tile(A.p).locator('button[aria-label*="elp" i]').first().click(); return until(async () => (await A.p.getByText(/signed checkpoint of the newest audit row/).count()) > 0, 5000); })());
  await A.p.keyboard.press('Escape');

  const w = cli('audit-anchor');
  check('the operator CLI writes a checkpoint (exit 0, no key in its output)', w.code === 0 && !w.out.includes(KEY), w.out.trim());
  await reload(A.p);
  check('the tile now says Matches (ok)', await until(async () => (await status(A.p)) === 'ok', 12000) && /Matches/.test(await tile(A.p).innerText()), await tile(A.p).innerText().catch(() => '-'));
  const v = cli('audit-verify');
  check('audit:verify exits 0 with the anchor', v.code === 0 && /audit anchor OK/.test(v.out), v.out.trim().split('\n').pop());
  await A.p.screenshot({ path: `${SHOTS}/improve-c49-ok.png` });
  if (DOC_SHOT) await A.p.screenshot({ path: DOC_SHOT });
  const fit = await A.p.evaluate(() => { const m = document.querySelector('main'); return { sh: m.scrollHeight, ch: m.clientHeight, doc: document.documentElement.scrollHeight, win: window.innerHeight, w: window.innerWidth, sw: document.documentElement.scrollWidth }; });
  check(`1366x768 fit: the page does not scroll (document) and has no horizontal overflow`, fit.doc <= fit.win + 2 && fit.sw <= fit.w + 1, JSON.stringify(fit));
  const tr = await tile(A.p).boundingBox();
  check('the tile is fully inside the viewport (visible without scrolling)', !!tr && tr.y >= 0 && tr.y + tr.height <= 768, JSON.stringify(tr));

  const api = await apiA('GET', '/operations/anchors');
  const text = JSON.stringify(api.body);
  check('API: admin gets status ok for t-1; no key, file path or 64-hex hash in the response', api.status === 200 && api.body.tenants?.[0]?.status === 'ok' && !text.includes(KEY) && !text.includes(FILE) && !text.includes('audit-anchors') && !/[0-9a-f]{64}/.test(text), text.slice(0, 200));
  check('API: a member gets 403', (await apiC('GET', '/operations/anchors')).status === 403);

  // the tamper: delete the newest audit row with the append-only trigger off (what a database-level attacker can do)
  const c = new pg.Client({ connectionString: E2E }); await c.connect();
  await c.query('alter table audit_events disable trigger user');
  const del = await c.query(`delete from audit_events where tenant_id='t-1' and seq=(select max(seq) from audit_events where tenant_id='t-1')`);
  await c.query('alter table audit_events enable trigger user'); await c.end();
  check('the newest audit row was deleted behind the app', del.rowCount === 1);
  await A.p.getByRole('button', { name: 'Refresh now' }).click();
  check('the tile turns to "rows were removed" (truncated) after Refresh', await until(async () => (await status(A.p)) === 'truncated', 12000) && /Rows were removed/.test(await tile(A.p).innerText()), await tile(A.p).innerText().catch(() => '-'));
  const v2 = cli('audit-verify');
  check('audit:verify exits non-zero and says TRUNCATED', v2.code === 1 && /TRUNCATED/.test(v2.out), v2.out.trim().split('\n').pop());
  const w2 = cli('audit-anchor');
  check('audit:anchor refuses to extend the tampered state (exit 1, nothing written)', w2.code === 1 && /NOT written/.test(w2.out), w2.out.trim());
  await A.p.screenshot({ path: `${SHOTS}/improve-c49-truncated.png` });
  if (process.env.DOC_SHOT_C49_BAD) await A.p.screenshot({ path: process.env.DOC_SHOT_C49_BAD });
} catch (e) { check('script ran to the end', false, String(e).split('\n')[0]); }
for (const [Y, l] of [[A, 'A'], [C, 'C']]) await Y?.p.screenshot({ path: `${SHOTS}/improve-c49-end-${l}.png` }).catch(() => {});
console.log(errors.length ? 'PAGE ERRORS:\n' + errors.join('\n') : 'no page errors');
console.log(`${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
writeFileSync(`${SHOTS}/api-c49.txt`, results.join('\n') + '\n');
await b.close();
rmSync(FILE, { force: true });
process.exit(results.some((r) => r.startsWith('FAIL')) || errors.length ? 1 : 0);
