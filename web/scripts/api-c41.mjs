// Improvement cycle 41 (Phase 2, Wave 3, E4), api mode: reviewed playbooks and the skill library, in three browsers.
// B (second administrator) proposes a lesson from Agents > Development; the proposer cannot decide it (Accept is disabled, with a
// ? and the reason). A accepts it (live, no reload): playbook v1. B proposes a second lesson, A accepts: v2; History shows both and
// the diff of v2. A rolls back to v1: History gets v3 ("rollback to v1") and the playbook shows one item again. A contradiction
// is flagged and needs an override note in the dialog. C (member) sees the playbook read only. A skill is proposed by B (API),
// approved by A. Run through scripts/api-e2e.sh (lane ports E2E_API_PORT/E2E_WEB_PORT). Condition waits only (no networkidle).
// Screenshots are written to SHOTS; DOC_SHOT_C41=docs/screenshots/improve-c41 writes the committed ones.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const base = process.env.BASE || 'http://127.0.0.1:5193';
const SHOTS = process.env.SHOTS || `/tmp/axion-api-c41-${new URL(base).port}`;
const DOC_SHOT = process.env.DOC_SHOT_C41;
mkdirSync(SHOTS, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.PW_CHROME || '/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome' });
const results = [];
const errors = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); console.log(results[results.length - 1]); };
const until = async (f, ms = 10000, step = 150) => { const t0 = Date.now(); for (;;) { try { if (await f()) return true; } catch { /* retry */ } if (Date.now() - t0 > ms) return false; await new Promise((r) => setTimeout(r, step)); } };
const browser = async (label) => {
  const ctx = await b.newContext({ viewport: { width: Number(process.env.VW || 1600), height: Number(process.env.VH || 940) } });
  await ctx.addInitScript(() => { try { localStorage.setItem('axion.data-mode', 'api'); localStorage.setItem('axion.testhook', '1'); if (!localStorage.getItem('axion.settings.v1')) localStorage.setItem('axion.settings.v1', JSON.stringify({ state: { themeMode: 'dark' }, version: 0 })); } catch { /* ignore */ } });
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
const live = (p) => until(async () => (await p.locator('.conn-badge').getAttribute('data-conn')) === 'live', 15000);
const apiOf = (p) => {
  let csrf = '';
  return async (method, path, data, headers = {}) => {
    if (!csrf && method !== 'GET') csrf = (await (await p.request.get(base + '/api/v1/me')).json()).me.csrf;
    const r = await p.request.fetch(base + '/api/v1' + path, { method, data, headers: { ...(method !== 'GET' ? { 'x-csrf': csrf } : {}), ...headers } });
    return { status: r.status(), body: await r.json().catch(() => ({})) };
  };
};
const DEV = '/operations?tab=agents&sub=development';
let k = 0;
const key = () => ({ 'idempotency-key': `c41-${Date.now()}-${k++}` });
const X = 'coder-01';
const T1 = 'Keep pull requests under 300 changed lines.';
const T2 = 'Run the linter locally before pushing.';
const T3 = 'Never run the linter locally before pushing.';
let A, B, C;
const view = async (p, name) => { await p.getByRole('radio', { name }).click(); };
const panel = (p) => p.locator('[data-dev-playbooks]');
try {
  A = await browser('A');
  await A.p.goto(base + '/missions', { waitUntil: 'domcontentloaded' });
  await connect(A.p, 'Luca', 'secret-1');
  check('A (first user = administrator) is connected and live', await live(A.p));
  const apiA = apiOf(A.p);
  const join = async (label, name, pass, admin) => {
    const Y = await browser(label);
    await Y.p.goto(base + '/missions', { waitUntil: 'domcontentloaded' });
    await connect(Y.p, name, pass);
    await Y.p.getByRole('heading', { name: 'Waiting for approval' }).waitFor({ timeout: 10000 });
    const u = ((await apiA('GET', '/users')).body.users ?? []).find((x) => x.name === name);
    await apiA('POST', `/users/${u.id}/approve`, {});
    if (admin) await apiA('PATCH', `/users/${u.id}`, { role: 'admin' });
    await Y.p.locator('.rail-nav').first().waitFor({ timeout: 15000 });
    return Y;
  };
  B = await join('B', 'Bea', 'bea-pass', true);
  C = await join('C', 'Mina', 'mina-pass', false);
  check('B (second administrator) and C (member) are connected and live', (await live(B.p)) && (await live(C.p)));
  const apiB = apiOf(B.p), apiC = apiOf(C.p);

  // ------------------------------------------------------------ Development shows the panel, empty
  for (const [label, Y] of [['A', A], ['B', B], ['C', C]]) await Y.p.goto(base + DEV, { waitUntil: 'domcontentloaded' });
  check('A, B and C: Development has the "Playbooks and skills" panel (help ? present), empty playbook for Coder-01',
    await until(async () => { for (const Y of [A, B, C]) if ((await panel(Y.p).count()) !== 1 || (await panel(Y.p).getAttribute('data-dev-playbooks')) !== 'ready' || (await Y.p.getByText('No playbook for Coder-01 yet').count()) !== 1) return false; return true; }, 15000)
      && (await panel(A.p).locator('[data-help-key="playbook.panel"]').count()) >= 1);
  check('C (member) sees the "Propose only" chip', await until(async () => (await panel(C.p).getByText('Propose only').count()) >= 1, 6000));

  // ------------------------------------------------------------ B proposes through the dialog
  await B.p.getByRole('button', { name: 'Propose a lesson', exact: true }).click();
  const dlg = B.p.locator('[role="dialog"]').first();
  await dlg.locator('#lc-text').waitFor({ timeout: 8000 });
  check('the dialog is DL-92 and Submit stays off until a lesson and a source are given', (await dlg.getAttribute('data-dialog')) === 'DL-92' && (await dlg.getByRole('button', { name: 'Submit lesson' }).isDisabled()));
  await dlg.locator('#lc-text').fill(T1);
  check('still off with no source id', await dlg.getByRole('button', { name: 'Submit lesson' }).isDisabled());
  await dlg.getByLabel('Source 1 id', { exact: true }).fill('REV-C41');
  check('every dialog control has a ? (lesson, sources, review by)', (await Promise.all(['playbook.propose', 'playbook.sources', 'playbook.reviewBy'].map((kk) => dlg.locator(`[data-help-key="${kk}"]`).count()))).every((n) => n >= 1));
  await B.p.screenshot({ path: `${SHOTS}/c41-dialog-propose.png` });
  await dlg.getByRole('button', { name: 'Submit lesson' }).click();
  check('the dialog closes after Submit lesson', await until(async () => (await dlg.count()) === 0, 8000));
  const lessons = async () => ((await apiA('GET', `/lessons?agentId=${X}`)).body.lessons ?? []);
  const l1 = (await lessons()).find((l) => l.text === T1);
  check('the server stored it as proposed by Bea with its source and a sha256', l1?.status === 'proposed' && l1.proposedByName === 'Bea' && l1.sources[0].id === 'REV-C41' && /^[0-9a-f]{64}$/.test(l1.sha256));

  // ------------------------------------------------------------ the proposer cannot decide; the other administrator can
  await view(B.p, /Candidates/);
  const candB = B.p.locator(`[data-lesson="${l1.id}"]`);
  check('B (the proposer) sees the candidate with Accept and Reject disabled, the reason and a ?',
    await until(async () => (await candB.count()) === 1, 8000)
      && (await candB.getByRole('button', { name: /^Accept lesson/ }).isDisabled()) && (await candB.getByRole('button', { name: /^Reject lesson/ }).isDisabled())
      && (await candB.locator('[data-cannot-decide]').innerText()).includes('Another administrator') && (await candB.locator('[data-help-key="playbook.decider"]').count()) === 1);
  const self = await apiB('POST', `/lessons/${l1.id}/decision`, { decision: 'accept', baseVersion: 0 });
  check('the server refuses B deciding its own lesson: 403 SELF_APPROVAL', self.status === 403 && self.body.code === 'SELF_APPROVAL');
  await view(A.p, /Candidates/);
  const candA = A.p.locator(`[data-lesson="${l1.id}"]`);
  check('A (no reload) sees the candidate with Accept enabled', await until(async () => (await candA.count()) === 1 && !(await candA.getByRole('button', { name: /^Accept lesson/ }).isDisabled()), 10000));
  await view(C.p, /Candidates/);
  check('C (member) does not see B\'s proposed lesson (not hers, not accepted)', await until(async () => (await C.p.getByText('No candidate lessons for Coder-01').count()) === 1, 8000) && (await C.p.locator(`[data-lesson="${l1.id}"]`).count()) === 0);
  await candA.getByRole('button', { name: /^Accept lesson/ }).click();
  const ad = A.p.locator('[role="dialog"]').first();
  await ad.getByRole('button', { name: 'Accept lesson' }).waitFor({ timeout: 8000 });
  check('the decide dialog is DL-93, names the lesson and has a ? for accepting', (await ad.getAttribute('data-dialog')) === 'DL-93' && (await ad.locator('[data-decide-lesson]').innerText()).includes(T1) && (await ad.locator('[data-help-key="playbook.accept"]').count()) >= 1);
  await ad.getByRole('button', { name: 'Accept lesson' }).click();
  check('the dialog closes', await until(async () => (await ad.count()) === 0, 8000));
  const pbOf = async () => (await apiA('GET', `/agents/${X}/playbook`)).body;
  const v1 = await pbOf();
  check('the server created playbook version 1 holding the lesson as a reviewed item with its source', v1.playbook.version === 1 && v1.playbook.items.length === 1 && v1.playbook.items[0].text === T1 && v1.playbook.items[0].trust === 'reviewed' && v1.playbook.items[0].sources[0].id === 'REV-C41' && v1.playbook.items[0].addedInVersion === 1);

  // ------------------------------------------------------------ everyone sees v1 live
  await view(A.p, /^Playbook/);
  check('A: the Playbook tab reads "v1" and lists the item with its chips (reviewed, added in v1, source)',
    await until(async () => (await A.p.getByRole('radio', { name: /Playbook v1/ }).count()) === 1 && (await A.p.locator('[data-playbook-item]').count()) === 1, 10000)
      && (await A.p.locator('[data-playbook-item]').innerText()).includes('reviewed') && (await A.p.locator('[data-playbook-item]').innerText()).includes('REV-C41'));
  await view(B.p, /^Playbook/);
  await view(C.p, /^Playbook/);
  check('B and C (no reload) show the same one item at v1', await until(async () => (await B.p.locator('[data-playbook-item]').count()) === 1 && (await C.p.locator('[data-playbook-item]').count()) === 1 && (await C.p.getByRole('radio', { name: /Playbook v1/ }).count()) === 1, 10000));

  // ------------------------------------------------------------ second lesson, v2, history and diff
  const p2 = await apiB('POST', `/agents/${X}/lessons`, { text: T2, sources: [{ kind: 'failure_tag', id: 'ci-lint-red' }], reviewBy: '2999-01-01' }, key());
  check('B proposes a second lesson (with a review-by date)', p2.status === 201);
  await view(A.p, /Candidates/);
  const cand2 = A.p.locator(`[data-lesson="${p2.body.lesson.id}"]`);
  await cand2.waitFor({ timeout: 10000 });
  await cand2.getByRole('button', { name: /^Accept lesson/ }).click();
  await A.p.locator('[role="dialog"]').getByRole('button', { name: 'Accept lesson' }).click();
  check('A accepts it: the server is at version 2 with both items in order', await until(async () => { const x = await pbOf(); return x.playbook.version === 2 && x.playbook.items.map((i) => i.text).join('|') === `${T1}|${T2}`; }, 8000));
  await view(A.p, /History/);
  check('A: History lists v2 (current) and v1, newest first, each with Diff and Roll back',
    await until(async () => (await A.p.locator('[data-playbook-version]').count()) === 2, 8000)
      && (await A.p.locator('[data-playbook-version]').first().getAttribute('data-playbook-version')) === '2'
      && (await A.p.locator('[data-playbook-version="2"]').innerText()).includes('current')
      && (await A.p.getByRole('button', { name: 'Roll back to version 2' }).isDisabled()) && !(await A.p.getByRole('button', { name: 'Roll back to version 1' }).isDisabled()));
  await A.p.getByRole('button', { name: 'Show diff of version 2' }).click();
  check('the diff of v2 shows the added item', await until(async () => (await A.p.locator('[data-playbook-version="2"] [data-diff="add"]').count()) === 1 && (await A.p.locator('[data-playbook-version="2"] [data-diff="add"]').innerText()).includes(T2), 8000));
  const diff = (await apiA('GET', `/agents/${X}/playbook/diff?from=1&to=2`)).body.diff;
  check('the API agrees: one added, none removed, one kept', diff.added.length === 1 && diff.removed.length === 0 && diff.kept === 1);
  await A.p.screenshot({ path: `${SHOTS}/c41-history-diff.png` });

  // ------------------------------------------------------------ rollback through the dialog
  await A.p.getByRole('button', { name: 'Roll back to version 1' }).click();
  const rd = A.p.locator('[role="dialog"]').first();
  await rd.locator('#pr-why').waitFor({ timeout: 8000 });
  check('the rollback dialog is DL-94, shows what goes away and keeps Roll back off until a reason is given',
    (await rd.getAttribute('data-dialog')) === 'DL-94' && await until(async () => (await rd.locator('[data-rollback-diff] .rm').count()) === 1, 8000) && (await rd.getByRole('button', { name: 'Roll back', exact: true }).isDisabled()));
  await rd.locator('#pr-why').fill('The linter rule is too slow here.');
  await rd.getByRole('button', { name: 'Roll back', exact: true }).click();
  check('the dialog closes', await until(async () => (await rd.count()) === 0, 8000));
  const v3 = await pbOf();
  check('the server created version 3 (not an edit): same items as v1, kind rollback, 3 versions kept', v3.playbook.version === 3 && v3.playbook.kind === 'rollback' && v3.playbook.rollbackTo === 1 && v3.playbook.items.length === 1 && v3.playbook.items[0].text === T1 && v3.versions.length === 3);
  check('A: History now lists v3 "rollback to v1" as current, above v2 and v1',
    await until(async () => (await A.p.locator('[data-playbook-version]').count()) === 3 && (await A.p.locator('[data-playbook-version]').first().getAttribute('data-playbook-version')) === '3'
      && (await A.p.locator('[data-playbook-version="3"]').innerText()).includes('rollback to v1') && (await A.p.locator('[data-playbook-version="3"]').innerText()).includes('current'), 10000));
  await view(A.p, /^Playbook/);
  check('A: the Playbook tab reads v3 with one item again', await until(async () => (await A.p.getByRole('radio', { name: /Playbook v3/ }).count()) === 1 && (await A.p.locator('[data-playbook-item]').count()) === 1, 8000));
  check('B and C (no reload) also show v3 with one item', await until(async () => (await B.p.getByRole('radio', { name: /Playbook v3/ }).count()) === 1 && (await C.p.getByRole('radio', { name: /Playbook v3/ }).count()) === 1 && (await C.p.locator('[data-playbook-item]').count()) === 1, 10000));
  check('C (member): no rollback buttons are enabled (read only)', await (async () => { await view(C.p, /History/); await C.p.locator('[data-playbook-version]').first().waitFor({ timeout: 8000 }); const bs = C.p.getByRole('button', { name: /^Roll back to version/ }); const n = await bs.count(); for (let i = 0; i < n; i++) if (!(await bs.nth(i).isDisabled())) return false; return n === 3; })());
  const stale = await apiA('POST', `/agents/${X}/playbook/rollback`, { toVersion: 1, baseVersion: 2, why: 'stale' });
  check('a rollback from an old view is 409 (compare-and-set)', stale.status === 409);

  // ------------------------------------------------------------ contradiction flag and override note
  const p3 = await apiB('POST', `/agents/${X}/lessons`, { text: T2, sources: [{ kind: 'note', id: 'again' }] }, key());
  const p4 = await apiB('POST', `/agents/${X}/lessons`, { text: T3, sources: [{ kind: 'note', id: 'opposite' }] }, key());
  check('B proposes the lesson again and its opposite', p3.status === 201 && p4.status === 201);
  const acc3 = await apiA('POST', `/lessons/${p3.body.lesson.id}/decision`, { decision: 'accept', baseVersion: 3 });
  check('A accepts the first (v4, no conflict)', acc3.status === 200 && acc3.body.playbook.version === 4);
  await view(A.p, /Candidates/);
  const cand4 = A.p.locator(`[data-lesson="${p4.body.lesson.id}"]`);
  check('A sees the opposite lesson flagged "contradicts an item"', await until(async () => (await cand4.count()) === 1 && (await cand4.getAttribute('data-conflicts')) === '1' && (await cand4.innerText()).includes('contradicts an item'), 10000));
  await cand4.getByRole('button', { name: /^Accept lesson/ }).click();
  const cd = A.p.locator('[role="dialog"]').first();
  await cd.locator('#ld-override').waitFor({ timeout: 8000 });
  check('the dialog shows the contradiction banner and Accept stays off until an override note is written', (await cd.locator('[data-contradiction-banner]').count()) === 1 && (await cd.getByRole('button', { name: 'Accept lesson' }).isDisabled()));
  await A.p.screenshot({ path: `${SHOTS}/c41-dialog-override.png` });
  await cd.locator('#ld-override').fill('Lint is slow on the monorepo; CI lints instead.');
  await cd.getByRole('button', { name: 'Accept lesson' }).click();
  check('the server stored it as v5 with contradiction true and the override note', await until(async () => { const x = await pbOf(); const it = x.playbook.items.find((i) => i.text === T3); return x.playbook.version === 5 && it?.contradiction === true && it.overrideNote.includes('monorepo') && it.contradicts.length === 1; }, 8000));
  await view(A.p, /^Playbook/);
  check('A: the playbook shows the item with "contradiction" and the override note', await until(async () => (await A.p.locator('[data-playbook-item][data-contradiction="1"]').count()) === 1 && (await A.p.locator('[data-override-note]').count()) === 1, 8000));
  await A.p.screenshot({ path: `${SHOTS}/c41-playbook.png` });

  // ------------------------------------------------------------ skills
  const sk = await apiB('POST', '/skills', { name: 'Triage a failing check', description: 'Find the cause of a red check.', steps: ['Open the report', 'Name the failing selector', 'Attach the screenshot'], preconditions: ['A report exists'], sources: [{ kind: 'review', id: 'REV-SK' }] }, key());
  const codey = await apiB('POST', '/skills', { name: 'Bad', description: 'x', steps: ['function run() {}'], sources: [{ kind: 'note', id: 'n' }] }, key());
  check('B proposes a skill (draft); code-like steps are 400', sk.status === 201 && sk.body.skill.status === 'draft' && codey.status === 400);
  await view(A.p, /Skills/);
  const skA = A.p.locator(`[data-skill="${sk.body.skill.id}"]`);
  check('A (no reload) sees the draft with Approve enabled; steps are listed', await until(async () => (await skA.count()) === 1 && !(await skA.getByRole('button', { name: /^Approve skill/ }).isDisabled()) && (await skA.innerText()).includes('Name the failing selector'), 10000));
  await view(B.p, /Skills/);
  const skB = B.p.locator(`[data-skill="${sk.body.skill.id}"]`);
  check('B (the proposer) sees Approve disabled with the reason', await until(async () => (await skB.count()) === 1 && (await skB.getByRole('button', { name: /^Approve skill/ }).isDisabled()) && (await skB.innerText()).includes('Another administrator'), 10000));
  await skA.getByRole('button', { name: /^Approve skill/ }).click();
  check('A approves: the card says Approved by Luca', await until(async () => (await skA.getAttribute('data-status')) === 'approved' && (await skA.innerText()).includes('approved by Luca'), 8000));
  await A.p.screenshot({ path: `${SHOTS}/c41-skills.png` });
  await C.p.goto(base + DEV, { waitUntil: 'domcontentloaded' });
  await C.p.locator('[data-dev-playbooks="ready"]').waitFor({ timeout: 15000 });
  await view(C.p, /Skills/);
  check('C (member) sees the approved skill without Approve or Retire buttons', await until(async () => (await C.p.locator(`[data-skill="${sk.body.skill.id}"]`).count()) === 1 && (await C.p.getByRole('button', { name: /^(Approve|Retire) skill/ }).count()) === 0, 8000));

  if (DOC_SHOT) {
    mkdirSync(DOC_SHOT.replace(/\/[^/]*$/, ''), { recursive: true });
    await view(A.p, /^Playbook/);
    await A.p.screenshot({ path: `${DOC_SHOT}-playbook-dark.png` });
    await view(A.p, /History/);
    await A.p.screenshot({ path: `${DOC_SHOT}-history-dark.png` });
  }
  check('no page errors or console errors in any browser', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) {
  check('the run did not throw', false, String(e).slice(0, 400));
  for (const [n, Y] of [['A', A], ['B', B], ['C', C]]) if (Y) await Y.p.screenshot({ path: `${SHOTS}/c41-fail-${n}.png` }).catch(() => {});
}
await b.close();
const failed = results.filter((r) => r.startsWith('FAIL')).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
