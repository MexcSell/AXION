import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeTestApp, withAdmin, type TestApp } from './helpers.ts';
import { requestApproval, consumeApproval, loadBoundAction } from '../src/approvals/service.ts';
import { verifyChain } from '../src/audit.ts';
import { tx } from '../src/db.ts';

let t: TestApp;
let A: Awaited<ReturnType<typeof withAdmin>>;
let mid: string;
beforeEach(async () => { t = await makeTestApp({ staffingStepMs: 60_000 }); A = await withAdmin(t.app); mid = (await A.admin.req('POST', '/missions', { text: 'Send it.', files: [], shared: true }, { 'idempotency-key': 'e75' + Date.now() })).body.mission.id as string; });
afterEach(async () => { await t.close(); });

let n = 0;
const key = () => ({ 'idempotency-key': 'c75-' + Date.now() + '-' + n++ });
const ask = (extra: Record<string, unknown> = {}) => tx(t.app.db, (c) => requestApproval(c, { tenantId: 't-1', missionId: mid, agentId: 'release-01', kind: 'submit_form', title: 'T' + n++, detail: 'd', payload: { x: n }, expiresInMin: 60, ...extra } as any));
const decide = async (who: { req: Function }, id: string) => {
  const dto = (await who.req('GET', '/approvals')).body.approvals.find((x: any) => x.id === id);
  return who.req('POST', `/approvals/${id}/decision`, { decision: 'approved', digest: dto.digest, reason: 'ok' }, key());
};
const consume = async (id: string) => tx(t.app.db, async (c) => consumeApproval(c, { approvalId: id, action: await loadBoundAction(c, 't-1', id), by: 'exec-1' }));
/** Test-DB-only tamper: the immutability trigger is switched off inside the test, as a superuser-style tamperer would. */
async function tamperRow(sql: string, params: unknown[]) {
  const c = await t.pool.connect();
  try { await c.query('alter table approval_requests disable trigger user'); try { await c.query(sql, params); } finally { await c.query('alter table approval_requests enable trigger user'); } } finally { c.release(); }
}
async function tamperAudit(sql: string, params: unknown[]) {
  const c = await t.pool.connect();
  try { await c.query('alter table audit_events disable trigger user'); try { await c.query(sql, params); } finally { await c.query('alter table audit_events enable trigger user'); } } finally { c.release(); }
}
const flipFlag = (id: string) => tamperRow(`update approval_requests set rule_of_two = jsonb_set(rule_of_two, '{flags,untrustedInput}', 'true'::jsonb) where id=$1`, [id]);
const decideAudit = async (id: string) => (await t.pool.query(`select detail from audit_events where action='approval.decide' and subject=$1`, [id])).rows[0]?.detail;

describe('c75 item 3: members gain no view of per-person latency', () => {
  it('no member route returns audit rows, and nothing a member can read carries latency, queue size or the evidence digest', async () => {
    const mina = await A.member('Mina');
    const r = await ask();
    await decide(A.admin, r.id);
    expect((await mina.b.req('GET', '/audit/verify')).status).toBe(403);
    for (const p of ['/audit', '/audit/events', '/approvals/audit']) expect((await mina.b.req('GET', p)).status, p).toBe(404);
    const list = await mina.b.req('GET', '/approvals');
    const dto = list.body.approvals.find((x: any) => x.id === r.id);
    expect(dto.decisionRecord).toBeNull();
    const text = JSON.stringify(list.body);
    expect(text).not.toMatch(/latency|queueSize|fastBulk|evidenceDigest/i);
    const admin = (await A.admin.req('GET', '/audit/verify')).body;
    expect(Object.keys(admin).sort()).toEqual(['checked', 'ok']);
  });
});
