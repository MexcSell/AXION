// Cycle 29 (lane w27): an archived mission must stay archived while the demo staffing driver is still advancing it.
// Creates K demo missions, archives each at a different moment inside the staffing ticks (CPU throttled so React renders
// lag behind the store), then checks that every one is still archived after staffing would have finished.
// Usage: BASE=http://127.0.0.1:7790 [K=14] [THROTTLE=8] node scripts/c29-archive-race.mjs   (exit 1 on any un-archived mission)
import { chromium } from 'playwright';
import { signIn } from './_session.mjs';
const base = process.env.BASE || 'http://127.0.0.1:5190';
const K = Number(process.env.K || 14), THROTTLE = Number(process.env.THROTTLE || 8);
const b = await chromium.launch({ executablePath: process.env.PW_CHROME || '/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome' });
const ctx = await b.newContext({ viewport: { width: 1672, height: 941 } });
await signIn(ctx);
const p = await ctx.newPage();
await p.goto(base + '/missions', { waitUntil: 'networkidle' });
await p.waitForFunction(() => !!window.__axion?.data);
const cdp = await ctx.newCDPSession(p);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
const ids = await p.evaluate(async (K) => {
  const d = window.__axion.data; const out = [];
  for (let i = 0; i < K; i++) { const m = await d.getState().addMission({ text: `race ${i}: refresh the pricing page`, files: [], shared: false }, { id: 'u-1', name: 'Luca' }); out.push(m.id); }
  return out;
}, K);
// archive mission i after i*450 ms, i.e. at every phase of the 1.5 s staffing tick, up to the final planning -> running step
await p.evaluate(async (ids) => {
  const d = window.__axion.data;
  await Promise.all(ids.map((id, i) => new Promise((r) => setTimeout(() => { d.getState().archiveMission(id); r(); }, i * 450))));
}, ids);
await p.waitForTimeout(14000); // staffing would be complete by now
const st = await p.evaluate((ids) => ids.map((id) => window.__axion.data.getState().missions.find((m) => m.id === id)?.status), ids);
const bad = ids.filter((_, i) => st[i] !== 'archived');
console.log(`archived ${ids.length - bad.length}/${ids.length}` + (bad.length ? `  NOT archived: ${bad.map((id) => id + '=' + st[ids.indexOf(id)]).join(', ')}` : ''));
await b.close();
process.exit(bad.length ? 1 : 0);
