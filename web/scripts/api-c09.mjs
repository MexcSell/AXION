// Improvement cycle 9 (lane w7), api mode: answering a backfilled DEMO question through the Messenger composer.
// Backfilled demo questions carry a fixture replyTo (APR-<mission>-1) that is not a message id; the server now refuses a
// replyTo outside the thread (422), so the composer must send the question's real message id.
// Run through scripts/api-e2e.sh (E2E_API_PORT / E2E_WEB_PORT for lanes).
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const base = process.env.BASE || 'http://127.0.0.1:5193';
const SHOTS = process.env.SHOTS || '/tmp/axion-api-e2e';
mkdirSync(SHOTS, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.PW_CHROME || '/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome' });
const errors = [];
let fails = 0, total = 0;
const check = (name, ok, extra = '') => { total++; if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };
const until = async (f, ms = 10000, step = 150) => { const t0 = Date.now(); for (;;) { try { if (await f()) return true; } catch { /* retry */ } if (Date.now() - t0 > ms) return false; await new Promise((r) => setTimeout(r, step)); } };
const ctx = await b.newContext({ viewport: { width: 1600, height: 940 } });
await ctx.addInitScript(() => { try { localStorage.setItem('axion.data-mode', 'api'); localStorage.setItem('axion.testhook', '1'); } catch { /* ignore */ } });
const p = await ctx.newPage();
p.on('pageerror', (e) => errors.push(e.message));
p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_CONNECTION|502|503|504|EventSource/.test(m.text())) errors.push(`console: ${m.text()}`); });
let csrf = '';
const api = async (method, path, data) => {
  if (!csrf && method !== 'GET') csrf = (await (await p.request.get(base + '/api/v1/me')).json()).me.csrf;
  const r = await p.request.fetch(base + '/api/v1' + path, { method, data, headers: method !== 'GET' ? { 'x-csrf': csrf, 'idempotency-key': `c9-${Date.now()}-${Math.random()}` } : {} });
  return { status: r.status(), body: await r.json().catch(() => ({})) };
};
try {
  await p.goto(base + '/missions', { waitUntil: 'domcontentloaded' });
  await p.getByRole('heading', { name: 'Connect' }).waitFor({ timeout: 15000 });
  await p.getByLabel('Name').fill('Luca');
  await p.getByLabel('Password', { exact: true }).fill('secret-1');
  await p.getByRole('button', { name: /Connect/ }).click();
  await p.waitForSelector('.rail-nav', { timeout: 15000 });

  // find a backfilled question: an agent -> human message of kind question whose replyTo is a fixture id, not a message id
  let found;
  const missions = (await api('GET', '/missions')).body.missions ?? [];
  for (const m of missions.filter((x) => x.demo)) {
    const ths = (await api('GET', `/missions/${m.id}/threads`)).body.threads ?? [];
    for (const t of ths) {
      const msgs = (await api('GET', `/threads/${t.id}/messages?limit=50&mark=0`)).body.messages ?? [];
      const q = msgs.find((x) => x.kind === 'question' && x.replyTo && !/^\d+$/.test(String(x.replyTo)));
      if (q) { found = { mission: m.id, thread: t.id, q, agent: q.from }; break; }
    }
    if (found) break;
  }
  check('a backfilled DEMO question with a fixture replyTo exists', !!found, found ? `${found.mission} ${found.q.id} replyTo=${found.q.replyTo} from ${found.agent}` : '');
  if (found) {
    await p.goto(`${base}/missions/${found.mission}?tab=conversations&agent=${encodeURIComponent(found.agent)}`, { waitUntil: 'domcontentloaded' });
    await until(async () => (await p.locator('.conv-main .cp-item').count()) >= 1, 12000);
    await p.locator('.conv-main .cp-item', { hasText: 'You (Owner)' }).first().click();
    await p.locator('.conv-main .thread-body').first().waitFor({ timeout: 10000 });
    check('the thread shows the question', await until(async () => (await p.locator('.conv-main .thread-body').first().innerText()).includes(found.q.text.slice(0, 30)), 10000));
    const c = p.locator('.conv-main .composer').first();
    const text = `Approved, go ahead ${Date.now()}`;
    await c.locator('textarea').fill(text);
    const posted = p.waitForResponse((r) => r.request().method() === 'POST' && /\/api\/v1\/threads\/[^/]+\/messages$/.test(r.url()), { timeout: 10000 });
    await c.getByRole('button', { name: 'Send message' }).click();
    const resp = await posted.catch(() => null);
    check('the reply is accepted (201, not 422)', !!resp && resp.status() === 201, resp ? String(resp.status()) : 'no request');
    check('the reply shows in the thread and no "Not sent" appears', await until(async () => (await p.locator('.conv-main .thread-body').first().innerText()).includes(text), 8000) && (await p.getByText('Not sent').count()) === 0);
    const stored = ((await api('GET', `/threads/${found.thread}/messages?limit=50&mark=0`)).body.messages ?? []).find((x) => x.text === text);
    check('the server stored it as a reply to the question\'s real message id', !!stored && stored.kind === 'reply' && String(stored.replyTo) === String(found.q.id), stored ? `replyTo=${stored.replyTo}` : 'not stored');
    await p.screenshot({ path: `${SHOTS}/c09-reply.png` });
  }
} catch (e) { check('script ran to the end', false, String(e)); }
check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await b.close();
console.log(`${total - fails}/${total} passed`);
process.exit(fails ? 1 : 0);
