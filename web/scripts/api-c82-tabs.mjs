// c82 (H16): label-overlap probe for every tab strip, at 390x844 and 1280x760.
// Per visible tab: (a) its label box intersects no OTHER tab's box, (b) its label sits inside its own tab box and is never clipped
// (scrollWidth > clientWidth) unless the tab is an icon-only state (text hidden, accessible name kept in aria-label/title).
// Exports probeStrips(page) for api-mobile.mjs; run alone: DATA_MODE=api via scripts/api-e2e.sh, or demo with BASE=<dev server>.
// VIEWS_RE=regex limits the views. SHOTS=dir saves a screenshot of each probed route/size; INJECT=1 first injects an overlap (negative margins) to prove the probe goes RED.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { signIn, settle, navWait } from './_session.mjs';

export const PROBE = () => {
  const out = [];
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width >= 1 && r.height >= 1 && s.visibility !== 'hidden' && s.display !== 'none' && !el.closest('[aria-hidden="true"],[inert]'); };
  const lists = [...document.querySelectorAll('[role=tablist]')].filter(vis);
  lists.forEach((l, li) => {
    const sname = l.getAttribute('aria-label') || `strip${li}`;
    const tabs = [...l.querySelectorAll('[role=tab]')].filter(vis);
    const boxes = tabs.map((t) => {
      const label = t.querySelector('.tab-label') || t; const text = t.querySelector('.tab-text') || (t.querySelector('.tab-label') ? null : t);
      const ts = text ? getComputedStyle(text) : null; const textShown = !!text && ts.display !== 'none' && text.getBoundingClientRect().width >= 1;
      // the visible content: icon, shown text and count, as one box
      const parts = label === t ? (() => { const rg = document.createRange(); rg.selectNodeContents(t); return [{ getBoundingClientRect: () => rg.getBoundingClientRect() }]; })() : [...label.children].filter((c) => getComputedStyle(c).display !== 'none');
      let L = Infinity, R = -Infinity, T = Infinity, B = -Infinity;
      for (const c of parts) { const r = c.getBoundingClientRect(); L = Math.min(L, r.left); R = Math.max(R, r.right); T = Math.min(T, r.top); B = Math.max(B, r.bottom); }
      return { t, name: (t.getAttribute('aria-label') || t.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24), tr: t.getBoundingClientRect(), content: parts.length ? { l: L, r: R, t: T, b: B } : null, text, textShown, label };
    });
    const hit = (a, b) => a.l < b.right - 1 && a.r > b.left + 1 && a.t < b.bottom - 1 && a.b > b.top + 1;
    boxes.forEach((a, i) => {
      if (a.content) {
        boxes.forEach((o, j) => { if (i !== j && hit(a.content, o.tr)) out.push(`${sname}: label of "${a.name}" overlaps tab "${o.name}"`); });
        if (a.content.l < a.tr.left - 1 || a.content.r > a.tr.right + 1) out.push(`${sname}: label of "${a.name}" spills outside its own tab (${Math.round(a.content.l - a.tr.left)}/${Math.round(a.content.r - a.tr.right)}px)`);
      }
      if (a.textShown && a.text.scrollWidth > a.text.clientWidth + 1) out.push(`${sname}: label "${a.name}" is clipped (scrollWidth ${a.text.scrollWidth} > ${a.text.clientWidth})`);
      // +2: Chrome rounds the fractional width of scrollWidth and clientWidth apart by 1 px (seen on demo) and up to 2 px (seen on M-134); the spill check above is the exact one
      if (a.t.scrollWidth > a.t.clientWidth + 2) out.push(`${sname}: tab "${a.name}" content is clipped by its button (scrollWidth ${a.t.scrollWidth} > ${a.t.clientWidth})`);
      // icon-only state: the accessible name must survive
      if (!a.textShown && !(a.t.getAttribute('aria-label') || '').trim()) out.push(`${sname}: tab "${a.name}" shows no text and has no aria-label`);
      // a label cut by the strip's own scroll edge, when the strip is not scrollable-with-affordance, is clipped; with data-fade it is reachable
      const sr = l.getBoundingClientRect();
      if ((a.tr.left < sr.left - 1 || a.tr.right > sr.right + 1) && !l.hasAttribute('data-fade')) out.push(`${sname}: tab "${a.name}" is cut by the strip edge with no scroll affordance (data-fade)`);
    });
  });
  return { strips: lists.length, tabs: lists.reduce((n, l) => n + [...l.querySelectorAll('[role=tab]')].filter(vis).length, 0), problems: [...new Set(out)] };
};

/** Every strip view the app has (route + tab/sub), as paths. */
export const VIEWS = (mid, aid) => [
  '/overview', '/overview?tab=needs-you', '/overview?tab=portfolio', '/overview?tab=activity', '/overview?tab=health',
  ...['services', 'vms', 'agents', 'models', 'workers', 'queues', 'storage', 'logs', 'recovery'].map((t) => `/operations?tab=${t}`),
  ...['directory', 'development', 'lineage', 'live-instances', 'departments', 'assignments', 'policies', 'proposals', 'dimensions'].map((t) => `/operations?tab=agents&sub=${t}`),
  ...['manager', 'providers', 'routing', 'playground', 'usage', 'health'].map((t) => `/operations?tab=models&sub=${t}`),
  '/agents', mid && `/missions/${mid}`, mid && `/missions/${mid}?tab=approvals`, aid && `/agents/${aid}`, aid && `/agents/${aid}?tab=performance`,
  '/missions', '/notifications', '/notifications?tab=pending', '/results', '/settings', '/help',
].filter(Boolean);

/** Probe one page at the current size: returns FAIL lines (empty when every strip is clean). */
export async function probeStrips(p, tag) {
  const r = await p.evaluate(PROBE);
  return { strips: r.strips, tabs: r.tabs, fails: r.problems.map((x) => `FAIL ${tag}: ${x}`) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const base = process.env.BASE || 'http://127.0.0.1:5193';
  const SHOTS = process.env.SHOTS; if (SHOTS) mkdirSync(SHOTS, { recursive: true });
  const INJECT = process.env.INJECT === '1';
  const b = await chromium.launch({ executablePath: process.env.PW_CHROME || '/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome' });
  const fails = []; let strips = 0, tabs = 0, views = 0;
  for (const [W, H] of [[390, 844], [1280, 760]]) {
    const ctx = await b.newContext({ viewport: { width: W, height: H } }); await signIn(ctx, 'Luca');
    const p = await ctx.newPage(); p.setDefaultTimeout(8000);
    if (INJECT) await p.addInitScript(() => { const s = document.createElement('style'); s.textContent = '.tab{margin-right:-24px !important} .tab .tab-text{letter-spacing:.2em}'; document.addEventListener('DOMContentLoaded', () => document.head.appendChild(s)); });
    const api = async (path) => (await ctx.request.get(base + '/api/v1' + path)).json().catch(() => ({}));
    let mid = 'M-126', aid = 'coder-01';
    if (process.env.DATA_MODE === 'api') { const ms = await api('/missions'); mid = (ms.missions || ms.items || [])[0]?.id; const ag = await api('/agents'); aid = (ag.agents || ag.items || [])[0]?.id; }
    for (const path of VIEWS(mid, aid).filter((v) => !process.env.VIEWS_RE || new RegExp(process.env.VIEWS_RE).test(v))) {
      await p.goto(base + path, { waitUntil: navWait() }); await settle(p);
      await p.waitForSelector('[role=tablist]', { timeout: 8000 }).catch(() => {});
      const r = await probeStrips(p, `${W} ${path}`); views++; strips += r.strips; tabs += r.tabs; fails.push(...r.fails);
      console.log(`  . ${W} ${path} strips=${r.strips} tabs=${r.tabs} problems=${r.fails.length}`);
      if (SHOTS && /^\/(overview|agents|missions|notifications)?(\?|$)|tab=(services|agents|models)|\/agents\/|\/missions\//.test(path) && !path.includes('&sub=') ) await p.screenshot({ path: `${SHOTS}/${W}-${path.replace(/\W+/g, '_')}.png` }).catch(() => {});
    }
    await ctx.close();
  }
  await b.close();
  console.log(`tab strips probed: ${strips} strips, ${tabs} tabs over ${views} views`);
  const f = [...new Set(fails)]; console.log(f.length ? f.join('\n') : 'NO FAILURES');
  process.exit(f.length ? 1 : 0);
}
