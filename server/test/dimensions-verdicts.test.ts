import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
import { makeTestApp, withAdmin, type TestApp, type Browser } from './helpers.ts';
import { makeDataset, addRun } from './eval-fixtures.ts';

// c54 (M1b 1): evolutionary.verdict_outcomes is recomputed at read time with verdictV2 over c47's STORED runs (read only): nothing
// here runs an evaluation, writes a run or stores a verdict. n, window and "not enough evidence" as in c46; no composite number.
let t: TestApp;
let A: Browser, M: Browser;
const AG = 'knowledge-01';
let seq = 0;
const ids = (k: number) => Array.from({ length: k }, (_, i) => i);
async function propose() {
  const a = (await A.req('GET', `/agents/${AG}`)).body.agent;
  const r = await A.req('POST', `/agents/${AG}/version-proposals`, { title: 'Try ' + ++seq, hypothesis: 'Fewer review rounds.', candidate: { model: 'qwen-72b', skills: [...a.skills, 'Skill-' + seq], tools: a.tools }, baseVersionId: a.versionId }, { 'idempotency-key': 'v' + seq });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return { id: r.body.proposal.id as string, baseId: a.versionId as string };
}
/** base scores and candidate scores on dataset ds, an honest judge family and an independent evaluator */
async function runs(p: { id: string; baseId: string }, ds: string, b: number[], c: number[], evaluator: string) {
  const tag = 'V' + ++seq;
  await addRun(t.pool, { id: tag + 'b', datasetId: ds, versionId: p.baseId, scores: b, judge: 'gemini-judge', evaluator });
  await addRun(t.pool, { id: tag + 'c', datasetId: ds, proposalId: p.id, scores: c, judge: 'gemini-judge', evaluator });
}
const cell = (body: any, key: string) => body.dimensions.flatMap((d: any) => d.cells).find((c: any) => c.key === key);
const verdicts = async (b: Browser, qs = '') => { const r = await b.req('GET', '/company/dimensions' + qs); expect(r.status).toBe(200); return cell(r.body, 'evolutionary.verdict_outcomes'); };

beforeAll(async () => {
  t = await makeTestApp({ staffingStepMs: 3_600_000, conversationSimMs: 3_600_000, writeLimits: { proposals: { max: 1000, windowMs: 60_000 } } });
  const w = await withAdmin(t.app);
  A = w.admin;
  const bea = await w.member('Bea');
  expect((await A.req('PATCH', `/users/${bea.id}`, { role: 'admin' })).status).toBe(200);
  M = (await w.member('Mia')).b;
  await makeDataset(t.pool, { id: 'HO1', split: 'holdout', cases: 12 });
  await makeDataset(t.pool, { id: 'HO2', split: 'holdout', cases: 12 });
  await makeDataset(t.pool, { id: 'HO3', split: 'holdout', cases: 12 });
  await makeDataset(t.pool, { id: 'DEV', split: 'dev', cases: 12 });
  (globalThis as any).__bea = bea.id;
});
afterAll(async () => { await t?.close(); });

describe('evolutionary.verdict_outcomes from stored runs', () => {
  it('no stored run: not measured as a count, but a real "not enough evidence" cell (n = 0), no longer "unmeasured"', async () => {
    const c = await verdicts(M);
    expect([c.state, c.value, c.n]).toEqual(['none', null, 0]);
    expect(c.evidence.startsWith('not enough evidence (n = 0)')).toBe(true);
  });
  it('better, worse and an inconclusive one (a dev dataset is refused) are counted from the runs; the count is public to a member and never a score', async () => {
    const bea = (globalThis as any).__bea as string;
    const better = await propose(); await runs(better, 'HO1', ids(12).map(() => 40), ids(12).map((i) => 70 + (i % 3)), bea);
    const worse = await propose(); await runs(worse, 'HO2', ids(12).map(() => 70), ids(12).map(() => 40), bea);
    const dev = await propose(); await runs(dev, 'DEV', ids(12).map(() => 40), ids(12).map(() => 70), bea);
    for (const b of [A, M]) {
      const c = await verdicts(b);
      expect(c).toMatchObject({ state: 'ok', value: 3, n: 3, basis: 'window', unit: 'count', minN: 3, scope: 'company' });
      expect(c.evidence).toContain('1 verified better, 1 inconclusive, 1 worse');
      expect(c.evidence).toMatch(/recomputed|stored/);
    }
  });
  it('writes nothing: no eval_runs, results or proposals changed by reading', async () => {
    const snap = async () => JSON.stringify([(await t.pool.query('select count(*)::int n from eval_runs')).rows, (await t.pool.query('select count(*)::int n from eval_results')).rows, (await t.pool.query('select count(*)::int n, max(status) s from agent_version_proposals')).rows]);
    const before = await snap();
    await verdicts(A); await verdicts(M, '?window=7d');
    expect(await snap()).toBe(before);
  });
});
