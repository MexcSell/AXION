// c42 (Phase 2, O2), api mode: the typed delegation brief is visible on a delegation.
// 1. staffing a real mission makes the simulator attach valid briefs (depth <= 3, acceptance, subset of the parent);
// 2. a demo task has no brief: its drawer says "No brief (legacy)";
// 3. Delegate / reassign with a goal, an acceptance line and capability chips records a root brief; the drawer then shows
//    the goal, the acceptance checklist, tier-coloured capability chips, the deadline and the chain breadcrumb;
// 4. the server refuses a capability outside the delegator's scope (403 naming it) and an empty acceptance list (400).
// Run through scripts/api-e2e.sh (lane ports via E2E_API_PORT/E2E_WEB_PORT). Condition waits only (no networkidle).
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const base = process.env.BASE || 'http://127.0.0.1:5193';
const SHOTS = process.env.SHOTS || `/tmp/axion-api-c42-${new URL(base).port}`;
mkdirSync(SHOTS, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.PW_CHROME || '/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome' });
const results = [], errors = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); console.log(results[results.length - 1]); };
const until = async (f, ms = 10000, step = 150) => { const t0 = Date.now(); for (;;) { try { if (await f()) return true; } catch { /* retry */ } if (Date.now() - t0 > ms) return false; await new Promise((r) => setTimeout(r, step)); } };
const ctx = await b.newContext({ viewport: { width: 1600, height: 940 } });
await ctx.addInitScript(() => { try { localStorage.setItem('axion.data-mode', 'api'); localStorage.setItem('axion.testhook', '1'); localStorage.setItem('axion.settings.v1', JSON.stringify({ state: { themeMode: 'dark' }, version: 0 })); } catch { /* ignore */ } });
const p = await ctx.newPage();
p.on('pageerror', (e) => errors.push(e.message));
p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_CONNECTION|ERR_INTERNET_DISCONNECTED|502|503|504|EventSource/.test(m.text())) errors.push(`console: ${m.text()}`); });
let csrf = '', k = 0;
const call = async (method, path, data, headers = {}) => {
  if (!csrf && method !== 'GET') csrf = (await (await p.request.get(base + '/api/v1/me')).json()).me.csrf;
  const r = await p.request.fetch(base + '/api/v1' + path, { method, data, headers: { ...(method !== 'GET' ? { 'x-csrf': csrf } : {}), ...headers } });
  return { status: r.status(), body: await r.json().catch(() => ({})) };
};
const key = () => ({ 'idempotency-key': `c42-${Date.now()}-${k++}` });
try {
  await p.goto(base + '/missions', { waitUntil: 'domcontentloaded' });
  await p.getByRole('heading', { name: 'Connect' }).waitFor({ timeout: 15000 });
  await p.getByLabel('Name').fill('Luca');
  await p.getByLabel('Password', { exact: true }).fill('secret-1');
  await p.getByRole('button', { name: /Connect/ }).click();
  check('connected and live', await until(async () => (await p.locator('.conn-badge').getAttribute('data-conn')) === 'live', 15000));

  // 1. simulator briefs on a real mission
  const mid = (await call('POST', '/missions', { text: 'Build a website landing page for the shop.', files: [], shared: false }, key())).body.mission?.id;
  check('a real mission was created', !!mid, mid);
  await until(async () => (await call('GET', `/missions/${mid}`)).body.mission?.staffing?.stage === 'working', 60000, 400);
  const list = (await call('GET', `/missions/${mid}/delegation-briefs`)).body;
  const bs = list.briefs ?? [];
  check('staffing attached briefs to its delegations (simulator keeps working)', bs.length >= 2, `${bs.length} briefs`);
  check('every simulator brief has acceptance criteria, depth <= max and a subset of its parent', bs.every((x) => x.brief.acceptance.length > 0 && x.depth <= list.maxDepth && (!x.parentBriefId || x.brief.capabilities.every((c) => bs.find((y) => y.id === x.parentBriefId).brief.capabilities.some((pc) => pc.kind === c.kind)))));

  // 2. + 3. a demo task: legacy, then a brief through the reassign dialog
  const t126 = (await call('GET', '/missions/M-126/tasks')).body;
  const hier = (await call('GET', '/missions/M-126/hierarchy')).body;
  const movable = t126.find((t) => t.state !== 'running' && t.state !== 'passed' && t.state !== 'canceled');
  const newOwner = hier.nodes.find((n) => n.agentId !== 'gm' && n.agentId !== movable?.owner);
  check('M-126 has a movable task and another agent', !!movable && !!newOwner, `${movable?.id} -> ${newOwner?.agentId}`);
  const openTask = async () => {
    await p.goto(`${base}/missions/M-126?tab=task-flow`, { waitUntil: 'domcontentloaded' });
    const el = p.locator(`[aria-label^="${movable.id} "]`).first();
    await el.waitFor({ timeout: 10000 });
    await el.click();
    await p.locator('[role="dialog"]').first().waitFor({ timeout: 5000 });
  };
  await openTask();
  check('a delegation without a brief says "No brief (legacy)"', await until(async () => (await p.locator('[data-testid="no-brief"]').count()) === 1, 8000));
  await p.screenshot({ path: `${SHOTS}/c42-legacy.png` });
  await p.locator('[role="dialog"]').getByRole('button', { name: 'Reassign' }).click();
  const name = (await call('GET', '/agents')).body.agents.find((a) => a.id === newOwner.agentId).name;
  await p.getByRole('button', { name: new RegExp(`^.*${name}`) }).first().click();
  await p.getByPlaceholder(/needs browser specialist/).fill('c42 e2e');
  await p.getByTestId('brief-form').waitFor({ timeout: 5000 });
  await p.getByLabel('Goal').fill('Rework the hero section');
  await p.getByLabel('Acceptance criteria').fill('Hero fits on one screen\nContrast passes AA');
  await until(async () => (await p.locator('.dbrief-pick button:not([disabled])').count()) > 2, 8000);
  await p.locator('.dbrief-pick button', { hasText: 'summarize' }).first().click();
  await p.locator('.dbrief-pick button', { hasText: 'send_message' }).first().click();
  const dl = new Date(Date.now() + 2 * 86_400_000); dl.setMinutes(0, 0, 0);
  await p.getByLabel('Deadline').fill(new Date(dl.getTime() - dl.getTimezoneOffset() * 60000).toISOString().slice(0, 16));
  await p.screenshot({ path: `${SHOTS}/c42-dialog.png` });
  await p.getByRole('button', { name: 'Submit Reassignment' }).click();
  check('Reassign with a brief records it on the server', await until(async () => ((await call('GET', '/missions/M-126/delegation-briefs')).body.briefs ?? []).some((x) => x.taskId === movable.id), 8000));
  await openTask();
  check('the task drawer shows the brief card', await until(async () => (await p.locator('[data-testid="delegation-brief"]').count()) === 1, 8000));
  const card = p.locator('[data-testid="delegation-brief"]');
  const txt = await card.innerText();
  check('the card shows goal, acceptance checklist, capability chips with tiers, deadline and chain', /Rework the hero section/.test(txt) && /Hero fits on one screen/.test(txt) && /Contrast passes AA/.test(txt) && /read · R0/.test(txt) && /send_message · R2/.test(txt) && /depth 1/i.test(txt) && !/no deadline/.test(txt), txt.replace(/\s+/g, ' ').slice(0, 160));
  check('the acceptance list has 2 items and the card has a ? help', (await card.locator('.dbrief-accept li').count()) === 2 && (await card.locator('button[aria-label*="elp"], [data-help]').count()) >= 1);
  check('the card shows the effective scope', /effective now/i.test(await card.locator('[data-testid="brief-effective"]').innerText()) && /read/.test(await card.locator('[data-testid="brief-effective"]').innerText()));
  await p.screenshot({ path: `${SHOTS}/c42-brief.png` });

  // 4. the server's rules
  const inst = hier.nodes.filter((n) => n.agentId !== 'gm');
  const mk = (caps, extra = {}) => ({ goal: 'Check the rules', acceptance: ['It is checked'], capabilities: caps.map((kind) => ({ kind })), escalation: 'Ask the owner', ...extra });
  const rootRes = await call('POST', '/missions/M-126/delegation-briefs', { toInstanceId: inst[0].instanceId, brief: mk(['read']) }, key());
  check('a root brief for another agent is recorded (201)', rootRes.status === 201, rootRes.body.message ?? '');
  const sup = await call('POST', '/missions/M-126/delegation-briefs', { fromInstanceId: inst[0].instanceId, toInstanceId: inst[1].instanceId, brief: mk(['read', 'release']) }, key());
  check('a capability outside the delegator\'s scope is 403 and names it', sup.status === 403 && /release/.test(sup.body.message), sup.body.message);
  const noacc = await call('POST', '/missions/M-126/delegation-briefs', { toInstanceId: inst[0].instanceId, brief: mk(['read'], { acceptance: [] }) }, key());
  check('a brief with no acceptance criteria is 400', noacc.status === 400, noacc.body.message);
} catch (e) { check('script ran to the end', false, String(e).split('\n')[0]); }
console.log(errors.length ? 'PAGE ERRORS:\n' + errors.join('\n') : 'no page errors');
console.log(`${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
writeFileSync(`${SHOTS}/api-c42.txt`, results.join('\n') + '\n');
await b.close();
process.exit(results.some((r) => r.startsWith('FAIL')) || errors.length ? 1 : 0);
