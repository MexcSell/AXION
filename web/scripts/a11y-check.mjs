// Cycle 16: accessibility audit of the main pages and every dialog (keyboard, focus, names, live regions).
// Demo mode:  BASE=http://127.0.0.1:<dev> node scripts/a11y-check.mjs
// API mode:   E2E_API_PORT=.. E2E_WEB_PORT=.. ./scripts/api-e2e.sh "DATA_MODE=api node scripts/a11y-check.mjs"
// Checks per view: accessible name on every button/link/input/select/textarea; icon-only controls carry aria-label or title;
// images have alt; no control is taken out of the Tab order (tabindex=-1) outside a composite widget; a Tab walk reaches
// the tabbable controls; busy text ("Loading…", "Saving…") sits in an aria-live/status region; the page has a live region.
// Per dialog (opened through the test hook): focus moves in, Tab/Shift+Tab stay inside, Escape closes, focus returns to the opener.
import { chromium } from 'playwright';
import { signIn, navWait, settle } from './_session.mjs';
const base = process.env.BASE || 'http://127.0.0.1:5190';
const API = process.env.DATA_MODE === 'api';
const FAST = !!process.env.A11Y_FAST;
const b = await chromium.launch({ executablePath: process.env.PW_CHROME || '/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome' });
const ctx = await b.newContext({ viewport: { width: 1672, height: 941 } });
await signIn(ctx);
await ctx.addInitScript(() => { try { localStorage.setItem('axion.testhook', '1'); localStorage.setItem('axion.settings.v1', JSON.stringify({ state: { motion: 'reduced' }, version: 0 })); } catch { /* ignore */ } });
const p = await ctx.newPage();
// c57 (H12) race hunting knobs, all off by default: A11Y_ROUTE=<one view> A11Y_REPEAT=<n> A11Y_THROTTLE=<cpu slowdown factor>
const ROUTE = process.env.A11Y_ROUTE || '';
// c73 (H18): A11Y_PROBE=<text> (api mode) runs only the live-region probes whose route contains the text, A11Y_REPEAT times, with
// no views and no dialogs (A11Y_THROTTLE applies): `A11Y_PROBE=sub=proposals A11Y_REPEAT=20 A11Y_THROTTLE=6`
const PROBE = process.env.A11Y_PROBE || '';
const LAZY_DELAY = Number(process.env.A11Y_DELAY_LAZY) || 0; // c73 (H18) test knob: the lazy proposals page module arrives this many ms late (api probes only)
const DELAY_MAIN = Number(process.env.A11Y_DELAY_MAIN) || 0; // simulates a slow dev server: the app entry module arrives this many ms late
if (DELAY_MAIN) await p.route(/\/src\/main\.tsx(\?|$)/, async (r) => { await new Promise((res) => setTimeout(res, DELAY_MAIN)); await r.continue().catch(() => {}); });
const REPEAT = Math.max(1, Number(process.env.A11Y_REPEAT) || 1);
const THROTTLE = Number(process.env.A11Y_THROTTLE) || 0;
if (THROTTLE > 1 || process.env.A11Y_NOCACHE) { const cdp = await ctx.newCDPSession(p); if (THROTTLE > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE }); if (process.env.A11Y_NOCACHE) { await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true }); } }
const slug = (s) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const missionId = API ? '' : 'M-126';
const views = [];
const add = (path, tabs, key) => { for (const t of tabs) views.push(`${path}?tab=${slug(t)}${key ? '' : ''}`); };
add('/overview', ['Pulse', 'Needs you', 'Portfolio', 'Activity', 'Health']);
add('/missions/' + missionId, ['Overview', 'Activity', 'Hierarchy', 'Task Flow', 'Browser', 'Conversations', 'Results', 'Approvals', 'Reports', 'Timeline', 'Ledger']);
for (const s of ['Directory', 'Development', 'Lineage', 'Live Instances', 'Departments', 'Assignments', 'Policies', 'Proposals']) views.push(`/operations?tab=agents&sub=${slug(s)}`);
views.push('/operations?tab=agents&sub=directory&view=cards', '/operations?tab=agents&sub=directory&view=hierarchy');
if (!API) add('/agents/coder-01', ['Profile', 'Capabilities', 'Tools', 'Instances', 'Conversations', 'Memory', 'Performance', 'Mentoring', 'Evolution', 'Audit']);
add('/notifications', ['Inbox', 'News', 'Pending', 'Resolved', 'Rules']);
add('/settings', ['General', 'Users', 'Navigation', 'Appearance', 'Avatars & Faces', 'Accessibility', 'Browser', 'Integrations', 'Storage', 'Security', 'Backups']);

// runs inside the page: returns a list of violation strings for the current view
const audit = () => {
  const out = [];
  const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return (r.width > 0 || r.height > 0) && cs.visibility !== 'hidden' && cs.display !== 'none' && !e.closest('[aria-hidden="true"],[inert]'); };
  const vis0 = (e) => { const r = e.getBoundingClientRect(); return (r.width > 0 || r.height > 0) && getComputedStyle(e).visibility !== 'hidden'; };
  const txt = (e) => (e.innerText || e.textContent || '').replace(/\s+/g, ' ').trim();
  const byId = (id) => document.getElementById(id);
  const name = (e) => {
    const al = e.getAttribute('aria-label'); if (al && al.trim()) return al.trim();
    const lb = e.getAttribute('aria-labelledby'); if (lb) { const t = lb.split(/\s+/).map((i) => byId(i)).filter(Boolean).map(txt).join(' ').trim(); if (t) return t; }
    if (e.labels && e.labels.length) { const t = [...e.labels].map(txt).join(' ').trim(); if (t) return t; }
    const wrap = e.closest('label'); if (wrap && txt(wrap)) return txt(wrap);
    const t = txt(e); if (t) return t;
    const img = e.querySelector('img[alt]'); if (img && img.alt.trim()) return img.alt.trim();
    const svgT = e.querySelector('svg title'); if (svgT && svgT.textContent.trim()) return svgT.textContent.trim();
    const ti = e.getAttribute('title'); if (ti && ti.trim()) return ti.trim();
    if (e.tagName === 'INPUT' && e.value && /^(button|submit|reset)$/.test(e.type)) return e.value;
    return '';
  };
  const desc = (e) => { const c = (e.className && e.className.baseVal === undefined ? String(e.className) : '').split(/\s+/).slice(0, 3).join('.'); return `${e.tagName.toLowerCase()}${c ? '.' + c : ''}${e.getAttribute('data-help') ? '[help]' : ''}`; };
  const sel = 'button,a[href],input:not([type=hidden]),select,textarea,[role=button],[role=link],[role=tab],[role=menuitem],[role=switch],[role=checkbox],[role=radio],[role=combobox],[role=slider]';
  const items = [...document.querySelectorAll(sel)].filter(vis);
  for (const e of items) {
    const n = name(e);
    if (!n) {
      const plc = e.getAttribute('placeholder');
      out.push(`NAME ${desc(e)} has no accessible name${plc ? ` (only placeholder "${plc}")` : ''} :: ${e.outerHTML.slice(0, 110)}`);
    } else if (!txt(e) && !e.getAttribute('aria-label') && !e.getAttribute('aria-labelledby') && !(e.labels && e.labels.length) && !e.closest('label') && e.getAttribute('title') && e.tagName !== 'INPUT') {
      // icon-only with title only: accepted (the brief allows title)
    }
    const ti = e.getAttribute('tabindex');
    if (ti === '-1' && !e.closest('[role=tablist],[role=menu],[role=listbox],[role=radiogroup],[role=toolbar],[role=grid],[role=tree],[role=menubar],[data-radix-collection-item],[role=combobox]') && !/^(tab|menuitem|option|radio)$/.test(e.getAttribute('role') || '') && !e.closest('[data-roving]')) {
      out.push(`TABINDEX ${desc(e)} "${n.slice(0, 30)}" is removed from the Tab order (tabindex=-1)`);
    }
  }
  for (const i of document.querySelectorAll('img')) if (vis(i) && !i.hasAttribute('alt') && !i.getAttribute('aria-label') && i.getAttribute('role') !== 'presentation') out.push(`ALT img has no alt :: ${i.outerHTML.slice(0, 100)}`);
  for (const s of document.querySelectorAll('svg[role=img]')) if (vis(s) && !s.getAttribute('aria-label') && !s.querySelector('title') && !s.getAttribute('aria-labelledby')) out.push(`ALT svg[role=img] has no label`);
  const live = (e) => e.closest('[aria-live],[role=status],[role=alert],[role=log]');
  if (!document.querySelector('[aria-live],[role=status],[role=alert],[role=log]')) out.push('LIVE page has no live region');
  for (const e of document.querySelectorAll('main *, .page *, [aria-modal=true] *')) {
    if (e.children.length) continue;
    if (!vis(e)) continue;
    const t = (e.textContent || '').trim();
    if (t.length < 60 && /^(loading|saving|syncing|reconnecting|retrying|checking|connecting|sending|working|running)\b.{0,30}(…|\.\.\.)$/i.test(t) && !live(e)) out.push(`LIVE busy text "${t}" is not in an aria-live/status region (${desc(e)})`);
  }
  // cycle 23 fix 2: nothing focusable may sit inside aria-hidden content
  for (const e of document.querySelectorAll('[aria-hidden=true] :is(a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"]))')) if (!e.disabled && vis0(e)) out.push(`HIDDENFOCUS focusable ${e.tagName.toLowerCase()} "${txt(e).slice(0, 20)}" inside aria-hidden`);
  // cycle 23: loading and failed-load states must be announced (role=status for loading, role=alert for errors)
  for (const e of document.querySelectorAll('[data-state=loading],.part-status[data-state=loading]')) if (vis(e) && !live(e)) out.push(`LIVE loading state [data-state=loading] "${txt(e).slice(0, 30)}" is not in a status region`);
  for (const e of document.querySelectorAll('[data-state=error],.oa-banner')) if (vis(e) && (e.matches('[data-state=error]') || e.querySelector('button') || /not loaded|could not|failed/i.test(txt(e))) && !e.closest('[role=alert]') && !e.closest('[aria-live=assertive]')) out.push(`LIVE error state "${txt(e).slice(0, 30)}" is not role=alert`);
  for (const e of document.querySelectorAll('main *, .page *, .sc-empty, [aria-modal=true] *')) {
    if (e.children.length || !vis(e)) continue;
    const t = (e.textContent || '').trim();
    if (t.length < 60 && /^(loading|reading)\b.{0,40}(…|\.\.\.)$/i.test(t) && !live(e)) out.push(`LIVE loading text "${t}" is not in a status region (${desc(e)})`);
  }
  return out;
};
const walk = async () => {
  // Tab through the page: every visible, non-negative-tabindex control must receive focus
  const total = await p.evaluate(() => { window.__a11yReached = new Set(); document.addEventListener('focusin', (e) => window.__a11yReached.add(e.target), true);
    const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return (r.width > 0 || r.height > 0) && cs.visibility !== 'hidden' && cs.display !== 'none' && !e.closest('[aria-hidden="true"],[inert]'); };
    window.__a11yTabbable = [...document.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')].filter((e) => vis(e) && !e.disabled && e.tabIndex >= 0 && !e.closest('[role=tablist],[role=menu],[role=radiogroup],[data-roving]'));
    document.body.focus(); return window.__a11yTabbable.length; });
  const max = Math.min(await p.evaluate(() => document.querySelectorAll('button,a[href],input,select,textarea,[tabindex]').length) + 15, 600);
  for (let i = 0; i < max; i++) { await p.keyboard.press('Tab'); }
  return p.evaluate(() => window.__a11yTabbable.filter((e) => e.isConnected && !e.disabled && !window.__a11yReached.has(e)).map((e) => `NOTAB ${e.tagName.toLowerCase()}${e.className ? '.' + String(e.className).split(/\s+/)[0] : ''} "${(e.getAttribute('aria-label') || e.innerText || '').trim().slice(0, 30)}" never received focus in a Tab walk`));
};

// c57 (H12): the audit must run on a settled document. A fixed wait before one evaluate can land on a document that is
// still booting or being replaced (a dev-server full reload, a re-optimised dependency), which has no live region yet and
// reports `LIVE page has no live region` (backlog H12; it passed on re-run). The wait is on conditions: the app shell is
// mounted, and the document is the same one before and after the audit (else the audit is repeated). A settled page
// without a live region still fails exactly as before; a shell that never mounts is its own violation, not a false LIVE.
let injectReload = !!process.env.A11Y_INJECT_RELOAD; // test knob: replace the document right under the first audit
const auditStable = async (v) => {
  for (let attempt = 0; attempt < 4; attempt++) {
    try { await p.waitForFunction(() => !!document.querySelector('.rail-nav'), null, { timeout: 20000 }); }
    catch { return [`SHELL the app shell did not mount within 20 s (attempt ${attempt + 1}): ${await p.evaluate(() => JSON.stringify({ root: document.getElementById('root')?.children.length ?? null, auth: !!document.querySelector('.auth-card'), text: document.body.innerText.slice(0, 80) })).catch(() => 'page was navigating')}`]; }
    await settle(p, 400);
    try {
      const id0 = await p.evaluate(() => performance.timeOrigin);
      if (injectReload) { injectReload = false; const nav = p.waitForEvent('framenavigated'); await p.evaluate(() => { setTimeout(() => location.reload(), 0); }); await nav; }
      if (process.env.A11Y_STRIP_LIVE) await p.evaluate(() => document.querySelectorAll('[aria-live],[role=status],[role=alert],[role=log]').forEach((e) => e.remove())); // test knob: a settled page with no live region must still fail
      const found = await p.evaluate(audit);
      if (id0 === await p.evaluate(() => performance.timeOrigin)) return found;
    } catch { /* the document was replaced under the audit: wait for the new one */ }
    await p.waitForLoadState('domcontentloaded').catch(() => {});
    console.log(`note: ${v} the document was replaced during the audit; auditing the new one (attempt ${attempt + 2})`);
  }
  return [`SHELL the page kept reloading during the audit: ${v}`];
};
const all = []; // {where, msg}
const probed = [];
const pageErrs = [];
p.on('pageerror', (e) => pageErrs.push(e.message));
const t0 = Date.now();
let vi = 0;
const runViews = ROUTE ? Array.from({ length: REPEAT }, () => ROUTE) : PROBE ? [] : views;
for (const v of runViews) {
  const walkIt = !FAST && (vi++ % 3 === 0 || /assignments|conversations|appearance/.test(v)); // the Tab walk is the slow part: every third view plus the dense ones
  await p.goto(base + v, { waitUntil: navWait() }); await settle(p, 400);
  await p.waitForTimeout(150);
  const found = await auditStable(v);
  for (const m of found) all.push({ where: v, msg: m });
  if (walkIt) { const nt = await walk(); for (const m of nt) all.push({ where: v, msg: m }); }
}
if (ROUTE) { // race-hunting mode stops after the repeated route: no dialogs, no probes
  for (const { where, msg } of all) console.log(`VIOLATION ${msg}\n    e.g. ${where}`);
  console.log(`a11y-check ROUTE ${ROUTE} x${REPEAT} throttle ${THROTTLE || 'off'}: ${all.length} violations`);
  await b.close(); process.exit(all.length ? 1 : 0);
}
// dialogs
const bag = {
  missionId: 'M-126', agentId: 'coder-01', artifactId: 'M-126-A1', version: 'v1.0', approvalId: 'APR-M-126-1', taskId: 'T-12601',
  k: 'mission.aiSummary', mode: 'reply', question: 'Publish now?', replyTo: 'APR-M-126-1',
  message: { id: 'm1', from: 'gm', to: 'coder-01', kind: 'report', text: 'hello', agoMin: 3 },
  attachment: { id: 'a1', name: 'evidence.png', kind: 'image', size: '12 KB' },
};
await p.goto(base + '/overview', { waitUntil: navWait() }); await settle(p, 400);
const ids = PROBE ? [] : (await p.evaluate(() => window.__axion.dialogIds())).sort();
// a real, focusable opener so focus restore can be asserted
await p.evaluate(() => { const o = document.createElement('button'); o.id = 'a11y-opener'; o.textContent = 'opener'; o.style.cssText = 'position:fixed;left:0;bottom:0;z-index:1'; document.body.appendChild(o); });
for (const id of ids) {
  await p.evaluate(() => window.__axion.closeAll());
  await p.waitForFunction(() => !document.querySelector('[aria-modal=true]'), null, { timeout: 4000 }).catch(() => {});
  await p.focus('#a11y-opener');
  await p.evaluate(([id, props]) => window.__axion.openDialog(id, props), [id, bag]);
  const where = `dialog ${id}`;
  try { await p.waitForSelector('[aria-modal=true]', { timeout: 3000 }); } catch { all.push({ where, msg: 'DIALOG did not render' }); continue; }
  await p.waitForTimeout(120);
  const inside = () => p.evaluate(() => { const d = [...document.querySelectorAll('[aria-modal=true]')].pop(); return !!d && d.contains(document.activeElement) && document.activeElement !== d.querySelector('.modal-backdrop'); });
  if (!(await inside())) all.push({ where, msg: 'FOCUS did not move into the dialog on open' });
  for (const m of await p.evaluate(() => { const d = [...document.querySelectorAll('[aria-modal=true]')].pop(); return d ? 1 : 0; }) ? await p.evaluate(audit).then((l) => l.filter((x) => !/^LIVE page/.test(x))) : []) all.push({ where, msg: m });
  let trapped = true;
  const n = await p.evaluate(() => [...document.querySelectorAll('[aria-modal=true]')].pop().querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])').length);
  for (let i = 0; i < Math.min(n + 3, 40) && trapped; i++) { await p.keyboard.press('Tab'); if (!(await inside())) trapped = false; }
  for (let i = 0; i < 3 && trapped; i++) { await p.keyboard.press('Shift+Tab'); if (!(await inside())) trapped = false; }
  if (!trapped) all.push({ where, msg: 'TRAP Tab/Shift+Tab moved focus out of the dialog' });
  // cycle 23: Tab on the last control wraps to the first, Shift+Tab on the first wraps to the last
  const ring = () => p.evaluate(() => { const d = [...document.querySelectorAll('[aria-modal=true]')].pop(); if (!d) return null;
    const vis = (e) => { const r = e.getBoundingClientRect(); return !e.disabled && (r.width > 0 || r.height > 0) && getComputedStyle(e).visibility !== 'hidden'; };
    const l = [...d.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')].filter(vis);
    l.forEach((e, i) => e.setAttribute('data-a11y-i', String(i))); return l.length; });
  const nring = trapped ? await ring() : 0;
  if (nring >= 2) {
    const at = () => p.evaluate(() => { const a = document.activeElement; return a && a.hasAttribute('data-a11y-i') ? Number(a.getAttribute('data-a11y-i')) : -1; });
    await p.evaluate((n) => document.querySelector(`[data-a11y-i="${n - 1}"]`).focus(), nring);
    await p.keyboard.press('Tab');
    const afterTab = await at();
    if (afterTab !== 0) all.push({ where, msg: `WRAP Tab on the last control did not wrap to the first (landed on ${afterTab})` });
    await p.evaluate(() => document.querySelector('[data-a11y-i="0"]').focus());
    await p.keyboard.press('Shift+Tab');
    const afterShift = await at();
    if (afterShift !== nring - 1) all.push({ where, msg: `WRAP Shift+Tab on the first control did not wrap to the last (landed on ${afterShift})` });
  }
  await p.keyboard.press('Escape');
  const closed = await p.waitForFunction(() => !document.querySelector('[aria-modal=true]'), null, { timeout: 2500 }).then(() => true, () => false);
  if (!closed) { all.push({ where, msg: 'ESC did not close the dialog' }); continue; }
  const restored = await p.waitForFunction(() => document.activeElement && document.activeElement.id === 'a11y-opener', null, { timeout: 1500 }).then(() => true, () => false);
  if (!restored) all.push({ where, msg: 'RESTORE focus did not return to the opener on close' });
}
// cycle 23 (api mode): hold, then fail, the data requests of a few pages and check the loading / error text is announced
if (API) {
  // each probe must show its loading (slow) and failed (fail) state inside a live region, unless it lists a reason why the page has none
  const probes = [
    { v: '/overview', slow: /reading|loading/i, fail: /request failed|unavailable|could not/i },
    { v: '/operations?tab=agents&sub=live-instances', slow: /loading/i /* page skeleton (sr-only "Loading…") while the held request blocks the lazy page */, fail: /could not be read/i },
    { v: '/operations?tab=agents&sub=proposals', slow: /loading proposals/i, fail: /not loaded/i },
    { v: '/operations?tab=agents&sub=proposals', click: 'History', slow: /loading history/i, fail: /not loaded/i },
    { v: '/operations?tab=agents&sub=development', slow: /loading/i, fail: /not loaded/i },
    { v: '/agents/coder-01', slow: /loading instances/i, fail: /could not be read/i },
    { v: '/agents/coder-01?tab=evolution', slow: /loading proposals/i, fail: /not loaded/i },
    { v: '/missions/M-125?tab=hierarchy', slow: /loading/i, fail: /could not load/i },
    { v: '/missions/M-125?tab=task-flow', slow: /loading/i, fail: /could not load/i },
    { v: '/missions/M-125?tab=conversations', slow: /loading/i, fail: /could not load/i },
  ];
  let holdRevisions = false; // only the history probe holds the revisions request (the proposals page reads it too)
  const hit = /\/api\/v1\/(.*instances|agent-instances|.*agent-versions|.*versions|.*proposals|.*versions|company\/scorecard|organization\/graph|missions\/[^/]+\/(hierarchy|tasks|threads)|threads\/|channels\/|organization\/revisions)/;
  for (const mode of PROBE ? Array.from({ length: REPEAT }, () => ['slow', 'fail']).flat() : ['slow', 'fail']) {
    let release; const gate = new Promise((r) => { release = r; });
    await p.route(hit, async (route) => {
      if (route.request().method() !== 'GET' || route.request().url().includes('/stream') || (!holdRevisions && route.request().url().includes('organization/revisions'))) return route.continue();
      if (mode === 'slow') { await gate; return route.continue().catch(() => {}); }
      return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'internal', message: 'mocked failure' } }) });
    });
    for (const { v, slow, fail, none, click } of probes) {
      if (PROBE && !v.includes(PROBE)) continue;
      holdRevisions = !!click;
      if (LAZY_DELAY) await p.route(/\/src\/features\/agents\/(ServerProposals|VersionProposals)\.tsx(\?|$)/, async (r) => { await new Promise((res) => setTimeout(res, LAZY_DELAY)); await r.continue().catch(() => {}); }); // test knob (H18): the lazy proposals page arrives late
      await p.goto(base + v, { waitUntil: navWait() });
      await settle(p, mode === 'slow' ? 400 : 1000);
      if (click) { await p.locator('[aria-label="Proposals or history"]').getByText(click).click({ timeout: 8000 }).catch((e) => all.push({ where: `${v} (${mode})`, msg: `LIVEPROBE could not click ${click}: ${String(e.message).split('\n')[0]}` })); await settle(p, mode === 'slow' ? 400 : 1000); }
      // c73 (H18): wait for the state to be rendered before sampling it. The request is held open (slow) or answered with a
      // 500 (fail), so the loading / failed text is stable once the lazy page has mounted and asked; a fixed settle can sample
      // while the page is still the skeleton (a slow chunk under load) and report a missing live region that was only late.
      // The check below is unchanged: if the text never shows within the wait, it is still a LIVEPROBE violation.
      const liveSel = mode === 'slow' ? '[role=status]' : '[role=alert]', wantRe = mode === 'slow' ? slow : fail;
      if (!none?.[mode]) await p.waitForFunction(([sel, src, flags]) => new RegExp(src, flags).test([...document.querySelectorAll(sel)].map((e) => (e.innerText || e.textContent || '').replace(/\s+/g, ' ').trim()).join(' | ')), [liveSel, wantRe.source, wantRe.flags], { timeout: 15000 }).catch(() => {});
      const found = await p.evaluate(audit);
      for (const m of found) all.push({ where: `${v} (${mode})`, msg: m });
      probed.push(`${v} ${mode} [${await p.evaluate(() => (document.body.innerText.match(/(Loading|Reading)[^\n]{0,30}/g) || []).join(';'))}]: ${await p.evaluate(() => [...document.querySelectorAll('[role=status],[role=alert]')].map((e) => (e.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 40)).filter(Boolean).join(' | ').slice(0, 160))}`);
      const want = mode === 'slow' ? slow : fail;
      const seen = await p.evaluate((sel) => [...document.querySelectorAll(sel)].map((e) => (e.innerText || e.textContent || '').replace(/\s+/g, ' ').trim()).join(' | '), mode === 'slow' ? '[role=status]' : '[role=alert]');
      if (none?.[mode]) probed.push(`${v} ${mode}: no state expected (${none[mode]})`);
      else if (!want.test(seen)) all.push({ where: `${v} (${mode})`, msg: `LIVEPROBE no ${mode === 'slow' ? 'loading' : 'failed-load'} text matching ${want} in a live region (saw: ${seen.slice(0, 100)})` });
    }
    release(); await p.waitForTimeout(300); await p.unroute(hit, undefined).catch(() => {});
  }
}
const secs = ((Date.now() - t0) / 1000).toFixed(1);
const byKind = {};
for (const { msg } of all) { const k = msg.split(' ')[0]; byKind[k] = (byKind[k] || 0) + 1; }
const uniq = new Map();
for (const { where, msg } of all) { const k = /^LIVE/.test(msg) ? msg : msg.replace(/"[^"]*"/g, '"…"'); if (!uniq.has(k)) uniq.set(k, []); uniq.get(k).push(where); }
for (const [k, w] of uniq) console.log(`VIOLATION x${w.length} ${k}\n    e.g. ${w.slice(0, 3).join(' | ')}`);
if (pageErrs.length) console.log('page errors:', pageErrs.slice(0, 3).join(' | '));
for (const l of probed) console.log('probe', l);
console.log(`a11y-check (${API ? 'api' : 'demo'}): ${runViews.length} views, ${ids.length} dialogs, ${all.length} violations ${JSON.stringify(byKind)} in ${secs}s`);
await b.close();
process.exit(all.length ? 1 : 0);
