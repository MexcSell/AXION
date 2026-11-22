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
    expect(typeof rel.why).toBe('string');
    expect(r.body.kinds.find((k: any) => k.kind === 'autonomous_gate_change')).toMatchObject({ tier: 'R4', prohibited: 'any' });
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
