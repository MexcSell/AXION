// c24 (lane w22): every api-mode route, tab and reachable dialog at phone (390x844) and tablet (900x1000) width.
// Records horizontal page overflow, interactive controls clipped off-screen, buttons smaller than 40x40, and whether each
// dialog fits the viewport. Run through scripts/api-e2e.sh (needs the e2e stack).  SHOTS=dir saves key screenshots.
// FAIL lines: any horizontal overflow, any clipped primary control, any dialog that does not fit.  Small taps are listed.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { signIn, settle } from './_session.mjs';
const base = process.env.BASE || 'http://127.0.0.1:5193';
const SHOTS = process.env.SHOTS; if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const SIZES = (process.env.SIZES || '390x844,900x1000').split(',').map((s) => s.split('x').map(Number));
const b = await chromium.launch({ executablePath: process.env.PW_CHROME || '/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome' });
const fails = []; const smalls = new Map(); let states = 0, dialogs = 0;
const SHOT_KEYS = new Set((process.env.SHOT_KEYS || 'connect,waiting,/overview,/operations?tab=agents,dlg:first').split(','));

// runs in the page: measures overflow, clipped interactive controls and small tap targets
const MEASURE = () => {
  const vw = window.innerWidth, vh = window.innerHeight;
  const vis = (el) => { const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return null; const s = getComputedStyle(el); if (s.visibility === 'hidden' || s.display === 'none' || +s.opacity === 0) return null; if (el.closest('[aria-hidden="true"],[inert]')) return null; return r; };
  const sig = (el) => { const t = (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24); const c = (typeof el.className === 'string' ? el.className : '').split(' ').filter(Boolean).slice(0, 2).join('.'); return `${el.tagName.toLowerCase()}${c ? '.' + c : ''}[${t}]`; };
  // the topmost layer: an open dialog scopes the checks, otherwise the whole page
  const dlgs = [...document.querySelectorAll('[role="dialog"]')]; const top = dlgs[dlgs.length - 1] || null;
  const root = top || document.body;
  const clipped = [], small = [];
  const scrollAnc = (el) => { for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) { const s = getComputedStyle(a); if (/(auto|scroll)/.test(s.overflowX) && a.scrollWidth > a.clientWidth + 1) return a; } return null; };
  for (const el of root.querySelectorAll('button,a[href],input:not([type=hidden]),select,textarea,[role=tab],[role=button],[role=menuitem]')) {
    const r = vis(el); if (!r) continue;
    // inside a horizontally scrollable strip (tabs, tables): off-screen part is reachable by scrolling, so not clipped
    const out = r.right > vw + 1 || r.left < -1;
    if (out && !scrollAnc(el)) clipped.push(sig(el) + ` x=${Math.round(r.left)}..${Math.round(r.right)}`);
    if (!top && el.closest('.rail, .rail-nav') && out) { /* off-canvas rail items are not shown */ }
    if ((r.width < 39.5 || r.height < 39.5) && r.right > 0 && r.left < vw && r.bottom > 0 && r.top < vh && !(el.tagName === 'INPUT' && /checkbox|radio/.test(el.type) && el.closest('label'))) small.push(sig(el) + ` ${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  let dlg = null;
  if (top) { const r = top.getBoundingClientRect(); const body = top.querySelector('.modal-body'); dlg = { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom), fits: r.left >= -1 && r.top >= -1 && r.right <= vw + 1 && r.bottom <= vh + 1, bodyScroll: body ? body.scrollHeight > body.clientHeight + 1 : false, bodyX: body ? body.scrollWidth - body.clientWidth : 0, label: (top.querySelector('.modal-title')?.textContent || top.getAttribute('aria-label') || '').slice(0, 40), id: top.getAttribute('data-dialog') }; }
  // page overflow: the document, plus the app's own scrollers that should never scroll sideways
  const over = document.documentElement.scrollWidth - vw;
  return { over, clipped, small, dlg };
};

const record = (tag, m) => {
  states++; console.log(`  . ${tag}${m.dlg ? ' [dialog]' : ''} over=${m.over} clipped=${m.clipped.length} small=${m.small.length}`);
  if (m.over > 0) fails.push(`FAIL ${tag}: horizontal page overflow ${m.over}px`);
  for (const c of m.clipped) fails.push(`FAIL ${tag}: clipped control ${c}`);
  if (m.dlg) { dialogs++; if (!m.dlg.fits) fails.push(`FAIL ${tag}: dialog "${m.dlg.label}" (${m.dlg.id}) outside viewport ${JSON.stringify(m.dlg)}`); if (m.dlg.bodyX > 1) fails.push(`FAIL ${tag}: dialog "${m.dlg.label}" body scrolls sideways ${m.dlg.bodyX}px`); }
  for (const s of m.small) { const k = s; const e = smalls.get(k) || []; e.push(tag); smalls.set(k, e); }
};

const run = async (W, H) => {
  const tagW = `${W}`;
  const shot = async (p, key, name) => { if (SHOTS && SHOT_KEYS.has(key)) await p.screenshot({ path: `${SHOTS}/${name}-${W}.png` }).catch(() => {}); };
  // 1. connect screen (first ever user) and the waiting screen of a second user
  {
    const ctx = await b.newContext({ viewport: { width: W, height: H } }); await ctx.addInitScript(() => { try { localStorage.setItem('axion.data-mode', 'api'); } catch { /* */ } });
    const p = await ctx.newPage();
    await p.goto(base + '/overview', { waitUntil: 'domcontentloaded' }); await p.getByRole('heading', { name: 'Connect' }).waitFor({ timeout: 15000 }); await p.waitForTimeout(500);
    record(`${tagW} connect`, await p.evaluate(MEASURE)); await shot(p, 'connect', 'connect');
    await ctx.close();
  }
  console.log('  signing in admin'); await signIn(await b.newContext(), 'Luca'); console.log('  admin in'); // the first user becomes the administrator (cookie kept by _session)
  {
    const ctx = await b.newContext({ viewport: { width: W, height: H } }); await ctx.addInitScript(() => { try { localStorage.setItem('axion.data-mode', 'api'); } catch { /* */ } });
    const p = await ctx.newPage();
    await p.goto(base + '/overview', { waitUntil: 'domcontentloaded' }); await p.getByRole('heading', { name: 'Connect' }).waitFor({ timeout: 15000 });
    await p.getByLabel('Name').fill(`Phone ${W}`); await p.getByLabel('Password', { exact: true }).fill('phone-pass-1'); await p.getByRole('button', { name: /Connect/ }).click();
    await p.getByRole('heading', { name: 'Waiting for approval' }).waitFor({ timeout: 15000 }).catch(async () => { console.log('waiting screen not reached: ' + (await p.locator('body').innerText()).slice(0, 300).replace(/\n/g, ' | ')); }); await p.waitForTimeout(600);
    record(`${tagW} waiting`, await p.evaluate(MEASURE)); await shot(p, 'waiting', 'waiting');
    console.log('  closing waiting ctx'); await ctx.close();
  }
  console.log('  signed-in ctx');
  // 2. the signed-in app
  const ctx = await b.newContext({ viewport: { width: W, height: H }, hasTouch: true }); await signIn(ctx, 'Luca');
  const p = await ctx.newPage(); p.setDefaultTimeout(4000); const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  const go = async (path) => { console.log('  go ' + path); await p.goto(base + path, { waitUntil: 'domcontentloaded' }); console.log('  went'); await settle(p, 400); await p.waitForTimeout(300); console.log('  settled'); };
  const api = async (path) => (await ctx.request.get(base + '/api/v1' + path)).json().catch(() => ({}));
  console.log('  api lookups'); const ms = await api('/missions'); const mid = (ms.missions || ms.items || [])[0]?.id;
  const ag = await api('/agents'); const aid = (ag.agents || ag.items || [])[0]?.id;
  console.log('  routes'); const routes = ['/overview', '/missions', mid && `/missions/${mid}`, '/agents', aid && `/agents/${aid}`, '/results', '/notifications', '/settings', '/operations', '/plugins/job-search', '/help', '/models', '/nope'].filter(Boolean).filter((r) => !process.env.ROUTES || process.env.ROUTES.split(',').includes(r));
  const seen = new Set(); const tried = new Set();
  const dialogsAt = async (tag) => {
    // click every visible button in the page body / top bar; any that opens a dialog is measured and closed
    const sel = 'main button, .topbar button, .chat-launch, [data-chat-open], .page-frame button';
    const n = Math.min(await p.locator(sel).count(), 60); console.log(`    buttons at ${tag}: ${n}`);
    for (let i = 0; i < n; i++) {
      const el = p.locator(sel).nth(i);
      const info = await el.evaluate((e) => { const r = e.getBoundingClientRect(); return { ok: r.width > 0 && r.height > 0 && !e.disabled && !e.closest('[role=tablist]') && !e.closest('[role=dialog]') && !e.closest('.rail'), name: (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 30) }; }).catch(() => null);
      if (!info?.ok) continue;
      const tk = `${tag.split('?')[0].split(' tab=')[0]}|${info.name}`; if (tried.has(tk)) continue; tried.add(tk);
      const before = p.url();
      // playwright's own scroll-into-view stalls on this animated page at 390 px: centre it ourselves, then tap
      await el.evaluate((e) => e.scrollIntoView({ block: 'center', behavior: 'instant' })).catch(() => {});
      await el.click({ timeout: 1500, force: true }).catch((e) => { if (process.env.DEBUG_CLICK) console.log('    click failed', info.name, e.message.replace(/\s+/g, ' ').slice(-200)); });
      await p.waitForTimeout(300);
      if (await p.locator('[role=dialog]').count()) {
        await p.waitForTimeout(250);
        const m = await p.evaluate(MEASURE); const key = m.dlg?.id || m.dlg?.label || info.name;
        if (!seen.has(`${W}|${key}`)) { seen.add(`${W}|${key}`); record(`${tagW} ${tag} > dialog "${m.dlg?.label}" via [${info.name}]`, m); await shot(p, 'dlg:first', `dialog-${key}`); }
        // close everything that opened (dialogs may stack)
        for (let k = 0; k < 4 && (await p.locator('[role=dialog]').count()); k++) { await p.keyboard.press('Escape'); await p.waitForTimeout(250); }
        if (await p.locator('[role=dialog]').count()) { await p.reload({ waitUntil: 'domcontentloaded' }); await settle(p, 300); }
      }
      if (p.url() !== before) { await p.goto(before, { waitUntil: 'domcontentloaded' }); await settle(p, 300); }
    }
  };
  const tabsAt = async (path, depth = 0) => {
    const keys = await p.locator('[role=tablist]').evaluateAll((ls) => ls.map((l, li) => [...l.querySelectorAll('[role=tab]')].map((t) => [li, t.getAttribute('data-tab') || t.textContent.trim()])).flat());
    for (const [li, key] of keys) {
      const t = p.locator('[role=tablist]').nth(li).locator('[role=tab]').filter({ hasText: key.length > 2 ? key : undefined }).first();
      const tabEl = (await p.locator(`[data-tab="${key}"]`).count()) ? p.locator(`[data-tab="${key}"]`).first() : t;
      if (!(await tabEl.count())) continue;
      await tabEl.scrollIntoViewIfNeeded().catch(() => {}); await tabEl.click({ timeout: 2000 }).catch(() => {}); await p.waitForTimeout(450);
      const tag = `${tagW} ${path} tab=${key}`;
      if (seen.has(tag)) continue; seen.add(tag);
      record(tag, await p.evaluate(MEASURE)); await dialogsAt(tag.slice(tagW.length + 1));
    }
  };
  for (const path of routes) {
    await go(path);
    record(`${tagW} ${path}`, await p.evaluate(MEASURE)); await shot(p, path, path.replace(/\W+/g, '_'));
    await dialogsAt(path);
    await tabsAt(path);
    // sub-tabs of the Operations tabs
    if (path === '/operations') { for (const t of ['agents', 'models', 'logs', 'vms', 'usage']) { await go(`/operations?tab=${t}`); record(`${tagW} /operations?tab=${t}`, await p.evaluate(MEASURE)); await shot(p, `/operations?tab=${t}`, `ops_${t}`); await tabsAt(`/operations?tab=${t}`); } }
    if (path === '/settings') { for (const t of ['users', 'navigation', 'general', 'appearance']) { await go(`/settings?tab=${t}`); record(`${tagW} /settings?tab=${t}`, await p.evaluate(MEASURE)); await dialogsAt(`/settings?tab=${t}`); } }
    if (path === '/notifications') { for (const t of ['pending', 'news', 'all']) { await go(`/notifications?tab=${t}`); record(`${tagW} /notifications?tab=${t}`, await p.evaluate(MEASURE)); await dialogsAt(`/notifications?tab=${t}`); } }
  }
  // chat dock + channels
  await go('/overview');
  const chat = p.locator('button[aria-label*="hat" i], .chat-fab, .chat-launch').first();
  if (await chat.count()) { await chat.click().catch(() => {}); await p.waitForTimeout(700); record(`${tagW} chat dock`, await p.evaluate(MEASURE)); await shot(p, 'chat', 'chat'); await p.keyboard.press('Escape'); } else fails.push(`NOTE ${tagW}: chat opener not found`);
  for (const e of errs) fails.push(`FAIL ${tagW}: pageerror ${e}`);
  await ctx.close();
};
for (const [W, H] of SIZES) await run(W, H);
await b.close();
console.log(`states measured: ${states}, dialogs measured: ${dialogs}`);
const f = [...new Set(fails)]; console.log(f.length ? f.join('\n') : 'NO FAILURES');
const hot = [...smalls.entries()].sort((a, b2) => b2[1].length - a[1].length);
console.log(`small tap targets (<40px): ${hot.length} distinct controls`);
for (const [k, v] of hot.slice(0, Number(process.env.SMALL_TOP || 60))) console.log(`  SMALL ${k} x${v.length} e.g. ${v[0]}`);
process.exit(f.some((x) => x.startsWith('FAIL')) ? 1 : 0);
