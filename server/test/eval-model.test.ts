import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeSchema } from './helpers.ts';
import { migrate, listMigrations } from '../src/migrate.ts';

let s: Awaited<ReturnType<typeof makeSchema>>;
let vid: string;
const q = (sql: string, p: unknown[] = []) => s.pool.query(sql, p);
const tr = JSON.stringify({ steps: [] });

beforeAll(async () => {
  s = await makeSchema();
  await q(`insert into tenants(id,name) values ('t-1','T') on conflict do nothing`);
  await q(`insert into agent_definitions(id, tenant_id, name, role, dept, duty, created_by) values ('a-1','t-1','A','r','D','duty','u')`);
  vid = (await q(`insert into agent_versions(agent_id, seq, label, model, prompt_hash, created_by) values ('a-1',1,'v1','m','h','u') returning id`)).rows[0].id;
  await q(`insert into eval_datasets(id, tenant_id, name, version, split) values ('DS-1','t-1','set',1,'holdout')`);
  await q(`insert into eval_cases(dataset_id, case_id, input, expected) values ('DS-1','c1','{"q":1}','"a"'),('DS-1','c2','{"q":2}','"b"')`);
});
afterAll(async () => { await s.drop(); });

describe('migration 0027', () => {
  it('exists and is the reserved number', () => { expect(listMigrations().map((m) => m.version)).toContain(27); });
  it('goes down/up/down/up on a populated schema', async () => {
    const m = await makeSchema();
    try {
      const all = listMigrations().map((x) => x.version);
      const latest = Math.max(...all);
      const prev = Math.max(...all.filter((v) => v < 27));
      await m.pool.query(`insert into tenants(id,name) values ('t-1','T') on conflict do nothing`);
      await m.pool.query(`insert into eval_datasets(id, tenant_id, name, split) values ('D','t-1','n','dev')`);
      expect(await migrate(m.pool, 'down', 26)).toBe(prev);
      expect((await m.pool.query(`select to_regclass('eval_results') r`)).rows[0].r).toBeNull();
      expect((await m.pool.query(`select count(*)::int n from tenants`)).rows[0].n).toBe(1);
      expect(await migrate(m.pool, 'up')).toBe(latest);
      expect(await migrate(m.pool, 'down', 26)).toBe(prev);
      expect(await migrate(m.pool, 'up')).toBe(latest);
      expect((await m.pool.query(`select count(*)::int n from eval_datasets`)).rows[0].n).toBe(0);
    } finally { await m.drop(); }
  });
});

describe('datasets and cases', () => {
  it('a split other than dev/holdout is rejected', async () => {
    await expect(q(`insert into eval_datasets(id, tenant_id, name, version, split) values ('DS-X','t-1','x',1,'test')`)).rejects.toThrow();
  });
  it('cannot freeze without a hash; once frozen cases are immutable', async () => {
    await q(`insert into eval_datasets(id, tenant_id, name, version, split) values ('DS-2','t-1','two',1,'dev')`);
    await q(`insert into eval_cases(dataset_id, case_id, input, expected) values ('DS-2','c1','1','1')`);
    await expect(q(`update eval_datasets set frozen_at = now() where id='DS-2'`)).rejects.toThrow();
    await q(`update eval_datasets set frozen_at = now(), content_sha256 = $1 where id='DS-2'`, ['a'.repeat(64)]);
    await expect(q(`insert into eval_cases(dataset_id, case_id, input, expected) values ('DS-2','c2','1','1')`)).rejects.toThrow(/frozen/);
    await expect(q(`update eval_cases set expected='2' where dataset_id='DS-2'`)).rejects.toThrow(/frozen/);
    await expect(q(`delete from eval_cases where dataset_id='DS-2'`)).rejects.toThrow(/frozen/);
    await expect(q(`update eval_datasets set content_sha256 = $1 where id='DS-2'`, ['b'.repeat(64)])).rejects.toThrow(/frozen/);
    await expect(q(`delete from eval_datasets where id='DS-2'`)).rejects.toThrow(/frozen/);
  });
});

describe('fix round', () => {
  it('cannot freeze a dataset with zero cases', async () => {
    await q(`insert into eval_datasets(id, tenant_id, name, version, split) values ('DS-E','t-1','empty',1,'dev')`);
    await expect(q(`update eval_datasets set frozen_at = now(), content_sha256 = $1 where id='DS-E'`, ['d'.repeat(64)])).rejects.toThrow(/no cases/);
  });
  it('truncate is refused on all four tables', async () => {
    for (const t of ['eval_datasets', 'eval_cases', 'eval_runs', 'eval_results']) {
      await expect(q(`truncate ${t} cascade`)).rejects.toThrow(/append-only/);
    }
    expect((await q(`select count(*)::int n from eval_cases`)).rows[0].n).toBeGreaterThan(0);
  });
  it('a run cannot evaluate a version of another tenant\'s agent', async () => {
    await q(`insert into tenants(id,name) values ('t-2','Other')`);
    await q(`insert into agent_definitions(id, tenant_id, name, role, dept, duty, created_by) values ('a-2','t-2','B','r','D','duty2','u')`);
    const v2 = (await q(`insert into agent_versions(agent_id, seq, label, model, prompt_hash, created_by) values ('a-2',1,'v1','m','h','u') returning id`)).rows[0].id;
    await q(`update eval_datasets set frozen_at = now(), content_sha256 = $1 where id='DS-1' and frozen_at is null`, ['c'.repeat(64)]);
    await expect(q(`insert into eval_runs(id, tenant_id, dataset_id, subject_version_id, k) values ('ER-T','t-1','DS-1',$1,1)`, [v2])).rejects.toThrow(/tenant/);
  });
});

describe('runs and results', () => {
  let run: string;
  beforeAll(async () => {
    await q(`update eval_datasets set frozen_at = now(), content_sha256 = $1 where id='DS-1' and frozen_at is null`, ['c'.repeat(64)]);
    run = 'ER-1';
    await q(`insert into eval_runs(id, tenant_id, dataset_id, subject_version_id, k) values ($1,'t-1','DS-1',$2,2)`, [run, vid]);
  });
  it('a run needs a frozen dataset', async () => {
    await q(`insert into eval_datasets(id, tenant_id, name, version, split) values ('DS-3','t-1','three',1,'dev')`);
    await expect(q(`insert into eval_runs(id, tenant_id, dataset_id, subject_version_id, k) values ('ER-2','t-1','DS-3',$1,1)`, [vid])).rejects.toThrow(/frozen/);
  });
  it('k must be at least 1', async () => {
    await expect(q(`insert into eval_runs(id, tenant_id, dataset_id, subject_version_id, k) values ('ER-3','t-1','DS-1',$1,0)`, [vid])).rejects.toThrow();
  });
  it('results: score 0..100 or null, attempt within 1..k, case in the dataset, trace schema', async () => {
    const ins = (c: string, a: number, score: number | null, trace = tr) =>
      q(`insert into eval_results(run_id, case_id, attempt, score, cost_units, trace) values ($1,$2,$3,$4,1.5,$5)`, [run, c, a, score, trace]);
    await ins('c1', 1, 80);
    await ins('c1', 2, null);
    await expect(ins('c1', 1, 80)).rejects.toThrow(); // duplicate attempt
    await expect(ins('c1', 3, 50)).rejects.toThrow(/attempt/);
    await expect(ins('c2', 1, 101)).rejects.toThrow();
    await expect(ins('zz', 1, 50)).rejects.toThrow(/case/);
    await expect(ins('c2', 1, 50, '[]')).rejects.toThrow();
    await expect(ins('c2', 1, 50, '{"nope":1}')).rejects.toThrow();
  });
  it('results are append-only', async () => {
    await expect(q(`update eval_results set score = 100`)).rejects.toThrow(/append-only/);
    await expect(q(`delete from eval_results`)).rejects.toThrow(/append-only/);
    await expect(q(`truncate eval_results`)).rejects.toThrow(/append-only/);
  });
  it('a run can be finished once and nothing else about it can change', async () => {
    await expect(q(`update eval_runs set k = 5 where id=$1`, [run])).rejects.toThrow(/append-only|immutable/);
    await q(`update eval_runs set finished_at = now() where id=$1`, [run]);
    await expect(q(`update eval_runs set finished_at = now() where id=$1`, [run])).rejects.toThrow();
    await expect(q(`insert into eval_results(run_id, case_id, attempt, score, trace) values ($1,'c2',1,10,$2)`, [run, tr])).rejects.toThrow(/finished/);
  });
});
