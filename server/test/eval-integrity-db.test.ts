import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { makeSchema, TEST_DB } from './helpers.ts';
import { migrate, listMigrations } from '../src/migrate.ts';
import { makeDataset, addRun } from './eval-fixtures.ts';
import { loadEvaluations } from '../src/evolution/proposal-evidence.ts';

// c53 (E1c): eval-run integrity in the database. Records only: nothing here runs an evaluation or calls a model.
let s: Awaited<ReturnType<typeof makeSchema>>;
let v1 = '', v2 = '';
const q = (sql: string, p: unknown[] = []) => s.pool.query(sql, p);
const prop = (id: string, agent: string, base: string, sha: string, status = 'pending', tenant = 't-1') =>
  q(`insert into agent_version_proposals(id, tenant_id, agent_id, base_version_id, base_sha, candidate, candidate_sha, title, created_by, status) values ($1,$2,$3,$4,'h','{"model":"qwen-72b","skills":[],"tools":[]}',$5,'t','u',$6)`, [id, tenant, agent, base, sha, status]);
const run = (id: string, ds: string, o: { version?: string; proposal?: string; tenant?: string; k?: number } = {}) =>
  q(`insert into eval_runs(id, tenant_id, dataset_id, subject_version_id, subject_proposal_id, k, judge_model_family, evaluator_id) values ($1,$2,$3,$4,$5,$6,'claude-judge','ev')`, [id, o.tenant ?? 't-1', ds, o.version ?? null, o.proposal ?? null, o.k ?? 1]);

beforeAll(async () => {
  s = await makeSchema();
  await q(`insert into tenants(id,name) values ('t-1','T'),('t-2','Other') on conflict do nothing`);
  await q(`insert into agent_definitions(id, tenant_id, name, role, dept, duty, created_by) values ('a-1','t-1','A','r','D','duty','u'),('a-2','t-1','B','r','D','duty2','u')`);
  v1 = (await q(`insert into agent_versions(agent_id, seq, label, model, prompt_hash, created_by) values ('a-1',1,'v1','m','h','u') returning id`)).rows[0].id;
  v2 = (await q(`insert into agent_versions(agent_id, seq, label, model, prompt_hash, created_by) values ('a-2',1,'v1','m','h','u') returning id`)).rows[0].id;
  await prop('P-1', 'a-1', v1, 'sha-X', 'withdrawn');
  await prop('P-2', 'a-1', v1, 'sha-X'); // the same config proposed again after P-1 was withdrawn
  await prop('P-3', 'a-1', v1, 'sha-Y');
  await prop('P-4', 'a-2', v2, 'sha-X'); // same sha text on another agent: its own count
});
afterAll(async () => { await s.drop(); });

describe('migration 0040', () => {
  it('exists and goes down/up/down/up on a populated schema', async () => {
    expect(listMigrations().map((m) => m.version)).toContain(40);
    const m = await makeSchema();
    try {
      const all = listMigrations().map((x) => x.version);
      const latest = Math.max(...all);
      const prev = Math.max(...all.filter((v) => v < 40));
      await m.pool.query(`insert into tenants(id,name) values ('t-1','T') on conflict do nothing`);
      await m.pool.query(`insert into eval_datasets(id, tenant_id, name, split) values ('D','t-1','n','dev')`);
      expect(await migrate(m.pool, 'down', 39)).toBe(prev);
      expect(await migrate(m.pool, 'up')).toBe(latest);
      expect(await migrate(m.pool, 'down', 39)).toBe(prev);
      expect(await migrate(m.pool, 'up')).toBe(latest);
      expect((await m.pool.query(`select count(*)::int n from eval_datasets`)).rows[0].n).toBe(1);
    } finally { await m.drop(); }
  });
});

describe('item 1: one run per candidate config and holdout, across proposals', () => {
  it('withdrawing and re-proposing the same config cannot buy a second run on the same holdout', async () => {
    await makeDataset(s.pool, { id: 'H1', split: 'holdout', cases: 3 });
    await run('R1', 'H1', { proposal: 'P-1' });
    await expect(run('R2', 'H1', { proposal: 'P-2' })).rejects.toThrow(/holdout_rerun/);
  });
  it('the refusal names the run to resume', async () => {
    await expect(run('R2b', 'H1', { proposal: 'P-2' })).rejects.toThrow(/R1/);
  });
  it('a second run by the same proposal is refused too', async () => {
    await expect(run('R2c', 'H1', { proposal: 'P-1' })).rejects.toThrow(/holdout_rerun/);
  });
  it('a different config on the same holdout is a different key', async () => { await run('R3', 'H1', { proposal: 'P-3' }); });
  it('the same config on a fresh holdout dataset is allowed', async () => {
    await makeDataset(s.pool, { id: 'H1b', split: 'holdout', cases: 3 });
    await run('R4', 'H1b', { proposal: 'P-2' });
  });
  it('the same sha on another agent is its own key', async () => { await run('R5', 'H1', { proposal: 'P-4' }); });
  it('a dev dataset can be re-run freely', async () => {
    await makeDataset(s.pool, { id: 'DV1', split: 'dev', cases: 3 });
    await run('D1', 'DV1', { proposal: 'P-1' }); await run('D2', 'DV1', { proposal: 'P-2' }); await run('D3', 'DV1', { proposal: 'P-1' });
  });
  it('base runs: one per base version and holdout dataset', async () => {
    await run('B1', 'H1', { version: v1 });
    await expect(run('B2', 'H1', { version: v1 })).rejects.toThrow(/holdout_rerun/);
    await run('B3', 'H1', { version: v2 }); // another version, own key
    await run('B4', 'H1b', { version: v1 }); // another holdout, own key
  });
  it('two writers racing for the same key: exactly one wins', async () => {
    await makeDataset(s.pool, { id: 'H-RACE', split: 'holdout', cases: 3 });
    const res = await Promise.allSettled([run('RC1', 'H-RACE', { proposal: 'P-3' }), run('RC2', 'H-RACE', { proposal: 'P-3' }), run('RC3', 'H-RACE', { proposal: 'P-3' })]);
    expect(res.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });
  it('the key cannot be set or changed by a caller', async () => {
    await makeDataset(s.pool, { id: 'H-KEY', split: 'holdout', cases: 3 });
    await q(`insert into eval_runs(id, tenant_id, dataset_id, subject_proposal_id, k, holdout_key) values ('K1','t-1','H-KEY','P-3',1,'whatever')`);
    await expect(run('K2', 'H-KEY', { proposal: 'P-3' })).rejects.toThrow(/holdout_rerun/);
    await expect(q(`update eval_runs set holdout_key = null, finished_at = now() where id='K1'`)).rejects.toThrow(/append-only/);
  });
  it('a finished run still counts', async () => {
    await makeDataset(s.pool, { id: 'H-FIN', split: 'holdout', cases: 3 });
    await addRun(s.pool, { id: 'F1', datasetId: 'H-FIN', proposalId: 'P-3', scores: [1, 2, 3] });
    await expect(run('F2', 'H-FIN', { proposal: 'P-3' })).rejects.toThrow(/holdout_rerun/);
  });
});

describe('item 1: the loader counts runs across proposals too (defence in depth)', () => {
  it('a re-proposal whose run got past a disabled guard reads holdout_rerun with the combined run count', async () => {
    await makeDataset(s.pool, { id: 'H-LD', split: 'holdout', cases: 12 });
    await prop('P-5', 'a-1', v1, 'sha-Z', 'withdrawn'); await prop('P-6', 'a-1', v1, 'sha-Z');
    const sc = Array.from({ length: 12 }, () => 40), better = Array.from({ length: 12 }, (_, i) => 70 + (i % 3));
    await addRun(s.pool, { id: 'LD-b', datasetId: 'H-LD', versionId: v1, scores: sc, evaluator: 'ev-b' });
    await addRun(s.pool, { id: 'LD-1', datasetId: 'H-LD', proposalId: 'P-5', scores: sc, evaluator: 'ev-b' }); // the bad first run, then withdrawn
    await s.pool.query(`alter table eval_runs disable trigger eval_runs_guard`);
    try { await addRun(s.pool, { id: 'LD-2', datasetId: 'H-LD', proposalId: 'P-6', scores: better, evaluator: 'ev-b' }); }
    finally { await s.pool.query(`alter table eval_runs enable trigger eval_runs_guard`); }
    const c = await s.pool.connect();
    try {
      const m = await loadEvaluations(c, 't-1', [{ id: 'P-6', created_by: 'u', base_version_id: v1, candidate: { model: 'qwen-72b' } }]);
      const e = m.get('P-6')!;
      expect(e.refusals.map((r) => r.code)).toContain('holdout_rerun');
      expect(e.runCount).toBe(2); expect(e.outcome).toBe('inconclusive');
    } finally { c.release(); }
  });
});
