// Improvement cycle 56 (P4b), api mode: the grant dialog explains a refused public suffix in plain words, with a ? help.
// A (admin) types public suffixes (ICANN, PRIVATE, wildcard) in the Grant a site dialog and sees the plain-words refusal plus a ? that
// explains it; an exception name and a name under a suffix are accepted. Run through scripts/api-e2e.sh. Condition waits only.
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
const base = process.env.BASE || 'http://127.0.0.1:5193';
const SHOTS = process.env.SHOTS || `/tmp/axion-api-c56-${new URL(base).port}`;
const DOC_SHOT = process.env.DOC_SHOT_C56;
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
const key = () => ({ 'idempotency-key': `c36-${Date.now()}-${k++}` });
const hours = (h) => new Date(Date.now() + h * 3600_000).toISOString();
let A;
try {
  A = await browser('A');
  await A.p.goto(base + '/settings?tab=browser', { waitUntil: 'domcontentloaded' });
  await connect(A.p, 'Luca', 'secret-1');
  check('A (first user = administrator) is connected and live', await live(A.p));
  await A.p.locator('[data-site-grants="ready"]').waitFor({ timeout: 15000 });
  await A.p.getByRole('button', { name: 'Grant a site', exact: true }).click();
  const dlg = A.p.locator('[role="dialog"]').first();
  await dlg.locator('#sg-origin').waitFor({ timeout: 8000 });
  const refusedText = async (o) => { await dlg.locator('#sg-origin').fill(o); await until(async () => (await dlg.locator('[data-origin-check="refused"]').count()) === 1, 6000); return dlg.locator('[data-origin-check="refused"]').innerText().catch(() => ''); };
  for (const o of ['https://co.uk', 'https://github.io', 'https://test.ck', 'https://myshopify.com']) {
    const t = await refusedText(o);
    check(`${o} is refused in plain words`, /public suffix/i.test(t) && /every one of them|shared ending/i.test(t), t.slice(0, 80));
    check(`${o} shows the ? help for a public suffix and Grant site stays off`, (await dlg.locator('[data-help-key="grants.publicSuffix"]').count()) === 1 && await dlg.getByRole('button', { name: 'Grant site' }).isDisabled());
  }
  await dlg.locator('[data-help-key="grants.publicSuffix"]').click();
  const pop = A.p.locator('.help-pop');
  check('the ? opens an explanation of a public suffix with an example', await until(async () => (await pop.count()) === 1 && /public suffix/i.test(await pop.innerText()) && /example\.co\.uk/.test(await pop.innerText()), 8000));
  await A.p.screenshot({ path: process.env.DOC_SHOT_C56 || `${SHOTS}/improve-c56-help.png` });
  await A.p.keyboard.press('Escape');
  for (const o of ['https://www.ck', 'https://shop.myshopify.com', 'https://example.co.uk']) {
    await dlg.locator('#sg-origin').fill(o);
    check(`${o} is accepted as an exact origin`, await until(async () => (await dlg.locator('[data-origin-check="ok"]').count()) === 1 && (await dlg.locator('[data-normal-form]').innerText()).includes(o), 6000));
  }
  check('the ? help is gone when the origin is fine', (await dlg.locator('[data-help-key="grants.publicSuffix"]').count()) === 0);
} catch (e) { check('script ran to the end', false, String(e).split('\n')[0]); }
await A?.p.screenshot({ path: `${SHOTS}/improve-c56-end.png` }).catch(() => {});
console.log(errors.length ? 'PAGE ERRORS:\n' + errors.join('\n') : 'no page errors');
console.log(`${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
writeFileSync(`${SHOTS}/api-c56.txt`, results.join('\n') + '\n');
await b.close();
process.exit(results.some((r) => r.startsWith('FAIL')) || errors.length ? 1 : 0);
