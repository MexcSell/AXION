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
  q(`insert into agent_version_proposals(id, tenant_id, agent_id, base_version_id, base_sha, candidate, candidate_sha, title, created_by, status) values ($1,$2,$3,$4,'h',$7::jsonb,$5,'t','u',$6)`, [id, tenant, agent, base, sha, status, JSON.stringify({ model: 'qwen-72b', skills: [sha], tools: [] })]);
const propC = (id: string, agent: string, base: string, sha: string, candidate: unknown) =>
  q(`insert into agent_version_proposals(id, tenant_id, agent_id, base_version_id, base_sha, candidate, candidate_sha, title, created_by) values ($1,'t-1',$2,$3,'h',$4::jsonb,$5,'t','u')`, [id, agent, base, JSON.stringify(candidate), sha]);
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

// ---- item 4 ---------------------------------------------------------------------------------------------------------------
import { hashDataset } from '../src/evolution/verdict-v2.ts';
let n4 = 0;
async function freeze(cases: Array<{ id: string; input: string; expected?: string }>, client?: pg.PoolClient) {
  const ds = 'N-' + ++n4;
  const db = client ?? s.pool;
  await db.query(`insert into eval_datasets(id, tenant_id, name, split) values ($1,'t-1',$1,'dev')`, [ds]);
  for (const c of cases) await db.query(`insert into eval_cases(dataset_id, case_id, input, expected) values ($1,$2,$3::jsonb,$4::jsonb)`, [ds, c.id, c.input, c.expected ?? '1']);
  try { return { frozen: true as const, ds, sha: (await db.query(`select eval_freeze_dataset($1) as sha`, [ds])).rows[0].sha as string }; }
  catch (e) { return { frozen: false as const, ds, msg: (e as Error).message }; }
}
const storedCases = async (ds: string) => (await q(`select case_id as "caseId", input, expected from eval_cases where dataset_id=$1`, [ds])).rows;
const rnd4 = (a: number) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

describe('item 4: 16 and 17 digit floats freeze only when JS and SQL render them identically', () => {
  it.each(['0.30000000000000004', '0.8571428571428571', '123456789012345.5', '0.1', '0.14285714285714285', '[0.1,0.2,0.30000000000000004]', '{"score":0.6666666666666666}', '-0.30000000000000004', '1234567890123456', '0.000001', '999999999999999.9'])('%s freezes and the hash equals hashDataset', async (v) => {
    const r = await freeze([{ id: 'a', input: v }, { id: 'b', input: '1', expected: v }]);
    expect(r.frozen, r.frozen ? '' : r.msg).toBe(true);
    if (r.frozen) expect(r.sha).toBe(hashDataset(await storedCases(r.ds)));
  });
  it.each(['0.3000000000000000444', '0.1234567890123456789', '0.30000000000000005', '9007199254740993', '12345678901234567', '1e21', '1e-7', '5e-324', '1e400', '[0.30000000000000004,0.3000000000000000444]'])('%s is refused: JS would print a different number', async (v) => {
    const r = await freeze([{ id: 'a', input: v }]);
    expect(r.frozen).toBe(false);
    if (!r.frozen) expect(r.msg).toMatch(/canonical form/);
  });
  it('property: 2000 doubles from random bit patterns, printed the way JS prints them, all freeze and all hash like hashDataset', async () => {
    const rnd = rnd4(53);
    const buf = new DataView(new ArrayBuffer(8));
    const doubles: number[] = [];
    while (doubles.length < 2000) {
      buf.setUint32(0, Math.floor(rnd() * 2 ** 32)); buf.setUint32(4, Math.floor(rnd() * 2 ** 32));
      const x = buf.getFloat64(0);
      if (Number.isFinite(x) && Math.abs(x) >= 1e-6 && Math.abs(x) < 2 ** 53) doubles.push(x);
    }
    // plus every digit count, small and "nice" values, and neighbours of powers of two
    for (let i = 0; i < 200; i++) doubles.push(rnd() * 10 ** Math.floor(rnd() * 15), 1 / (3 + i), (i + 1) / 7, 2 ** (i % 52) * (1 + Number.EPSILON * (i % 5)));
    for (let off = 0; off < doubles.length; off += 100) {
      const chunk = doubles.slice(off, off + 100);
      const r = await freeze(chunk.map((x, i) => ({ id: 'k' + String(i).padStart(3, '0'), input: JSON.stringify(x) })));
      expect(r.frozen, r.frozen ? '' : `${r.msg} (values ${chunk.slice(0, 3)}...)`).toBe(true);
      if (r.frozen) expect(r.sha).toBe(hashDataset(await storedCases(r.ds)));
    }
  }, 120_000);
  it('property: random 15-18 digit decimals are either refused or hash like hashDataset (both sides exercised)', async () => {
    const rnd = rnd4(54);
    let frozen = 0, refused = 0;
    for (let i = 0; i < 300; i++) {
      const digits = 15 + Math.floor(rnd() * 4);
      let m = ''; for (let d = 0; d < digits; d++) m += Math.floor(rnd() * 10);
      const text = '0.' + m.replace(/0+$/, '1');
      const r = await freeze([{ id: 'a', input: text }]);
      if (r.frozen) { frozen++; expect(r.sha, text).toBe(hashDataset(await storedCases(r.ds))); } else { refused++; expect(r.msg).toMatch(/canonical form/); }
    }
    expect(frozen).toBeGreaterThan(30); expect(refused).toBeGreaterThan(30);
  }, 120_000);
  it('the evaluation hash is stable: a fixed dataset keeps the hash the c47 code produced', async () => {
    const r = await freeze([{ id: 'a', input: '{"t":"x","n":1.5}', expected: '[1,2]' }, { id: 'b', input: '0.25', expected: '"é"' }]);
    const known = 'ca2fc75e6d297682b9124523bafc1258bda759408aea1d5b9ae65893db644989';
    expect(r.frozen && r.sha).toBe(known);
    expect(hashDataset([{ caseId: 'a', input: { n: 1.5, t: 'x' }, expected: [1, 2] }, { caseId: 'b', input: 0.25, expected: 'é' }])).toBe(known);
  });
  it('a session setting that changes how the database prints floats cannot make a wrong hash: it refuses or matches', async () => {
    const c = await s.pool.connect();
    try {
      for (const setting of ['-3', '0', '1', '3']) {
        await c.query(`set extra_float_digits = ${setting}`);
        const r = await freeze([{ id: 'a', input: '0.30000000000000004' }, { id: 'b', input: '0.1' }], c);
        if (r.frozen) expect(r.sha, setting).toBe(hashDataset((await c.query(`select case_id as "caseId", input, expected from eval_cases where dataset_id=$1`, [r.ds])).rows));
        else expect(r.msg).toMatch(/canonical form/);
      }
    } finally { await c.query('reset extra_float_digits'); c.release(); }
  });
  it('the guard trigger applies the same rule to a raw UPDATE freeze', async () => {
    await q(`insert into eval_datasets(id, tenant_id, name, split) values ('N-RAW','t-1','n','dev')`);
    await q(`insert into eval_cases(dataset_id, case_id, input, expected) values ('N-RAW','a','0.3000000000000000444','1')`);
    await expect(q(`update eval_datasets set frozen_at = now(), content_sha256 = $1 where id='N-RAW'`, ['a'.repeat(64)])).rejects.toThrow(/canonical form|hash/);
  });
});

// ---- item 5 ---------------------------------------------------------------------------------------------------------------
let n5 = 0;
/** dev and holdout datasets from raw inputs (case ids c01..), the candidate run on dev, base and candidate on the holdout; returns the refusal codes. */
async function reuseScenario(devInputs: string[], hoInputs: string[], opts: { devIds?: string[] } = {}) {
  const id = ++n5, dev = 'RU-D' + id, ho = 'RU-H' + id, pid = 'RU-P' + id;
  const mk = async (ds: string, split: string, inputs: string[], ids?: string[]) => {
    await q(`insert into eval_datasets(id, tenant_id, name, split) values ($1,'t-1',$1,$2)`, [ds, split]);
    for (const [i, inp] of inputs.entries()) await q(`insert into eval_cases(dataset_id, case_id, input, expected) values ($1,$2,$3::jsonb,$4::jsonb)`, [ds, ids?.[i] ?? 'c' + String(i + 1).padStart(2, '0'), inp, JSON.stringify(id)]); // c70: `expected` differs per scenario, because the same holdout CONTENT can host only one base run per version; the inputs under test are unchanged
    await q(`select eval_freeze_dataset($1)`, [ds]);
  };
  await mk(dev, 'dev', devInputs, opts.devIds); await mk(ho, 'holdout', hoInputs);
  await prop(pid, 'a-1', v1, 'sha-RU' + id);
  const base = hoInputs.map(() => 40), cand = hoInputs.map((_, i) => 70 + (i % 3));
  await addRun(s.pool, { id: 'RU-d' + id, datasetId: dev, proposalId: pid, scores: devInputs.map(() => 80), caseIds: opts.devIds, judge: 'qwen-max', evaluator: 'ev-b' });
  await addRun(s.pool, { id: 'RU-b' + id, datasetId: ho, versionId: v1, scores: base, judge: 'qwen-max', evaluator: 'ev-b' });
  await addRun(s.pool, { id: 'RU-c' + id, datasetId: ho, proposalId: pid, scores: cand, judge: 'qwen-max', evaluator: 'ev-b' });
  const c = await s.pool.connect();
  try { const e = (await loadEvaluations(c, 't-1', [{ id: pid, created_by: 'u', base_version_id: v1, candidate: { model: 'claude-sonnet-4' } }])).get(pid)!; return { codes: e.refusals.map((r) => r.code), outcome: e.outcome, datasetId: e.datasetId, ho }; }
  finally { c.release(); }
}
const long = (i: number) => JSON.stringify({ prompt: 'Summarise the quarterly report for region ' + i });
const longs = (n: number, off = 0) => Array.from({ length: n }, (_, i) => long(i + off));

describe('item 5: dev_holdout_reuse needs real overlap, not a generic shared input', () => {
  it('true positive: every case shared', async () => {
    const r = await reuseScenario(longs(12), longs(12));
    expect(r.codes).toContain('dev_holdout_reuse'); expect(r.outcome).toBe('inconclusive');
  });
  it('true positive: a quarter of the holdout shared, with the same ids', async () => {
    const r = await reuseScenario([...longs(3), ...longs(9, 100)], [...longs(3), ...longs(9, 200)]);
    expect(r.codes).toContain('dev_holdout_reuse');
  });
  it('true positive: the same long inputs under renumbered case ids', async () => {
    const ids = Array.from({ length: 12 }, (_, i) => 'z' + String(i).padStart(2, '0'));
    const r = await reuseScenario(longs(12), longs(12), { devIds: ids });
    expect(r.codes).toContain('dev_holdout_reuse');
  });
  it.each([['1'], ['{}'], ['"ok"'], ['null'], ['{"q":1}'], ['"What is 2+2?"']])('a generic shared input %s on every case is not reuse', async (g) => {
    const r = await reuseScenario(Array.from({ length: 12 }, () => g), Array.from({ length: 12 }, () => g));
    expect(r.codes).not.toContain('dev_holdout_reuse'); expect(r.outcome).toBe('verified_better');
  });
  it('one shared long input out of twelve is below the minimum overlap', async () => {
    const r = await reuseScenario([long(0), ...longs(11, 100)], [long(0), ...longs(11, 200)]);
    expect(r.codes).not.toContain('dev_holdout_reuse'); expect(r.outcome).toBe('verified_better');
  });
  it('disjoint datasets are clean', async () => {
    const r = await reuseScenario(longs(12), longs(12, 500));
    expect(r.codes).not.toContain('dev_holdout_reuse'); expect(r.outcome).toBe('verified_better');
  });
});


// ---- fix round (review c53-review.md) -------------------------------------------------------------------------------------
describe('F1: the holdout key comes from the canonical config, not from the sha text', () => {
  beforeAll(async () => {
    await makeDataset(s.pool, { id: 'H-F1', split: 'holdout', cases: 3 });
    await propC('F1-A', 'a-1', v1, 'f1a', { model: 'claude-sonnet-4', skills: ['a', 'b'], tools: ['t'] });
    await propC('F1-B', 'a-1', v1, 'f1b', { model: 'claude-sonnet-4', skills: ['b', 'a'], tools: ['t'] });          // the same set, other order
    await propC('F1-C', 'a-1', v1, 'f1c', { model: 'Claude-Sonnet-4 ', skills: ['a', 'b', 'a'], tools: ['t'] });    // model case, spaces, a duplicate
    await propC('F1-D', 'a-1', v1, 'F1A', { model: 'claude-sonnet-4', skills: ['a', 'b'], tools: ['t'] });         // sha in another case (raw writer)
    await propC('F1-E', 'a-1', v1, 'f1e', { model: 'claude-sonnet-4', skills: ['a', 'b', 'c'], tools: ['t'] });    // really different
    await run('F1-R1', 'H-F1', { proposal: 'F1-A' });
  });
  it('the same skills in another order get the same key', async () => { await expect(run('F1-R2', 'H-F1', { proposal: 'F1-B' })).rejects.toThrow(/holdout_rerun/); });
  it('a model name in another case (or with spaces) and a repeated skill get the same key', async () => { await expect(run('F1-R3', 'H-F1', { proposal: 'F1-C' })).rejects.toThrow(/holdout_rerun/); });
  it('a sha spelt in another case cannot make a new key', async () => { await expect(run('F1-R4', 'H-F1', { proposal: 'F1-D' })).rejects.toThrow(/holdout_rerun/); });
  it('a different config is still its own key', async () => { await run('F1-R5', 'H-F1', { proposal: 'F1-E' }); });
});

describe('F2: a proposal\'s key fields cannot change once it exists', () => {
  it.each([
    ['candidate_sha', `candidate_sha = 'fresh'`], ['candidate', `candidate = '{"model":"x","skills":[],"tools":[]}'::jsonb`], ['agent_id', `agent_id = 'a-2'`],
    ['tenant_id', `tenant_id = 't-2'`], ['base_sha', `base_sha = 'zz'`],
  ])('%s is immutable, so a second run cannot be bought by editing it', async (_n, set) => {
    await makeDataset(s.pool, { id: 'H-F2' + _n, split: 'holdout', cases: 3 });
    await prop('F2-' + _n, 'a-1', v1, 'f2-' + _n);
    await run('F2R-' + _n, 'H-F2' + _n, { proposal: 'F2-' + _n });
    await expect(q(`update agent_version_proposals set ${set} where id='F2-${_n}'`)).rejects.toThrow(/immutable/);
    await expect(run('F2R2-' + _n, 'H-F2' + _n, { proposal: 'F2-' + _n })).rejects.toThrow(/holdout_rerun/);
  });
  it('base_version_id is immutable too', async () => { await expect(q(`update agent_version_proposals set base_version_id = $1 where id='F2-candidate_sha'`, [v2])).rejects.toThrow(/immutable/); });
  it('status and the decision fields can still change', async () => {
    await q(`update agent_version_proposals set status='withdrawn', decided_by='u', decided_at=now(), note='n' where id='F2-candidate_sha'`);
  });
});

describe('F3: a run cannot be finished incomplete, whatever path finishes it', () => {
  it('a plain UPDATE of finished_at on a run with missing results is refused', async () => {
    await makeDataset(s.pool, { id: 'H-F3', split: 'holdout', cases: 3 });
    await prop('F3-P', 'a-1', v1, 'f3p');
    await run('F3-R', 'H-F3', { proposal: 'F3-P' });
    await expect(q(`update eval_runs set finished_at = now() where id='F3-R'`)).rejects.toThrow(/run_incomplete/);
    expect((await q(`select eval_run_state('F3-R') s`)).rows[0].s).toBe('open');
  });
  it('a plain UPDATE works once every result is there, and eval_finish_run still does too', async () => {
    for (const c of ['c01', 'c02', 'c03']) await res('F3-R', c, 1, 10);
    await q(`update eval_runs set finished_at = now() where id='F3-R'`);
    expect((await q(`select eval_run_state('F3-R') s`)).rows[0].s).toBe('finished');
  });
});

describe('F4: dev_holdout_reuse counts distinct shared inputs and exempts only repeated (generic) ones', () => {
  const short = (n: number, off = 0) => Array.from({ length: n }, (_, i) => JSON.stringify(`${i + 11 + off}*7`));
  it('30 distinct short arithmetic prompts copied to the holdout are flagged', async () => {
    const r = await reuseScenario(short(30), short(30)); expect(r.codes).toContain('dev_holdout_reuse');
  });
  it('8 distinct short sentiment inputs copied to the holdout are flagged', async () => {
    const w = ['great product', 'awful', 'fine', 'love it', 'hate it', 'meh', 'superb', 'broken'].map((x) => JSON.stringify(x));
    const r = await reuseScenario(w, w); expect(r.codes).toContain('dev_holdout_reuse');
  });
  it('9 of 100 long holdout inputs copied from dev are flagged (an absolute floor for large holdouts)', async () => {
    const r = await reuseScenario([...longs(9), ...longs(91, 1000)], [...longs(9), ...longs(91, 2000)]); expect(r.codes).toContain('dev_holdout_reuse');
  });
  it('a generic input repeated across cases is one input and stays unflagged', async () => {
    const r = await reuseScenario(Array.from({ length: 12 }, () => '"What is 2+2?"'), Array.from({ length: 12 }, () => '"What is 2+2?"')); expect(r.codes).not.toContain('dev_holdout_reuse');
  });
  it('a repeated generic input mixed with a few distinct unshared ones stays unflagged', async () => {
    const r = await reuseScenario(['"ok"', '"ok"', '"ok"', ...longs(9, 300)], ['"ok"', '"ok"', '"ok"', ...longs(9, 400)]); expect(r.codes).not.toContain('dev_holdout_reuse');
  });
});

describe('F5: the loser of a race for the same holdout slot gets the named code', () => {
  it('two concurrent startRun calls: one wins, the other fails with holdout_rerun (not a bare 23505)', async () => {
    await makeDataset(s.pool, { id: 'H-F5', split: 'holdout', cases: 2 });
    await prop('F5-P', 'a-1', v1, 'f5p');
    const c1 = await s.pool.connect(), c2 = await s.pool.connect();
    try {
      await c1.query('begin'); await c2.query('begin');
      const base = { tenantId: 't-1', k: 1, evaluatorId: 'ev', datasetId: 'H-F5', proposalId: 'F5-P', judgeLabel: 'claude-judge' };
      await startRun(c1, { ...base, id: 'F5-1' });
      const second = startRun(c2, { ...base, id: 'F5-2' }).then(() => 'won', (e: Error) => e);
      await new Promise((r) => setTimeout(r, 300)); // c2 is now waiting on the unique index
      await c1.query('commit');
      const lost = await second;
      expect(lost).toBeInstanceOf(Error);
      expect((lost as Error).message).toMatch(/holdout_rerun/);
      expect((lost as { code?: string }).code).toBe('holdout_rerun');
      await c2.query('rollback');
    } finally { c1.release(); c2.release(); }
  });
});
