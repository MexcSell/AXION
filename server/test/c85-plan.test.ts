import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash } from 'node:crypto';
import { makeTestApp, withAdmin, type TestApp, type Browser } from './helpers.ts';
import { seedDemo } from '../src/seed/demo.ts';

const ST = { baseline: 'No change: keep the current chart as it is.', expectedCost: 'No added cost is expected in this test.' };

/**
 * c85 (R5-1, first slice), item 1: an optional plan attached to an org change proposal. It records what was planned BEFORE the change.
 * It is not pre-registration in the statistical sense and gives no verdict. Brief: web/docs/improve/cycles/c85-brief.md.
 */
let t: TestApp;
let A: Browser, B: Browser, M: Browser;
let aId = '', bId = '';
let n = 0;
const key = () => ({ 'idempotency-key': 'plan' + n++ });
const rows = async (sql: string, p: unknown[] = []) => (await t.pool.query(sql, p)).rows;
type Edge = { supervisorId: string; subordinateId: string; edgeType?: string };
const graph = async () => (await A.req('GET', '/organization/graph')).body as { revision: { id: number; seq: number }; edges: Edge[] };
const moved = (edges: Edge[], sub: string, sup: string) => edges.map((e) => (e.subordinateId === sub ? { ...e, supervisorId: sup } : e));
async function propose(sub: string, sup: string) {
  const g = await graph();
  const r = await A.req('POST', '/organization/proposals', { ...ST, title: `Move ${sub} under ${sup}`, why: 'Shorter path for reviews.', baseRevision: g.revision.seq, edges: moved(g.edges, sub, sup) }, key());
  expect(r.status).toBe(201);
  return r.body.proposal as { id: string; sha: string };
}
import { PLAN } from './c85-helpers.ts';
const putPlan = (by: Browser, id: string, plan: unknown) => by.req('PUT', `/organization/proposals/${id}/plan`, plan);
const getPlan = (by: Browser, id: string) => by.req('GET', `/organization/proposals/${id}/plan`);
/** Independent recomputation of the documented canonical form (key order fixed, guardrails sorted by metric id). */
const canonSha = (p: typeof PLAN) => createHash('sha256').update(JSON.stringify({
  v: 1, primaryMetric: p.primary.metric, direction: p.primary.direction, margin: p.primary.margin, minN: p.minN, windowDays: p.windowDays,
  guardrails: [...p.guardrails].sort((x, y) => (x.metric < y.metric ? -1 : x.metric > y.metric ? 1 : 0)).map((g) => ({ metric: g.metric, margin: g.margin })), why: p.why,
})).digest('hex');

beforeAll(async () => {
  t = await makeTestApp({ staffingStepMs: 3_600_000, conversationSimMs: 3_600_000 });
  const w = await withAdmin(t.app);
  A = w.admin; aId = w.adminId;
  const b = await w.member('Bea'); B = b.b; bId = b.id;
  expect((await A.req('PATCH', `/users/${bId}`, { role: 'admin' })).status).toBe(200);
  M = (await w.member('Mia')).b;
  await seedDemo(t.app.db, 't-1', aId);
});
afterAll(async () => { await t.close(); });

describe('item 1: the plan record', () => {
  let p: { id: string; sha: string };
  it('a proposal without a plan works exactly as before, and its plan reads as none', async () => {
    p = await propose('coder-01', 'ops-01');
    const g = await getPlan(M, p.id);
    expect(g.status).toBe(200);
    expect(g.body.plan).toBeNull();
    expect(g.body.verdict).toBe('no_plan');
    expect((await rows('select plan, plan_sha from org_proposals where id=$1', [p.id]))[0]).toEqual({ plan: null, plan_sha: null });
  });

  it('only an administrator sets a plan; anonymous and members are refused', async () => {
    expect((await putPlan(M, p.id, PLAN)).status).toBe(403);
    expect((await t.app.inject({ method: 'PUT', url: `/api/v1/organization/proposals/${p.id}/plan`, payload: PLAN })).statusCode).toBe(401);
    expect((await rows('select plan from org_proposals where id=$1', [p.id]))[0].plan).toBeNull();
  });

  it('refuses a free-text metric, an unknown id, and a registry row that has no recorded observations', async () => {
    for (const metric of ['my own made-up metric', 'scorecard.nope', 'kpi.approvals', 'dimension.environmental.site_navigation', 'process.cost']) {
      const r = await putPlan(A, p.id, { ...PLAN, primary: { ...PLAN.primary, metric } });
      expect(r.status, metric).toBe(400);
      expect(r.body.fieldErrors?.['primary.metric'], metric).toBeTruthy();
    }
    const g = await putPlan(A, p.id, { ...PLAN, guardrails: [{ metric: 'free text', margin: 1 }] });
    expect(g.status).toBe(400);
    expect(g.body.fieldErrors['guardrails.0.metric']).toBeTruthy();
  });

  it('refuses every out-of-range field (window 7 to 90 days, 0 to 3 guardrails, why 20 to 1000, margin and n positive) and extra keys', async () => {
    const bad: [string, unknown][] = [
      ['window 6', { ...PLAN, windowDays: 6 }], ['window 91', { ...PLAN, windowDays: 91 }], ['window 14.5', { ...PLAN, windowDays: 14.5 }],
      ['4 guardrails', { ...PLAN, guardrails: ['scorecard.failure_rate', 'scorecard.started', 'scorecard.finished', 'scorecard.throughput'].map((metric) => ({ metric, margin: 1 })) }],
      ['duplicate guardrail', { ...PLAN, guardrails: [{ metric: 'scorecard.failure_rate', margin: 1 }, { metric: 'scorecard.failure_rate', margin: 2 }] }],
      ['primary as guardrail', { ...PLAN, guardrails: [{ metric: 'process.first_pass_acceptance', margin: 1 }] }],
      ['why 19', { ...PLAN, why: 'x'.repeat(19) }], ['why 1001', { ...PLAN, why: 'x'.repeat(1001) }],
      ['margin 0', { ...PLAN, primary: { ...PLAN.primary, margin: 0 } }], ['margin negative', { ...PLAN, primary: { ...PLAN.primary, margin: -1 } }],
      ['guardrail margin 0', { ...PLAN, guardrails: [{ metric: 'scorecard.failure_rate', margin: 0 }] }],
      ['minN 0', { ...PLAN, minN: 0 }], ['direction sideways', { ...PLAN, primary: { ...PLAN.primary, direction: 'sideways' } }],
      ['extra key', { ...PLAN, zz: 1 }], ['no primary', { ...PLAN, primary: undefined }],
    ];
    for (const [name, body] of bad) expect((await putPlan(A, p.id, body)).status, name).toBe(400);
    expect((await rows('select plan from org_proposals where id=$1', [p.id]))[0].plan).toBeNull();
  });

  it('sets a plan on a pending proposal and can replace it; the readout shows the current plan and its sha', async () => {
    const r = await putPlan(A, p.id, PLAN);
    expect(r.status).toBe(200);
    expect(r.body.plan).toMatchObject({ primary: PLAN.primary, minN: 20, windowDays: 14 });
    expect(r.body.sha).toBe(canonSha(PLAN));
    const plan2 = { ...PLAN, minN: 30, guardrails: [] };
    expect((await putPlan(A, p.id, plan2)).status).toBe(200);
    const g = await getPlan(M, p.id);
    expect(g.body.plan.minN).toBe(30);
    expect(g.body.plan.guardrails).toEqual([]);
    expect(g.body.sha).toBe(canonSha(plan2));
    expect(g.body.locked).toBe(false);
    expect(await rows(`select count(*)::int n from audit_events where action='org.proposal.plan.set' and subject=$1 and result='ok'`, [p.id])).toEqual([{ n: 2 }]);
  });

  it('the proposal sha, its create and its list shape are unchanged by a plan', async () => {
    const list = (await M.req('GET', '/organization/proposals')).body.proposals.find((x: any) => x.id === p.id);
    expect(list.sha).toBe(p.sha);
    expect(Object.keys(list)).not.toContain('plan');
  });

  it('a plan can be set on a proposal that has none, only by an administrator, and an unknown proposal is 404', async () => {
    expect((await putPlan(A, 'OP-NOPE', PLAN)).status).toBe(404);
  });

  it('approving a proposal that has a plan needs the plan sha the approver reviewed (a replaced plan is not approved by accident)', async () => {
    const noSha = await B.req('POST', `/organization/proposals/${p.id}/decision`, { decision: 'approve', sha: p.sha });
    expect(noSha.status).toBe(409);
    expect(noSha.body.code).toBe('PROPOSAL_CHANGED');
    const wrong = await B.req('POST', `/organization/proposals/${p.id}/decision`, { decision: 'approve', sha: p.sha, planSha: canonSha(PLAN) });
    expect(wrong.status).toBe(409);
    expect((await rows('select status from org_proposals where id=$1', [p.id]))[0].status).toBe('pending');
  });

  it('at approval the plan sha is fixed into the record and audited; the plan then cannot change', async () => {
    const plan = (await getPlan(A, p.id)).body;
    const r = await B.req('POST', `/organization/proposals/${p.id}/decision`, { decision: 'approve', sha: p.sha, planSha: plan.sha, note: 'Agreed.' });
    expect(r.status).toBe(200);
    expect(r.body.proposal.status).toBe('applied');
    const row = (await rows('select plan, plan_sha from org_proposals where id=$1', [p.id]))[0];
    expect(row.plan_sha).toBe(plan.sha);
    expect(row.plan_sha).toBe(canonSha({ ...PLAN, minN: 30, guardrails: [] }));
    const audit = (await rows(`select detail from audit_events where action='org.proposal.plan.lock' and subject=$1 and result='ok'`, [p.id]));
    expect(audit.length).toBe(1);
    expect(audit[0].detail.planSha).toBe(plan.sha);
    expect((await getPlan(M, p.id)).body).toMatchObject({ locked: true, sha: plan.sha });
    // no route changes it
    const again = await putPlan(A, p.id, PLAN);
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('PLAN_LOCKED');
    // and the database refuses a direct write, from outside the routes too
    await expect(t.pool.query(`update org_proposals set plan = '{"x":1}'::jsonb where id=$1`, [p.id])).rejects.toThrow(/locked/);
    await expect(t.pool.query(`update org_proposals set plan_sha = $2 where id=$1`, [p.id, 'a'.repeat(64)])).rejects.toThrow(/locked/);
    expect((await rows('select plan_sha from org_proposals where id=$1', [p.id]))[0].plan_sha).toBe(plan.sha);
  });

  it('a rejected, withdrawn or expired proposal keeps its plan unchanged: the plan can be set only while pending', async () => {
    const q = await propose('writer-01', 'coder-01');
    expect((await putPlan(A, q.id, PLAN)).status).toBe(200);
    expect((await B.req('POST', `/organization/proposals/${q.id}/decision`, { decision: 'reject', sha: q.sha, note: 'No.' })).status).toBe(200);
    const r = await putPlan(A, q.id, { ...PLAN, minN: 99 });
    expect(r.status).toBe(409);
    expect(['PLAN_LOCKED', 'PROPOSAL_NOT_PENDING']).toContain(r.body.code);
    expect((await rows('select plan from org_proposals where id=$1', [q.id]))[0].plan.minN).toBe(20);
  });

  it('a proposal approved without a plan keeps working and has no plan to lock', async () => {
    const g = await graph();
    const r = await A.req('POST', '/organization/proposals', { ...ST, title: 'Plain', why: 'x', baseRevision: g.revision.seq, edges: moved(g.edges, 'tester-01', 'ops-01') }, key());
    const q = r.body.proposal;
    const d = await B.req('POST', `/organization/proposals/${q.id}/decision`, { decision: 'approve', sha: q.sha });
    expect(d.status).toBe(200);
    expect((await rows('select plan, plan_sha from org_proposals where id=$1', [q.id]))[0]).toEqual({ plan: null, plan_sha: null });
    expect((await putPlan(A, q.id, PLAN)).status).toBe(409);
  });
});
