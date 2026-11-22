import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeTestApp, withAdmin, type TestApp } from './helpers.ts';
import { reviewCapacity, UTILISATION_NOTE } from '../src/capacity/model.ts';
import { decided, addAgent, type Fx } from './c65-fixtures.ts';

let t: TestApp; let f: Fx;
beforeEach(async () => {
  t = await makeTestApp({ staffingStepMs: 60_000 });
  const A = await withAdmin(t.app);
  f = { pool: t.pool, mission: (await A.admin.req('POST', '/missions', { text: 'Send it.', files: [], shared: true }, { 'idempotency-key': 'c65u' + Date.now() })).body.mission.id as string };
  await addAgent(f, 'c65-ops-1', 'Operations');
});
afterEach(async () => { await t.close(); });

describe('c65 item 3: utilisation is dropped from v1, and says so', () => {
  it('the view reports utilisation as not measured, with the reason, for an administrator and for a member, with and without data', async () => {
    for (const admin of [true, false]) {
      const empty = await reviewCapacity(t.app.db, 't-1', 30, admin);
      expect(empty.utilisation).toEqual({ value: null, reason: 'not_measured', note: UTILISATION_NOTE });
    }
    for (let i = 0; i < 25; i++) await decided(f, 'U' + i, 'c65-ops-1', 5 * 3_600_000, 60_000 * (i + 1), 'u-' + (i % 4));
    const r = await reviewCapacity(t.app.db, 't-1', 30, true);
    expect(r.utilisation.value).toBeNull(); // never a number, not even from the time-to-decision (which includes waiting, not handling)
  });
  it('the reason is written in plain words: no handling time is recorded and no hours-per-week setting exists', () => {
    expect(UTILISATION_NOTE).toMatch(/handling time/i);
    expect(UTILISATION_NOTE).toMatch(/hours per week/i);
  });
  it('no operator-setting route or table was added for it', async () => {
    const r = await t.pool.query(`select table_name from information_schema.tables where table_schema = current_schema() and table_name ~ 'review_hours|operator_setting|capacity_setting'`);
    expect(r.rows).toEqual([]);
    const routes = t.app.printRoutes({ commonPrefix: false });
    expect(routes).not.toMatch(/review-hours|review_hours|operator-setting/);
  });
});
