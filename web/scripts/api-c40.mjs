// c40: the three layout families api-mobile found, probed directly (api mode): Activity cards, ? help popovers, DL-75 at phone/tablet width.
// Run through scripts/api-e2e.sh. FAIL lines: an act-card past the viewport, a help popover outside the viewport, DL-75 wider than the viewport.
import { chromium } from 'playwright';
import { signIn, settle } from './_session.mjs';
const base = process.env.BASE || 'http://127.0.0.1:5193';
const b = await chromium.launch({ executablePath: process.env.PW_CHROME || '/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome' });
import { mkdirSync } from 'node:fs';
const SHOTS = process.env.SHOTS; if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const fails = []; const SIZES = [[390, 844], [900, 1000], [1280, 760]];
for (const [W, H] of SIZES) {
  const ctx = await b.newContext({ viewport: { width: W, height: H }, hasTouch: W < 1000 }); await signIn(ctx, 'Luca');
  const p = await ctx.newPage(); p.setDefaultTimeout(4000);
  const api = async (path) => { if (!p.url() || p.url()==='about:blank') { await p.goto(base + '/overview', { waitUntil: 'domcontentloaded' }); await settle(p, 400); } return api0(path); };
  const api0 = async (path) => (await ctx.request.get(base + '/api/v1' + path)).json().catch(() => ({}));
  const go = async (path) => { await p.goto(base + path, { waitUntil: 'domcontentloaded' }); await settle(p, 400); await p.waitForTimeout(300); };
  const ms = (await api('/missions')); const list = ms.missions || ms.items || [];
  const demo = list.find((m) => m.demo) || list[0];
  // 1. Activity cards
  if (demo) { await go(`/missions/${demo.id}?tab=Activity`); await p.locator('[data-tab="Activity"]').first().click({ force: true }).catch(() => {}); await p.waitForTimeout(900);
    const cards = await p.evaluate(() => [...document.querySelectorAll('.act-card')].map((c) => { const r = c.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right)]; }));
    await p.locator('.act-card').first().evaluate((e) => e.scrollIntoView({ block: 'center', behavior: 'instant' })).catch(() => {}); await p.waitForTimeout(300);
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/activity-${W}.png` });
    console.log(`${W} act-cards=${cards.length} ${JSON.stringify(cards.slice(0, 2))}`);
    if (!cards.length) fails.push(`FAIL ${W}: no act-card found (probe cannot see the Activity tab)`);
    for (const c of cards) if (c[1] > W + 1 || c[0] < -1) fails.push(`FAIL ${W}: act-card ${c} outside ${W}px`);
    const ic = await p.evaluate(() => [...document.querySelectorAll('.act-card .icon-btn')].map((e) => Math.round(e.getBoundingClientRect().right)));
    for (const r of ic) if (r > W + 1) fails.push(`FAIL ${W}: act-card icon button right=${r}`);
  }
  // 2. help popovers on several pages
  let n = 0, bad = 0;
  for (const path of ['/overview', '/missions', demo ? `/missions/${demo.id}` : '/missions', '/operations', '/settings']) {
    await go(path); await p.waitForFunction(() => document.querySelectorAll('.help-btn').length > 1, null, { timeout: 10000 }).catch(() => {}); /* condition wait: at 390 px the page body is still skeletons after settle() */ const hb = p.locator(process.env.C40_HELP_SEL || '.help-btn'); const cnt = Math.min(await hb.count(), 12);
    for (let i = 0; i < cnt; i++) {
      await hb.nth(i).evaluate((e) => e.scrollIntoView({ block: 'center', behavior: 'instant' })).catch(() => {}); await hb.nth(i).click({ force: true, timeout: 1500 }).catch(() => {}); await p.waitForSelector('.help-pop', { timeout: 1500 }).catch(() => {}); await p.waitForTimeout(150);
      const r = await p.evaluate(() => { const e = document.querySelector('.help-pop'); if (!e) return null; const r = e.getBoundingClientRect(); return [Math.round(r.top), Math.round(r.bottom), Math.round(r.left), Math.round(r.right)]; });
      if (r && SHOTS && i === 7 && path === '/overview') await p.screenshot({ path: `${SHOTS}/help-${W}.png` });
      if (r) { n++; if (r[0] < 0 || r[1] > H + 1 || r[2] < 0 || r[3] > W + 1) { bad++; fails.push(`FAIL ${W} ${path}: help popover #${i} at top/bottom/left/right ${r} outside ${W}x${H}`); } }
      await p.keyboard.press('Escape'); await p.waitForSelector('.help-pop', { state: 'detached', timeout: 1500 }).catch(() => {});
    }
  }
  console.log(`${W} help popovers measured=${n} outside=${bad}`);
  if (n < 5) fails.push(`FAIL ${W}: only ${n} help popovers opened (the probe must measure at least 5, otherwise it proves nothing)`);
  // 3. DL-75
  const ag = await api('/agents'); const aid = (ag.agents || ag.items || [])[1]?.id || (ag.agents || ag.items || [])[0]?.id;
  if (aid) { await go(`/agents/${aid}?tab=Evolution`); await p.locator('[data-tab="Evolution"]').first().click({ force: true }).catch(() => {}); await p.waitForTimeout(900); const bt = p.getByRole('button', { name: /Propose a change/ }).first();
    if (await bt.count()) { await bt.evaluate((e) => e.scrollIntoView({ block: 'center', behavior: 'instant' })).catch(() => {}); await bt.click({ force: true }).catch(() => {}); await p.waitForTimeout(900);
      const d = await p.evaluate(() => { const e = document.querySelector('[role=dialog]'); if (!e) return null; const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right), Math.round(r.width)]; });
      if (SHOTS) await p.screenshot({ path: `${SHOTS}/dl75-${W}.png` });
      console.log(`${W} DL-75 ${JSON.stringify(d)}`); if (!d) fails.push(`FAIL ${W}: DL-75 did not open`); else if (d[0] < -1 || d[1] > W + 1) fails.push(`FAIL ${W}: DL-75 ${d} outside ${W}px`);
    } else fails.push(`FAIL ${W}: no Propose a change button`); }
  await ctx.close();
}
await b.close(); console.log(fails.length ? fails.join('\n') : 'NO FAILURES'); process.exit(fails.length ? 1 : 0);
