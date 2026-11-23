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
// c82 (H22): a browser network-change event is a harness transient. EXACTLY that error gets one retry of the page (printed as RETRIED and
// counted); a second one, or any other error, is a normal FAIL. FAKE_NETCHANGE='<path>=<times>' injects it, to self-test the retry.
const NETCHANGE = /net::ERR_NETWORK_CHANGED\b/;
let retried = 0; const fake = new Map(); if (process.env.FAKE_NETCHANGE) { const [fp, n] = process.env.FAKE_NETCHANGE.split('='); fake.set(fp, +n || 1); }
const visit = async (path, dwell) => {
  await p.goto(base + path, { waitUntil: 'networkidle' }); await p.waitForTimeout(dwell);
  if ((fake.get(path) ?? 0) > 0) { fake.set(path, fake.get(path) - 1); await p.evaluate(() => console.error('Failed to load resource: net::ERR_NETWORK_CHANGED')); await p.waitForTimeout(50); }
};
const go = async (path, dwell = 600) => {
  cur = path;
  for (let attempt = 1; ; attempt++) {
    const mark = problems.length; let thrown = null;
    try { await visit(path, dwell); } catch (e) { thrown = e; }
    const mine = problems.splice(mark); // this attempt's console/page errors
    const net = mine.filter((x) => NETCHANGE.test(x)); const other = mine.filter((x) => !NETCHANGE.test(x));
    const netThrown = thrown && NETCHANGE.test(String(thrown.message));
    if (thrown && !netThrown) { problems.push(...mine, `${cur} PAGEERROR navigation failed: ${String(thrown.message).split('\n')[0].slice(0, 160)}`); return; }
    if ((net.length || netThrown) && attempt === 1) {
      retried++; console.log(`RETRIED ${path} (harness retry, browser network change): ${(net[0] ?? String(thrown.message)).replace(`${cur} ERROR `, '').slice(0, 120)}`);
      problems.push(...other); continue;
    }
    problems.push(...mine); return;  // a second network change is kept and fails like any other error
  }
};
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
const SMOKE = process.env.CRAWL_SMOKE === '1'; // self-test of the harness retry: one mission, one agent, one live view
const ids = (await p.evaluate(() => window.__axion.data.getState().missions.map((m) => m.id))).slice(0, SMOKE ? 1 : undefined);
for (const id of ids) {
  await go(`/missions/${id}?tab=hierarchy`, 4000);   // live simulator fires every 3.2 s
  for (const t of ['overview', 'activity', 'conversations', 'task-flow', 'results', 'approvals', 'reports', 'timeline', 'browser']) await go(`/missions/${id}?tab=${t}`, 300);
  await go(`/control/${id}?tab=approvals`, 300);   // legacy link must still resolve;
}
const agents = await p.evaluate(async () => (await import('/src/data/agents.ts')).AGENTS.map((a) => a.id)).catch(() => null);
for (const a of (agents ?? ['gm', 'coder-01']).slice(0, SMOKE ? 1 : undefined)) { await go(`/agents/${a}`, 250); await go(`/agents/${a}?tab=capabilities`, 250); }
for (const path of ['/overview?tab=activity', '/notifications?tab=news', '/plugins/job-search', '/operations?tab=logs', '/operations?tab=vms', '/operations?tab=models&sub=health', '/operations?tab=agents&sub=lineage'].slice(0, SMOKE ? 1 : undefined)) await go(path, SMOKE ? 300 : 5500);
console.log(`missions: ${ids.length} (incl. edge cases ${created.join(', ')}), agents: ${agents?.length ?? 'n/a'}`);
console.log(`harness retries (ERR_NETWORK_CHANGED, once per page): ${retried}`);
console.log(problems.length ? [...new Set(problems)].join('\n') : 'NO PROBLEMS');
await b.close();
process.exit(problems.length ? 1 : 0);
