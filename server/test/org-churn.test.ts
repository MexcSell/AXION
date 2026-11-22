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
  const rev = async () => (await graph()).revision.seq;
  return { t, A, B, propose, dry, approve, q, rev };
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

  it('only the undo of the last applied change is exempt: a rollback to the revision just before the current one, when a normal proposal made the current one', async () => {
    const p = (await s.propose(['writer-01', 'ops-01'])).body.proposal; // pending, base unchanged
    expect(p.id).toBeTruthy();
    expect((await s.approve(p)).status).toBe(200); // applied now: a fresh cooldown (c64 fix round, S1: the earlier test rolled back to revision 1, two back)
    expect((await s.propose(['designer-01', 'ops-01'])).body.code).toBe('ORG_COOLDOWN');
    const seq = (await s.rev());
    const rb = await s.A.req('POST', `/organization/revisions/${seq - 1}/rollback-proposal`, {}, key());
    expect(rb.status, JSON.stringify(rb.body)).toBe(201);
    expect((await s.approve(rb.body.proposal)).status).toBe(200);
  });

  it('a rollback to any other revision is held by the cooldown (here two revisions back)', async () => {
    await s.q(`update org_proposals set decided_at = now() - interval '48 hours'`);
    const p = (await s.propose(['designer-01', 'ops-01'])).body.proposal;
    expect((await s.approve(p)).status).toBe(200);
    const seq = await s.rev();
    const rb = await s.A.req('POST', `/organization/revisions/${seq - 2}/rollback-proposal`, {}, key());
    expect(rb.status).toBe(409);
    expect(rb.body.code).toBe('ORG_COOLDOWN');
  });

  it('flip-flop: after the one allowed undo, rolling forward and undoing again are refused (cooldown 24 h, a rollback is not free churn)', async () => {
    await s.q(`update org_proposals set decided_at = now() - interval '48 hours'`);
    const p = (await s.propose(['analyst-01', 'ops-01'])).body.proposal;
    expect((await s.approve(p)).status).toBe(200);
    const cur = await s.rev(); // normal change at `cur`; the chart before it is `cur - 1`
    const undo = await s.A.req('POST', `/organization/revisions/${cur - 1}/rollback-proposal`, {}, key());
    expect(undo.status, JSON.stringify(undo.body)).toBe(201);
    expect((await s.approve(undo.body.proposal)).status).toBe(200);
    // current = the undo (applied by a rollback). Roll forward to the change it undid: not exempt.
    const fwd = await s.A.req('POST', `/organization/revisions/${cur}/rollback-proposal`, {}, key());
    expect(fwd.status).toBe(409);
    expect(fwd.body.code).toBe('ORG_COOLDOWN');
  });

  it('the cooldown and the budget are checked again when the proposal is approved', async () => {
    await s.q(`update org_proposals set decided_at = now() - interval '48 hours'`);
    const cfg = s.t.app.cfg as { orgGuardrails?: Record<string, number> };
    const was = cfg.orgGuardrails; cfg.orgGuardrails = {}; // nothing enforced while the proposals are made
    try {
      const g0 = (await s.A.req('GET', '/organization/graph')).body as { edges: Edge[] };
      const flip = (sub: string): [string, string] => [sub, g0.edges.find((e) => e.subordinateId === sub)!.supervisorId === 'ops-01' ? 'gm' : 'ops-01']; // a move that really changes a line
      const p = (await s.propose(flip('coder-01'))).body.proposal;
      expect(p.linesChanged).toBe(1);
      expect((await s.approve(p)).status).toBe(200);
      const a = await s.propose(flip('writer-01')); // a normal proposal, made unenforced ...
      expect(a.status).toBe(201);
      expect(a.body.proposal.linesChanged).toBeGreaterThan(0);
      cfg.orgGuardrails = { cooldownHours: 24 }; // ... then the operator turns the cooldown on
      const r = await s.approve(a.body.proposal);
      expect(r.status).toBe(409);
      expect(r.body.code).toBe('ORG_COOLDOWN');
      const used = (await s.q(`select coalesce(sum(lines_changed),0)::int n from org_proposals where status='applied' and decided_at > now() - interval '48 hours'`)).rows[0].n;
      cfg.orgGuardrails = { churnBudget: used, churnWindowHours: 48 }; // the budget is already used up by the approved changes in the window
      const r2 = await s.approve(a.body.proposal);
      expect(r2.status).toBe(422);
      expect(r2.body.code).toBe('ORG_CHURN_BUDGET');
      // the undo of the last change stays exempt at approval too
      const seq = await s.rev();
      cfg.orgGuardrails = {};
      const rb = await s.A.req('POST', `/organization/revisions/${seq - 1}/rollback-proposal`, {}, key());
      expect(rb.status).toBe(201);
      cfg.orgGuardrails = { cooldownHours: 24, churnBudget: 1, churnWindowHours: 48 };
      expect((await s.approve(rb.body.proposal)).status).toBe(200);
    } finally { cfg.orgGuardrails = was; }
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
