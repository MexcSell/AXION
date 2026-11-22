// Cycle 29 (lane w27), strengthened by cycle 34 (lane w32) and folded into one script in batch 8b: the demo staffing
// driver must never advance a mission that is archived or paused.
// Creates K demo missions and stops each at a different moment inside the staffing ticks (every phase of the 1.5 s
// tick, CPU throttled so React renders lag behind the store). Two checks:
//   1. a store subscription inside the page records EVERY change to a mission after it reached the stopped status (c34);
//   2. every mission is still in the stopped status after staffing would have finished (c29's final-state check).
// STOP=archived goes through archiveMission (the trash icon's action); STOP=paused through setMissionStatus.
// Usage: BASE=http://127.0.0.1:7790 [STOP=archived|paused] [K=14] [THROTTLE=8] node scripts/c29-archive-race.mjs
//        (exit 1 on any violation)
import { chromium } from 'playwright';
import { signIn } from './_session.mjs';
const base = process.env.BASE || 'http://127.0.0.1:5190';
const K = Number(process.env.K || 14), THROTTLE = Number(process.env.THROTTLE || 8), STOP = process.env.STOP || 'archived';
if (!['archived', 'paused'].includes(STOP)) throw new Error('STOP must be archived or paused');
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
const { changed, finals } = await p.evaluate(async ({ ids, STOP }) => {
  const d = window.__axion.data;
  const sig = (m) => JSON.stringify([m.status, m.agentIds, m.staffing, m.progress, m.lastEvent]);
  const frozen = new Map(); const changed = [];
  const unsub = d.subscribe((s) => {
    for (const id of ids) {
      const m = s.missions.find((x) => x.id === id); if (!m) continue;
      if (frozen.has(id)) { if (sig(m) !== frozen.get(id)) { changed.push(`${id}: changed after ${STOP}`); frozen.set(id, sig(m)); } }
      else if (m.status === STOP) frozen.set(id, sig(m));
    }
  });
  const stop = (id) => (STOP === 'archived' ? d.getState().archiveMission(id) : d.getState().setMissionStatus(id, STOP));
  // stop mission i after i*450 ms (every phase of the 1.5 s tick, up to the final planning -> running step)
  await Promise.all(ids.map((id, i) => new Promise((r) => setTimeout(() => { stop(id); r(); }, i * 450))));
  await new Promise((r) => setTimeout(r, 14000)); // staffing would be complete by now
  unsub();
  return { changed, finals: ids.map((id) => d.getState().missions.find((m) => m.id === id)?.status) };
}, { ids, STOP });
const notStopped = ids.filter((_, i) => finals[i] !== STOP);
console.log(`${STOP} ${ids.length - notStopped.length}/${ids.length} at the end` + (notStopped.length ? `  NOT ${STOP}: ${notStopped.map((id) => id + '=' + finals[ids.indexOf(id)]).join(', ')}` : ''));
console.log(`changes after ${STOP}: ${changed.length}` + (changed.length ? `  ${changed.join('; ')}` : ''));
await b.close();
process.exit(notStopped.length || changed.length ? 1 : 0);
