import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { makeSchema, TEST_DB } from './helpers.ts';
import { migrate, listMigrations } from '../src/migrate.ts';
import { hashDataset } from '../src/evolution/verdict-v2.ts';
import { makeDataset, addRun } from './eval-fixtures.ts';

// c47 (E1b): the database side. Subjects of a run, freeze safety, the hash recomputed from the stored cases.
let s: Awaited<ReturnType<typeof makeSchema>>;
let vid = '';
const q = (sql: string, p: unknown[] = []) => s.pool.query(sql, p);
const stored = async (ds: string) => (await q(`select case_id as "caseId", input, expected from eval_cases where dataset_id=$1`, [ds])).rows;
const tamper = async (fn: () => Promise<void>) => {
  await q(`alter table eval_cases disable trigger eval_cases_guard`);
  try { await fn(); } finally { await q(`alter table eval_cases enable trigger eval_cases_guard`); }
};

beforeAll(async () => {
  s = await makeSchema();
  await q(`insert into tenants(id,name) values ('t-1','T'),('t-2','Other') on conflict do nothing`);
  await q(`insert into agent_definitions(id, tenant_id, name, role, dept, duty, created_by) values ('a-1','t-1','A','r','D','duty','u'),('a-2','t-2','B','r','D','duty2','u')`);
  vid = (await q(`insert into agent_versions(agent_id, seq, label, model, prompt_hash, created_by) values ('a-1',1,'v1','m','h','u') returning id`)).rows[0].id;
  await q(`insert into agent_version_proposals(id, tenant_id, agent_id, base_version_id, base_sha, candidate, candidate_sha, title, created_by) values ('VP-1','t-1','a-1',$1,'h','{"model":"m","skills":[],"tools":[]}','c1','t','u')`, [vid]);
  const v2 = (await q(`insert into agent_versions(agent_id, seq, label, model, prompt_hash, created_by) values ('a-2',1,'v1','m','h','u') returning id`)).rows[0].id;
  await q(`insert into agent_version_proposals(id, tenant_id, agent_id, base_version_id, base_sha, candidate, candidate_sha, title, created_by) values ('VP-2','t-2','a-2',$1,'h','{"model":"m","skills":[],"tools":[]}','c2','t','u')`, [v2]);
});
afterAll(async () => { await s.drop(); });

describe('migration 0037', () => {
  it('exists and is the reserved number', () => { expect(listMigrations().map((m) => m.version)).toContain(37); });
  it('goes down/up/down/up on a populated schema', async () => {
    const m = await makeSchema();
    try {
      const all = listMigrations().map((x) => x.version);
      const latest = Math.max(...all);
      const prev = Math.max(...all.filter((v) => v < 37));
      await m.pool.query(`insert into tenants(id,name) values ('t-1','T') on conflict do nothing`);
      await m.pool.query(`insert into eval_datasets(id, tenant_id, name, split) values ('D','t-1','n','dev')`);
      expect(await migrate(m.pool, 'down', 36)).toBe(prev);
      expect((await m.pool.query(`select 1 from information_schema.columns where table_schema=current_schema() and table_name='eval_runs' and column_name='subject_proposal_id'`)).rowCount).toBe(0);
      expect(await migrate(m.pool, 'up')).toBe(latest);
      expect(await migrate(m.pool, 'down', 36)).toBe(prev);
      expect(await migrate(m.pool, 'up')).toBe(latest);
      expect((await m.pool.query(`select count(*)::int n from eval_datasets`)).rows[0].n).toBe(1);
    } finally { await m.drop(); }
  });
});

describe('the hash is computed in the database and equals hashDataset', () => {
  const shapes: Array<[string, unknown, unknown]> = [
    ['plain', { q: 1, text: 'hello' }, { a: 2 }],
    ['nested, key order, arrays', { z: [1, { b: 2, a: [true, null, 'x'] }], a: { y: 1, x: 2 } }, [3, 2, 1]],
    ['decimals and negatives', { n: 1.5, m: -0.25, big: 123456789012, zero: 0 }, 1.0],
    ['unicode and control characters', { t: 'café ü中 "q" \\ \n\t\u0001 /  ' }, 'résumé'],
    ['empty containers', {}, []],
    ['scalars', 'text', false],
  ];
  it.each(shapes)('freeze stores sha256 of the cases (%s)', async (name, input, expected) => {
    const id = 'H-' + name.replace(/\W/g, '');
    await q(`insert into eval_datasets(id, tenant_id, name, split) values ($1,'t-1',$1,'dev')`, [id]);
    await q(`insert into eval_cases(dataset_id, case_id, input, expected) values ($1,'b',$2,$3),($1,'a',$3,$2)`, [id, JSON.stringify(input), JSON.stringify(expected)]);
    const r = await q(`select eval_freeze_dataset($1) as sha`, [id]);
    expect(r.rows[0].sha).toBe(hashDataset(await stored(id)));
    expect((await q(`select content_sha256 from eval_datasets where id=$1`, [id])).rows[0].content_sha256).toBe(r.rows[0].sha);
  });
  it('the same cases hash the same whatever order they were inserted in', async () => {
    await q(`insert into eval_datasets(id, tenant_id, name, split) values ('O1','t-1','o1','dev'),('O2','t-1','o2','dev')`);
    await q(`insert into eval_cases(dataset_id, case_id, input, expected) values ('O1','x','1','2'),('O1','y','3','4'),('O2','y','3','4'),('O2','x','1','2')`);
    const a = (await q(`select eval_freeze_dataset('O1') as sha`)).rows[0].sha;
    const b = (await q(`select eval_freeze_dataset('O2') as sha`)).rows[0].sha;
    expect(a).toBe(b);
  });
});

describe('freezing', () => {
  it('a raw UPDATE that freezes with a false hash is refused', async () => {
    await q(`insert into eval_datasets(id, tenant_id, name, split) values ('F1','t-1','f1','dev')`);
    await q(`insert into eval_cases(dataset_id, case_id, input, expected) values ('F1','c1','1','1')`);
    await expect(q(`update eval_datasets set frozen_at = now(), content_sha256 = $1 where id='F1'`, ['a'.repeat(64)])).rejects.toThrow(/hash/);
    expect((await q(`select frozen_at from eval_datasets where id='F1'`)).rows[0].frozen_at).toBeNull();
  });
  it('a raw UPDATE with the hash of the stored cases is accepted', async () => {
    await q(`insert into eval_datasets(id, tenant_id, name, split) values ('F2','t-1','f2','dev')`);
    await q(`insert into eval_cases(dataset_id, case_id, input, expected) values ('F2','c1','{"a":1}','"x"')`);
    await q(`update eval_datasets set frozen_at = now(), content_sha256 = $1 where id='F2'`, [hashDataset(await stored('F2'))]);
    expect((await q(`select frozen_at from eval_datasets where id='F2'`)).rows[0].frozen_at).not.toBeNull();
  });
  it('a zero-case dataset cannot be frozen, by UPDATE or by the function', async () => {
    await q(`insert into eval_datasets(id, tenant_id, name, split) values ('F3','t-1','f3','holdout')`);
    await expect(q(`update eval_datasets set frozen_at = now(), content_sha256 = $1 where id='F3'`, [hashDataset([])])).rejects.toThrow(/no cases/);
    await expect(q(`select eval_freeze_dataset('F3')`)).rejects.toThrow(/no cases/);
  });
  it('freezing an unknown dataset, or one that is already frozen, is refused', async () => {
    await expect(q(`select eval_freeze_dataset('NOPE')`)).rejects.toThrow(/no such|not found/i);
    await expect(q(`select eval_freeze_dataset('F2')`)).rejects.toThrow(/frozen/);
  });
  it('a dataset cannot be INSERTed already frozen', async () => {
    await expect(q(`insert into eval_datasets(id, tenant_id, name, split, frozen_at, content_sha256) values ('F4','t-1','f4','dev', now(), $1)`, [hashDataset([])])).rejects.toThrow(/frozen/);
    expect((await q(`select 1 from eval_datasets where id='F4'`)).rowCount).toBe(0);
  });
  it('freezing is serialised against a case insert in flight: the hash includes the case', async () => {
    await q(`insert into eval_datasets(id, tenant_id, name, split) values ('F5','t-1','f5','holdout')`);
    await q(`insert into eval_cases(dataset_id, case_id, input, expected) values ('F5','c1','1','1')`);
    const a = new pg.Client({ connectionString: TEST_DB(), options: `-c search_path=${s.schema}` });
    const b = new pg.Client({ connectionString: TEST_DB(), options: `-c search_path=${s.schema}` });
    await a.connect(); await b.connect();
    try {
      await a.query('begin');
      await a.query(`insert into eval_cases(dataset_id, case_id, input, expected) values ('F5','c2','2','2')`);
      let done = false;
      const frz = b.query(`select eval_freeze_dataset('F5') as sha`).then((r) => { done = true; return r; });
      await new Promise((r) => setTimeout(r, 300));
      expect(done).toBe(false); // waiting for the insert to finish, not hashing a half-seen set
      await a.query('commit');
      const r = await frz;
      expect(r.rows[0].sha).toBe(hashDataset(await stored('F5')));
      expect((await stored('F5')).length).toBe(2);
    } finally { await a.end(); await b.end(); }
  });
  it('a case insert that waits on a freeze is refused once the dataset is frozen', async () => {
    await q(`insert into eval_datasets(id, tenant_id, name, split) values ('F6','t-1','f6','holdout')`);
    await q(`insert into eval_cases(dataset_id, case_id, input, expected) values ('F6','c1','1','1')`);
    const a = new pg.Client({ connectionString: TEST_DB(), options: `-c search_path=${s.schema}` });
    const b = new pg.Client({ connectionString: TEST_DB(), options: `-c search_path=${s.schema}` });
    await a.connect(); await b.connect();
    try {
      await a.query('begin');
      await a.query(`select eval_freeze_dataset('F6')`);
      const ins = b.query(`insert into eval_cases(dataset_id, case_id, input, expected) values ('F6','c2','2','2')`).then(() => 'inserted', (e: Error) => e.message);
      await new Promise((r) => setTimeout(r, 300));
      await a.query('commit');
      expect(await ins).toMatch(/frozen/);
      expect((await stored('F6')).length).toBe(1);
    } finally { await a.end(); await b.end(); }
  });
});

describe('the hash cannot drift from the cases', () => {
  it('tampering with a frozen case (guard disabled, as a superuser could) is visible: the stored hash no longer matches', async () => {
    const ids = await makeDataset(s.pool, { id: 'T1', cases: 3 });
    const sha = (await q(`select content_sha256 from eval_datasets where id='T1'`)).rows[0].content_sha256;
    expect(sha).toBe(hashDataset(await stored('T1')));
    await tamper(async () => { await q(`update eval_cases set expected='"changed"' where dataset_id='T1' and case_id=$1`, [ids[0]]); });
    expect(hashDataset(await stored('T1'))).not.toBe(sha);
    expect((await q(`select eval_dataset_sha('T1') as sha`)).rows[0].sha).not.toBe(sha);
  });
  it('the guard itself still refuses the same tamper while enabled', async () => {
    await makeDataset(s.pool, { id: 'T2', cases: 2 });
    await expect(q(`update eval_cases set expected='"x"' where dataset_id='T2'`)).rejects.toThrow(/frozen/);
  });
});

describe('the subject of a run', () => {
  let ds = '';
  beforeAll(async () => { await makeDataset(s.pool, { id: 'R-DS', cases: 3 }); ds = 'R-DS'; });
  const ins = (id: string, v: string | null, p: string | null, tenant = 't-1') =>
    q(`insert into eval_runs(id, tenant_id, dataset_id, subject_version_id, subject_proposal_id, k) values ($1,$2,$3,$4,$5,1)`, [id, tenant, ds, v, p]);
  it('a run names a version', async () => { await ins('SR-1', vid, null); });
  it('a run names a proposal', async () => { await ins('SR-2', null, 'VP-1'); });
  it('a run with neither subject is refused', async () => { await expect(ins('SR-3', null, null)).rejects.toThrow(); });
  it('a run with both subjects is refused', async () => { await expect(ins('SR-4', vid, 'VP-1')).rejects.toThrow(); });
  it('a run cannot name a proposal of another tenant', async () => { await expect(ins('SR-5', null, 'VP-2')).rejects.toThrow(/tenant/); });
  it('a run cannot name a proposal that does not exist', async () => { await expect(ins('SR-6', null, 'VP-NOPE')).rejects.toThrow(); });
  it('the subject of an existing run cannot be changed; runs stay append-only', async () => {
    await expect(q(`update eval_runs set subject_proposal_id = null, subject_version_id = $1 where id='SR-2'`, [vid])).rejects.toThrow(/append-only/);
    await expect(q(`update eval_runs set judge_model_family = 'x' where id='SR-2'`)).rejects.toThrow(/append-only/);
    await expect(q(`delete from eval_runs where id='SR-2'`)).rejects.toThrow(/append-only/);
    await expect(q(`truncate eval_runs cascade`)).rejects.toThrow(/append-only/);
  });
  it('a run on an unfrozen dataset is still refused', async () => {
    await q(`insert into eval_datasets(id, tenant_id, name, split) values ('R-UN','t-1','un','holdout')`);
    await expect(q(`insert into eval_runs(id, tenant_id, dataset_id, subject_proposal_id, k) values ('SR-7','t-1','R-UN','VP-1',1)`)).rejects.toThrow(/frozen/);
  });
  it('judge family and evaluator are stored on the run; fixtures write results for a proposal run', async () => {
    await addRun(s.pool, { id: 'SR-8', datasetId: ds, proposalId: 'VP-1', scores: [90, 80, 70], judge: 'claude-judge', evaluator: 'ev-1' });
    const r = (await q(`select judge_model_family j, evaluator_id e, finished_at from eval_runs where id='SR-8'`)).rows[0];
    expect(r.j).toBe('claude-judge'); expect(r.e).toBe('ev-1'); expect(r.finished_at).not.toBeNull();
  });
});
