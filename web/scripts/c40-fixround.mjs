// c40 fix round (demo mode, BASE=dev server): keyboard-scrollable help popover, no 2 px clamp, Activity KPI tiles never overlap at phone width.
import { chromium } from 'playwright';
import { signIn, settle } from './_session.mjs';
const base = process.env.BASE || 'http://127.0.0.1:5190';
const b = await chromium.launch({ executablePath: process.env.PW_CHROME || '/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome' });
let bad = 0; const t = (n, ok, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n} ${x}`); if (!ok) bad++; };
const open = async (W, H) => { const ctx = await b.newContext({ viewport: { width: W, height: H } }); await signIn(ctx); const p = await ctx.newPage(); return [ctx, p]; };
const go = async (p, path) => { await p.goto(base + path, { waitUntil: 'domcontentloaded' }); await settle(p, 400); await p.waitForTimeout(2200); };
const popInfo = (p) => p.evaluate(() => { const e = document.querySelector('.help-pop-body'); const pop = document.querySelector('.help-pop'); if (!e) return null; const r = pop.getBoundingClientRect(); return { sh: e.scrollHeight, ch: e.clientHeight, st: e.scrollTop, tab: e.getAttribute('tabindex'), role: e.getAttribute('role'), label: e.getAttribute('aria-label'), bottom: Math.round(r.bottom) }; });
const openActive = async (p) => { // the Overview help popover with the longest body (the "Active agents" one in the review)
  const n = await p.locator('.help-btn').count(); let best = -1, bestSh = 0;
  for (let k = 0; k < n; k++) { const btn = p.locator('.help-btn').nth(k); await btn.scrollIntoViewIfNeeded().catch(() => {}); await btn.click({ force: true }); await p.waitForTimeout(700); const i = await popInfo(p); if (i && i.sh > bestSh) { bestSh = i.sh; best = k; } await p.keyboard.press('Escape'); await p.waitForTimeout(150); }
  const btn = p.locator('.help-btn').nth(best); await btn.scrollIntoViewIfNeeded(); await btn.focus(); await p.keyboard.press('Enter'); await p.waitForSelector('.help-pop-body'); await p.waitForTimeout(300); return btn; };
// 1. short viewport: keyboard reaches the end of the body, Escape returns focus
{ const [ctx, p] = await open(1280, 520); await go(p, '/overview'); const btn = await openActive(p);
  let i = await popInfo(p); t('1280x520 the popover body overflows (test premise)', i && i.sh > i.ch + 1, JSON.stringify(i));
  t('body is a labelled, focusable region', i?.tab === '0' && i?.role === 'region' && /help/i.test(i?.label || ''), JSON.stringify(i));
  let reached = false; for (let k = 0; k < 6; k++) { reached = await p.evaluate(() => document.activeElement?.classList.contains('help-pop-body')); if (reached) break; await p.keyboard.press('Tab'); }
  t('Tab reaches the body', reached);
  await p.keyboard.press('ArrowDown'); await p.keyboard.press('ArrowDown'); await p.waitForTimeout(400); i = await popInfo(p); t('ArrowDown scrolls it', i.st > 0, `scrollTop ${i.st}`);
  await p.keyboard.press('PageDown'); await p.keyboard.press('PageDown'); await p.keyboard.press('End'); await p.waitForTimeout(600); i = await popInfo(p); t('PageDown/End reach the end', i.st >= i.sh - i.ch - 1, `scrollTop ${i.st} of ${i.sh - i.ch}`);
  const ring = await p.evaluate(() => { const e = document.querySelector('.help-pop-body'); const s = getComputedStyle(e); return s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0; });
  t('focus ring is visible on the body', ring);
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  t('Escape closes it and focus returns to the ? trigger', !(await p.locator('.help-pop').count()) && (await btn.evaluate((e) => e === document.activeElement)));
  await ctx.close(); }
// 2. 1280x760: the nearly fitting popover has no pointless scroll
{ const [ctx, p] = await open(1280, 760); await go(p, '/overview'); await openActive(p); const i = await popInfo(p);
  t('1280x760 the Active agents popover shows everything (no 2 px clamp)', i && i.sh <= i.ch, JSON.stringify(i)); await ctx.close(); }
// 3. Activity KPI strip at phone width
for (const W of [390, 900]) { const [ctx, p] = await open(W, 844); await go(p, '/missions/M-126?tab=Activity'); await p.locator('[data-tab="Activity"]').first().click({ force: true }).catch(() => {}); await p.waitForTimeout(900);
  const r = await p.evaluate(() => { const k = [...document.querySelectorAll('.act-kpi')].map((e) => { const r = e.getBoundingClientRect(); const v = e.querySelector('.kpi-val'); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, vw: v.scrollWidth <= v.clientWidth + 1 && v.getBoundingClientRect().height < 30, lab: e.querySelector('.kpi-label').scrollWidth <= e.querySelector('.kpi-label').clientWidth + 1 }; }); return k; });
  let overlap = 0; for (let a = 0; a < r.length; a++) for (let c = a + 1; c < r.length; c++) if (r[a].l < r[c].r - 1 && r[c].l < r[a].r - 1 && r[a].t < r[c].b - 1 && r[c].t < r[a].b - 1) overlap++;
  t(`${W}: ${r.length} KPI tiles, none overlap`, r.length === 5 && overlap === 0, `overlaps ${overlap}`);
  if (W === 390) { t('390: every tile is wide enough (>=140 px), values on one line, labels not clipped', r.every((x) => x.w >= 140 && x.vw && x.lab), JSON.stringify(r.map((x) => Math.round(x.w)))); }
  await ctx.close(); }
await b.close(); process.exit(bad ? 1 : 0);
