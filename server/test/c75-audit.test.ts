import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeTestApp, withAdmin, type TestApp } from './helpers.ts';
import { requestApproval, consumeApproval, loadBoundAction } from '../src/approvals/service.ts';
import { verifyChain } from '../src/audit.ts';
import { approvalDecideAuditDetail } from './contracts/validators.ts';
import { check } from './contracts/validate.ts';
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

describe('c75 item 2: the decide audit row carries the decision evidence, inside the hash chain', () => {
  it('latency, queue size, fast-bulk flag, fired rule and the evidence digest are in the audit detail', async () => {
    const r = await ask({ createdAgoMin: 5 }); await ask(); await ask();
    expect((await decide(A.admin, r.id)).status).toBe(200);
    const d = await decideAudit(r.id);
    const rec = (await t.pool.query('select latency_ms, queue_size, fast_bulk from approval_decisions where approval_id=$1', [r.id])).rows[0];
    expect(d).toMatchObject({ decision: 'approved', mission: mid, latencyMs: Number(rec.latency_ms), queueSize: 3, fastBulk: false, fired: false, rule: null });
    expect(check('approval.decide detail', approvalDecideAuditDetail, d)).toEqual([]); // the shape is registered in the contract validators
    const row = (await t.pool.query('select rule_of_two from approval_requests where id=$1', [r.id])).rows[0];
    expect(d.evidenceDigest).toBe(row.rule_of_two.evidenceDigest);
  });
  it('stripping the digest after a decision (a downgrade to "old request") is caught by the audit row', async () => {
    const r = await ask();
    expect((await decide(A.admin, r.id)).status).toBe(200);
    await tamperRow(`update approval_requests set rule_of_two = rule_of_two - 'evidenceDigest' where id=$1`, [r.id]);
    await expect(consume(r.id)).rejects.toMatchObject({ code: 'APPROVAL_EVIDENCE_MISMATCH' });
  });
  it('audit:verify stays green, and a changed evidence value is detected', async () => {
    const r = await ask();
    await decide(A.admin, r.id);
    expect(await verifyChain(t.pool, 't-1')).toMatchObject({ ok: true });
    await tamperAudit(`update audit_events set detail = jsonb_set(detail, '{latencyMs}', '1'::jsonb) where action='approval.decide' and subject=$1`, [r.id]);
    const v = await verifyChain(t.pool, 't-1');
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/does not match its hash/);
  });
  it('a decision row edited to disagree with its audit row makes CONSUME refuse', async () => {
    const r = await ask();
    await decide(A.admin, r.id);
    const c = await t.pool.connect();
    try { await c.query('alter table approval_decisions disable trigger user'); try { await c.query('update approval_decisions set latency_ms = 1 where approval_id=$1', [r.id]); } finally { await c.query('alter table approval_decisions enable trigger user'); } } finally { c.release(); }
    await expect(consume(r.id)).rejects.toMatchObject({ code: 'APPROVAL_EVIDENCE_MISMATCH' });
  });
});

