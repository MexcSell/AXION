import { describe, it, expect } from 'vitest';
import { userInfo } from 'node:os';
import { makeSchema, TEST_DB } from './helpers.ts';
import { assertSchemaCurrent, listMigrations, migrate } from '../src/migrate.ts';
import { connectClient } from '../src/db.ts';

/** Evolve step 1: in container mode the Guard migrates as an explicit step; the API only checks (AXION_MIGRATE_ON_START=0). */
describe('assertSchemaCurrent', () => {
  it('passes on a fully migrated schema and throws with both numbers when one migration is missing', async () => {
    const all = listMigrations();
    const latest = all[all.length - 1]!.version;
    const before = all[all.length - 2]!.version;
    const s = await makeSchema({ migrate: false });
    try {
      // nothing applied (not even the bookkeeping table): refuses
      await expect(assertSchemaCurrent(s.pool)).rejects.toThrow(`schema is at 0, this build expects ${latest}: run the migration step first`);
      await migrate(s.pool, 'up', before);
      await expect(assertSchemaCurrent(s.pool)).rejects.toThrow(`schema is at ${before}, this build expects ${latest}: run the migration step first`);
      await migrate(s.pool, 'up');
      expect(await assertSchemaCurrent(s.pool)).toEqual({ applied: latest, expected: latest });
      // a schema ahead of this build (a newer slot already migrated) is not refused
      await s.pool.query('insert into schema_migrations(version, name) values ($1, $2)', [latest + 1, 'future']);
      expect(await assertSchemaCurrent(s.pool)).toEqual({ applied: latest + 1, expected: latest });
    } finally { await s.drop(); }
  });
});

describe('socket database URL', () => {
  it('a socket URL postgresql:///axion_test?host=/var/run/postgresql connects', async (ctx) => {
    // same database as TEST_DATABASE_URL (never `axion`), reached over the Unix socket with peer authentication
    const dbName = decodeURIComponent(new URL(TEST_DB()).pathname.slice(1));
    expect(dbName).not.toBe('axion');
    const url = `postgresql:///${encodeURIComponent(dbName)}?host=/var/run/postgresql`;
    let c;
    try { c = await connectClient({ connectionString: url }); }
    catch (e) {
      const m = String((e as Error).message);
      if (/peer authentication|role "[^"]*" does not exist/i.test(m)) {
        console.warn(`skipped: user "${userInfo().username}" has no peer mapping on /var/run/postgresql (runs for real in the container, Task 7): ${m}`);
        ctx.skip();
      }
      throw e;
    }
    try { expect((await c.query('select current_database() as d')).rows[0].d).toBe(dbName); }
    finally { await c.end(); }
  });
});
