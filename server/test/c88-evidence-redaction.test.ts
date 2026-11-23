import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeTestApp, withAdmin, type TestApp, type Browser } from './helpers.ts';
import { proposalsBody } from './contracts/validators.ts';

// c88 item 1 (T2): a member reads organisation proposals (GET /organization/proposals is requireUser). Each proposal's stored
// result.evidence counts open tasks, failures and reassigns over ALL non-demo missions, private ones included. So for a non-admin the
// counts that come from mission data are replaced, at READ time, by a hidden state. The stored row is not changed.
let t: TestApp;
let A: Browser; let M: Browser; let Bea: Browser;
let beaId = '';
let n = 0;
const key = () => ({ 'idempotency-key': 'r88-' + n++ });
const q = (sql: string, p: unknown[] = []) => t.pool.query(sql, p);
type Edge = { supervisorId: string; subordinateId: string; edgeType?: string };
const ALL = ['load_imbalance', 'coverage_gap', 'repeated_reassigns', 'failure_concentration'];
async function propose(title: string) {
  const g = (await A.req('GET', '/organization/graph')).body as { revision: { seq: number }; edges: Edge[] };
  const edges = g.edges.map((e) => (e.subordinateId === 'coder-01' ? { ...e, supervisorId: 'ops-01' } : e));
  const r = await A.req('POST', '/organization/proposals', { baseline: 'No change: keep the current chart as it is.', expectedCost: 'No added cost is expected in this test.', title, why: 'c88', baseRevision: g.revision.seq, edges, triggers: ALL }, key());
  expect(r.status).toBe(201);
  return r.body.proposal.id as string;
}
const list = async (b: Browser) => (await b.req('GET', '/organization/proposals')).body as { proposals: any[] };
const evOf = async (b: Browser, id: string) => (await list(b)).proposals.find((p) => p.id === id).result.evidence;
const all = (ev: any) => [...ev.triggers, ...ev.others];
const fact = (ev: any, kind: string, label: RegExp) => all(ev).find((x: any) => x.kind === kind).facts.find((f: any) => label.test(f.label))?.value;

beforeAll(async () => {
  t = await makeTestApp({ staffingStepMs: 3_600_000, conversationSimMs: 3_600_000, demoSeed: false, writeLimits: { proposals: { max: 1000, windowMs: 60_000 } } });
  const w = await withAdmin(t.app);
  A = w.admin;
  M = (await w.member('Mia')).b;
  const b = await w.member('Bea'); Bea = b.b; beaId = b.id;
  // a shared mission with open tasks on coder-01 (3) and ops-01 (1)
  await q(`insert into missions(id, tenant_id, owner_id, shared, status) values ('M-SH','t-1',$1,true,'running')`, [beaId]);
  for (const [i, a] of ['coder-01', 'coder-01', 'coder-01', 'ops-01'].entries()) await q(`insert into tasks(id, tenant_id, mission_id, title, status, owner_agent) values ($1,'t-1','M-SH','T','running',$2)`, ['T-SH' + i, a]);
});
afterAll(async () => { await t?.close(); });

describe('c88 item 1: the member view of proposal evidence', () => {
  it('a member sees no mission-derived count, and a private mission of another member changes nothing for the member but does for the admin', async () => {
    const p1 = await propose('Before the private task');
    const memberBefore = await evOf(M, p1);
    const adminBefore = await evOf(A, p1);
    expect(fact(adminBefore, 'load_imbalance', /agents with at least one/i)).toBe(2);
    // Bea's PRIVATE mission (not shared, owner Bea) gains an open task on a third agent
    await q(`insert into missions(id, tenant_id, owner_id, shared, status) values ('M-PRIV','t-1',$1,false,'running')`, [beaId]);
    await q(`insert into tasks(id, tenant_id, mission_id, title, status, owner_agent) values ('T-PRIV','t-1','M-PRIV','T','running','writer-01')`);
    const p2 = await propose('After the private task');
    const memberAfter = await evOf(M, p2);
    const adminAfter = await evOf(A, p2);
    expect(fact(adminAfter, 'load_imbalance', /agents with at least one/i)).toBe(3); // the admin sees the change
    expect(memberAfter).toEqual(memberBefore);                                         // the member sees none
    // no mission-derived number reaches the member: the three data triggers are hidden, with no facts, no subjects and no verdict
    for (const k of ['load_imbalance', 'repeated_reassigns', 'failure_concentration']) {
      const tr = all(memberAfter).find((x: any) => x.kind === k);
      expect(tr).toMatchObject({ hidden: true, supported: null, facts: [], subjects: [] });
    }
    // the coverage gap reads the chart and the agents, not missions: it stays
    const cov = all(memberAfter).find((x: any) => x.kind === 'coverage_gap');
    expect(cov.hidden).toBeUndefined();
    expect(cov.facts.length).toBeGreaterThan(0);
    expect(JSON.stringify(memberAfter)).not.toMatch(/"value":null|NaN|undefined/); // never a null count in a fact
    // admin responses are the stored row; the stored row is unchanged by the read
    const stored = (await q(`select result->'evidence' as e from org_proposals where id=$1`, [p2])).rows[0].e;
    expect(adminAfter).toEqual(stored);
    expect(fact(stored, 'load_imbalance', /agents with at least one/i)).toBe(3);
  });

  it('the member list and the admin list both pass the contract validators', async () => {
    for (const [who, b] of [['member', M], ['admin', A]] as const) {
      const errs: string[] = [];
      proposalsBody((await b.req('GET', '/organization/proposals')).body, who, errs);
      expect(errs).toEqual([]);
    }
  });

  it('the redaction is by role: a member who owns the private mission is redacted too, and an admin never is', async () => {
    const id = (await list(A)).proposals[0].id;
    expect(await evOf(Bea, id)).toEqual(await evOf(M, id));
    expect(all(await evOf(A, id)).every((x: any) => x.hidden === undefined)).toBe(true);
  });
});
