import { describe, it, expect } from 'vitest';
import { makeSchema, makeTestApp, withAdmin } from './helpers.ts';
import { seedDemo, clearDemo } from '../src/seed/demo.ts';
import { discoverAppendOnly, checkAppendOnlyGuards } from './append-only-guards.ts';

// c80 item 1 (R4-6): every append-only table found in the live schema of a migrated test DB must carry all four guards
// (UPDATE, DELETE, TRUNCATE refused; the axion.purge_demo exception for DELETE on tables that demo data cascades into).
// LESSONS: c32, c35 and c36 each missed one. The tables are discovered from the catalog, so a future migration is covered with no edit here.

// The floor: tables known to be append-only today. If a table loses every guard it silently drops out of discovery, so this list pins it.
// A migration that really retires a table from this set must edit the list on purpose (that is the gate).
const FLOOR = [
  'agent_versions', 'approval_decisions', 'approval_requests', 'audit_events', 'delegation_briefs', 'eval_attestations', 'eval_calibration_labels',
  'eval_cases', 'eval_datasets', 'eval_regrade_cases', 'eval_regrades', 'eval_results', 'eval_runs', 'events', 'failure_attributions',
  'failure_pattern_candidates', 'failure_tags', 'lesson_candidates', 'mentoring_milestones', 'mentoring_plans', 'message_receipts', 'messages',
  'metric_audit_labels', 'mission_delegations', 'mission_ledgers', 'org_edges', 'org_revisions', 'playbooks', 'record_contributions', 'site_grants',
  'skill_outcomes', 'skills', 'system_jobs', 'task_attempts', 'task_owner_history', 'task_reviews',
];

// Fixture migrations: each adds an append-only table that misses exactly one guard. They live here and are never shipped.
const GUARD_FN = (extra = '') => `create function fx_guard() returns trigger language plpgsql as $$ begin ${extra} raise exception '% is append-only', tg_table_name; end $$;`;
const PURGE = `if tg_op = 'DELETE' and coalesce(current_setting('axion.purge_demo', true), '') = 'on' then return old; end if;`;
const TBL = `create table fx_log (id bigserial primary key, mission_id text references missions(id) on delete cascade, note text);`;
const FIXTURES: Record<string, { sql: string; guard: 'update' | 'delete' | 'truncate' | 'purge_demo' }> = {
  'no TRUNCATE guard': { guard: 'truncate', sql: `${TBL} ${GUARD_FN(PURGE)} create trigger fx_log_no_update before update or delete on fx_log for each row execute function fx_guard();` },
  'no DELETE guard': { guard: 'delete', sql: `${TBL} ${GUARD_FN(PURGE)} create trigger fx_log_no_update before update on fx_log for each row execute function fx_guard(); create trigger fx_log_no_truncate before truncate on fx_log for each statement execute function fx_guard();` },
  'no UPDATE guard': { guard: 'update', sql: `${TBL} ${GUARD_FN(PURGE)} create trigger fx_log_no_del before delete on fx_log for each row execute function fx_guard(); create trigger fx_log_no_truncate before truncate on fx_log for each statement execute function fx_guard();` },
  'no purge_demo exception (cascades from missions)': { guard: 'purge_demo', sql: `${TBL} ${GUARD_FN()} create trigger fx_log_no_update before update or delete on fx_log for each row execute function fx_guard(); create trigger fx_log_no_truncate before truncate on fx_log for each statement execute function fx_guard();` },
  'guard trigger present but disabled': { guard: 'update', sql: `${TBL} ${GUARD_FN(PURGE)} create trigger fx_log_no_update before update or delete on fx_log for each row execute function fx_guard(); create trigger fx_log_no_truncate before truncate on fx_log for each statement execute function fx_guard(); alter table fx_log disable trigger fx_log_no_update;` },
};

describe('c80: generated four-guards test for append-only tables', () => {
  it('finds the append-only tables from the catalog (and none is missing from the pinned floor)', async () => {
    const s = await makeSchema();
    try {
      const found = await discoverAppendOnly(s.pool);
      expect(found.length).toBeGreaterThanOrEqual(FLOOR.length);
      expect(FLOOR.filter((t) => !found.includes(t))).toEqual([]);
      console.log(`c80 append-only tables found (${found.length}): ${found.join(', ')}`);
    } finally { await s.drop(); }
  });

  it('every append-only table has UPDATE, DELETE, TRUNCATE guards and the purge_demo exception where demo data cascades', async () => {
    const s = await makeSchema();
    try { expect(await checkAppendOnlyGuards(s.pool)).toEqual([]); } finally { await s.drop(); }
  });

  for (const [name, fx] of Object.entries(FIXTURES)) {
    it(`fixture migration "${name}" is caught`, async () => {
      const s = await makeSchema();
      try {
        await s.pool.query(fx.sql);
        expect(await discoverAppendOnly(s.pool)).toContain('fx_log');
        const v = await checkAppendOnlyGuards(s.pool);
        expect(v.filter((x) => x.table !== 'fx_log')).toEqual([]);
        expect(v.map((x) => x.guard)).toContain(fx.guard);
      } finally { await s.drop(); }
    });
  }

  it('a fully guarded fixture table passes (the check is not just always red)', async () => {
    const s = await makeSchema();
    try {
      await s.pool.query(`${TBL} ${GUARD_FN(PURGE)} create trigger fx_log_no_update before update or delete on fx_log for each row execute function fx_guard(); create trigger fx_log_no_truncate before truncate on fx_log for each statement execute function fx_guard();`);
      expect(await discoverAppendOnly(s.pool)).toContain('fx_log');
      expect(await checkAppendOnlyGuards(s.pool)).toEqual([]);
    } finally { await s.drop(); }
  });

  it('clearDemo still works after seeding a demo (the purge exception is intact end to end)', async () => {
    const t = await makeTestApp({ staffingStepMs: 3_600_000, conversationSimMs: 3_600_000 });
    try {
      const w = await withAdmin(t.app);
      await seedDemo(t.app.db, 't-1', w.adminId);
      expect((await t.pool.query(`select count(*)::int n from missions where demo`)).rows[0].n).toBeGreaterThan(0);
      await expect(clearDemo(t.app.db, 't-1')).resolves.toBeTruthy();
      expect((await t.pool.query(`select count(*)::int n from missions where demo`)).rows[0].n).toBe(0);
      expect((await t.pool.query(`select count(*)::int n from mission_ledgers where demo`)).rows[0].n).toBe(0);
    } finally { await t.close(); }
  });
});
