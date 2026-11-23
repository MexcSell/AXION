import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeTestApp, withAdmin, type TestApp } from './helpers.ts';
import { requestApproval, consumeApproval, loadBoundAction, evidenceDigestOf } from '../src/approvals/service.ts';
import { verifyChain } from '../src/audit.ts';
import { tx } from '../src/db.ts';
import { seedDemo, clearDemo } from '../src/seed/demo.ts';

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
async function dropRequestRow(id: string) {
  const c = await t.pool.connect();
  try { await c.query('alter table audit_events disable trigger user'); try { await c.query(`delete from audit_events where action='approval.request' and subject=$1`, [id]); } finally { await c.query('alter table audit_events enable trigger user'); } } finally { c.release(); }
}
const flipFlag = (id: string) => tamperRow(`update approval_requests set rule_of_two = jsonb_set(rule_of_two, '{flags,untrustedInput}', 'true'::jsonb) where id=$1`, [id]);
const decideAudit = async (id: string) => (await t.pool.query(`select detail from audit_events where action='approval.decide' and subject=$1`, [id])).rows[0]?.detail;

describe('c75 item 1: the Rule-of-Two evidence is bound to the request and re-verified', () => {
  it('a new request stores an evidence digest next to the flags', async () => {
    const r = await ask();
    const row = (await t.pool.query('select rule_of_two from approval_requests where id=$1', [r.id])).rows[0];
    expect(row.rule_of_two.evidenceDigest).toMatch(/^[0-9a-f]{64}$/);
  });
  it('a tampered flag row makes DECIDE refuse with APPROVAL_EVIDENCE_MISMATCH, and the request stays pending', async () => {
    const r = await ask();
    await flipFlag(r.id);
    const res = await decide(A.admin, r.id);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('APPROVAL_EVIDENCE_MISMATCH');
    expect((await t.pool.query('select state from approval_requests where id=$1', [r.id])).rows[0].state).toBe('pending');
  });
  it('a tampered fired rule is caught the same way', async () => {
    const r = await ask();
    await tamperRow(`update approval_requests set rule_of_two = jsonb_set(rule_of_two, '{fired}', 'true'::jsonb) where id=$1`, [r.id]);
    expect((await decide(A.admin, r.id)).body.code).toBe('APPROVAL_EVIDENCE_MISMATCH');
  });
  it('a flag tampered AFTER the decision makes CONSUME refuse with APPROVAL_EVIDENCE_MISMATCH, and it is not spent', async () => {
    const r = await ask();
    expect((await decide(A.admin, r.id)).status).toBe(200);
    await flipFlag(r.id);
    await expect(consume(r.id)).rejects.toMatchObject({ code: 'APPROVAL_EVIDENCE_MISMATCH', status: 409 });
    expect((await t.pool.query('select consumed_at from approval_requests where id=$1', [r.id])).rows[0].consumed_at).toBeNull();
  });
  it('an untouched request still decides and consumes', async () => {
    const r = await ask();
    expect((await decide(A.admin, r.id)).status).toBe(200);
    await expect(consume(r.id)).resolves.toMatchObject({ approvalId: r.id });
  });
  it('OLD requests (made before this change: no digest, or no record at all) still decide and consume', async () => {
    const a = await ask(), b = await ask();
    await tamperRow(`update approval_requests set rule_of_two = rule_of_two - 'evidenceDigest' where id=$1`, [a.id]);
    await tamperRow(`update approval_requests set rule_of_two = null where id=$1`, [b.id]);
    await dropRequestRow(a.id); await dropRequestRow(b.id); // a genuine pre-c75 request has no chained request row either
    for (const id of [a.id, b.id]) {
      expect((await decide(A.admin, id)).status).toBe(200);
      await expect(consume(id)).resolves.toMatchObject({ approvalId: id });
    }
  });
  it('the evidence digest is not shown in the DTO (the shape is unchanged)', async () => {
    const r = await ask();
    const dto = (await A.admin.req('GET', '/approvals')).body.approvals.find((x: any) => x.id === r.id);
    expect(Object.keys(dto.ruleOfTwo).sort()).toEqual(['because', 'fired', 'flags', 'policyVersion', 'rule']);
  });
});


describe('c75 fix round: the request-time anchor in the audit chain', () => {
  it('the request writes a chained approval.request row naming the evidence digest', async () => {
    const r = await ask();
    const row = (await t.pool.query(`select detail from audit_events where action='approval.request' and subject=$1`, [r.id])).rows[0];
    const rec = (await t.pool.query('select rule_of_two from approval_requests where id=$1', [r.id])).rows[0].rule_of_two;
    expect(row.detail).toMatchObject({ mission: mid, kind: 'submit_form', fired: false, rule: null, evidenceDigest: rec.evidenceDigest });
    expect((await verifyChain(t.pool, 't-1')).ok).toBe(true);
  });
  it('stripping the digest from a PENDING post-c75 request makes DECIDE refuse (it is not mistaken for an old request)', async () => {
    const r = await ask();
    await tamperRow(`update approval_requests set rule_of_two = rule_of_two - 'evidenceDigest' where id=$1`, [r.id]);
    const res = await decide(A.admin, r.id);
    expect(res.status).toBe(409); expect(res.body.code).toBe('APPROVAL_EVIDENCE_MISMATCH');
    expect((await t.pool.query('select state from approval_requests where id=$1', [r.id])).rows[0].state).toBe('pending');
  });
  it('rewriting the flags AND their digest together on a pending request is caught against the chained original', async () => {
    const r = await ask();
    const row = (await t.pool.query('select id, action_digest, rule_of_two from approval_requests where id=$1', [r.id])).rows[0];
    const { evidenceDigest: _old, ...rest } = row.rule_of_two;
    const forged = { ...rest, flags: { ...rest.flags, untrustedInput: !rest.flags.untrustedInput } };
    const rewritten = { ...forged, evidenceDigest: evidenceDigestOf(row.id, row.action_digest, forged) };
    await tamperRow('update approval_requests set rule_of_two = $2::jsonb where id=$1', [r.id, JSON.stringify(rewritten)]);
    const res = await decide(A.admin, r.id);
    expect(res.status).toBe(409); expect(res.body.code).toBe('APPROVAL_EVIDENCE_MISMATCH');
  });
  it('the same rewrite after the decision is refused at consume', async () => {
    const r = await ask();
    expect((await decide(A.admin, r.id)).status).toBe(200);
    const row = (await t.pool.query('select id, action_digest, rule_of_two from approval_requests where id=$1', [r.id])).rows[0];
    const { evidenceDigest: _o, ...rest } = row.rule_of_two;
    const forged = { ...rest, fired: true, rule: 'rule_of_two' };
    await tamperRow('update approval_requests set rule_of_two = $2::jsonb where id=$1', [r.id, JSON.stringify({ ...forged, evidenceDigest: evidenceDigestOf(row.id, row.action_digest, forged as any) })]);
    await expect(consume(r.id)).rejects.toMatchObject({ code: 'APPROVAL_EVIDENCE_MISMATCH' });
  });
});

describe('c75 review fixes', () => {
  it('F1: demo seed, clear, re-seed (same approval ids, new request rows) still decides and consumes', async () => {
    await seedDemo(t.app.db, 't-1', A.adminId);
    await clearDemo(t.app.db, 't-1');
    await seedDemo(t.app.db, 't-1', A.adminId);
    const pending = (await A.admin.req('GET', '/approvals')).body.approvals.find((x: any) => x.demo && x.state === 'pending' && x.canDecide);
    expect(pending, 'a decidable demo approval exists').toBeTruthy();
    const two = (await t.pool.query(`select count(*)::int as n from audit_events where action='approval.request' and subject=$1`, [pending.id])).rows[0].n;
    expect(two).toBeGreaterThanOrEqual(2); // the old row from the first seed is still in the chain
    const res = await decide(A.admin, pending.id);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    await expect(consume(pending.id)).resolves.toMatchObject({ approvalId: pending.id });
  });
  it('F1: with two request rows for one id, a digest stripped from the current row is still refused', async () => {
    await seedDemo(t.app.db, 't-1', A.adminId);
    await clearDemo(t.app.db, 't-1');
    await seedDemo(t.app.db, 't-1', A.adminId);
    const p = (await A.admin.req('GET', '/approvals')).body.approvals.find((x: any) => x.demo && x.state === 'pending' && x.canDecide);
    await tamperRow(`update approval_requests set rule_of_two = rule_of_two - 'evidenceDigest' where id=$1`, [p.id]);
    expect((await decide(A.admin, p.id)).body.code).toBe('APPROVAL_EVIDENCE_MISMATCH');
  });
  it('F3: deleting a non-last approval.request audit row is caught by verifyChain', async () => {
    const a = await ask(); await ask(); await ask();
    expect((await verifyChain(t.pool, 't-1')).ok).toBe(true);
    await dropRequestRow(a.id);
    const v = await verifyChain(t.pool, 't-1');
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/is missing/);
  });
});
