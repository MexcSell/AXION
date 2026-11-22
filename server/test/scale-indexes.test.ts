import { describe, it, expect } from 'vitest';
import { audit } from '../src/audit.ts';
import { makeSchema } from './helpers.ts';
import { migrate, listMigrations } from '../src/migrate.ts';
import { assertOwnLaneDb, laneDbOf } from '../scripts/scale-guard.ts';

const LATEST = Math.max(...listMigrations().map((m) => m.version));

const NAMES = ['events_tenant_type_subject', 'audit_events_tenant_action_subject', 'tasks_mission', 'tasks_owner_instance', 'mission_runs_mission'];

describe('migration 0017 scale indexes', () => {
  it('goes down/up/down/up on a populated schema; rows survive, indexes appear and disappear', async () => {
    const s = await makeSchema();
    try {
      const idx = async () => (await s.pool.query(`select indexname from pg_indexes where schemaname = current_schema() and indexname = any($1)`, [NAMES])).rows.map((r) => r.indexname as string).sort();
      expect(await idx()).toEqual([...NAMES].sort());
      await s.pool.query(`insert into events (tenant_id, type, subject_kind, subject_id) select 't-1', 'task.stateChanged', 'task', 'x' || g from generate_series(1, 200) g`);
      for (let g = 1; g <= 200; g++) await audit(s.pool, { tenantId: 't-1', actor: 'a', action: 'task.reassign', subject: 'x' + g, result: 'ok', correlationId: 'c' });
      expect(await migrate(s.pool, 'down', 16)).toBe(Math.max(...listMigrations().map((m) => m.version).filter((v) => v < 17)));
      expect(await idx()).toEqual([]);
      expect(await migrate(s.pool, 'up')).toBe(LATEST);
      expect(await idx()).toEqual([...NAMES].sort());
      expect(await migrate(s.pool, 'down', 16)).toBe(Math.max(...listMigrations().map((m) => m.version).filter((v) => v < 17)));
      expect(await migrate(s.pool, 'up')).toBe(LATEST);
      expect(Number((await s.pool.query(`select count(*) from events`)).rows[0].count)).toBe(200);
      expect(Number((await s.pool.query(`select count(*) from audit_events`)).rows[0].count)).toBe(200);
    } finally { await s.drop(); }
  });
});

describe('scale-bench guard', () => {
  const u = (db: string) => `postgres://u:p@127.0.0.1:5432/${db}`;
  it('allows only this lane own database and refuses every other', () => {
    expect(laneDbOf('/home/luca/AXION-w8')).toBe('axion_e2e8');
    expect(() => assertOwnLaneDb(u('axion_e2e8'), '/home/luca/AXION-w8')).not.toThrow();
    for (const bad of ['axion_e2e9', 'axion_e2e', 'axion', 'axion_test', 'axion_e2e88']) expect(() => assertOwnLaneDb(u(bad), '/home/luca/AXION-w8')).toThrow(/refusing/);
    expect(() => assertOwnLaneDb(undefined, '/home/luca/AXION-w8')).toThrow(/refusing/);
    expect(() => assertOwnLaneDb(u('axion_e2e8'), '/home/luca/AXION')).toThrow(/lane worktree/);
  });
});
