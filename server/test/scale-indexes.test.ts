import { describe, it, expect } from 'vitest';
import { makeSchema } from './helpers.ts';
import { migrate } from '../src/migrate.ts';

const NAMES = ['events_tenant_type_subject', 'audit_events_tenant_action_subject', 'tasks_mission', 'tasks_owner_instance', 'mission_runs_mission'];

describe('migration 0017 scale indexes', () => {
  it('goes down/up/down/up on a populated schema; rows survive, indexes appear and disappear', async () => {
    const s = await makeSchema();
    try {
      const idx = async () => (await s.pool.query(`select indexname from pg_indexes where schemaname = current_schema() and indexname = any($1)`, [NAMES])).rows.map((r) => r.indexname as string).sort();
      expect(await idx()).toEqual([...NAMES].sort());
      await s.pool.query(`insert into events (tenant_id, type, subject_kind, subject_id) select 't-1', 'task.stateChanged', 'task', 'x' || g from generate_series(1, 200) g`);
      await s.pool.query(`insert into audit_events (tenant_id, actor, action, subject, result, correlation_id) select 't-1', 'a', 'task.reassign', 'x' || g, 'ok', 'c' from generate_series(1, 200) g`);
      expect(await migrate(s.pool, 'down', 16)).toBeLessThan(17);
      expect(await idx()).toEqual([]);
      expect(await migrate(s.pool, 'up')).toBeGreaterThanOrEqual(17);
      expect(await idx()).toEqual([...NAMES].sort());
      expect(await migrate(s.pool, 'down', 16)).toBeLessThan(17);
      expect(await migrate(s.pool, 'up')).toBeGreaterThanOrEqual(17);
      expect(Number((await s.pool.query(`select count(*) from events`)).rows[0].count)).toBe(200);
      expect(Number((await s.pool.query(`select count(*) from audit_events`)).rows[0].count)).toBe(200);
    } finally { await s.drop(); }
  });
});
