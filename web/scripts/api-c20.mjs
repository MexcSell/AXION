// Improvement cycle 20 (theme A5), api mode: org coverage facts. Run through scripts/api-e2e.sh with DATA_MODE=api:
//   ./scripts/api-e2e.sh api-c20.mjs   (sets DATA_MODE=api itself)
// Checks: the coverage card on Agents › Policies shows the active revision's facts and fits one screen; a stored proposal that
// drops a line shows "leaves role Writer uncovered" in its dry run; the History view shows the facts per revision;
// demo-mode pages are covered by fit-check / verify-all.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
process.env.DATA_MODE ||= 'api'; // _session.mjs reads it at load: this script is api mode only, whichever way api-e2e.sh starts it
const { signIn, settle } = await import('./_session.mjs');
const base = process.env.BASE || 'http://127.0.0.1:5193';
const SHOTS = process.env.SHOTS || '/tmp/axion-api-c20';
mkdirSync(SHOTS, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.PW_CHROME || '/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome' });
let bad = 0;
const check = (name, ok, extra = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };
const until = async (f, ms = 10000, step = 150) => { const t0 = Date.now(); for (;;) { try { if (await f()) return true; } catch { /* retry */ } if (Date.now() - t0 > ms) return false; await new Promise((r) => setTimeout(r, step)); } };
const errors = [];
let page;
try {
  const ctx = await b.newContext({ viewport: { width: 1600, height: 940 } });
  await signIn(ctx);
  const p = await ctx.newPage(); page = p;
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|EventSource|ERR_/.test(m.text())) errors.push(m.text()); });
  const j = async (method, path, data, headers = {}) => {
    const csrf = method === 'GET' ? '' : (await (await p.request.get(base + '/api/v1/me')).json()).me.csrf;
    const r = await p.request.fetch(base + '/api/v1' + path, { method, data, headers: { ...(csrf ? { 'x-csrf': csrf } : {}), ...headers } });
    return { status: r.status(), body: await r.json().catch(() => ({})) };
  };
  const fits = (pg) => pg.evaluate(() => { const m = document.querySelector('main'); return { over: m.scrollHeight - m.clientHeight, side: document.documentElement.scrollWidth - innerWidth }; });

  // ---- coverage card on Agents › Policies
  await p.goto(base + '/operations?tab=agents&sub=policies', { waitUntil: 'domcontentloaded' });
  await settle(p);
  const card = p.locator('[data-coverage-card]');
  check('c20 the Org Coverage card is on Agents › Policies', await until(async () => (await card.locator('[data-cov="roles"]').count()) > 0));
  const roles = await card.locator('[data-cov="roles"]').first().innerText().catch(() => '');
  check('c20 the seeded company covers all 18 catalog roles', /18\/18 roles covered/.test(roles), roles);
  check('c20 every fact line is shown (5 facts)', (await card.locator('[data-cov-fact]').count()) === 5);
  check('c20 span and depth are shown as numbers', /span \d+/.test(await card.locator('[data-cov="span"]').innerText()) && /depth \d+/.test(await card.locator('[data-cov="depth"]').innerText()));
  const f1 = await fits(p);
  check('c20 Policies fits one screen with the card (no page scroll, no sideways scroll)', f1.over <= 2 && f1.side <= 0, JSON.stringify(f1));
  await p.screenshot({ path: `${SHOTS}/c20-policies-coverage.png` });

  // ---- a proposal that drops a line: its dry run says the role is left uncovered
  const g = (await j('GET', '/organization/graph')).body;
  const drop = g.edges.find((e) => e.subordinateId === 'writer-01');
  const edges = g.edges.filter((e) => e !== drop);
  const made = await j('POST', '/organization/proposals', { title: 'Drop the writer line', why: 'coverage check', baseline: 'No change: keep the current chart.', expectedCost: 'No added cost is expected here.', baseRevision: g.revision.seq, edges }, { 'idempotency-key': 'c20-' + Date.now() });
  check('c20 the proposal is stored (dry-run errors do not stop storing)', made.status === 201, String(made.status));
  await p.goto(base + '/operations?tab=agents&sub=proposals', { waitUntil: 'domcontentloaded' });
  await settle(p);
  const pc = p.locator(`[data-proposal="${made.body.proposal?.id}"]`);
  check('c20 the proposal card shows "leaves role Writer uncovered"', await until(async () => /leaves role Writer uncovered/.test(await pc.innerText())));
  check('c20 the coverage change is not an error: it is its own line', (await pc.locator('[data-cov-change="ROLE_UNCOVERED"]').count()) === 1);
  const f2 = await fits(p);
  check('c20 Proposals fits one screen', f2.over <= 2 && f2.side <= 0, JSON.stringify(f2));
  await p.screenshot({ path: `${SHOTS}/c20-proposal-coverage.png` });

  // ---- History: the facts per revision
  await p.getByRole('radio', { name: 'History', exact: true }).click();
  const hist = p.locator('[data-org-history] [data-coverage]');
  check('c20 History shows the facts of the selected revision', await until(async () => (await hist.count()) === 1 && /roles covered/.test(await hist.innerText())));
  const txt = await p.locator('[data-org-history]').innerText();
  check('c20 History shows no percentages or estimates', !/\d+\s*%/.test(txt));
  const f3 = await fits(p);
  check('c20 History fits one screen', f3.over <= 2 && f3.side <= 0, JSON.stringify(f3));
  await p.screenshot({ path: `${SHOTS}/c20-history-coverage.png` });

  // ---- the server endpoint agrees with the card
  const cov = await j('GET', '/organization/coverage');
  check('c20 GET /organization/coverage returns the active revision', cov.status === 200 && cov.body.revision === g.revision.seq && cov.body.coverage.roles.length === 18);
  check('c20 no uncaught page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) { bad++; console.log('FAIL script error — ' + (e.stack || e.message)); if (page) { await page.screenshot({ path: `${SHOTS}/c20-failure.png` }).catch(() => {}); console.log('url: ' + page.url() + ' | card: ' + (await page.locator('[data-coverage-card]').innerText().catch(() => 'none')).replace(/\s+/g, ' ').slice(0, 200)); }
  if (errors.length) console.log('page errors: ' + errors.slice(0, 5).join(' | ')); }
await b.close();
console.log(bad ? `${bad} check(s) failed` : 'ALL PASS');
process.exit(bad ? 1 : 0);
