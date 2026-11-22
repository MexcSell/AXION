import { describe, it, expect } from 'vitest';
import { makeSchema } from './helpers.ts';
import { migrate, listMigrations } from '../src/migrate.ts';

const LATEST = Math.max(...listMigrations().map((m) => m.version));
const has = async (pool: import('pg').Pool) => (await pool.query(`select indexdef from pg_indexes where schemaname = current_schema() and indexname = 'approval_decisions_approval'`)).rows.map((r) => r.indexdef as string);

describe('migration 0053 (approval_decisions index)', () => {
  it('goes down/up/down/up on a populated schema: rows survive, the index appears and disappears, and the down file can run twice', async () => {
    const s = await makeSchema();
    try {
      expect(LATEST).toBeGreaterThanOrEqual(53);
      expect((await has(s.pool))[0]).toMatch(/\(approval_id, decided_at\)/);
      const before = (await s.pool.query(`select count(*)::int n from approval_decisions`)).rows[0].n;
      expect(await migrate(s.pool, 'down', 52)).toBe(52);
      expect(await has(s.pool)).toEqual([]);
      expect(await migrate(s.pool, 'up')).toBe(LATEST);
      expect((await has(s.pool)).length).toBe(1);
      expect(await migrate(s.pool, 'down', 52)).toBe(52);
      await s.pool.query(listMigrations().find((m) => m.version === 53)!.down); // re-runnable
      expect(await migrate(s.pool, 'up')).toBe(LATEST);
      expect((await has(s.pool)).length).toBe(1);
      expect((await s.pool.query(`select count(*)::int n from approval_decisions`)).rows[0].n).toBe(before);
    } finally { await s.drop(); }
  });
});
