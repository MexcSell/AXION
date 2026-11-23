import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { contractChecks, type GuardAgent } from '../src/organization/guardrails.ts';
import { validateOrg, type EdgeIn } from '../src/organization/validate.ts';
import { makeTestApp, withAdmin, type TestApp, type Browser } from './helpers.ts';
import { addVersion } from '../src/agents/service.ts';
import { tx } from '../src/db.ts';
const ST = { baseline: 'No change: keep the current chart as it is.', expectedCost: 'No added cost is expected in this test.' }; // c64: every proposal states a baseline and its expected cost

/**
 * Improvement cycle 64 (R3-6), item 2: the NEW contract checks of a restructure.
 *  - TEAM_REVIEWERS: a team whose members change must keep at least two members able to review (active, and a model family c38 can
 *    name: an agent of an unknown family can neither review nor be reviewed by an agent, so it does not count). Teams the proposal
 *    does not touch are not checked, so an old weak team does not block unrelated changes.
 *  - ESCALATION_TOO_DEEP: every active agent's chain must reach the GM within N levels (N is an operator setting, default 6). The
 *    chain reaching the GM at all was already checked (NO_MANAGER, NOT_UNDER_GM, CYCLE) and is not counted as new.
 *  - Dropped on purpose: "role output contract unchanged" (the org model has no output-contract field to compare).
 * The corpus below is hand-made. Every bad proposal passes the OLD dry run cleanly (no errors) and breaks a NEW rule only; every good
 * one passes both, including the boundaries (exactly two reviewers, exactly N levels).
 */
import { N, BASE, BASE_AGENTS, BAD, GOOD, moves, m, up, type Case } from './org-corpus.ts';

const run = (c: Case, max = N) => {
  const agents = c.agents ?? BASE_AGENTS;
  const old = validateOrg(c.edges, agents, BASE);
  const out = contractChecks(c.edges, agents, BASE, { maxEscalationLevels: c.max ?? max });
  return { old, out };
};

describe('contract checks: the bad corpus (new rules only)', () => {
  it('has at least 30 hand-made bad proposals that really break a rule', () => {
    expect(BAD.filter((c) => c.expect).length).toBeGreaterThanOrEqual(35); // c64 had 33; c78 adds five distinct shapes
  });
  for (const c of BAD.filter((x) => x.expect)) {
    it(`rejects: ${c.name}`, () => {
      const { old, out } = run(c);
      expect(old.errors, 'the OLD dry run must accept it (so only a new rule can reject it)').toEqual([]);
      expect(out.errors.map((e) => e.code)).toContain(c.expect);
      for (const code of c.also ?? []) expect(out.errors.map((e) => e.code), `also ${code}`).toContain(code);
      expect(out.checks.some((k) => !k.ok && k.reasons.length > 0)).toBe(true);
    });
  }
});

describe('contract checks: setting-dependent cases (c78)', () => {
  it('a case that names its own limit is refused at that limit and accepted at the default of 6, so the refusal is the setting', () => {
    const tight = BAD.filter((c) => c.max !== undefined);
    expect(tight.length).toBeGreaterThanOrEqual(1);
    for (const c of tight) {
      expect(run(c).out.errors.map((e) => e.code)).toContain(c.expect);
      expect(run(c, N).out.errors.map((e) => e.code)).toContain(c.expect); // run() honours c.max over the argument
      expect(contractChecks(c.edges, c.agents ?? BASE_AGENTS, BASE, { maxEscalationLevels: N }).errors).toEqual([]);
    }
  });
});

describe('contract checks: the good corpus', () => {
  it('has at least 15 good proposals', () => { expect(GOOD.length).toBeGreaterThanOrEqual(15); });
  for (const c of GOOD) {
    it(`accepts: ${c.name}`, () => {
      const { old, out } = run(c);
      expect(old.errors).toEqual([]);
      expect(out.errors).toEqual([]);
      expect(out.checks.every((k) => k.ok && k.reasons.length === 0)).toBe(true);
    });
  }
});

describe('contract checks: shape and settings', () => {
  it('always lists exactly the two checks, never the dropped output-contract check', () => {
    const { out } = run(GOOD[0]);
    expect(out.checks.map((k) => k.code)).toEqual(['REVIEWER_PER_TEAM', 'ESCALATION_WITHIN_LEVELS']);
  });
  it('the level limit is the operator setting: the same 6-level chain fails at 5 and passes at 6', () => {
    const c = GOOD.find((x) => x.name.startsWith('boundary: chain of exactly 6'))!;
    expect(run(c, 5).out.errors.map((e) => e.code)).toContain('ESCALATION_TOO_DEEP');
    expect(run(c, 6).out.errors).toEqual([]);
  });
  it('S6: a limit of 0 means not enforced (not "the default"), and the check says so', () => {
    const deep = moves(m('t2', 't1'), m('t3', 't2'), m('t4', 't3'), m('t5', 't4'), m('t6', 't5'), m('t7', 't6'), m('t8', 't7'));
    const out = contractChecks(deep, BASE_AGENTS, BASE, { maxEscalationLevels: 0 });
    expect(out.errors).toEqual([]);
    const k = out.checks.find((x) => x.code === 'ESCALATION_WITHIN_LEVELS')!;
    expect(k.ok).toBe(true);
    expect(k.title).toMatch(/not enforced/i);
    expect(contractChecks(deep, BASE_AGENTS, BASE, {}).errors.map((e) => e.code)).toContain('ESCALATION_TOO_DEEP'); // unset = the default of 6
  });
  it('S6: only chains the proposal changes are checked: an existing deep chain does not block an unrelated proposal', () => {
    const deepNow = moves(m('t2', 't1'), m('t3', 't2'), m('t4', 't3'), m('t5', 't4'), m('t6', 't5'), m('t7', 't6'), m('t8', 't7'));
    const unrelated = deepNow.map((e) => (e.subordinateId === 'd1' ? up('d1', 'lead-a') : e)); // d1 moves between two shallow teams
    expect(contractChecks(unrelated, BASE_AGENTS, deepNow, { maxEscalationLevels: N }).errors.filter((e) => e.code === 'ESCALATION_TOO_DEEP')).toEqual([]);
    expect(contractChecks(deepNow, BASE_AGENTS, deepNow, { maxEscalationLevels: N }).errors).toEqual([]); // no change at all
    // a change inside the deep chain is still checked: t9 joins its end (its own chain is new and 9 levels deep)
    const joined = unrelated.map((e) => (e.subordinateId === 't9' ? up('t9', 't8') : e));
    expect(contractChecks(joined, BASE_AGENTS, deepNow, { maxEscalationLevels: N }).errors.some((e) => e.code === 'ESCALATION_TOO_DEEP' && e.agentId === 't9')).toBe(true);
    // an ancestor re-pointed higher in the chain changes the chain of everything below it
    const lifted = deepNow.map((e) => (e.subordinateId === 't2' ? up('t2', 'lead-a') : e)); // t2 is re-pointed to level 2, so t2..t8 sit at levels 2..8 and their chains changed
    expect(contractChecks(lifted, BASE_AGENTS, deepNow, { maxEscalationLevels: N }).errors.some((e) => e.code === 'ESCALATION_TOO_DEEP')).toBe(true);
  });
  it('is pure and cycle-safe: a loop does not hang it (the old dry run reports the loop)', () => {
    const loop = [...BASE.filter((e) => e.subordinateId !== 't1' && e.subordinateId !== 't2'), up('t1', 't2'), up('t2', 't1')];
    expect(() => contractChecks(loop, BASE_AGENTS, BASE, { maxEscalationLevels: N })).not.toThrow();
  });
});

// ---- on the real route: the dry run lists the checks; a failing check blocks approval (422 ORG_INVALID) like any dry-run error
describe('on the route', () => {
  let t: TestApp; let Adm: Browser; let Bea: Browser; let n = 0;
  const key = () => ({ 'idempotency-key': 'cg' + n++ });
  type Edge = { supervisorId: string; subordinateId: string };
  beforeAll(async () => {
    t = await makeTestApp({ staffingStepMs: 3_600_000, conversationSimMs: 3_600_000, demoSeed: false, writeLimits: { proposals: { max: 1000, windowMs: 60_000 } } });
    const w = await withAdmin(t.app);
    Adm = w.admin;
    const b = await w.member('Bea'); Bea = b.b;
    expect((await Adm.req('PATCH', `/users/${b.id}`, { role: 'admin' })).status).toBe(200);
  });
  afterAll(async () => { await t?.close(); });
  const graph = async () => (await Adm.req('GET', '/organization/graph')).body as { revision: { seq: number }; edges: Edge[] };

  it('a normal move lists both checks as passed', async () => {
    const g = await graph();
    const r = await Adm.req('POST', '/organization/proposals?dryRun=1', { title: 'm', why: '', baseRevision: g.revision.seq, edges: g.edges.map((e) => (e.subordinateId === 'coder-01' ? { ...e, supervisorId: 'ops-01' } : e)) });
    expect(r.status).toBe(200);
    expect(r.body.result.contracts).toEqual([
      expect.objectContaining({ code: 'REVIEWER_PER_TEAM', ok: true, reasons: [] }),
      expect.objectContaining({ code: 'ESCALATION_WITHIN_LEVELS', ok: true, reasons: [] }),
    ]);
  });

  it('a team left without two able reviewers is stored with the failed check and cannot be approved', async () => {
    const g = await graph();
    // the company chart is flat (everyone reports to the GM), so the proposal makes a new team: comms-01 manages analyst-01 and browser-01,
    // and two of the three run a model whose family is unknown, so only one member could review
    await tx(t.app.db, async (c) => { for (const id of ['comms-01', 'analyst-01']) await addVersion(c, { agentId: id, model: 'mystery-model', skills: [], tools: [], createdBy: 'test' }); });
    const bad = await Adm.req('POST', '/organization/proposals', { ...ST, title: 'New team', why: '', baseRevision: g.revision.seq, edges: g.edges.map((e) => (['analyst-01', 'browser-01'].includes(e.subordinateId) ? { ...e, supervisorId: 'comms-01' } : e)) }, key());
    expect(bad.status).toBe(201);
    const res = bad.body.proposal.result;
    expect(res.ok).toBe(false);
    expect(res.errors.map((e: { code: string }) => e.code)).toContain('TEAM_REVIEWERS');
    expect(res.contracts.find((k: { code: string }) => k.code === 'REVIEWER_PER_TEAM')).toMatchObject({ ok: false });
    const dec = await Bea.req('POST', `/organization/proposals/${bad.body.proposal.id}/decision`, { decision: 'approve', sha: bad.body.proposal.sha });
    expect(dec.status).toBe(422);
    expect(dec.body.code).toBe('ORG_INVALID');
  });
});
