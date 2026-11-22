// Stage 5: what the owner sees when the API is down. Needs Vite on BASE (5193) proxying to 5192 with NO API running;
// this script starts the e2e API itself half-way. Run: ./scripts/api-offline.sh
import { chromium } from 'playwright';
import { calm } from './_session.mjs';
import { spawn } from 'node:child_process';
const base = process.env.BASE || 'http://127.0.0.1:5193';
const b = await chromium.launch({ executablePath: process.env.PW_CHROME || '/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome' });
const results = []; const errors = [];
const check = (n, ok) => results.push(`${ok ? 'PASS' : 'FAIL'} ${n}`);
const until = async (f, ms = 15000) => { const t0 = Date.now(); for (;;) { try { if (await f()) return true; } catch { /* retry */ } if (Date.now() - t0 > ms) return false; await new Promise((r) => setTimeout(r, 200)); } };
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => { try { if (!sessionStorage.getItem('axion.data-mode')) localStorage.setItem('axion.data-mode', 'api'); } catch { /* ignore */ } });
const p = await ctx.newPage();
p.on('pageerror', (e) => errors.push(e.message));
await p.goto(base + '/missions', { waitUntil: 'domcontentloaded' });
check('API down → "Server not reachable" card', await until(async () => (await p.getByRole('heading', { name: 'Server not reachable' }).count()) > 0));
await calm(p); await p.screenshot({ path: new URL('../docs/screenshots/stage5-offline-dark.png', import.meta.url).pathname });
// the offline demo link (opens this tab in demo mode)
const p2 = await ctx.newPage();
await p2.goto(base + '/missions', { waitUntil: 'domcontentloaded' });
await until(async () => (await p2.getByRole('button', { name: 'Open the offline demo instead' }).count()) > 0);
await p2.getByRole('button', { name: 'Open the offline demo instead' }).click();
check('"Open the offline demo instead" shows the demo Connect screen', await until(async () => (await p2.getByRole('heading', { name: 'Connect' }).count()) > 0 && p2.url().includes('data=demo')));
check('the demo footer says DEMO', (await p2.getByText(/DEMO · accounts are kept in this browser/).count()) > 0);
// start the API: the first tab turns into Connect by itself (it retries every 3 s)
const api = spawn('node', ['--env-file=.env', '--import', 'tsx', 'src/cli/e2e-serve.ts'], { cwd: new URL('../../server/', import.meta.url).pathname, stdio: 'ignore', detached: true });
check('API back → the card becomes Connect without a reload', await until(async () => (await p.getByRole('heading', { name: 'Connect' }).count()) > 0, 30000));
console.log(results.join('\n'));
console.log(errors.length ? 'PAGE ERRORS:\n' + errors.join('\n') : 'no page errors');
console.log(`${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
try { process.kill(-api.pid, 'SIGTERM'); } catch { /* gone */ }
await b.close();
process.exit(results.some((r) => r.startsWith('FAIL')) || errors.length ? 1 : 0);
