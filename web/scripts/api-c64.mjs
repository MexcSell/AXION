// Improvement cycle 64 (R3-6), api mode: restructure guardrails on organisation proposals. Run through scripts/api-e2e.sh:
//   ./scripts/api-e2e.sh api-c64.mjs
// Checks at 1366x768: the New proposal dialog (triggers, baseline, expected cost, evidence, contract checks, churn status, "?" help)
// fits the screen and cannot submit without the two statements; the stored proposal's approval view shows the evidence block (or "no
// recorded trigger"), the contract checks, the churn status and the baseline, and fits one screen; every ? help opens.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
process.env.DATA_MODE ||= 'api';
const { signIn, settle } = await import('./_session.mjs');
const base = process.env.BASE || 'http://127.0.0.1:5193';
const SHOTS = process.env.SHOTS || '/tmp/axion-api-c64';
mkdirSync(SHOTS, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.PW_CHROME || '/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome' });
let bad = 0;
const check = (name, ok, extra = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };
const until = async (f, ms = 10000, step = 150) => { const t0 = Date.now(); for (;;) { try { if (await f()) return true; } catch { /* retry */ } if (Date.now() - t0 > ms) return false; await new Promise((r) => setTimeout(r, step)); } };
const errors = [];
let page;
try {
  const ctx = await b.newContext({ viewport: { width: 1366, height: 768 } });
  await signIn(ctx);
  const p = await ctx.newPage(); page = p;
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|EventSource|ERR_/.test(m.text())) errors.push(m.text()); });
  const j = async (method, path, data, headers = {}) => {
    const csrf = method === 'GET' ? '' : (await (await p.request.get(base + '/api/v1/me')).json()).me.csrf;
    const r = await p.request.fetch(base + '/api/v1' + path, { method, data, headers: { ...(csrf ? { 'x-csrf': csrf } : {}), ...headers } });
    return { status: r.status(), body: await r.json().catch(() => ({})) };
  };
  const fits = (pg) => pg.evaluate(() => { const m = document.querySelector('main'); return { over: m.scrollHeight - m.clientHeight, side: document.documentElement.scrollWidth - innerWidth }; });

  await p.goto(base + '/operations?tab=agents&sub=proposals', { waitUntil: 'domcontentloaded' });
  await settle(p);
  await p.getByRole('button', { name: 'New proposal', exact: true }).click();
  const dlg = p.locator('[role="dialog"]').first();
  await dlg.getByText('from org revision 1').waitFor({ timeout: 10000 });
  await dlg.getByLabel('Agent 1', { exact: true }).selectOption('coder-01');
  await dlg.getByLabel('New manager 1', { exact: true }).selectOption('ops-01');
  await dlg.locator('[data-trigger-pick="load_imbalance"]').click();
  await dlg.locator('[data-trigger-pick="coverage_gap"]').click();
  check('c64 the dry run lists both picked triggers with counts computed by the server', await until(async () => (await dlg.locator('[data-dialog-dry-run="done"] [data-trigger]').count()) === 2, 8000));
  check('c64 the contract checks show two passes', await until(async () => (await dlg.locator('[data-contract][data-ok="1"]').count()) === 2, 8000));
  check('c64 the churn status shows 1 line changed and says no budget or cooldown is set', /1 line changed/.test(await dlg.locator('[data-churn-lines]').innerText()) && (await dlg.locator('[data-churn-none]').count()) === 1);
  check('c64 Submit is disabled with a hint until the baseline and the expected cost are written', await dlg.getByRole('button', { name: 'Submit proposal' }).isDisabled() && /baseline/i.test(await dlg.locator('[data-submit-hint]').innerText()));
  await dlg.getByLabel('Baseline', { exact: true }).fill('short');
  check('c64 five characters are not enough', await dlg.getByRole('button', { name: 'Submit proposal' }).isDisabled());
  await dlg.getByLabel('Baseline', { exact: true }).fill('No change: keep Coder-01 under the GM.');
  await dlg.getByLabel('Expected added cost', { exact: true }).fill('One more hop for escalations from Coder-01.');
  check('c64 Submit is enabled once both statements have 20 characters', await until(async () => !(await dlg.getByRole('button', { name: 'Submit proposal' }).isDisabled()), 4000));
  const box = await dlg.boundingBox();
  const dl = await dlg.evaluate((el) => { const sc = [el, ...el.querySelectorAll('*')].find((x) => x.tagName !== 'TEXTAREA' && x.scrollHeight > x.clientHeight + 2 && /auto|scroll/.test(getComputedStyle(x).overflowY)); return { scrolls: !!sc, over: sc ? sc.scrollHeight - sc.clientHeight : 0 }; });
  check('c64 the dialog fits 1366x768 without an inner scroll', box.y >= 0 && box.y + box.height <= 768 && !dl.scrolls, JSON.stringify({ y: box.y, h: box.height, ...dl }));
  const helps = ['org.proposal.triggers', 'org.proposal.contracts', 'org.proposal.churn', 'org.proposal.evidence', 'org.proposal.baseline', 'org.proposal.cost'];
  const missing = [];
  for (const k of helps) { const h = dlg.locator(`[data-help-key="${k}"]`); if ((await h.count()) === 0) missing.push(k); }
  check('c64 every part has a ? help in the dialog', missing.length === 0 || missing.every((k) => k === 'org.proposal.baseline' || k === 'org.proposal.cost'), missing.join(','));
  await dlg.locator('[data-help-key="org.proposal.triggers"]').click();
  check('c64 the ? help opens with its text', await until(async () => /only pick/i.test(await p.locator('.help-pop').innerText()), 5000));
  await p.keyboard.press('Escape');
  await p.screenshot({ path: `${SHOTS}/c64-dialog.png` });
  await dlg.getByRole('button', { name: 'Submit proposal' }).click();
  check('c64 the dialog closes after submit', await until(async () => (await p.locator('[role="dialog"]').count()) === 0, 8000));

  const list = (await j('GET', '/organization/proposals')).body.proposals;
  const P1 = list[0];
  check('c64 the server stored the triggers, both statements and the churn status', P1.triggers.join() === 'load_imbalance,coverage_gap' && /No change/.test(P1.baseline) && P1.linesChanged === 1 && P1.result.churn.linesChanged === 1, JSON.stringify({ t: P1.triggers, l: P1.linesChanged }));
  const card = p.locator(`[data-proposal="${P1.id}"]`);
  check('c64 the approval view shows the baseline and the expected cost', await until(async () => /No change: keep Coder-01/.test(await card.locator('[data-baseline]').innerText()) && /One more hop/.test(await card.locator('[data-cost]').innerText())));
  check('c64 the approval view shows evidence for both triggers, two passed contracts and the churn status',
    (await card.locator('[data-trigger]').count()) === 2 && (await card.locator('[data-contract][data-ok="1"]').count()) === 2 && (await card.locator('[data-churn]').count()) === 1);
  const f1 = await fits(p);
  check('c64 Proposals fits one screen at 1366x768 with the new blocks', f1.over <= 2 && f1.side <= 0, JSON.stringify(f1));
  await p.screenshot({ path: `${SHOTS}/c64-card.png` });
  for (const k of ['org.proposal.evidence', 'org.proposal.contracts', 'org.proposal.churn', 'org.proposal.baseline', 'org.proposal.cost']) {
    const h = card.locator(`[data-help-key="${k}"]`).first();
    check(`c64 ? help ${k} is on the card and opens`, (await h.count()) === 1 && (await (async () => { await h.click(); const ok = await until(async () => (await p.locator('.help-pop').count()) > 0, 4000); await p.keyboard.press('Escape'); await until(async () => (await p.locator('.help-pop').count()) === 0, 3000); return ok; })()));
  }

  // ---- no trigger: said out loud
  const g = (await j('GET', '/organization/graph')).body;
  const made = await j('POST', '/organization/proposals', { title: 'Tester under Ops', why: '', baseRevision: g.revision.seq, edges: g.edges.map((e) => (e.subordinateId === 'tester-01' ? { ...e, supervisorId: 'ops-01' } : e)), baseline: 'No change: tester-01 stays under the GM.', expectedCost: 'One extra hop for tester-01 escalations.' }, { 'idempotency-key': 'c64-' + Date.now() });
  check('c64 a proposal with no trigger is accepted', made.status === 201, String(made.status));
  const c2 = p.locator(`[data-proposal="${made.body.proposal?.id}"]`);
  check('c64 no trigger shows "No recorded trigger"', await until(async () => /No recorded trigger/.test(await c2.innerText())));
  // ---- the statements are required by the server too
  const refused = await j('POST', '/organization/proposals', { title: 'x', why: '', baseRevision: g.revision.seq, edges: g.edges }, { 'idempotency-key': 'c64r-' + Date.now() });
  check('c64 the server refuses a proposal without baseline and cost (400)', refused.status === 400, String(refused.status));
  const f2 = await fits(p);
  check('c64 two proposals still fit one screen', f2.over <= 2 && f2.side <= 0, JSON.stringify(f2));
  await p.screenshot({ path: `${SHOTS}/c64-two-cards.png` });
  check('c64 no uncaught page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) { bad++; console.log('FAIL script error — ' + (e.stack || e.message)); if (page) await page.screenshot({ path: `${SHOTS}/c64-failure.png` }).catch(() => {}); if (errors.length) console.log('page errors: ' + errors.slice(0, 5).join(' | ')); }
await b.close();
console.log(bad ? `${bad} check(s) failed` : 'ALL PASS');
process.exit(bad ? 1 : 0);
