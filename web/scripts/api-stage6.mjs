// Stage 6, api mode: the agent catalog, each mission's hierarchy, tasks and conversations come from the server, live.
// Two users in two browsers. Run through scripts/api-e2e.sh (API 5192 on axion_e2e, reset on start, DEMO seed on; Vite 5193).
// Tasks 5–7 extend this script. Screenshots: SHOTS (default /tmp/axion-api-e2e).
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
const base = process.env.BASE || 'http://127.0.0.1:5193';
const SHOTS = process.env.SHOTS || '/tmp/axion-api-e2e';
mkdirSync(SHOTS, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.PW_CHROME || '/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome' });
const results = [];
const errors = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); console.log(results[results.length - 1]); };
const until = async (f, ms = 10000, step = 150) => { const t0 = Date.now(); for (;;) { try { if (await f()) return true; } catch { /* retry */ } if (Date.now() - t0 > ms) return false; await new Promise((r) => setTimeout(r, step)); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = async (label) => {
  const ctx = await b.newContext({ viewport: { width: 1600, height: 940 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('axion.data-mode', 'api'); localStorage.setItem('axion.testhook', '1'); } catch { /* ignore */ } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_CONNECTION|502|504|EventSource|404 \(Not Found\)/.test(m.text())) errors.push(`${label} console: ${m.text()}`); });
  return { ctx, p };
};
const connect = async (p, name, pass) => {
  await p.getByRole('heading', { name: 'Connect' }).waitFor({ timeout: 15000 });
  await p.getByLabel('Name').fill(name);
  await p.getByLabel('Password', { exact: true }).fill(pass);
  await p.getByRole('button', { name: /Connect/ }).click();
};
const conn = (p) => p.locator('.conn-badge').getAttribute('data-conn');
/** JSON API calls with this browser's session (cookies) and CSRF token. */
const apiOf = (p) => {
  let csrf = '';
  const call = async (method, path, data, headers = {}) => {
    if (!csrf && method !== 'GET') csrf = (await (await p.request.get(base + '/api/v1/me')).json()).me.csrf;
    const r = await p.request.fetch(base + '/api/v1' + path, { method, data, headers: { ...(method !== 'GET' ? { 'x-csrf': csrf } : {}), ...headers } });
    return { status: r.status(), body: await r.json().catch(() => ({})) };
  };
  return call;
};
let k = 0;
const key = () => `s6-${Date.now()}-${k++}`;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
/** Text of the bubbles in the open thread (the selected conversation). */
const threadText = (p) => p.locator('.conv-main .thread-body, .thread-body').first().innerText();
const composer = (p) => p.locator('.conv-main .composer').first();
const sendIn = async (p, text, withImage = false) => {
  const c = composer(p);
  await c.locator('textarea').fill(text);
  if (withImage) await c.locator('input[type="file"][accept="image/*"]').setInputFiles({ name: 'evidence.png', mimeType: 'image/png', buffer: png });
  await c.getByRole('button', { name: 'Send message' }).click();
};
const pickPartner = (p, label) => p.locator('.conv-main .cp-item', { hasText: label }).first().click();
const held = [];

let A, B;
try {
  // ------------------------------------------------------------ catalog
  A = await browser('A');
  await A.p.goto(base + '/missions', { waitUntil: 'domcontentloaded' });
  await connect(A.p, 'Luca', 'secret-1');
  await A.p.waitForSelector('.rail-nav', { timeout: 15000 });
  check('A connected and the badge says live', await until(async () => (await conn(A.p)) === 'live'));
  const apiA = apiOf(A.p);
  const agents = (await apiA('GET', '/agents')).body.agents ?? [];
  check('the server lists the company agents', agents.length > 0 && agents.some((a) => a.id === 'gm'), `${agents.length} agents`);
  await A.p.goto(base + '/operations?tab=agents&sub=directory&view=cards', { waitUntil: 'domcontentloaded' });
  const agentsKpi = A.p.locator('.kpi', { hasText: 'Agents' }).first().locator('.kpi-val');
  check(`the Directory shows the server's ${agents.length} agents (KPI and ${agents.length - 1} cards besides the GM)`,
    await until(async () => (await agentsKpi.innerText()).trim() === String(agents.length) && (await A.p.locator('.agent-card').count()) === agents.length - 1, 10000),
    `${await agentsKpi.innerText().catch(() => '?')} / ${await A.p.locator('.agent-card').count()} cards`);
  const sw = agents.find((a) => a.id === 'site-wanted');
  const ren = await apiA('PATCH', '/agents/site-wanted', { name: 'Site-Wanted-KR' }, { 'if-match': String(sw?.rowVersion ?? 1) });
  check('an agent renamed on the server shows in the Directory live (agent.updated)', ren.status === 200 && await until(async () => (await A.p.locator('.agent-card', { hasText: 'Site-Wanted-KR' }).count()) > 0, 8000), `PATCH ${ren.status}`);

  // ------------------------------------------------------------ B joins (approved through the API)
  B = await browser('B');
  await B.p.goto(base + '/missions', { waitUntil: 'domcontentloaded' });
  await connect(B.p, 'Mina', 'mina-pass');
  await B.p.getByRole('heading', { name: 'Waiting for approval' }).waitFor({ timeout: 10000 });
  const users = (await apiA('GET', '/users')).body.users ?? [];
  const mina = users.find((u) => u.name === 'Mina');
  await apiA('POST', `/users/${mina.id}/approve`, {});
  check('B connects after approval', await until(async () => (await B.p.locator('.rail-nav').count()) > 0, 15000));
  const apiB = apiOf(B.p);

  // ------------------------------------------------------------ hierarchy from the server (seeded DEMO mission)
  const hier = (await apiA('GET', '/missions/M-126/hierarchy')).body;
  await A.p.goto(base + '/missions/M-126?tab=hierarchy&agent=designer-01', { waitUntil: 'domcontentloaded' });
  await A.p.locator('.hnode').first().waitFor({ timeout: 10000 });
  const verTexts = await A.p.locator('.hnode .hnode-ver').allInnerTexts();
  check('Hierarchy shows the server nodes', await until(async () => (await A.p.locator('.hnode').count()) === hier.nodes.length), `${await A.p.locator('.hnode').count()} of ${hier.nodes.length}`);
  check('each node shows the version its instance is pinned to', verTexts.length === hier.nodes.length && hier.nodes.every((n) => verTexts.includes(n.versionLabel)), verTexts.slice(0, 4).join(', '));
  await A.p.waitForTimeout(900);
  await A.p.screenshot({ path: `${SHOTS}/stage6-hierarchy.png` });

  // ------------------------------------------------------------ conversations: threads, a command with an image, live in B
  const th126 = (await apiA('GET', '/missions/M-126/threads')).body.threads ?? [];
  await A.p.goto(base + '/missions/M-126?tab=conversations&agent=designer-01', { waitUntil: 'domcontentloaded' });
  await B.p.goto(base + '/missions/M-126?tab=conversations&agent=designer-01', { waitUntil: 'domcontentloaded' });
  check('Conversations lists the partners and shows the server thread (superior first)',
    await until(async () => (await A.p.locator('.conv-main .cp-item').count()) >= 2 && (await A.p.locator('.conv-main .thread-body [data-mid]').count()) > 0, 10000),
    `${th126.length} threads on the server`);
  await pickPartner(B.p, 'You (Owner)');
  const cmd = `Stage6 check: tighten the checkout spacing ${Date.now()}`;
  await sendIn(A.p, cmd, true); // typed under the agent↔agent thread: goes to A's own thread with Designer-01
  check('a message typed under an agent↔agent thread goes to the human thread, with a toast',
    await until(async () => (await A.p.getByText('Sent to your conversation with Designer-01').count()) > 0 && (await A.p.locator('.conv-main .thread-head').innerText()).includes('Designer-01 ↔ You'), 6000));
  check('A sees the command with its uploaded image', await until(async () => (await threadText(A.p)).includes(cmd) && (await A.p.locator('.conv-main .thread-body img[src*="/api/v1/uploads/"]').count()) > 0, 10000));
  check('B (shared mission) sees it live, with the image', await until(async () => (await threadText(B.p)).includes(cmd) && (await B.p.locator('.conv-main .thread-body img[src*="/api/v1/uploads/"]').count()) > 0, 10000));
  const ackRow = (p) => p.locator('.conv-main .bubble-row', { has: p.locator('.sim-tag') }).filter({ hasText: 'ACK' });
  check('the DEMO acknowledgement arrives tagged Simulated (A and B)', await until(async () => (await ackRow(A.p).count()) > 0 && (await ackRow(B.p).count()) > 0, 12000));
  check('A\'s status chip follows the receipts to acknowledged', await until(async () => (await A.p.locator('.conv-main .bubble-row.right', { hasText: cmd }).locator('.bubble-status').innerText()).includes('acknowledged'), 8000));
  await B.p.waitForTimeout(600);
  await B.p.screenshot({ path: `${SHOTS}/stage6-thread-demo.png` });
  await pickPartner(B.p, 'Superior');
  check('the Simulated report reaches Designer-01\'s superior thread (B, live)', await until(async () => {
    const t = await threadText(B.p);
    return t.includes('asked:') && t.includes(cmd.slice(0, 40)) && (await B.p.locator('.conv-main .bubble-row.k-report, .conv-main .bubble-row', { hasText: 'asked:' }).locator('.sim-tag').count()) > 0;
  }, 12000));

  // ------------------------------------------------------------ a real mission: queued, the honest note, no invented reply
  const made = await apiA('POST', '/missions', { text: 'Compare two hosting providers for the company site and list their limits.', files: [], shared: true }, { 'idempotency-key': key() });
  const realId = made.body.mission?.id;
  check('a real mission is created on the server', made.status === 201 && !!realId, realId);
  check('the server staffs it (GM instance and more)', await until(async () => ((await apiA('GET', `/missions/${realId}/hierarchy`)).body.nodes ?? []).length >= 2, 12000));
  await A.p.goto(`${base}/missions/${realId}?tab=conversations&agent=gm`, { waitUntil: 'domcontentloaded' });
  await composer(A.p).waitFor({ timeout: 10000 });
  const realCmd = `Please start with the pricing pages ${Date.now()}`;
  await sendIn(A.p, realCmd);
  check('the command shows queued', await until(async () => (await A.p.locator('.conv-main .bubble-row.right', { hasText: realCmd }).locator('.bubble-status').innerText()).includes('queued'), 8000));
  check('the honest system note is shown', await until(async () => (await A.p.locator('.conv-main .bubble-note', { hasText: "Agents don't act yet" }).count()) === 1, 8000));
  await A.p.waitForTimeout(3500);
  const agentBubbles = await A.p.locator('.conv-main .thread-body .bubble-row.left:not(.system)').count();
  const gmThread = ((await apiA('GET', `/missions/${realId}/threads`)).body.threads ?? []).find((t) => t.a === 'human' || t.b === 'human');
  const kinds = ((await apiA('GET', `/threads/${gmThread?.id}/messages`)).body.messages ?? []).map((m) => m.kind);
  check('no invented agent reply (UI and server)', agentBubbles === 0 && kinds.every((x) => x === 'command' || x === 'system') && !(await A.p.locator('.conv-main .sim-tag').count()), `${agentBubbles} agent bubbles · kinds ${kinds.join(',')}`);
  await A.p.screenshot({ path: `${SHOTS}/stage6-thread-real.png` });

  // ------------------------------------------------------------ a long thread: newest 50 first, older pages on scroll, no jump
  for (let i = 0; i < 130; i += 10) {
    await Promise.all(Array.from({ length: 10 }, (_, j) => apiA('POST', `/threads/${gmThread.id}/messages`, { kind: 'command', text: `paging message ${String(i + j + 1).padStart(3, '0')}`, to: 'gm' }, { 'idempotency-key': key() })));
  }
  const total = ((await apiA('GET', `/missions/${realId}/threads`)).body.threads ?? []).find((t) => t.id === gmThread.id)?.count;
  await A.p.reload({ waitUntil: 'domcontentloaded' });
  const mids = () => A.p.locator('.conv-main .thread-body [data-mid]').evaluateAll((els) => els.map((e) => e.getAttribute('data-mid')));
  check('opening the long thread loads the newest 50', await until(async () => (await mids()).length === 50, 10000), `${(await mids()).length} of ${total}`);
  check('the first page is pinned to the bottom (newest visible)', await A.p.locator('.conv-main .thread-body').evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight < 60));
  let pages = 0, worst = 0;
  for (let round = 0; round < 3; round++) {
    const before = (await mids()).length;
    if (before >= total) break;
    // scroll to the top; remember the message at the top and its offset
    const anchor = await A.p.locator('.conv-main .thread-body').evaluate((el) => {
      el.scrollTop = 0;
      const box = el.getBoundingClientRect();
      const first = [...el.querySelectorAll('[data-mid]')].find((n) => n.getBoundingClientRect().bottom > box.top);
      return { id: first.getAttribute('data-mid'), top: first.getBoundingClientRect().top - box.top };
    });
    const grew = await until(async () => (await mids()).length > before, 8000);
    await A.p.waitForTimeout(400);
    const after = await A.p.locator('.conv-main .thread-body').evaluate((el, id) => { const n = el.querySelector(`[data-mid="${id}"]`); return n ? n.getBoundingClientRect().top - el.getBoundingClientRect().top : null; }, anchor.id);
    if (grew) pages++;
    worst = Math.max(worst, after == null ? 999 : Math.abs(after - anchor.top));
    await A.p.locator('.conv-main .thread-body').evaluate((el) => { el.scrollTop += 300; }); // leave the top before the next round
    await A.p.waitForTimeout(200);
  }
  const all = await mids();
  check('scrolling up loads older pages', pages >= 2 && all.length === total, `${pages} pages · ${all.length}/${total} messages`);
  check('the message at the top stays in place while a page loads (no jump)', worst <= 4, `worst shift ${worst.toFixed(1)} px`);
  check('no duplicate messages after paging', new Set(all).size === all.length);
  const blocks = await A.p.locator('.conv-main .minimap .mm-block').count();
  check('the minimap still works on the long thread (one block per loaded message)', (await A.p.locator('.conv-main .minimap').count()) === 0 ? false : blocks === all.length, `${blocks} blocks`);

  // real missions have no results or timeline yet (Stage 8); the empty states say so
  await A.p.goto(`${base}/missions/${realId}?tab=results`, { waitUntil: 'domcontentloaded' });
  check('a real mission\'s Results tab says results arrive in Stage 8', await until(async () => (await A.p.getByText(/Results arrive in Stage 8/).count()) > 0, 8000));

  // ------------------------------------------------------------ made private while B has the thread open → 404 → B leaves
  await B.p.goto(`${base}/missions/${realId}?tab=conversations&agent=gm`, { waitUntil: 'domcontentloaded' });
  await composer(B.p).waitFor({ timeout: 10000 });
  check('B has the shared real mission\'s thread open', await until(async () => (await threadText(B.p)).includes('paging message 130'), 8000));
  // hold B's re-read of the mission, so the un-share event cannot move B away before B writes (the composer path is what is tested)
  await B.ctx.route(new RegExp(`/api/v1/missions/${realId}$`), (route) => { if (route.request().method() !== 'GET') return route.continue(); held.push(route); });
  const un = await apiA('POST', `/missions/${realId}/share`, { shared: false });
  await B.p.waitForTimeout(1200);
  const stillThere = B.p.url().includes(realId);
  await sendIn(B.p, 'Are you still there?');
  check('B\'s send gets the 404 handling: a toast, and B leaves the mission',
    un.status === 200 && stillThere && await until(async () => (await B.p.getByText(`${realId} is no longer available`).count()) > 0 && !B.p.url().includes(realId), 8000));
  const bPost = await apiB('GET', `/missions/${realId}/threads`);
  check('the server answers 404 to B for that mission now', bPost.status === 404);
  await B.ctx.unroute(new RegExp(`/api/v1/missions/${realId}$`));
  for (const r of held.splice(0)) await r.abort().catch(() => {});
} catch (e) { check('script ran to the end', false, String(e).split('\n')[0]); }
await A?.p.screenshot({ path: `${SHOTS}/stage6-end-A.png` }).catch(() => {});
await B?.p.screenshot({ path: `${SHOTS}/stage6-end-B.png` }).catch(() => {});
console.log(errors.length ? 'PAGE ERRORS:\n' + errors.join('\n') : 'no page errors');
console.log(`${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
writeFileSync('/tmp/axion-api-e2e/api-stage6.txt', results.join('\n') + '\n');
await b.close();
process.exit(results.some((r) => r.startsWith('FAIL')) || errors.length ? 1 : 0);
