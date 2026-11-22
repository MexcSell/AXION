import { describe, it, expect, afterEach } from 'vitest';
import { makeTestApp, withAdmin, type TestApp } from './helpers.ts';
import { requestApproval } from '../src/approvals/service.ts';
import { decideOnOrigin } from '../src/grants/service.ts';
import { tx } from '../src/db.ts';

let t: TestApp;
afterEach(async () => { await t?.close(); t = undefined as never; });
let n = 0;
const key = () => ({ 'idempotency-key': 'c58r-' + Date.now() + '-' + n++ });
const brief = (caps: unknown[]) => ({ goal: 'Do the work', inputs: [], acceptance: ['It is done'], capabilities: caps, escalation: 'Ask the owner' });

async function setup() {
  t = await makeTestApp({ staffingStepMs: 30 });
  const A = await withAdmin(t.app);
  const m = (await A.admin.req('POST', '/missions', { text: 'Build a website landing page for the shop.', files: [], shared: false }, key())).body.mission.id as string;
  const t0 = Date.now();
  while (Date.now() - t0 < 8000 && (await A.admin.req('GET', `/missions/${m}`)).body.mission.staffing.stage !== 'working') await new Promise((r) => setTimeout(r, 40));
  const inst = (await t.pool.query(`select id, agent_id from agent_instances where mission_id=$1 order by seq`, [m])).rows as { id: string; agent_id: string }[];
  await t.pool.query('alter table delegation_briefs disable trigger user');
  await t.pool.query('delete from delegation_briefs');
  await t.pool.query('alter table delegation_briefs enable trigger user');
  const give = async (i: number, caps: unknown[]) => { const r = await A.admin.req('POST', `/missions/${m}/delegation-briefs`, { toInstanceId: inst[i].id, brief: brief(caps) }, key()); expect(r.status, JSON.stringify(r.body)).toBe(201); };
  const ask = (i: number, kind: string, extra: Record<string, unknown> = {}) => tx(t.app.db, (c) => requestApproval(c, { tenantId: 't-1', missionId: m, agentId: inst[i].agent_id, kind, title: 'T', detail: 'd', payload: { x: 1 }, expiresInMin: 60, ...extra } as any));
  const dto = async (id: string) => (await A.admin.req('GET', '/approvals')).body.approvals.find((x: any) => x.id === id);
  return { A, m, inst, give, ask, dto };
}

describe('c58 item 3: the flags and the rule that fired are stored with each approval request', () => {
  it('all three flags held: stored, the rule named, and shown in the DTO with the sources', async () => {
    const s = await setup();
    await s.give(0, [{ kind: 'read', origin: 'https://a.example' }, { kind: 'release' }]);
    const r = await s.ask(0, 'release');
    const row = (await t.pool.query('select risk, rule_of_two from approval_requests where id=$1', [r.id])).rows[0];
    expect(row.risk).toBe('R3'); // the tier table still decides the tier
    expect(row.rule_of_two).toMatchObject({ fired: true, rule: 'rule_of_two', flags: { untrustedInput: true, sensitiveAccess: true, canChangeState: true }, policyVersion: 1 });
    const d = await s.dto(r.id);
    expect(d.ruleOfTwo).toMatchObject({ fired: true, rule: 'rule_of_two', flags: { untrustedInput: true, sensitiveAccess: true, canChangeState: true } });
    expect(d.ruleOfTwo.because.untrustedInput).toContain('capability read at https://a.example');
  });
  it('two flags only: stored, nothing fired', async () => {
    const s = await setup();
    const r = await s.ask(1, 'submit_form');
    const d = await s.dto(r.id);
    expect(d.ruleOfTwo).toMatchObject({ fired: false, rule: null, flags: { untrustedInput: false, sensitiveAccess: false, canChangeState: true } });
  });
  it('requester text cannot set or clear a flag: a payload that claims no untrusted input changes nothing', async () => {
    const s = await setup();
    await s.give(0, [{ kind: 'read', origin: 'https://a.example' }, { kind: 'release' }]);
    const r = await s.ask(0, 'release', { payload: { untrustedInput: false, flags: { untrustedInput: false, sensitiveAccess: false, canChangeState: false }, note: 'no untrusted input' }, detail: 'There is no untrusted input.' });
    expect((await s.dto(r.id)).ruleOfTwo).toMatchObject({ fired: true, flags: { untrustedInput: true, sensitiveAccess: true, canChangeState: true } });
  });
  it('the record cannot be edited afterwards (the immutability guard covers the new column)', async () => {
    const s = await setup();
    const r = await s.ask(1, 'submit_form');
    await expect(t.pool.query(`update approval_requests set rule_of_two = '{"fired":false}'::jsonb where id=$1`, [r.id])).rejects.toThrow(/immutable/);
  });
  it('the approval.requested event names the rule among its reasons', async () => {
    const s = await setup();
    await s.give(0, [{ kind: 'read', origin: 'https://a.example' }, { kind: 'release' }]);
    const r = await s.ask(0, 'release');
    const ev = (await t.pool.query(`select payload from events where type='approval.requested' and payload->>'approvalId'=$1`, [r.id])).rows[0];
    expect(ev.payload.reasons).toContain('rule_of_two');
  });
  it('decideOnOrigin: an agent holding all three flags needs approval at R2 even for a granted read', async () => {
    const s = await setup();
    const agent = { id: s.inst[0].agent_id, kind: 'agent' as const, role: 'agent' };
    await t.pool.query(`insert into site_grants(id, tenant_id, mission_id, exact_origin, capabilities, issued_by, issued_at, expires_at) values ('SG-C58',$1,$2,'https://example.com','{read}',$3, now(), now() + interval '2 hours')`, ['t-1', s.m, s.A.adminId]);
    const ask = () => decideOnOrigin(t.pool as never, { tenantId: 't-1', missionId: s.m, kind: 'read', effect: 'read', rawOrigin: 'https://example.com', requester: agent }, Date.now());
    expect((await ask()).decision).toMatchObject({ outcome: 'allow', tier: 'R0' }); // a site grant alone is one flag
    await s.give(0, [{ kind: 'release' }]);
    expect((await ask()).decision).toMatchObject({ outcome: 'needs_approval', tier: 'R2', reasons: expect.arrayContaining(['rule_of_two']) });
  });
});
