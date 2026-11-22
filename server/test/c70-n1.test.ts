import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
import { makeTestApp, withAdmin, type TestApp } from './helpers.ts';
import { makeDataset, addRun } from './eval-fixtures.ts';
import { tx, type Tx } from '../src/db.ts';
import { loadEvaluations } from '../src/evolution/proposal-evidence.ts';

// c70 (H11b tail, c54 review): loadEvaluations was N+1 on every dimensions read (about six queries per proposal). The query count must not depend on how many proposals there are.
let t: TestApp;
const AG = 'knowledge-01';
let seq = 0;
const ids12 = Array.from({ length: 12 }, (_, i) => i);

async function counted(n: number) {
  return tx(t.app.db, async (c) => {
    const props = (await c.query(`select p.id, p.agent_id, p.created_by, p.base_version_id, p.candidate from agent_version_proposals p where p.tenant_id='t-1' order by p.id limit $1`, [n])).rows;
    let q = 0;
    const spy = { query: (...a: unknown[]) => { q++; return (c as any).query(...a); } } as unknown as Tx;
    const out = await loadEvaluations(spy, 't-1', props);
    return { q, out, n: props.length };
  });
}

beforeAll(async () => {
  t = await makeTestApp({ staffingStepMs: 3_600_000, conversationSimMs: 3_600_000, demoSeed: false, writeLimits: { proposals: { max: 1000, windowMs: 60_000 } } });
  const w = await withAdmin(t.app);
  const bea = await w.member('Bea');
  expect((await w.admin.req('PATCH', `/users/${bea.id}`, { role: 'admin' })).status).toBe(200);
  const a = (await w.admin.req('GET', `/agents/${AG}`)).body.agent;
  for (let i = 0; i < 6; i++) {
    const r = await w.admin.req('POST', `/agents/${AG}/version-proposals`, { title: 'Try ' + ++seq, hypothesis: 'h', candidate: { model: 'qwen-72b', skills: [...a.skills, 'Skill-' + seq], tools: a.tools }, baseVersionId: a.versionId }, { 'idempotency-key': 'n1-' + seq });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const ds = 'HO' + i;
    await makeDataset(t.pool, { id: ds, split: 'holdout', cases: 12 });
    await addRun(t.pool, { id: ds + 'b', datasetId: ds, versionId: a.versionId, scores: ids12.map(() => 40), judge: 'gemini-judge', evaluator: bea.id });
    await addRun(t.pool, { id: ds + 'c', datasetId: ds, proposalId: r.body.proposal.id, scores: ids12.map((x) => 70 + (x % 3)), judge: 'gemini-judge', evaluator: bea.id });
  }
});
afterAll(async () => { await t?.close(); });

describe('loadEvaluations query count', () => {
  it('does not grow with the number of proposals (6 proposals cost the same as 1)', async () => {
    const one = await counted(1), six = await counted(6);
    console.log(`loadEvaluations queries: 1 proposal = ${one.q}, 6 proposals = ${six.q}`);
    expect(six.n).toBe(6);
    expect(six.out.size).toBe(6);
    expect(six.q).toBe(one.q);
  });
});
