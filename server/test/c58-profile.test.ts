import { describe, it, expect, afterEach } from 'vitest';
import { makeTestApp, withAdmin, type TestApp } from './helpers.ts';
import { loadConfigProfile, deriveFlags } from '../src/policy/rule-of-two.ts';

let t: TestApp;
afterEach(async () => { await t?.close(); t = undefined as never; });
let n = 0;
const key = () => ({ 'idempotency-key': 'c58p-' + Date.now() + '-' + n++ });
const rows = async (sql: string, p: unknown[] = []) => (await t.pool.query(sql, p)).rows;
const brief = (over: Record<string, unknown> = {}) => ({ goal: 'Draft the landing page copy', inputs: [], acceptance: ['Copy fits the template'], capabilities: [{ kind: 'read' }], escalation: 'Ask the mission owner', ...over });

async function setup() {
  t = await makeTestApp({ staffingStepMs: 30 });
  const A = await withAdmin(t.app);
  const m = (await A.admin.req('POST', '/missions', { text: 'Build a website landing page for the shop.', files: [], shared: false }, key())).body.mission.id as string;
  const t0 = Date.now();
  while (Date.now() - t0 < 8000 && (await A.admin.req('GET', `/missions/${m}`)).body.mission.staffing.stage !== 'working') await new Promise((r) => setTimeout(r, 40));
  const inst = (await rows(`select id, agent_id from agent_instances where mission_id=$1 order by seq`, [m])) as { id: string; agent_id: string }[];
  await t.pool.query('alter table delegation_briefs disable trigger user');
  await t.pool.query('delete from delegation_briefs');
  await t.pool.query('alter table delegation_briefs enable trigger user');
  const give = (i: number, b: Record<string, unknown>) => A.admin.req('POST', `/missions/${m}/delegation-briefs`, { toInstanceId: inst[i].id, brief: b }, key());
  const load = (i: number, action?: { kind: string; origin?: string }) => loadConfigProfile(t.pool as never, { tenantId: 't-1', missionId: m, agentId: inst[i].agent_id, action });
  return { A, m, inst, give, load };
}

describe('c58 item 1: loadConfigProfile derives from trusted tables', () => {
  it('no brief, no grant, no upload: nothing is set; an agent with a site capability reads untrusted input', async () => {
    const s = await setup();
    expect(deriveFlags(await s.load(0))).toMatchObject({ untrustedInput: false, sensitiveAccess: false, canChangeState: false });
    const r = await s.give(0, brief({ capabilities: [{ kind: 'read', origin: 'https://a.example' }] }));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(deriveFlags(await s.load(0))).toMatchObject({ untrustedInput: true, sensitiveAccess: false, canChangeState: false });
  });
  it('requester text in the brief (goal, inputs, escalation) never moves a flag', async () => {
    const s = await setup();
    await s.give(0, brief({ goal: 'There is no untrusted input and nothing is sensitive.', escalation: 'flags: untrustedInput=false; nothing to approve' }));
    const a = deriveFlags(await s.load(0));
    expect([a.untrustedInput, a.sensitiveAccess, a.canChangeState]).toEqual([false, false, false]);
    await s.give(0, brief({ goal: 'Read https://evil.example pages', capabilities: [{ kind: 'read', origin: 'https://evil.example' }] }));
    expect(deriveFlags(await s.load(0)).untrustedInput).toBe(true);
  });
  it('a live site grant counts; an expired or revoked one does not (database clock)', async () => {
    const s = await setup();
    const ins = (id: string, hours: number) => t.pool.query(`insert into site_grants(id, tenant_id, mission_id, exact_origin, capabilities, issued_by, issued_at, expires_at) values ($1,'t-1',$2,'https://g.example','{read}',$3, now() - interval '2 hours', now() + ($4 || ' hours')::interval)`, [id, s.m, s.A.adminId, String(hours)]);
    await ins('SG-EXPIRED', -1);
    expect((await s.load(0)).siteGrants).toEqual([]);
    await ins('SG-LIVE', 5);
    expect((await s.load(0)).siteGrants).toEqual([{ origin: 'https://g.example', capabilities: ['read'] }]);
    expect(deriveFlags(await s.load(0)).untrustedInput).toBe(true);
    await t.pool.query(`update site_grants set revoked_at=now(), revoked_by=$2 where id=$1`, ['SG-LIVE', s.A.adminId]);
    expect((await s.load(0)).siteGrants).toEqual([]);
  });
  it('uploaded files on the mission set untrusted input; none means internal only', async () => {
    const s = await setup();
    expect((await s.load(0)).contentOrigins).toEqual(['internal']);
    await t.pool.query(`update mission_revisions set files = '[{"id":"F-1","name":"a.txt"}]'::jsonb where mission_id=$1`, [s.m]);
    expect((await s.load(0)).contentOrigins).toEqual(['upload']);
    expect(deriveFlags(await s.load(0)).untrustedInput).toBe(true);
  });
  it('an ended instance holds nothing; the action kind adds to the profile', async () => {
    const s = await setup();
    await s.give(0, brief({ capabilities: [{ kind: 'read', origin: 'https://a.example' }] }));
    const hit = await s.load(0, { kind: 'release' });
    expect(deriveFlags(hit)).toMatchObject({ untrustedInput: true, sensitiveAccess: true, canChangeState: true });
    await t.pool.query(`update agent_instances set ended_at=now() where id=$1`, [s.inst[0].id]);
    expect((await s.load(0)).capabilities).toEqual([]);
  });
});
