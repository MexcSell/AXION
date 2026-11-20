// Deep crawl: Mission Control for EVERY mission (hierarchy + timers), every agent profile,
// long dwells on live views, and edge-case missions (1-agent team, brand-new draft).
import { chromium } from 'playwright';
import { signIn } from './_session.mjs';
const base = process.env.BASE || 'http://127.0.0.1:5190';
const b = await chromium.launch({ executablePath: process.env.PW_CHROME || '/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome' });
const ctx = await b.newContext({ viewport: { width: 1672, height: 941 } }); await signIn(ctx);
const p = await ctx.newPage(); await p.addInitScript(() => localStorage.setItem('axion.testhook', '1'));
let cur = ''; const problems = [];
p.on('pageerror', (e) => problems.push(`${cur} PAGEERROR ${e.message}`));
p.on('console', (m) => { if (m.type() === 'error') problems.push(`${cur} ERROR ${m.text().slice(0, 180)}`); });
const go = async (path, dwell = 600) => { cur = path; await p.goto(base + path, { waitUntil: 'networkidle' }); await p.waitForTimeout(dwell); };
await go('/overview');
// edge-case missions created through the real store
const created = await p.evaluate(async () => {
  const d = window.__axion.data.getState();
  // owner update u1: a mission is only content (text + files); the GM staffs it
  const owner = { id: 'u-1', name: 'Luca' };
  const solo = await d.addMission({ text: 'Edge case: single-agent team', files: [], shared: false }, owner);
  d.updateMission(solo.id, { agentIds: ['gm'], staffing: undefined, status: 'running' });
  const draft = await d.addMission({ text: '', files: [{ id: 'f1', name: 'only-a-file.pdf', kind: 'pdf', size: 1200, mime: 'application/pdf' }], shared: true }, owner);
  return [solo.id, draft.id];
});
const ids = await p.evaluate(() => window.__axion.data.getState().missions.map((m) => m.id));
for (const id of ids) {
  await go(`/missions/${id}?tab=hierarchy`, 4000);   // live simulator fires every 3.2 s
  for (const t of ['overview', 'activity', 'conversations', 'task-flow', 'results', 'approvals', 'reports', 'timeline', 'browser']) await go(`/missions/${id}?tab=${t}`, 300);
  await go(`/control/${id}?tab=approvals`, 300);   // legacy link must still resolve;
}
const agents = await p.evaluate(async () => (await import('/src/data/agents.ts')).AGENTS.map((a) => a.id)).catch(() => null);
for (const a of agents ?? ['gm', 'coder-01']) { await go(`/agents/${a}`, 250); await go(`/agents/${a}?tab=capabilities`, 250); }
for (const path of ['/overview?tab=activity', '/notifications?tab=news', '/plugins/job-search', '/operations?tab=logs', '/operations?tab=vms', '/operations?tab=models&sub=health', '/operations?tab=agents&sub=lineage']) await go(path, 5500);
console.log(`missions: ${ids.length} (incl. edge cases ${created.join(', ')}), agents: ${agents?.length ?? 'n/a'}`);
console.log(problems.length ? [...new Set(problems)].join('\n') : 'NO PROBLEMS');
await b.close();
