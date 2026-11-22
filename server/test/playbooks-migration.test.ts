import { describe, it, expect, afterAll } from 'vitest';
import { makeSchema } from './helpers.ts';
import { migrate } from '../src/migrate.ts';

// Improvement cycle 41: migration 0033 applies on a database that already has data, and goes down again cleanly.
const tables = async (pool: import('pg').Pool, schema: string) =>
  (await pool.query(`select table_name from information_schema.tables where table_schema=$1 order by 1`, [schema])).rows.map((r) => r.table_name as string);
const fns = async (pool: import('pg').Pool, schema: string) =>
  (await pool.query(`select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname=$1 order by 1`, [schema])).rows.map((r) => r.proname as string);

describe('migration 0033 (playbooks)', () => {
  let s: Awaited<ReturnType<typeof makeSchema>>;
  afterAll(async () => { await s?.drop(); });
  it('up on a database with an agent and a user keeps their rows; down removes only its own tables and functions', async () => {
    s = await makeSchema({ migrate: false });
    await migrate(s.pool, 'up', 32);
    await s.pool.query(`insert into agent_definitions(id,tenant_id,name,role,dept,duty,created_by) values ('a-1','t-1','A','r','d','duty','system')`);
    const before = { t: await tables(s.pool, s.schema), f: await fns(s.pool, s.schema) };
    expect(before.t).not.toContain('playbooks');
    await migrate(s.pool, 'up');
    const after = await tables(s.pool, s.schema);
    for (const t of ['lesson_candidates', 'playbooks', 'skills']) expect(after).toContain(t);
    expect((await s.pool.query('select count(*)::int n from agent_definitions')).rows[0].n).toBe(1);
    await s.pool.query(`insert into lesson_candidates(id,tenant_id,agent_id,role,text,sources,proposed_by,sha256) values ('LC-1','t-1','a-1','r','x','[{"kind":"note","id":"n"}]','u','${'a'.repeat(64)}')`);
    await expect(s.pool.query(`insert into lesson_candidates(id,tenant_id,agent_id,role,text,sources,proposed_by,sha256) values ('LC-2','t-1','a-1','r','x','[]','u','${'a'.repeat(64)}')`)).rejects.toThrow(); // no sources
    await migrate(s.pool, 'down', 32);
    expect({ t: await tables(s.pool, s.schema), f: await fns(s.pool, s.schema) }).toEqual(before);
    expect((await s.pool.query('select count(*)::int n from agent_definitions')).rows[0].n).toBe(1);
    await migrate(s.pool, 'up');
    expect(await tables(s.pool, s.schema)).toEqual(after);
  });
});
