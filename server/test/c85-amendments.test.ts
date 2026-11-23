import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeTestApp, withAdmin, type TestApp, type Browser } from './helpers.ts';
import { seedDemo } from '../src/seed/demo.ts';
import { PLAN } from './c85-helpers.ts';

const ST = { baseline: 'No change: keep the current chart as it is.', expectedCost: 'No added cost is expected in this test.' };
/**
 * c85 item 2: after approval a change to the plan is never an edit. It is an amendment row (new values, a reason of at least 20 characters,
 * the actor, the database clock), append-only with all four guards, audited, and the readout flags it plainly.
 */
let t: TestApp;
let A: Browser, B: Browser, M: Browser;
let aId = '', bId = '';
let n = 0;
const key = () => ({ 'idempotency-key': 'am' + n++ });
const rows = async (sql: string, p: unknown[] = []) => (await t.pool.query(sql, p)).rows;
type Edge = { supervisorId: string; subordinateId: string; edgeType?: string };
const moved = (edges: Edge[], sub: string, sup: string) => edges.map((e) => (e.subordinateId === sub ? { ...e, supervisorId: sup } : e));
async function proposeAndApprove(sub: string, sup: string, plan: unknown | null) {
  const g = (await A.req('GET', '/organization/graph')).body;
  const p = (await A.req('POST', '/organization/proposals', { ...ST, title: `Move ${sub}`, why: 'x', baseRevision: g.revision.seq, edges: moved(g.edges, sub, sup) }, key())).body.proposal;
  let planSha: string | undefined;
  if (plan) planSha = (await A.req('PUT', `/organization/proposals/${p.id}/plan`, plan)).body.sha;
  const d = await B.req('POST', `/organization/proposals/${p.id}/decision`, { decision: 'approve', sha: p.sha, ...(planSha ? { planSha } : {}) });
  expect(d.status).toBe(200);
  return p.id as string;
}
const amend = (by: Browser, id: string, body: unknown) => by.req('POST', `/organization/proposals/${id}/plan/amendments`, body);
const REASON = 'The first window was too short to see the effect.';

beforeAll(async () => {
  t = await makeTestApp({ staffingStepMs: 3_600_000, conversationSimMs: 3_600_000, writeLimits: { proposals: { max: 1000, windowMs: 60_000 } } });
  const w = await withAdmin(t.app);
  A = w.admin; aId = w.adminId;
  const b = await w.member('Bea'); B = b.b; bId = b.id;
  expect((await A.req('PATCH', `/users/${bId}`, { role: 'admin' })).status).toBe(200);
  M = (await w.member('Mia')).b;
  await seedDemo(t.app.db, 't-1', aId);
});
afterAll(async () => { await t.close(); });

describe('item 2: amendments', () => {
  let id: string;
  it('refuses an amendment while the proposal is pending, on a proposal without a plan, and on an unknown id', async () => {
    const g = (await A.req('GET', '/organization/graph')).body;
    const pend = (await A.req('POST', '/organization/proposals', { ...ST, title: 'Pending', why: 'x', baseRevision: g.revision.seq, edges: moved(g.edges, 'coder-01', 'ops-01') }, key())).body.proposal;
    await A.req('PUT', `/organization/proposals/${pend.id}/plan`, PLAN);
    const r = await amend(A, pend.id, { plan: { ...PLAN, minN: 40 }, reason: REASON, baseAmendments: 0 });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('PLAN_NOT_APPLIED');
    const noPlan = await proposeAndApprove('tester-01', 'ops-01', null);
    expect((await amend(A, noPlan, { plan: PLAN, reason: REASON, baseAmendments: 0 })).body.code).toBe('PLAN_MISSING');
    expect((await amend(A, 'OP-NOPE', { plan: PLAN, reason: REASON, baseAmendments: 0 })).status).toBe(404);
    expect(await rows('select count(*)::int n from org_plan_amendments')).toEqual([{ n: 0 }]);
    // the pending one is withdrawn so the next proposal starts from the same chart
    expect((await A.req('POST', `/organization/proposals/${pend.id}/withdraw`, {})).status).toBe(200);
  });

  it('only an administrator amends; a bad plan, a short reason, an unchanged plan and a stale base are refused', async () => {
    id = await proposeAndApprove('writer-01', 'coder-01', PLAN);
    expect((await amend(M, id, { plan: { ...PLAN, minN: 40 }, reason: REASON, baseAmendments: 0 })).status).toBe(403);
    expect((await amend(A, id, { plan: { ...PLAN, minN: 40 }, reason: 'too short', baseAmendments: 0 })).status).toBe(400);
    expect((await amend(A, id, { plan: { ...PLAN, primary: { ...PLAN.primary, metric: 'free text' }, minN: 40 }, reason: REASON, baseAmendments: 0 })).status).toBe(400);
    expect((await amend(A, id, { plan: PLAN, reason: REASON, baseAmendments: 0 })).status).toBe(400); // nothing changed
    expect((await amend(A, id, { plan: { ...PLAN, minN: 40 }, reason: REASON, baseAmendments: 3 })).body.code).toBe('PROPOSAL_CHANGED');
    expect((await amend(A, id, { plan: { ...PLAN, minN: 40 }, reason: REASON })).status).toBe(400);
    expect(await rows('select count(*)::int n from org_plan_amendments')).toEqual([{ n: 0 }]);
  });

  it('an amendment is a new row with the new values, reason, actor and database time; the locked plan and its sha do not change', async () => {
    const before = (await rows('select plan, plan_sha from org_proposals where id=$1', [id]))[0];
    const t0 = (await rows('select now() as n'))[0].n as Date;
    const r = await amend(A, id, { plan: { ...PLAN, minN: 40, windowDays: 21 }, reason: REASON, baseAmendments: 0 });
    expect(r.status).toBe(201);
    const t1 = (await rows('select now() as n'))[0].n as Date;
    expect(r.body.amendments).toHaveLength(1);
    expect(r.body.amendments[0]).toMatchObject({ seq: 1, reason: REASON, createdBy: aId, createdByName: 'Luca', changed: ['minN', 'windowDays'], afterChange: true });
    expect(r.body.amendments[0].plan).toMatchObject({ minN: 40, windowDays: 21 });
    const at = new Date(r.body.amendments[0].createdAt).getTime();
    expect(at).toBeGreaterThanOrEqual(t0.getTime());
    expect(at).toBeLessThanOrEqual(t1.getTime());
    const after = (await rows('select plan, plan_sha from org_proposals where id=$1', [id]))[0];
    expect(after).toEqual(before);
    expect(r.body.plan.minN).toBe(PLAN.minN);          // the locked plan, untouched
    expect(r.body.effectivePlan.minN).toBe(40);        // the plan as amended
    expect(r.body.amendedAfterChange).toBe(true);
    expect(r.body.verdictText).toMatch(/amended after the change/i);
    const a = await rows(`select detail from audit_events where action='org.proposal.plan.amend' and subject=$1 and result='ok'`, [id]);
    expect(a).toHaveLength(1);
    expect(a[0].detail).toMatchObject({ seq: 1, changed: ['minN', 'windowDays'] });
  });

  it('a second amendment is seq 2 and is compared with the first; two writers on the same base cannot both win', async () => {
    const [x, y] = await Promise.all([
      amend(A, id, { plan: { ...PLAN, minN: 50, windowDays: 21 }, reason: REASON + ' (one)', baseAmendments: 1 }),
      amend(B, id, { plan: { ...PLAN, minN: 60, windowDays: 21 }, reason: REASON + ' (two)', baseAmendments: 1 }),
    ]);
    expect([x.status, y.status].sort()).toEqual([201, 409]);
    const list = (await A.req('GET', `/organization/proposals/${id}/plan`)).body;
    expect(list.amendments.map((a: any) => a.seq)).toEqual([1, 2]);
    expect(list.amendments[1].changed).toEqual(['minN']);
    expect(list.amendedAfterChange).toBe(true);
  });

  it('the amendments table refuses UPDATE, DELETE and TRUNCATE, and deletes only under the demo purge flag', async () => {
    await expect(t.pool.query(`update org_plan_amendments set reason = 'changed afterwards, twenty chars' where proposal_id=$1`, [id])).rejects.toThrow(/append-only/);
    await expect(t.pool.query(`delete from org_plan_amendments where proposal_id=$1`, [id])).rejects.toThrow(/append-only/);
    await expect(t.pool.query('truncate org_plan_amendments')).rejects.toThrow(/append-only/);
    expect((await rows('select count(*)::int n from org_plan_amendments where proposal_id=$1', [id]))[0].n).toBe(2);
    const c = await t.pool.connect();
    try {
      await c.query('begin');
      await c.query("set local axion.purge_demo = 'on'");
      await c.query('delete from org_plan_amendments where proposal_id=$1', [id]);
      await c.query('rollback');
    } finally { c.release(); }
  });

  it('a short reason is refused by the database too', async () => {
    await expect(t.pool.query(`insert into org_plan_amendments(tenant_id, proposal_id, seq, plan, plan_sha, reason, created_by) values ('t-1', $1, 9, '{}'::jsonb, $2, 'short', 'x')`, [id, 'a'.repeat(64)])).rejects.toThrow(/check/);
  });
});
