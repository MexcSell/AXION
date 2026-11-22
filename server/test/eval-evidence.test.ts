import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
import { makeTestApp, withAdmin, type TestApp, type Browser } from './helpers.ts';
import { seedDemo } from '../src/seed/demo.ts';
import { hashDataset } from '../src/evolution/verdict-v2.ts';
import { modelFamily } from '../src/evolution/proposal-evidence.ts';
import { makeDataset, addRun, type RunOpts } from './eval-fixtures.ts';

// c47 (E1b): evaluation evidence on version proposals. Runs and results below are RECORDS written by fixtures; no
// evaluation is executed and no model is called.
let t: TestApp;
let A: Browser; // proposes
let B: Browser; // decides
let M: Browser; // member
let aId = '', bId = '';
let n = 0;
const key = () => ({ 'idempotency-key': 'e' + n++ });
const rows = async (sql: string, p: unknown[] = []) => (await t.pool.query(sql, p)).rows;
const AG = 'knowledge-01'; // not coder-01: version-proposals.test.ts holds that agent's advisory lock on purpose (the lock is global to the database, across test schemas)
type Cfg = { model: string; skills: string[]; tools: string[] };
let seq = 0;

const agent = async () => (await A.req('GET', `/agents/${AG}`)).body.agent as Cfg & { versionId: string };
/** A fresh pending proposal on the agent's active version (a new skill name each time, so none is a duplicate). */
async function propose(model = 'qwen-72b') {
  const a = await agent();
  const r = await A.req('POST', `/agents/${AG}/version-proposals`, { title: 'Try ' + ++seq, hypothesis: 'Fewer review rounds.', candidate: { model, skills: [...a.skills, 'Skill-' + seq + '-' + n], tools: a.tools }, baseVersionId: a.versionId }, key());
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return { ...r.body.proposal, baseId: a.versionId } as { id: string; sha: string; baseId: string; evaluation: any; evaluationSha: string; overrideReason: string | null };
}
const get = async (by: Browser, id: string) => ((await by.req('GET', `/agents/${AG}/version-proposals`)).body.proposals as any[]).find((p) => p.id === id);
/** The decision carries the evaluationSha the reviewer saw: by default the current one (a test passes its own to test a stale one). */
const decide = async (id: string, sha: string, extra: Record<string, unknown> = {}, decision = 'promote') => {
  const evaluationSha = 'evaluationSha' in extra ? extra.evaluationSha : (await get(A, id)).evaluationSha;
  return B.req('POST', `/version-proposals/${id}/decision`, { decision, sha, ...(decision === 'promote' ? { evaluationSha } : {}), ...extra });
};
const ids = (k: number) => Array.from({ length: k }, (_, i) => i);
/** base scores b[i], candidate scores c[i], on dataset ds, with honest defaults (different judge family, evaluator = B). */
async function evidence(p: { id: string; baseId: string }, ds: string, b: RunOpts['scores'], c: RunOpts['scores'], o: { judge?: string | null; evaluator?: string | null; cand?: Partial<Parameters<typeof addRun>[1]>; base?: Partial<Parameters<typeof addRun>[1]> } = {}) {
  const tag = 'R' + ++seq;
  if (!(await t.pool.query(`select 1 from eval_datasets where id=$1`, [ds])).rowCount) await makeDataset(t.pool, { id: ds, split: 'holdout', cases: b.length });
  // c53: a holdout takes one base run per base version (the DB refuses a second), so a later proposal on the same dataset reuses it
  const haveBase = (await t.pool.query(`select 1 from eval_runs where subject_version_id=$1 and dataset_id=$2`, [p.baseId, ds])).rowCount;
  if (!haveBase) await addRun(t.pool, { id: tag + 'b', datasetId: ds, versionId: p.baseId, scores: b, judge: o.judge, evaluator: o.evaluator ?? bId, ...o.base });
  await addRun(t.pool, { id: tag + 'c', datasetId: ds, proposalId: p.id, scores: c, judge: o.judge, evaluator: o.evaluator ?? bId, ...o.cand });
}
const BETTER = { b: ids(12).map(() => 40), c: ids(12).map((i) => 70 + (i % 3)) };

beforeAll(async () => {
  t = await makeTestApp({ staffingStepMs: 3_600_000, conversationSimMs: 3_600_000, writeLimits: { proposals: { max: 1000, windowMs: 60_000 } } });
  const w = await withAdmin(t.app);
  A = w.admin; aId = w.adminId;
  const b = await w.member('Bea');
  B = b.b; bId = b.id;
  expect((await A.req('PATCH', `/users/${bId}`, { role: 'admin' })).status).toBe(200);
  M = (await w.member('Mia')).b;
  await seedDemo(t.app.db, 't-1', aId);
  await makeDataset(t.pool, { id: 'HO', split: 'holdout', cases: 12 });
  await makeDataset(t.pool, { id: 'DEV', split: 'dev', cases: 12 });
});
afterAll(async () => { await t.close(); });

describe('modelFamily', () => {
  it('takes the leading letters after a provider prefix', () => {
    expect(modelFamily('claude-sonnet-4')).toBe('claude');
    expect(modelFamily('Anthropic/Claude-3.5')).toBe('claude');
    expect(modelFamily('gpt-4o')).toBe('gpt');
    expect(modelFamily('')).toBe('');
  });
});

describe('no runs: no evaluation', () => {
  it('a proposal without runs has evaluation null, in both lists', async () => {
    const p = await propose();
    expect(p.evaluation).toBeNull();
    expect(p.overrideReason).toBeNull();
    expect((await get(M, p.id)).evaluation).toBeNull();
    expect((await M.req('GET', '/version-proposals')).body.proposals.find((x: any) => x.id === p.id).evaluation).toBeNull();
  });
  it('an unfinished candidate run is not evidence', async () => {
    const p = await propose();
    await addRun(t.pool, { id: 'UNF' + seq, datasetId: 'HO', proposalId: p.id, scores: [50], finish: false });
    expect((await get(A, p.id)).evaluation).toBeNull();
  });
});

describe('verified evidence', () => {
  it('the evaluation is computed from the stored runs: outcome, n, wins, losses, delta, ci, passHatK, dataset', async () => {
    const p = await propose();
    await evidence(p, 'HO', BETTER.b, BETTER.c);
    const e = (await get(M, p.id)).evaluation;
    expect(e.outcome).toBe('verified_better');
    expect(e.refusals).toEqual([]);
    expect(e.n).toBe(12); expect(e.wins).toBe(12); expect(e.losses).toBe(0);
    expect(e.delta).toBeGreaterThan(29); expect(e.ci.low).toBeGreaterThan(0);
    expect(e.passHatK.candidate[0]).toBe(1); expect(e.passHatK.baseline[0]).toBe(0);
    expect(e.datasetId).toBe('HO');
    const cases = (await rows(`select case_id as "caseId", input, expected from eval_cases where dataset_id='HO'`));
    expect(e.datasetSha).toBe(hashDataset(cases));
  });
  it('nothing promotes by itself: a verified candidate is still pending', async () => {
    const p = await propose();
    await evidence(p, 'HO', BETTER.b, BETTER.c);
    expect((await get(A, p.id)).status).toBe('pending');
    expect((await agent()).versionId).toBe(p.baseId);
  });
  it('a single candidate run on the holdout is counted once in the DTO', async () => {
    const p = await propose();
    await evidence(p, 'HO', BETTER.b, BETTER.c);
    expect((await get(A, p.id)).evaluation.runCount).toBe(1);
  });
  it('k > 1 reports pass^k per attempt count', async () => {
    const p = await propose();
    await evidence(p, 'HO-K2', ids(12).map(() => [40, 40]), ids(12).map(() => [80, 90]), { base: { k: 2 }, cand: { k: 2 } });
    const e = (await get(A, p.id)).evaluation;
    expect(e.k).toBe(2); expect(e.passHatK.candidate).toEqual([1, 1]); expect(e.passHatK.baseline).toEqual([0, 0]);
  });
  it('fewer than the minimum cases is inconclusive with a reason and no refusal', async () => {
    await makeDataset(t.pool, { id: 'HO-SMALL', split: 'holdout', cases: 6 });
    const p = await propose();
    await evidence(p, 'HO-SMALL', ids(6).map(() => 40), ids(6).map(() => 90));
    const e = (await get(A, p.id)).evaluation;
    expect(e.outcome).toBe('inconclusive'); expect(e.refusals).toEqual([]); expect(e.n).toBe(6);
    expect(e.reasons.join(' ')).toMatch(/needs 10/);
  });
  it('no significant difference is inconclusive, not worse', async () => {
    const p = await propose();
    await evidence(p, 'HO-MID', ids(12).map(() => 50), ids(12).map((i) => (i % 2 ? 60 : 40)));
    const e = (await get(A, p.id)).evaluation;
    expect(e.outcome).toBe('inconclusive'); expect(e.refusals).toEqual([]);
  });
  it('a significant loss is worse', async () => {
    const p = await propose();
    await evidence(p, 'HO-LOSS', BETTER.c, BETTER.b);
    const e = (await get(A, p.id)).evaluation;
    expect(e.outcome).toBe('worse'); expect(e.losses).toBe(12); expect(e.delta).toBeLessThan(0);
  });
});

describe('refusals: each dishonest setup is inconclusive with its own reason', () => {
  const codes = (e: any) => e.refusals.map((r: any) => r.code);
  it('a run on a dev dataset', async () => {
    const p = await propose();
    await evidence(p, 'DEV', BETTER.b, BETTER.c);
    const e = (await get(A, p.id)).evaluation;
    expect(e.outcome).toBe('inconclusive'); expect(codes(e)).toContain('not_holdout');
  });
  it('a dataset that is not (or no longer) frozen', async () => {
    await makeDataset(t.pool, { id: 'HO-UNF', split: 'holdout', cases: 12 });
    const p = await propose();
    await evidence(p, 'HO-UNF', BETTER.b, BETTER.c);
    await t.pool.query(`alter table eval_datasets disable trigger eval_datasets_guard`);
    try { await t.pool.query(`update eval_datasets set frozen_at = null, content_sha256 = null where id='HO-UNF'`); } finally { await t.pool.query(`alter table eval_datasets enable trigger eval_datasets_guard`); }
    const e = (await get(A, p.id)).evaluation;
    expect(e.outcome).toBe('inconclusive'); expect(codes(e)).toContain('not_frozen');
  });
  it('a dataset whose cases no longer match the frozen hash', async () => {
    await makeDataset(t.pool, { id: 'HO-TAMPER', split: 'holdout', cases: 12 });
    const p = await propose();
    await evidence(p, 'HO-TAMPER', BETTER.b, BETTER.c);
    expect((await get(A, p.id)).evaluation.outcome).toBe('verified_better'); // before the tamper
    await t.pool.query(`alter table eval_cases disable trigger eval_cases_guard`);
    try { await t.pool.query(`update eval_cases set expected='"easier"' where dataset_id='HO-TAMPER' and case_id='c01'`); } finally { await t.pool.query(`alter table eval_cases enable trigger eval_cases_guard`); }
    const e = (await get(A, p.id)).evaluation;
    expect(e.outcome).toBe('inconclusive'); expect(codes(e)).toContain('hash_mismatch');
  });
  it('a dataset emptied after the freeze', async () => {
    await makeDataset(t.pool, { id: 'HO-EMPTY', split: 'holdout', cases: 12 });
    const p = await propose();
    await evidence(p, 'HO-EMPTY', BETTER.b, BETTER.c);
    await t.pool.query(`alter table eval_cases disable trigger eval_cases_guard`);
    try { await t.pool.query(`delete from eval_cases where dataset_id='HO-EMPTY'`); } finally { await t.pool.query(`alter table eval_cases enable trigger eval_cases_guard`); }
    const e = (await get(A, p.id)).evaluation;
    expect(e.outcome).toBe('inconclusive'); expect(codes(e)).toContain('empty_dataset');
  });
  it('a zero-case dataset cannot be frozen in the first place (so no run can use one)', async () => {
    await t.pool.query(`insert into eval_datasets(id, tenant_id, name, split) values ('HO-ZERO','t-1','zero','holdout')`);
    await expect(t.pool.query(`select eval_freeze_dataset('HO-ZERO')`)).rejects.toThrow(/no cases/);
  });
  it('self-judging: the judge is the candidate\'s model family', async () => {
    const p = await propose('qwen-72b');
    await evidence(p, 'HO', BETTER.b, BETTER.c, { judge: 'Qwen-max' });
    const e = (await get(A, p.id)).evaluation;
    expect(e.outcome).toBe('inconclusive'); expect(codes(e)).toContain('self_judging');
  });
  it('a missing judge counts as self-judging', async () => {
    const p = await propose();
    await evidence(p, 'HO', BETTER.b, BETTER.c, { judge: null });
    expect(codes((await get(A, p.id)).evaluation)).toContain('self_judging');
  });
  it('evaluator = author', async () => {
    const p = await propose();
    await evidence(p, 'HO', BETTER.b, BETTER.c, { evaluator: aId });
    const e = (await get(A, p.id)).evaluation;
    expect(e.outcome).toBe('inconclusive'); expect(codes(e)).toContain('evaluator_is_author');
  });
  it('a missing evaluator is refused too', async () => {
    const p = await propose();
    await evidence(p, 'HO', BETTER.b, BETTER.c, { cand: { evaluator: null } });
    expect(codes((await get(A, p.id)).evaluation)).toContain('evaluator_is_author');
  });
  it('no base run on that dataset: the cases are unpaired', async () => {
    await makeDataset(t.pool, { id: 'HO-NOBASE', split: 'holdout', cases: 12 });
    const p = await propose();
    await addRun(t.pool, { id: 'NOB' + seq, datasetId: 'HO-NOBASE', proposalId: p.id, scores: BETTER.c, evaluator: bId });
    const e = (await get(A, p.id)).evaluation;
    expect(e.outcome).toBe('inconclusive'); expect(codes(e)).toContain('unpaired_cases');
  });
  it('a candidate run that covers only some of the dataset (cherry-picked cases)', async () => {
    const p = await propose();
    await evidence(p, 'HO', BETTER.b, BETTER.c, { base: { scores: BETTER.b }, cand: { scores: BETTER.c.slice(0, 11) } });
    const e = (await get(A, p.id)).evaluation;
    expect(e.outcome).toBe('inconclusive'); expect(codes(e)).toEqual(expect.arrayContaining(['partial_coverage']));
  });
  it('different numbers of attempts on the two versions', async () => {
    const p = await propose();
    await evidence(p, 'HO-K2B', ids(12).map(() => [40, 40]), BETTER.c, { base: { k: 2 } });
    expect(codes((await get(A, p.id)).evaluation)).toContain('unequal_attempts');
  });
  it('the candidate was tuned on a dev dataset and the holdout run is also on it: dev/holdout reuse', async () => {
    const p = await propose();
    await evidence(p, 'DEV', BETTER.b, BETTER.c);
    expect(codes((await get(A, p.id)).evaluation)).toEqual(expect.arrayContaining(['not_holdout', 'dev_holdout_reuse']));
  });
  it('a holdout run is preferred over a dev run for the same proposal', async () => {
    const p = await propose();
    await evidence(p, 'DEV', BETTER.b, BETTER.c);
    await evidence(p, 'HO', BETTER.b, BETTER.c);
    const e = (await get(A, p.id)).evaluation;
    expect(e.datasetId).toBe('HO'); expect(e.outcome).toBe('verified_better');
  });
});

describe('re-run shopping and honest baselines (fix round)', () => {
  const codes = (e: any) => e.refusals.map((r: any) => r.code);
  // c53: the database now refuses a second run on a holdout (holdout_rerun), so these two tests assert that first, then switch the
  // run guard off (as a superuser could) to check the loader still refuses what the database would have stopped: defence in depth.
  const withoutRunGuard = async (fn: () => Promise<void>) => {
    await t.pool.query(`alter table eval_runs disable trigger eval_runs_guard`);
    try { await fn(); } finally { await t.pool.query(`alter table eval_runs enable trigger eval_runs_guard`); }
  };
  it('a second candidate run on the same holdout can never be verified better: holdout_rerun, run count listed', async () => {
    await makeDataset(t.pool, { id: 'HO-RR', split: 'holdout', cases: 12 });
    const p = await propose();
    await evidence(p, 'HO-RR', BETTER.b, ids(12).map(() => 10)); // a bad first run
    await expect(addRun(t.pool, { id: 'RR-late' + seq, datasetId: 'HO-RR', proposalId: p.id, scores: BETTER.c, evaluator: bId })).rejects.toThrow(/holdout_rerun/);
    await withoutRunGuard(() => addRun(t.pool, { id: 'RR-late' + seq, datasetId: 'HO-RR', proposalId: p.id, scores: BETTER.c, evaluator: bId })); // a good second one
    const e = (await get(A, p.id)).evaluation;
    expect(e.outcome).toBe('inconclusive'); expect(codes(e)).toContain('holdout_rerun'); expect(e.runCount).toBe(2);
    expect(e.refusals.find((r: any) => r.code === 'holdout_rerun').detail).toMatch(/fresh holdout/);
  });
  it('an unfinished extra run counts toward the re-run refusal', async () => {
    await makeDataset(t.pool, { id: 'HO-RR2', split: 'holdout', cases: 12 });
    const p = await propose();
    await evidence(p, 'HO-RR2', BETTER.b, BETTER.c);
    await expect(addRun(t.pool, { id: 'RR2-open' + seq, datasetId: 'HO-RR2', proposalId: p.id, scores: [50], finish: false })).rejects.toThrow(/holdout_rerun/);
    await withoutRunGuard(() => addRun(t.pool, { id: 'RR2-open' + seq, datasetId: 'HO-RR2', proposalId: p.id, scores: [50], finish: false }));
    expect(codes((await get(A, p.id)).evaluation)).toContain('holdout_rerun');
  });
  it('finished runs on two different holdout datasets are also refused (pick-the-best-set shopping)', async () => {
    await makeDataset(t.pool, { id: 'HO-S1', split: 'holdout', cases: 12 }); await makeDataset(t.pool, { id: 'HO-S2', split: 'holdout', cases: 12 });
    const p = await propose();
    await evidence(p, 'HO-S1', BETTER.b, ids(12).map(() => 20));
    await evidence(p, 'HO-S2', BETTER.b, BETTER.c);
    const e = (await get(A, p.id)).evaluation;
    expect(e.outcome).toBe('inconclusive'); expect(codes(e)).toContain('holdout_rerun');
  });
  it('dev_holdout_reuse fires on a real signal: a dev dataset the candidate ran on shares cases with the holdout', async () => {
    await makeDataset(t.pool, { id: 'DEV-OV', split: 'dev', cases: 12, inputTag: 'shared' });
    await makeDataset(t.pool, { id: 'HO-OV', split: 'holdout', cases: 12, inputTag: 'shared' });
    const p = await propose();
    await addRun(t.pool, { id: 'OV-dev' + seq, datasetId: 'DEV-OV', proposalId: p.id, scores: BETTER.c, evaluator: bId });
    await evidence(p, 'HO-OV', BETTER.b, BETTER.c);
    const e = (await get(A, p.id)).evaluation;
    expect(e.datasetId).toBe('HO-OV'); expect(e.outcome).toBe('inconclusive'); expect(codes(e)).toContain('dev_holdout_reuse');
  });
  it('a dev run on a disjoint dataset does not trigger it', async () => {
    await makeDataset(t.pool, { id: 'DEV-OK', split: 'dev', cases: 12 });
    await makeDataset(t.pool, { id: 'HO-OK', split: 'holdout', cases: 12 });
    const p = await propose();
    await addRun(t.pool, { id: 'OK-dev' + seq, datasetId: 'DEV-OK', proposalId: p.id, scores: BETTER.c, evaluator: bId });
    await evidence(p, 'HO-OK', BETTER.b, BETTER.c);
    const e = (await get(A, p.id)).evaluation;
    expect(codes(e)).not.toContain('dev_holdout_reuse'); expect(e.outcome).toBe('verified_better');
  });
  it('the base run is held to the same rules: its evaluator is the author', async () => {
    await makeDataset(t.pool, { id: 'HO-BA', split: 'holdout', cases: 12 });
    const p = await propose();
    await evidence(p, 'HO-BA', BETTER.b, BETTER.c, { base: { evaluator: aId } });
    const e = (await get(A, p.id)).evaluation;
    expect(e.outcome).toBe('inconclusive'); expect(codes(e)).toContain('base_evaluator_is_author');
  });
  it('the base run is held to the same rules: its judge is the candidate\'s family, or missing', async () => {
    await makeDataset(t.pool, { id: 'HO-BJ', split: 'holdout', cases: 12 });
    const p = await propose('qwen-72b');
    await evidence(p, 'HO-BJ', BETTER.b, BETTER.c, { base: { judge: 'qwen-max' } });
    expect(codes((await get(A, p.id)).evaluation)).toContain('base_self_judging');
    await makeDataset(t.pool, { id: 'HO-BJ2', split: 'holdout', cases: 12 });
    const q = await propose();
    await evidence(q, 'HO-BJ2', BETTER.b, BETTER.c, { base: { judge: null } });
    expect(codes((await get(A, q.id)).evaluation)).toContain('base_self_judging');
  });
});

describe('what counts as worse (fix round)', () => {
  it('a significantly worse paired mean (interval entirely below 0) is worse, though it won some cases by small margins', async () => {
    await makeDataset(t.pool, { id: 'HO-W1', split: 'holdout', cases: 12 });
    const p = await propose();
    // 7 small wins (+1), 5 large losses (-40): wins > losses, mean -16, the 95% interval is below 0
    await evidence(p, 'HO-W1', ids(12).map(() => 80), ids(12).map((i) => (i < 7 ? 81 : 40)));
    const e = (await get(A, p.id)).evaluation;
    expect(e.wins).toBe(7); expect(e.losses).toBe(5); expect(e.ci.high).toBeLessThan(0);
    expect(e.outcome).toBe('worse');
    const r = await decide(p.id, p.sha, { overrideReason: 'The wins matter more to us.' });
    expect(r.status).toBe(409); expect(r.body.code).toBe('EVAL_WORSE');
  });
  it('a significant sign test with many small wins and a few big losses (negative mean) is worse too', async () => {
    await makeDataset(t.pool, { id: 'HO-W2', split: 'holdout', cases: 16 });
    const p = await propose();
    await evidence(p, 'HO-W2', ids(16).map(() => 80), ids(16).map((i) => (i < 13 ? 81 : 20)));
    const e = (await get(A, p.id)).evaluation;
    expect(e.wins).toBe(13); expect(e.losses).toBe(3); expect(e.delta).toBeLessThan(0);
    expect(e.outcome).toBe('worse');
    expect((await decide(p.id, p.sha, { overrideReason: 'Override please, I insist.' })).body.code).toBe('EVAL_WORSE');
  });
  it('a positive-mean candidate with the same sign counts is not worse', async () => {
    await makeDataset(t.pool, { id: 'HO-W3', split: 'holdout', cases: 12 });
    const p = await propose();
    await evidence(p, 'HO-W3', ids(12).map(() => 50), ids(12).map((i) => (i < 7 ? 90 : 49)));
    expect((await get(A, p.id)).evaluation.outcome).not.toBe('worse');
  });
});

describe('the decision is bound to the evaluation the reviewer saw (evaluationSha)', () => {
  it('every proposal has an evaluationSha; two proposals with no evaluation share the sentinel', async () => {
    const a = await propose(), b = await propose();
    expect(a.evaluationSha).toMatch(/^[0-9a-f]{64}$/); expect(a.evaluationSha).toBe(b.evaluationSha);
  });
  it('it changes when the evidence changes and is stable otherwise', async () => {
    const p = await propose();
    const none = (await get(A, p.id)).evaluationSha;
    await evidence(p, 'HO', BETTER.b, BETTER.c);
    const one = (await get(A, p.id)).evaluationSha;
    expect(one).not.toBe(none); expect((await get(M, p.id)).evaluationSha).toBe(one);
  });
  it('a promote without evaluationSha is refused (409 EVALUATION_CHANGED)', async () => {
    const p = await propose();
    const r = await B.req('POST', `/version-proposals/${p.id}/decision`, { decision: 'promote', sha: p.sha, overrideReason: 'Reviewed by hand, ok.' });
    expect(r.status).toBe(409); expect(r.body.code).toBe('EVALUATION_CHANGED');
    expect((await get(A, p.id)).status).toBe('pending');
  });
  it('a run added after review makes the promote 409, audited; reviewing again promotes', async () => {
    await makeDataset(t.pool, { id: 'HO-LATE', split: 'holdout', cases: 12 });
    const p = await propose();
    const seen = (await get(A, p.id)).evaluationSha; // the reviewer looked at a card with no evaluation
    await evidence(p, 'HO-LATE', BETTER.b, BETTER.c); // a run lands afterwards
    const r = await decide(p.id, p.sha, { overrideReason: 'Reviewed by hand, ok.', evaluationSha: seen });
    expect(r.status).toBe(409); expect(r.body.code).toBe('EVALUATION_CHANGED');
    expect((await get(A, p.id)).status).toBe('pending');
    const au = await rows(`select result, detail from audit_events where action='agent.version.decide' and subject=$1 order by id desc limit 1`, [p.id]);
    expect(au[0].result).toBe('denied'); expect(au[0].detail.code).toBe('EVALUATION_CHANGED');
    expect((await decide(p.id, p.sha)).status).toBe(200); // verified now: no override needed
  });
  it('a wrong evaluationSha is refused before the gate (even for a worse candidate)', async () => {
    await makeDataset(t.pool, { id: 'HO-WS', split: 'holdout', cases: 12 });
    const p = await propose();
    await evidence(p, 'HO-WS', BETTER.c, BETTER.b);
    expect((await decide(p.id, p.sha, { evaluationSha: 'a'.repeat(64) })).body.code).toBe('EVALUATION_CHANGED');
  });
  it('a reject does not need it', async () => {
    const p = await propose();
    expect((await B.req('POST', `/version-proposals/${p.id}/decision`, { decision: 'reject', sha: p.sha })).status).toBe(200);
  });
  it('the audit row of a promote records the run ids and the evaluationSha', async () => {
    await makeDataset(t.pool, { id: 'HO-AU', split: 'holdout', cases: 12 });
    const p = await propose();
    await evidence(p, 'HO-AU', BETTER.b, BETTER.c);
    const sha = (await get(A, p.id)).evaluationSha;
    expect((await decide(p.id, p.sha)).status).toBe(200);
    const au = (await rows(`select detail from audit_events where action='agent.version.decide' and subject=$1 and result='ok'`, [p.id]))[0].detail;
    expect(au.evaluationSha).toBe(sha); expect(au.evaluation.candidateRunId).toMatch(/c$/); expect(au.evaluation.baseRunId).toMatch(/b$/);
  });
});

describe('a caller cannot influence the verdict', () => {
  it('fake hash or scores sent with a decision are rejected, and the evaluation does not change', async () => {
    const p = await propose();
    await evidence(p, 'HO', BETTER.c, BETTER.b); // worse
    const before = JSON.stringify((await get(A, p.id)).evaluation);
    const fakes = [{ observedSha256: 'f'.repeat(64) }, { scores: [100, 100] }, { evaluation: { outcome: 'verified_better' } }, { frozenSha256: 'a'.repeat(64), holdout: { split: 'holdout' } }];
    for (const f of fakes) {
      const r = await decide(p.id, p.sha, { overrideReason: 'trying to sneak a fake in', ...f });
      expect(r.status).toBe(400);
    }
    const r2 = await decide(p.id, p.sha, { overrideReason: 'a good enough reason' });
    expect(r2.status).toBe(409); expect(r2.body.code).toBe('EVAL_WORSE');
    expect(JSON.stringify((await get(A, p.id)).evaluation)).toBe(before);
  });
  it('fake values sent when proposing are rejected; fake query parameters on the read change nothing', async () => {
    const a = await agent();
    const bad = await A.req('POST', `/agents/${AG}/version-proposals`, { title: 'x', hypothesis: 'y', candidate: { model: 'm', skills: [], tools: [] }, baseVersionId: a.versionId, evaluation: { outcome: 'verified_better' }, observedSha256: 'a'.repeat(64) }, key());
    expect(bad.status).toBe(400);
    const p = await propose();
    await evidence(p, 'HO', BETTER.b, BETTER.c);
    const plain = (await M.req('GET', `/agents/${AG}/version-proposals`)).body.proposals.find((x: any) => x.id === p.id).evaluation;
    const spoof = (await M.req('GET', `/agents/${AG}/version-proposals?observedSha256=${'0'.repeat(64)}&outcome=worse&scores=1,2,3`)).body.proposals.find((x: any) => x.id === p.id).evaluation;
    expect(spoof).toEqual(plain);
  });
  it('there is no route that writes a run, a result or a dataset', async () => {
    for (const [m, u] of [['POST', '/eval-runs'], ['POST', '/eval-datasets'], ['POST', `/version-proposals/x/evaluation`], ['PUT', '/eval-results']] as const) {
      const r = await B.req(m, u, { outcome: 'verified_better' });
      expect([404, 405]).toContain(r.status);
    }
  });
});

describe('the promotion gate', () => {
  it('no evaluation and no override: 409 EVAL_OVERRIDE_REQUIRED, audited, still pending', async () => {
    const p = await propose();
    const r = await decide(p.id, p.sha);
    expect(r.status).toBe(409); expect(r.body.code).toBe('EVAL_OVERRIDE_REQUIRED');
    expect((await get(A, p.id)).status).toBe('pending');
    const au = await rows(`select result, detail from audit_events where action='agent.version.decide' and subject=$1 order by id desc limit 1`, [p.id]);
    expect(au[0].result).toBe('denied'); expect(au[0].detail.code).toBe('EVAL_OVERRIDE_REQUIRED');
  });
  it('an override shorter than 10 characters (after trimming) is refused', async () => {
    const p = await propose();
    expect((await decide(p.id, p.sha, { overrideReason: '   too short ' })).body.code).toBe('EVAL_OVERRIDE_REQUIRED');
    expect((await decide(p.id, p.sha, { overrideReason: '123456789' })).body.code).toBe('EVAL_OVERRIDE_REQUIRED');
    expect((await get(A, p.id)).status).toBe('pending');
  });
  it('with an override it promotes; the reason is in the audit row and on the proposal', async () => {
    const p = await propose();
    const reason = 'Reviewed by hand; the measured set does not cover this skill.';
    const r = await decide(p.id, p.sha, { overrideReason: reason });
    expect(r.status).toBe(200); expect(r.body.proposal.status).toBe('promoted');
    expect(r.body.proposal.overrideReason).toBe(reason);
    expect((await get(M, p.id)).overrideReason).toBe(reason);
    const au = await rows(`select result, detail from audit_events where action='agent.version.decide' and subject=$1 and result='ok'`, [p.id]);
    expect(au).toHaveLength(1); expect(au[0].detail.overrideReason).toBe(reason); expect(au[0].detail.evaluation).toBeNull();
  });
  it('an inconclusive evaluation also needs the override, and the audit row records the outcome', async () => {
    const p = await propose();
    await evidence(p, 'HO-MID', ids(12).map(() => 50), ids(12).map((i) => (i % 2 ? 60 : 40)));
    const r1 = await decide(p.id, p.sha);
    expect(r1.body.code).toBe('EVAL_OVERRIDE_REQUIRED'); expect(r1.body.message).toMatch(/inconclusive/);
    const r2 = await decide(p.id, p.sha, { overrideReason: 'Accepting the risk, see ticket 12.' });
    expect(r2.status).toBe(200);
    const au = await rows(`select detail from audit_events where action='agent.version.decide' and subject=$1 and result='ok'`, [p.id]);
    expect(au[0].detail.evaluation.outcome).toBe('inconclusive');
  });
  it('a verified candidate promotes with no override, and no reason is stored', async () => {
    const p = await propose();
    await evidence(p, 'HO', BETTER.b, BETTER.c);
    const r = await decide(p.id, p.sha, { overrideReason: 'not needed here, but given' });
    expect(r.status).toBe(200); expect(r.body.proposal.overrideReason).toBeNull();
    const au = await rows(`select detail from audit_events where action='agent.version.decide' and subject=$1 and result='ok'`, [p.id]);
    expect(au[0].detail.evaluation.outcome).toBe('verified_better'); expect(au[0].detail.overrideReason).toBeUndefined();
    expect(au[0].detail.evaluation.datasetSha).toMatch(/^[0-9a-f]{64}$/);
  });
  it('a verified candidate promotes without any override field at all', async () => {
    const p = await propose();
    await evidence(p, 'HO', BETTER.b, BETTER.c);
    expect((await decide(p.id, p.sha)).status).toBe(200);
  });
  it('worse is refused (409 EVAL_WORSE) even with an override, audited, still pending', async () => {
    const p = await propose();
    await evidence(p, 'HO', BETTER.c, BETTER.b);
    const r = await decide(p.id, p.sha, { overrideReason: 'I know better than the evaluation.' });
    expect(r.status).toBe(409); expect(r.body.code).toBe('EVAL_WORSE');
    expect((await get(A, p.id)).status).toBe('pending');
    const au = await rows(`select result, detail from audit_events where action='agent.version.decide' and subject=$1 order by id desc limit 1`, [p.id]);
    expect(au[0].result).toBe('denied'); expect(au[0].detail.code).toBe('EVAL_WORSE'); expect(au[0].detail.evaluation.outcome).toBe('worse');
  });
  it('a worse candidate can still be rejected, with no override', async () => {
    const p = await propose();
    await evidence(p, 'HO', BETTER.c, BETTER.b);
    const r = await decide(p.id, p.sha, { note: 'measured worse' }, 'reject');
    expect(r.status).toBe(200); expect(r.body.proposal.status).toBe('rejected'); expect(r.body.proposal.overrideReason).toBeNull();
  });
  it('an override sent with a reject is not stored', async () => {
    const p = await propose();
    const r = await decide(p.id, p.sha, { overrideReason: 'irrelevant for a reject' }, 'reject');
    expect(r.status).toBe(200); expect(r.body.proposal.overrideReason).toBeNull();
  });
  it('the existing refusals keep their order: a stale base is AGENT_CHANGED before the evidence gate', async () => {
    const p = await propose();
    const a = await agent();
    expect((await A.req('PATCH', `/agents/${AG}`, { skills: [...a.skills, 'Elsewhere' + n] }, { 'if-match': String((await A.req('GET', `/agents/${AG}`)).body.agent.rowVersion) })).status).toBe(200);
    const r = await decide(p.id, p.sha);
    expect(r.body.code).toBe('AGENT_CHANGED');
  });
  it('self approval is still refused first', async () => {
    const p = await propose();
    const r = await A.req('POST', `/version-proposals/${p.id}/decision`, { decision: 'promote', sha: p.sha, overrideReason: 'my own proposal, fine' });
    expect(r.body.code).toBe('SELF_APPROVAL');
  });
  it('members still cannot decide', async () => {
    const p = await propose();
    expect((await M.req('POST', `/version-proposals/${p.id}/decision`, { decision: 'promote', sha: p.sha, overrideReason: 'a member trying' })).status).toBe(403);
  });
});
