import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeTestApp, withAdmin, type TestApp, type Browser } from './helpers.ts';
import { seedDemo } from '../src/seed/demo.ts';
import { PLAN } from './c85-helpers.ts';
import { whyNotPlannable, UNITS, METRIC_UNIT } from '../src/organization/plan-metrics.ts';

const ST = { baseline: 'No change: keep the current chart as it is.', expectedCost: 'No added cost is expected in this test.' };
/** c85 fix round: admin-only readout, a distinct code for a missing plan sha, honest units, lock hardening, U+0000. */
let t: TestApp;
let A: Browser, B: Browser, M: Browser, aId = '', mId = '';
let pTwo: { id: string; sha: string }, pFour: { id: string; sha: string }; // made before any fixture revision (a fixture revision has no lines)
let n = 0, fourSha = '';
const key = () => ({ 'idempotency-key': 'fx' + n++ });
const q = async (sql: string, p: unknown[] = []) => (await t.pool.query(sql, p)).rows;
type Edge = { supervisorId: string; subordinateId: string; edgeType?: string };
const moved = (edges: Edge[], sub: string, sup: string) => edges.map((e) => (e.subordinateId === sub ? { ...e, supervisorId: sup } : e));
async function propose(sub: string, sup: string) {
  const g = (await A.req('GET', '/organization/graph')).body;
  return (await A.req('POST', '/organization/proposals', { ...ST, title: 'Move ' + sub, why: 'x', baseRevision: g.revision.seq, edges: moved(g.edges, sub, sup) }, key())).body.proposal as { id: string; sha: string };
}
const fixture = async (id: string, seq: number, ageDays: number, plan: unknown) => {
  await q(`insert into org_revisions(tenant_id, seq, note, created_by, active_from) values ('t-1', $1, 'fixture', 'fx', now() - interval '${ageDays} days')`, [seq]);
  await q(`insert into org_proposals(id, tenant_id, title, why, base_revision, edges, payload_sha, status, created_by, applied_revision, decided_by, decided_at, plan, plan_sha) values ($1,'t-1','F','x',1,'[]'::jsonb,$2,'applied','fx',$3,'fx2',now(),$4::jsonb,$5)`, [id, id.padEnd(64, '0').replace(/[^0-9a-f]/g, '0'), seq, JSON.stringify(plan), 'b'.repeat(64)]);
};

beforeAll(async () => {
  t = await makeTestApp({ staffingStepMs: 3_600_000, conversationSimMs: 3_600_000, writeLimits: { proposals: { max: 1000, windowMs: 60_000 } } });
  const w = await withAdmin(t.app);
  A = w.admin; aId = w.adminId;
  const b = await w.member('Bea'); B = b.b;
  expect((await A.req('PATCH', `/users/${b.id}`, { role: 'admin' })).status).toBe(200);
  const m = await w.member('Mia'); M = m.b; mId = m.id;
  await seedDemo(t.app.db, 't-1', aId);
  pTwo = await propose('writer-01', 'ops-01');
  pFour = await propose('tester-01', 'ops-01');
  const setFour = await A.req('PUT', `/organization/proposals/${pFour.id}/plan`, PLAN);
  expect((await B.req('POST', `/organization/proposals/${pFour.id}/decision`, { decision: 'approve', sha: pFour.sha, planSha: setFour.body.sha })).status).toBe(200);
  fourSha = setFour.body.sha;
});
afterAll(async () => { await t.close(); });

describe('2: a missing plan sha has its own code; a wrong one stays PROPOSAL_CHANGED', () => {
  it('names the cause when no planSha is sent, and keeps PROPOSAL_CHANGED for a wrong sha', async () => {
    const p = pTwo;
    const set = await A.req('PUT', `/organization/proposals/${p.id}/plan`, PLAN);
    const none = await B.req('POST', `/organization/proposals/${p.id}/decision`, { decision: 'approve', sha: p.sha });
    expect(none.status).toBe(409);
    expect(none.body.code).toBe('PLAN_SHA_REQUIRED');
    expect(none.body.message).toMatch(/change plan/i);
    expect(none.body.message).toMatch(/API/);
    const wrong = await B.req('POST', `/organization/proposals/${p.id}/decision`, { decision: 'approve', sha: p.sha, planSha: 'f'.repeat(64) });
    expect(wrong.status).toBe(409);
    expect(wrong.body.code).toBe('PROPOSAL_CHANGED');
    const right = await B.req('POST', `/organization/proposals/${p.id}/decision`, { decision: 'approve', sha: p.sha, planSha: set.body.sha });
    expect(['PLAN_SHA_REQUIRED', 'PROPOSAL_CHANGED']).not.toContain(right.body?.code); // the plan check passes (the chart moved on after beforeAll, so ORG_CHANGED is what stops it)
  });
});

describe('1: the readout is administrator-only (counts include private missions)', () => {
  it('a member is refused like the other administrator-only organisation routes; an administrator reads it; anonymous is 401', async () => {
    const p = await propose('coder-01', 'ops-01');
    const m = await M.req('GET', `/organization/proposals/${p.id}/plan`);
    expect(m.status).toBe(403);
    expect(m.body.code).toBe('FORBIDDEN');
    expect((await A.req('GET', `/organization/proposals/${p.id}/plan`)).status).toBe(200);
    expect((await t.app.inject({ method: 'GET', url: `/api/v1/organization/proposals/${p.id}/plan` })).statusCode).toBe(401);
  });

  it('a private mission of a member is counted for an administrator and never shown to the member', async () => {
    await fixture('OP-P', 80, 2, { ...PLAN, primary: { metric: 'scorecard.started', direction: 'up', margin: 1 }, guardrails: [], minN: 1 });
    const mission = (await M.req('POST', '/missions', { text: 'My private mission', files: [], shared: false }, key())).body.mission.id as string;
    const before = (await A.req('GET', '/organization/proposals/OP-P/plan')).body.observations[0].post as number;
    await q(`insert into mission_runs(mission_id, revision, status, started_at) values ($1, 1, 'running', (select active_from + interval '1 hour' from org_revisions where seq = 80))`, [mission]);
    const after = await A.req('GET', '/organization/proposals/OP-P/plan');
    expect(after.body.observations[0].post).toBe(before + 1);
    const asMember = await M.req('GET', '/organization/proposals/OP-P/plan');
    expect(asMember.status).toBe(403);
    expect(JSON.stringify(asMember.body)).not.toMatch(/"post"|observations/);
  });
});

describe('3: honest units', () => {
  it('every unit that can be tied to real work filters demo and deleted missions', () => {
    for (const id of ['grant', 'confirmed_tag', 'owner_change', 'task', 'attempt', 'review', 'run', 'mission_end', 'delegated', 'brief']) expect(UNITS[id].sql, id).toMatch(/not m\.demo|not r\.demo/);
  });
  it('lessons rolled back and evaluation verdicts are not countable (their unit would count something else) and are refused with a plain message', () => {
    for (const id of ['dimension.knowledge.lessons_rolled_back', 'dimension.evolutionary.verdict_outcomes']) {
      expect(id in METRIC_UNIT, id).toBe(false);
      expect(whyNotPlannable(id), id).toMatch(/cannot be planned/);
    }
  });
  it('the readout says plainly when another org revision took effect inside the post window', async () => {
    await fixture('OP-Q', 81, 30, { ...PLAN, minN: 1, guardrails: [], primary: { metric: 'dimension.evolutionary.org_revisions', direction: 'up', margin: 1 } });
    await q(`insert into org_revisions(tenant_id, seq, note, created_by, active_from) values ('t-1', 82, 'later', 'fx', now() - interval '25 days')`);
    const r = (await A.req('GET', '/organization/proposals/OP-Q/plan')).body;
    expect(r.otherChanges).toBe(1);
    expect(r.verdictText).toMatch(/another change took effect during the window: counts mix both/i);
    await fixture('OP-R', 83, 60, { ...PLAN, minN: 1, guardrails: [], primary: { metric: 'dimension.evolutionary.org_revisions', direction: 'up', margin: 1 } });
    expect((await A.req('GET', '/organization/proposals/OP-R/plan')).body.otherChanges).toBe(0);
  });
});

describe('4: the lock', () => {
  it('the readout shows the stored sha for an applied proposal and says when it disagrees with the recomputed one', async () => {
    const ok = (await A.req('GET', '/organization/proposals/OP-P/plan')).body;
    expect(ok.sha).toBe('b'.repeat(64)); // the stored column, not a recomputation
    expect(ok.shaMatches).toBe(false);   // the fixture stored a sha that is not the plan's
    expect(ok.verdictText).toMatch(/does not match/i);
    const good = (await A.req('GET', `/organization/proposals/${pFour.id}/plan`)).body;
    expect(good.proposalStatus).toBe('applied');
    expect((await q('select plan_sha from org_proposals where id=$1', [pFour.id]))[0].plan_sha).toBe(fourSha);
    expect(good.sha).toBe(fourSha);
    expect(good.shaMatches).toBe(true);
  });

  it('the trigger refuses a change of plan in the same UPDATE that moves pending to applied (only plan_sha may be set)', async () => {
    await q(`insert into org_proposals(id, tenant_id, title, why, base_revision, edges, payload_sha, created_by, plan) values ('OP-T','t-1','T','x',1,'[]'::jsonb,$1,'fx',$2::jsonb)`, ['e'.repeat(64), JSON.stringify(PLAN)]);
    await q(`insert into org_revisions(tenant_id, seq, note, created_by) values ('t-1', 84, 'fx', 'fx')`);
    await expect(t.pool.query(`update org_proposals set status='applied', applied_revision=84, plan = '{"x":1}'::jsonb, plan_sha=$1 where id='OP-T'`, ['a'.repeat(64)])).rejects.toThrow(/locked/);
    await expect(t.pool.query(`update org_proposals set plan_sha=$1 where id='OP-T'`, ['a'.repeat(64)])).rejects.toThrow(/locked/); // sha only at the move to applied
    await t.pool.query(`update org_proposals set status='applied', applied_revision=84, plan_sha=$1 where id='OP-T'`, ['a'.repeat(64)]);
    expect((await q(`select status from org_proposals where id='OP-T'`))[0].status).toBe('applied');
  });
});

describe('5: U+0000 is a 400, not a 500', () => {
  it('is refused in the plan why and in an amendment reason', async () => {
    const p = await propose('coder-01', 'ops-01');
    const r = await A.req('PUT', `/organization/proposals/${p.id}/plan`, { ...PLAN, why: 'A reason with a NUL byte \u0000 in the middle of it' });
    expect(r.status).toBe(400);
    expect(r.body.fieldErrors.why).toBeTruthy();
    const a = await A.req('POST', '/organization/proposals/OP-P/plan/amendments', { plan: { ...PLAN, minN: 3 }, reason: 'A reason with a NUL byte \u0000 in the middle', baseAmendments: 0 });
    expect(a.status).toBe(400);
    const b = await A.req('POST', '/organization/proposals/OP-P/plan/amendments', { plan: { ...PLAN, minN: 3, why: 'Plan text with a NUL \u0000 byte inside it' }, reason: 'A perfectly good reason for the amendment.', baseAmendments: 0 });
    expect(b.status).toBe(400);
  });
});
