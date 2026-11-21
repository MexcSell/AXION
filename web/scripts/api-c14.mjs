// Improvement cycle 14 (security S1), api mode against the PRODUCTION build under the strict Content-Security-Policy.
// Run through scripts/api-e2e-preview.sh (API on E2E_API_PORT, `vite preview` with the CSP on E2E_WEB_PORT).
// Proves: (1) the page is served with the CSP and the other security headers, (2) the CSP is enforced (an injected inline
// script does not run and is reported), (3) the app works under it: sign-in, live event stream, every main page, a
// popover, a dropdown menu, a dialog and a sent message, with NO CSP violation and no page error.
import { chromium } from 'playwright';
const base = process.env.BASE || 'http://127.0.0.1:5193';
const b = await chromium.launch({ executablePath: process.env.PW_CHROME || '/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome' });
const results = [];
const errors = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); console.log(results[results.length - 1]); };
const until = async (f, ms = 10000, step = 150) => { const t0 = Date.now(); for (;;) { try { if (await f()) return true; } catch { /* retry */ } if (Date.now() - t0 > ms) return false; await new Promise((r) => setTimeout(r, step)); } };

const ctx = await b.newContext({ viewport: { width: 1600, height: 940 } });
await ctx.addInitScript(() => {
  try { localStorage.setItem('axion.data-mode', 'api'); } catch { /* ignore */ }
  window.__csp = [];
  document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.effectiveDirective} ${e.blockedURI || '(inline)'} ${e.sourceFile || ''}:${e.lineNumber || ''} ${(e.sample || '').slice(0, 60)}`));
});
const p = await ctx.newPage();
const consoleCsp = [];
p.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
p.on('console', (m) => {
  const t = m.text();
  if (/Content Security Policy|Content-Security-Policy/i.test(t)) consoleCsp.push(t.slice(0, 200));
  else if (m.type() === 'error' && !/Failed to load resource|ERR_CONNECTION|502|503|504|EventSource/.test(t)) errors.push(`console: ${t.slice(0, 200)}`);
});
const violations = async () => (await p.evaluate(() => window.__csp.slice())).concat(consoleCsp);
const live = () => until(async () => (await p.locator('.conn-badge').getAttribute('data-conn')) === 'live', 15000);
const NAV = { waitUntil: 'domcontentloaded' };

try {
  // 1. headers on the document
  const res = await p.goto(base + '/missions', NAV);
  const h = res.headers();
  const csp = h['content-security-policy'] || '';
  const dir = Object.fromEntries(csp.split(';').map((s) => s.trim().split(/\s+/)).filter((a) => a[0]).map(([k, ...v]) => [k, v]));
  check('the page is served with a Content-Security-Policy', !!csp, csp);
  check("script-src is 'self' only (no inline, no eval)", JSON.stringify(dir['script-src']) === JSON.stringify(["'self'"]));
  check("default-src 'self', object-src 'none', base-uri 'none', frame-ancestors 'none'", dir['default-src']?.[0] === "'self'" && dir['object-src']?.[0] === "'none'" && dir['base-uri']?.[0] === "'none'" && dir['frame-ancestors']?.[0] === "'none'");
  check("connect-src 'self' only (the API and the event stream are same-origin)", JSON.stringify(dir['connect-src']) === JSON.stringify(["'self'"]));
  check('nosniff, no-referrer, X-Frame-Options DENY, COOP same-origin on the page', h['x-content-type-options'] === 'nosniff' && h['referrer-policy'] === 'no-referrer' && h['x-frame-options'] === 'DENY' && h['cross-origin-opener-policy'] === 'same-origin');
  const asset = await p.request.get(base + '/favicon.svg');
  check('static files carry the headers too', (asset.headers()['content-security-policy'] || '').includes("script-src 'self'"));

  // 2. sign in through the UI, live stream through connect-src 'self'
  await p.getByRole('heading', { name: 'Connect' }).waitFor({ timeout: 15000 });
  await p.getByLabel('Name').fill('Luca');
  await p.getByLabel('Password', { exact: true }).fill('csp-pass-1');
  await p.getByRole('button', { name: /Connect/ }).click();
  await p.waitForSelector('.rail-nav', { timeout: 15000 });
  check('signed in under the CSP; the live event stream connects', await live());
  check('DEMO missions listed from the API', await until(async () => (await p.locator('.mission-row[data-mission="M-126"]').count()) > 0));

  // 3. every main page renders under the CSP
  const pages = { overview: '/overview', mission: '/missions/M-126', agentProfile: '/agents/coder-01', directory: '/operations?tab=agents', proposals: '/operations?tab=agents&sub=proposals', jobSearch: '/plugins/job-search', results: '/results', notifications: '/notifications', settings: '/settings', users: '/settings?tab=users', operations: '/operations', help: '/help' };
  for (const [k, path] of Object.entries(pages)) {
    await p.goto(base + path, NAV);
    const ok = await until(async () => (await p.locator('.rail-nav').count()) > 0 && (await p.locator('main, .page-frame, [role="main"]').first().count()) > 0, 15000);
    const up = await live();
    const v = await violations();
    check(`${k} renders under the CSP, live, no violation`, ok && up && v.length === 0, v.slice(0, 3).join(' | '));
  }

  // 4. widgets that add elements at run time: a help popover, a dropdown menu, a dialog
  await p.goto(base + '/missions/M-126', NAV);
  await live();
  const help = p.locator('.help-btn').first();
  await help.waitFor({ timeout: 10000 });
  await help.click();
  check('a ? help popover opens', await until(async () => (await p.locator('.help-pop').count()) > 0));
  await p.keyboard.press('Escape');
  const account = p.getByRole('button', { name: /Account menu/ });
  await account.click();
  check('the account dropdown menu opens', await until(async () => (await p.getByRole('menu').count()) > 0));
  await p.keyboard.press('Escape');
  await p.keyboard.press('Control+k');
  const palette = await until(async () => (await p.getByRole('dialog').count()) > 0, 4000);
  check('a dialog opens (command palette, Ctrl+K)', palette);
  await p.keyboard.press('Escape');
  let v = await violations();
  check('no CSP violation from popover, menu and dialog', v.length === 0, v.slice(0, 3).join(' | '));

  // 5. a write through the API under the CSP: a message to the General Manager channel, via the page's own session
  const me = await (await p.request.get(base + '/api/v1/me')).json();
  const sent = await p.request.post(base + '/api/v1/channels/gm/messages', { headers: { 'x-csrf': me.me.csrf, 'idempotency-key': 'c14-' + Date.now() }, data: { kind: 'reply', text: 'CSP check message' } });
  check('a message is accepted (201) with the page session', sent.status() === 201, String(sent.status()));
  const cross = await p.request.post(base + '/api/v1/channels/gm/messages', { headers: { 'x-csrf': me.me.csrf, 'idempotency-key': 'c14x-' + Date.now(), origin: 'https://evil.example' }, data: { kind: 'reply', text: 'cross-site' } });
  check('the same write from a cross-site Origin is refused (403 CSRF) through the proxy', cross.status() === 403 && (await cross.json()).code === 'CSRF', String(cross.status()));

  // 6. the CSP is really enforced: an injected inline script does not run and is reported
  const ran = await p.evaluate(() => { window.__injected = false; const s = document.createElement('script'); s.textContent = 'window.__injected = true'; document.body.appendChild(s); return window.__injected; });
  const reported = await until(async () => (await p.evaluate(() => window.__csp.some((x) => x.startsWith('script-src')))), 4000);
  check('an injected inline script is blocked and reported (the CSP is enforced)', ran === false && reported);
  const evalBlocked = await p.evaluate(() => { try { return (0, eval)('1+1') !== 2; } catch { return true; } });
  check('eval is blocked', evalBlocked);
  v = (await violations()).filter((x) => !x.startsWith('script-src') && !/script-src|unsafe-eval|eval/i.test(x));
  check('no other CSP violation during the whole run', v.length === 0, v.slice(0, 5).join(' | '));
} catch (e) {
  check('script ran to the end', false, e.message);
}
check('no page errors', errors.length === 0, errors.slice(0, 5).join(' | '));
await b.close();
const failed = results.filter((r) => r.startsWith('FAIL'));
console.log(`\napi-c14: ${results.length - failed.length}/${results.length} PASS`);
process.exit(failed.length ? 1 : 0);
