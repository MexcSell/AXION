// c82 (c54 re-review): tab-strip scroll effects at 390 px, on the System Operations > Agents sub-strip.
//  A. a parent re-render (typing in the search box next to the strip) must not snap a scrolled-away strip back to the selected tab;
//  B. a focused, NON-selected tab is scrolled fully out of the 28 px edge fade, from either side.
// Demo: BASE=<dev server> node scripts/api-c82-strip-effects.mjs.  Api: scripts/api-e2e.sh api-c82-strip-effects.mjs
import { chromium } from 'playwright';
import { signIn, settle, navWait } from './_session.mjs';
const base = process.env.BASE || 'http://127.0.0.1:5193';
const b = await chromium.launch({ executablePath: process.env.PW_CHROME || '/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome' });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 } }); await signIn(ctx, 'Luca');
const p = await ctx.newPage(); p.setDefaultTimeout(10000);
await p.goto(base + '/operations?tab=agents&sub=directory', { waitUntil: navWait() }); await settle(p);
const strip = p.locator('[role=tablist][aria-label="Agents views"]');
await strip.waitFor();
const fails = []; const pass = (m) => console.log('PASS ' + m); const fail = (m) => { fails.push(m); console.log('FAIL ' + m); };
const frames = () => p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const st = () => strip.evaluate((e) => ({ left: e.scrollLeft, max: e.scrollWidth - e.clientWidth, fade: e.getAttribute('data-fade') }));
const s0 = await st();
if (s0.max < 20) fail(`precondition: the strip must scroll at 390 px (scrollWidth - clientWidth = ${s0.max})`);
// A. snap-back
await strip.evaluate((e) => { e.scrollLeft = e.scrollWidth; }); await frames();
const away = (await st()).left;
await p.locator('input[placeholder^="Search agents"]').fill('cod'); // parent state changes, the tab list is rebuilt, the selected tab (Directory, first) is unchanged
await p.waitForFunction(() => document.querySelector('input[placeholder^="Search agents"]').value === 'cod'); await frames();
const after = (await st()).left;
if (away > 20 && after === away) pass(`A: a parent re-render left the scrolled strip alone (${away} -> ${after})`);
else fail(`A: a parent re-render moved the scrolled strip ${away} -> ${after} (selected tab = Directory, the first)`);
// B. focus a non-selected tab: it must end up fully inside the unfaded area
const clear = async (label, name) => {
  const tab = strip.locator('[role=tab]').filter({ hasText: name }).first();
  await tab.evaluate((t) => t.focus());
  await frames();
  const r = await strip.evaluate((e, nm) => {
    const t = [...e.querySelectorAll('[role=tab]')].find((x) => (x.textContent || '').includes(nm)); const sr = e.getBoundingClientRect(), tr = t.getBoundingClientRect();
    const sc = e.scrollLeft, max = e.scrollWidth - e.clientWidth;
    return { fromLeft: Math.round(tr.left - sr.left), fromRight: Math.round(sr.right - tr.right), atStart: sc <= 1, atEnd: sc >= max - 1, selected: t.getAttribute('aria-selected') };
  }, name);
  // an edge with no fade (strip at its start/end) needs no margin; every other edge must keep the tab 28 px clear
  const okL = r.atStart || r.fromLeft >= 28, okR = r.atEnd || r.fromRight >= 28;
  if (r.selected === 'true') fail(`B ${label}: "${name}" is selected, the test needs a non-selected tab`);
  else if (okL && okR) pass(`B ${label}: focused "${name}" sits clear of the fade (left ${r.fromLeft}px, right ${r.fromRight}px)`);
  else fail(`B ${label}: focused "${name}" sits inside the 28 px edge fade (left ${r.fromLeft}px, right ${r.fromRight}px, atStart ${r.atStart}, atEnd ${r.atEnd})`);
};
const tabsN = await strip.locator('[role=tab]').count();
const names = await strip.locator('[role=tab]').evaluateAll((ts) => ts.map((t) => t.getAttribute('data-tab') || t.textContent.trim()));
// a middle tab from each side: scrolled to the start, then to the end
for (const [label, fromEnd] of [['from the start', false], ['from the end', true]]) {
  await strip.evaluate((e, end) => { e.scrollLeft = end ? e.scrollWidth : 0; }, fromEnd); await frames();
  const target = names[fromEnd ? 1 : Math.min(tabsN - 2, names.length - 2)];
  await clear(label, target);
}
await b.close();
console.log(fails.length ? `${fails.length} FAIL` : 'ALL PASS');
process.exit(fails.length ? 1 : 0);
