import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeTestApp, withAdmin, Browser, type TestApp } from './helpers.ts';
import { METRICS, writabilityOf } from '../../shared/contracts/src/index.ts';

/**
 * Improvement cycle 66, item 3: GET /api/v1/company/metric-guard. The "gameable" flag is display only and derived from the
 * writability inventory; the promotion-input rule waits for R3-3 (owner Q13), so it is recorded as a note and nothing else.
 */
let t: TestApp;
let A: Browser, M: Browser;
beforeAll(async () => { t = await makeTestApp({ staffingStepMs: 3_600_000, conversationSimMs: 3_600_000 }); const w = await withAdmin(t.app); A = w.admin; M = (await w.member('Mina')).b; });
afterAll(async () => { await t?.close(); });

describe('GET /company/metric-guard', () => {
  it('needs a signed-in user; a member and an administrator read the same rows', async () => {
    expect((await new Browser(t.app).req('GET', '/company/metric-guard')).status).toBe(401);
    const a = await A.req('GET', '/company/metric-guard'), m = await M.req('GET', '/company/metric-guard');
    expect(a.status, JSON.stringify(a.body)).toBe(200);
    expect(m.status).toBe(200);
    expect(m.body.rows).toEqual(a.body.rows);
  });

  it('has one row per registered metric, and every row declares a counter-metric (or a reasoned none), uncovered dimensions and a derived flag', async () => {
    const r = (await A.req('GET', '/company/metric-guard')).body;
    expect(r.rows.map((x: any) => x.id)).toEqual(METRICS.map((m) => m.id));
    for (const row of r.rows) {
      expect(row.counter.kind === 'metric' ? row.counter.why.length : row.counter.reason.length, row.id).toBeGreaterThan(24);
      expect(row.uncovered.length, row.id).toBeGreaterThan(0);
      const meta = METRICS.find((m) => m.id === row.id)!;
      expect(row.gameable, row.id).toBe(writabilityOf(meta.inputs).agentWritable);
      expect(row.gameableText.length, row.id).toBeGreaterThan(20);
    }
    expect(r.rows.some((x: any) => x.gameable)).toBe(true);
    expect(r.rows.some((x: any) => !x.gameable)).toBe(true);
  });

  it('says in plain words which function lets an agent write, and records the promotion rule only as a note', async () => {
    const r = (await A.req('GET', '/company/metric-guard')).body;
    const tv = r.rows.find((x: any) => x.id === 'scorecard.tasks_verified_by_review');
    expect(tv.gameable).toBe(true);
    expect(tv.gameableText).toContain('recordReview');
    expect(tv.gameableText).toContain('Display only');
    const fin = r.rows.find((x: any) => x.id === 'scorecard.finished');
    expect(fin.gameable).toBe(false);
    expect(fin.gameableText).toContain('No agent identity can write');
    expect(r.promotionNote).toMatch(/R3-3/);
    expect(r.promotionNote).toMatch(/Q13/);
  });

  it('writes nothing: no event, no audit row, no table changes', async () => {
    const count = async () => Number((await t.pool.query(`select (select count(*) from events) + (select count(*) from audit_events) as n`)).rows[0].n);
    const before = await count();
    await A.req('GET', '/company/metric-guard');
    expect(await count()).toBe(before);
  });
});
