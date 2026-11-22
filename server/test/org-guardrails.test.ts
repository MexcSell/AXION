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
const N = 6;
const A = (id: string, model: string, o: Partial<GuardAgent> = {}): GuardAgent => ({ id, model, status: 'active', dept: id === 'gm' ? 'Exec' : 'Dept', role: 'dev', ...o });
const BASE_AGENTS: GuardAgent[] = [
  A('gm', 'claude-opus-5-5', { role: 'manager' }),
  A('lead-a', 'claude-sonnet-5-5'), A('a1', 'gpt-5'), A('a2', 'gpt-5'), A('a3', 'llama-4-70b'),
  A('lead-b', 'gpt-5'), A('b1', 'mystery-model'), A('b2', 'claude-haiku-5-5'),
  A('lead-c', 'mystery-model'), A('c1', 'mystery-model'), A('c2', 'claude-haiku-5-5'), A('c3', 'claude-haiku-5-5'),
  A('lead-d', 'claude-sonnet-5-5'), A('d1', 'claude-haiku-5-5'),
  A('s1', 'claude-haiku-5-5'), A('s2', 'gpt-5'), A('s3', 'mystery-model'),
  ...Array.from({ length: 10 }, (_, i) => A('t' + (i + 1), i % 2 ? 'gpt-5' : 'claude-haiku-5-5')),
];
const up = (sub: string, sup: string): EdgeIn => ({ supervisorId: sup, subordinateId: sub });
const BASE: EdgeIn[] = [
  ...['lead-a', 'lead-b', 'lead-c', 'lead-d', 's1', 's2', 's3', ...Array.from({ length: 10 }, (_, i) => 't' + (i + 1))].map((x) => up(x, 'gm')),
  up('a1', 'lead-a'), up('a2', 'lead-a'), up('a3', 'lead-a'),
  up('b1', 'lead-b'), up('b2', 'lead-b'),
  up('c1', 'lead-c'), up('c2', 'lead-c'), up('c3', 'lead-c'),
  up('d1', 'lead-d'),
];
/** The proposed lines: the base with each `[subordinate, newManager]` re-pointed. */
const moves = (...m: [string, string][]): EdgeIn[] => { const to = new Map(m); return BASE.map((e) => (to.has(e.subordinateId) ? up(e.subordinateId, to.get(e.subordinateId)!) : e)); };
const m = (s: string, p: string): [string, string] => [s, p];
type Case = { name: string; edges: EdgeIn[]; agents?: GuardAgent[]; expect?: string };
const retire = (...ids: string[]) => BASE_AGENTS.map((a) => (ids.includes(a.id) ? { ...a, status: 'retired' } : a));
const model = (id: string, mdl: string) => BASE_AGENTS.map((a) => (a.id === id ? { ...a, model: mdl } : a));

const BAD: Case[] = [
  // --- a changed team is left with fewer than two members able to review
  { name: 'b2 leaves team B: only lead-b is able (b1 is unknown)', edges: moves(m('b2', 'lead-a')), expect: 'TEAM_REVIEWERS' },
  { name: 'c2 leaves team C: only c3 is able', edges: moves(m('c2', 'lead-a')), expect: 'TEAM_REVIEWERS' },
  { name: 'c3 leaves team C: only c2 is able', edges: moves(m('c3', 'lead-a')), expect: 'TEAM_REVIEWERS' },
  { name: 'c2 and c3 leave team C: nobody is able', edges: moves(m('c2', 'lead-d'), m('c3', 'lead-d')), expect: 'TEAM_REVIEWERS' },
  { name: 'd1 reports to unknown c1: the new team c1 has one able member', edges: moves(m('d1', 'c1')), expect: 'TEAM_REVIEWERS' },
  { name: 'd1 reports to unknown b1: the new team b1 has one able member', edges: moves(m('d1', 'b1')), expect: 'TEAM_REVIEWERS' },
  { name: 's3 (unknown) becomes the manager of s1: new team with one able member', edges: moves(m('s1', 's3')), expect: 'TEAM_REVIEWERS' },
  { name: 's3 (unknown) becomes the manager of a1: new team with one able member (and a1 leaves team A)', edges: moves(m('a1', 's3')), expect: 'TEAM_REVIEWERS' },
  { name: 'b2 reports to unknown s3: team s3 has one able, team B loses its able member', edges: moves(m('b2', 's3')), expect: 'TEAM_REVIEWERS' },
  { name: 'a2 reports to unknown s3 (team A keeps three)', edges: moves(m('a2', 's3')), expect: 'TEAM_REVIEWERS' },
  { name: 's2 reports to unknown c1 while c2 and c3 go away', edges: moves(m('s2', 'c1'), m('c2', 'lead-d'), m('c3', 'lead-d')), expect: 'TEAM_REVIEWERS' },
  { name: 'every report of lead-c except unknown c1 leaves (two moves), lead-c unknown', edges: moves(m('c2', 'lead-b'), m('c3', 'lead-b')), expect: 'TEAM_REVIEWERS' },
  // --- the same rule with the agents changed since the chart was drawn
  { name: 'c2 was retired meanwhile; c3 leaves team C: nobody able', edges: moves(m('c3', 'lead-a')), agents: retire('c2'), expect: 'TEAM_REVIEWERS' },
  { name: 'c2 and c3 retired; c1 moves: team C has no able member', edges: moves(m('c1', 'lead-a')), agents: retire('c2', 'c3'), expect: 'TEAM_REVIEWERS' },
  { name: 'b2 was retired meanwhile; b1 (unknown) leaves team B: only lead-b is able', edges: moves(m('b1', 'lead-a')), agents: retire('b2'), expect: 'TEAM_REVIEWERS' },
  { name: 'c2, c3 and s1 were retired; s2 joins unknown lead-c: team C has one able member', edges: moves(m('s2', 'lead-c')), agents: retire('c2', 'c3', 's1'), expect: 'TEAM_REVIEWERS' },
  { name: 'a1 leaves; a2 and a3 are retired; team A has lead-a only (one able)', edges: moves(m('a1', 'lead-d')), agents: retire('a2', 'a3'), expect: 'TEAM_REVIEWERS' },
  { name: 'a2 leaves; a1 and a3 retired', edges: moves(m('a2', 'lead-d')), agents: retire('a1', 'a3'), expect: 'TEAM_REVIEWERS' },
  { name: 'a3 leaves; a1 and a2 retired', edges: moves(m('a3', 'lead-d')), agents: retire('a1', 'a2'), expect: 'TEAM_REVIEWERS' },
  { name: 'new team of two unknown agents: c1 manages s3', edges: moves(m('s3', 'c1'), m('c2', 'lead-d'), m('c3', 'lead-d')), expect: 'TEAM_REVIEWERS' },
  // --- an escalation chain deeper than N = 6 levels (each team on the chain stays able to review)
  { name: 'chain of 7 levels: t1 > t2 > ... > t7 under the GM', edges: moves(m('t2', 't1'), m('t3', 't2'), m('t4', 't3'), m('t5', 't4'), m('t6', 't5'), m('t7', 't6')), expect: 'ESCALATION_TOO_DEEP' },
  { name: 'chain of 8 levels', edges: moves(m('t2', 't1'), m('t3', 't2'), m('t4', 't3'), m('t5', 't4'), m('t6', 't5'), m('t7', 't6'), m('t8', 't7')), expect: 'ESCALATION_TOO_DEEP' },
  { name: 'chain of 10 levels', edges: moves(m('t2', 't1'), m('t3', 't2'), m('t4', 't3'), m('t5', 't4'), m('t6', 't5'), m('t7', 't6'), m('t8', 't7'), m('t9', 't8'), m('t10', 't9')), expect: 'ESCALATION_TOO_DEEP' },
  { name: 'a deep chain hung under lead-a (7 levels)', edges: moves(m('t1', 'lead-a'), m('t2', 't1'), m('t3', 't2'), m('t4', 't3'), m('t5', 't4'), m('t6', 't5')), expect: 'ESCALATION_TOO_DEEP' },
  { name: 'deep chain through the s agents', edges: moves(m('s1', 't1'), m('s2', 's1'), m('t1', 't2'), m('t2', 't3'), m('t3', 't4'), m('t4', 't5')), expect: 'ESCALATION_TOO_DEEP' },
  { name: 'two chains, one over the limit', edges: moves(m('t2', 't1'), m('t3', 't2'), m('t4', 't3'), m('t5', 't4'), m('t6', 't5'), m('t7', 't6'), m('t9', 't8')), expect: 'ESCALATION_TOO_DEEP' },
  { name: 'the lower end of the chain is a whole team (a1..a3 under t6, which is at level 6)', edges: moves(m('t2', 't1'), m('t3', 't2'), m('t4', 't3'), m('t5', 't4'), m('t6', 't5'), m('a1', 't6'), m('a2', 't6'), m('a3', 't6')), expect: 'ESCALATION_TOO_DEEP' },
  { name: 'the chain is made by moving lead-d under lead-c under lead-b under lead-a under t1..t3', edges: moves(m('lead-a', 't3'), m('t3', 't2'), m('t2', 't1'), m('lead-b', 'lead-a'), m('lead-c', 'lead-b'), m('lead-d', 'lead-c')), expect: 'ESCALATION_TOO_DEEP' },
  { name: 'chain of 7 levels hung under lead-d', edges: moves(m('t1', 'lead-d'), m('t2', 't1'), m('t3', 't2'), m('t4', 't3'), m('t5', 't4'), m('t6', 't5')), expect: 'ESCALATION_TOO_DEEP' },
  { name: 'chain of 9 levels', edges: moves(m('t2', 't1'), m('t3', 't2'), m('t4', 't3'), m('t5', 't4'), m('t6', 't5'), m('t7', 't6'), m('t8', 't7'), m('t9', 't8')), expect: 'ESCALATION_TOO_DEEP' },
  { name: 'b2 and d1 both go to unknown s3: two teams fail', edges: moves(m('b2', 's3'), m('d1', 's3')), expect: 'TEAM_REVIEWERS' },
  { name: 'c3 reports to unknown s3: team C and team s3 both fail', edges: moves(m('c3', 's3')), expect: 'TEAM_REVIEWERS' },
  { name: 'd1 reports to unknown s3', edges: moves(m('d1', 's3')), expect: 'TEAM_REVIEWERS' },
];

const GOOD: Case[] = [
  { name: 'no change at all', edges: BASE },
  { name: 'a1 moves to lead-d: both changed teams keep two able members', edges: moves(m('a1', 'lead-d')) },
  { name: 'boundary: team B keeps exactly two able members after b1 (unknown) leaves', edges: moves(m('b1', 'lead-a')) },
  { name: 'boundary: team D gains an unknown member but keeps two able', edges: moves(m('s3', 'lead-d')) },
  { name: 'the untouched weak team does not block an unrelated change (team B is weak with unknown members, a1 moves elsewhere)', edges: moves(m('a1', 't1')), agents: retire('b2') },
  { name: 'GM team change: s1 under t1 keeps two able in the new team', edges: moves(m('s1', 't1')) },
  { name: 'a lead left alone is a warning of the old rules, not a reviewer failure (d1 leaves)', edges: moves(m('d1', 'lead-a')) },
  { name: 'unknown-family agent joins a team that has three able members', edges: moves(m('s3', 'lead-a')) },
  { name: 'two members swap teams', edges: moves(m('a1', 'lead-d'), m('d1', 'lead-a')) },
  { name: 'boundary: chain of exactly 6 levels is allowed', edges: moves(m('t2', 't1'), m('t3', 't2'), m('t4', 't3'), m('t5', 't4'), m('t6', 't5')) },
  { name: 'boundary: chain of 5 levels', edges: moves(m('t2', 't1'), m('t3', 't2'), m('t4', 't3'), m('t5', 't4')) },
  { name: 'a bushy tree: many reports under one lead, no extra depth', edges: moves(m('t1', 'lead-a'), m('t2', 'lead-a'), m('t3', 'lead-a'), m('t4', 'lead-a')) },
  { name: 'retired agent in an untouched team', edges: moves(m('s1', 's2')), agents: retire('b2') },
  { name: 'a new team of two able agents', edges: moves(m('t2', 't1')) },
  { name: 'unknown manager of a team with two able reports', edges: moves(m('s1', 'b1'), m('s2', 'b1')) },
  { name: 'every report of lead-c moves to the able lead-a team, leaving lead-c alone', edges: moves(m('c1', 'lead-a'), m('c2', 'lead-a'), m('c3', 'lead-a')) },
];

const run = (c: Case, max = N) => {
  const agents = c.agents ?? BASE_AGENTS;
  const old = validateOrg(c.edges, agents, BASE);
  const out = contractChecks(c.edges, agents, BASE, { maxEscalationLevels: max });
  return { old, out };
};

describe('contract checks: the bad corpus (new rules only)', () => {
  it('has at least 30 hand-made bad proposals that really break a rule', () => {
    expect(BAD.filter((c) => c.expect).length).toBeGreaterThanOrEqual(30);
  });
  for (const c of BAD.filter((x) => x.expect)) {
    it(`rejects: ${c.name}`, () => {
      const { old, out } = run(c);
      expect(old.errors, 'the OLD dry run must accept it (so only a new rule can reject it)').toEqual([]);
      expect(out.errors.map((e) => e.code)).toContain(c.expect);
      expect(out.checks.some((k) => !k.ok && k.reasons.length > 0)).toBe(true);
    });
  }
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
