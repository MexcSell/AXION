import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeTestApp, withAdmin, type TestApp, type Browser } from './helpers.ts';
import { diffLines } from '../src/organization/validate.ts';

// Improvement cycle 4 (theme A): organisation history, before/after diff with mission impact, and rollback as an ordinary
// cycle 1 proposal (brief web/docs/improve/cycles/c04-brief.md, "Tests"). Missions and instances are fixture rows so the
// impact list is exact; every organisation change goes through the API.
let t: TestApp;
let A: Browser; // administrator Luca (proposes)
let B: Browser; // second administrator Bea (decides)
let M: Browser; // member Mia
let aId = '', bId = '', mId = '';
let n = 0;
const key = () => ({ 'idempotency-key': 'h' + n++ });
const q = (sql: string, p: unknown[] = []) => t.pool.query(sql, p);
const count = async (sql: string, p: unknown[] = []) => (await q(sql, p)).rows[0].n as number;

type Edge = { supervisorId: string; subordinateId: string; edgeType?: string };
const norm = (es: Edge[]) => es.map((e) => `${e.supervisorId}>${e.subordinateId}:${e.edgeType ?? 'reports_to'}`).sort();
const graph = async () => (await A.req('GET', '/organization/graph')).body as { revision: { id: number; seq: number }; edges: Edge[] };
const revision = (b: Browser, seq: number | string) => b.req('GET', `/organization/revisions/${seq}`);
const diff = (b: Browser, seq: number | string, qs = '') => b.req('GET', `/organization/revisions/${seq}/diff${qs}`);
const rollback = (b: Browser, seq: number | string, body: Record<string, unknown> = {}, headers: Record<string, string> = key()) =>
  b.req('POST', `/organization/revisions/${seq}/rollback-proposal`, body, headers);
const decide = (by: Browser, p: { id: string; sha: string }, decision: 'approve' | 'reject') => by.req('POST', `/organization/proposals/${p.id}/decision`, { decision, sha: p.sha });

async function mission(id: string, owner: string, o: { shared?: boolean; status?: string; tenant?: string; archived?: boolean; deleted?: boolean; demo?: boolean } = {}) {
  await q(`insert into missions(id, tenant_id, owner_id, shared, status, demo, archived_at, deleted_at) values ($1,$2,$3,$4,$5,$6, case when $7 then now() end, case when $8 then now() end)`,
    [id, o.tenant ?? 't-1', owner, o.shared ?? false, o.status ?? 'running', o.demo ?? false, o.archived ?? false, o.deleted ?? false]);
  await q(`insert into mission_revisions(mission_id, revision, title, kind, priority, text, created_by) values ($1,1,$2,'data','normal','x',$3)`, [id, `Mission ${id}`, owner]);
}
/** An instance of an agent in a mission; non-GM instances report to the mission's GM instance. */
async function instance(missionId: string, agentId: string, tenant = 't-1') {
  await q(`insert into agent_instances(id, tenant_id, mission_id, agent_id, agent_version_id, manager_instance_id)
           select $1, $2, $3, d.id, d.active_version_id, $4 from agent_definitions d where d.id=$5`,
  [`${missionId}:${agentId}`, tenant, missionId, agentId === 'gm' ? null : `${missionId}:gm`, agentId]);
}

beforeAll(async () => {
  t = await makeTestApp({ staffingStepMs: 3_600_000, conversationSimMs: 3_600_000, demoSeed: false });
  const w = await withAdmin(t.app);
  A = w.admin; aId = w.adminId;
  const b = await w.member('Bea');
  B = b.b; bId = b.id;
  expect((await A.req('PATCH', `/users/${bId}`, { role: 'admin' })).status).toBe(200);
  const m = await w.member('Mia');
  M = m.b; mId = m.id;
  // H1 private (admin's), H2 shared, both running with Coder-01 under the mission GM;
  // H3 completed, H4 archived, H5 deleted, H6 without Coder-01; O1 another tenant's shared running mission with Coder-01
  await mission('H1', aId); await instance('H1', 'gm'); await instance('H1', 'coder-01');
  await mission('H2', aId, { shared: true }); await instance('H2', 'gm'); await instance('H2', 'coder-01');
  await mission('H3', aId, { shared: true, status: 'completed' }); await instance('H3', 'gm'); await instance('H3', 'coder-01');
  await mission('H4', aId, { shared: true, status: 'archived', archived: true }); await instance('H4', 'gm'); await instance('H4', 'coder-01');
  await mission('H5', aId, { shared: true, deleted: true }); await instance('H5', 'gm'); await instance('H5', 'coder-01');
  await mission('H6', aId, { shared: true }); await instance('H6', 'gm'); await instance('H6', 'writer-01');
  await mission('H7', mId); await instance('H7', 'gm'); await instance('H7', 'coder-01'); // the member's own private mission
  await q(`insert into tenants(id,name) values ('t-2','Other')`);
  await q(`insert into users(id,tenant_id,name,name_key,pass_hash,role,status) values ('u-x','t-2','X','x','h','admin','approved')`);
  await mission('O1', 'u-x', { shared: true, tenant: 't-2' }); await instance('O1', 'gm', 't-2'); await instance('O1', 'coder-01', 't-2');
});
afterAll(async () => { await t?.close(); });

describe('diffLines (pure)', () => {
  it('keys lines by subordinate: moved, added and removed', () => {
    const before = [{ supervisorId: 'gm', subordinateId: 'a' }, { supervisorId: 'gm', subordinateId: 'b' }, { supervisorId: 'a', subordinateId: 'c' }];
    const after = [{ supervisorId: 'gm', subordinateId: 'a' }, { supervisorId: 'a', subordinateId: 'b' }, { supervisorId: 'gm', subordinateId: 'd' }];
    const d = diffLines(before, after);
    expect(d.moved).toEqual([{ subordinate: 'b', from: 'gm', to: 'a' }]);
    expect(d.added).toEqual([{ supervisorId: 'gm', subordinateId: 'd', edgeType: 'reports_to' }]);
    expect(d.removed).toEqual([{ supervisorId: 'a', subordinateId: 'c', edgeType: 'reports_to' }]);
    expect(diffLines(after, after)).toEqual({ added: [], removed: [], moved: [] });
    expect(diffLines([], before).added.length).toBe(3);
  });
});

let P1: { id: string; sha: string; title: string };
let rev1: Edge[] = [];
describe('revisions and diff', () => {
  it('revision 1 is the seed: lines, who, when, source seed', async () => {
    const r = await revision(M, 1);
    expect(r.status).toBe(200);
    rev1 = r.body.revision.edges;
    expect(norm(rev1)).toEqual(norm((await graph()).edges));
    expect(r.body.revision).toMatchObject({ seq: 1, createdBy: 'system', source: { kind: 'seed' }, appliedFromProposal: null, changed: rev1.length });
    expect(Date.parse(r.body.revision.activeFrom)).not.toBeNaN();
  });

  it('A proposes, B approves: revision 2 says it came from that proposal, by Bea', async () => {
    const g = await graph();
    const edges = g.edges.map((e) => (e.subordinateId === 'coder-01' ? { ...e, supervisorId: 'ops-01' } : e));
    const c = await A.req('POST', '/organization/proposals', { title: 'Coder-01 under Ops-01', why: 'Reviews.', baseRevision: g.revision.seq, edges }, key());
    expect(c.status).toBe(201);
    P1 = c.body.proposal;
    expect((await decide(B, P1, 'approve')).status).toBe(200);
    const r = await revision(M, 2);
    expect(r.status).toBe(200);
    expect(r.body.revision).toMatchObject({ seq: 2, createdBy: bId, createdByName: 'Bea', appliedFromProposal: P1.id, source: { kind: 'proposal', proposalId: P1.id, title: 'Coder-01 under Ops-01' }, changed: 1 });
    expect(norm(r.body.revision.edges)).toEqual(norm(edges));
  });

  it('the list carries the same metadata for every revision (oldest first)', async () => {
    const r = await M.req('GET', '/organization/revisions');
    expect(r.status).toBe(200);
    expect(r.body.revisions.map((x: { seq: number }) => x.seq)).toEqual([1, 2]);
    expect(r.body.revisions[1]).toMatchObject({ seq: 2, createdByName: 'Bea', changed: 1, source: { kind: 'proposal', proposalId: P1.id } });
    expect(r.body.revisions[0]).toMatchObject({ seq: 1, source: { kind: 'seed' } });
  });

  it('the diff of revision 2 is exactly the moved line; impact lists only visible, active missions (admin)', async () => {
    const r = await diff(A, 2);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ seq: 2, against: 1, added: [], removed: [], moved: [{ subordinate: 'coder-01', from: 'gm', to: 'ops-01' }] });
    // H3 completed, H4 archived, H5 deleted, H6 no Coder-01, O1 another tenant; an administrator sees every mission (H7 too)
    expect(r.body.impact.map((x: { instanceId: string }) => x.instanceId)).toEqual(['H1:coder-01', 'H2:coder-01', 'H7:coder-01']);
    expect(r.body.impact[0]).toEqual({ missionId: 'H1', title: 'Mission H1', agentId: 'coder-01', instanceId: 'H1:coder-01', demo: false });
  });

  it('a member does not see the admin\'s private mission in the impact (but sees her own and shared ones)', async () => {
    const r = await diff(M, 2);
    expect(r.status).toBe(200);
    expect(r.body.moved).toEqual([{ subordinate: 'coder-01', from: 'gm', to: 'ops-01' }]);
    expect(r.body.impact.map((x: { instanceId: string }) => x.instanceId)).toEqual(['H2:coder-01', 'H7:coder-01']);
  });

  it('?against: any revision, 0 = before any revision; revision 1 by default against 0', async () => {
    const r1 = await diff(M, 1);
    expect(r1.body).toMatchObject({ seq: 1, against: 0, removed: [], moved: [] });
    expect(r1.body.added.length).toBe(rev1.length);
    const back = await diff(M, 1, '?against=2');
    expect(back.body).toMatchObject({ seq: 1, against: 2, added: [], removed: [], moved: [{ subordinate: 'coder-01', from: 'ops-01', to: 'gm' }] });
    expect((await diff(M, 2, '?against=99')).status).toBe(404);
    expect((await diff(M, 2, '?against=x')).status).toBe(400);
    expect((await diff(M, 99)).status).toBe(404);
    expect((await revision(M, 99)).status).toBe(404);
    expect((await revision(M, 'x')).status).toBe(400);
  });

  it('reads write nothing (no audit row, no event, no proposal change) and need a session', async () => {
    const before = [await count('select count(*)::int n from audit_events'), await count('select count(*)::int n from events'), await count('select count(*)::int n from org_revisions')];
    await revision(A, 2); await diff(A, 2); await diff(M, 1, '?against=2'); await A.req('GET', '/organization/revisions');
    expect([await count('select count(*)::int n from audit_events'), await count('select count(*)::int n from events'), await count('select count(*)::int n from org_revisions')]).toEqual(before);
    for (const url of ['/organization/revisions/1', '/organization/revisions/1/diff', '/organization/revisions']) expect((await t.app.inject({ method: 'GET', url: '/api/v1' + url })).statusCode).toBe(401);
  });
});

let rbKey: Record<string, string> = {};
let RB: { id: string; sha: string; title: string; baseRevision: number; edges: Edge[]; result: any; status: string };
describe('rollback proposals', () => {
  it('a member is 403; an anonymous caller 401; nothing is stored', async () => {
    expect((await rollback(M, 1)).status).toBe(403);
    expect((await t.app.inject({ method: 'POST', url: '/api/v1/organization/revisions/1/rollback-proposal', payload: {} })).statusCode).toBe(401);
    expect(await count(`select count(*)::int n from org_proposals where status='pending'`)).toBe(0);
  });

  it('needs an Idempotency-Key', async () => {
    const r = await rollback(A, 1, {}, {});
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('rolling back to the latest revision is 422 NOTHING_TO_ROLL_BACK', async () => {
    const r = await rollback(A, 2);
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('NOTHING_TO_ROLL_BACK');
  });

  it('an unknown revision is 404', async () => {
    expect((await rollback(A, 99)).status).toBe(404);
  });

  it('admin A: an ordinary pending proposal whose edges are revision 1 exactly, on the latest base, audited and announced', async () => {
    rbKey = key();
    const r = await rollback(A, 1, { why: 'Ops is overloaded.' }, rbKey);
    expect(r.status).toBe(201);
    RB = r.body.proposal;
    expect(RB).toMatchObject({ title: 'Roll back to revision 1', why: 'Ops is overloaded.', baseRevision: 2, status: 'pending', createdBy: aId, appliedRevision: null });
    expect(norm(RB.edges)).toEqual(norm(rev1));
    // its dry run (against the active revision 2) shows the reverse move
    expect(RB.result.ok).toBe(true);
    expect(RB.result.added).toEqual([{ supervisorId: 'gm', subordinateId: 'coder-01', edgeType: 'reports_to' }]);
    expect(RB.result.removed).toEqual([{ supervisorId: 'ops-01', subordinateId: 'coder-01', edgeType: 'reports_to' }]);
    expect(await count(`select count(*)::int n from audit_events where action='org.proposal.create' and subject=$1 and result='ok' and detail->>'rollbackTo'='1'`, [RB.id])).toBe(1);
    expect(await count(`select count(*)::int n from events where type='org.proposalCreated' and subject_id=$1 and subject_kind='org' and audience='all'`, [RB.id])).toBe(1);
    // the same proposal is listed like any other
    expect((await M.req('GET', '/organization/proposals')).body.proposals.find((p: { id: string }) => p.id === RB.id)?.status).toBe('pending');
  });

  it('the same key replays the stored response; a new request while it is pending is 409 DUPLICATE_PROPOSAL (same or other why)', async () => {
    const replay = await rollback(A, 1, { why: 'Ops is overloaded.' }, rbKey);
    expect(replay.status).toBe(201);
    expect(replay.body.proposal.id).toBe(RB.id);
    const other = await rollback(A, 1, { why: 'Another reason.' }); // a different why: still the same lines
    expect(other.status).toBe(409);
    expect(other.body.code).toBe('DUPLICATE_PROPOSAL');
    const same = await rollback(A, 1, { why: 'Ops is overloaded.' });
    expect(same.status).toBe(409);
    expect(same.body.code).toBe('DUPLICATE_PROPOSAL');
    expect(await count(`select count(*)::int n from org_proposals where status='pending'`)).toBe(1);
  });

  it('the author cannot approve it (403 SELF_APPROVAL, audited as denied)', async () => {
    const r = await decide(A, RB, 'approve');
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('SELF_APPROVAL');
    expect(await count(`select count(*)::int n from audit_events where action='org.proposal.decide' and subject=$1 and result='denied'`, [RB.id])).toBe(1);
  });

  it('B approves: revision 3 equals revision 1, made from the rollback proposal; running instances keep their managers', async () => {
    const before = (await q(`select id, manager_instance_id from agent_instances order by id`)).rows;
    const impacted = (await diff(A, 2)).body.impact.map((x: { instanceId: string }) => x.instanceId);
    expect(impacted.length).toBeGreaterThan(0); // non-vacuous: the diff names instances whose agent's manager changes
    expect(before.filter((x) => impacted.includes(x.id)).every((x) => x.manager_instance_id !== null)).toBe(true);
    const r = await decide(B, RB, 'approve');
    expect(r.status).toBe(200);
    expect(r.body.proposal).toMatchObject({ status: 'applied', appliedRevision: 3 });
    const g = await graph();
    expect(g.revision.seq).toBe(3);
    expect(norm(g.edges)).toEqual(norm(rev1));
    const r3 = await revision(M, 3);
    expect(r3.body.revision).toMatchObject({ seq: 3, createdBy: bId, appliedFromProposal: RB.id, source: { kind: 'proposal', title: 'Roll back to revision 1' }, changed: 1 });
    expect(norm(r3.body.revision.edges)).toEqual(norm(rev1));
    // the impacted instances (and every other instance) keep manager_instance_id exactly
    expect((await q(`select id, manager_instance_id from agent_instances order by id`)).rows).toEqual(before);
    const d3 = await diff(A, 3);
    expect(d3.body.moved).toEqual([{ subordinate: 'coder-01', from: 'ops-01', to: 'gm' }]);
    expect(d3.body.impact.map((x: { instanceId: string }) => x.instanceId)).toEqual(impacted);
  });

  it('a revision with the same lines as the latest is 422 NOTHING_TO_ROLL_BACK too (revision 1 = revision 3)', async () => {
    const r = await rollback(A, 1);
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('NOTHING_TO_ROLL_BACK');
  });

  it('a stale base: another revision lands before the decision → 409 ORG_CHANGED; the proposal stays pending', async () => {
    const c = await rollback(A, 2, { why: 'Back to Ops.' });
    expect(c.status).toBe(201);
    expect(c.body.proposal.baseRevision).toBe(3);
    // a new agent is a new org revision (4), from "agent created"
    const na = await A.req('POST', '/agents', { id: 'hist-01', name: 'Hist-01', role: 'historian', dept: 'Operations', duty: 'Keeps the history', model: 'claude-sonnet-5-5' }, key());
    expect(na.status).toBe(201);
    const r4 = await revision(M, 4);
    expect(r4.body.revision).toMatchObject({ seq: 4, source: { kind: 'agent', agentId: 'hist-01' }, appliedFromProposal: null, changed: 1 });
    const d4 = await diff(M, 4);
    expect(d4.body).toMatchObject({ added: [{ supervisorId: 'gm', subordinateId: 'hist-01', edgeType: 'reports_to' }], removed: [], moved: [], impact: [] });
    const d = await decide(B, c.body.proposal, 'approve');
    expect(d.status).toBe(409);
    expect(d.body.code).toBe('ORG_CHANGED');
    expect((await q('select status from org_proposals where id=$1', [c.body.proposal.id])).rows[0].status).toBe('pending');
    expect(await count(`select count(*)::int n from org_revisions where tenant_id='t-1'`)).toBe(4);
    expect((await A.req('POST', `/organization/proposals/${c.body.proposal.id}/withdraw`)).status).toBe(200);
  });

  it('removed lines: revision 3 against 4 removes the new agent\'s line', async () => {
    const d = await diff(M, 3, '?against=4');
    expect(d.body).toMatchObject({ added: [], moved: [], removed: [{ supervisorId: 'gm', subordinateId: 'hist-01', edgeType: 'reports_to' }] });
  });

  it('rolling back past an agent created since: stored with the dry-run error (hist-01 without a manager), approval 422, no revision', async () => {
    const c = await rollback(A, 2);
    expect(c.status).toBe(201);
    expect(c.body.proposal.result.ok).toBe(false);
    expect(c.body.proposal.result.errors.map((e: { code: string; agentId?: string }) => `${e.code}:${e.agentId}`)).toContain('NO_MANAGER:hist-01');
    const d = await decide(B, c.body.proposal, 'approve');
    expect(d.status).toBe(422);
    expect(d.body.code).toBe('ORG_INVALID');
    expect(await count(`select count(*)::int n from org_revisions where tenant_id='t-1'`)).toBe(4);
    await A.req('POST', `/organization/proposals/${c.body.proposal.id}/withdraw`);
  });
});

describe('tenants', () => {
  it("another tenant's revisions are 404 (read, diff, rollback); a shared seq number shows this tenant's own lines", async () => {
    await q(`insert into org_revisions(tenant_id, seq, note, created_by) values ('t-2', 1, 'other seed', 'u-x'), ('t-2', 77, 'other', 'u-x')`);
    expect((await revision(A, 77)).status).toBe(404);
    expect((await diff(A, 77)).status).toBe(404);
    expect((await diff(A, 2, '?against=77')).status).toBe(404);
    expect((await rollback(A, 77)).status).toBe(404);
    const r1 = await revision(A, 1);
    expect(r1.body.revision.note).not.toBe('other seed');
    expect(norm(r1.body.revision.edges)).toEqual(norm(rev1));
    expect((await A.req('GET', '/organization/revisions')).body.revisions.map((x: { seq: number }) => x.seq)).toEqual([1, 2, 3, 4]);
  });
});

describe('integrity', () => {
  it('org_edges and org_revisions stay append-only', async () => {
    await expect(q(`update org_edges set edge_type='x'`)).rejects.toThrow(/append-only/);
    await expect(q(`delete from org_revisions`)).rejects.toThrow(/append-only/);
  });
});
