import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeTestApp, withAdmin, type TestApp } from './helpers.ts';
import { requestApproval, approvalDto } from '../src/approvals/service.ts';
import { tx } from '../src/db.ts';

let t: TestApp;
let A: Awaited<ReturnType<typeof withAdmin>>;
beforeEach(async () => { t = await makeTestApp({ staffingStepMs: 60_000 }); A = await withAdmin(t.app); });
afterEach(async () => { await t.close(); });

let n = 0;
const KINDS = { R2: 'submit_form', R3: 'release', R4: 'production_deploy' } as const;
const ask = (missionId: string, kind: string, extra: Record<string, unknown> = {}) => tx(t.app.db, (c) => requestApproval(c, { tenantId: 't-1', missionId, agentId: 'release-01', kind, title: 'T', detail: 'd', payload: { x: 1 }, expiresInMin: 60, ...extra } as any));

// the flag is computed by the same function the decision route uses, so for every combination it must equal "the route does not refuse"
describe('canDecide equals the decision route outcome (tier x role x requester x state)', () => {
  const combos: [string, 'admin' | 'member', 'agent' | 'self', 'pending' | 'decided'][] = [];
  for (const tier of ['R2', 'R3', 'R4']) for (const role of ['admin', 'member'] as const) for (const req of ['agent', 'self'] as const) for (const st of ['pending', 'decided'] as const) combos.push([tier, role, req, st]);
  it.each(combos)('%s %s requester=%s state=%s', async (tier, role, req, st) => {
    const mina = await A.member('Mina');
    const mid = (await mina.b.req('POST', '/missions', { text: 'Send it.', files: [], shared: false }, { 'idempotency-key': 'k' + Date.now() + n++ })).body.mission.id as string;
    const who = role === 'admin' ? A.admin : mina.b;
    const whoId = role === 'admin' ? A.adminId : mina.id;
    const r = await ask(mid, KINDS[tier as keyof typeof KINDS], req === 'self' ? { requestedBy: whoId } : {});
    if (st === 'decided') await t.pool.query(`update approval_requests set state='approved' where id=$1`, [r.id]);
    const dto = (await who.req('GET', '/approvals')).body.approvals.find((x: any) => x.id === r.id);
    expect(typeof dto.canDecide).toBe('boolean');
    const res = await who.req('POST', `/approvals/${r.id}/decision`, { decision: 'approved', digest: dto.digest, reason: 'ok' }, { 'idempotency-key': 'd' + Date.now() + n++ });
    const refused = res.status >= 400;
    expect(dto.canDecide, `${res.status} ${res.body.code}`).toBe(!refused);
    // the reason names the same refusal the route gave
    const expected = dto.canDecide ? null : ({ POLICY_DENIED: 'tier_requires_admin', SELF_APPROVAL: 'requester_cannot_decide', APPROVAL_ALREADY_DECIDED: 'already_decided' } as Record<string, string>)[res.body.code];
    expect(dto.decideBlockedReason).toBe(expected);
  });

  it('the decision response carries the flag too (false once decided)', async () => {
    const mid = (await A.admin.req('POST', '/missions', { text: 'Send it.', files: [], shared: false }, { 'idempotency-key': 'z' + Date.now() })).body.mission.id as string;
    const r = await ask(mid, 'release');
    const dto = (await A.admin.req('GET', '/approvals')).body.approvals.find((x: any) => x.id === r.id);
    expect(dto).toMatchObject({ canDecide: true, decideBlockedReason: null });
    const res = await A.admin.req('POST', `/approvals/${r.id}/decision`, { decision: 'approved', digest: dto.digest }, { 'idempotency-key': 'q' + Date.now() });
    expect(res.body.approval).toMatchObject({ canDecide: false, decideBlockedReason: 'already_decided' });
  });

  it('an expired pending request reports reason expired, and the route does not decide it', async () => {
    const mid = (await A.admin.req('POST', '/missions', { text: 'Send it.', files: [], shared: false }, { 'idempotency-key': 'e' + Date.now() })).body.mission.id as string;
    const r = await ask(mid, 'submit_form');
    const row = (await t.pool.query('select * from approval_requests where id=$1', [r.id])).rows[0];
    const later = new Date(row.expires_at).getTime() + 1000;
    expect(approvalDto(row, later, { id: A.adminId, role: 'admin' })).toMatchObject({ canDecide: false, decideBlockedReason: 'expired' });
    expect(approvalDto(row, Date.now(), { id: A.adminId, role: 'admin' })).toMatchObject({ canDecide: true });
  });

  it('through the route: a request already past its expiry is refused as expired, and the flag said the same', async () => {
    const mid = (await A.admin.req('POST', '/missions', { text: 'Send it.', files: [], shared: false }, { 'idempotency-key': 'x' + Date.now() })).body.mission.id as string;
    const r = await ask(mid, 'submit_form', { expiresInMin: -5 }); // inserted already past its expiry (the bound expiry cannot be edited afterwards)
    const row = (await t.pool.query('select *, (expires_at < now()) as db_expired from approval_requests where id=$1', [r.id])).rows[0];
    expect(row.db_expired).toBe(true);
    const dto = approvalDto(row, Date.now(), { id: A.adminId, role: 'admin' });
    expect(dto).toMatchObject({ canDecide: false, decideBlockedReason: 'expired' });
    const res = await A.admin.req('POST', `/approvals/${r.id}/decision`, { decision: 'approved', digest: row.action_digest, reason: 'ok' }, { 'idempotency-key': 'y' + Date.now() });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('APPROVAL_STALE');
    expect((await t.pool.query('select state from approval_requests where id=$1', [r.id])).rows[0].state).toBe('expired');
    expect((await t.pool.query('select count(*)::int n from approval_decisions')).rows[0].n).toBe(0);
  });

  it('expiry is the database clock: a row the database says is expired is expired whatever the JS clock says', () => {
    const row = { id: 'A', risk: 'R2', state: 'pending', requested_by: null, expires_at: new Date(Date.now() + 3_600_000).toISOString(), db_expired: true };
    expect(approvalDto(row, Date.now(), { id: 'u', role: 'admin' })).toMatchObject({ canDecide: false, decideBlockedReason: 'expired', state: 'expired' });
    expect(approvalDto({ ...row, db_expired: false, expires_at: new Date(Date.now() - 1000).toISOString() }, Date.now(), { id: 'u', role: 'admin' })).toMatchObject({ canDecide: true });
  });
});
