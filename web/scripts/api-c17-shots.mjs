// Cycle 17: light-mode screenshots of the Help "What's new" guide, the Stage 6 screens and the improvement-loop screens
// (api mode). Run: ./scripts/api-e2e.sh "DATA_MODE=api node scripts/api-c17-shots.mjs"  -> docs/screenshots/c17-*-light.png
import { chromium } from 'playwright';
import { signIn, settle } from './_session.mjs';
const base = process.env.BASE || 'http://127.0.0.1:5193';
const out = new URL('../docs/screenshots/', import.meta.url).pathname;
const b = await chromium.launch({ executablePath: process.env.PW_CHROME || '/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome' });
const ctx = await b.newContext({ viewport: { width: 1600, height: 940 } });
await signIn(ctx);
await ctx.addInitScript(() => { try { localStorage.setItem('axion.settings.v1', JSON.stringify({ state: { themeMode: 'light', motion: 'reduced' }, version: 0 })); } catch { /* ignore */ } });
const p = await ctx.newPage();
const until = async (f, ms = 12000) => { const t0 = Date.now(); for (;;) { try { if (await f()) return true; } catch { /* retry */ } if (Date.now() - t0 > ms) return false; await new Promise((r) => setTimeout(r, 150)); } };
const shots = [
  ['help-new-features', '/help?tab=new-features&f=proposals', '[data-wn-detail="proposals"]'],
  ['help-new-features-later', '/help?tab=new-features&f=history', '[data-wn-detail="history"]'],
  ['agents-directory', '/operations?tab=agents&sub=directory', '[role=tabpanel]'],
  ['agents-live-instances', '/operations?tab=agents&sub=live-instances', '[data-live-instances]'],
  ['agents-proposals', '/operations?tab=agents&sub=proposals', '[role=tabpanel]'],
  ['mission-hierarchy', '/missions/M-126?tab=hierarchy', '[role=tabpanel]'],
  ['mission-conversations', '/missions/M-126?tab=conversations', '[role=tabpanel]'],
  ['admin-line', '/overview?chat=admin', '[data-dialog="chat-dock"]'],
  ['scorecard', '/overview', '[data-scorecard="ready"]'],
  ['agent-reliability', '/agents/coder-01', '[role=tabpanel]'],
];
const done = [];
for (const [name, path, sel] of shots) {
  await p.goto(base + path, { waitUntil: 'domcontentloaded' }); await settle(p, 200);
  const ok = await until(async () => (await p.locator(sel).count()) > 0);
  await p.waitForTimeout(600);
  await p.screenshot({ path: out + `c17-${name}-light.png` });
  done.push(`${ok ? 'ok' : 'MISSING-SELECTOR'} ${name}`);
}
console.log(done.join('\n'));
await b.close();
process.exit(done.some((d) => d.startsWith('MISSING')) ? 1 : 0);
