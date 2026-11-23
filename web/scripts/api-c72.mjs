// c72 (R3-7), api mode: difficulty-adjusted skill ratings on the Agent Profile, no leaderboard.
// 1. a real mission is staffed and a harness (server/src/cli/e2e-skill-fixture.ts) gives two agents finished tasks whose briefs name a class and a difficulty;
// 2. the API: filled cell (n >= 5, adjusted value and interval), null cell (n < 5 says "not enough evidence"), unrated count, fixed class order, compare says only
//    distinguishable or indistinguishable, no key names a rank or a position, pair ratings "not built";
// 3. the Performance tab shows the vector (fit one screen at 1366x768 in both themes, a ? help, levels chip, no rank or ordering words), and the comparison picker;
// 4. the Delegate / reassign dialog has optional Task class and Difficulty fields that reach the server, and the task drawer's brief card shows them.
// Run through scripts/api-e2e.sh (lane ports via E2E_API_PORT/E2E_WEB_PORT). Condition waits only (no networkidle). Screenshots: SHOTS.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const base = process.env.BASE || 'http://127.0.0.1:5193';
const SHOTS = process.env.SHOTS || `/tmp/axion-api-c72-${new URL(base).port}`;
mkdirSync(SHOTS, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.PW_CHROME || '/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome' });
const errors = [];
let fails = 0;
const check = (name, ok, extra = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };
const until = async (f, ms = 10000, step = 150) => { const t0 = Date.now(); for (;;) { try { if (await f()) return true; } catch { /* retry */ } if (Date.now() - t0 > ms) return false; await new Promise((r) => setTimeout(r, step)); } };
const open = async (theme = 'dark', size = { width: 1366, height: 768 }) => {
  const ctx = await b.newContext({ viewport: size });
  await ctx.addInitScript(([th]) => { try { localStorage.setItem('axion.data-mode', 'api'); localStorage.setItem('axion.testhook', '1'); if (!localStorage.getItem('axion.settings.v1')) localStorage.setItem('axion.settings.v1', JSON.stringify({ state: { themeMode: th, skin: 'luminous', motion: 'reduced' }, version: 0 })); } catch { /* ignore */ } }, [theme]);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_CONNECTION|EventSource|50[234]|403|409/.test(m.text())) errors.push(`console: ${m.text()}`); });
  return { ctx, p };
};
let csrf = '', k = 0;
const key = () => ({ 'idempotency-key': `c72-${Date.now()}-${k++}` });
const call = (p) => async (method, path, data, headers = {}) => {
  if (!csrf && method !== 'GET') csrf = (await (await p.request.get(base + '/api/v1/me')).json()).me.csrf;
  const r = await p.request.fetch(base + '/api/v1' + path, { method, data, headers: { ...(method !== 'GET' ? { 'x-csrf': csrf } : {}), ...headers } });
  return { status: r.status(), body: await r.json().catch(() => ({})) };
};
const fit = (p) => p.evaluate(() => { const m = document.querySelector('main'); return { page: document.documentElement.scrollHeight - window.innerHeight, wide: document.documentElement.scrollWidth - window.innerWidth, main: m.scrollHeight - m.clientHeight }; });
const BAN = /\b(rank(ed|ing)?|leaderboard|position|top \d|best agent|worst|#1|winner|better than)\b/i;
try {
  const A = await open('dark');
  const { p } = A, c = call(p);
  await p.goto(base + '/missions', { waitUntil: 'domcontentloaded' });
  await p.getByRole('heading', { name: 'Connect' }).waitFor({ timeout: 15000 });
  await p.getByLabel('Name').fill('Luca');
  await p.getByLabel('Password', { exact: true }).fill('secret-1');
  await p.getByRole('button', { name: /Connect/ }).click();
  check('connected and live', await until(async () => (await p.locator('.conn-badge').getAttribute('data-conn')) === 'live', 15000));
  const mid = (await c('POST', '/missions', { text: 'Build a website landing page for the shop.', files: [], shared: false }, key())).body.mission?.id;
  check('a real mission was created and staffed', !!mid && await until(async () => (await c('GET', `/missions/${mid}`)).body.mission?.staffing?.stage === 'working', 60000, 400), mid);
  const fx = JSON.parse(execFileSync('node', ['--env-file=.env', '--import', 'tsx', 'src/cli/e2e-skill-fixture.ts', mid], { cwd: new URL('../../server/', import.meta.url).pathname, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim().split('\n').pop());
  check('the harness gave two agents rated outcomes', !!fx.a && !!fx.b && fx.a !== fx.b, `${fx.a} and ${fx.b}`);

  // ---- the API
  const sa = (await c('GET', `/agents/${fx.a}/skills`)).body.skills;
  const cls = (id) => sa.classes.find((x) => x.classId === id);
  check('classes come in the fixed order (8 of them)', sa.classes.length === 8 && sa.classes.map((x) => x.classId).join() === 'research,writing,coding,data,browsing,planning,review,communication');
  check('coding: n = 16, ok, adjusted value with an interval around it', cls('coding').n === 16 && cls('coding').state === 'ok' && cls('coding').adjusted.lo < cls('coding').adjusted.value && cls('coding').adjusted.value < cls('coding').adjusted.hi, JSON.stringify(cls('coding').adjusted));
  check('coding: raw 94% and adjusted 94% (both agents\' levels 2 and 3 are weighted equally)', cls('coding').raw.value === 94 && cls('coding').adjusted.value >= 90);
  check('writing: 3 outcomes is null and says "not enough evidence (3 of 5)"', cls('writing').n === 3 && cls('writing').adjusted === null && cls('writing').raw === null && /not enough evidence \(3 of 5\)/.test(cls('writing').evidence));
  check('one finished task with a class but no difficulty is counted as unrated and in no cell', sa.unrated === 1 && cls('review').n === 0);
  check('pair ratings are "not built", with the reason', sa.pairRatings.built === false && /Nothing recorded/.test(sa.pairRatings.why));
  check('the rating says it depends on the delegator\'s stated difficulty and is gameable', sa.dependsOn.gameable === true && /set by the person or agent that delegates/.test(sa.dependsOn.text));
  const cmp = (await c('GET', `/agents/${fx.a}/skills/compare?with=${fx.b}`)).body.compare;
  const v = (id) => cmp.classes.find((x) => x.classId === id);
  check('compare: coding distinguishable (shared levels 2 and 3), research indistinguishable (no level in common)', v('coding')?.verdict === 'distinguishable' && v('coding').sharedLevels.join() === '2,3' && v('research')?.verdict === 'indistinguishable' && /no difficulty level in common/.test(v('research').reason));
  const all = JSON.stringify([sa, cmp]);
  check('no key or text in the skill responses names a rank, position, winner or direction', !/"(rank|position|place|leaderboard|winner|better|higher|score)"/i.test(all));
  const list = (await c('GET', '/agents')).body.agents;
  check('GET /agents carries no rating', !JSON.stringify(list).includes('"adjusted"') && list.length > 3);

  // ---- the Performance tab, dark then light, at 1366x768
  for (const theme of ['dark', 'light']) {
    const q = p; // the same signed-in session; the theme is switched through the stored setting and a fresh load
    await q.evaluate((th) => localStorage.setItem('axion.settings.v1', JSON.stringify({ state: { themeMode: th, skin: 'luminous', motion: 'reduced' }, version: 0 })), theme);
    await q.goto(`${base}/agents/${fx.a}?tab=performance`, { waitUntil: 'domcontentloaded' });
    check(`${theme}: the skill vector shows 8 rows`, await until(async () => (await q.locator('[data-testid="skill-vector"] .sk-row').count()) === 8, 20000));
    await q.waitForTimeout(700);
    const row = (id) => q.locator(`.sk-row[data-skill-class="${id}"]`);
    check(`${theme}: coding shows n=16, a value and the levels used`, /n=16/.test(await row('coding').innerText()) && (await row('coding').locator('[data-skill-value]').count()) === 1 && /levels 2–3/.test(await row('coding').innerText()), (await row('coding').innerText()).replace(/\n/g, ' | '));
    check(`${theme}: writing shows "not enough evidence (3 of 5)" and no rate`, /not enough evidence \(3 of 5\)/.test(await row('writing').innerText()) && (await row('writing').locator('[data-skill-value]').count()) === 0);
    check(`${theme}: classes without tasks say "no tasks yet"`, /no tasks yet/.test(await row('data').innerText()));
    const panelText = await q.locator('[data-testid="skill-vector"]').innerText();
    check(`${theme}: the panel never shows a rank, position or ordering word`, !BAN.test(panelText), panelText.match(BAN)?.[0] ?? '');
    const names = await q.locator('.sk-row .sk-name').allInnerTexts();
    check(`${theme}: rows stay in the fixed class order`, names.join('|') === 'Finding things out|Writing and editing|Writing and fixing code|Working with data|Using websites and forms|Planning and organising|Checking other work|Talking with people');
    const f = await fit(q);
    check(`${theme}: the page fits one screen (no page scroll, main overflow 0)`, f.page <= 0 && f.wide <= 0 && f.main <= 0, JSON.stringify(f));
    // compare picker
    await q.selectOption('select[aria-label="Compare with another agent"]', fx.b);
    check(`${theme}: the comparison says only distinguishable or indistinguishable`, await until(async () => (await q.locator('.sk-vd[data-verdict]').count()) >= 2, 10000));
    const verdicts = await q.locator('.sk-vd').allInnerTexts();
    check(`${theme}: verdict chips are only those two words (or a dash)`, verdicts.every((t) => /^(distinguishable|indistinguishable|—)$/.test(t.trim())), [...new Set(verdicts)].join());
    check(`${theme}: coding is distinguishable and research indistinguishable`, /^distinguishable/.test((await row('coding').locator('.sk-vd').innerText()).trim()) && /indistinguishable/.test(await row('research').locator('.sk-vd').innerText()));
    const opts = await q.locator('select[aria-label="Compare with another agent"] option').allInnerTexts();
    check(`${theme}: the picker lists agents by name, not by a rating`, opts.slice(1).join('|') === [...opts.slice(1)].sort((x, y) => x.localeCompare(y)).join('|'));
    const f2 = await fit(q);
    check(`${theme}: still fits one screen with the comparison open`, f2.page <= 0 && f2.wide <= 0 && f2.main <= 0, JSON.stringify(f2));
    // ? help in the panel header
    await q.locator('[data-testid="skill-vector"] .panel-head button[aria-label*="elp" i], [data-testid="skill-vector"] .panel-head [data-help]').first().click();
    check(`${theme}: the ? help opens and says the rating depends on stated difficulty`, await until(async () => /stated|set by the person or agent/i.test(await q.locator('body').innerText()) && /Pair ratings/i.test(await q.locator('body').innerText()), 5000));
    await q.screenshot({ path: `${SHOTS}/c72-performance-${theme}.png` });
    await q.keyboard.press('Escape');
  }

  // ---- a person who is not enough evidence: the agent with no rated tasks shows all-null rows
  await p.goto(`${base}/agents/${fx.b === 'planner-01' ? 'designer-01' : 'planner-01'}?tab=performance`, { waitUntil: 'domcontentloaded' });
  check('an agent with no rated tasks shows eight "no tasks yet" rows and no value', await until(async () => (await p.locator('.sk-row[data-skill-state="not_enough_evidence"]').count()) === 8, 15000) && (await p.locator('.sk-row [data-skill-value]').count()) === 0);

  // ---- the reassign dialog: optional task class and difficulty reach the server, and the drawer shows them
  const t126 = (await c('GET', '/missions/M-126/tasks')).body;
  const hier = (await c('GET', '/missions/M-126/hierarchy')).body;
  const movable = t126.find((t) => t.state !== 'running' && t.state !== 'passed' && t.state !== 'canceled');
  const newOwner = hier.nodes.find((n) => n.agentId !== 'gm' && n.agentId !== movable?.owner);
  const openTask = async () => {
    await p.goto(`${base}/missions/M-126?tab=task-flow`, { waitUntil: 'domcontentloaded' });
    const el = p.locator(`[aria-label^="${movable.id} "]`).first();
    await el.waitFor({ timeout: 10000 }); await el.click();
    await p.locator('[role="dialog"]').first().waitFor({ timeout: 5000 });
  };
  await openTask();
  await p.locator('[role="dialog"]').getByRole('button', { name: 'Reassign' }).click();
  const nm = (await c('GET', '/agents')).body.agents.find((a) => a.id === newOwner.agentId).name;
  await p.getByRole('button', { name: new RegExp(`^.*${nm}`) }).first().click();
  await p.getByPlaceholder(/needs browser specialist/).fill('c72 e2e');
  await p.getByTestId('brief-form').waitFor({ timeout: 5000 });
  await p.getByLabel('Goal').fill('Rework the hero section');
  await p.getByLabel('Acceptance criteria').fill('Hero fits on one screen');
  check('the hand-off form has optional Task class and Difficulty selects with a ?', (await p.getByTestId('brief-class').locator('select').count()) === 2 && (await p.getByTestId('brief-class').locator('button[aria-label*="elp" i], [data-help]').count()) >= 1);
  await p.getByTestId('brief-class').locator('select').nth(0).selectOption('coding');
  await p.getByTestId('brief-class').locator('select').nth(1).selectOption('4');
  await p.screenshot({ path: `${SHOTS}/c72-dialog.png` });
  await p.getByRole('button', { name: 'Submit Reassignment' }).click();
  check('the brief on the server carries taskClass coding and difficulty 4', await until(async () => ((await c('GET', '/missions/M-126/delegation-briefs')).body.briefs ?? []).some((x) => x.taskId === movable.id && x.brief.taskClass === 'coding' && x.brief.difficulty === 4), 8000));
  await openTask();
  check('the task drawer\'s brief card shows the class and the difficulty', await until(async () => /Writing and fixing code · difficulty 4 \(Hard\)/.test(await p.locator('[data-testid="brief-class-chip"]').innerText().catch(() => '')), 8000));

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' || '));
} catch (e) { fails++; console.log('FAIL script error —', e.message); } finally { await b.close(); }
console.log(fails ? `FAILED ${fails}` : 'api-c72 ok');
process.exit(fails ? 1 : 0);
