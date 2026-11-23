// c88 (T2), api mode: a member sees "Counts visible to administrators" on hidden evidence, never the backed chip or a null count;
// an administrator still sees the counts and the chips. Run through scripts/api-e2e.sh: ./scripts/api-e2e.sh api-c88.mjs
import { chromium, request } from 'playwright';
import { mkdirSync } from 'node:fs';
import { signIn, demoMode, settle } from './_session.mjs';
process.env.DATA_MODE ||= 'api';
const base = process.env.BASE || 'http://127.0.0.1:5193';
const SHOTS = process.env.SHOTS || '/tmp/axion-api-c88';
mkdirSync(SHOTS, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.PW_CHROME || '/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome' });
let bad = 0;
const check = (name, ok, extra = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };
const until = async (f, ms = 10000, step = 150) => { const t0 = Date.now(); for (;;) { try { if (await f()) return true; } catch { /* retry */ } if (Date.now() - t0 > ms) return false; await new Promise((r) => setTimeout(r, step)); } };
const errors = [];
const fits = (pg) => pg.evaluate(() => { const m = document.querySelector('main'); return { over: m.scrollHeight - m.clientHeight, side: document.documentElement.scrollWidth - innerWidth }; });
try {
  const actx = await b.newContext({ viewport: { width: 1366, height: 768 } });
  await signIn(actx, 'Luca');
  const ap = await actx.newPage();
  ap.on('pageerror', (e) => errors.push(e.message));
  await ap.goto(base + '/operations?tab=agents&sub=proposals', { waitUntil: 'domcontentloaded' }); await settle(ap);
  const g = (await (await ap.request.get(base + '/api/v1/organization/graph')).json());
  const meR = await ap.request.get(base + '/api/v1/me'); const meJ = await meR.json(); const csrf = meJ.me?.csrf; if (!csrf) console.log('me:', meR.status(), JSON.stringify(meJ).slice(0, 200));
  const made = await ap.request.fetch(base + '/api/v1/organization/proposals', { method: 'POST', headers: { 'x-csrf': csrf, 'idempotency-key': 'c88-' + Date.now() }, data: {
    title: 'Tester under Ops', why: '', baseRevision: g.revision.seq, edges: g.edges.map((e) => (e.subordinateId === 'tester-01' ? { ...e, supervisorId: 'ops-01' } : e)),
    triggers: ['load_imbalance', 'coverage_gap'], baseline: 'No change: tester-01 stays under the GM.', expectedCost: 'One extra hop for tester-01 escalations.' } });
  check('c88 the administrator made a proposal with two triggers', made.status() === 201, String(made.status()));
  const id = (await made.json()).proposal.id;
  await ap.reload({ waitUntil: 'domcontentloaded' }); await settle(ap);
  const ac = ap.locator(`[data-proposal="${id}"]`);
  check('c88 admin: all four triggers render, none hidden, counts and backed chips as before', await until(async () => (await ac.locator('[data-trigger]').count()) === 2 && (await ac.locator('[data-trigger-other]').count()) === 2 && (await ac.locator('[data-evidence-hidden]').count()) === 0 && (await ac.locator('[data-supported]').count()) === 4 && /Open tasks of the busiest agent \d/.test(await ac.innerText())));

  // a member, signed in by hand: signIn() would connect the administrator again from a new cookie jar, which a new device must approve
  const mrc = await request.newContext();
  const w = await mrc.post(base + '/api/v1/auth/connect', { data: { name: 'Mina', password: 'script-pass-1', device: { name: 'Chrome on Linux (member script)', kind: 'desktop', browser: 'Chrome' } } });
  check('c88 the member connects and waits for approval', w.status() === 202, String(w.status()));
  const users = (await (await ap.request.get(base + '/api/v1/users')).json()).users;
  await ap.request.post(base + `/api/v1/users/${users.find((u) => u.name === 'Mina').id}/approve`, { headers: { 'x-csrf': csrf }, data: {} });
  check('c88 the member is approved', (await mrc.get(base + '/api/v1/auth/wait')).status() === 200);
  const mctx = await b.newContext({ viewport: { width: 1366, height: 768 }, storageState: await mrc.storageState() });
  await demoMode(mctx);
  const p = await mctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|EventSource|ERR_/.test(m.text())) errors.push(m.text()); });
  await p.goto(base + '/operations?tab=agents&sub=proposals', { waitUntil: 'domcontentloaded' }); await settle(p);
  const card = p.locator(`[data-proposal="${id}"]`);
  check('c88 member: the proposal card renders', await until(async () => (await card.count()) === 1));
  check('c88 member: three mission-derived triggers say "Counts visible to administrators"', await until(async () => (await card.locator('[data-evidence-hidden]').count()) === 3 && (await card.locator('[data-evidence-hidden]').first().innerText()).includes('Counts visible to administrators')));
  check('c88 member: the hidden rows have no backed/not-backed chip and no data-supported', (await card.locator('[data-hidden="1"] [data-supported]').count()) === 0 && !/backed by the counts/i.test(await card.locator('[data-hidden="1"]').allInnerTexts().then((a) => a.join(' '))));
  check('c88 member: the coverage gap row still shows its chip and counts (one row with data-supported)', (await card.locator('[data-supported]').count()) === 1 && /Roles nobody holds \d/.test(await card.innerText()));
  const txt = await card.innerText();
  check('c88 member: the card never shows null, undefined or NaN', !/\bnull\b|undefined|NaN/.test(txt), txt.match(/.{0,20}(null|undefined|NaN).{0,20}/)?.[0] ?? '');
  const h = card.locator('[data-help-key="org.proposal.evidenceHidden"]').first();
  check('c88 member: the ? help of the hidden line opens', (await h.count()) === 1 && (await (async () => { await h.click(); const ok = await until(async () => /administrators/i.test(await p.locator('.help-pop').innerText()), 4000); await p.keyboard.press('Escape'); return ok; })()));
  const f = await fits(p);
  check('c88 member: Proposals fits one screen at 1366x768', f.over <= 2 && f.side <= 0, JSON.stringify(f));
  await p.screenshot({ path: `${SHOTS}/c88-member.png` });
  await ap.screenshot({ path: `${SHOTS}/c88-admin.png` });
  check('c88 no uncaught page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) { bad++; console.log('FAIL script error — ' + (e.stack || e.message)); }
await b.close();
console.log(bad ? `${bad} check(s) failed` : 'ALL PASS');
process.exit(bad ? 1 : 0);
