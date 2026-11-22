// Improvement cycle 6 (theme B), api mode: department facts from recorded data, in two browsers.
// A (administrator) and M (member Mina) open Agents › Departments. Every card's staffed-agents and active-missions numbers
// must equal an independent recount from /agents, /missions and /agent-instances (not from /departments). Then user
// actions change them and the cards follow live (no reload): A creates a private real mission and the staffing simulation
// staffs it; a waiting task is reassigned and a running task is canceled (fixture task rows in the lane's e2e database:
// real missions have no tasks yet); the mission is canceled; a new agent changes the org chart. M never counts A's private
// mission. Also: no prototype figure in api mode, a ? on every fact, the DEMO switch, and the one-screen fit at 1366×768
// and 1672×941.
// Run: ./scripts/api-e2e.sh api-c06.mjs   (lane: E2E_API_PORT / E2E_WEB_PORT; api mode is set by this script)
// Committed screenshot only on request: DOC_SHOT_C06=docs/screenshots/improve-c06-departments-dark.png
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const base = process.env.BASE || 'http://127.0.0.1:5193';
const DOC_SHOT = process.env.DOC_SHOT_C06;
const URL_DEPTS = '/operations?tab=agents&sub=departments';
/** api mode: never wait for networkidle (the event stream stays open); wait for the shell and the live badge instead */
async function settle(p, ms = 500) {
  await p.waitForSelector('.rail-nav', { timeout: 15000 }).catch(() => {});
  await p.waitForSelector('.conn-badge[data-conn="live"]', { timeout: 15000 }).catch(() => {});
  await p.waitForTimeout(ms);
}
const b = await chromium.launch({ executablePath: process.env.PW_CHROME || '/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome' });
const results = [];
const errors = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); console.log(results[results.length - 1]); };
const until = async (f, ms = 10000, step = 150) => { const t0 = Date.now(); for (;;) { try { if (await f()) return true; } catch { /* retry */ } if (Date.now() - t0 > ms) return false; await new Promise((r) => setTimeout(r, step)); } };

const PASS = 'c06-pass-1';
const device = { name: 'Chrome on Linux (c06 script)', kind: 'desktop', browser: 'Chrome' };
/** Each person signs in through the API from their own browser context (one device each); a member is approved by `admin`. */
const browser = async (label, name, admin) => {
  const ctx = await b.newContext({ viewport: { width: 1672, height: 941 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('axion.data-mode', 'api'); localStorage.setItem('axion.settings.v1', JSON.stringify({ state: { themeMode: 'dark', skin: 'luminous', motion: 'reduced' }, version: 0 })); } catch { /* ignore */ } });
  const c = await ctx.request.post(base + '/api/v1/auth/connect', { data: { name, password: PASS, device } });
  if (c.status() === 202 && admin) {
    const u = ((await admin.api('GET', '/users')).body.users ?? []).find((x) => x.name === name);
    const ap = await admin.api('POST', `/users/${u.id}/approve`, {});
    if (ap.status !== 200 || (await ctx.request.get(base + '/api/v1/auth/wait')).status() !== 200) throw new Error(`approving ${name} failed`);
  } else if (c.status() !== 200) throw new Error(`${name} sign-in failed: ${c.status()} ${await c.text()}`);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_CONNECTION|ERR_INTERNET_DISCONNECTED|502|503|504|EventSource/.test(m.text())) errors.push(`${label} console: ${m.text()}`); });
  let csrf = '';
  const api = async (method, path, data, headers = {}) => {
    if (!csrf && method !== 'GET') csrf = (await (await p.request.get(base + '/api/v1/me')).json()).me.csrf;
    const r = await p.request.fetch(base + '/api/v1' + path, { method, data, headers: { ...(method !== 'GET' ? { 'x-csrf': csrf } : {}), ...headers } });
    return { status: r.status(), body: await r.json().catch(() => ({})) };
  };
  return { ctx, p, api };
};

/** Independent recount (the same rule as the Overview "Staffed Agents" tile): per catalog department, members with a live,
 *  non-simulated instance on a visible, non-DEMO, active mission, and the distinct missions. includeDemo admits DEMO ones. */
const ACTIVE = ['planning', 'running', 'verifying', 'waiting'];
async function recount(api, includeDemo = false) {
  const agents = (await api('GET', '/agents')).body.agents;
  const missions = (await api('GET', '/missions')).body.missions;
  const insts = (await api('GET', '/agent-instances')).body.instances;
  const dept = new Map(agents.map((a) => [a.id, a.dept]));
  const live = new Map(missions.filter((m) => ACTIVE.includes(m.status) && (includeDemo || !m.demo)).map((m) => [m.id, m]));
  const out = {};
  for (const a of agents) if (a.lifecycle === 'active') out[a.dept] ??= { staffed: new Set(), missions: new Set() };
  for (const i of insts) {
    if (i.endedAt || !live.has(i.missionId) || (!includeDemo && i.simulated)) continue;
    const d = out[dept.get(i.agentId)];
    if (!d) continue;
    d.staffed.add(i.agentId); d.missions.add(i.missionId);
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, { staffed: v.staffed.size, missions: v.missions.size }]));
}
const cardsOf = (p) => p.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-dept]')].map((e) => [e.getAttribute('data-dept'), {
  staffed: Number(e.getAttribute('data-staffed')), missions: Number(e.getAttribute('data-missions')), open: e.getAttribute('data-open'), rev: e.getAttribute('data-org-rev'),
  members: Number(e.getAttribute('data-members')), head: e.getAttribute('data-head'), shownStaffed: e.querySelector('[data-v="staffed"]')?.textContent, shownMissions: e.querySelector('[data-v="missions"]')?.textContent,
}])));
const same = (cards, rc) => {
  const names = Object.keys(rc).sort();
  if (Object.keys(cards).sort().join('|') !== names.join('|')) return false;
  return names.every((n) => cards[n].staffed === rc[n].staffed && cards[n].missions === rc[n].missions && cards[n].shownStaffed === String(rc[n].staffed) && (cards[n].shownMissions ?? '').startsWith(`${rc[n].missions} mission`));
};
const diff = (cards, rc) => Object.keys({ ...cards, ...rc }).filter((n) => !cards[n] || !rc[n] || cards[n].staffed !== rc[n].staffed || cards[n].missions !== rc[n].missions)
  .map((n) => `${n}: card ${cards[n]?.staffed}/${cards[n]?.missions} vs recount ${rc[n]?.staffed}/${rc[n]?.missions}`).join('; ');
const total = (rc) => Object.values(rc).reduce((s, d) => s + d.staffed, 0);
const ready = (p) => p.locator('[data-departments="ready"]').waitFor({ timeout: 15000 });
const matches = async (X, includeDemo = false, ms = 10000) => {
  let rc = {}, cards = {};
  const ok = await until(async () => { rc = await recount(X.api, includeDemo); cards = await cardsOf(X.p); return same(cards, rc); }, ms, 250);
  return { ok, rc, cards, why: ok ? '' : diff(cards, rc) };
};
const noReload = (X, tag) => X.p.evaluate((t) => window.__c06 === t, tag);

let A, M;
try {
  A = await browser('A', 'Luca'); // the first user is the administrator
  M = await browser('M', 'Mina', A); // approved by A
  for (const X of [A, M]) { await X.p.goto(base + URL_DEPTS, { waitUntil: 'domcontentloaded' }); await settle(X.p); await ready(X.p); }

  // ------------------------------------------------------------ the cards equal a server recount (fresh lane database)
  const a0 = await matches(A);
  check('A: every department card\'s staffed agents and active missions equal the recount from /agents, /missions, /agent-instances', a0.ok, a0.why);
  const m0 = await matches(M);
  check('M (member): the same, from what Mina can see', m0.ok, m0.why);
  const panel = A.p.locator('section.panel', { has: A.p.locator('[data-departments]') }).first();
  const txt = await panel.innerText();
  check('api mode: no prototype figure on the cards (no capacity %, skill coverage, KPI deltas, no DEMO tag while DEMO is off)',
    !/%|Skill coverage|Median task time|Rework rate|Verified success/.test(txt) && (await panel.locator('.oa-kpis3').count()) === 0 && (await panel.locator('.demo-tag').count()) === 0, txt.match(/.*%.*/)?.[0] ?? '');
  const nCards = await A.p.locator('[data-dept]').count();
  const helps = await A.p.evaluate(() => [...document.querySelectorAll('[data-dept]')].map((c) => new Set([...c.querySelectorAll('[data-help-key^="dept."]')].map((h) => h.getAttribute('data-help-key'))).size));
  check('every card has a ? for each fact (head, members, staffed, open tasks, outcomes, last org change)', nCards >= 7 && helps.every((n) => n === 6), JSON.stringify(helps));
  const c0 = await cardsOf(A.p);
  const srv0 = (await A.api('GET', '/departments')).body;
  const byName0 = Object.fromEntries(srv0.departments.map((d) => [d.name, d]));
  check('heads, members and the last org change on the cards are the server\'s (Executive: GM, no line; Engineering: rev 1)',
    c0.Executive?.head === 'gm' && c0.Executive.rev === '' && c0.Engineering?.rev === '1' && Object.entries(c0).every(([n, c]) => c.head === (byName0[n].headAgentId ?? '') && c.members === byName0[n].memberIds.length), JSON.stringify(c0.Engineering));
  check('outcomes say "too few to rate" with n=0 · 30d', (await A.p.locator('[data-dept="Engineering"] [data-fact="outcomes"]').innerText()).includes('n=0 · 30d · too few to rate'));

  // ------------------------------------------------------------ the DEMO switch: DEMO missions' simulated staffing is counted only when on
  await A.p.locator('[data-departments] .sc-demo .switch').click();
  await A.p.locator('[data-departments="ready"][data-demo="1"]').waitFor({ timeout: 10000 });
  const ad = await matches(A, true);
  check('include DEMO on: a DEMO tag shows and the cards equal the recount with DEMO missions (simulated staffing)', ad.ok && (await panel.locator('.demo-tag').count()) === 1 && total(ad.rc) > 0, ad.why || `staffed with DEMO: ${total(ad.rc)}`);
  await A.p.locator('[data-departments] .sc-demo .switch').click();
  await A.p.locator('[data-departments="ready"][data-demo="0"]').waitFor({ timeout: 10000 });

  // ------------------------------------------------------------ user action 1: A creates a private real mission; the staffing simulation staffs it (live)
  for (const X of [A, M]) await X.p.evaluate(() => { window.__c06 = 'live'; });
  const before = await recount(A.api);
  const act = async (id, action) => {
    for (let i = 0; i < 8; i++) {
      const r = await A.api('POST', `/missions/${id}/actions/${action}`, {}, { 'idempotency-key': `c06-${id}-${action}-${i}-${Date.now()}` });
      if (r.status === 200) return r.body.mission;
      if (r.status === 409 && action === 'start' && (await A.api('GET', `/missions/${id}`)).body.mission?.serverStatus === 'running') return null;
      await new Promise((res) => setTimeout(res, 250));
    }
    throw new Error(`${action} ${id} failed`);
  };
  const mission = (await A.api('POST', '/missions', { text: 'Department facts check: compare two log shippers and list their limits.', files: [], shared: false }, { 'idempotency-key': `c06-new-${Date.now()}` })).body.mission;
  await act(mission.id, 'start');
  let team = [];
  await until(async () => (team = ((await A.api('GET', `/missions/${mission.id}/hierarchy`)).body.nodes ?? [])).length >= 3, 20000, 300);
  const exec = team.find((n) => n.agentId !== 'gm');
  const lead = team.find((n) => n.agentId === 'gm');
  check('a real private mission of A is staffed by the simulation (GM + executor + team)', !!exec && !!lead && team.length >= 3, team.map((n) => n.agentId).join(', '));
  const a1 = await matches(A, false, 15000);
  check('A live: the cards follow the new staffing without reload and equal the recount', a1.ok && total(a1.rc) > total(before) && await noReload(A, 'live'), a1.why || `staffed ${total(before)} → ${total(a1.rc)}`);
  const agentsById = Object.fromEntries((await A.api('GET', '/agents')).body.agents.map((a) => [a.id, a]));
  const execDept = agentsById[exec.agentId].dept;
  check(`A: ${execDept} (the executor's department) counts the mission: 1 active mission`, a1.cards[execDept]?.missions === 1 && a1.cards.Executive?.missions === 1, JSON.stringify(a1.cards[execDept]));
  await new Promise((r) => setTimeout(r, 1200)); // let M's stream deliver whatever it receives
  const m1 = await matches(M);
  check('M (member) does not count A\'s private mission: her cards equal her recount and stay at the earlier numbers', m1.ok && total(m1.rc) === total(m0.rc) && (m1.cards[execDept]?.staffed ?? 0) === (m0.rc[execDept]?.staffed ?? 0) && await noReload(M, 'live'), m1.why || `M total ${total(m1.rc)}, A total ${total(a1.rc)}`);
  const msrv = (await M.api('GET', '/departments')).body.departments.find((d) => d.name === execDept);
  check('M: the server agrees (GET /departments as Mina has no active mission in that department from A)', msrv && msrv.activeMissions === (m0.rc[execDept]?.missions ?? 0), JSON.stringify(msrv && { staffed: msrv.staffedAgents, missions: msrv.activeMissions }));

  if (DOC_SHOT) { // the page's own "Agent boards" fold, so whole cards are in the picture; unfolded again afterwards
    await A.p.locator('.bb-toggle').click();
    await A.p.waitForTimeout(900);
    await A.p.screenshot({ path: DOC_SHOT });
    await A.p.locator('.bb-toggle').click();
    await A.p.evaluate(() => { try { localStorage.removeItem('axion.bottom.agents'); } catch { /* ignore */ } }); // back to the default (fold on short screens)
  }

  // ------------------------------------------------------------ user actions 2 and 3: a waiting task is reassigned, a running task is canceled (live)
  // fixture rows (passed/failed/running are system-only states; real missions have no tasks yet), written only into the lane's e2e database
  const e2eUrl = /^E2E_DATABASE_URL=(.*)$/m.exec(readFileSync(new URL('../../server/.env', import.meta.url), 'utf8'))?.[1]?.trim().replace(/^['"]|['"]$/g, '');
  if (!e2eUrl || !/\/axion_e2e\d*(\?|$)/.test(e2eUrl)) throw new Error('E2E_DATABASE_URL must point at an axion_e2e database');
  const pg = createRequire(new URL('../../server/package.json', import.meta.url))('pg');
  const db = new pg.Client({ connectionString: e2eUrl });
  await db.connect();
  const tn = (await db.query('select tenant_id from missions where id=$1', [mission.id])).rows[0].tenant_id;
  const T1 = `T-${mission.id}-C06W`, T2 = `T-${mission.id}-C06R`;
  await db.query(`insert into tasks(id, tenant_id, mission_id, title, status, owner_agent, owner_instance_id, simulated) values ($1,$2,$3,'Dept fixture waiting','waiting_user',$4,$5,false), ($6,$2,$3,'Dept fixture running','running',$4,$5,false)`,
    [T1, tn, mission.id, exec.agentId, exec.instanceId, T2]);
  await db.end();
  const open = async (p, d) => (await cardsOf(p))[d]?.open;
  const re = await A.api('POST', `/tasks/${T1}/reassign`, { toInstanceId: lead.instanceId, brief: { goal: 'Take over the task', acceptance: ['The result is attached'], capabilities: [{ kind: 'read' }], escalation: 'Ask the mission owner when unsure' } }, { 'idempotency-key': `c06-re-${Date.now()}` });
  check(`user action: the waiting task is reassigned from ${exec.agentId} to the GM`, re.status === 200, JSON.stringify(re.body).slice(0, 200));
  const sameDept = execDept === 'Executive';
  const afterRe = await until(async () => (await open(A.p, execDept)) === (sameDept ? '1/1/0' : '1/0/0') && (await open(A.p, 'Executive')) === (sameDept ? '1/1/0' : '0/1/0'), 10000);
  check(`A live: open tasks follow the reassign (${execDept} running 1, waiting moves to Executive)`, afterRe && await noReload(A, 'live'), `${execDept} ${await open(A.p, execDept)}, Executive ${await open(A.p, 'Executive')}`);
  const cn = await A.api('POST', `/tasks/${T2}/cancel`, {}, { 'idempotency-key': `c06-cn-${Date.now()}` });
  const afterCn = await until(async () => (await open(A.p, execDept)) === (sameDept ? '0/1/0' : '0/0/0'), 10000);
  check(`user action: the running task is canceled; A live: ${execDept} running 0`, cn.status === 200 && afterCn && await noReload(A, 'live'), `${execDept} ${await open(A.p, execDept)}`);
  check('M sees none of these private tasks', !Object.values(await cardsOf(M.p)).some((c) => c.open !== '0/0/0'), JSON.stringify(Object.fromEntries(Object.entries(await cardsOf(M.p)).map(([k, v]) => [k, v.open]))));

  // ------------------------------------------------------------ user action 4: A cancels the mission → nobody is staffed on it any more (live)
  await act(mission.id, 'cancel');
  const a2 = await matches(A, false, 12000);
  check('A live: after the mission is canceled the cards equal the recount again (back to the earlier numbers)', a2.ok && total(a2.rc) === total(before) && await noReload(A, 'live'), a2.why || `total ${total(a2.rc)} vs ${total(before)}`);

  // ------------------------------------------------------------ user action 5: a new agent changes the org chart → last org change and members follow (live)
  const revBefore = (await cardsOf(M.p)).Engineering.rev;
  const na = await A.api('POST', '/agents', { name: 'Pipeline-01', role: 'Pipeline engineer', dept: 'Engineering', duty: 'Data pipelines (c06 check)', model: 'claude-sonnet-5-5', managerId: 'coder-01' }, { 'idempotency-key': `c06-agent-${Date.now()}` });
  check('user action: an administrator adds an Engineering agent under Coder-01 (a new org revision)', na.status === 201);
  const g = (await A.api('GET', '/organization/graph')).body;
  for (const [X, who] of [[A, 'A'], [M, 'M']]) {
    const ok = await until(async () => { const c = (await cardsOf(X.p)).Engineering; return c.rev === String(g.revision.seq) && c.members === byName0.Engineering.memberIds.length + 1; }, 10000);
    check(`${who} live: Engineering shows "rev ${g.revision.seq}" and one more member, without reload; other departments keep their revision`, ok && (await cardsOf(X.p)).Operations.rev === revBefore && await noReload(X, 'live'), JSON.stringify((await cardsOf(X.p)).Engineering));
  }

  // ------------------------------------------------------------ a department without a head: amber "No head" (its only member reports to Coder-01)
  const nl = await A.api('POST', '/agents', { name: 'Counsel-01', role: 'Counsel', dept: 'Legal', duty: 'Contract review (c06 check)', model: 'claude-sonnet-5-5', managerId: 'coder-01' }, { 'idempotency-key': `c06-legal-${Date.now()}` });
  const legal = A.p.locator('[data-dept="Legal"]');
  check('a new department whose only member does not report to the GM shows the amber "No head", live, with a ? on every fact',
    nl.status === 201 && await until(async () => (await legal.locator('[data-head-state="none"]').count()) === 1, 10000)
      && (await legal.locator('.dpa-nohead').innerText()).includes('No head') && (await legal.evaluate((c) => new Set([...c.querySelectorAll('[data-help-key^="dept."]')].map((h) => h.getAttribute('data-help-key'))).size)) === 6
      && await noReload(A, 'live'), String(nl.status));

  // ------------------------------------------------------------ one-screen fit in api mode
  for (const [w, h] of [[1366, 768], [1672, 941]]) {
    // a fresh load per size, like scripts/fit-check.mjs (the live checks above are done)
    await A.p.setViewportSize({ width: w, height: h });
    await A.p.goto(base + URL_DEPTS, { waitUntil: 'domcontentloaded' }); await settle(A.p); await ready(A.p);
    await A.p.waitForTimeout(900);
    const r = await A.p.evaluate(() => {
      const m = document.querySelector('main');
      const s = [...document.querySelectorAll('.fit-scroll')].filter((e) => e.offsetParent);
      return { over: m.scrollHeight - m.clientHeight, regions: s.map((e) => Math.round(e.clientHeight)), hOver: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    });
    check(`fit at ${w}×${h}: the page does not scroll, the departments scroll inside their region`, r.over <= 2 && r.regions.length > 0 && r.regions.every((x) => x >= 200) && r.hOver <= 0, JSON.stringify(r));
    await A.p.screenshot({ path: `/tmp/axion-c06-${w}.png` });
  }
  // ------------------------------------------------------------ non-zero counts (DEMO on: simulated staffing and tasks) do not clip at 1366
  await A.p.setViewportSize({ width: 1366, height: 768 });
  await A.p.goto(base + URL_DEPTS, { waitUntil: 'domcontentloaded' }); await settle(A.p); await ready(A.p);
  await A.p.locator('[data-departments] .sc-demo .switch').click();
  await A.p.locator('[data-departments="ready"][data-demo="1"]').waitFor({ timeout: 10000 });
  const clip = await A.p.evaluate(() => [...document.querySelectorAll('[data-dept] .dpa-open, [data-dept] .dpa-fact > span:not(.dpa-sub)')].filter((e) => e.scrollWidth > e.clientWidth + 1).length);
  const nonZero = await A.p.evaluate(() => [...document.querySelectorAll('[data-dept]')].some((c) => c.getAttribute('data-open') !== '0/0/0' || c.getAttribute('data-outcomes-n') !== '0'));
  check('DEMO on at 1366×768: some open-task / outcome counts are non-zero and no fact row clips', nonZero && clip === 0, `clipped ${clip}, nonZero ${nonZero}`);
  await A.p.screenshot({ path: '/tmp/axion-c06-demo-1366.png' });
} catch (e) {
  check('script ran to the end', false, e.stack);
} finally {
  check('no page errors', errors.length === 0, errors.slice(0, 5).join(' | '));
  await b.close();
}
const failed = results.filter((r) => r.startsWith('FAIL'));
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
