import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeTestApp, withAdmin, type TestApp, type Browser } from './helpers.ts';

// Improvement cycle 64 (R3-6), item 3: churn budget and cooldown. Both are OPERATOR settings (Config.orgGuardrails, env ORG_*), never
// routes. Every time comparison is the database clock in SQL: the tests move `decided_at` with SQL, they never sleep or fake the app clock.
type Edge = { supervisorId: string; subordinateId: string };
let n = 0;
const key = () => ({ 'idempotency-key': 'ch' + n++ });

async function setup(guard: Record<string, number>) {
  const t = await makeTestApp({ staffingStepMs: 3_600_000, conversationSimMs: 3_600_000, demoSeed: false, orgGuardrails: guard, writeLimits: { proposals: { max: 1000, windowMs: 60_000 } } });
  const w = await withAdmin(t.app);
  const bea = await w.member('Bea');
  expect((await w.admin.req('PATCH', `/users/${bea.id}`, { role: 'admin' })).status).toBe(200);
  const A: Browser = w.admin, B: Browser = bea.b;
  const graph = async () => (await A.req('GET', '/organization/graph')).body as { revision: { seq: number }; edges: Edge[] };
  /** a proposal that re-points each `[sub, mgr]` (so it changes exactly that many lines) */
  const body = async (...mv: [string, string][]) => { const g = await graph(); const to = new Map(mv); return { baseline: 'No change: keep the current chart as it is.', expectedCost: 'No added cost is expected in this test.', title: 'Move ' + mv.map((x) => x[0]).join(','), why: 'churn test', baseRevision: g.revision.seq, edges: g.edges.map((e) => (to.has(e.subordinateId) ? { ...e, supervisorId: to.get(e.subordinateId)! } : e)) }; };
  const propose = async (...mv: [string, string][]) => A.req('POST', '/organization/proposals', await body(...mv), key());
  const dry = async (...mv: [string, string][]) => A.req('POST', '/organization/proposals?dryRun=1', await body(...mv));
  const approve = async (p: { id: string; sha: string }) => B.req('POST', `/organization/proposals/${p.id}/decision`, { decision: 'approve', sha: p.sha });
  const q = (sql: string, p: unknown[] = []) => t.pool.query(sql, p);
  return { t, A, B, propose, dry, approve, q };
}

describe('cooldown after an approved org revision', () => {
  let s: Awaited<ReturnType<typeof setup>>;
  beforeAll(async () => { s = await setup({ cooldownHours: 24 }); });
  afterAll(async () => { await s.t.close(); });

  it('the first proposal is accepted; once approved, a further one is refused with ORG_COOLDOWN and nothing is stored', async () => {
    const p1 = await s.propose(['coder-01', 'ops-01']);
    expect(p1.status).toBe(201);
    expect(p1.body.proposal.result.churn).toMatchObject({ cooldownHours: 24, cooldownEndsInMinutes: null });
    expect((await s.approve(p1.body.proposal)).status).toBe(200);
    const stored = (await s.q('select count(*)::int n from org_proposals')).rows[0].n;
    const p2 = await s.propose(['tester-01', 'ops-01']);
    expect(p2.status).toBe(409);
    expect(p2.body.code).toBe('ORG_COOLDOWN');
    expect(p2.body.message).toMatch(/\b\d+ (hours?|minutes?)\b/);
    expect((await s.q('select count(*)::int n from org_proposals')).rows[0].n).toBe(stored);
  });

  it('the dry run shows the cooldown as churn status and as an error, so the screen can say why', async () => {
    const r = await s.dry(['tester-01', 'ops-01']);
    expect(r.status).toBe(200);
    expect(r.body.result.churn.cooldownEndsInMinutes).toBeGreaterThan(23 * 60);
    expect(r.body.result.errors.map((e: { code: string }) => e.code)).toContain('COOLDOWN');
    expect(r.body.result.ok).toBe(false);
  });

  it('the cooldown is measured with the database clock: 23 h 59 min after the approval it still holds, 24 h later it is over', async () => {
    await s.q(`update org_proposals set decided_at = now() - interval '23 hours 59 minutes' where status='applied'`);
    const inside = await s.propose(['tester-01', 'ops-01']);
    expect(inside.status).toBe(409);
    expect(inside.body.code).toBe('ORG_COOLDOWN');
    expect((await s.dry(['tester-01', 'ops-01'])).body.result.churn.cooldownEndsInMinutes).toBe(1);
    await s.q(`update org_proposals set decided_at = now() - interval '24 hours 1 minute' where status='applied'`);
    const outside = await s.propose(['tester-01', 'ops-01']);
    expect(outside.status, JSON.stringify(outside.body)).toBe(201);
    expect(outside.body.proposal.result.churn.cooldownEndsInMinutes).toBeNull();
  });

  it('a rollback proposal is never held by the cooldown (undoing a change must stay possible)', async () => {
    const p = (await s.propose(['writer-01', 'ops-01'])).body.proposal; // pending, base unchanged
    expect(p.id).toBeTruthy();
    expect((await s.approve(p)).status).toBe(200); // applied now: a fresh cooldown
    expect((await s.propose(['designer-01', 'ops-01'])).body.code).toBe('ORG_COOLDOWN');
    const rb = await s.A.req('POST', '/organization/revisions/1/rollback-proposal', {}, key());
    expect(rb.status, JSON.stringify(rb.body)).toBe(201);
  });
});

describe('churn budget: reporting lines changed per window', () => {
  let s: Awaited<ReturnType<typeof setup>>;
  beforeAll(async () => { s = await setup({ churnBudget: 3, churnWindowHours: 48 }); });
  afterAll(async () => { await s.t.close(); });

  it('one proposal that changes more lines than the budget is refused with ORG_CHURN_BUDGET', async () => {
    const r = await s.propose(['coder-01', 'ops-01'], ['tester-01', 'ops-01'], ['writer-01', 'ops-01'], ['designer-01', 'ops-01']);
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('ORG_CHURN_BUDGET');
    expect(r.body.message).toMatch(/4 reporting lines/);
    expect((await s.q('select count(*)::int n from org_proposals')).rows[0].n).toBe(0);
  });

  it('the budget is exact: 3 lines are allowed, and the status says 3 of 3', async () => {
    const d = await s.dry(['coder-01', 'ops-01'], ['tester-01', 'ops-01'], ['writer-01', 'ops-01']);
    expect(d.body.result.churn).toMatchObject({ linesChanged: 3, budget: 3, windowHours: 48, usedInWindow: 0, overBudget: false });
    const p = await s.propose(['coder-01', 'ops-01'], ['tester-01', 'ops-01'], ['writer-01', 'ops-01']);
    expect(p.status, JSON.stringify(p.body)).toBe(201);
    expect(p.body.proposal.linesChanged).toBe(3);
    expect((await s.approve(p.body.proposal)).status).toBe(200);
  });

  it('lines changed by an approved proposal count against later ones inside the window (database clock), and stop counting after it', async () => {
    const second = await s.propose(['designer-01', 'ops-01']);
    expect(second.status).toBe(422);
    expect(second.body.code).toBe('ORG_CHURN_BUDGET');
    const d = await s.dry(['designer-01', 'ops-01']);
    expect(d.body.result.churn).toMatchObject({ linesChanged: 1, usedInWindow: 3, overBudget: true });
    expect(d.body.result.errors.map((e: { code: string }) => e.code)).toContain('CHURN_BUDGET');
    await s.q(`update org_proposals set decided_at = now() - interval '47 hours 59 minutes' where status='applied'`);
    expect((await s.propose(['designer-01', 'ops-01'])).status).toBe(422); // still inside the 48 h window
    await s.q(`update org_proposals set decided_at = now() - interval '48 hours 1 minute' where status='applied'`);
    expect((await s.propose(['designer-01', 'ops-01'])).status).toBe(201);
  });
});

describe('not enforced by default', () => {
  let s: Awaited<ReturnType<typeof setup>>;
  beforeAll(async () => { s = await setup({}); });
  afterAll(async () => { await s.t.close(); });
  it('with no settings (0 or unset) nothing is refused and the status says so', async () => {
    const p1 = await s.propose(['coder-01', 'ops-01'], ['tester-01', 'ops-01'], ['writer-01', 'ops-01'], ['designer-01', 'ops-01']);
    expect(p1.status).toBe(201);
    expect(p1.body.proposal.result.churn).toEqual({ linesChanged: 4, budget: null, windowHours: null, usedInWindow: 0, overBudget: false, cooldownHours: null, cooldownEndsInMinutes: null });
    expect((await s.approve(p1.body.proposal)).status).toBe(200);
    expect((await s.propose(['analyst-01', 'ops-01'])).status).toBe(201);
  });
});
