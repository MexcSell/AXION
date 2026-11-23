import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
import { makeTestApp, makeSchema, withAdmin, type TestApp } from './helpers.ts';
import { seedScale } from './c71-scale-fixtures.ts';

// c78 (H21): c71-equivalence failed now and then in beforeAll, inside seedScale, with `relation with OID <n> does not exist`.
// Cause: the seed ended with a bare `analyze`, which is database-wide. In the shared axion_test DB it walks the tables of EVERY test
// file's schema, so a concurrent `drop schema ... cascade` from another file removes a table between the lookup and the analyze.
// This test reproduces that deterministically: another connection creates and drops schemas with tables in a tight loop while the seed runs.
let t: TestApp, adminId = '', memberId = '';
beforeAll(async () => {
  t = await makeTestApp({ staffingStepMs: 3_600_000, conversationSimMs: 3_600_000, demoSeed: false });
  const w = await withAdmin(t.app);
  const bea = await w.member('Bea');
  adminId = w.adminId; memberId = bea.id;
});
afterAll(async () => { await t?.close(); });

describe('seedScale next to other schemas being created and dropped', () => {
  it('seeds 12 times while a second connection churns schemas in the same database, with no catalog error', async () => {
    // two churners, each migrating a real schema (as every other test file does) and dropping it again
    let stop = false, rounds = 0;
    const loops = [0, 1].map(async () => {
      while (!stop) { const x = await makeSchema(); await x.drop(); rounds++; }
    });
    const failures: string[] = [];
    try {
      for (let i = 0; i < 12; i++) {
        try { await seedScale(t.pool, { tasks: 200, adminId, memberId, prefix: 'RC' + i, perMission: 4 }); }
        catch (e) { failures.push(`seed ${i}: ${(e as Error).message}`); }
      }
    } finally { stop = true; await Promise.all(loops); }
    expect(rounds, 'the churn loop must really have run').toBeGreaterThan(2);
    expect(failures).toEqual([]);
  });
});
