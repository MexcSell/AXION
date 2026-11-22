// Cycle 34 (lane w32): the demo staffing driver must never advance a mission that is archived or paused.
// Strengthened c29 check: a store subscription (inside the page) records EVERY change to a mission after it reached
// the stopped status, instead of only checking the final state. Missions are stopped at staggered phases of the 1.5 s
// tick, CPU throttled so React commits lag behind the store.
// Usage: BASE=http://127.0.0.1:8290 [STOP=archived|paused] [K=14] [THROTTLE=8] node scripts/c34-archive-race.mjs   (exit 1 on a violation)
import { chromium } from 'playwright';
import { signIn } from './_session.mjs';
const base = process.env.BASE || 'http://127.0.0.1:5190';
const K = Number(process.env.K || 14), THROTTLE = Number(process.env.THROTTLE || 8), STOP = process.env.STOP || 'archived';
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
const violations = await p.evaluate(async ({ ids, STOP }) => {
  const d = window.__axion.data;
  const sig = (m) => JSON.stringify([m.status, m.agentIds, m.staffing, m.progress, m.lastEvent]);
  const frozen = new Map(); const bad = [];
  const unsub = d.subscribe((s) => {
    for (const id of ids) {
      const m = s.missions.find((x) => x.id === id); if (!m) continue;
      if (frozen.has(id)) { if (sig(m) !== frozen.get(id)) { bad.push(`${id}: changed after ${STOP}`); frozen.set(id, sig(m)); } }
      else if (m.status === STOP) frozen.set(id, sig(m));
    }
  });
  // stop mission i after i*450 ms (every phase of the 1.5 s tick, up to the final planning -> running step)
  await Promise.all(ids.map((id, i) => new Promise((r) => setTimeout(() => { d.getState().setMissionStatus(id, STOP); r(); }, i * 450))));
  await new Promise((r) => setTimeout(r, 14000)); // staffing would be complete by now
  unsub();
  const left = ids.filter((id) => d.getState().missions.find((m) => m.id === id)?.status !== STOP);
  for (const id of left) bad.push(`${id}: not ${STOP} at the end`);
  return bad;
}, { ids, STOP });
const badIds = new Set(violations.map((v) => v.split(':')[0]));
console.log(`${STOP}: ${ids.length - badIds.size}/${ids.length} clean` + (violations.length ? `  VIOLATIONS: ${violations.join('; ')}` : ''));
await b.close();
process.exit(violations.length ? 1 : 0);
