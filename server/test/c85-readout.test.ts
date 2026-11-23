import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeTestApp, withAdmin, type TestApp, type Browser } from './helpers.ts';
import { seedDemo } from '../src/seed/demo.ts';

/**
 * c85 item 3: the readout is COUNTS ONLY. For the primary metric and each guardrail it gives the number of observations in the pre and post
 * windows and whether the plan's minimum n is met; it gives no estimate and never says "it worked". The windows are built in SQL from the
 * change time (the org revision's active_from) and the database clock.
 * The changes below are inserted directly with an old active_from, so the windows are fixed relative to the change: the post window of an
 * old change is complete and one of a recent change is not.
 */
let t: TestApp;
let A: Browser, M: Browser;
const q = async (sql: string, p: unknown[] = []) => (await t.pool.query(sql, p)).rows;
const D = (days: number) => `interval '${days} days'`;

async function change(opts: { id: string; seq: number; ageDays: number; plan: unknown | null; status?: string }) {
  await q(`insert into org_revisions(tenant_id, seq, note, created_by, active_from) values ('t-1', $1, 'fixture', 'fx', now() - ${D(opts.ageDays)})`, [opts.seq]);
  await q(
    `insert into org_proposals(id, tenant_id, title, why, base_revision, edges, payload_sha, status, created_by, applied_revision, decided_by, decided_at, plan, plan_sha)
     values ($1,'t-1','Fixture','x',1,'[]'::jsonb,$2,$3,'fx',$4,'fx2',now(),$5::jsonb,$6)`,
    [opts.id, opts.id.padEnd(64, '0').replace(/[^0-9a-f]/g, '0'), opts.status ?? 'applied', (opts.status ?? 'applied') === 'applied' ? opts.seq : null, opts.plan ? JSON.stringify(opts.plan) : null, opts.plan ? 'b'.repeat(64) : null]);
}
/** A lesson proposed `offset` after (or before, negative) the change at revision `seq` (offset is an SQL interval text). */
async function lessonAt(seq: number, offset: string, tenant = 't-1') {
  await q(`insert into lesson_candidates(id, tenant_id, agent_id, role, text, sources, proposed_by, sha256, created_at)
    select 'LC-' || md5(random()::text || clock_timestamp()::text), $2, 'coder-01', 'Coder', 'fixture lesson', '[{"kind":"review","id":"R","note":"n"}]'::jsonb, 'fx', repeat('a', 64), active_from + $3::interval
      from org_revisions where tenant_id = 't-1' and seq = $1`, [seq, tenant, offset]);
}
const planOf = (over: Record<string, unknown> = {}) => ({
  primary: { metric: 'dimension.knowledge.lessons_proposed', direction: 'up', margin: 1 }, minN: 2, windowDays: 14, guardrails: [],
  why: 'Fixture plan for the readout tests.', ...over,
});
const get = (id: string, by = A) => by.req('GET', `/organization/proposals/${id}/plan`);

beforeAll(async () => {
  t = await makeTestApp({ staffingStepMs: 3_600_000, conversationSimMs: 3_600_000, writeLimits: { proposals: { max: 1000, windowMs: 60_000 } } });
  const w = await withAdmin(t.app);
  A = w.admin; M = (await w.member('Mia')).b;
  await seedDemo(t.app.db, 't-1', w.adminId);
  await q(`insert into tenants(id,name) values ('t-2','Other') on conflict do nothing`);
});
afterAll(async () => { await t.close(); });

describe('item 3: the readout counts observations and gives no verdict', () => {
  it('counts each window with closed-open edges at the change time, from the database clock', async () => {
    await change({ id: 'OP-A', seq: 90, ageDays: 300, plan: planOf() });
    for (const off of ['-14 days', '-14 days -1 millisecond', '-1 millisecond', '0 seconds', '14 days -1 millisecond', '14 days']) await lessonAt(90, off);
    await lessonAt(90, '-3 days', 't-2'); // another tenant's lesson is never counted
    const r = await get('OP-A');
    expect(r.status).toBe(200);
    const o = r.body.observations;
    expect(o).toHaveLength(1);
    expect(o[0]).toMatchObject({ role: 'primary', metric: 'dimension.knowledge.lessons_proposed', pre: 2, post: 2, minN: 2, preMet: true, postMet: true });
    expect(o[0].unit).toMatch(/lesson/);
    expect(r.body.change.revision).toBe(90);
    const [dbA] = await q(`select active_from as a from org_revisions where seq = 90`);
    const a = (dbA.a as Date).getTime();
    expect(new Date(r.body.change.activeFrom).getTime()).toBe(a);
    expect(new Date(r.body.windows.pre.from).getTime()).toBe(a - 14 * 86_400_000);
    expect(new Date(r.body.windows.pre.to).getTime()).toBe(a);
    expect(new Date(r.body.windows.post.from).getTime()).toBe(a);
    expect(new Date(r.body.windows.post.to).getTime()).toBe(a + 14 * 86_400_000);
    expect(r.body.windows.postComplete).toBe(true);
  });

  it('with the post window complete and minimum n met in both windows it says "ready for analysis (not computed in this version)", and nothing more', async () => {
    const r = await get('OP-A');
    expect(r.body.verdict).toBe('ready_for_analysis');
    expect(r.body.verdictText).toMatch(/ready for analysis \(not computed in this version\)/i);
    expect(JSON.stringify(r.body)).not.toMatch(/worked|effect size|p-value|significan|confidence interval|improv/i);
    for (const k of Object.keys(r.body)) expect(k, 'no estimate fields').not.toMatch(/^(effect(?!ivePlan)|estimate|pvalue|lift|delta)/i);
  });

  it('below the minimum n in either window it says "not enough evidence yet", never a verdict', async () => {
    await change({ id: 'OP-B', seq: 91, ageDays: 260, plan: planOf({ minN: 3 }) });
    for (const off of ['-2 days', '-1 day', '1 day']) await lessonAt(91, off);
    const r = await get('OP-B');
    expect(r.body.observations[0]).toMatchObject({ pre: 2, post: 1, minN: 3, preMet: false, postMet: false });
    expect(r.body.verdict).toBe('not_enough_evidence');
    expect(r.body.verdictText).toMatch(/not enough evidence yet/i);
    expect(r.body.verdictText).not.toMatch(/ready for analysis/i);
  });

  it('enough observations are still "not enough evidence yet" while the post window is not complete', async () => {
    await change({ id: 'OP-C', seq: 92, ageDays: 3, plan: planOf({ minN: 1 }) });
    await lessonAt(92, '-2 days'); await lessonAt(92, '1 hour');
    const r = await get('OP-C');
    expect(r.body.observations[0]).toMatchObject({ pre: 1, preMet: true, postMet: true });
    expect(r.body.observations[0].post).toBeGreaterThanOrEqual(1); // the demo seed may add its own lessons today
    expect(r.body.windows.postComplete).toBe(false);
    expect(r.body.verdict).toBe('not_enough_evidence');
    expect(r.body.verdictText).toMatch(/window after the change is not complete/i);
  });

  it('counts every guardrail too, and one that is short keeps the readout at "not enough evidence yet"', async () => {
    await change({ id: 'OP-D', seq: 93, ageDays: 220, plan: planOf({ minN: 1, guardrails: [{ metric: 'dimension.knowledge.lessons_accepted', margin: 1 }] }) });
    await lessonAt(93, '-2 days'); await lessonAt(93, '2 days');
    const r = await get('OP-D');
    expect(r.body.observations.map((x: any) => [x.role, x.metric, x.pre, x.post])).toEqual([['primary', 'dimension.knowledge.lessons_proposed', 1, 1], ['guardrail', 'dimension.knowledge.lessons_accepted', 0, 0]]);
    expect(r.body.verdict).toBe('not_enough_evidence');
  });

  it('a proposal that was never applied has no windows; one without a plan reads as no plan', async () => {
    await q(`insert into org_proposals(id, tenant_id, title, why, base_revision, edges, payload_sha, created_by, plan) values ('OP-E','t-1','Pending','x',1,'[]'::jsonb,$1,'fx',$2::jsonb)`, ['c'.repeat(64), JSON.stringify(planOf())]);
    const e = await get('OP-E');
    expect(e.body).toMatchObject({ verdict: 'not_applied', windows: null, change: null, observations: [], locked: false });
    await change({ id: 'OP-F', seq: 94, ageDays: 5, plan: null });
    expect((await get('OP-F')).body).toMatchObject({ verdict: 'no_plan', plan: null, observations: [], windows: null });
  });

  it('an amendment is flagged plainly, and the counts stay those of the plan as locked', async () => {
    await change({ id: 'OP-G', seq: 95, ageDays: 180, plan: planOf({ minN: 5 }) });
    const r = await A.req('POST', '/organization/proposals/OP-G/plan/amendments', { plan: planOf({ minN: 1 }), reason: 'We lowered the bar after seeing the counts.', baseAmendments: 0 });
    expect(r.status).toBe(201);
    expect(r.body.amendedAfterChange).toBe(true);
    expect(r.body.observations[0].minN).toBe(5);
    expect(r.body.verdict).toBe('not_enough_evidence');
    expect(r.body.verdictText).toMatch(/amended after the change/i);
  });

  it('is for administrators only (counts include every mission); anonymous is 401, a member 403, and a foreign or unknown id is 404', async () => {
    expect((await get('OP-A', M)).status).toBe(403);
    expect((await t.app.inject({ method: 'GET', url: '/api/v1/organization/proposals/OP-A/plan' })).statusCode).toBe(401);
    await q(`insert into org_proposals(id, tenant_id, title, why, base_revision, edges, payload_sha, created_by) values ('OP-X','t-2','Other','x',1,'[]'::jsonb,$1,'fx')`, ['d'.repeat(64)]);
    expect((await get('OP-X')).status).toBe(404);
    expect((await get('OP-NOPE')).status).toBe(404);
  });
});
