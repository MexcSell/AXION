import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeTestApp, withAdmin, type TestApp, type Browser } from './helpers.ts';
import { payloadSha } from '../src/organization/proposals.ts';

// Improvement cycle 64 (R3-6), item 4: a proposal must STATE its expected added cost (coordination, extra hops) and a baseline ("no
// change", or a simple rule-based assignment) before it can be submitted. Plain text, 20 to 1000 characters, bound into the sha the
// approver reviews. A dry run (nothing stored) does not need them, so the screen can check the chart while they are still being typed.
let t: TestApp; let A: Browser; let B: Browser; let n = 0;
const key = () => ({ 'idempotency-key': 'bl' + n++ });
const BASELINE = 'No change: keep coder-01 under the GM.';
const COST = 'One more hop for escalations from coder-01.';
type Edge = { supervisorId: string; subordinateId: string };
async function body(extra: Record<string, unknown> = {}) {
  const g = (await A.req('GET', '/organization/graph')).body as { revision: { seq: number }; edges: Edge[] };
  return { title: 'Move coder-01', why: 'x', baseRevision: g.revision.seq, edges: g.edges.map((e) => (e.subordinateId === 'coder-01' ? { ...e, supervisorId: 'ops-01' } : e)), ...extra };
}
const full = async (extra: Record<string, unknown> = {}) => body({ baseline: BASELINE, expectedCost: COST, ...extra });
const count = async () => (await t.pool.query('select count(*)::int n from org_proposals')).rows[0].n as number;

beforeAll(async () => {
  t = await makeTestApp({ staffingStepMs: 3_600_000, conversationSimMs: 3_600_000, demoSeed: false, writeLimits: { proposals: { max: 1000, windowMs: 60_000 } } });
  const w = await withAdmin(t.app); A = w.admin;
  const b = await w.member('Bea'); B = b.b;
  expect((await A.req('PATCH', `/users/${b.id}`, { role: 'admin' })).status).toBe(200);
});
afterAll(async () => { await t?.close(); });

describe('a baseline and an expected cost are required to submit', () => {
  it('missing either one is a 400 and nothing is stored', async () => {
    expect((await A.req('POST', '/organization/proposals', await body({ expectedCost: COST }), key())).status).toBe(400);
    expect((await A.req('POST', '/organization/proposals', await body({ baseline: BASELINE }), key())).status).toBe(400);
    expect((await A.req('POST', '/organization/proposals', await body(), key())).status).toBe(400);
    expect(await count()).toBe(0);
  });
  it('too short (19 characters, or padding with spaces) and too long (1001) are refused; 20 and 1000 are accepted', async () => {
    const short = 'x'.repeat(19);
    expect((await A.req('POST', '/organization/proposals', await full({ baseline: short }), key())).status).toBe(400);
    expect((await A.req('POST', '/organization/proposals', await full({ expectedCost: short }), key())).status).toBe(400);
    expect((await A.req('POST', '/organization/proposals', await full({ baseline: '   ' + short + '   ' }), key())).status).toBe(400);
    expect((await A.req('POST', '/organization/proposals', await full({ baseline: 'y'.repeat(1001) }), key())).status).toBe(400);
    expect(await count()).toBe(0);
    const ok = await A.req('POST', '/organization/proposals', await full({ baseline: 'x'.repeat(20), expectedCost: 'y'.repeat(1000) }), key());
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
  });
  it('the stored proposal carries both texts, trimmed, and they are in the digest the approver reviews', async () => {
    const g = await full({ title: 'Digest one', baseline: '  ' + BASELINE + '  ' });
    const p = (await A.req('POST', '/organization/proposals', g, key())).body.proposal;
    expect(p).toMatchObject({ baseline: BASELINE, expectedCost: COST });
    const q = (await A.req('POST', '/organization/proposals', await full({ title: 'Digest one', expectedCost: 'A different statement of the cost.' }), key())).body.proposal;
    expect(q.sha).not.toBe(p.sha);
    // the text of a stored proposal cannot be changed behind the approver's back: the sha no longer matches
    await t.pool.query(`update org_proposals set baseline = 'A quietly rewritten baseline statement.' where id=$1`, [p.id]);
    const dec = await B.req('POST', `/organization/proposals/${p.id}/decision`, { decision: 'approve', sha: p.sha });
    expect(dec.status).toBe(409);
    expect(dec.body.code).toBe('PROPOSAL_CHANGED');
  });
  it('a dry run needs neither text (the chart is checked while they are typed)', async () => {
    const r = await A.req('POST', '/organization/proposals?dryRun=1', await body());
    expect(r.status).toBe(200);
  });
  it('a rollback proposal states its own baseline and cost (it restores an earlier, already approved chart)', async () => {
    const first = (await A.req('POST', '/organization/proposals', await full({ title: 'Move for rollback' }), key())).body.proposal;
    expect((await B.req('POST', `/organization/proposals/${first.id}/decision`, { decision: 'approve', sha: first.sha })).status).toBe(200);
    const rb = await A.req('POST', '/organization/revisions/1/rollback-proposal', {}, key());
    expect(rb.status, JSON.stringify(rb.body)).toBe(201);
    expect(rb.body.proposal.baseline.length).toBeGreaterThanOrEqual(20);
    expect(rb.body.proposal.expectedCost.length).toBeGreaterThanOrEqual(20);
    expect(rb.body.proposal.baseline).toMatch(/no change/i);
  });
  it('a proposal stored before c64 (no triggers, no texts) still verifies and can be decided: its sha uses the old formula', async () => {
    const g = (await A.req('GET', '/organization/graph')).body as { revision: { seq: number }; edges: Edge[] };
    const edges = g.edges.map((e) => (e.subordinateId === 'tester-01' ? { ...e, supervisorId: 'ops-01' } : e)).map((e) => ({ supervisor: e.supervisorId, subordinate: e.subordinateId, edge_type: 'reports_to' }));
    const sha = payloadSha({ title: 'Legacy', why: '', baseRevision: g.revision.seq, edges });
    const uid = (await t.pool.query(`select id from users where name='Luca' or role='admin' order by created_at limit 1`)).rows[0]?.id ?? 'u';
    await t.pool.query(`insert into org_proposals(id, tenant_id, title, why, base_revision, edges, payload_sha, created_by, result) values ('OP-LEGACY','t-1','Legacy','',$1,$2,$3,$4,'{}')`, [g.revision.seq, JSON.stringify(edges), sha, uid]);
    const list = (await A.req('GET', '/organization/proposals')).body.proposals.find((x: { id: string }) => x.id === 'OP-LEGACY');
    expect(list).toMatchObject({ baseline: '', expectedCost: '', triggers: [], linesChanged: 0 });
    const dec = await B.req('POST', '/organization/proposals/OP-LEGACY/decision', { decision: 'approve', sha });
    expect(dec.status, JSON.stringify(dec.body)).toBe(200);
  });
});
