// Cycle 35 fix round, demo mode: the approval gate (members disabled on R3/R4) must not touch the demo mode.
// BASE=http://127.0.0.1:<dev> node scripts/demo-c35.mjs
import { chromium } from 'playwright';
import { signIn, navWait, settle } from './_session.mjs';
const base = process.env.BASE || 'http://127.0.0.1:5190';
const b = await chromium.launch({ executablePath: process.env.PW_CHROME || '/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome' });
const res = [];
const check = (n, ok, x = '') => { res.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${x ? ' — ' + x : ''}`); };
const until = async (f, ms = 8000) => { const t0 = Date.now(); for (;;) { try { if (await f()) return true; } catch { /* retry */ } if (Date.now() - t0 > ms) return false; await new Promise((r) => setTimeout(r, 100)); } };
for (const mode of ['signed in (demo account)']) { // without a session the demo shows the sign-in gate and no cards
  const ctx = await b.newContext({ viewport: { width: 1672, height: 941 } });
  if (mode.startsWith('signed')) await signIn(ctx); else await ctx.addInitScript(() => { try { localStorage.setItem('axion.data-mode', 'demo'); } catch { /* ignore */ } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(base + '/notifications?tab=pending' + (mode.startsWith('no') ? '&data=demo' : ''), { waitUntil: navWait() }); await settle(p);
  const cards = p.locator('.nt-appr');
  const ready = await until(async () => (await cards.count()) > 0);
  check(`${mode}: approval cards are listed`, ready, `${await cards.count()} cards`);
  if (!ready) { await ctx.close(); continue; }
  const r3 = cards.filter({ has: p.locator('.chip', { hasText: /^R3$/ }) }).first();
  check(`${mode}: an R3 card has Approve and Deny enabled and no gate help`, (await r3.count()) === 1 && !(await r3.getByRole('button', { name: 'Approve' }).isDisabled()) && !(await r3.getByRole('button', { name: 'Deny' }).isDisabled()) && (await r3.locator('[data-help-key="approval.gate"]').count()) === 0);
  const before = await cards.count();
  const title = await r3.locator('b').first().innerText();
  await r3.getByRole('button', { name: 'Approve' }).click();
  check(`${mode}: clicking Approve on R3 decides it as before`, await until(async () => (await cards.count()) === before - 1 && (await cards.locator('b', { hasText: title }).count()) === 0), `${before} -> ${await cards.count()}`);
  check(`${mode}: no page errors`, errs.length === 0, errs.join('|').slice(0, 200));
  await ctx.close();
}
await b.close();
process.exit(res.every(Boolean) ? 0 : 1);
