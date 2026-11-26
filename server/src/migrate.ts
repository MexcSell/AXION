import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import type pg from 'pg';
import { LOCK_KEY_SQL } from './locks.ts';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

interface Mig { version: number; name: string; up: string; down: string }
export function listMigrations(): Mig[] {
  const files = readdirSync(DIR);
  return files.filter((f) => f.endsWith('.up.sql')).sort().map((f) => {
    const base = f.replace(/\.up\.sql$/, '');
    return { version: Number(base.slice(0, 4)), name: base, up: readFileSync(join(DIR, f), 'utf8'), down: readFileSync(join(DIR, base + '.down.sql'), 'utf8') };
  });
}

/** Plain-SQL migrations with up/down files. 'up' goes to the latest (or target), 'down' to target (default: one step). */
export async function migrate(pool: pg.Pool, direction: 'up' | 'down', target?: number): Promise<number> {
  const c = await pool.connect();
  try {
    await c.query('create table if not exists schema_migrations (version int primary key, name text not null, applied_at timestamptz not null default now())');
    await c.query(`select pg_advisory_lock(${LOCK_KEY_SQL})`, ['migrate']);
    const done = new Set((await c.query('select version from schema_migrations')).rows.map((r) => r.version as number));
    const all = listMigrations();
    const current = Math.max(0, ...done);
    if (direction === 'up') {
      for (const m of all) {
        if (done.has(m.version) || (target !== undefined && m.version > target)) continue;
        await c.query('begin');
        try { await c.query(m.up); await c.query('insert into schema_migrations(version, name) values ($1,$2)', [m.version, m.name]); await c.query('commit'); }
        catch (e) { await c.query('rollback'); throw e; }
      }
    } else {
      const to = target ?? Math.max(0, current - 1);
      for (const m of [...all].reverse()) {
        if (!done.has(m.version) || m.version <= to) continue;
        await c.query('begin');
        try { await c.query(m.down); await c.query('delete from schema_migrations where version=$1', [m.version]); await c.query('commit'); }
        catch (e) { await c.query('rollback'); throw e; }
      }
    }
    return Math.max(0, ...(await c.query('select version from schema_migrations')).rows.map((r) => r.version as number));
  } finally {
    await c.query(`select pg_advisory_unlock(${LOCK_KEY_SQL})`, ['migrate']).catch(() => {});
    c.release();
  }
}

/**
 * Container mode (AXION_MIGRATE_ON_START=0): the Guard migrates as its own step, so the API only checks. It refuses a schema behind this build;
 * a schema ahead of it (a newer slot already migrated during a blue/green switch) is fine.
 */
export async function assertSchemaCurrent(pool: pg.Pool): Promise<{ applied: number; expected: number }> {
  const expected = Math.max(0, ...listMigrations().map((m) => m.version));
  let applied = 0;
  try { applied = Number((await pool.query('select max(version) as v from schema_migrations')).rows[0]?.v ?? 0); }
  catch (e) { if ((e as { code?: string }).code !== '42P01') throw e; } // no bookkeeping table yet = nothing applied
  if (applied < expected) throw new Error(`schema is at ${applied}, this build expects ${expected}: run the migration step first`);
  return { applied, expected };
}
