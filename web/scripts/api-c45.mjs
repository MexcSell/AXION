// Improvement cycle 45 (J1), api mode: the read-only job-records view on System Operations > Queues.
// Fixture job rows are written straight into the lane's e2e database (there is no client route that enqueues: that is the point).
// Admin sees counts, "records only" text, a ? help and an empty state first; a member gets 403 from the API and no panel.
// Fits one screen at 1366x768. Run: ./scripts/api-e2e.sh api-c45.mjs  (committed shot only on request: DOC_SHOT_C45=docs/screenshots/improve-c45-job-records-dark.png)
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
process.env.DATA_MODE = 'api'; // _session.mjs reads it once, at import time, so import it after this line
const { signIn, settle, requireE2eDatabase } = await import('./_session.mjs');
const base = process.env.BASE || 'http://127.0.0.1:5193';
const URL_Q = '/operations?tab=queues';
const results = [];
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };
const until = async (f, ms = 10000, step = 150) => { const t0 = Date.now(); for (;;) { try { if (await f()) return true; } catch { /* retry */ } if (Date.now() - t0 > ms) return false; await new Promise((r) => setTimeout(r, step)); } };
const b = await chromium.launch({ executablePath: process.env.PW_CHROME || '/root/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome' });
const errors = [];
let adminReq;
const open = async (name, w = 1366, h = 768) => {
  const ctx = await b.newContext({ viewport: { width: w, height: h } });
  if (name === 'Luca') await signIn(ctx, name);
  else {
    const dev = { name: 'Chrome on Linux (c45 member)', kind: 'desktop', browser: 'Chrome' };
    const c = await ctx.request.post(base + '/api/v1/auth/connect', { data: { name, password: 'c45-pass-1', device: dev } });
    if (c.status() === 202) {
      const csrf = (await (await adminReq.get(base + '/api/v1/me')).json()).me.csrf;
      const u = ((await (await adminReq.get(base + '/api/v1/users')).json()).users ?? []).find((x) => x.name === name);
      await adminReq.post(base + `/api/v1/users/${u.id}/approve`, { headers: { 'x-csrf': csrf }, data: {} });
      if ((await ctx.request.get(base + '/api/v1/auth/wait')).status() !== 200) throw new Error('approval failed');
    } else if (c.status() !== 200) throw new Error('member sign-in failed ' + c.status());
  }
  await ctx.addInitScript(() => { try { localStorage.setItem('axion.data-mode', 'api'); localStorage.setItem('axion.testhook', '1'); localStorage.setItem('axion.settings.v1', JSON.stringify({ state: { themeMode: 'dark', skin: 'luminous', motion: 'reduced' }, version: 0 })); } catch { /* ignore */ } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  return { ctx, p };
};
const pg = createRequire(new URL('../../server/package.json', import.meta.url))('pg');
const db = new pg.Client({ connectionString: requireE2eDatabase() });
await db.connect();
try {
  const A = await open('Luca');
  adminReq = A.p.request;
  await A.p.goto(base + URL_Q, { waitUntil: 'domcontentloaded' }); await settle(A.p);
  const panel = A.p.locator('.ops-job-records');
  check('admin: the Job records panel is shown on Queues', await until(async () => (await panel.count()) === 1));
  check('admin: empty state before any job exists, says records only', await until(async () => (await A.p.getByTestId('job-records-empty').count()) === 1) && /no workers run in this build/i.test(await panel.innerText()));
  await panel.locator('[data-help-key="ops.jobRecords"]').click();
  check('admin: the ? opens the help for job records (records only, no workers)', await until(async () => /no workers run in this build/i.test(await A.p.locator('.help-pop').innerText())));
  await A.p.keyboard.press('Escape');
  const tn = (await db.query('select id from tenants limit 1')).rows[0].id;
  const ins = (k, extra = '') => db.query(`insert into system_jobs(tenant_id, kind, idempotency_key, created_by, created_at) values ($1,'noop.test',$2,'c45-script', now() - interval '3 minutes')`, [tn, k]);
  await ins('s1'); await ins('s2'); await ins('s3');
  await db.query(`update system_jobs set status='leased', attempt=1, lease_token=1, lease_owner='script', lease_expires_at=now() - interval '1 second', heartbeat_at=now() where idempotency_key='s3'`);
  await A.p.getByRole('button', { name: 'Refresh now' }).first().click().catch(() => {});
  const ok = await until(async () => (await A.p.getByTestId('job-records').count()) === 1 && (await A.p.getByTestId('job-expired').innerText()) === '1');
  check('admin: counts appear (2 queued, 1 leased), expired leases 1, oldest queued about 3 min', ok && /queued 2/.test(await A.p.getByTestId('job-kind-noop.test').innerText()) && /leased 1/.test(await A.p.getByTestId('job-kind-noop.test').innerText()) && /3 min/.test(await A.p.getByTestId('job-oldest').innerText()), (await panel.innerText()).replace(/\s+/g, ' ').slice(0, 200));
  check('admin: the panel says records only and there is no enqueue, claim or cancel control in it', /no workers run in this build/i.test(await panel.innerText()) && (await panel.getByRole('button', { name: /enqueue|claim|cancel|retry|run/i }).count()) === 0);
  const fit = await A.p.evaluate(() => { const m = document.querySelector('main'); return { over: m.scrollHeight - m.clientHeight, doc: document.documentElement.scrollHeight - window.innerHeight }; });
  check('admin: fits 1366x768 (main does not scroll the page)', fit.over <= 2 && fit.doc <= 2, JSON.stringify(fit));
  if (process.env.DOC_SHOT_C45) await A.p.screenshot({ path: process.env.DOC_SHOT_C45 });
  const apiAdmin = await A.p.request.get(base + '/api/v1/operations/queues');
  const body = await apiAdmin.json();
  check('admin API: /operations/queues returns the counts', apiAdmin.status() === 200 && body.total === 3 && body.kinds[0].counts.queued === 2, JSON.stringify(body).slice(0, 160));

  const M = await open('Mina');
  const r = await M.p.request.get(base + '/api/v1/operations/queues');
  check('member API: /operations/queues is 403', r.status() === 403, String(r.status()));
  await M.p.goto(base + URL_Q, { waitUntil: 'domcontentloaded' }); await settle(M.p);
  check('member: the Queues tab shows no Job records panel', (await M.p.locator('.ops-job-records').count()) === 0 && (await M.p.getByRole('heading', { name: /queues/i }).count()) > 0);
  check('no page errors', errors.length === 0, errors.join(' | ').slice(0, 200));
} finally { await db.end(); await b.close(); }
const failed = results.filter((x) => !x).length;
console.log(failed ? `${failed} check(s) FAILED` : `ALL ${results.length} PASSED`);
process.exit(failed ? 1 : 0);
