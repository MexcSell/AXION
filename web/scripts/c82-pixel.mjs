// c82: the 1366x768 / 1280x760 tab strips must be pixel-equivalent after the strip fix. "Before" = the same page with the c82 rule
// (.tabs > .tab { flex: none }) turned back into the old default (flex: 0 1 auto) through addStyleTag; "after" = as shipped.
// Compares every visible [role=tablist] element's screenshot byte for byte. Usage: BASE=<dev server> node scripts/c82-pixel.mjs [shotDir]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { signIn, settle, navWait, calm } from './_session.mjs';
const base = process.env.BASE || 'http://127.0.0.1:5190'; const shots = process.argv[2];
if (shots) mkdirSync(shots, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.PW_CHROME || '/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome' });
const paths = ['/overview', '/overview?tab=needs-you', '/overview?tab=portfolio', '/overview?tab=activity', '/overview?tab=health', '/agents', '/missions/M-126', '/missions/M-126?tab=approvals', '/agents/coder-01', '/agents/coder-01?tab=performance', '/notifications', '/results', '/settings', '/help',
  '/operations?tab=services', '/operations?tab=agents&sub=directory', '/operations?tab=agents&sub=dimensions', '/operations?tab=models&sub=manager', '/operations?tab=models&sub=health', '/operations?tab=logs'];
let diff = 0, n = 0;
for (const [W, H] of [[1366, 768], [1280, 760]]) {
  const ctx = await b.newContext({ viewport: { width: W, height: H } }); await signIn(ctx);
  await ctx.addInitScript(() => { localStorage.setItem('axion.settings.v1', JSON.stringify({ state: { themeMode: 'dark', skin: 'luminous', motion: 'reduced' }, version: 0 })); });
  const p = await ctx.newPage();
  for (const path of paths) {
    await p.goto(base + path, { waitUntil: navWait() }); await settle(p); await p.waitForSelector('[role=tablist] [role=tab]'); await calm(p);
    const grab = async () => { const out = []; const l = p.locator('[role=tablist]'); for (let i = 0; i < await l.count(); i++) if (await l.nth(i).isVisible()) out.push(await l.nth(i).screenshot({ animations: 'disabled' })); return out; };
    const after = await grab();
    const st = await p.addStyleTag({ content: '.tabs > .tab { flex: 0 1 auto !important; }' }); await calm(p);
    const before = await grab(); await st.evaluate((e) => e.remove());
    const same = after.length === before.length && after.every((a, i) => a.equals(before[i]));
    n++; if (!same) diff++;
    console.log(`${same ? 'same' : 'DIFF'} ${W}x${H} ${path} strips=${after.length}`);
  }
  await ctx.close();
}
console.log(diff ? `${diff}/${n} views differ` : `ALL IDENTICAL (${n} views)`);
await b.close(); process.exit(diff ? 1 : 0);
