import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeTestApp, withAdmin, type TestApp } from './helpers.ts';
import { requestApproval } from '../src/approvals/service.ts';
import { tx } from '../src/db.ts';

let t: TestApp;
let A: Awaited<ReturnType<typeof withAdmin>>;
beforeEach(async () => { t = await makeTestApp({ staffingStepMs: 60_000 }); A = await withAdmin(t.app); });
afterEach(async () => { await t.close(); });

let n = 0;
const mission = async () => (await A.admin.req('POST', '/missions', { text: 'Publish the homepage preview.', files: [], shared: false }, { 'idempotency-key': 'p' + Date.now() + n++ })).body.mission.id as string;
const ask = (missionId: string, kind: string, extra: Record<string, unknown> = {}) => tx(t.app.db, (c) => requestApproval(c, { tenantId: 't-1', missionId, agentId: 'release-01', kind, title: 'T', detail: 'd', payload: { x: 1 }, expiresInMin: 60, ...extra } as any));

describe('approvals take their tier from the policy', () => {
  it('derives the tier from the kind', async () => {
    const m = await mission();
    await ask(m, 'release');
    await ask(m, 'submit_form', { payload: { x: 2 } });
    const list = (await A.admin.req('GET', '/approvals')).body.approvals;
    expect(list.find((a: any) => a.kind === 'release')).toMatchObject({ riskTier: 'R3', risk: 'high' });
    expect(list.find((a: any) => a.kind === 'submit_form')).toMatchObject({ riskTier: 'R2', risk: 'medium' });
  });
  it('a request asking for a lower tier gets the policy tier', async () => {
    const m = await mission();
    await ask(m, 'release', { risk: 'R0' });
    const a = (await A.admin.req('GET', '/approvals')).body.approvals[0];
    expect(a).toMatchObject({ kind: 'release', riskTier: 'R3', risk: 'high' });
  });
  it('a request asking for a higher tier gets the policy tier too', async () => {
    const m = await mission();
    await ask(m, 'submit_form', { risk: 'R4' });
    expect((await A.admin.req('GET', '/approvals')).body.approvals[0].riskTier).toBe('R2');
  });
  it('refuses an unknown kind and a prohibited kind, and stores nothing', async () => {
    const m = await mission();
    await expect(ask(m, 'make_coffee')).rejects.toMatchObject({ code: 'POLICY_DENIED' });
    await expect(ask(m, 'autonomous_gate_change')).rejects.toMatchObject({ code: 'POLICY_DENIED' });
    expect((await A.admin.req('GET', '/approvals')).body.approvals).toEqual([]);
  });
  it('records the policy version and reasons in the requested event', async () => {
    const m = await mission();
    const r = await ask(m, 'release');
    const ev = (await t.pool.query(`select payload from events where type='approval.requested' and payload->>'approvalId'=$1`, [r.id])).rows[0].payload;
    expect(ev).toMatchObject({ risk: 'R3', policyVersion: 1 });
    expect(ev.reasons).toContain('approval_admin');
  });
});

describe('GET /policy/baseline', () => {
  it('lists kinds with tier, approver and reasons for an admin', async () => {
    const r = await A.admin.req('GET', '/policy/baseline');
    expect(r.status).toBe(200);
    expect(r.body.version).toBe(1);
    const rel = r.body.kinds.find((k: any) => k.kind === 'release');
    expect(rel).toMatchObject({ tier: 'R3', approver: 'admin', prohibited: null });
    expect(rel.heldBy).toBeUndefined();
    expect(typeof rel.why).toBe('string');
    expect(r.body.kinds.find((k: any) => k.kind === 'autonomous_gate_change')).toMatchObject({ tier: 'R4', prohibited: 'any' });
  });
  it('says an R4 owner is held by an admin until an owner role exists', async () => {
    const k = (await A.admin.req('GET', '/policy/baseline')).body.kinds.find((x: any) => x.kind === 'production_deploy');
    expect(k).toMatchObject({ approver: 'owner', heldBy: 'admin' });
    expect(k.note).toMatch(/no separate owner role/i);
  });
  it('is closed to members', async () => {
    const m = await A.member('Mina');
    expect((await m.b.req('GET', '/policy/baseline')).status).toBe(403);
  });
  it('has no write route', async () => {
    const rows = t.app.routeTable.filter((r) => r.url.includes('/policy'));
    expect(rows.map((r) => r.method)).not.toEqual(expect.arrayContaining(['POST']));
    expect(rows.every((r) => r.method === 'GET' || r.method === 'HEAD')).toBe(true);
    expect((await A.admin.req('POST', '/policy/baseline', {})).status).toBe(404);
  });
});

describe('the decider must match the policy approver', () => {
  const decide = (b: any, a: { id: string; digest: string }, decision = 'approved') => b.req('POST', `/approvals/${a.id}/decision`, { decision, digest: a.digest }, { 'idempotency-key': 'd' + Date.now() + n++ });
  const stateOf = async (id: string) => (await t.pool.query('select state from approval_requests where id=$1', [id])).rows[0].state;
  it('R2: a signed-in member may decide', async () => {
    const mina = await A.member('Mina');
    const mid = (await mina.b.req('POST', '/missions', { text: 'Send it.', files: [], shared: false }, { 'idempotency-key': 'm' + n++ })).body.mission.id;
    const a = await ask(mid, 'submit_form');
    expect((await decide(mina.b, a)).status).toBe(200);
  });
  for (const [kind, tier] of [['release', 'R3'], ['production_deploy', 'R4']] as const) {
    it(`${tier}: a member gets 403 POLICY_DENIED and nothing changes; an admin may decide`, async () => {
      const mina = await A.member('Mina');
      const mid = (await mina.b.req('POST', '/missions', { text: 'Publish it.', files: [], shared: false }, { 'idempotency-key': 'm' + n++ })).body.mission.id;
      const a = await ask(mid, kind);
      const r = await decide(mina.b, a);
      expect(r.status).toBe(403);
      expect(r.body.code).toBe('POLICY_DENIED');
      expect(await stateOf(a.id)).toBe('pending');
      expect((await t.pool.query('select count(*)::int c from approval_decisions where approval_id=$1', [a.id])).rows[0].c).toBe(0);
      expect((await decide(A.admin, a)).status).toBe(200);
      expect(await stateOf(a.id)).toBe('approved');
    });
  }
  it('a member cannot even deny an R3 approval', async () => {
    const mina = await A.member('Mina');
    const mid = (await mina.b.req('POST', '/missions', { text: 'Publish it.', files: [], shared: false }, { 'idempotency-key': 'm' + n++ })).body.mission.id;
    const a = await ask(mid, 'release');
    expect((await decide(mina.b, a, 'denied')).status).toBe(403);
    expect(await stateOf(a.id)).toBe('pending');
  });
});

describe('seeded approvals', () => {
  it('are demo=true', async () => {
    const { seedDemo } = await import('../src/seed/demo.ts');
    await seedDemo(t.app.db, 't-1', A.adminId);
    const rows = (await t.pool.query('select demo, created_at < now() - interval \'1 minute\' as aged from approval_requests')).rows;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r: any) => r.demo === true)).toBe(true);
  });
});
