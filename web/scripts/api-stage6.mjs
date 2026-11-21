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
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_CONNECTION|ERR_INTERNET_DISCONNECTED|502|503|504|EventSource/.test(m.text())) errors.push(`${label} console: ${m.text()}`); });
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

  // ------------------------------------------------------------ fix round 1: failed sends keep the draft; a missing instance is not "mission gone"
  await pickPartner(A.p, 'You (Owner)');
  await A.p.waitForTimeout(300);
  const failOnce = { n: 0 };
  await A.ctx.route(/\/api\/v1\/threads\/[^/]+\/messages$/, (route) => {
    if (route.request().method() !== 'POST' || failOnce.n++) return route.continue();
    return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'UNAVAILABLE', message: 'Test: the server is busy.', correlationId: 't', retryable: true }) });
  });
  const draft = `Draft that must survive a failed send ${Date.now()}`;
  await sendIn(A.p, draft, true);
  check('a failed send says so and puts the text and the image back in the composer',
    await until(async () => (await A.p.getByText('Not sent').count()) > 0 && (await composer(A.p).locator('textarea').inputValue()) === draft && (await composer(A.p).locator('.composer-files .cf').count()) === 1, 8000),
    `text ${(await composer(A.p).locator('textarea').inputValue().catch(() => '')) === draft ? 'kept' : 'lost'}`);
  check('nothing unsent stays in the thread', !(await threadText(A.p)).includes(draft));
  await A.ctx.unroute(/\/api\/v1\/threads\/[^/]+\/messages$/);
  await composer(A.p).getByRole('button', { name: 'Send message' }).click();
  check('sending the restored draft again works', await until(async () => (await threadText(A.p)).includes(draft) && (await A.p.locator('.conv-main .bubble-row.right', { hasText: draft }).locator('img[src*="/api/v1/uploads/"]').count()) > 0, 10000));
  // a 404 from creating a thread (the agent's instance is not there) must not throw the user out of a visible mission
  await A.p.goto(base + '/missions/M-126?tab=conversations&agent=writer-01', { waitUntil: 'domcontentloaded' });
  await A.p.locator('.conv-main .cp-item').first().waitFor({ timeout: 10000 });
  await pickPartner(A.p, 'You (Owner)');
  await A.ctx.route(/\/api\/v1\/missions\/M-126\/threads$/, (route) => route.request().method() === 'POST'
    ? route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ code: 'NOT_FOUND', message: 'No such agent instance in this mission.', correlationId: 't', retryable: false }) })
    : route.continue());
  const d2 = `Hello Writer ${Date.now()}`;
  await sendIn(A.p, d2);
  check('a thread-create 404 on a visible mission is a normal error (A stays, draft back)',
    await until(async () => (await A.p.getByText(/has not joined the mission yet/).count()) > 0 && (await composer(A.p).locator('textarea').inputValue()) === d2, 8000)
      && A.p.url().includes('M-126') && (await A.p.getByText('M-126 is no longer available').count()) === 0);
  await A.ctx.unroute(/\/api\/v1\/missions\/M-126\/threads$/);
  await composer(A.p).locator('textarea').fill('');

  // ------------------------------------------------------------ fix round 1: a failed tasks load is an error with Retry, not "No tasks yet"
  const tasks127 = (await apiA('GET', '/missions/M-127/tasks')).body;
  await A.ctx.route(/\/api\/v1\/missions\/M-127\/tasks$/, (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'UNAVAILABLE', message: 'Test: tasks are unavailable.', correlationId: 't', retryable: true }) }));
  await A.p.goto(base + '/missions/M-127?tab=task-flow', { waitUntil: 'domcontentloaded' });
  check('a failed tasks load shows an error with Retry (not "No tasks yet")',
    await until(async () => (await A.p.locator('.part-status[data-part="tasks"][data-state="error"]').count()) > 0, 10000) && (await A.p.getByText('No tasks yet').count()) === 0);
  await A.ctx.unroute(/\/api\/v1\/missions\/M-127\/tasks$/);
  await A.p.locator('.part-status[data-part="tasks"]').getByRole('button', { name: 'Retry' }).click().catch(() => {});
  check('Retry loads the tasks', Array.isArray(tasks127) && tasks127.length > 0 && await until(async () => (await A.p.getByText(tasks127[0].title).count()) > 0 && (await A.p.locator('.part-status').count()) === 0, 10000), `${tasks127.length} tasks`);

  // ------------------------------------------------------------ Task 5: retry, reassign, cancel from the task dialogs
  const t125 = (await apiA('GET', '/missions/M-125/tasks')).body;
  const failedT = t125.find((t) => t.state === 'failed');
  const openTask = async (mid, id) => {
    await A.p.goto(`${base}/missions/${mid}?tab=task-flow`, { waitUntil: 'domcontentloaded' });
    const el = A.p.locator(`[aria-label^="${id} "]`).first();
    await el.waitFor({ timeout: 10000 });
    await el.click();
    await A.p.locator('.modal, [role="dialog"]').first().waitFor({ timeout: 5000 });
  };
  check('M-125 has a failed task to retry', !!failedT, failedT?.id);
  if (failedT) {
    await openTask('M-125', failedT.id);
    await A.p.locator('[role="dialog"]').getByRole('button', { name: 'Retry' }).click();
    check('Retry in the task dialog moves the task to queued on the server', await until(async () => (await apiA('GET', `/tasks/${failedT.id}`)).body.task?.state === 'queued', 8000));
    await openTask('M-125', failedT.id);
    check('the dialog no longer offers Retry for it, and the Task flow shows it queued', (await A.p.locator('[role="dialog"]').getByRole('button', { name: 'Retry' }).count()) === 0 && /queued/i.test(await A.p.locator('[role="dialog"], .modal').first().innerText()));
    const again = await apiA('POST', `/tasks/${failedT.id}/retry`, {}, { 'idempotency-key': key() });
    check('retrying again is an illegal move with the server\'s message', again.status === 409 && again.body.code === 'ILLEGAL_TRANSITION', again.body.message);
  }
  const t126 = (await apiA('GET', '/missions/M-126/tasks')).body;
  const hier126 = (await apiA('GET', '/missions/M-126/hierarchy')).body;
  const movable = t126.find((t) => t.state !== 'running' && t.state !== 'passed' && t.state !== 'canceled');
  const newOwner = hier126.nodes.find((n) => n.agentId !== 'gm' && n.agentId !== movable?.owner);
  check('M-126 has a task and another agent to reassign it to', !!movable && !!newOwner, `${movable?.id} → ${newOwner?.agentId}`);
  if (movable && newOwner) {
    await openTask('M-126', movable.id);
    await A.p.locator('[role="dialog"]').getByRole('button', { name: 'Reassign' }).click();
    await A.p.getByRole('button', { name: new RegExp(`^.*${(await apiA('GET', '/agents')).body.agents.find((a) => a.id === newOwner.agentId).name}`) }).first().click();
    await A.p.getByPlaceholder(/needs browser specialist/).fill('stage 6 e2e reassign');
    await A.p.getByRole('button', { name: 'Submit Reassignment' }).click();
    check('Reassign in the dialog changes the owner on the server', await until(async () => (await apiA('GET', `/tasks/${movable.id}`)).body.task?.owner === newOwner.agentId, 8000));
    const ownerName = (await apiA('GET', '/agents')).body.agents.find((a) => a.id === newOwner.agentId).name;
    check('the Task flow (still open, not reloaded) shows the new owner live', await until(async () => (await A.p.locator(`[aria-label^="${movable.id} "]`).first().innerText()).includes(ownerName), 8000), ownerName);
  }
  const running = [...t126, ...(await apiA('GET', '/missions/M-127/tasks')).body].find((t) => t.state === 'running');
  if (running) {
    const mid = t126.some((t) => t.id === running.id) ? 'M-126' : 'M-127';
    const other = (await apiA('GET', `/missions/${mid}/hierarchy`)).body.nodes.find((n) => n.agentId !== running.owner && n.agentId !== 'gm');
    const r = await apiA('POST', `/tasks/${running.id}/reassign`, { toInstanceId: other.instanceId }, { 'idempotency-key': key() });
    check('reassigning a running task is refused (409) and the owner stays', r.status === 409 && (await apiA('GET', `/tasks/${running.id}`)).body.task.owner === running.owner, r.body.message);
  }
  await A.p.screenshot({ path: `${SHOTS}/stage6-task-actions.png` });

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
  const actText = async () => A.p.locator('.mc-budget, .mw-min-budget').first().innerText();
  const act1 = await actText();
  await A.p.waitForTimeout(2500);
  check('E8: a real mission\'s Activity says "not measured yet", with no numbers and nothing ticking',
    (await A.p.locator('[data-activity="not-measured"]').count()) > 0 && /not measured yet/i.test(act1) && !/\d+(\.\d+)?k? tok/i.test(act1) && act1 === await actText(), act1.replace(/\s+/g, ' '));
  await A.p.screenshot({ path: `${SHOTS}/stage6-thread-real.png` });

  // ------------------------------------------------------------ a long thread: newest 50 first, older pages on scroll, no jump
  for (let i = 0; i < 130; i += 10) {
    await Promise.all(Array.from({ length: 10 }, (_, j) => apiA('POST', `/threads/${gmThread.id}/messages`, { kind: 'command', text: `paging message ${String(i + j + 1).padStart(3, '0')}`, to: 'gm' }, { 'idempotency-key': key() })));
  }
  const total = ((await apiA('GET', `/missions/${realId}/threads`)).body.threads ?? []).find((t) => t.id === gmThread.id)?.count;
  await A.p.reload({ waitUntil: 'domcontentloaded' });
  // the thread is virtualised since improvement cycle 26: only the rows near the viewport are in the DOM.
  // The loaded messages, in order: the minimap draws one block per loaded message (data-mm = its id); `reach` below proves
  // each of them is rendered when the reader scrolls to it, so this is not a count taken on faith
  const loaded = () => A.p.locator('.conv-main .minimap .mm-block').evaluateAll((els) => els.map((e) => e.getAttribute('data-mm')));
  /** walk the thread from the top to the bottom: every row rendered on the way, in order, and the rows' aria-posinset / aria-setsize */
  const reach = () => A.p.locator('.conv-main .thread-body').evaluate(async (el) => {
    const raf = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    el.scrollTop = 0; await raf(); await raf();
    const seen = [], set = new Set();
    const first = el.querySelector('[data-mid]');
    const top = { id: first?.getAttribute('data-mid'), pos: first?.getAttribute('aria-posinset'), size: first?.getAttribute('aria-setsize') };
    for (let steps = 0; steps < 2000; steps++) {
      await raf();
      for (const r of el.querySelectorAll('[data-mid]')) { const id = r.getAttribute('data-mid'); if (!set.has(id)) { set.add(id); seen.push(id); } }
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 2) break;
      el.scrollTop += Math.round(el.clientHeight * 0.8);
    }
    return { seen, top };
  });
  check('opening the long thread loads the newest 50', await until(async () => (await loaded()).length === 50, 10000), `${(await loaded()).length} of ${total}`);
  check('the first page is pinned to the bottom (newest visible)', await A.p.locator('.conv-main .thread-body').evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight < 60));
  let pages = 0, worst = 0;
  for (let round = 0; round < 3; round++) {
    const before = (await loaded()).length;
    if (before >= total) break;
    // scroll to the top; remember the message at the top and its offset
    const anchor = await A.p.locator('.conv-main .thread-body').evaluate((el) => {
      el.scrollTop = 0;
      const box = el.getBoundingClientRect();
      const first = [...el.querySelectorAll('[data-mid]')].find((n) => n.getBoundingClientRect().bottom > box.top);
      return { id: first.getAttribute('data-mid'), top: first.getBoundingClientRect().top - box.top };
    });
    const grew = await until(async () => (await loaded()).length > before, 8000);
    await A.p.waitForTimeout(400);
    const after = await A.p.locator('.conv-main .thread-body').evaluate((el, id) => { const n = el.querySelector(`[data-mid="${id}"]`); return n ? n.getBoundingClientRect().top - el.getBoundingClientRect().top : null; }, anchor.id);
    if (grew) pages++;
    worst = Math.max(worst, after == null ? 999 : Math.abs(after - anchor.top));
    await A.p.locator('.conv-main .thread-body').evaluate((el) => { el.scrollTop += 300; }); // leave the top before the next round
    await A.p.waitForTimeout(200);
  }
  const all = await loaded();
  check('scrolling up loads older pages', pages >= 2 && all.length === total, `${pages} pages · ${all.length}/${total} messages`);
  check('the message at the top stays in place while a page loads (no jump)', worst <= 4, `worst shift ${worst.toFixed(1)} px`);
  check('no duplicate messages after paging', new Set(all).size === all.length);
  // cycle 26: was "one DOM row and one minimap block per loaded message". The rows are virtualised now, so the check asserts
  // the intent: every loaded message is reachable (scrolled to from the top, each one renders, in order, the first one
  // first), the rows say where they are in the whole thread (aria-posinset / aria-setsize = the thread's length), and the
  // minimap has one block per message
  const w = await reach();
  check('every loaded message is reachable on the long thread: a walk from the top renders each one in order; aria-setsize and the minimap count every message',
    (await A.p.locator('.conv-main .minimap').count()) > 0 && w.seen.length === all.length && w.seen.every((id, i) => id === all[i]) && w.top.id === all[0] && w.top.pos === '1' && Number(w.top.size) === total,
    `${w.seen.length} rendered on the walk / ${all.length} minimap blocks / aria-setsize ${w.top.size} · first row posinset ${w.top.pos}`);

  // ------------------------------------------------------------ fix round 1: > 50 messages while A's stream is down → no gap after the reconnect
  const API_PID = Number(process.env.API_PID || 0);
  const health = () => fetch(base + '/api/v1/health').then((r) => r.ok).catch(() => false);
  const seqOf = new Map();
  if (API_PID) {
    await A.ctx.setOffline(true);
    process.kill(API_PID, 'SIGUSR2'); // drops every open stream; A stays offline, so A misses everything below
    await until(async () => !(await health()), 8000, 100);
    await until(health, 20000, 200);
    await until(async () => (await apiB('GET', '/me')).status === 200, 10000, 200);
    for (let i = 0; i < 60; i += 10) {
      await Promise.all(Array.from({ length: 10 }, (_, j) => apiB('POST', `/threads/${gmThread.id}/messages`, { kind: 'command', text: `gap message ${String(i + j + 1).padStart(3, '0')}`, to: 'gm' }, { 'idempotency-key': key() })));
    }
    // the server's whole thread (id → seq), newest first, page by page
    let before = null;
    for (;;) {
      const pg = (await apiA('GET', `/threads/${gmThread.id}/messages?limit=200&mark=0${before ? `&before=${before}` : ''}`)).body;
      for (const m of pg.messages) seqOf.set(m.id, m.seq);
      if (!pg.hasMore) break;
      before = pg.nextBefore;
    }
    await A.ctx.setOffline(false);
    check('A reconnects after the outage', await until(async () => (await conn(A.p)) === 'live', 45000, 300));
    check('the newest message from the outage appears', await until(async () => (await threadText(A.p)).includes('gap message 060'), 10000));
    // I4: the reconnect re-read is a background read, so what arrived while offline is still unread on the server
    const unreadA = ((await apiA('GET', `/missions/${realId}/threads`)).body.threads ?? []).find((t) => t.id === gmThread.id)?.unread ?? 0;
    check('I4: after the reconnect, messages that arrived while offline still count as unread', unreadA >= 60, `unread ${unreadA}`);
    const shown = (await loaded()).map((id) => seqOf.get(id)).filter((x) => x !== undefined).sort((x, y) => x - y);
    const contiguous = shown.every((x, i) => i === 0 || x === shown[i - 1] + 1);
    check('no hole in the thread after the reconnect (loaded messages are contiguous)', shown.length > 0 && contiguous, `${shown.length} shown, seq ${shown[0]}…${shown[shown.length - 1]}`);
    for (let round = 0; round < 8 && (await loaded()).length < seqOf.size; round++) {
      const n0 = (await loaded()).length;
      await A.p.locator('.conv-main .thread-body').evaluate((el) => { el.scrollTop = 0; });
      await until(async () => (await loaded()).length > n0, 6000);
      await A.p.locator('.conv-main .thread-body').evaluate((el) => { el.scrollTop += 300; });
      await A.p.waitForTimeout(200);
    }
    const after = await loaded();
    const w2 = await reach(); // cycle 26: and each of them renders when scrolled to
    check('scrolling up after the reconnect reaches the whole thread, without duplicates', after.length === seqOf.size && new Set(after).size === after.length && w2.seen.length === after.length && w2.seen.every((id, i) => id === after[i]),
      `${after.length}/${seqOf.size} · ${w2.seen.length} rendered on a walk from the top`);
  } else check('reconnect gap check needs API_PID (run through api-e2e.sh)', false);

  // I2: a real mission has no report; the Reports tab is an honest empty state, not the prototype's invented one
  await A.p.goto(`${base}/missions/${realId}?tab=reports`, { waitUntil: 'domcontentloaded' });
  check('I2: a real mission\'s Reports tab says reports arrive when agents start working', await until(async () => (await A.p.getByText(/Reports arrive when agents start working/).count()) > 0, 8000));
  check('I2: no invented lead report on a real mission', (await A.p.getByText(/Lead synthesized report|Revision 3/).count()) === 0 && (await A.p.locator('.report-doc').count()) === 0);
  // real missions have no results or timeline yet (Stage 8); the empty states say so
  await A.p.goto(`${base}/missions/${realId}?tab=results`, { waitUntil: 'domcontentloaded' });
  check('a real mission\'s Results tab says results arrive in Stage 8', await until(async () => (await A.p.getByText(/Results arrive in Stage 8/).count()) > 0, 8000));

  // ------------------------------------------------------------ made private while B has the thread open → 404 → B leaves
  await B.p.goto(`${base}/missions/${realId}?tab=conversations&agent=gm`, { waitUntil: 'domcontentloaded' });
  await composer(B.p).waitFor({ timeout: 10000 });
  check('B has the shared real mission\'s thread open', await until(async () => (await threadText(B.p)).includes('gap message 060'), 8000));
  // hold B's re-read of the mission, so the un-share event cannot move B away before B writes (the composer path is what is tested)
  let holdOne = true; // hold the event-triggered re-read only; the composer's own confirmation (GET → 404) goes through
  await B.ctx.route(new RegExp(`/api/v1/missions/${realId}$`), (route) => { if (route.request().method() !== 'GET' || !holdOne) return route.continue(); holdOne = false; held.push(route); });
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

  // ------------------------------------------------------------ Task 6: direct channels (administrators line, GM) on the server
  const dock = (p) => p.locator('[data-dialog="chat-dock"]');
  const dockText = (p) => dock(p).locator('.thread-body').first().innerText();
  const openDock = async (p) => { await p.locator('button[aria-label^="Chat with the General Manager"]').click(); await dock(p).waitFor({ timeout: 8000 }); };
  const dockSend = async (p, text) => { const c = dock(p).locator('.composer').first(); await c.locator('textarea').fill(text); await c.getByRole('button', { name: 'Send message' }).click(); };
  await B.p.goto(base + '/', { waitUntil: 'domcontentloaded' });
  await A.p.goto(base + '/', { waitUntil: 'domcontentloaded' });
  await B.p.locator('.rail-nav').first().waitFor({ timeout: 15000 }); await A.p.locator('.rail-nav').first().waitFor({ timeout: 15000 });
  await until(async () => (await conn(B.p)) === 'live' && (await conn(A.p)) === 'live', 15000);
  await openDock(A.p); // A (administrator) is watching before B writes
  await openDock(B.p);
  await dock(B.p).locator('.chat-ch', { hasText: 'Administrators' }).first().click();
  const toAdmins = `Stage6 admin line: can I get a second device? ${Date.now()}`;
  await dockSend(B.p, toAdmins);
  check('B writes to the administrators and sees the message in the dock', await until(async () => (await dockText(B.p)).includes(toAdmins), 8000));
  check('A (administrator) gets a "Users to administrators" line with B\'s message, live',
    await until(async () => (await dock(A.p).locator('.chat-dock-sec', { hasText: 'Users → administrators' }).count()) > 0 && (await dock(A.p).locator('.chat-ch', { hasText: 'Mina' }).count()) > 0, 10000));
  await dock(A.p).locator('.chat-ch', { hasText: 'Mina' }).first().click();
  check('A reads it in that line', await until(async () => (await dockText(A.p)).includes(toAdmins), 8000));
  const answer = `Yes, approve it in Settings > Devices ${Date.now()}`;
  await dockSend(A.p, answer);
  check('B sees the administrator\'s answer live (a real human reply, authored by Luca)', await until(async () => { const t = await dockText(B.p); return t.includes(answer) && t.includes('Luca'); }, 10000));
  const notes = (await apiB('GET', '/notifications')).body.notifications ?? [];
  const note = notes.find((n) => /administrator answered/i.test(n.title));
  check('B gets a notification with a route to the chat', !!note && note.route === '/?chat=admin' && note.body.includes('approve it in Settings'), note ? note.route : 'none');
  await B.p.screenshot({ path: `${SHOTS}/stage6-admin-line-B.png` });
  await A.p.screenshot({ path: `${SHOTS}/stage6-admin-line-A.png` });
  await B.p.goto(base + '/?chat=admin', { waitUntil: 'domcontentloaded' });
  check('following the notification opens the administrators line', await until(async () => (await dock(B.p).count()) > 0 && (await dockText(B.p)).includes(answer) && !B.p.url().includes('chat=admin'), 12000));
  // the GM line: stored, honest note, no invented reply; the administrator never sees it
  await dock(B.p).locator('.chat-ch', { hasText: 'General Manager' }).first().click();
  const toGm = `Stage6 GM line: plan my week ${Date.now()}`;
  await dockSend(B.p, toGm);
  check('B writes to the General Manager: stored, with the honest note and no invented reply',
    await until(async () => { const t = await dockText(B.p); return t.includes(toGm) && t.includes("can't answer yet"); }, 8000));
  await B.p.waitForTimeout(4500); // the demo store would have replied within ~2 s
  const gmText = await dockText(B.p);
  check('nothing answered as the General Manager (no simulated reply)', !/Noted,|Understood\. To start|Short status/.test(gmText) && (await B.p.locator('[data-dialog="chat-dock"] .bubble-row.left .bubble-meta b', { hasText: 'General Manager' }).count()) === 0);
  const aChans = (await apiA('GET', '/channels')).body.channels ?? [];
  check('the administrator\'s channel list has Mina\'s admin line but never her GM line', aChans.some((c) => c.kind === 'admin' && c.userId === mina.id) && !aChans.some((c) => c.userId === mina.id && c.kind !== 'admin'));
  const aGm = await apiA('GET', `/channels/admin/${mina.id}/messages`);
  check('an administrator reads the admin line but the GM line has no admin path', aGm.status === 200 && (await apiA('GET', `/channels/gm/${mina.id}/messages`)).status === 404);
  // one agent: the picker opens the channel; the honest note names the agent
  await dock(B.p).locator('select[aria-label="Start a chat with an agent"]').selectOption({ label: 'Coder-01' });
  await dock(B.p).getByRole('button', { name: 'Open chat' }).click();
  const toAgent = `Stage6 agent line: write a test ${Date.now()}`;
  await dockSend(B.p, toAgent);
  check('B writes to an agent: stored (queued) with the agent\'s honest note',
    await until(async () => { const t = await dockText(B.p); return t.includes(toAgent) && /can't answer yet — this is stored and will be delivered when execution starts/.test(t); }, 8000));
  check('the agent line is on the server and private to B', (await apiB('GET', '/channels')).body.channels.some((c) => c.kind === 'agent' && c.agentId === 'coder-01') && !(await apiA('GET', '/channels')).body.channels.some((c) => c.kind === 'agent' && c.userId === mina.id));
  await B.p.screenshot({ path: `${SHOTS}/stage6-gm-line-B.png` });

  // ------------------------------------------------------------ Task 7: Agents pages on the server
  const DIR = `${base}/operations?tab=agents&sub=directory&view=cards`;
  await A.p.goto(DIR, { waitUntil: 'domcontentloaded' });
  await B.p.goto(DIR, { waitUntil: 'domcontentloaded' });
  const cardsOf = (p) => p.locator('.agent-card');
  await until(async () => (await cardsOf(A.p).count()) > 5 && (await cardsOf(B.p).count()) > 5, 12000);
  const before = (await apiA('GET', '/agents')).body.agents.length;
  check('B (member) sees no New Agent button', (await B.p.getByRole('button', { name: 'New Agent' }).count()) === 0 && (await A.p.getByRole('button', { name: 'New Agent' }).count()) === 1);
  check('the server refuses a member creating an agent (403)', (await apiB('POST', '/agents', { name: 'X', role: 'x', dept: 'QA', duty: 'x duty', model: 'claude-sonnet-5-5' }, { 'idempotency-key': key() })).status === 403);
  await A.p.getByRole('button', { name: 'New Agent' }).click();
  const dlg = A.p.locator('[role="dialog"]').first();
  await dlg.waitFor({ timeout: 5000 });
  await dlg.getByPlaceholder('Marketer-01').fill('Marketer-01');
  await dlg.getByLabel('Role', { exact: true }).fill('marketing');
  await dlg.getByPlaceholder('e.g. Marketing').fill('Marketing outreach');
  await dlg.getByPlaceholder('copywriting, SEO').fill('copywriting, SEO');
  await dlg.getByRole('button', { name: 'Create agent', exact: true }).last().click();
  check('the dialog closes and the server has the new agent', await until(async () => (await dlg.count()) === 0 && (await apiA('GET', '/agents')).body.agents.some((a) => a.id === 'marketer-01'), 8000));
  check('A\'s Directory shows the new agent without a reload', await until(async () => (await cardsOf(A.p).filter({ hasText: 'Marketer-01' }).count()) === 1, 8000));
  check('B\'s Directory shows it without a reload (second browser)', await until(async () => (await cardsOf(B.p).filter({ hasText: 'Marketer-01' }).count()) === 1, 8000));
  const newCard = cardsOf(A.p).filter({ hasText: 'Marketer-01' });
  check('the new agent says "not enough evidence": no success number, a "0 tasks / 90 days" chip', (await newCard.innerText()).includes('n/a') && (await newCard.locator('[data-provenance="measured"]').innerText()).includes('0 tasks / 90 days'));
  check('a seeded agent\'s card carries the DEMO chip', (await cardsOf(A.p).filter({ hasText: 'Site-Wanted-KR' }).locator('.demo-tag').count()) > 0);
  await A.p.screenshot({ path: `${SHOTS}/stage6-agents-directory.png` });
  await A.p.keyboard.press('Control+k');
  await A.p.locator('.palette-input').fill('Marketer');
  check('Ctrl K finds the new agent (A)', await until(async () => (await A.p.locator('.palette-item', { hasText: 'Marketer-01' }).count()) > 0, 5000));
  await A.p.keyboard.press('Escape');
  await B.p.keyboard.press('Control+k');
  await B.p.locator('.palette-input').fill('Marketer');
  check('Ctrl K finds the new agent (B, no reload)', await until(async () => (await B.p.locator('.palette-item', { hasText: 'Marketer-01' }).count()) > 0, 5000));
  await B.p.keyboard.press('Escape');
  // hierarchy, both browsers
  await A.p.goto(`${base}/operations?tab=agents&sub=directory&view=hierarchy`, { waitUntil: 'domcontentloaded' });
  await B.p.goto(`${base}/operations?tab=agents&sub=directory&view=hierarchy`, { waitUntil: 'domcontentloaded' });
  const graph = (await apiA('GET', '/organization/graph')).body;
  check('the Hierarchy draws the new agent (A) and names the active org revision', await until(async () => (await A.p.locator('.ah-node[data-agent="marketer-01"]').count()) === 1 && (await A.p.locator('[data-org-revision]').count()) === 1, 10000), `revision ${graph.revision?.seq}`);
  check('the node knows its manager from the graph', (await A.p.locator('.ah-node[data-agent="marketer-01"]').getAttribute('data-manager')) === graph.edges.find((e) => e.subordinateId === 'marketer-01')?.supervisorId);
  const stored = graph.edges.find((e) => e.subordinateId === 'marketer-01')?.supervisorId;
  check('the Hierarchy draws the agent\'s reporting line from the supervisor the server stored', !!stored && (await A.p.locator(`svg.ah-links path[data-to="marketer-01"][data-from="${stored}"]`).count()) === 1, `supervisor ${stored}`);
  check('B sees the new agent in the Hierarchy too', await until(async () => (await B.p.locator('.ah-node[data-agent="marketer-01"]').count()) === 1, 10000));
  await A.p.waitForTimeout(900);
  await A.p.screenshot({ path: `${SHOTS}/stage6-agents-hierarchy.png` });
  // a live creation while B watches the hierarchy
  const live = await apiA('POST', '/agents', { name: 'Analyst-X', role: 'analyst-x', dept: 'R&D', duty: 'Funnel analysis', model: 'claude-sonnet-5-5', skills: [], tools: [] }, { 'idempotency-key': key() });
  check('an agent created over the API appears in B\'s open Hierarchy live', live.status === 201 && await until(async () => (await B.p.locator('.ah-node[data-agent="analyst-x"]').count()) === 1, 10000));
  const sub = await apiA('POST', '/agents', { name: 'Copy-X', role: 'copy-x', dept: 'Engineering', duty: 'Copy editing', model: 'claude-sonnet-5-5', managerId: 'researcher-01' }, { 'idempotency-key': key() });
  check('an agent created under another supervisor is drawn under that supervisor in B\'s open Hierarchy, live', sub.status === 201 && await until(async () => (await B.p.locator('svg.ah-links path[data-to="copy-x"][data-from="researcher-01"]').count()) === 1 && (await B.p.locator('.ah-node[data-agent="copy-x"]').count()) === 1, 10000), `edge ${JSON.stringify((await apiA('GET', '/organization/graph')).body.edges.find((e) => e.subordinateId === 'copy-x'))}`);
  // duplicate role: the server's message, inline
  await A.p.goto(DIR, { waitUntil: 'domcontentloaded' });
  await cardsOf(A.p).first().waitFor({ timeout: 10000 });
  const nAgents = (await apiA('GET', '/agents')).body.agents.length;
  await A.p.getByRole('button', { name: 'New Agent' }).click();
  const dlg2 = A.p.locator('[role="dialog"]').first();
  await dlg2.getByPlaceholder('Marketer-01').fill('Marketer-02');
  await dlg2.getByLabel('Role', { exact: true }).fill('marketing');
  await dlg2.getByPlaceholder('e.g. Marketing').fill('Brand partnerships');
  await dlg2.getByRole('button', { name: 'Create agent', exact: true }).last().click();
  check('a duplicate role shows the server\'s message inline and keeps the dialog open', await until(async () => (await dlg2.getByText('An agent already holds this role').count()) > 0, 8000) && (await dlg2.count()) === 1);
  check('nothing was created', (await apiA('GET', '/agents')).body.agents.length === nAgents);
  await dlg2.getByLabel('Role', { exact: true }).fill('partnerships');
  check('editing the role clears the error', await until(async () => (await dlg2.getByText('An agent already holds this role').count()) === 0, 3000));
  await dlg2.getByRole('button', { name: 'Cancel' }).click();
  // edit skills: v(n+1) in Versions, the running mission's instance keeps v(n)
  const des = (await apiA('GET', '/agents/designer-01')).body.agent;
  const inst = (await apiA('GET', '/agent-instances?agentId=designer-01')).body.instances;
  const oldLabel = des.versionLabel;
  check('designer-01 has a running instance pinned to its current version', inst.length > 0 && inst.every((i) => i.versionLabel === oldLabel), `${inst.length} instances on ${oldLabel}`);
  await A.p.goto(`${base}/agents/designer-01`, { waitUntil: 'domcontentloaded' });
  await A.p.getByRole('button', { name: 'Edit', exact: true }).click();
  const dlg3 = A.p.locator('[role="dialog"]').first();
  const skillsIn = dlg3.getByLabel('Skills', { exact: true });
  await skillsIn.fill(`${await skillsIn.inputValue()}, e2e-skill`);
  await dlg3.getByRole('button', { name: 'Save' }).click();
  await until(async () => (await dlg3.count()) === 0, 8000);
  check('the server created the next version', await until(async () => { const a = (await apiA('GET', '/agents/designer-01')).body.agent; return a.versionLabel !== oldLabel && a.versions.length === des.versions.length + 1; }, 8000));
  const newLabel = (await apiA('GET', '/agents/designer-01')).body.agent.versionLabel;
  await A.p.goto(`${base}/agents/designer-01?tab=evolution`, { waitUntil: 'domcontentloaded' });
  check('Versions lists v(n+1) as active and v(n) as earlier', await until(async () => (await A.p.locator(`[data-versions] [data-version="${newLabel}"]`).innerText()).includes('active') && (await A.p.locator(`[data-versions] [data-version="${oldLabel}"]`).innerText()).includes('earlier'), 8000), `${oldLabel} → ${newLabel}`);
  await A.p.screenshot({ path: `${SHOTS}/stage6-agent-versions.png` });
  await A.p.goto(`${base}/agents/designer-01?tab=instances`, { waitUntil: 'domcontentloaded' });
  check('the Instances tab still shows the running instance on v(n)', await until(async () => { const t = await A.p.locator('[data-pinned]').allInnerTexts(); return t.length > 0 && t.every((x) => x.trim() === oldLabel); }, 8000));
  await A.p.goto(`${base}/agents/designer-01?tab=profile`, { waitUntil: 'domcontentloaded' });
  check('Current missions lists the instance with its pinned version', await until(async () => (await A.p.locator('[data-current-missions] [data-instance]').count()) > 0 && (await A.p.locator('[data-current-missions]').innerText()).includes(oldLabel), 8000));
  // a stale edit (another admin changed it) is a 409, never an overwrite
  const stale = await apiA('PATCH', '/agents/designer-01', { description: 'late edit' }, { 'if-match': String(des.rowVersion) });
  check('a stale edit is refused with 409', stale.status === 409);
  // a 409 inside the open dialog: the message, the new version adopted, and the next Save works
  await A.p.goto(`${base}/agents/designer-01`, { waitUntil: 'domcontentloaded' });
  await A.p.getByRole('button', { name: 'Edit', exact: true }).click();
  const dlg4 = A.p.locator('[role="dialog"]').first();
  const sk4 = dlg4.getByLabel('Skills', { exact: true });
  await sk4.waitFor({ timeout: 5000 });
  const cur4 = (await apiA('GET', '/agents/designer-01')).body.agent;
  const vCount = cur4.versions.length;
  await sk4.fill(`${await sk4.inputValue()}, second-skill`);
  await apiA('PATCH', '/agents/designer-01', { description: 'changed by another administrator' }, { 'if-match': String(cur4.rowVersion) });
  await dlg4.getByRole('button', { name: 'Save' }).click();
  check('a 409 in the Edit dialog says someone changed it', await until(async () => (await dlg4.getByText('Someone changed this agent meanwhile').count()) > 0, 8000));
  await dlg4.getByRole('button', { name: 'Save' }).click();
  check('after the 409 the next Save succeeds (the new version was adopted)', await until(async () => (await dlg4.count()) === 0 && (await apiA('GET', '/agents/designer-01')).body.agent.versions.length === vCount + 1, 8000));
  await A.p.goto(`${base}/operations?tab=agents&sub=live-instances`, { waitUntil: 'domcontentloaded' });
  check('Live Instances lists the server\'s instances with their pinned versions', await until(async () => (await A.p.locator('[data-live-instances] tbody tr').count()) > 0, 10000));
  const dRow = await A.p.locator('[data-live-instances] tr[data-agent="designer-01"] [data-pinned]').allInnerTexts();
  check('designer-01 still shows v(n) in Live Instances', dRow.length > 0 && dRow.every((x) => x.trim() === oldLabel), dRow.join(','));
  check('Live Instances carries no DEMO tag over the server rows', (await A.p.locator('div:has(> span:text-matches("live instances across")) .demo-tag').count()) === 0);
  await A.p.screenshot({ path: `${SHOTS}/stage6-agents-live-instances.png` });
  // member: read-only profile
  await B.p.goto(`${base}/agents/designer-01?tab=evolution`, { waitUntil: 'domcontentloaded' });
  check('B sees the versions but no Edit buttons', await until(async () => (await B.p.locator('[data-versions] [data-version]').count()) >= 2, 8000) && (await B.p.getByRole('button', { name: 'Edit', exact: true }).count()) === 0);
  // a new agent's profile says "not enough evidence"
  await A.p.goto(`${base}/agents/marketer-01?tab=performance`, { waitUntil: 'domcontentloaded' });
  check('a new agent\'s profile says "not enough evidence" (no invented numbers)', await until(async () => (await A.p.getByText('Not enough evidence yet').count()) > 0 && (await A.p.locator('[data-provenance="measured"]').count()) > 0, 8000));
} catch (e) { check('script ran to the end', false, String(e).split('\n')[0]); }
await A?.p.screenshot({ path: `${SHOTS}/stage6-end-A.png` }).catch(() => {});
await B?.p.screenshot({ path: `${SHOTS}/stage6-end-B.png` }).catch(() => {});
console.log(errors.length ? 'PAGE ERRORS:\n' + errors.join('\n') : 'no page errors');
console.log(`${results.filter((r) => r.startsWith('PASS')).length}/${results.length} passed`);
writeFileSync('/tmp/axion-api-e2e/api-stage6.txt', results.join('\n') + '\n');
await b.close();
process.exit(results.some((r) => r.startsWith('FAIL')) || errors.length ? 1 : 0);
