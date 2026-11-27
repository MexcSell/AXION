// api mode: the loading (and failed-load) texts of AI Chat, Chat usage, Site grants, Job records and the task drawer's
// delegation brief are inside the shared LiveStatus live region, so a screen reader hears them.
// Each data request is held open (loading: role=status with the loading text) or answered with a 500 (error: role=alert).
// Run: ./scripts/api-e2e.sh "DATA_MODE=api node scripts/api-livestatus-loading.mjs"  (the base URL comes from _base.mjs)
import { chromium } from 'playwright';
import { signIn, settle } from './_session.mjs';
import { resolveBase } from './_base.mjs';
const base = resolveBase();
const b = await chromium.launch();
let bad = 0;
const check = (name, ok, extra = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };
const until = async (f, ms = 10000, step = 150) => { const t0 = Date.now(); for (;;) { try { if (await f()) return true; } catch { /* retry */ } if (Date.now() - t0 > ms) return false; await new Promise((r) => setTimeout(r, step)); } };
const errors = [];
const ctx = await b.newContext({ viewport: { width: 1366, height: 768 } });
await ctx.addInitScript(() => { try { localStorage.setItem('axion.data-mode', 'api'); localStorage.setItem('axion.testhook', '1'); localStorage.setItem('axion.settings.v1', JSON.stringify({ state: { themeMode: 'dark', motion: 'reduced' }, version: 0 })); } catch { /* ignore */ } });
await signIn(ctx, 'Luca');
const p = await ctx.newPage();
p.on('pageerror', (e) => errors.push(e.message));

// hold (mode 'slow') or fail (mode 'fail') the GET requests matching re; returns a release function
const gate = async (re, mode) => {
  let release; const open = new Promise((r) => { release = r; });
  const h = async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    if (mode === 'slow') { await open; return route.continue().catch(() => {}); }
    return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'internal', message: 'mocked failure' } }) });
  };
  await p.route(re, h);
  return async () => { release(); await p.unroute(re, h).catch(() => {}); };
};
const texts = (scope, role) => scope.locator(`[role=${role}]`).evaluateAll((els) => els.map((e) => (e.textContent || '').replace(/\s+/g, ' ').trim()));
const live = async (name, scope, role, re) => {
  let seen = [];
  const ok = await until(async () => { seen = await texts(scope, role); return seen.some((t) => re.test(t)); }, 15000);
  check(name, ok, ok ? '' : `saw: ${seen.join(' | ').slice(0, 160)}`);
};
const goto = async (path) => { await p.goto(base + path, { waitUntil: 'domcontentloaded' }); await settle(p); };
const panel = (title) => p.locator('.panel', { has: p.locator('.panel-title', { hasText: title }) });

try {
  // (a) Settings > AI Chat: the route panel while /chat-model is held
  let rel = await gate(/\/api\/v1\/chat-model(\?|$)/, 'slow');
  await goto('/settings?tab=ai-chat');
  await live('AI Chat: "Loading…" is in role=status', panel('AI Chat'), 'status', /^Loading…$/);
  await rel();
  // (a) Chat usage: loading, then failed
  rel = await gate(/\/api\/v1\/chat-model\/usage/, 'slow');
  await goto('/settings?tab=ai-chat');
  await live('Chat usage: "Loading…" is in role=status', panel('Chat usage'), 'status', /^Loading…$/);
  await rel();
  rel = await gate(/\/api\/v1\/chat-model\/usage/, 'fail');
  await goto('/settings?tab=ai-chat');
  await live('Chat usage: the failed-load text is in role=alert', panel('Chat usage'), 'alert', /\S/);
  await rel();

  // (b) Settings > Browser: site grants
  rel = await gate(/\/api\/v1\/site-grants(\?|$)/, 'slow');
  await goto('/settings?tab=browser');
  await live('Site grants: "Loading grants…" is in role=status', p.locator('[data-site-grants]'), 'status', /^Loading grants…$/);
  await rel();

  // (c) Operations > Queues: job records, loading then failed
  rel = await gate(/\/api\/v1\/operations\/queues/, 'slow');
  await goto('/operations?tab=queues');
  await live('Job records: "Loading…" is in role=status', p.locator('.ops-job-records'), 'status', /^Loading…$/);
  await rel();
  rel = await gate(/\/api\/v1\/operations\/queues/, 'fail');
  await goto('/operations?tab=queues');
  await live('Job records: the failed-load text is in role=alert', p.locator('.ops-job-records'), 'alert', /\S/);
  await rel();

  // (d) task drawer: the delegation brief while /delegation-briefs is held; it stays inline
  const csrfFree = async (path) => (await (await p.request.get(base + '/api/v1' + path)).json().catch(() => ({})));
  const ms = (await csrfFree('/missions')).missions ?? [];
  let target = null;
  for (const m of ms) { const ts = await csrfFree(`/missions/${m.id}/tasks`); if (Array.isArray(ts) && ts.length) { target = { mission: m.id, task: ts[0].id }; break; } }
  check('a mission with a task exists', !!target);
  if (target) {
    await goto(`/missions/${target.mission}?tab=task-flow`);
    rel = await gate(/\/api\/v1\/missions\/[^/]+\/delegation-briefs/, 'slow');
    await p.locator(`[aria-label^="${target.task} "]`).first().click({ timeout: 15000 });
    const dlg = p.locator('[role="dialog"]').first();
    await dlg.waitFor({ timeout: 8000 });
    await live('Task drawer: the brief "Loading…" is in role=status', dlg, 'status', /^Loading…$/);
    const disp = await dlg.locator('[role=status]', { hasText: /^Loading…$/ }).first().evaluate((e) => getComputedStyle(e).display).catch(() => '');
    check('Task drawer: the brief loading text stays inline', disp === 'inline', disp);
    await rel();
  }
  check('no page errors', errors.length === 0, errors.join(' | ').slice(0, 200));
} catch (e) { check('script ran to the end', false, String(e.stack ?? e).split('\n').slice(0, 3).join(' | ')); }
await b.close();
console.log(bad ? `FAILED: ${bad}` : 'all checks passed');
process.exit(bad ? 1 : 0);
