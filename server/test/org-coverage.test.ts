import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeTestApp, withAdmin, type TestApp, type Browser } from './helpers.ts';
import { orgCoverage, coverageChanges, ROLE_CATALOG, type CoverageAgent } from '../src/organization/coverage.ts';
import { COMPANY_AGENTS } from '../../shared/company/agents.ts';
const ST = { baseline: 'No change: keep the current chart as it is.', expectedCost: 'No added cost is expected in this test.' }; // c64: every proposal states a baseline and its expected cost

// Improvement cycle 20 (theme A5): org coverage facts (brief c20-brief.md). Pure facts first, then the routes.
const AG: CoverageAgent[] = [
  { id: 'gm', status: 'active', dept: 'Executive', role: 'manager', duty: 'Run the company' },
  { id: 'eng-head', status: 'active', dept: 'Engineering', role: 'dev', duty: 'Lead engineering' },
  { id: 'coder', status: 'active', dept: 'Engineering', role: 'qa', duty: 'Write code' },
  { id: 'ops-head', status: 'active', dept: 'Operations', role: 'ops', duty: '  ' },
  { id: 'old', status: 'retired', dept: 'Operations', role: 'security', duty: 'x' },
];
const e = (supervisorId: string, subordinateId: string) => ({ supervisorId, subordinateId });
const BASE = [e('gm', 'eng-head'), e('eng-head', 'coder'), e('gm', 'ops-head')];
const R = ['manager', 'dev', 'qa', 'ops', 'security'];

describe('orgCoverage (pure)', () => {
  it('the catalog is the 18 built-in roles and covers every seeded agent role', () => {
    expect(ROLE_CATALOG).toHaveLength(18);
    for (const a of COMPANY_AGENTS) expect(ROLE_CATALOG as readonly string[]).toContain(a.role);
  });
  it('role coverage: a placed active agent covers; a retired one does not; the rest is missing', () => {
    const c = orgCoverage(BASE, AG, R);
    expect(c.roles.find((r) => r.role === 'dev')!.agentIds).toEqual(['eng-head']);
    expect(c.missingRoles).toEqual(['security']);
  });
  it('an active agent not placed in the chart does not cover its role', () => {
    const c = orgCoverage(BASE.filter((x) => x.subordinateId !== 'coder'), AG, R);
    expect(c.missingRoles).toEqual(['qa', 'security']);
  });
  it('duplicate roles among active agents (case-insensitive); retired agents are ignored', () => {
    const c = orgCoverage(BASE, [...AG, { id: 'dup', status: 'active', dept: 'Operations', role: 'DEV', duty: 'd' }, { id: 'oldops', status: 'retired', dept: 'x', role: 'ops', duty: 'd' }], R);
    expect(c.duplicateRoles).toEqual([{ role: 'dev', agentIds: ['dup', 'eng-head'] }]);
  });
  it('departments without a head: no member reports to the GM; the GM department is excluded', () => {
    expect(orgCoverage(BASE, AG, R).deptsWithoutHead).toEqual([]);
    const moved = [e('gm', 'eng-head'), e('eng-head', 'coder'), e('eng-head', 'ops-head')];
    expect(orgCoverage(moved, AG, R).deptsWithoutHead).toEqual(['Operations']);
  });
  it('managers with no reports: the GM role with nobody under it, or an agent that managed in the prior lines', () => {
    expect(orgCoverage([], AG, R).managersWithoutReports).toEqual(['gm']);
    expect(orgCoverage(BASE, AG, R).managersWithoutReports).toEqual([]);
    const next = BASE.filter((x) => x.supervisorId !== 'eng-head').concat(e('gm', 'coder'));
    expect(orgCoverage(next, AG, R, BASE).managersWithoutReports).toEqual(['eng-head']);
  });
  it('agents with no duty: empty or blank, active only', () => {
    expect(orgCoverage(BASE, AG, R).agentsWithoutDuty).toEqual(['ops-head']);
  });
  it('span of control: reports per manager, the largest (ties: first id), and the managers counted', () => {
    const c = orgCoverage(BASE, AG, R);
    expect(c.span).toEqual({ max: 2, agentId: 'gm', managers: 2 });
    expect(orgCoverage([], AG, R).span).toEqual({ max: 0, agentId: null, managers: 0 });
  });
  it('depth in levels: GM alone is 1, a chain GM > eng-head > coder is 3, a loop terminates', () => {
    expect(orgCoverage([], AG, R).depth).toBe(1);
    expect(orgCoverage(BASE, AG, R).depth).toBe(3);
    expect(orgCoverage([e('a', 'b'), e('b', 'a')], [{ id: 'a', status: 'active', dept: 'd', role: 'x', duty: 'x' }, { id: 'b', status: 'active', dept: 'd', role: 'y', duty: 'y' }], R).depth).toBeGreaterThan(0);
  });
  it('coverageChanges names the roles left uncovered, the heads added or lost, orphaned managers, span and depth', () => {
    const before = orgCoverage(BASE, AG, R);
    const next = [e('gm', 'eng-head'), e('eng-head', 'ops-head')]; // coder dropped, ops under eng
    const after = orgCoverage(next, AG, R, BASE);
    const ch = coverageChanges(before, after);
    const codes = ch.map((c) => c.code);
    expect(codes).toContain('ROLE_UNCOVERED');
    expect(ch.find((c) => c.code === 'ROLE_UNCOVERED')!.message).toBe('This proposal leaves role qa uncovered.');
    expect(codes).toContain('HEAD_LOST');
    expect(coverageChanges(after, before).find((c) => c.code === 'HEAD_ADDED')!.message).toBe('This proposal adds a head to Operations.');
    expect(coverageChanges(before, before)).toEqual([]);
  });
});

let t: TestApp;
let A: Browser; let B: Browser; let M: Browser;
let n = 0;
const key = () => ({ 'idempotency-key': 'cv' + n++ });
type Edge = { supervisorId: string; subordinateId: string };
const graph = async () => (await A.req('GET', '/organization/graph')).body as { revision: { seq: number }; edges: Edge[] };
const propose = (b: Browser, edges: Edge[], base: number, title = 'cov') => b.req('POST', '/organization/proposals', { ...ST, title, why: '', baseRevision: base, edges }, key());

describe('GET /organization/coverage and the proposal coverage block', () => {
  beforeAll(async () => {
    t = await makeTestApp({ staffingStepMs: 3_600_000, conversationSimMs: 3_600_000, demoSeed: false });
    const w = await withAdmin(t.app);
    A = w.admin;
    const bea = await w.member('Bea');
    B = bea.b;
    expect((await A.req('PATCH', `/users/${bea.id}`, { role: 'admin' })).status).toBe(200);
    M = (await w.member('Mia')).b;
  });
  afterAll(async () => { await t.close(); });

  it('the active revision: every catalog role has a holder in the seeded company, GM is depth 1 root', async () => {
    const r = await A.req('GET', '/organization/coverage');
    expect(r.status).toBe(200);
    const g = await graph();
    expect(r.body.revision).toBe(g.revision.seq);
    expect(r.body.coverage.roles).toHaveLength(18);
    expect(r.body.coverage.missingRoles).toEqual([]);
    expect(r.body.coverage.span.max).toBeGreaterThan(0);
    expect(r.body.coverage.depth).toBeGreaterThanOrEqual(2);
  });
  it('a signed-in member can read it; an anonymous request cannot', async () => {
    expect((await M.req('GET', '/organization/coverage')).status).toBe(200);
    const anon = await t.app.inject({ method: 'GET', url: '/api/v1/organization/coverage' });
    expect(anon.statusCode).toBe(401);
  });
  it('a dry run carries the coverage block; leaving an agent out is an error and also an uncovered role, never a coverage error', async () => {
    const g = await graph();
    const drop = g.edges.find((x) => x.subordinateId === 'writer-01')!;
    const edges = g.edges.filter((x) => x !== drop);
    const r = await A.req('POST', '/organization/proposals?dryRun=1', { title: 't', why: '', baseRevision: g.revision.seq, edges });
    expect(r.status).toBe(200);
    expect(r.body.result.coverage.current.missingRoles).toEqual([]);
    expect(r.body.result.coverage.proposed.missingRoles).toEqual(['writer']);
    expect(r.body.result.coverage.changes.map((c: any) => c.code)).toContain('ROLE_UNCOVERED');
    expect(r.body.result.errors.every((x: any) => !/ROLE|COVER/.test(x.code))).toBe(true);
  });
  it('coverage facts never block: a proposal that only changes coverage is ok and can be approved', async () => {
    const g = await graph();
    const moved = g.edges.map((x) => (x.subordinateId === 'writer-01' ? { ...x, supervisorId: 'gm' } : x));
    const p = await propose(A, moved, g.revision.seq, 'move writer');
    expect(p.status).toBe(201);
    expect(p.body.proposal.result.ok).toBe(true);
    expect(p.body.proposal.result.coverage.changes).toBeDefined();
    const d = await B.req('POST', `/organization/proposals/${p.body.proposal.id}/decision`, { decision: 'approve', sha: p.body.proposal.sha });
    expect(d.status).toBe(200);
  });
  it('history: every revision summary carries its coverage', async () => {
    const r = await A.req('GET', '/organization/revisions');
    expect(r.body.revisions.length).toBeGreaterThanOrEqual(2);
    for (const v of r.body.revisions) { expect(v.coverage.roles).toHaveLength(18); expect(typeof v.coverage.depth).toBe('number'); }
  });
  it('tenant scoping: another tenant sees only its own agents', async () => {
    await t.pool.query(`insert into tenants(id,name) values ('t-2','Other')`);
    await t.pool.query(`insert into agent_definitions(id, tenant_id, name, role, dept, duty, created_by) values ('x-gm','t-2','X GM','manager','Exec','d','system')`);
    const r = await A.req('GET', '/organization/coverage');
    expect(JSON.stringify(r.body.coverage)).not.toContain('x-gm');
  });
});
