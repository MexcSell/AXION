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

// ---- item 2 ---------------------------------------------------------------------------------------------------------------
import { RUN_STATES, runState, missingResults, finishRun, existingRun } from '../src/evolution/eval-runs.ts';
const res = (run: string, c: string, a: number, score: number | null) => q(`insert into eval_results(run_id, case_id, attempt, score, cost_units, trace) values ($1,$2,$3,$4,1,'{"steps":[]}')`, [run, c, a, score]);

describe('item 2: resumable runs (states: open, complete, finished)', () => {
  const cx = async <T>(fn: (c: pg.PoolClient) => Promise<T>) => { const c = await s.pool.connect(); try { return await fn(c); } finally { c.release(); } };
  it('the states are explicit', () => { expect(RUN_STATES).toEqual(['open', 'complete', 'finished']); });
  it('a crashed run is open, lists what is missing, and is resumed instead of re-started', async () => {
    await makeDataset(s.pool, { id: 'H-RS', split: 'holdout', cases: 3 });
    await run('RS1', 'H-RS', { proposal: 'P-3', k: 2 });
    await res('RS1', 'c01', 1, 50); await res('RS1', 'c01', 2, 60); await res('RS1', 'c02', 1, null); // crashed here
    await expect(run('RS1-again', 'H-RS', { proposal: 'P-3' })).rejects.toThrow(/holdout_rerun.*RS1.*unfinished/);
    await cx(async (c) => {
      expect(await runState(c, 'RS1')).toBe('open');
      expect(await missingResults(c, 'RS1')).toEqual([{ caseId: 'c02', attempt: 2 }, { caseId: 'c03', attempt: 1 }, { caseId: 'c03', attempt: 2 }]);
      expect(await existingRun(c, { tenantId: 't-1', datasetId: 'H-RS', proposalId: 'P-3' })).toEqual({ id: 'RS1', state: 'open' });
    });
    await expect(res('RS1', 'c01', 1, 99)).rejects.toThrow(); // an existing attempt is not rewritten
    await res('RS1', 'c02', 2, 70); await res('RS1', 'c03', 1, 80); // resumed
  });
  it('finishing an open run is refused with run_incomplete; a complete run finishes', async () => {
    await cx(async (c) => {
      await expect(finishRun(c, 'RS1')).rejects.toThrow(/run_incomplete/);
      await res('RS1', 'c03', 2, 90);
      expect(await runState(c, 'RS1')).toBe('complete');
      await finishRun(c, 'RS1');
      expect(await runState(c, 'RS1')).toBe('finished');
    });
  });
  it('a finished run is immutable: no more results, no second finish, no changes', async () => {
    await expect(res('RS1', 'c01', 1, 1)).rejects.toThrow(/finished/);
    await cx(async (c) => {
      await expect(finishRun(c, 'RS1')).rejects.toThrow(/finished/);
      await expect(missingResults(c, 'RS1')).rejects.toThrow(/finished/);
    });
    await expect(q(`update eval_runs set finished_at = now() where id='RS1'`)).rejects.toThrow(/append-only/);
    await expect(q(`delete from eval_results where run_id='RS1'`)).rejects.toThrow(/append-only/);
    await expect(run('RS1-late', 'H-RS', { proposal: 'P-3' })).rejects.toThrow(/holdout_rerun.*RS1.*finished/);
  });
  it('an unknown run has no state, and cannot be finished', async () => {
    await cx(async (c) => {
      expect(await runState(c, 'NOPE')).toBeNull();
      await expect(finishRun(c, 'NOPE')).rejects.toThrow(/no such/);
      expect(await existingRun(c, { tenantId: 't-1', datasetId: 'H-RS', proposalId: 'P-1' })).toBeNull();
    });
  });
  it('a run with no results at all is open and lists every case and attempt', async () => {
    await makeDataset(s.pool, { id: 'H-RS0', split: 'holdout', cases: 2 });
    await run('RS0', 'H-RS0', { proposal: 'P-3' });
    await cx(async (c) => { expect(await missingResults(c, 'RS0')).toHaveLength(2); await expect(finishRun(c, 'RS0')).rejects.toThrow(/run_incomplete/); });
  });
  it('two finishers racing: exactly one finishes', async () => {
    await makeDataset(s.pool, { id: 'H-RSR', split: 'holdout', cases: 1 });
    await run('RSR', 'H-RSR', { proposal: 'P-3' }); await res('RSR', 'c01', 1, 5);
    const one = async () => cx((c) => finishRun(c, 'RSR'));
    const r = await Promise.allSettled([one(), one(), one()]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
  });
});

// ---- item 3 ---------------------------------------------------------------------------------------------------------------
import { judgeFamily, JudgeLabelError, startRun } from '../src/evolution/eval-runs.ts';

describe('item 3: judge labels are validated against the c38 vendor alias table', () => {
  it.each([['claude-sonnet-4', 'anthropic'], ['  GPT-4o ', 'openai'], ['anthropic/claude-3.5', 'anthropic'], ['us.anthropic.claude-3-opus', 'anthropic'],
    ['openrouter/openai/gpt-4o', 'openai'], ['qwen-max', 'alibaba'], ['o3-mini', 'openai'], ['meta-llama/llama-3-70b', 'meta']])('%s resolves to %s', (label, vendor) => {
    expect(judgeFamily(label)).toBe(vendor);
  });
  it.each([['sonnet', 'judge_label_unknown'], ['my-claude-proxy', 'judge_label_unknown'], ['o10x', 'judge_label_unknown'], ['judge', 'judge_label_unknown'],
    ['anthropic/gpt-4', 'judge_label_ambiguous'], ['openai/claude-3', 'judge_label_ambiguous'], ['', 'judge_label_missing'], ['   ', 'judge_label_missing']])('%j is refused as %s', (label, code) => {
    expect(() => judgeFamily(label)).toThrow(JudgeLabelError);
    try { judgeFamily(label); } catch (e) { expect((e as JudgeLabelError).code).toBe(code); }
  });
  it('null, undefined and non-strings are missing, never a default', () => {
    for (const v of [null, undefined, 42, {}] as unknown[]) { try { judgeFamily(v as string); throw new Error('no throw'); } catch (e) { expect((e as JudgeLabelError).code).toBe('judge_label_missing'); } }
  });
  const base = { tenantId: 't-1', k: 1, evaluatorId: 'ev' };
  const cx = async <T>(fn: (c: pg.PoolClient) => Promise<T>) => { const c = await s.pool.connect(); try { return await fn(c); } finally { c.release(); } };
  it('startRun refuses an unknown or ambiguous judge and writes no row', async () => {
    await makeDataset(s.pool, { id: 'H-J1', split: 'holdout', cases: 2 });
    await cx(async (c) => {
      await expect(startRun(c, { ...base, id: 'J-1', datasetId: 'H-J1', proposalId: 'P-3', judgeLabel: 'sonnet' })).rejects.toMatchObject({ code: 'judge_label_unknown' });
      await expect(startRun(c, { ...base, id: 'J-2', datasetId: 'H-J1', proposalId: 'P-3', judgeLabel: 'anthropic/gpt-4' })).rejects.toMatchObject({ code: 'judge_label_ambiguous' });
      await expect(startRun(c, { ...base, id: 'J-3', datasetId: 'H-J1', proposalId: 'P-3', judgeLabel: '' })).rejects.toMatchObject({ code: 'judge_label_missing' });
    });
    expect((await q(`select count(*)::int n from eval_runs where id in ('J-1','J-2','J-3')`)).rows[0].n).toBe(0);
  });
  it('startRun stores the trimmed label of a known judge, and a missing evaluator is refused', async () => {
    await cx(async (c) => {
      await expect(startRun(c, { ...base, id: 'J-4', datasetId: 'H-J1', proposalId: 'P-3', judgeLabel: 'claude-judge', evaluatorId: ' ' })).rejects.toThrow(/evaluator/);
      await startRun(c, { ...base, id: 'J-5', datasetId: 'H-J1', proposalId: 'P-3', judgeLabel: '  claude-judge ' });
    });
    expect((await q(`select judge_model_family j, evaluator_id e from eval_runs where id='J-5'`)).rows[0]).toEqual({ j: 'claude-judge', e: 'ev' });
  });
  it('startRun passes the holdout_rerun refusal through', async () => {
    await cx(async (c) => { await expect(startRun(c, { ...base, id: 'J-6', datasetId: 'H-J1', proposalId: 'P-3', judgeLabel: 'claude-judge' })).rejects.toThrow(/holdout_rerun/); });
  });

  // the read side fails closed on rows written by anyone else
  const load = async (p: string, model: string) => cx(async (c) => (await loadEvaluations(c, 't-1', [{ id: p, created_by: 'u', base_version_id: v1, candidate: { model } }])).get(p)!);
  const scores = (f: (i: number) => number) => Array.from({ length: 12 }, (_, i) => f(i));
  it('a stored judge label the table cannot resolve is refused by the loader', async () => {
    await makeDataset(s.pool, { id: 'H-J2', split: 'holdout', cases: 12 });
    await prop('P-J2', 'a-1', v1, 'sha-J2');
    await addRun(s.pool, { id: 'J2b', datasetId: 'H-J2', versionId: v1, scores: scores(() => 40), judge: 'qwen-max', evaluator: 'ev-b' });
    await addRun(s.pool, { id: 'J2c', datasetId: 'H-J2', proposalId: 'P-J2', scores: scores((i) => 70 + (i % 3)), judge: 'sonnet', evaluator: 'ev-b' });
    const e = await load('P-J2', 'qwen-72b');
    expect(e.outcome).toBe('inconclusive'); expect(e.refusals.map((r) => r.code)).toContain('judge_label_unknown');
  });
  it('a candidate model the table cannot resolve is refused too', async () => {
    await makeDataset(s.pool, { id: 'H-J3', split: 'holdout', cases: 12 });
    await prop('P-J3', 'a-1', v1, 'sha-J3');
    await addRun(s.pool, { id: 'J3b', datasetId: 'H-J3', versionId: v1, scores: scores(() => 40), judge: 'claude-judge', evaluator: 'ev-b' });
    await addRun(s.pool, { id: 'J3c', datasetId: 'H-J3', proposalId: 'P-J3', scores: scores((i) => 70 + (i % 3)), judge: 'claude-judge', evaluator: 'ev-b' });
    const e = await load('P-J3', 'my-private-model');
    expect(e.outcome).toBe('inconclusive'); expect(e.refusals.map((r) => r.code)).toContain('candidate_family_unknown');
  });
  it('the same vendor under another spelling is self-judging (a router or region prefix does not hide it)', async () => {
    await makeDataset(s.pool, { id: 'H-J4', split: 'holdout', cases: 12 });
    await prop('P-J4', 'a-1', v1, 'sha-J4');
    await addRun(s.pool, { id: 'J4b', datasetId: 'H-J4', versionId: v1, scores: scores(() => 40), judge: 'qwen-max', evaluator: 'ev-b' });
    await addRun(s.pool, { id: 'J4c', datasetId: 'H-J4', proposalId: 'P-J4', scores: scores((i) => 70 + (i % 3)), judge: 'us.anthropic.claude-3-opus', evaluator: 'ev-b' });
    const e = await load('P-J4', 'claude-sonnet-4');
    expect(e.refusals.map((r) => r.code)).toContain('self_judging');
  });
  it('a judge of another vendor with a known candidate family stays verified better', async () => {
    await makeDataset(s.pool, { id: 'H-J5', split: 'holdout', cases: 12 });
    await prop('P-J5', 'a-1', v1, 'sha-J5');
    await addRun(s.pool, { id: 'J5b', datasetId: 'H-J5', versionId: v1, scores: scores(() => 40), judge: 'qwen-max', evaluator: 'ev-b' });
    await addRun(s.pool, { id: 'J5c', datasetId: 'H-J5', proposalId: 'P-J5', scores: scores((i) => 70 + (i % 3)), judge: 'openrouter/openai/gpt-4o', evaluator: 'ev-b' });
    const e = await load('P-J5', 'claude-sonnet-4');
    expect(e.refusals).toEqual([]); expect(e.outcome).toBe('verified_better');
  });
});
