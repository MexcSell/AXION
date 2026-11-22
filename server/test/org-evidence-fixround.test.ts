import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { audit } from '../src/audit.ts';
import { makeTestApp, withAdmin, type TestApp, type Browser } from './helpers.ts';

// c64 fix round: S2 (the failure share uses all tags in the window), S3 (per-trigger time scope; demo and simulated work is not a
// reassign), S4 (all four triggers are shown with their counts, the picked ones marked), S6 (the escalation check and its setting).
let t: TestApp;
let A: Browser;
let n = 0;
const key = () => ({ 'idempotency-key': 'fx' + n++ });
const q = (sql: string, p: unknown[] = []) => t.pool.query(sql, p);
type Edge = { supervisorId: string; subordinateId: string; edgeType?: string };
async function dry(triggers: string[] = [], sub = 'coder-01', sup = 'ops-01') {
  const g = (await A.req('GET', '/organization/graph')).body as { revision: { seq: number }; edges: Edge[] };
  const edges = g.edges.map((e) => (e.subordinateId === sub ? { ...e, supervisorId: sup } : e));
  const r = await A.req('POST', '/organization/proposals?dryRun=1', { baseline: 'No change: keep the current chart as it is.', expectedCost: 'No added cost is expected in this test.', title: 'Move', why: 'fix round', baseRevision: g.revision.seq, edges, triggers });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.result;
}
const trig = (ev: any, kind: string) => [...ev.triggers, ...(ev.others ?? [])].find((x: any) => x.kind === kind);
const fact = (ev: any, kind: string, label: RegExp) => trig(ev, kind).facts.find((f: any) => label.test(f.label))?.value;
async function mission(id: string, demo = false) {
  await q(`insert into missions(id, tenant_id, owner_id, shared, status, demo) values ($1,'t-1',(select id from users limit 1),true,'running',$2)`, [id, demo]);
  await q(`insert into mission_revisions(mission_id, revision, title, kind, priority, text, created_by) values ($1,1,$1,'data','normal','x','u')`, [id]);
}
const task = (id: string, m: string, agent: string | null, simulated = false) => q(`insert into tasks(id, tenant_id, mission_id, title, status, owner_agent, simulated) values ($1,'t-1',$2,'T','running',$3,$4)`, [id, m, agent, simulated]);
const tag = (id: string, m: string, taskId: string) => q(
  `insert into failure_tags(id, tenant_id, mission_id, subject_kind, subject_id, taxonomy_version, mode_id, tagged_by, tagged_by_kind, status, decided_by, decided_at)
   values ($1,'t-1',$2,'task',$3,'v','FM-1.1','u1','user','confirmed','u2', now())`, [id, m, taskId]);
const reassign = (taskId: string, fromAgent: string) => audit(t.pool, { tenantId: 't-1', actor: 'u', action: 'task.reassign', subject: taskId, result: 'ok', correlationId: 'c', detail: { fromAgent } });

beforeAll(async () => {
  t = await makeTestApp({ staffingStepMs: 3_600_000, conversationSimMs: 3_600_000, demoSeed: false, writeLimits: { proposals: { max: 1000, windowMs: 60_000 } } });
  A = (await withAdmin(t.app)).admin;
  await mission('M-REAL'); await mission('M-DEMO', true);
  await task('T-A', 'M-REAL', 'coder-01');
  for (let i = 0; i < 9; i++) await task('T-U' + i, 'M-REAL', null); // nine tags on tasks nobody owns: in the window, not attributable to a role
  await tag('FT-A', 'M-REAL', 'T-A');
  for (let i = 0; i < 9; i++) await tag('FT-U' + i, 'M-REAL', 'T-U' + i);
  // reassigns away from coder-01: one on a real task, one on a demo mission's task, one on a simulated task
  await task('T-R', 'M-REAL', 'coder-01'); await task('T-RD', 'M-DEMO', 'coder-01'); await task('T-RS', 'M-REAL', 'coder-01', true);
  await reassign('T-R', 'coder-01'); await reassign('T-RD', 'coder-01'); await reassign('T-RS', 'coder-01');
});
afterAll(async () => { await t?.close(); });

describe('S2: the failure share is taken over all tags in the window', () => {
  it('1 attributed tag out of 10 is not "backed by the counts"', async () => {
    const r = await dry(['failure_concentration']);
    expect(fact(r.evidence, 'failure_concentration', /confirmed failure tags/i)).toBe(10);
    expect(fact(r.evidence, 'failure_concentration', /top role/i)).toBe(1);
    expect(trig(r.evidence, 'failure_concentration').supported).toBe(false);
  });
});

describe('S3: time scope per trigger, and demo or simulated work is not a reassign', () => {
  it('load and coverage are "now"; reassigns and failures are "window"', async () => {
    const r = await dry();
    expect(trig(r.evidence, 'load_imbalance').scope).toBe('now');
    expect(trig(r.evidence, 'coverage_gap').scope).toBe('now');
    expect(trig(r.evidence, 'repeated_reassigns').scope).toBe('window');
    expect(trig(r.evidence, 'failure_concentration').scope).toBe('window');
  });
  it('reassigns on demo missions and simulated tasks do not count (1 of 3)', async () => {
    const r = await dry(['repeated_reassigns']);
    expect(fact(r.evidence, 'repeated_reassigns', /all roles/i)).toBe(1);
    expect(fact(r.evidence, 'repeated_reassigns', /affected roles/i)).toBe(1);
  });
});

describe('S4: all four triggers are always shown, the picked ones marked', () => {
  it('picking one still shows the other three with their counts, in canonical order', async () => {
    const r = await dry(['coverage_gap']);
    expect(r.evidence.triggers.map((x: any) => x.kind)).toEqual(['coverage_gap']);
    expect(r.evidence.others.map((x: any) => x.kind)).toEqual(['load_imbalance', 'repeated_reassigns', 'failure_concentration']);
    for (const o of r.evidence.others) expect(o.facts.length).toBeGreaterThan(0);
  });
  it('picking none shows all four as not picked', async () => {
    const r = await dry();
    expect(r.evidence.triggers).toEqual([]);
    expect(r.evidence.others).toHaveLength(4);
  });
});
