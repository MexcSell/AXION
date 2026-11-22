// Cycle 68 (lane w66), api mode: the "Needs you" queue (Overview). Admin (Luca) and member (Mina) sessions, run through scripts/api-e2e.sh.
// Checks: the list is built from server rows (a harness adds one record of every kind through server/src/cli/e2e-attention.ts), one-screen fit at
// 1366x768 in both themes, a ? on every row, evidence at most 3 clicks from the list (two here), keyboard use, member visibility per row kind
// (compared with the source routes), folded counts equal the items inside, a live update, and 390 px. Screenshots go to $SHOTS.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const base = process.env.BASE || 'http://127.0.0.1:5193';
const SHOTS = process.env.SHOTS || '/tmp/axion-c68';
mkdirSync(SHOTS, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.PW_CHROME || '/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome' });
const errors = [];
let fails = 0;
const check = (name, ok, extra = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };
const until = async (f, ms = 10000, step = 100) => { const t0 = Date.now(); for (;;) { try { if (await f()) return true; } catch { /* retry */ } if (Date.now() - t0 > ms) return false; await new Promise((r) => setTimeout(r, step)); } };
const open = async (label, theme = 'dark', size = { width: 1366, height: 768 }) => {
  const ctx = await b.newContext({ viewport: size });
  await ctx.addInitScript(([th]) => { try { localStorage.setItem('axion.data-mode', 'api'); localStorage.setItem('axion.testhook', '1'); if (!localStorage.getItem('axion.settings.v1')) localStorage.setItem('axion.settings.v1', JSON.stringify({ state: { themeMode: th, skin: 'luminous', motion: 'reduced' }, version: 0 })); } catch { /* ignore */ } }, [theme]);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_CONNECTION|EventSource|50[234]|403|409/.test(m.text())) errors.push(`${label} console: ${m.text()}`); });
  return { ctx, p };
};
const connect = async (p, name, pass) => {
  await p.getByRole('heading', { name: 'Connect' }).waitFor({ timeout: 15000 });
  await p.getByLabel('Name').fill(name);
  await p.getByLabel('Password', { exact: true }).fill(pass);
  await p.getByRole('button', { name: /Connect/ }).click();
};
const apiOf = (p) => {
  let csrf = '';
  return async (method, path, data, headers = {}) => {
    if (!csrf && method !== 'GET') csrf = (await (await p.request.get(base + '/api/v1/me')).json()).me.csrf;
    const r = await p.request.fetch(base + '/api/v1' + path, { method, data, headers: { ...(method !== 'GET' ? { 'x-csrf': csrf } : {}), ...headers } });
    return { status: r.status(), body: await r.json().catch(() => ({})) };
  };
};
let k = 0;
const key = () => ({ 'idempotency-key': `c68-${Date.now()}-${k++}` });
const gotoQueue = async (p) => { await p.goto(base + '/overview?tab=needs-you', { waitUntil: 'domcontentloaded' }); await p.locator('.ny-li').first().waitFor({ timeout: 20000 }); };
/** the page fits: no page scroll either way, and the list region keeps at least 200 px */
const fit = (p) => p.evaluate(() => { const m = document.querySelector('main'); const l = document.querySelector('.ny-scroll.ny-rows'); return { page: document.documentElement.scrollHeight - window.innerHeight, wide: document.documentElement.scrollWidth - window.innerWidth, main: m.scrollHeight - m.clientHeight, list: l ? Math.round(l.clientHeight) : 0 }; });
const rowsInView = (p) => p.evaluate(() => { const l = document.querySelector('.ny-scroll.ny-rows').getBoundingClientRect(); return [...document.querySelectorAll('.ny-li')].filter((e) => { const r = e.getBoundingClientRect(); return r.top >= l.top - 1 && r.bottom <= l.bottom + 1; }).length; });
const texts = (p) => p.locator('.ny-li .ny-why').allInnerTexts();

try {
  const A = await open('A');
  await A.p.goto(base + '/missions', { waitUntil: 'domcontentloaded' });
  await connect(A.p, 'Luca', 'secret-1');
  await A.p.waitForSelector('.rail-nav', { timeout: 20000 });
  const apiA = apiOf(A.p);
  const B = await open('B');
  await B.p.goto(base + '/missions', { waitUntil: 'domcontentloaded' });
  await connect(B.p, 'Mina', 'mina-pass');
  await B.p.getByRole('heading', { name: 'Waiting for approval' }).waitFor({ timeout: 10000 });
  const mina = ((await apiA('GET', '/users')).body.users ?? []).find((u) => u.name === 'Mina');
  await apiA('POST', `/users/${mina.id}/approve`, {});
  check('Mina connects after approval', await until(async () => (await B.p.locator('.rail-nav').count()) > 0, 15000));
  const apiB = apiOf(B.p);

  // ---- data: two missions (one shared, one private to the administrator), then one record of every kind
  const shared = (await apiB('POST', '/missions', { text: 'A shared mission for the attention queue.', files: [], shared: true }, key())).body.mission?.id;
  const priv = (await apiA('POST', '/missions', { text: 'A private mission of the administrator.', files: [], shared: false }, key())).body.mission?.id;
  check('two missions were created', !!shared && !!priv);
  const h = JSON.parse(execFileSync('node', ['--env-file=.env', '--import', 'tsx', 'src/cli/e2e-attention.ts', shared, priv], { cwd: new URL('../../server/', import.meta.url).pathname, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim().split('\n').pop());
  const lesson = (await apiB('POST', '/agents/coder-01/lessons', { text: 'Prefer role locators over css selectors.', sources: [{ kind: 'review', id: 'REV-1', note: 'seen twice' }] }, key())).body.lesson?.id;
  check('a person\'s lesson was proposed by Mina', !!lesson);

  // ---- the server queue
  const qa = (await apiA('GET', '/attention')).body, qb = (await apiB('GET', '/attention')).body;
  const kinds = new Set(qa.rows.map((r) => r.kind));
  check('admin queue: every row kind is present and there are at least 12 rows', kinds.size === 6 && qa.rows.length >= 12, `${qa.rows.length} rows, ${qa.totals.items} items, kinds ${[...kinds].join(',')}`);
  check('admin queue: totals add up (items = sum of counts; collapsed = items - rows)', qa.totals.items === qa.rows.reduce((s, r) => s + r.count, 0) && qa.totals.collapsed === qa.totals.items - qa.totals.rows && qa.rows.every((r) => r.count === r.members.length));
  check('ranked: R4 first, then R3, then the R2 rows', qa.rows[0].tier === 'R4' && qa.rows[1].tier === 'R3');

  // ---- admin, 1366x768, dark: fit, rows, ? on every row
  await gotoQueue(A.p);
  const n = await A.p.locator('.ny-li').count();
  check('the screen lists every row the server returned', n === qa.rows.length, `${n} of ${qa.rows.length}`);
  let f = await fit(A.p);
  check('dark 1366x768: no page scroll, no scroll sideways, list region at least 200 px', f.page <= 1 && f.wide <= 0 && f.main <= 1 && f.list >= 200, JSON.stringify(f));
  check('dark 1366x768: at least 12 rows are fully visible without scrolling the list', (await rowsInView(A.p)) >= 12, `${await rowsInView(A.p)} visible of ${n}`);
  check('every row has an icon, a reason label, its sentence and a ? beside it (not inside the row button)', await A.p.evaluate(() => [...document.querySelectorAll('.ny-li')].every((li) => li.querySelector('.ny-ico svg') && li.querySelector('.ny-kind')?.textContent && li.querySelector('.ny-why')?.textContent.length > 10 && li.querySelector(':scope > .help-btn') && !li.querySelector('button .help-btn'))));
  check('every reason code present has its own ? (aria-label names the reason)', await A.p.evaluate(() => { const l = [...document.querySelectorAll('.ny-li > .help-btn')].map((x) => x.getAttribute('aria-label')); return l.length === document.querySelectorAll('.ny-li').length && l.every((x) => /^Help: .{4,}/.test(x)); }));
  await A.p.screenshot({ path: `${SHOTS}/queue-1366-dark.png` });

  // ? opens a text for the reason, and it makes no claim about safety
  const reasons = [...new Set(qa.rows.map((r) => r.reason))];
  let helpOk = true; const helpBad = [];
  for (const code of reasons) {
    const btn = A.p.locator(`.ny-li:has(.ny-row[data-reason="${code}"]) > .help-btn`).first();
    await btn.scrollIntoViewIfNeeded(); await btn.click();
    const pop = A.p.locator('.help-pop');
    const ok = await until(async () => (await pop.count()) > 0 && (await pop.innerText()).length > 80, 4000);
    const t = ok ? await pop.innerText() : '';
    if (!ok || /\b(safe|safety|prevents? (errors|mistakes)|reduces? (errors|mistakes)|fewer mistakes)\b/i.test(t.replace(/Rule of Two/g, ''))) { helpOk = false; helpBad.push(code); }
    await A.p.keyboard.press('Escape'); await until(async () => (await A.p.locator('.help-pop').count()) === 0, 3000);
  }
  check('the ? of every reason code opens its own text (no safety claim)', helpOk, helpBad.join(',') || `${reasons.length} reasons`);

  // ---- three levels: evidence in 2 clicks (choose the row, choose Evidence); at most 3 allowed
  let clicks = 0;
  const first = A.p.locator('.ny-row').first();
  await first.click(); clicks++;
  await A.p.getByRole('radio', { name: /Evidence/ }).click(); clicks++;
  const ev = A.p.locator('.ny-evidence');
  await ev.waitFor({ timeout: 5000 });
  const evText = await ev.innerText();
  check('evidence is reached in at most 3 clicks and names the digest check and the Rule of Two flags', clicks <= 3 && /digest/i.test(evText) && /Rule of Two fired/.test(evText) && /Bound digest/.test(evText), `${clicks} clicks`);
  check('evidence is a check to run, not a reassurance', /\bCompare\b/.test(evText) && !/looks fine|no issues|all good|safe to/i.test(evText));
  await A.p.screenshot({ path: `${SHOTS}/evidence-1366-dark.png` });
  // a row of each other kind: the evidence level names its own check
  const want = { review_stale: /attempt/i, failure_no_detection: /detection channel/i, task_waiting_person: /change of state/i, org_proposal_expiring: /revision/i, version_proposal_expiring: /active version/i, lesson_system_derived: /system/i, lesson_awaiting_review: /sources?/i };
  let evAll = true; const evBad = [];
  for (const [code, re] of Object.entries(want)) {
    const row = A.p.locator(`.ny-row[data-reason="${code}"]`).first();
    if (!(await row.count())) { evAll = false; evBad.push(code + ' missing'); continue; }
    await row.scrollIntoViewIfNeeded(); await row.click();
    await A.p.getByRole('radio', { name: /Evidence/ }).click();
    if (!(await until(async () => re.test(await A.p.locator('.ny-evidence').innerText()), 4000))) { evAll = false; evBad.push(code); }
  }
  check('every other kind shows its own check at the evidence level', evAll, evBad.join(','));

  // ---- the action level follows the source rule: a request the viewer may not decide says why
  await A.p.locator('.ny-row[data-reason="org_proposal_expiring"]').first().click();
  await A.p.getByRole('radio', { name: /Action/ }).click();
  check('action: a proposal the administrator made themselves is locked, with the reason', await until(async () => /Another administrator/.test(await A.p.locator('.ny-level').innerText()), 4000));

  // ---- folded rows: the count equals the items listed under Activity
  const grp = A.p.locator('.ny-row:has(.ny-count)').first();
  const cnt = Number((await grp.locator('.ny-count').innerText()).replace(/\D/g, ''));
  await grp.click();
  await A.p.getByRole('radio', { name: /Activity/ }).click();
  await A.p.locator('.ny-members').waitFor({ timeout: 4000 });
  const listed = await A.p.locator('.ny-members .ny-mem').count();
  check('a folded row: its count equals the items listed under Activity', cnt > 1 && listed === cnt, `${cnt} counted, ${listed} listed`);
  check('the header says how many items are folded, and it equals items minus rows', (await A.p.locator('.ny-fold').innerText()).includes(String(qa.totals.collapsed)), `${qa.totals.collapsed} folded`);

  // ---- keyboard: arrows move the selection, Enter opens the evidence
  await A.p.locator('.ny-row').first().focus();
  await A.p.keyboard.press('ArrowDown');
  const second = await A.p.evaluate(() => document.activeElement?.getAttribute('aria-current') === 'true' && document.activeElement?.closest('li') === document.querySelectorAll('.ny-li')[1]);
  await A.p.keyboard.press('Enter');
  const evOn = await A.p.getByRole('radio', { name: /Evidence/ }).getAttribute('aria-checked');
  check('keyboard: ArrowDown selects the next row, Enter shows its evidence', second && evOn === 'true');

  // ---- live: deciding one R2 approval removes it from its folded row without a reload
  const r2 = qa.rows.find((r) => r.tier === 'R2' && r.count === 2);
  if (r2) {
    const aprs = (await apiA('GET', '/approvals')).body.approvals;
    const target = aprs.find((a) => a.id === h.r2a);
    const before = await A.p.locator(`.ny-row:has(.ny-count)`).count();
    const r = await apiA('POST', `/approvals/${h.r2a}/decision`, { decision: 'approved', digest: target.digest, reason: 'c68 check' }, key());
    check('the R2 approval was decided through the real route', r.status === 200, String(r.status));
    check('live: the queue re-reads by itself (the two-item R2 row becomes a single row)', await until(async () => (await A.p.locator('.ny-li').count()) === n && (await A.p.locator('.ny-row:has(.ny-count)').count()) === before - 1, 12000), `${await A.p.locator('.ny-li').count()} rows`);
  } else check('an R2 row of two items exists', false);

  // ---- member (Mina, 1366x768)
  await gotoQueue(B.p);
  const memberTexts = (await B.p.locator('.ny-scroll.ny-rows').innerText()).toString();
  check('member: nothing from the administrator\'s private mission appears (titles or ids)', !/Private form|Private release|Private report|Private question/.test(memberTexts) && !JSON.stringify(qb).includes(priv));
  const srcA = new Set(((await apiB('GET', '/approvals')).body.approvals ?? []).filter((a) => a.status === 'pending').map((a) => a.id));
  const inQ = (q, kind) => new Set(q.rows.filter((r) => r.kind === kind).flatMap((r) => r.members.map((m) => m.id.split(':')[1])));
  const qb2 = (await apiB('GET', '/attention')).body;
  const same = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
  check('member, approvals: exactly the pending approvals GET /approvals shows them', same(inQ(qb2, 'approval'), srcA));
  const lessonsSrc = new Set(((await apiB('GET', '/lessons?status=proposed')).body.lessons ?? []).map((l) => l.id));
  check('member, lessons: exactly their own candidates (the system-derived one is not theirs to see)', same(inQ(qb2, 'lesson'), lessonsSrc) && !inQ(qb2, 'lesson').has(h.system));
  let fOk = true;
  for (const t of [h.fail0, h.failOne, h.failP]) { const vis = (await apiB('GET', `/failure-tags?subjectKind=task&subjectId=${t}`)).status === 200; if ([...inQ(qb2, 'failure')].length && vis !== (await (async () => qb2.rows.some((r) => r.kind === 'failure' && r.members.some((m) => m.evidence.facts.some((x) => x.value.endsWith(t)))))())) fOk = false; }
  check('member, failures: only subjects of missions they can open', fOk && !qb2.rows.some((r) => r.kind === 'failure' && r.members.some((m) => m.evidence.facts.some((x) => x.value.endsWith(h.failP)))));
  check('member, reviews and waiting tasks: only tasks of missions they can open', !qb2.rows.some((r) => ['task_review', 'task_waiting'].includes(r.kind) && r.members.some((m) => m.id.endsWith(h.staleP) || m.id.endsWith(h.waitingP))) && qb2.rows.some((r) => r.kind === 'task_review') && qb2.rows.some((r) => r.kind === 'task_waiting'));
  check('member: R3 and R4 are visible but locked, with the reason', await (async () => { await B.p.locator('.ny-row[data-reason="approval_pending"]').first().click(); await B.p.getByRole('radio', { name: /Action/ }).click(); return until(async () => /administrator/i.test(await B.p.locator('.ny-level').innerText()), 4000); })());
  check('member: fewer rows than the administrator; no name of any person on the screen', qb2.rows.length < (await apiA('GET', '/attention')).body.rows.length && !/Luca|Mina/.test(memberTexts));
  f = await fit(B.p);
  check('member dark 1366x768: no page scroll', f.page <= 1 && f.wide <= 0 && f.main <= 1, JSON.stringify(f));
  await B.p.screenshot({ path: `${SHOTS}/queue-member-1366-dark.png` });

  // ---- light mode, 1366x768 (the same admin session)
  await A.p.evaluate(() => { const s = JSON.parse(localStorage.getItem('axion.settings.v1') || '{"state":{}}'); s.state.themeMode = 'light'; localStorage.setItem('axion.settings.v1', JSON.stringify(s)); });
  await gotoQueue(A.p);
  f = await fit(A.p);
  check('light 1366x768: no page scroll, list region at least 200 px, 12 rows visible', f.page <= 1 && f.wide <= 0 && f.main <= 1 && f.list >= 200 && (await rowsInView(A.p)) >= 12, JSON.stringify(f));
  await A.p.screenshot({ path: `${SHOTS}/queue-1366-light.png` });
  await A.p.getByRole('radio', { name: /Evidence/ }).click();
  await A.p.locator('.ny-evidence').waitFor({ timeout: 5000 });
  await A.p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))));
  await A.p.screenshot({ path: `${SHOTS}/evidence-1366-light.png` });

  // ---- 390 px (the member's session; dark)
  await B.p.setViewportSize({ width: 390, height: 844 });
  await gotoQueue(B.p);
  const wide = await B.p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check('390 px: no sideways scroll, rows are tappable (at least 34 px high)', wide <= 0 && await B.p.evaluate(() => [...document.querySelectorAll('.ny-row')].every((e) => e.getBoundingClientRect().height >= 33)), `overflow ${wide}`);
  await B.p.locator('.ny-list-panel').scrollIntoViewIfNeeded();
  await B.p.screenshot({ path: `${SHOTS}/queue-390-dark.png` });
  await B.p.locator('.ny-row').first().click();
  await B.p.getByRole('radio', { name: /Evidence/ }).click();
  await B.p.locator('.ny-evidence').scrollIntoViewIfNeeded();
  check('390 px: the evidence is reachable and does not scroll sideways', (await B.p.locator('.ny-evidence').isVisible()) && (await B.p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0);
  await B.p.screenshot({ path: `${SHOTS}/evidence-390-dark.png` });

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) {
  fails++;
  console.log('FAIL script error — ' + (e?.stack ?? e));
} finally {
  await b.close();
}
console.log(fails ? `RESULT: ${fails} FAIL` : 'RESULT: all PASS');
process.exit(fails ? 1 : 0);
