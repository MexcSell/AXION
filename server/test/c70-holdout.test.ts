import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type pg from 'pg';
import { makeSchema } from './helpers.ts';
import { migrate, listMigrations } from '../src/migrate.ts';
import { makeDataset, addRun } from './eval-fixtures.ts';
import { loadEvaluations } from '../src/evolution/proposal-evidence.ts';
import { recordRegrade, mapRunInsertError, existingRun } from '../src/evolution/eval-runs.ts';

// c70 (E1d): holdout shopping gaps left by the c53 and c61 reviews. Records only: nothing here runs an evaluation or calls a model.
// Out of scope and still open (see the report): variant B on a holdout after A's result was seen; a re-created identical base version.
let s: Awaited<ReturnType<typeof makeSchema>>;
let v1 = '';
const q = (sql: string, p: unknown[] = []) => s.pool.query(sql, p);
const cx = async <T>(fn: (c: pg.PoolClient) => Promise<T>) => { const c = await s.pool.connect(); try { return await fn(c); } finally { c.release(); } };
const propC = (id: string, candidate: unknown, by = 'u', base = v1) =>
  q(`insert into agent_version_proposals(id, tenant_id, agent_id, base_version_id, base_sha, candidate, candidate_sha, title, created_by) values ($1,'t-1','a-1',$2,'h',$3::jsonb,$1,'t',$4)`, [id, base, JSON.stringify(candidate), by]);
const run = (id: string, ds: string, o: { version?: string; proposal?: string; tenant?: string } = {}) =>
  q(`insert into eval_runs(id, tenant_id, dataset_id, subject_version_id, subject_proposal_id, k, judge_model_family, evaluator_id) values ($1,$2,$3,$4,$5,1,'claude-judge','ev')`, [id, o.tenant ?? 't-1', ds, o.version ?? null, o.proposal ?? null]);
const G1 = { name: 'rubric', version: '1' }, G2 = { name: 'rubric', version: '2' };
const cand = (over: Record<string, unknown> = {}) => ({ model: 'claude-sonnet-4', skills: ['a', 'b'], tools: ['t'], ...over });
const canon = async (c: unknown) => (await q(`select eval_canon_config($1::jsonb) as k`, [JSON.stringify(c)])).rows[0].k as string;

beforeAll(async () => {
  s = await makeSchema();
  await q(`insert into tenants(id,name) values ('t-1','T'),('t-2','Other') on conflict do nothing`);
  await q(`insert into users(id,tenant_id,name,name_key,pass_hash,role,status) values ('ev-b','t-1','Ev','evb','h','member','approved'), ('u-prop','t-1','Prop','prop','h','member','approved'), ('u-other','t-1','Oth','oth','h','member','approved')`);
  await q(`insert into agent_definitions(id, tenant_id, name, role, dept, duty, created_by) values ('a-1','t-1','A','r','D','duty','u'),('a-2','t-1','B','r','D','duty2','u')`);
  v1 = (await q(`insert into agent_versions(agent_id, seq, label, model, prompt_hash, created_by) values ('a-1',1,'v1','m','h','u') returning id`)).rows[0].id;
});
afterAll(async () => { await s.drop(); });

describe('1. the holdout limit is keyed on the dataset CONTENT too', () => {
  beforeAll(async () => {
    await makeDataset(s.pool, { id: 'CH-A', split: 'holdout', cases: 5, inputTag: 'same-content' });
    await makeDataset(s.pool, { id: 'CH-B', split: 'holdout', cases: 5, inputTag: 'same-content' }); // the same cases under a NEW dataset id
    await makeDataset(s.pool, { id: 'CH-C', split: 'holdout', cases: 5, inputTag: 'other-content' });
    await propC('CH-P1', cand()); await propC('CH-P2', cand({ skills: ['a', 'b', 'c'] }));
  });
  it('probe: the two datasets really hold the same content', async () => {
    const h = (await q(`select id, content_sha256 from eval_datasets where id in ('CH-A','CH-B','CH-C') order by id`)).rows;
    expect(h[0].content_sha256).toBe(h[1].content_sha256); expect(h[0].content_sha256).not.toBe(h[2].content_sha256);
  });
  it('the same candidate config cannot run again on the same content under another dataset id', async () => {
    await run('CH-R1', 'CH-A', { proposal: 'CH-P1' });
    await expect(run('CH-R2', 'CH-B', { proposal: 'CH-P1' })).rejects.toThrow(/holdout_rerun/);
  });
  it('a re-proposal of the same config cannot either', async () => {
    await propC('CH-P1b', cand({ model: 'CLAUDE-sonnet-4' }));
    await expect(run('CH-R2b', 'CH-B', { proposal: 'CH-P1b' })).rejects.toThrow(/holdout_rerun/);
  });
  it('the base version is limited the same way', async () => {
    await run('CH-B1', 'CH-A', { version: v1 });
    await expect(run('CH-B2', 'CH-B', { version: v1 })).rejects.toThrow(/holdout_rerun/);
  });
  it('controls: other content, another config, another tenant stay allowed', async () => {
    await run('CH-R3', 'CH-C', { proposal: 'CH-P1' });
    await run('CH-R4', 'CH-B', { proposal: 'CH-P2' });
    await makeDataset(s.pool, { id: 'CH-T2', tenant: 't-2', split: 'holdout', cases: 5, inputTag: 'same-content' });
    await q(`insert into agent_definitions(id, tenant_id, name, role, dept, duty, created_by) values ('b-1','t-2','A','r','D','duty','u')`);
    const v = (await q(`insert into agent_versions(agent_id, seq, label, model, prompt_hash, created_by) values ('b-1',1,'v1','m','h','u') returning id`)).rows[0].id;
    await run('CH-T2B', 'CH-T2', { tenant: 't-2', version: v });
  });
  it('a dev dataset with the same content is not limited', async () => {
    await makeDataset(s.pool, { id: 'CH-D1', split: 'dev', cases: 5, inputTag: 'same-content' });
    await makeDataset(s.pool, { id: 'CH-D2', split: 'dev', cases: 5, inputTag: 'same-content' });
    await run('CH-DR1', 'CH-D1', { proposal: 'CH-P2' }); await run('CH-DR2', 'CH-D2', { proposal: 'CH-P2' });
  });
  it('the loader counts the runs across datasets of the same content as well (defence in depth, guard switched off)', async () => {
    await makeDataset(s.pool, { id: 'CL-A', split: 'holdout', cases: 12, inputTag: 'loader-content' });
    await makeDataset(s.pool, { id: 'CL-B', split: 'holdout', cases: 12, inputTag: 'loader-content' });
    await propC('CL-P', cand({ skills: ['loader'] }), 'u');
    const ten = Array(12).fill(70);
    await addRun(s.pool, { id: 'CL-b', datasetId: 'CL-A', versionId: v1, scores: Array(12).fill(40), judge: 'qwen-max', evaluator: 'ev-b' });
    await addRun(s.pool, { id: 'CL-c1', datasetId: 'CL-A', proposalId: 'CL-P', scores: ten, judge: 'qwen-max', evaluator: 'ev-b' });
    await q(`alter table eval_runs disable trigger eval_runs_guard`);
    try { await addRun(s.pool, { id: 'CL-c2', datasetId: 'CL-B', proposalId: 'CL-P', scores: ten, judge: 'qwen-max', evaluator: 'ev-b' }); }
    finally { await q(`alter table eval_runs enable trigger eval_runs_guard`); }
    const e = await cx(async (c) => (await loadEvaluations(c, 't-1', [{ id: 'CL-P', created_by: 'u', base_version_id: v1, candidate: cand({ skills: ['loader'] }) }])).get('CL-P')!);
    expect(e.refusals.map((r) => r.code)).toContain('holdout_rerun'); expect(e.runCount).toBe(2); expect(e.outcome).toBe('inconclusive');
  });
  it('existingRun finds the run to resume on the same content under another dataset id', async () => {
    const r = await cx((c) => existingRun(c, { tenantId: 't-1', datasetId: 'CH-B', proposalId: 'CH-P1' }));
    expect(r?.id).toBe('CH-R1');
    expect((await cx((c) => existingRun(c, { tenantId: 't-1', datasetId: 'CH-B', versionId: v1 })))?.id).toBe('CH-B1');
  });
  it('fix round: renaming the case ids does not buy a fresh slot (the content key ignores case ids, and order)', async () => {
    const mk = async (id: string, ids: string[]) => {
      await q(`insert into eval_datasets(id, tenant_id, name, split) values ($1,'t-1',$1,'holdout')`, [id]);
      for (const [i, cid] of ids.entries()) await q(`insert into eval_cases(dataset_id, case_id, input, expected) values ($1,$2,$3::jsonb,$4::jsonb)`, [id, cid, JSON.stringify({ q: i, text: 'rename probe ' + i }), JSON.stringify({ a: i })]);
      await q(`select eval_freeze_dataset($1)`, [id]);
    };
    const ids = Array.from({ length: 10 }, (_, i) => 'c' + (i + 1));
    await mk('RN-0', ids); await mk('RN-1', ids.map((c) => 'x-' + c)); await mk('RN-2', [...ids].reverse().map((c) => 'y-' + c));
    const sha = (await q(`select id, content_sha256 from eval_datasets where id in ('RN-0','RN-1') order by id`)).rows;
    expect(sha[0].content_sha256).not.toBe(sha[1].content_sha256); // the dataset's own hash (c47 binding) still covers case ids
    await propC('RN-P', cand({ skills: ['rn'] }));
    await run('RN-R0', 'RN-0', { proposal: 'RN-P' }); await run('RN-B0', 'RN-0', { version: v1 }).catch(() => undefined);
    await expect(run('RN-R1', 'RN-1', { proposal: 'RN-P' })).rejects.toThrow(/holdout_rerun/);
    await expect(run('RN-R2', 'RN-2', { proposal: 'RN-P' })).rejects.toThrow(/holdout_rerun/);
    await expect(run('RN-R3', 'RN-1', { proposal: 'RN-P' })).rejects.toThrow(/never get a base run/);
  });
  it('a lost race on the content key maps to the named refusal too', () => {
    expect(mapRunInsertError({ code: '23505', constraint: 'eval_runs_holdout_content_once' })).toMatchObject({ code: 'holdout_rerun' });
  });
});

describe('2. a re-grade by the proposal author on the BASE run is refused in the database', () => {
  const all12 = (v: number) => Array.from({ length: 12 }, (_, i) => ({ caseId: 'c' + String(i + 1).padStart(2, '0'), attempt: 1, newScore: v }));
  it('the author of a proposal whose base version this is cannot re-grade the base run (regrader_is_author)', async () => {
    await makeDataset(s.pool, { id: 'RG-H', split: 'holdout', cases: 12 });
    await propC('RG-P', cand({ skills: ['rg'] }), 'u-prop');
    await addRun(s.pool, { id: 'RG-B', datasetId: 'RG-H', versionId: v1, scores: Array(12).fill(90), grader: G1, judge: 'claude-judge', evaluator: 'ev-b' });
    await addRun(s.pool, { id: 'RG-C', datasetId: 'RG-H', proposalId: 'RG-P', scores: Array(12).fill(75), grader: G2, judge: 'claude-judge', evaluator: 'ev-b' });
    await cx(async (c) => { await expect(recordRegrade(c, { id: 'RG-X', tenantId: 't-1', runId: 'RG-B', to: G2, by: 'u-prop', cases: all12(40) })).rejects.toThrow(/regrader_is_author/); });
    expect((await q(`select count(*)::int n from eval_regrades where id='RG-X'`)).rows[0].n).toBe(0);
    // and by raw SQL, past the helper
    await expect(q(`insert into eval_regrades(id, tenant_id, run_id, from_grader_name, from_grader_version, to_grader_name, to_grader_version, created_by) values ('RG-Y','t-1','RG-B','rubric','1','rubric','2','u-prop')`)).rejects.toThrow(/regrader_is_author/);
  });
  it('control: someone who wrote no proposal on that base can still re-grade it', async () => {
    await cx(async (c) => { await recordRegrade(c, { id: 'RG-Z', tenantId: 't-1', runId: 'RG-B', to: G2, by: 'u-other', cases: all12(40) }); });
  });
});

describe('3. eval_canon_config collapses Unicode whitespace, drops empty skills, and normalises NFC', () => {
  const base = cand({ model: 'claude-sonnet-4', skills: ['a b', 'c'], tools: ['t'] });
  it.each([
    ['a leading tab on the model', { model: '\tclaude-sonnet-4' }],
    ['a non-breaking space around the model', { model: ' claude-sonnet-4 ' }],
    ['an ideographic space in a skill name', { skills: ['a　b', 'c'] }],
    ['a double space inside a skill name', { skills: ['a  b', 'c'] }],
    ['a tab between words of a skill', { skills: ['a\tb', 'c'] }],
    ['a zero-width space around a skill', { skills: ['​a b', 'c'] }],
    ['an empty-string skill added', { skills: ['a b', 'c', ''] }],
    ['a whitespace-only skill added', { skills: ['a b', 'c', '  \t'] }],
  ])('%s is the same config', async (_n, over) => { expect(await canon({ ...base, ...over })).toBe(await canon(base)); });
  it('NFC and NFD spellings of a skill are the same config', async () => {
    expect(await canon(cand({ skills: ['café'] }))).toBe(await canon(cand({ skills: ['café'] })));
  });
  it('really different configs stay different', async () => {
    expect(await canon(cand({ skills: ['a', 'b'] }))).not.toBe(await canon(cand({ skills: ['a', 'b', 'c'] })));
    expect(await canon(cand({ skills: ['ab'] }))).not.toBe(await canon(cand({ skills: ['a b'] })));
  });
  it('end to end: a re-proposal that differs only by a tab or NFD buys no second holdout run', async () => {
    await makeDataset(s.pool, { id: 'CN-H', split: 'holdout', cases: 4 });
    await propC('CN-1', cand({ skills: ['café', 'x'] })); await propC('CN-2', cand({ model: '\tclaude-sonnet-4', skills: ['café', 'x', ''] }));
    await run('CN-R1', 'CN-H', { proposal: 'CN-1' });
    await expect(run('CN-R2', 'CN-H', { proposal: 'CN-2' })).rejects.toThrow(/holdout_rerun/);
  });
});

describe('4. the dev_holdout_reuse repeat exemption covers short inputs only', () => {
  let n = 0;
  async function scenario(devInputs: string[], hoInputs: string[]) {
    const id = ++n, dev = 'RX-D' + id, ho = 'RX-H' + id, pid = 'RX-P' + id;
    const mk = async (ds: string, split: string, inputs: string[]) => {
      await q(`insert into eval_datasets(id, tenant_id, name, split) values ($1,'t-1',$1,$2)`, [ds, split]);
      for (const [i, inp] of inputs.entries()) await q(`insert into eval_cases(dataset_id, case_id, input, expected) values ($1,$2,$3::jsonb,$4::jsonb)`, [ds, 'c' + String(i + 1).padStart(2, '0'), inp, JSON.stringify(id)]);
      await q(`select eval_freeze_dataset($1)`, [ds]);
    };
    await mk(dev, 'dev', devInputs); await mk(ho, 'holdout', hoInputs);
    await propC(pid, cand({ skills: ['rx' + id] }));
    await addRun(s.pool, { id: 'RX-d' + id, datasetId: dev, proposalId: pid, scores: devInputs.map(() => 80), judge: 'qwen-max', evaluator: 'ev-b' });
    await addRun(s.pool, { id: 'RX-b' + id, datasetId: ho, versionId: v1, scores: hoInputs.map(() => 40), judge: 'qwen-max', evaluator: 'ev-b' });
    await addRun(s.pool, { id: 'RX-c' + id, datasetId: ho, proposalId: pid, scores: hoInputs.map((_, i) => 70 + (i % 3)), judge: 'qwen-max', evaluator: 'ev-b' });
    const e = await cx(async (c) => (await loadEvaluations(c, 't-1', [{ id: pid, created_by: 'u', base_version_id: v1, candidate: cand({ skills: ['rx' + id] }) }])).get(pid)!);
    return { codes: e.refusals.map((r) => r.code), outcome: e.outcome };
  }
  const long = (i: number) => JSON.stringify({ prompt: 'Summarise the quarterly report for region ' + i });
  const dup = (xs: string[]) => xs.flatMap((x) => [x, x]);
  it('review probe: 12 long inputs, each twice, in dev and in the holdout, are flagged', async () => {
    const xs = Array.from({ length: 12 }, (_, i) => long(i));
    const r = await scenario(dup(xs), dup(xs));
    expect(r.codes).toContain('dev_holdout_reuse'); expect(r.outcome).toBe('inconclusive');
  });
  it('long inputs repeated only on the holdout side are flagged too', async () => {
    const xs = Array.from({ length: 12 }, (_, i) => long(i));
    expect((await scenario(xs, dup(xs))).codes).toContain('dev_holdout_reuse');
  });
  it('control: a short generic input repeated on every case stays exempt', async () => {
    const r = await scenario(Array(12).fill('"ok"'), Array(12).fill('"ok"'));
    expect(r.codes).not.toContain('dev_holdout_reuse'); expect(r.outcome).toBe('verified_better');
  });
  it('control: disjoint long repeats are clean', async () => {
    const r = await scenario(dup(Array.from({ length: 6 }, (_, i) => long(i))), dup(Array.from({ length: 6 }, (_, i) => long(i + 500))));
    expect(r.codes).not.toContain('dev_holdout_reuse');
  });
});

describe('5. an explicit grader: null legacy run (kept, c61 re-review)', () => {
  it('two runs that record no grader are unknown, never "the same": inconclusive with grader_unknown', async () => {
    await makeDataset(s.pool, { id: 'LG-H', split: 'holdout', cases: 12 });
    await propC('LG-P', cand({ skills: ['lg'] }));
    await addRun(s.pool, { id: 'LG-B', datasetId: 'LG-H', versionId: v1, scores: Array(12).fill(40), grader: null, judge: 'qwen-max', evaluator: 'ev-b' });
    await addRun(s.pool, { id: 'LG-C', datasetId: 'LG-H', proposalId: 'LG-P', scores: Array(12).fill(75), grader: null, judge: 'qwen-max', evaluator: 'ev-b' });
    expect((await q(`select grader_name from eval_runs where id in ('LG-B','LG-C')`)).rows.every((r) => r.grader_name === null)).toBe(true);
    const e = await cx(async (c) => (await loadEvaluations(c, 't-1', [{ id: 'LG-P', created_by: 'u', base_version_id: v1, candidate: cand({ skills: ['lg'] }) }])).get('LG-P')!);
    expect(e.refusals.map((r) => r.code)).toContain('grader_unknown'); expect(e.outcome).toBe('inconclusive');
  });
});

describe('migration 0052', () => {
  it('goes down and up again on a populated schema, and the older behaviour comes back on down', async () => {
    expect(listMigrations().map((m) => m.version)).toContain(52);
    const m = await makeSchema();
    try {
      const latest = Math.max(...listMigrations().map((x) => x.version));
      await m.pool.query(`insert into tenants(id,name) values ('t-1','T') on conflict do nothing`);
      await migrate(m.pool, 'down', 51);
      expect((await m.pool.query(`select eval_canon_config('{"model":" x"}'::jsonb) like '% %' as kept`)).rows[0].kept).toBe(true);
      expect(await migrate(m.pool, 'up')).toBe(latest);
      expect((await m.pool.query(`select eval_canon_config('{"model":" x"}'::jsonb) like '% %' as kept`)).rows[0].kept).toBe(false);
    } finally { await m.drop(); }
  });
  it('up on legacy data: same-content duplicate runs migrate (the first keeps the key, the later one stays NULL) and the old keys are rebuilt', async () => {
    const m = await makeSchema({ migrate: false });
    try {
      await migrate(m.pool, 'up', 51);
      const x = (sql: string, p: unknown[] = []) => m.pool.query(sql, p);
      await x(`insert into tenants(id,name) values ('t-1','T') on conflict do nothing`);
      await x(`insert into agent_definitions(id, tenant_id, name, role, dept, duty, created_by) values ('a-1','t-1','A','r','D','duty','u') on conflict do nothing`);
      const v = (await x(`insert into agent_versions(agent_id, seq, label, model, prompt_hash, created_by) values ('a-1',1,'v1','m','h','u') returning id`)).rows[0].id;
      await x(`insert into agent_version_proposals(id, tenant_id, agent_id, base_version_id, base_sha, candidate, candidate_sha, title, created_by) values ('P','t-1','a-1',$1,'h','{"model":"m","skills":["a"],"tools":[]}','s','t','u')`, [v]);
      for (const d of ['D1', 'D2']) { await makeDataset(m.pool, { id: d, split: 'holdout', cases: 3, inputTag: 'legacy' }); await x(`insert into eval_runs(id, tenant_id, dataset_id, subject_proposal_id, k, judge_model_family, evaluator_id) values ('R-'||$1,'t-1',$1,'P',1,'j','e')`, [d]); }
      expect(await migrate(m.pool, 'up')).toBe(Math.max(...listMigrations().map((y) => y.version)));
      const r = (await x(`select id, holdout_key is not null as k, holdout_content_key is not null as c from eval_runs order by id`)).rows;
      expect(r).toEqual([{ id: 'R-D1', k: true, c: true }, { id: 'R-D2', k: false, c: false }]);
      await migrate(m.pool, 'down', 51);
      expect((await x(`select count(*)::int n from eval_runs where holdout_key is not null`)).rows[0].n).toBe(2);
    } finally { await m.drop(); }
  });
});
