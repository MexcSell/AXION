import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { audit } from '../src/audit.ts';
import { makeTestApp, withAdmin, type TestApp, type Browser } from './helpers.ts';

// Improvement cycle 64 (R3-6), item 1: the evidence block of an organisation proposal. The proposer only PICKS which triggers apply
// (a strict enum); every count is computed by the server from recorded rows, so a typed count is refused. Demo missions and simulated
// tasks are not evidence. The window bound is the database clock (SQL now()).
let t: TestApp;
let A: Browser;
let n = 0;
const key = () => ({ 'idempotency-key': 'ev' + n++ });
const q = (sql: string, p: unknown[] = []) => t.pool.query(sql, p);
type Edge = { supervisorId: string; subordinateId: string; edgeType?: string };
const graph = async () => (await A.req('GET', '/organization/graph')).body as { revision: { seq: number }; edges: Edge[] };
const moved = (edges: Edge[], sub: string, sup: string) => edges.map((e) => (e.subordinateId === sub ? { ...e, supervisorId: sup } : e));
async function body(extra: Record<string, unknown> = {}, sub = 'coder-01', sup = 'ops-01') {
  const g = await graph();
  return { baseline: 'No change: keep the current chart as it is.', expectedCost: 'No added cost is expected in this test.', title: 'Move ' + sub, why: 'evidence test', baseRevision: g.revision.seq, edges: moved(g.edges, sub, sup), ...extra };
}

async function mission(id: string, o: { demo?: boolean } = {}) {
  await q(`insert into missions(id, tenant_id, owner_id, shared, status, demo) values ($1,'t-1',(select id from users limit 1),true,'running',$2)`, [id, o.demo ?? false]);
  await q(`insert into mission_revisions(mission_id, revision, title, kind, priority, text, created_by) values ($1,1,$1,'data','normal','x','u')`, [id]);
}
async function task(id: string, m: string, agent: string, status = 'running', simulated = false) {
  await q(`insert into tasks(id, tenant_id, mission_id, title, status, owner_agent, simulated) values ($1,'t-1',$2,'T',$3,$4,$5)`, [id, m, status, agent, simulated]);
}
const tag = (id: string, m: string, taskId: string, status = 'confirmed', ageDays = 1) => q(
  `insert into failure_tags(id, tenant_id, mission_id, subject_kind, subject_id, taxonomy_version, mode_id, tagged_by, tagged_by_kind, status, created_at, decided_by, decided_at)
   values ($1,'t-1',$2,'task',$3,'v','FM-1.1','u1','user',$4, now() - make_interval(days => $5), $6, $7)`,
  [id, m, taskId, status, ageDays, status === 'proposed' ? null : 'u2', status === 'proposed' ? null : new Date()]);
// audit rows are append-only (hash chain), so they cannot be back-dated: both reassigns are recent. The window bound itself is
// exercised through failure tags, which can be back-dated.
const reassign = (taskId: string, fromAgent: string) => audit(t.pool, { tenantId: 't-1', actor: 'u', action: 'task.reassign', subject: taskId, result: 'ok', correlationId: 'c', detail: { fromAgent } });

beforeAll(async () => {
  t = await makeTestApp({ staffingStepMs: 3_600_000, conversationSimMs: 3_600_000, demoSeed: false, writeLimits: { proposals: { max: 1000, windowMs: 60_000 } } });
  A = (await withAdmin(t.app)).admin;
  await mission('M-REAL'); await mission('M-DEMO', { demo: true });
  // coder-01 is the busiest agent: 6 open tasks (one simulated and one on a demo mission do not count); three others hold one each
  for (let i = 0; i < 6; i++) await task('T-C' + i, 'M-REAL', 'coder-01');
  await task('T-SIM', 'M-REAL', 'coder-01', 'running', true);
  await task('T-DEMO', 'M-DEMO', 'coder-01');
  for (const a of ['ops-01', 'writer-01', 'tester-01']) await task('T-' + a, 'M-REAL', a);
  await task('T-DONE', 'M-REAL', 'coder-01', 'passed'); // finished: not load
  // failures: three confirmed tags on coder-01's tasks in the window, one only proposed, one confirmed 45 days ago, one on a demo task
  await tag('FT-1', 'M-REAL', 'T-C0'); await tag('FT-2', 'M-REAL', 'T-C1'); await tag('FT-3', 'M-REAL', 'T-C2');
  await tag('FT-4', 'M-REAL', 'T-C3', 'proposed'); await tag('FT-5', 'M-REAL', 'T-C4', 'confirmed', 45); await tag('FT-6', 'M-DEMO', 'T-DEMO');
  await tag('FT-7', 'M-REAL', 'T-ops-01');
  // reassigns away from coder-01 (a dev): two in the window; a denied one does not count
  await reassign('T-C0', 'coder-01'); await reassign('T-C1', 'coder-01');
  await audit(t.pool, { tenantId: 't-1', actor: 'u', action: 'task.reassign', subject: 'T-C2', result: 'denied', correlationId: 'c', detail: { fromAgent: 'coder-01' } });
});
afterAll(async () => { await t?.close(); });

const fact = (ev: any, kind: string, label: RegExp) => ev.triggers.find((x: any) => x.kind === kind).facts.find((f: any) => label.test(f.label))?.value;

describe('the proposer picks triggers; the server computes the counts', () => {
  it('typed counts or an evidence object are refused (400), an unknown trigger too', async () => {
    expect((await A.req('POST', '/organization/proposals', await body({ triggers: [{ kind: 'load_imbalance', counts: { max: 99 } }] }), key())).status).toBe(400);
    expect((await A.req('POST', '/organization/proposals', await body({ evidence: { triggers: [] } }), key())).status).toBe(400);
    expect((await A.req('POST', '/organization/proposals', await body({ triggers: ['more_hierarchy'] }), key())).status).toBe(400);
    expect((await q('select count(*)::int n from org_proposals')).rows[0].n).toBe(0);
  });

  it('no trigger picked: an empty evidence list, stored honestly (the UI says "no recorded trigger")', async () => {
    const r = await A.req('POST', '/organization/proposals?dryRun=1', await body());
    expect(r.status).toBe(200);
    expect(r.body.result.evidence).toEqual({ triggers: [], windowDays: 30 });
  });

  it('load imbalance: open tasks per agent from recorded rows (simulated, demo and finished tasks do not count)', async () => {
    const r = await A.req('POST', '/organization/proposals?dryRun=1', await body({ triggers: ['load_imbalance'] }));
    const ev = r.body.result.evidence;
    expect(ev.triggers).toHaveLength(1);
    expect(ev.triggers[0]).toMatchObject({ kind: 'load_imbalance', supported: true, subjects: ['coder-01'] });
    expect(fact(ev, 'load_imbalance', /busiest agent/i)).toBe(6);
    expect(fact(ev, 'load_imbalance', /agents with at least one/i)).toBe(4);
  });

  it('repeated reassigns: only successful ones, and only the affected roles (coder-01 moves, so the dev role counts: 2, not 3)', async () => {
    const r = await A.req('POST', '/organization/proposals?dryRun=1', await body({ triggers: ['repeated_reassigns'] }));
    expect(fact(r.body.result.evidence, 'repeated_reassigns', /affected roles/i)).toBe(2);
    expect(fact(r.body.result.evidence, 'repeated_reassigns', /all roles/i)).toBe(2);
    // a move that touches no agent with reassigns: nothing in the affected roles, so not supported
    const other = await A.req('POST', '/organization/proposals?dryRun=1', await body({ triggers: ['repeated_reassigns'] }, 'writer-01', 'coder-01'));
    expect(other.body.result.evidence.triggers[0].supported).toBe(true); // coder-01 is the new manager: its role is affected too
  });

  it('failure concentration: confirmed tags only, in the window, with the share of the top role', async () => {
    const r = await A.req('POST', '/organization/proposals?dryRun=1', await body({ triggers: ['failure_concentration'] }));
    const ev = r.body.result.evidence;
    expect(fact(ev, 'failure_concentration', /confirmed failure tags/i)).toBe(4); // FT-1..3 (coder-01) + FT-7 (ops-01); proposed, old and demo ones excluded
    expect(fact(ev, 'failure_concentration', /top role/i)).toBe(3);
    expect(ev.triggers[0]).toMatchObject({ supported: true, subjects: ['dev'] });
  });

  it('coverage gap: the counts equal the coverage facts of the active chart', async () => {
    const cov = (await A.req('GET', '/organization/coverage')).body.coverage;
    const r = await A.req('POST', '/organization/proposals?dryRun=1', await body({ triggers: ['coverage_gap'] }));
    const ev = r.body.result.evidence;
    expect(fact(ev, 'coverage_gap', /roles nobody holds/i)).toBe(cov.missingRoles.length);
    expect(fact(ev, 'coverage_gap', /departments without a head/i)).toBe(cov.deptsWithoutHead.length);
    expect(fact(ev, 'coverage_gap', /agents without a duty/i)).toBe(cov.agentsWithoutDuty.length);
  });

  it('a picked trigger the data does not support is shown as such, never hidden or inflated', async () => {
    // writer-01 under ops-01 touches no dev agent, and the only reassigns are away from a dev
    const r = await A.req('POST', '/organization/proposals?dryRun=1', await body({ triggers: ['repeated_reassigns'] }, 'writer-01', 'ops-01'));
    expect(r.body.result.evidence.triggers[0]).toMatchObject({ kind: 'repeated_reassigns', supported: false });
    expect(fact(r.body.result.evidence, 'repeated_reassigns', /affected roles/i)).toBe(0);
    expect(fact(r.body.result.evidence, 'repeated_reassigns', /all roles/i)).toBe(2);
  });

  it('the stored proposal carries the same evidence and the picked triggers, and a duplicate trigger is one', async () => {
    const p = (await A.req('POST', '/organization/proposals', await body({ triggers: ['load_imbalance', 'load_imbalance'] }), key())).body.proposal;
    expect(p.triggers).toEqual(['load_imbalance']);
    expect(p.result.evidence.triggers.map((x: any) => x.kind)).toEqual(['load_imbalance']);
    const listed = (await A.req('GET', '/organization/proposals')).body.proposals.find((x: any) => x.id === p.id);
    expect(listed.result.evidence).toEqual(p.result.evidence);
  });

  it('the picked triggers are part of the digest the approver reviews (a different trigger list is a different sha)', async () => {
    const a = (await A.req('POST', '/organization/proposals', await body({ triggers: ['coverage_gap'] }, 'tester-01', 'coder-01'), key())).body.proposal;
    const b = (await A.req('POST', '/organization/proposals', await body({ triggers: ['load_imbalance'] }, 'tester-01', 'coder-01'), key())).body.proposal;
    expect(a.sha).not.toBe(b.sha);
  });
});
