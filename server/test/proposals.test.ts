import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeTestApp, withAdmin, type TestApp, type Browser } from './helpers.ts';
import { migrate, listMigrations } from '../src/migrate.ts';
import { seedDemo } from '../src/seed/demo.ts';
import { createOrgRevision } from '../src/agents/org.ts';
import { tx } from '../src/db.ts';

// Improvement cycle 1: organisation change proposals (brief web/docs/improve/cycles/c01-brief.md, "Tests").
let t: TestApp;
let A: Browser; // administrator who proposes
let B: Browser; // second administrator who decides
let M: Browser; // member
let aId = '', bId = '';
let n = 0;
const key = () => ({ 'idempotency-key': 'p' + n++ });
const rows = async (sql: string, p: unknown[] = []) => (await t.pool.query(sql, p)).rows;
const count = async (sql: string, p: unknown[] = []) => (await rows(sql, p))[0].n as number;
const until = async (f: () => Promise<boolean>, ms = 6000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await f()) return true; await new Promise((r) => setTimeout(r, 25)); } return false; };

type Edge = { supervisorId: string; subordinateId: string; edgeType?: string };
const graph = async () => (await A.req('GET', '/organization/graph')).body as { revision: { id: number; seq: number }; edges: Edge[] };
/** The active edges with `sub` reporting to `sup` instead. */
const moved = (edges: Edge[], sub: string, sup: string) => edges.map((e) => (e.subordinateId === sub ? { ...e, supervisorId: sup } : e));
const norm = (es: Edge[]) => es.map((e) => `${e.supervisorId}>${e.subordinateId}:${e.edgeType ?? 'reports_to'}`).sort();
async function propose(by: Browser, sub: string, sup: string, title = `Move ${sub} under ${sup}`, extra: Record<string, unknown> = {}) {
  const g = await graph();
  return by.req('POST', '/organization/proposals', { title, why: 'Shorter path for reviews.', baseRevision: g.revision.seq, edges: moved(g.edges, sub, sup), ...extra }, key());
}
const decide = (by: Browser, p: { id: string; sha: string }, decision: 'approve' | 'reject', extra: Record<string, unknown> = {}) =>
  by.req('POST', `/organization/proposals/${p.id}/decision`, { decision, sha: p.sha, ...extra });

beforeAll(async () => {
  t = await makeTestApp({ staffingStepMs: 3_600_000, conversationSimMs: 3_600_000 }); // no simulation steps while rows are compared
  const w = await withAdmin(t.app);
  A = w.admin; aId = w.adminId;
  const b = await w.member('Bea');
  B = b.b; bId = b.id;
  expect((await A.req('PATCH', `/users/${bId}`, { role: 'admin' })).status).toBe(200);
  M = (await w.member('Mia')).b;
  await seedDemo(t.app.db, 't-1', aId); // a demo mission with instances (running missions must keep their managers)
});
afterAll(async () => { await t.close(); });

describe('permissions and creation', () => {
  it('every signed-in user can read proposals; anonymous cannot', async () => {
    const r = await M.req('GET', '/organization/proposals');
    expect(r.status).toBe(200);
    expect(r.body.proposals).toEqual([]);
    expect(r.body.activeRevision).toBe(1);
    expect((await t.app.inject({ method: 'GET', url: '/api/v1/organization/proposals' })).statusCode).toBe(401);
  });

  it('a member posting is 403, and so is a member deciding', async () => {
    expect((await propose(M, 'coder-01', 'ops-01')).status).toBe(403);
    expect((await M.req('POST', '/organization/proposals/x/decision', { decision: 'approve', sha: 'x' })).status).toBe(403);
    expect(await count('select count(*)::int n from org_proposals')).toBe(0);
  });

  it('POST needs an Idempotency-Key', async () => {
    const g = await graph();
    const r = await A.req('POST', '/organization/proposals', { title: 'x', why: '', baseRevision: g.revision.seq, edges: g.edges });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('?dryRun=1 returns the server dry run and stores nothing', async () => {
    const g = await graph();
    const audits = await count('select count(*)::int n from audit_events');
    const r = await A.req('POST', '/organization/proposals?dryRun=1', { title: 'Dry', why: '', baseRevision: g.revision.seq, edges: moved(g.edges, 'coder-01', 'ops-01') });
    expect(r.status).toBe(200);
    expect(r.body.result.ok).toBe(true);
    expect(r.body.result.added).toEqual([{ supervisorId: 'ops-01', subordinateId: 'coder-01', edgeType: 'reports_to' }]);
    expect(r.body.result.removed).toEqual([{ supervisorId: 'gm', subordinateId: 'coder-01', edgeType: 'reports_to' }]);
    expect(await count('select count(*)::int n from org_proposals')).toBe(0);
    expect(await count('select count(*)::int n from audit_events')).toBe(audits);
    expect((await M.req('POST', '/organization/proposals?dryRun=1', { title: 'Dry', why: '', baseRevision: g.revision.seq, edges: g.edges })).status).toBe(403);
  });

  it('a stale base revision at creation is 409 ORG_CHANGED (the dialog was opened on an older chart)', async () => {
    const g = await graph();
    const r = await A.req('POST', '/organization/proposals', { title: 'Old', why: '', baseRevision: g.revision.seq - 1, edges: g.edges }, key());
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('ORG_CHANGED');
  });
});

describe('approve → a new revision', () => {
  let p: { id: string; sha: string; baseRevision: number; edges: Edge[] };
  it('admin A creates a proposal: stored with its dry run, audited, announced', async () => {
    const r = await propose(A, 'coder-01', 'ops-01');
    expect(r.status).toBe(201);
    p = r.body.proposal;
    expect(r.body.proposal).toMatchObject({ status: 'pending', baseRevision: 1, createdBy: aId, createdByName: 'Luca', appliedRevision: null });
    expect(r.body.proposal.sha).toMatch(/^[0-9a-f]{64}$/);
    expect(r.body.proposal.result.ok).toBe(true);
    expect(new Date(r.body.proposal.expiresAt).getTime() - new Date(r.body.proposal.createdAt).getTime()).toBe(7 * 24 * 3600 * 1000);
    expect(await count(`select count(*)::int n from audit_events where action='org.proposal.create' and subject=$1 and result='ok'`, [p.id])).toBe(1);
    const ev = await rows(`select * from events where type='org.proposalCreated' and subject_id=$1`, [p.id]);
    expect(ev.length).toBe(1);
    expect(ev[0].subject_kind).toBe('org');
    expect(ev[0].audience).toBe('all');
  });

  it('the same payload again (another key) is 409 DUPLICATE_PROPOSAL', async () => {
    const r = await propose(A, 'coder-01', 'ops-01');
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('DUPLICATE_PROPOSAL');
    expect(await count(`select count(*)::int n from org_proposals where status='pending'`)).toBe(1);
  });

  it('A approving their own proposal is 403 SELF_APPROVAL (audited as denied); so is rejecting it', async () => {
    const r = await decide(A, p, 'approve');
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('SELF_APPROVAL');
    expect((await decide(A, p, 'reject')).body.code).toBe('SELF_APPROVAL');
    expect(await count(`select count(*)::int n from audit_events where action='org.proposal.decide' and subject=$1 and result='denied'`, [p.id])).toBe(2);
    expect((await rows('select status from org_proposals where id=$1', [p.id]))[0].status).toBe('pending');
  });

  it('a tampered sha is 409 PROPOSAL_CHANGED', async () => {
    const r = await decide(B, { ...p, sha: 'f'.repeat(64) }, 'approve');
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('PROPOSAL_CHANGED');
  });

  it('admin B approves: a new revision with exactly the proposed edges; instances keep their managers', async () => {
    const before = await rows(`select id, manager_instance_id from agent_instances order by id`);
    expect(before.filter((x) => x.manager_instance_id !== null).length).toBeGreaterThan(0); // non-vacuous
    const r = await decide(B, p, 'approve', { note: 'Agreed.' });
    expect(r.status).toBe(200);
    expect(r.body.proposal).toMatchObject({ status: 'applied', appliedRevision: 2, decidedBy: bId, decidedByName: 'Bea', decisionNote: 'Agreed.' });
    const g = await graph();
    expect(g.revision.seq).toBe(2);
    expect(norm(g.edges)).toEqual(norm(p.edges));
    expect(g.edges.find((e) => e.subordinateId === 'coder-01')!.supervisorId).toBe('ops-01');
    expect((await A.req('GET', '/agents/coder-01')).body.agent.managerId).toBe('ops-01');
    const ids = new Set(before.map((x) => x.id));
    expect((await rows(`select id, manager_instance_id from agent_instances order by id`)).filter((x) => ids.has(x.id))).toEqual(before);
    expect(await count(`select count(*)::int n from audit_events where action='org.proposal.decide' and subject=$1 and result='ok'`, [p.id])).toBe(1);
    const types = (await rows(`select type, subject_kind from events where type in ('org.proposalDecided','org.revisionApplied') order by id`));
    expect(types).toEqual([{ type: 'org.proposalDecided', subject_kind: 'org' }, { type: 'org.revisionApplied', subject_kind: 'org' }]);
  });

  it('deciding it again is 409 PROPOSAL_NOT_PENDING; nothing is applied twice', async () => {
    const r = await decide(B, p, 'approve');
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('PROPOSAL_NOT_PENDING');
    expect(await count('select count(*)::int n from org_revisions')).toBe(2);
  });
});

describe('base and payload checks', () => {
  it('stale base: P1 and P2 on the same base; approving P1 makes P2 409 ORG_CHANGED', async () => {
    const p1 = (await propose(A, 'tester-01', 'coder-01')).body.proposal;
    const p2 = (await propose(A, 'writer-01', 'ops-01')).body.proposal;
    expect(p1.baseRevision).toBe(p2.baseRevision);
    expect((await decide(B, p1, 'approve')).status).toBe(200);
    const r = await decide(B, p2, 'approve');
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('ORG_CHANGED');
    expect((await rows('select status from org_proposals where id=$1', [p2.id]))[0].status).toBe('pending');
    expect((await decide(B, p2, 'reject', { note: 'Stale.' })).body.proposal.status).toBe('rejected'); // a stale one can still be rejected
  });

  it('a stored proposal whose content no longer matches its sha is 409 PROPOSAL_CHANGED', async () => {
    const p = (await propose(A, 'writer-01', 'ops-01', 'Tamper target')).body.proposal;
    await t.pool.query(`update org_proposals set edges = edges - 0 where id=$1`, [p.id]); // drop one line behind the API's back
    const r = await decide(B, p, 'approve');
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('PROPOSAL_CHANGED');
    await A.req('POST', `/organization/proposals/${p.id}/withdraw`);
  });

  it('an invalid proposal is stored with its errors but approval is 422 ORG_INVALID', async () => {
    const g = await graph();
    const cyc = g.edges.filter((e) => e.subordinateId !== 'ops-01').concat({ supervisorId: 'coder-01', subordinateId: 'ops-01' }); // ops-01 → coder-01 → ops-01
    const r = await A.req('POST', '/organization/proposals', { title: 'Loop', why: '', baseRevision: g.revision.seq, edges: cyc }, key());
    expect(r.status).toBe(201);
    expect(r.body.proposal.result.ok).toBe(false);
    expect(r.body.proposal.result.errors.map((e: { code: string }) => e.code)).toContain('CYCLE');
    const revs = await count('select count(*)::int n from org_revisions');
    const d = await decide(B, r.body.proposal, 'approve');
    expect(d.status).toBe(422);
    expect(d.body.code).toBe('ORG_INVALID');
    expect(await count('select count(*)::int n from org_revisions')).toBe(revs);
  });
});

describe('lifecycle', () => {
  it('expired: deciding is 409 PROPOSAL_EXPIRED and the status shows expired', async () => {
    const p = (await propose(A, 'designer-01', 'ops-01')).body.proposal;
    await t.pool.query(`update org_proposals set expires_at = now() - interval '1 minute' where id=$1`, [p.id]);
    const r = await decide(B, p, 'approve');
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('PROPOSAL_EXPIRED');
    // the expiry was committed by the refused decision itself (before any read)
    expect((await rows('select status from org_proposals where id=$1', [p.id]))[0].status).toBe('expired');
    expect(await count(`select count(*)::int n from audit_events where action='org.proposal.expire' and subject=$1`, [p.id])).toBe(1);
    expect(await count(`select count(*)::int n from audit_events where action='org.proposal.decide' and subject=$1 and result='denied'`, [p.id])).toBe(1);
    const list = (await M.req('GET', '/organization/proposals')).body.proposals;
    expect(list.find((x: { id: string }) => x.id === p.id).status).toBe('expired');
  });

  it('expiry also happens on read', async () => {
    const p = (await propose(A, 'designer-01', 'writer-01')).body.proposal;
    await t.pool.query(`update org_proposals set expires_at = now() - interval '1 minute' where id=$1`, [p.id]);
    const list = (await M.req('GET', '/organization/proposals')).body.proposals;
    expect(list.find((x: { id: string }) => x.id === p.id).status).toBe('expired');
    expect(await count(`select count(*)::int n from audit_events where action='org.proposal.expire' and subject=$1`, [p.id])).toBe(1);
  });

  it('withdraw works only for the author, and only while pending', async () => {
    const p = (await propose(A, 'designer-01', 'coder-01')).body.proposal;
    const other = await B.req('POST', `/organization/proposals/${p.id}/withdraw`);
    expect(other.status).toBe(403);
    expect((await M.req('POST', `/organization/proposals/${p.id}/withdraw`)).status).toBe(403);
    const r = await A.req('POST', `/organization/proposals/${p.id}/withdraw`);
    expect(r.status).toBe(200);
    expect(r.body.proposal.status).toBe('withdrawn');
    expect((await A.req('POST', `/organization/proposals/${p.id}/withdraw`)).body.code).toBe('PROPOSAL_NOT_PENDING');
    expect(await count(`select count(*)::int n from audit_events where action='org.proposal.withdraw' and subject=$1 and result='ok'`, [p.id])).toBe(1);
    expect(await count(`select count(*)::int n from audit_events where action='org.proposal.withdraw' and subject=$1 and result='denied'`, [p.id])).toBe(2); // B, then A on a withdrawn one
  });
});

describe('fix round: the chart stays one tree under the GM, on every writer', () => {
  it('createOrgRevision (the apply path) refuses an invalid chart with 422 ORG_INVALID', async () => {
    const g = await graph();
    const revs = await count('select count(*)::int n from org_revisions');
    await expect(tx(t.app.db, (c) => createOrgRevision(c, { tenantId: 't-1', edges: g.edges.filter((e) => e.subordinateId !== 'tester-01'), note: 'x', createdBy: 'u' })))
      .rejects.toMatchObject({ code: 'ORG_INVALID', status: 422 });
    await expect(tx(t.app.db, (c) => createOrgRevision(c, { tenantId: 't-1', edges: [...g.edges, { supervisorId: 'ops-01', subordinateId: 'gm' }], note: 'x', createdBy: 'u' })))
      .rejects.toMatchObject({ status: 422 });
    expect(await count('select count(*)::int n from org_revisions')).toBe(revs);
  });

  it('a retired manager is a dry-run error, and approving it is 422', async () => {
    await t.pool.query(`update agent_definitions set status='retired' where id='security-01'`);
    try {
      const p = (await propose(A, 'designer-01', 'security-01', 'Under a retired manager')).body.proposal;
      expect(p.result.ok).toBe(false);
      expect(p.result.errors.map((e: { code: string }) => e.code)).toContain('RETIRED_MANAGER');
      const d = await decide(B, p, 'approve');
      expect(d.status).toBe(422);
      expect(d.body.code).toBe('ORG_INVALID');
      await A.req('POST', `/organization/proposals/${p.id}/withdraw`);
    } finally { await t.pool.query(`update agent_definitions set status='active' where id='security-01'`); }
  });

  it('POST /agents waiting on the org lock builds on a revision committed meanwhile (no silent undo)', async () => {
    const X = await t.pool.connect();
    await X.query('begin');
    await X.query(`select pg_advisory_xact_lock(hashtext('org-rev:t-1'))`);
    const created = A.req('POST', '/agents', { id: 'race-01', name: 'Race-01', role: 'racer', dept: 'Operations', duty: 'Race regression check', model: 'claude-sonnet-5-5' }, key());
    // POST /agents is blocked on the org lock (old code: after it already read the org; new code: before)
    const waiting = async () => (await rows(`select count(*)::int n from pg_locks where locktype='advisory' and not granted and objsubid=1 and objid=((hashtext('org-rev:t-1')::bigint) & 4294967295)::oid`))[0].n > 0;
    expect(await until(waiting)).toBe(true);
    // a revision that moves writer-01 under ops-01 commits meanwhile, from a transaction that starts after POST's
    const Y = await t.pool.connect();
    let moved: { id: string; seq: number };
    try {
      await Y.query('begin');
      const cur = (await Y.query(`select id, seq from org_revisions where tenant_id='t-1' order by seq desc limit 1`)).rows[0];
      moved = (await Y.query(`insert into org_revisions(tenant_id, seq, note, created_by) values ('t-1',$1,'moved meanwhile','test') returning id, seq`, [cur.seq + 1])).rows[0];
      await Y.query(`insert into org_edges(revision_id, supervisor_id, subordinate_id, edge_type)
                     select $1, case when subordinate_id='writer-01' then 'ops-01' else supervisor_id end, subordinate_id, edge_type from org_edges where revision_id=$2`, [moved.id, cur.id]);
      await Y.query('commit');
    } finally { Y.release(); }
    await X.query('commit');
    X.release();
    const r = await created;
    expect(r.status).toBe(201);
    const g = await graph();
    expect(g.revision.seq).toBe(moved!.seq + 1);
    expect(g.edges.find((e) => e.subordinateId === 'writer-01')!.supervisorId).toBe('ops-01'); // the line moved meanwhile is kept
    expect(g.edges.find((e) => e.subordinateId === 'race-01')!.supervisorId).toBe('gm');
    // every revision writer announces it: the Proposals list refreshes (stale chip) on this too
    expect(await count(`select count(*)::int n from events where type='org.revisionApplied' and subject_id=$1 and subject_kind='org'`, [String(g.revision.seq)])).toBe(1);
  });
});

describe('integrity', () => {
  it('org_edges and org_revisions stay append-only', async () => {
    await expect(t.pool.query(`update org_edges set edge_type='x'`)).rejects.toThrow(/org_edges is append-only/);
    await expect(t.pool.query(`delete from org_edges`)).rejects.toThrow(/org_edges is append-only/);
    await expect(t.pool.query(`update org_revisions set note='x'`)).rejects.toThrow(/org_revisions is append-only/);
  });
});

describe('migration 0013', () => {
  it('down to 0012 and up again on a populated schema (seeded agents, a demo mission, proposals)', async () => {
    const counts = async () => ({
      agents: await count('select count(*)::int n from agent_definitions'),
      revisions: await count('select count(*)::int n from org_revisions'),
      edges: await count('select count(*)::int n from org_edges'),
      instances: await count('select count(*)::int n from agent_instances'),
      missions: await count('select count(*)::int n from missions'),
    });
    const before = await counts();
    expect(before.instances).toBeGreaterThan(0);
    expect(await count('select count(*)::int n from org_proposals')).toBeGreaterThan(0);
    const has = async () => (await rows(`select 1 from information_schema.tables where table_schema=$1 and table_name='org_proposals'`, [t.schema])).length === 1;
    expect(await migrate(t.pool, 'down', 12)).toBe(12);
    expect(await has()).toBe(false);
    expect(await counts()).toEqual(before);
    expect(await migrate(t.pool, 'up')).toBe(Math.max(...listMigrations().map((m) => m.version))); // the latest migration (0015 and later lanes come back up too)
    expect(await has()).toBe(true);
    expect(await counts()).toEqual(before);
    expect((await M.req('GET', '/organization/proposals')).body.proposals).toEqual([]);
  });
});
