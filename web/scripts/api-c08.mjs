// Improvement cycle 8 (code health), api mode: the Agent Edit dialog after a 409 when TWO catalog reloads overlap.
// Root cause of the c01/c02/c04 one-off "after the 409 the next Save succeeds" failure: updateAgent() awaited loadAgents(),
// but a newer load (started by another admin's agent.updated event) made the older one return early without applying
// anything, so the dialog adopted a stale rowVersion and its next Save answered 409 again.
// This check forces that order with route interception: no timing luck, no fixed sleeps.
// Run: ./scripts/api-e2e.sh api-c08.mjs
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
const base = process.env.BASE || 'http://127.0.0.1:5193';
const b = await chromium.launch({ executablePath: process.env.PW_CHROME || '/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome' });
const results = [];
const errors = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); console.log(results[results.length - 1]); };
const until = async (f, ms = 10000, step = 100) => { const t0 = Date.now(); for (;;) { try { if (await f()) return true; } catch { /* retry */ } if (Date.now() - t0 > ms) return false; await new Promise((r) => setTimeout(r, step)); } };
let ctx;
try {
  ctx = await b.newContext({ viewport: { width: 1600, height: 940 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('axion.data-mode', 'api'); localStorage.setItem('axion.testhook', '1'); } catch { /* ignore */ } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_CONNECTION|ERR_INTERNET_DISCONNECTED|502|503|504|EventSource|409/.test(m.text())) errors.push(`console: ${m.text()}`); });
  await p.goto(base + '/missions', { waitUntil: 'domcontentloaded' });
  await p.getByRole('heading', { name: 'Connect' }).waitFor({ timeout: 15000 });
  await p.getByLabel('Name').fill('Luca');
  await p.getByLabel('Password', { exact: true }).fill('secret-1');
  await p.getByRole('button', { name: /Connect/ }).click();
  await p.waitForSelector('.rail-nav', { timeout: 15000 });
  check('connected and live', await until(async () => (await p.locator('.conn-badge').getAttribute('data-conn')) === 'live', 15000));
  let csrf = '';
  const api = async (method, path, data, headers = {}) => {
    if (!csrf && method !== 'GET') csrf = (await (await p.request.get(base + '/api/v1/me')).json()).me.csrf;
    const r = await p.request.fetch(base + '/api/v1' + path, { method, data, headers: { ...(method !== 'GET' ? { 'x-csrf': csrf } : {}), ...headers } });
    return { status: r.status(), body: await r.json().catch(() => ({})) };
  };
  await p.goto(`${base}/agents/designer-01`, { waitUntil: 'domcontentloaded' });
  await p.getByRole('button', { name: 'Edit', exact: true }).click();
  const dlg = p.locator('[role="dialog"]').first();
  const sk = dlg.getByLabel('Skills', { exact: true });
  await sk.waitFor({ timeout: 10000 });
  const cur = (await api('GET', '/agents/designer-01')).body.agent;
  const vCount = cur.versions.length;
  await sk.fill(`${await sk.inputValue()}, c08-skill`);

  // every GET /agents of the page (the catalog reload) is fetched at once but handed to the page only when released
  const held = [];
  await p.route(/\/api\/v1\/agents(\?.*)?$/, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const real = await route.fetch();
    await new Promise((release) => held.push({ release, route, real }));
    await route.fulfill({ response: real });
  });
  const heldCount = (n) => until(async () => held.length >= n, 8000);

  // reload #0: another administrator edits the agent; the agent.updated event makes this page reload the catalog
  const o1 = await api('PATCH', '/agents/designer-01', { description: 'c08 other administrator, first edit' }, { 'if-match': String(cur.rowVersion) });
  check('another administrator changed the agent (event reload #0 is held)', o1.status === 200 && await heldCount(1), `PATCH ${o1.status}`);
  // Save with the stale version: 409, and updateAgent starts its own reload (#1, held)
  await dlg.getByRole('button', { name: 'Save' }).click();
  check('the stale Save started its own catalog reload (#1 is held)', await heldCount(2));
  // reload #2: a second change by the other administrator starts a NEWER reload while #1 is still waiting
  const o2 = await api('PATCH', '/agents/designer-01', { description: 'c08 other administrator, second edit' }, { 'if-match': String(o1.body.agent.rowVersion) });
  check('a newer reload (#2) started while #1 was still pending', o2.status === 200 && await heldCount(3));
  const latest = o2.body.agent.rowVersion;
  // answer #1 first, then the newer #2 and the old #0
  held[1].release();
  await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))); // let the page process #1 (a frame, not a sleep)
  held[2].release();
  held[0].release();
  check('the dialog says someone changed the agent', await until(async () => (await dlg.getByText('Someone changed this agent meanwhile').count()) > 0, 8000));
  await p.unroute(/\/api\/v1\/agents(\?.*)?$/);
  // the next Save must carry the NEWEST version (the second edit), so it is accepted and creates the next version
  await dlg.getByRole('button', { name: 'Save' }).click();
  check('the next Save succeeds with the newest version (dialog closes, next version created)', await until(async () => (await dlg.count()) === 0 && (await api('GET', '/agents/designer-01')).body.agent.versions.length === vCount + 1, 10000), `server rowVersion before Save ${latest}`);
} catch (e) { check('script ran to the end', false, String(e).split('\n')[0]); }
console.log(errors.length ? 'PAGE ERRORS:\n' + errors.join('\n') : 'no page errors');
console.log(`${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
try { writeFileSync('/tmp/axion-api-e2e-c08.txt', results.join('\n') + '\n'); } catch { /* ignore */ }
await b.close();
process.exit(results.some((r) => r.startsWith('FAIL')) || errors.length ? 1 : 0);
