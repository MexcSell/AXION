import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type pg from 'pg';
import { makeSchema } from './helpers.ts';
import { migrate, listMigrations } from '../src/migrate.ts';
import { makeDataset, addRun } from './eval-fixtures.ts';
import { loadEvaluations } from '../src/evolution/proposal-evidence.ts';
import { verdictV2, hashDataset, type CaseRuns } from '../src/evolution/verdict-v2.ts';
import { startRun, recordRegrade } from '../src/evolution/eval-runs.ts';

// c61 R2-2: the instrument audit record. Records and validation only: nothing here runs an evaluation or calls a model.
// The motive is one single-author preprint (A6); the checks are cheap and the evidence is only the motive.

const ids = (n: number) => Array.from({ length: n }, (_, i) => 'c' + String(i + 1).padStart(2, '0'));
const runs = (scores: Array<number | null>, ungraded: Record<number, string> = {}): CaseRuns[] =>
  ids(scores.length).map((caseId, i) => ({ caseId, attempts: [{ score: scores[i], costUnits: 1, ungraded: ungraded[i] ?? null }] }));
const base = (over: Record<string, unknown> = {}) => {
  const cases = ids(12).map((caseId, i) => ({ caseId, input: { i }, expected: { a: i } }));
  const sha = hashDataset(cases);
  return {
    baseline: runs(Array(12).fill(90)), candidate: runs(Array(12).fill(90)),
    holdout: { datasetId: 'H', split: 'holdout' as const, frozenSha256: sha, observedSha256: sha },
    tunedOnDatasetIds: [], authorId: 'u', evaluatorId: 'ev', candidateModelFamily: 'qwen', judgeModelFamily: 'claude', ...over,
  };
};

describe('R2-2 pure verdict: ungraded is not failed', () => {
  it('control: the same scores counted as graded failures are significantly worse', () => {
    const v = verdictV2(base({ candidate: runs(Array(12).fill(20)) }));
    expect(v.outcome).toBe('not_better');
  });
  it('a fixture with 50% ungraded candidate episodes is inconclusive, never worse', () => {
    const cand = runs(Array(12).fill(20).map((x, i) => (i < 6 ? null : x)), Object.fromEntries(ids(6).map((_, i) => [i, 'grader_timeout'])));
    const v = verdictV2(base({ candidate: cand }));
    expect(v.outcome).toBe('inconclusive');
    expect(v.reasons.join(' ')).toMatch(/graded/);
    expect(v.grading.candidate).toMatchObject({ attempted: 12, graded: 6 });
    expect(v.grading.sufficient).toBe(false);
  });
  it('an ungraded episode is not a failure even when the grading fraction is high enough: it is left out of the comparison', () => {
    const b = runs(Array(20).fill(90));
    const c = runs(Array(20).fill(90).map((x, i) => (i === 0 ? null : x)), { 0: 'grader_error' });
    const cases = ids(20).map((caseId, i) => ({ caseId, input: { i }, expected: { a: i } }));
    const sha = hashDataset(cases);
    const v = verdictV2(base({ baseline: b, candidate: c, holdout: { datasetId: 'H', split: 'holdout', frozenSha256: sha, observedSha256: sha } }));
    expect(v.grading.sufficient).toBe(true);
    expect(v.cases).toBe(19);
    expect(v.signTest.losses).toBe(0);
  });
  it('a null score WITHOUT a reason is still a failed attempt (c47/c53 meaning is unchanged)', () => {
    const v = verdictV2(base({ candidate: runs(Array(12).fill(null)) }));
    expect(v.outcome).toBe('not_better');
    expect(v.grading.candidate).toMatchObject({ attempted: 12, graded: 12 });
  });
});

describe('R2-2 pure verdict: grader versions', () => {
  const g = (version: string | null) => (version === null ? null : { name: 'rubric', version });
  it('two different versions are refused unless a re-grade diff links them', () => {
    const v = verdictV2(base({ graders: { baseline: g('1'), candidate: g('2'), linked: false } }));
    expect(v.refusals.map((r) => r.code)).toContain('grader_mismatch');
    expect(v.outcome).toBe('inconclusive');
  });
  it('a linked pair is accepted', () => {
    const v = verdictV2(base({ graders: { baseline: g('1'), candidate: g('2'), linked: true } }));
    expect(v.refusals.map((r) => r.code)).not.toContain('grader_mismatch');
  });
  it('the same name and version is accepted; a different name is a mismatch', () => {
    expect(verdictV2(base({ graders: { baseline: g('1'), candidate: g('1'), linked: false } })).refusals).toEqual([]);
    expect(verdictV2(base({ graders: { baseline: { name: 'a', version: '1' }, candidate: { name: 'b', version: '1' }, linked: false } })).refusals.map((r) => r.code)).toContain('grader_mismatch');
  });
  it('one recorded and one not recorded differ; a grader missing on BOTH is unknown, not "the same" (review finding 6)', () => {
    expect(verdictV2(base({ graders: { baseline: g('1'), candidate: null, linked: false } })).refusals.map((r) => r.code)).toContain('grader_mismatch');
    expect(verdictV2(base({ graders: { baseline: null, candidate: g('1'), linked: false } })).refusals.map((r) => r.code)).toContain('grader_mismatch');
    const v = verdictV2(base({ graders: { baseline: null, candidate: null, linked: false } }));
    expect(v.refusals.map((r) => r.code)).toContain('grader_unknown'); expect(v.outcome).toBe('inconclusive');
  });
  it('a mismatch is refused in 100% of a 200-case sweep of version pairs', () => {
    let n = 0;
    for (let i = 0; i < 200; i++) {
      const a = `v${i % 7}`, b = `v${(i % 7) + 1 + (i % 3)}`;
      const v = verdictV2(base({ graders: { baseline: g(a), candidate: g(b), linked: false } }));
      if (v.refusals.some((r) => r.code === 'grader_mismatch')) n++;
    }
    expect(n).toBe(200);
  });
});

describe('R2-2 cost: nested spans (fixture only; usage is not recorded until Stage 9)', () => {
  // A trace may nest spans (a root span with child spans). Cost is taken from root spans only, so each call counts once.
  it('counts each call once: a parent span already includes its children', async () => {
    const { rootSpanCost } = await import('../src/evolution/eval-runs.ts');
    const trace = { steps: [
      { id: 'a', parent: null, cost: 10 }, { id: 'a1', parent: 'a', cost: 4 }, { id: 'a2', parent: 'a', cost: 6 },
      { id: 'b', parent: null, cost: 5 }, { id: 'b1', parent: 'b', cost: 5 },
    ] };
    expect(rootSpanCost(trace)).toBe(15);
    expect(rootSpanCost({ steps: [] })).toBe(0);
    expect(() => rootSpanCost({ steps: [{ id: 'x', parent: 'missing', cost: 1 }] })).toThrow(/parent/);
  });
});

let s: Awaited<ReturnType<typeof makeSchema>>;
let v1 = '';
const q = (sql: string, p: unknown[] = []) => s.pool.query(sql, p);
const cx = async <T>(fn: (c: pg.PoolClient) => Promise<T>) => { const c = await s.pool.connect(); try { return await fn(c); } finally { c.release(); } };
const prop = (id: string, sha: string) =>
  q(`insert into agent_version_proposals(id, tenant_id, agent_id, base_version_id, base_sha, candidate, candidate_sha, title, created_by) values ($1,'t-1','a-1',$2,'h',$4::jsonb,$3,'t','u')`, [id, v1, sha, JSON.stringify({ model: 'qwen-72b', skills: [sha], tools: [] })]);
const G1 = { name: 'rubric', version: '1' }, G2 = { name: 'rubric', version: '2' };
const load = (p: string) => cx(async (c) => (await loadEvaluations(c, 't-1', [{ id: p, created_by: 'u', base_version_id: v1, candidate: { model: 'qwen-72b' } }])).get(p)!);
const ev = { judge: 'claude-judge', evaluator: 'ev-b' };
let seq = 0;
/** a holdout of 12 cases with a base run and a candidate run */
async function pair(o: { cases?: number; base: Array<number | null>; cand: Array<number | null>; bg?: { name: string; version: string } | null; cg?: { name: string; version: string } | null; bUn?: Record<number, string>; cUn?: Record<number, string> }) {
  const n = ++seq, ds = 'AH' + n, pid = 'AP' + n;
  await makeDataset(s.pool, { id: ds, split: 'holdout', cases: o.cases ?? 12 });
  await prop(pid, 'sha-A' + n);
  await addRun(s.pool, { id: 'AB' + n, datasetId: ds, versionId: v1, scores: o.base, grader: o.bg, ungraded: o.bUn, ...ev });
  await addRun(s.pool, { id: 'AC' + n, datasetId: ds, proposalId: pid, scores: o.cand, grader: o.cg, ungraded: o.cUn, ...ev });
  return { ds, pid, base: 'AB' + n, cand: 'AC' + n };
}
const six = Object.fromEntries([0, 1, 2, 3, 4, 5].map((i) => [i, 'grader_timeout']));

beforeAll(async () => {
  s = await makeSchema();
  await q(`insert into tenants(id,name) values ('t-1','T') on conflict do nothing`);
  await q(`insert into users(id,tenant_id,name,name_key,pass_hash,role,status) values ('ev-b','t-1','Ev','evb','h','member','approved'), ('u-prop','t-1','Prop','prop','h','member','approved'), ('u-off','t-1','Off','off','h','member','disabled')`);
  await q(`insert into agent_definitions(id, tenant_id, name, role, dept, duty, created_by) values ('a-1','t-1','A','r','D','duty','u')`);
  v1 = (await q(`insert into agent_versions(agent_id, seq, label, model, prompt_hash, created_by) values ('a-1',1,'v1','m','h','u') returning id`)).rows[0].id;
});
afterAll(async () => { await s.drop(); });

describe('migration 0046', () => {
  it('exists and goes down/up/down/up on a populated schema', async () => {
    expect(listMigrations().map((m) => m.version)).toContain(46);
    const m = await makeSchema();
    try {
      const all = listMigrations().map((x) => x.version);
      const latest = Math.max(...all), prev = Math.max(...all.filter((v) => v < 46));
      await m.pool.query(`insert into tenants(id,name) values ('t-1','T') on conflict do nothing`);
      await m.pool.query(`insert into eval_datasets(id, tenant_id, name, split) values ('D','t-1','n','dev')`);
      expect(await migrate(m.pool, 'down', 45)).toBe(prev);
      expect(await migrate(m.pool, 'up')).toBe(latest);
      expect(await migrate(m.pool, 'down', 45)).toBe(prev);
      expect(await migrate(m.pool, 'up')).toBe(latest);
      expect((await m.pool.query(`select count(*)::int n from eval_datasets`)).rows[0].n).toBe(1);
    } finally { await m.drop(); }
  });
});

describe('R2-2 records', () => {
  it('a run records its grader; name and version go together and cannot change', async () => {
    await makeDataset(s.pool, { id: 'G-D', split: 'dev', cases: 3 });
    await addRun(s.pool, { id: 'G-1', datasetId: 'G-D', versionId: v1, scores: [1, 2, 3], grader: G1, finish: false, ...ev });
    expect((await q(`select grader_name n, grader_version v from eval_runs where id='G-1'`)).rows[0]).toEqual({ n: 'rubric', v: '1' });
    await expect(q(`update eval_runs set grader_version='9', finished_at=now() where id='G-1'`)).rejects.toThrow(/append-only/);
    await expect(q(`insert into eval_runs(id, tenant_id, dataset_id, subject_version_id, k, grader_name) values ('G-2','t-1','G-D',$1,1,'rubric')`, [v1])).rejects.toThrow();
    await expect(q(`insert into eval_runs(id, tenant_id, dataset_id, subject_version_id, k, grader_name, grader_version) values ('G-3','t-1','G-D',$1,1,' ','1')`, [v1])).rejects.toThrow();
  });
  it('startRun takes the grader and refuses half of one', async () => {
    await makeDataset(s.pool, { id: 'G-D2', split: 'dev', cases: 3 });
    await cx(async (c) => {
      await startRun(c, { id: 'G-4', tenantId: 't-1', datasetId: 'G-D2', versionId: v1, k: 1, judgeLabel: 'claude-judge', evaluatorId: 'ev', grader: G1 });
      await expect(startRun(c, { id: 'G-5', tenantId: 't-1', datasetId: 'G-D2', versionId: v1, k: 1, judgeLabel: 'claude-judge', evaluatorId: 'ev', grader: { name: 'rubric', version: ' ' } })).rejects.toThrow(/grader/);
    });
    expect((await q(`select grader_name n, grader_version v from eval_runs where id='G-4'`)).rows[0]).toEqual({ n: 'rubric', v: '1' });
  });
  it('an ungraded reason is a known code and only on a result with no score', async () => {
    const ins = (score: number | null, why: string | null, a: number) => q(`insert into eval_results(run_id, case_id, attempt, score, trace, ungraded_reason) values ('G-1','c01',$3,$1,'{"steps":[]}',$2)`, [score, why, a]);
    await expect(ins(50, 'grader_timeout', 2)).rejects.toThrow();
    await expect(ins(null, 'because', 2)).rejects.toThrow();
  });
  it('episodes attempted, graded and the ungraded reasons come from the stored rows', async () => {
    await addRun(s.pool, { id: 'G-6', datasetId: 'G-D', versionId: v1, scores: [10, null, 30], k: 1, grader: G2, ungraded: { 1: 'grader_error', 2: 'grader_timeout' }, ...ev });
    const r = (await q(`select attempted, graded, ungraded_reasons from eval_run_audit('G-6')`)).rows[0];
    expect(r).toEqual({ attempted: 3, graded: 1, ungraded_reasons: { grader_error: 1, grader_timeout: 1 } });
  });
});

describe('R2-2 loader: ungraded is inconclusive, never worse', () => {
  it('control: graded failures on every case are worse', async () => {
    const p = await pair({ base: Array(12).fill(90), cand: Array(12).fill(20), bg: G1, cg: G1 });
    expect((await load(p.pid)).outcome).toBe('worse');
  });
  it('50% ungraded candidate episodes: inconclusive, with the graded fraction in the DTO', async () => {
    const p = await pair({ base: Array(12).fill(90), cand: Array(12).fill(20), bg: G1, cg: G1, cUn: six });
    const e = await load(p.pid);
    expect(e.outcome).toBe('inconclusive');
    expect(e.grading.candidate).toMatchObject({ attempted: 12, graded: 6, graderName: 'rubric', graderVersion: '1' });
    expect(e.grading.baseline).toMatchObject({ attempted: 12, graded: 12 });
    expect(e.grading.sufficient).toBe(false);
    expect(e.reasons.join(' ')).toMatch(/graded/);
  });
  it('50% ungraded BASE episodes with a candidate that is lower where graded: inconclusive too', async () => {
    const p = await pair({ base: Array(12).fill(90), cand: Array(12).fill(20), bg: G1, cg: G1, bUn: six });
    expect((await load(p.pid)).outcome).toBe('inconclusive');
  });
  it('the graded fraction is stated even when nothing is wrong', async () => {
    const p = await pair({ base: Array(12).fill(40), cand: Array(12).fill(70).map((x, i) => x + (i % 3)), bg: G1, cg: G1 });
    const e = await load(p.pid);
    expect(e.outcome).toBe('verified_better');
    expect(e.grading).toMatchObject({ sufficient: true, regrade: null });
  });
});

describe('R2-2 loader: grader versions', () => {
  it('a candidate graded by version 2 against a base graded by version 1 is refused', async () => {
    const p = await pair({ base: Array(12).fill(40), cand: Array(12).fill(75), bg: G1, cg: G2 });
    const e = await load(p.pid);
    expect(e.outcome).toBe('inconclusive'); expect(e.refusals.map((r) => r.code)).toContain('grader_mismatch');
  });
  it('runs with no grader recorded on either side are inconclusive (grader unknown), never verified better', async () => {
    const p = await pair({ base: Array(12).fill(40), cand: Array(12).fill(75), bg: null, cg: null });
    const e = await load(p.pid);
    expect(e.outcome).toBe('inconclusive'); expect(e.refusals.map((r) => r.code)).toContain('grader_unknown');
    expect(e.grading.candidate).toMatchObject({ graderName: null, graderVersion: null });
  });
  it('a re-grade diff of the base run to the candidate version links them, and the comparison uses the NEW grades', async () => {
    // under grader 1 the base scored 90 (the candidate at 75 looks worse); the re-grade under grader 2 says 40
    const p = await pair({ base: Array(12).fill(90), cand: Array(12).fill(75), bg: G1, cg: G2 });
    expect((await load(p.pid)).refusals.map((r) => r.code)).toContain('grader_mismatch');
    await cx(async (c) => { await recordRegrade(c, { id: 'RG-' + p.pid, tenantId: 't-1', runId: p.base, to: G2, by: 'ev-b', cases: ids(12).map((caseId) => ({ caseId, attempt: 1, newScore: 40 })) }); });
    const e = await load(p.pid);
    expect(e.refusals.map((r) => r.code)).not.toContain('grader_mismatch');
    expect(e.grading.regrade).toEqual({ id: 'RG-' + p.pid, by: 'ev-b', byName: 'Ev' });
    expect(e.outcome).toBe('verified_better');
    expect(e.baselineMean).toBe(40);
  });
  it('a diff that leaves a case out does not link', async () => {
    const p = await pair({ base: Array(12).fill(90), cand: Array(12).fill(75), bg: G1, cg: G2 });
    await cx(async (c) => { await recordRegrade(c, { id: 'RG-' + p.pid, tenantId: 't-1', runId: p.base, to: G2, by: 'ev-b', cases: ids(11).map((caseId) => ({ caseId, attempt: 1, newScore: 40 })) }); });
    const e = await load(p.pid);
    expect(e.refusals.map((r) => r.code)).toContain('grader_mismatch');
    expect(e.grading.regrade).toBeNull();
  });
  it('a diff to a third version does not link', async () => {
    const p = await pair({ base: Array(12).fill(90), cand: Array(12).fill(75), bg: G1, cg: G2 });
    await cx(async (c) => { await recordRegrade(c, { id: 'RG-' + p.pid, tenantId: 't-1', runId: p.base, to: { name: 'rubric', version: '3' }, by: 'ev-b', cases: ids(12).map((caseId) => ({ caseId, attempt: 1, newScore: 40 })) }); });
    expect((await load(p.pid)).refusals.map((r) => r.code)).toContain('grader_mismatch');
  });
  it('the diff records the old grade as stored: a false old grade is refused', async () => {
    const p = await pair({ base: Array(12).fill(90), cand: Array(12).fill(75), bg: G1, cg: G2 });
    await q(`insert into eval_regrades(id, tenant_id, run_id, from_grader_name, from_grader_version, to_grader_name, to_grader_version, created_by) values ('RG-X','t-1',$1,'rubric','1','rubric','2','ev-b')`, [p.base]);
    await expect(q(`insert into eval_regrade_cases(regrade_id, case_id, attempt, old_score, new_score) values ('RG-X','c01',1,11,40)`)).rejects.toThrow(/old/);
    await expect(q(`insert into eval_regrade_cases(regrade_id, case_id, attempt, old_score, new_score) values ('RG-X','zz',1,90,40)`)).rejects.toThrow();
  });
  it('a diff must start from the grader the run recorded, and name a different one', async () => {
    const p = await pair({ base: Array(12).fill(90), cand: Array(12).fill(75), bg: G1, cg: G2 });
    await expect(q(`insert into eval_regrades(id, tenant_id, run_id, from_grader_name, from_grader_version, to_grader_name, to_grader_version, created_by) values ('RG-Y','t-1',$1,'rubric','7','rubric','2','ev-b')`, [p.base])).rejects.toThrow(/from/);
    await expect(q(`insert into eval_regrades(id, tenant_id, run_id, from_grader_name, from_grader_version, to_grader_name, to_grader_version, created_by) values ('RG-Z','t-1',$1,'rubric','1','rubric','1','ev-b')`, [p.base])).rejects.toThrow();
  });
  it('re-grade records are append-only (update, delete, truncate), except demo purge', async () => {
    const p = await pair({ base: Array(12).fill(90), cand: Array(12).fill(75), bg: G1, cg: G2 });
    await q(`insert into eval_regrades(id, tenant_id, run_id, from_grader_name, from_grader_version, to_grader_name, to_grader_version, created_by) values ('RG-W','t-1',$1,'rubric','1','rubric','2','ev-b')`, [p.base]);
    await q(`insert into eval_regrade_cases(regrade_id, case_id, attempt, old_score, new_score) values ('RG-W','c01',1,90,40)`);
    for (const t of ['eval_regrades', 'eval_regrade_cases']) {
      await expect(q(`update ${t} set ${t === 'eval_regrades' ? 'created_by' : 'new_score'} = ${t === 'eval_regrades' ? "'x'" : '1'}`)).rejects.toThrow(/append-only/);
      await expect(q(`delete from ${t}`)).rejects.toThrow(/append-only/);
    }
    await expect(q(`truncate eval_regrade_cases, eval_regrades`)).rejects.toThrow(/append-only/);
    const c = await s.pool.connect();
    try { await c.query('begin'); await c.query(`set local axion.purge_demo='on'`); await c.query(`delete from eval_regrade_cases`); await c.query(`delete from eval_regrades`); await c.query('rollback'); } finally { c.release(); }
  });
});

// ---- c61 fix round, item 1: leaving cases out must not manufacture a verdict (review finding 1) --------------------------------------
const tiedBase = (): { base: number[]; cand: Array<number | null>; un: Record<number, string> } => {
  // 100 cases; base and candidate each fail 40 (24 in common). 20 of the candidate's OWN failures time out (16 candidate-only + 4 shared).
  const base = Array.from({ length: 100 }, (_, i) => (i < 40 ? 0 : 90));
  const candFail = new Set([...Array.from({ length: 24 }, (_, i) => i), ...Array.from({ length: 16 }, (_, i) => 40 + i)]);
  const un: Record<number, string> = {};
  for (const i of [...Array.from({ length: 16 }, (_, i) => 40 + i), 20, 21, 22, 23]) un[i] = 'grader_timeout';
  const cand = Array.from({ length: 100 }, (_, i) => (un[i] ? null : candFail.has(i) ? 0 : 90));
  return { base, cand, un };
};
describe('fix round 1: excluded cases are imputed against the verdict', () => {
  const cases = (n: number) => ids(n).map((caseId, i) => ({ caseId, input: { i }, expected: { a: i } }));
  const mk = (n: number, baseline: CaseRuns[], candidate: CaseRuns[]) => { const sha = hashDataset(cases(n)); return { baseline, candidate, holdout: { datasetId: 'H', split: 'holdout' as const, frozenSha256: sha, observedSha256: sha }, tunedOnDatasetIds: [], authorId: 'u', evaluatorId: 'ev', candidateModelFamily: 'qwen', judgeModelFamily: 'claude' }; };
  it('control: the tied runs with nothing ungraded are not verified better', () => {
    const t = tiedBase();
    const cand = t.cand.map((x, i) => (x === null ? (i < 56 && i >= 40 ? 0 : 0) : x));
    expect(verdictV2(mk(100, runs(t.base), runs(cand))).outcome).not.toBe('verified_better');
  });
  it('20 of the candidate failures time out: NOT verified better (the review probe), and the reason names the worst case', () => {
    const t = tiedBase();
    const v = verdictV2(mk(100, runs(t.base), runs(t.cand, t.un)));
    expect(v.grading.sufficient).toBe(true); // exactly 80% graded: the gate alone does not stop it
    expect(v.outcome).toBe('inconclusive'); expect(v.grading.robust).toBe(false);
    expect(v.reasons.join(' ')).toMatch(/worst case/);
  });
  it('a clear win with a couple of ungraded cases survives the worst case', () => {
    const b = runs(Array(100).fill(20)), c = runs(Array(100).fill(90).map((x, i) => (i < 2 ? null : x)), { 0: 'grader_error', 1: 'grader_error' });
    const v = verdictV2(mk(100, b, c));
    expect(v.outcome).toBe('verified_better'); expect(v.grading.robust).toBe(true);
  });
  it('the mirror: a loss that rests on leaving out 20 candidate cases is not "worse"', () => {
    const b = runs(Array(100).fill(90));
    const un = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [i + 80, 'grader_timeout']));
    const c = runs(Array.from({ length: 100 }, (_, i) => (i >= 80 ? null : i < 25 ? 80 : 90)), un);
    const v = verdictV2(mk(100, b, c));
    expect(v.outcome).toBe('inconclusive'); expect(v.worse).toBe(false); expect(v.reasons.join(' ')).toMatch(/worst case/);
  });
  it('a loss that survives the mirror stays worse', () => {
    const b = runs(Array(100).fill(90));
    const c = runs(Array.from({ length: 100 }, (_, i) => (i < 60 ? 20 : i < 62 ? null : 90)), { 60: 'grader_error', 61: 'grader_error' });
    const v = verdictV2(mk(100, b, c));
    expect(v.outcome).toBe('not_better'); expect(v.worse).toBe(true);
  });
  it('each side must keep 80% of its CASES, not only of its attempts (k = 3, 5 of 10 candidate cases have one ungraded attempt)', () => {
    const cs = ids(10);
    const b: CaseRuns[] = cs.map((caseId) => ({ caseId, attempts: [1, 2, 3].map(() => ({ score: 50, costUnits: 1 })) }));
    const c: CaseRuns[] = cs.map((caseId, i) => ({ caseId, attempts: [1, 2, 3].map((a) => ({ score: 95, costUnits: 1, ungraded: i < 5 && a === 1 ? 'grader_error' : null })) }));
    const v = verdictV2(mk(10, b, c));
    expect(v.grading.candidate.graded / v.grading.candidate.attempted).toBeGreaterThanOrEqual(0.8); // attempts alone would pass
    expect(v.grading.retained).toEqual({ baseline: 10, candidate: 5, shared: 10 });
    expect(v.grading.sufficient).toBe(false); expect(v.outcome).toBe('inconclusive');
  });
});
describe('fix round 1: the loader', () => {
  it('the tied-base probe through the loader is not verified better', async () => {
    const t = tiedBase();
    const p = await pair({ cases: 100, base: t.base, cand: t.cand, bg: G1, cg: G1, cUn: t.un });
    const e = await load(p.pid);
    expect(e.outcome).not.toBe('verified_better'); expect(e.grading.robust).toBe(false); expect(e.grading.retained).toEqual({ baseline: 100, candidate: 80, shared: 100 });
  });
});

// ---- c61 fix round, item 3: a re-grade diff is evidence, not a claim (review finding 3) ------------------------------------------------
describe('fix round 3: who may re-grade', () => {
  const all12 = (v: number) => ids(12).map((caseId) => ({ caseId, attempt: 1, newScore: v }));
  it('the review probe: a diff by "anyone" cannot turn a worse candidate (90 vs 40) into verified better', async () => {
    const p = await pair({ base: Array(12).fill(90), cand: Array(12).fill(40), bg: G1, cg: G2 });
    await cx(async (c) => { await expect(recordRegrade(c, { id: 'RG-' + p.pid, tenantId: 't-1', runId: p.base, to: G2, by: 'anyone', cases: all12(5) })).rejects.toThrow(/regrader/); });
    const e = await load(p.pid);
    expect(e.outcome).not.toBe('verified_better'); expect(e.refusals.map((r) => r.code)).toContain('grader_mismatch');
  });
  it('a disabled user cannot re-grade either', async () => {
    const p = await pair({ base: Array(12).fill(90), cand: Array(12).fill(40), bg: G1, cg: G2 });
    await cx(async (c) => { await expect(recordRegrade(c, { id: 'RG-' + p.pid, tenantId: 't-1', runId: p.base, to: G2, by: 'u-off', cases: all12(5) })).rejects.toThrow(/regrader/); });
  });
  it('the author of the proposal cannot re-grade its runs (producer is not verifier): refused on the candidate run, not linked on the base run', async () => {
    const n = ++seq, ds = 'AH' + n, pid = 'AP' + n;
    await makeDataset(s.pool, { id: ds, split: 'holdout', cases: 12 });
    await q(`insert into agent_version_proposals(id, tenant_id, agent_id, base_version_id, base_sha, candidate, candidate_sha, title, created_by) values ($1,'t-1','a-1',$2,'h',$4::jsonb,$3,'t','u-prop')`, [pid, v1, 'sha-A' + n, JSON.stringify({ model: 'qwen-72b', skills: ['sha-A' + n], tools: [] })]);
    await addRun(s.pool, { id: 'AB' + n, datasetId: ds, versionId: v1, scores: Array(12).fill(90), grader: G1, ...ev });
    await addRun(s.pool, { id: 'AC' + n, datasetId: ds, proposalId: pid, scores: Array(12).fill(75), grader: G2, ...ev });
    await cx(async (c) => { await expect(recordRegrade(c, { id: 'RGc' + n, tenantId: 't-1', runId: 'AC' + n, to: G1, by: 'u-prop', cases: all12(75) })).rejects.toThrow(/regrader/); });
    await cx(async (c) => { await recordRegrade(c, { id: 'RGb' + n, tenantId: 't-1', runId: 'AB' + n, to: G2, by: 'u-prop', cases: all12(40) }); });
    const e = await cx(async (c) => (await loadEvaluations(c, 't-1', [{ id: pid, created_by: 'u-prop', base_version_id: v1, candidate: { model: 'qwen-72b' } }])).get(pid)!);
    expect(e.refusals.map((r) => r.code)).toContain('grader_mismatch'); expect(e.grading.regrade).toBeNull();
  });
  it('new scores must be in the score domain 0..100', async () => {
    const p = await pair({ base: Array(12).fill(90), cand: Array(12).fill(75), bg: G1, cg: G2 });
    await cx(async (c) => { await expect(recordRegrade(c, { id: 'RG-' + p.pid, tenantId: 't-1', runId: p.base, to: G2, by: 'ev-b', cases: all12(150) })).rejects.toThrow(); });
    await cx(async (c) => { await expect(recordRegrade(c, { id: 'RH-' + p.pid, tenantId: 't-1', runId: p.base, to: G2, by: 'ev-b', cases: all12(-1) })).rejects.toThrow(); });
  });
  it('a diff must cover every GRADED result of the run; an ungraded result need not be covered and stays ungraded', async () => {
    const p = await pair({ base: Array(12).fill(40), cand: Array(12).fill(75).map((x, i) => (i === 0 ? null : x)), bg: G1, cg: G2, cUn: { 0: 'grader_error' } });
    // re-grade the CANDIDATE run to version 1, leaving out the one ungraded result: links, and that case stays ungraded
    await cx(async (c) => { await recordRegrade(c, { id: 'RG-' + p.pid, tenantId: 't-1', runId: p.cand, to: G1, by: 'ev-b', cases: ids(12).slice(1).map((caseId) => ({ caseId, attempt: 1, newScore: 75 })) }); });
    const e = await load(p.pid);
    expect(e.grading.regrade?.id).toBe('RG-' + p.pid);
    expect(e.grading.candidate).toMatchObject({ attempted: 12, graded: 11, graderVersion: '1' });
  });
  it('a verdict that rests on a re-grade says who made it', async () => {
    const p = await pair({ base: Array(12).fill(90), cand: Array(12).fill(75), bg: G1, cg: G2 });
    await cx(async (c) => { await recordRegrade(c, { id: 'RG-' + p.pid, tenantId: 't-1', runId: p.base, to: G2, by: 'ev-b', cases: all12(40) }); });
    expect((await load(p.pid)).grading.regrade).toMatchObject({ by: 'ev-b', byName: 'Ev' });
  });
});
