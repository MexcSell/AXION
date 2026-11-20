import { describe, it, expect, afterAll } from 'vitest';
import { makeSchema } from './helpers.ts';
import { migrate } from '../src/migrate.ts';

const tables = async (pool: import('pg').Pool, schema: string) =>
  (await pool.query(`select table_name from information_schema.tables where table_schema=$1 order by 1`, [schema])).rows.map((r) => r.table_name);

describe('migrations', () => {
  let s: Awaited<ReturnType<typeof makeSchema>>;
  afterAll(async () => { await s?.drop(); });

  it('up → down → up leaves the same tables', async () => {
    s = await makeSchema({ migrate: false });
    await migrate(s.pool, 'up');
    const first = await tables(s.pool, s.schema);
    expect(first).toContain('users');
    expect(first).toContain('audit_events');
    await migrate(s.pool, 'down', 0);
    expect(await tables(s.pool, s.schema)).toEqual(['schema_migrations']);
    await migrate(s.pool, 'up');
    expect(await tables(s.pool, s.schema)).toEqual(first);
  });

  it('audit_events is append-only', async () => {
    await s.pool.query(`insert into audit_events(tenant_id, actor, action, subject, result, correlation_id) values ('t-1','system','test','x','ok','c1')`);
    await expect(s.pool.query(`update audit_events set action='hacked'`)).rejects.toThrow(/audit_events is append-only/);
    await expect(s.pool.query(`delete from audit_events`)).rejects.toThrow(/audit_events is append-only/);
  });
});

describe('mission tables', () => {
  it('exist after migrating up', async () => {
    const s2 = await makeSchema();
    const ts = await tables(s2.pool, s2.schema);
    for (const t of ['missions', 'mission_revisions', 'mission_runs', 'tasks', 'task_dependencies', 'uploads', 'idempotency_keys']) expect(ts).toContain(t);
    const n = (await s2.pool.query(`select nextval('mission_seq')::int n`)).rows[0].n;
    expect(n).toBeGreaterThan(136);
    await s2.drop();
  });
});
