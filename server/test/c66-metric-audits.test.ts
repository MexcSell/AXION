import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeTestApp, withAdmin, Browser, type TestApp } from './helpers.ts';
import { seedDemo, clearDemo } from '../src/seed/demo.ts';
import { AUDIT_BAR, AUDIT_MIN_N } from '../src/company/metric-audit.ts';

/**
 * Improvement cycle 66, item 4: the audit label store and its route. Append-only (all four guards), administrators only, the
 * latest label of a sample counts, the flag needs the minimum sample, times come from the database clock, nothing else changes.
 */
let t: TestApp;
let A: Browser, M: Browser, adminId = '';
const q = (sql: string, p: unknown[] = []) => t.pool.query(sql, p);
const samples = (n: number, gamed: number, prefix = 's') => Array.from({ length: n }, (_, i) => ({ sampleRef: `${prefix}${i}`, metricLabel: true, auditLabel: i >= gamed }));
const post = (b: Browser, body: unknown) => b.req('POST', '/company/metric-audits', body);
const guard = async (id: string) => ((await A.req('GET', '/company/metric-guard')).body.rows as any[]).find((r) => r.id === id);

beforeAll(async () => { t = await makeTestApp({ staffingStepMs: 3_600_000, conversationSimMs: 3_600_000 }); const w = await withAdmin(t.app); A = w.admin; adminId = w.adminId; M = (await w.member('Mina')).b; });
afterAll(async () => { await t?.close(); });

describe('POST /company/metric-audits', () => {
  it('is for administrators: anonymous 401, a member 403 and nothing stored', async () => {
    expect((await post(new Browser(t.app), { metricId: 'scorecard.finished', samples: samples(1, 0) })).status).toBe(401);
    expect((await post(M, { metricId: 'scorecard.finished', samples: samples(1, 0) })).status).toBe(403);
    expect(Number((await q('select count(*) from metric_audit_labels')).rows[0].count)).toBe(0);
  });

  it('refuses a metric that is not a registered row, empty and duplicate samples, and unknown fields', async () => {
    expect((await post(A, { metricId: 'scorecard.nope', samples: samples(1, 0) })).status).toBe(422);
    expect((await post(A, { metricId: 'scorecard.finished', samples: [] })).status).toBe(400);
    expect((await post(A, { metricId: 'scorecard.finished', samples: [...samples(1, 0), ...samples(1, 0)] })).status).toBe(422);
    expect((await post(A, { metricId: 'scorecard.finished', samples: samples(201, 0) })).status).toBe(400);
    expect((await post(A, { metricId: 'scorecard.finished', samples: samples(1, 0), extra: 1 })).status).toBe(400);
    expect(Number((await q('select count(*) from metric_audit_labels')).rows[0].count)).toBe(0);
  });

  it('stores the labels with the auditor and the database time, audits the action, and returns the row state', async () => {
    const r = await post(A, { metricId: 'scorecard.finished', samples: samples(10, 2) });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.recorded).toBe(10);
    expect(r.body.audit).toMatchObject({ n: 10, disagreements: 2, divergence: null, state: 'none', flagged: false });
    const row = (await q('select * from metric_audit_labels order by id limit 1')).rows[0];
    expect(row.audited_by).toBe(adminId);
    expect(Math.abs(Date.now() - new Date(row.audited_at).getTime())).toBeLessThan(60_000);
    expect(Number((await q(`select count(*) from audit_events where action='metric.audit'`)).rows[0].count)).toBe(1);
  });

  it('shows "not enough audited samples" below the minimum, flags at the bar with the minimum, and the latest label of a sample wins', async () => {
    let g = await guard('scorecard.finished');
    expect(g.audit).toMatchObject({ n: 10, state: 'none', divergence: null, flagged: false, bar: AUDIT_BAR, minN: AUDIT_MIN_N });
    // 60 samples, 8 disagreeing = 13.3%: not flagged; then a correction makes 9 = 15%: flagged
    await post(A, { metricId: 'scorecard.finished', samples: samples(50, 6, 'x') });
    g = await guard('scorecard.finished');
    expect(g.audit).toMatchObject({ n: 60, disagreements: 8, state: 'ok', divergence: 13.3, flagged: false, metricOver: 8, auditOver: 0 });
    await post(A, { metricId: 'scorecard.finished', samples: [{ sampleRef: 'x7', metricLabel: true, auditLabel: false }] }); // x7 was agreeing, now disagrees
    g = await guard('scorecard.finished');
    expect(g.audit).toMatchObject({ n: 60, disagreements: 9, divergence: 15, flagged: true });
    // an old, uncorrected label is not double counted; a correction back to agreeing un-flags the row
    await post(A, { metricId: 'scorecard.finished', samples: [{ sampleRef: 'x7', metricLabel: true, auditLabel: true }] });
    expect((await guard('scorecard.finished')).audit).toMatchObject({ n: 60, disagreements: 8, flagged: false });
    expect(g.audit.lastAuditedAt).toMatch(/Z$/);
  });

  it('keeps rows apart: another row has no labels, and a member reads the same aggregates (no sample refs leave the server)', async () => {
    expect((await guard('scorecard.started')).audit).toMatchObject({ n: 0, state: 'none', divergence: null, flagged: false, lastAuditedAt: null });
    const m = ((await M.req('GET', '/company/metric-guard')).body.rows as any[]).find((r) => r.id === 'scorecard.finished');
    expect(m.audit.n).toBe(60);
    expect(JSON.stringify(m)).not.toMatch(/x\d/);
  });

  it('changes nothing else: scorecard and dimensions are identical before and after a flagged audit', async () => {
    const noClock = (_k: string, v: unknown) => (_k === 'from' || _k === 'to' ? undefined : v); // the window ends are the database clock and move
    const snap = async () => JSON.stringify([(await A.req('GET', '/company/scorecard')).body.rows, (await A.req('GET', '/company/dimensions')).body.dimensions], noClock);
    const before = await snap();
    await post(A, { metricId: 'scorecard.failure_rate', samples: samples(60, 30, 'f') });
    expect((await guard('scorecard.failure_rate')).audit.flagged).toBe(true);
    expect(await snap()).toBe(before);
  });
});

describe('the label table is append-only (all four guards)', () => {
  it('UPDATE, DELETE and TRUNCATE are refused, and a demo purge still works and leaves the labels alone', async () => {
    const before = Number((await q('select count(*) from metric_audit_labels')).rows[0].count);
    expect(before).toBeGreaterThan(0);
    await expect(q(`update metric_audit_labels set audit_label = not audit_label`)).rejects.toThrow(/append-only/);
    await expect(q(`delete from metric_audit_labels`)).rejects.toThrow(/append-only/);
    await expect(q(`truncate metric_audit_labels`)).rejects.toThrow(/append-only/);
    await seedDemo(t.app.db, t.app.cfg.tenantId, adminId);
    await clearDemo(t.app.db, t.app.cfg.tenantId);
    expect(Number((await q('select count(*) from metric_audit_labels')).rows[0].count)).toBe(before);
  });
  it('the demo-purge setting is the only way a delete passes, and it is local to that transaction', async () => {
    const c = await t.pool.connect();
    try {
      await c.query('begin');
      await c.query(`set local axion.purge_demo = 'on'`);
      await c.query(`delete from metric_audit_labels where sample_ref = 'f0'`);
      await c.query('rollback');
    } finally { c.release(); }
    await expect(q(`delete from metric_audit_labels where sample_ref = 'f0'`)).rejects.toThrow(/append-only/);
  });
});
