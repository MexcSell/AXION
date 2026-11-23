import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeTestApp, withAdmin, type TestApp } from './helpers.ts';
import { requestApproval, consumeApproval, loadBoundAction, digestV2, digestOf, type BoundAction } from '../src/approvals/service.ts';
import { tx, makePool } from '../src/db.ts';
import { lockWaits, MAX_TEST_CONNECTIONS } from './pool-probe.ts';
import { TEST_DB } from './helpers.ts';

let t: TestApp;
let A: Awaited<ReturnType<typeof withAdmin>>;
beforeEach(async () => { t = await makeTestApp({ staffingStepMs: 60_000 }); A = await withAdmin(t.app); });
afterEach(async () => { await t.close(); });

let n = 0;
const mission = async () => (await A.admin.req('POST', '/missions', { text: 'Publish the homepage preview.', files: [], shared: false }, { 'idempotency-key': 'b' + Date.now() + n++ })).body.mission.id as string;
const minaMission = async (b: any) => (await b.req('POST', '/missions', { text: 'Send it.', files: [], shared: false }, { 'idempotency-key': 'm' + Date.now() + n++ })).body.mission.id as string;
const ask = (missionId: string, kind = 'release', extra: Record<string, unknown> = {}) => tx(t.app.db, (c) => requestApproval(c, { tenantId: 't-1', missionId, agentId: 'release-01', kind, title: 'T', detail: 'd', payload: { x: 1 }, expiresInMin: 60, ...extra } as any));
const decide = async (id: string, decision: 'approved' | 'denied' = 'approved', who = A.admin) => {
  const a = (await who.req('GET', '/approvals')).body.approvals.find((x: any) => x.id === id);
  return who.req('POST', `/approvals/${id}/decision`, { decision, digest: a.digest, reason: 'ok' }, { 'idempotency-key': 'd' + Date.now() + n++ });
};
const action = (id: string) => tx(t.app.db, (c) => loadBoundAction(c, 't-1', id));
const consume = (id: string, a: BoundAction, extra: Record<string, unknown> = {}) => tx(t.app.db, (c) => consumeApproval(c, { approvalId: id, action: a, by: 'executor-1', ...extra }));
const row = async (id: string) => (await t.pool.query('select * from approval_requests where id=$1', [id])).rows[0];

describe('digest v2', () => {
  const base: BoundAction = { tenantId: 't-1', missionId: 'M-1', taskId: 'T-1', kind: 'release', origin: 'https://a.example', target: 'site', payload: { x: 1, y: [1, 2] }, tier: 'R3', requestedBy: 'release-01', expiresAt: '2026-01-01T00:00:00.000Z' };
  it('is stable under key order and covers every bound field', () => {
    expect(digestV2({ ...base, payload: { y: [1, 2], x: 1 } })).toBe(digestV2(base));
    const changed: Partial<BoundAction>[] = [{ tenantId: 't-2' }, { missionId: 'M-2' }, { taskId: 'T-2' }, { taskId: undefined }, { kind: 'update_live_site' }, { origin: 'https://b.example' }, { origin: undefined }, { target: 'other' }, { target: undefined }, { payload: { x: 2, y: [1, 2] } }, { payload: { x: 1, y: [1, 2], z: 0 } }, { tier: 'R4' }, { requestedBy: 'someone' }, { expiresAt: '2026-01-01T00:00:00.001Z' }];
    const seen = new Set([digestV2(base)]);
    for (const c of changed) { const d = digestV2({ ...base, ...c }); expect(seen.has(d), JSON.stringify(c)).toBe(false); seen.add(d); }
  });
  it('is never the v1 digest', () => { expect(digestV2(base)).not.toBe(digestOf('M-1', 'release', base.payload)); });
  it('a new request stores v2, with its origin, target, task and requester, and the server recomputes it', async () => {
    const m = await mission();
    const r = await ask(m, 'release', { origin: 'https://a.example', target: 'site', taskId: 'T-9' });
    const rw = await row(r.id);
    expect(rw).toMatchObject({ digest_version: 2, origin: 'https://a.example', target: 'site', task_id: 'T-9', requested_by: 'release-01' });
    expect(rw.action_digest).toBe(digestV2(await action(r.id)));
    const dto = (await A.admin.req('GET', '/approvals')).body.approvals.find((x: any) => x.id === r.id);
    expect(dto).toMatchObject({ riskTier: 'R3', origin: 'https://a.example', target: 'site', effect: 'infra', approver: 'admin', digestVersion: 2, consumed: false });
    expect(typeof dto.effectWhy).toBe('string');
  });
});

describe('consume', () => {
  it('consumes an approved request once, records who and when, and emits approval.consumed', async () => {
    const m = await mission();
    const r = await ask(m);
    expect((await decide(r.id)).status).toBe(200);
    const out = await consume(r.id, await action(r.id));
    expect(out.approvalId).toBe(r.id);
    const rw = await row(r.id);
    expect(rw.consumed_by).toBe('executor-1');
    expect(rw.consumed_at).toBeTruthy();
    const ev = (await t.pool.query(`select payload from events where type='approval.consumed'`)).rows;
    expect(ev).toHaveLength(1);
    expect(ev[0].payload).toMatchObject({ approvalId: r.id, by: 'executor-1' });
    const dto = (await A.admin.req('GET', '/approvals')).body.approvals.find((x: any) => x.id === r.id);
    expect(dto.consumed).toBe(true);
  });
  it('a replay is refused with 409 APPROVAL_ALREADY_CONSUMED and changes nothing', async () => {
    const m = await mission();
    const r = await ask(m);
    await decide(r.id);
    const a = await action(r.id);
    await consume(r.id, a);
    const before = await row(r.id);
    await expect(consume(r.id, a)).rejects.toMatchObject({ code: 'APPROVAL_ALREADY_CONSUMED', status: 409 });
    expect((await row(r.id)).consumed_at).toEqual(before.consumed_at);
  });
  it('is refused when any one field of the presented action differs, and the approval stays usable', async () => {
    const m = await mission();
    const r = await ask(m, 'release', { origin: 'https://a.example', target: 'site', taskId: 'T-1', payload: { x: 1, k: 'v' } });
    await decide(r.id);
    const a = await action(r.id);
    const tampered: [string, Partial<BoundAction>][] = [
      ['payload value', { payload: { x: 2, k: 'v' } }], ['payload key added', { payload: { x: 1, k: 'v', extra: true } }], ['payload key removed', { payload: { x: 1 } }],
      ['origin', { origin: 'https://evil.example' }], ['origin removed', { origin: undefined }], ['target', { target: 'prod' }], ['target removed', { target: undefined }], ['kind', { kind: 'production_deploy' }],
      ['tier', { tier: 'R2' }], ['task', { taskId: 'T-2' }], ['task removed', { taskId: undefined }], ['mission', { missionId: 'M-999' }], ['requester', { requestedBy: 'mallory' }], ['expiry', { expiresAt: new Date(Date.now() + 9e9).toISOString() }],
    ];
    for (const [name, patch] of tampered) {
      await expect(consume(r.id, { ...a, ...patch }), name).rejects.toMatchObject({ code: 'APPROVAL_DIGEST_MISMATCH', status: 409 });
    }
    expect((await row(r.id)).consumed_at).toBeNull();
    await consume(r.id, a); // the real action still works
  });
  it('a presented tenant that is not the row tenant finds nothing', async () => {
    const m = await mission();
    const r = await ask(m);
    await decide(r.id);
    await expect(consume(r.id, { ...(await action(r.id)), tenantId: 't-other' })).rejects.toMatchObject({ status: 404 });
  });
  it('is refused after expiry', async () => {
    const m = await mission();
    const r = await ask(m);
    await decide(r.id);
    const a = await action(r.id);
    await expect(consume(r.id, a, { now: new Date(a.expiresAt).getTime() + 1 })).rejects.toMatchObject({ code: 'APPROVAL_EXPIRED', status: 409 });
    expect((await row(r.id)).consumed_at).toBeNull();
  });
  it('is refused for a pending and for a denied request', async () => {
    const m = await mission();
    const p = await ask(m, 'release', { payload: { x: 1 } });
    await expect(consume(p.id, await action(p.id))).rejects.toMatchObject({ code: 'APPROVAL_NOT_APPROVED', status: 409 });
    const d = await ask(m, 'release', { payload: { x: 2 } });
    await decide(d.id, 'denied');
    await expect(consume(d.id, await action(d.id))).rejects.toMatchObject({ code: 'APPROVAL_NOT_APPROVED', status: 409 });
    expect((await row(d.id)).consumed_at).toBeNull();
  });
  it('an unknown approval is 404', async () => {
    await expect(consume('APR-nope', { tenantId: 't-1', missionId: 'M-1', kind: 'release', payload: {}, tier: 'R3', requestedBy: 'x', expiresAt: new Date().toISOString() })).rejects.toMatchObject({ status: 404 });
  });
  it('20 concurrent consumes: exactly one succeeds, 19 are refused as already consumed', async () => {
    const m = await mission();
    const r = await ask(m);
    await decide(r.id);
    const a = await action(r.id);
    const appName = 'c70-consume-' + t.schema;
    const pool = makePool(`${TEST_DB()}?application_name=${appName}`, t.schema, MAX_TEST_CONNECTIONS);
    const waits = lockWaits(t.pool, appName);
    let res: PromiseSettledResult<unknown>[];
    try { res = await Promise.allSettled(Array.from({ length: 20 }, (_, i) => tx(pool, (c) => consumeApproval(c, { approvalId: r.id, action: a, by: 'exec-' + i })))); }
    finally { await waits.stop(); await pool.end(); }
    // c70 (H14): 20 logical consumers, but the test's own pool is bounded, and they really queued on the one row
    // (no `peakClients <= 8` assertion: max: 8 guarantees it. What proves the race is that consumers of THIS pool really blocked on the row lock.)
    expect(waits.stats.maxWaiting, 'consumers blocked on the approval row lock at one moment').toBeGreaterThanOrEqual(1);
    const ok = res.filter((x) => x.status === 'fulfilled');
    const bad = res.filter((x): x is PromiseRejectedResult => x.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(bad).toHaveLength(19);
    for (const b of bad) expect(b.reason).toMatchObject({ code: 'APPROVAL_ALREADY_CONSUMED', status: 409 });
    expect((await t.pool.query(`select count(*)::int n from events where type='approval.consumed'`)).rows[0].n).toBe(1);
    expect((await row(r.id)).consumed_by).toMatch(/^exec-/);
  });
  it('has no HTTP route', async () => {
    const m = await mission();
    const r = await ask(m);
    await decide(r.id);
    for (const [method, url] of [['POST', `/approvals/${r.id}/consume`], ['POST', `/approvals/${r.id}/execute`], ['PATCH', `/approvals/${r.id}`]] as const) {
      expect((await A.admin.req(method, url, {})).status, url).toBe(404);
    }
    expect((await row(r.id)).consumed_at).toBeNull();
  });
});

describe('who may decide', () => {
  it('the requester cannot decide their own R2+ request (403 SELF_APPROVAL), and nothing changes', async () => {
    const m = await mission();
    const r = await ask(m, 'release', { requestedBy: A.adminId });
    const res = await decide(r.id);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('SELF_APPROVAL');
    expect((await row(r.id)).state).toBe('pending');
    expect((await t.pool.query('select count(*)::int n from approval_decisions')).rows[0].n).toBe(0);
  });
  it('an R2 request by a member cannot be approved by that member but can by an admin', async () => {
    const mina = await A.member('Mina');
    const m = await minaMission(mina.b);
    const r = await ask(m, 'submit_form', { requestedBy: mina.id });
    const self = await decide(r.id, 'approved', mina.b);
    expect(self.status).toBe(403);
    expect(self.body.code).toBe('SELF_APPROVAL');
    expect((await decide(r.id)).status).toBe(200);
  });
  it('an agent requester does not block any human', async () => {
    const m = await mission();
    const r = await ask(m);
    expect((await decide(r.id)).status).toBe(200);
  });
  it('a member still gets 403 on R3 (policy) with its own message', async () => {
    const mina = await A.member('Mina');
    const m = await minaMission(mina.b);
    const r = await ask(m);
    const res = await decide(r.id, 'approved', mina.b);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('POLICY_DENIED');
  });
});

describe('edit invalidates', () => {
  it('the database refuses to change the bound action of a pending or approved request', async () => {
    const m = await mission();
    const r = await ask(m);
    for (const sql of [`payload='{"x":2}'::jsonb`, `kind='production_deploy'`, `risk='R0'`, `origin='https://evil'`, `target='prod'`, `task_id='T-2'`, `requested_by='me'`, `expires_at=expires_at + interval '1 day'`, `action_digest='abc'`, `digest_version=1`, `mission_id='M-1'`, `agent_id='other'`, `tenant_id='t-2'`, `id='APR-x'`]) {
      await expect(t.pool.query(`update approval_requests set ${sql} where id=$1`, [r.id]), sql).rejects.toThrow(/immutable/);
    }
    await decide(r.id);
    await expect(t.pool.query(`update approval_requests set payload='{"x":3}'::jsonb where id=$1`, [r.id])).rejects.toThrow(/immutable/);
    await expect(t.pool.query(`update approval_requests set state='denied' where id=$1`, [r.id])).rejects.toThrow(/cannot change state/);
  });
  it('consumed_at can only be set once, only when approved, and never changed', async () => {
    const m = await mission();
    const p = await ask(m, 'release', { payload: { x: 5 } });
    await expect(t.pool.query(`update approval_requests set consumed_at=now(), consumed_by='x' where id=$1`, [p.id])).rejects.toThrow();
    const r = await ask(m);
    await decide(r.id);
    await expect(t.pool.query(`update approval_requests set consumed_at=now() where id=$1`, [r.id])).rejects.toThrow(); // consumed_by missing
    await t.pool.query(`update approval_requests set consumed_at=now(), consumed_by='x' where id=$1`, [r.id]);
    await expect(t.pool.query(`update approval_requests set consumed_at=now(), consumed_by='y' where id=$1`, [r.id])).rejects.toThrow(/already consumed/);
    await expect(t.pool.query(`update approval_requests set consumed_at=null, consumed_by=null where id=$1`, [r.id])).rejects.toThrow(/already consumed/);
  });
});

describe('v1 rows', () => {
  const v1 = async (missionId: string, id: string, payload = { fixture: 'F' }) => {
    // a legacy row, made the way it was before 0029: the insert guard is lifted for this one statement
    // t.pool is bound to this test's own scratch schema (makeSchema), so the table is private to this test
    await t.pool.query('alter table approval_requests disable trigger approval_requests_insert_guard');
    try {
      await t.pool.query(
        `insert into approval_requests(id, tenant_id, mission_id, agent_id, kind, title, detail, risk, payload, action_digest, expires_at) values ($1,'t-1',$2,'release-01','release','Old','d','R3',$3,$4, now() + interval '1 hour')`,
        [id, missionId, JSON.stringify(payload), digestOf(missionId, 'release', payload)]);
    } finally {
      await t.pool.query('alter table approval_requests enable trigger approval_requests_insert_guard');
    }
  };
  it('still display, decide with the v1 digest, and consume with the v1 digest', async () => {
    const m = await mission();
    await v1(m, 'APR-old1');
    const dto = (await A.admin.req('GET', '/approvals')).body.approvals.find((x: any) => x.id === 'APR-old1');
    expect(dto).toMatchObject({ digestVersion: 1, riskTier: 'R3', status: 'pending', consumed: false, requestedBy: null });
    expect((await decide('APR-old1')).status).toBe(200);
    const a = await action('APR-old1');
    await expect(consume('APR-old1', { ...a, payload: { fixture: 'other' } })).rejects.toMatchObject({ code: 'APPROVAL_DIGEST_MISMATCH' });
    await consume('APR-old1', a);
    await expect(consume('APR-old1', a)).rejects.toMatchObject({ code: 'APPROVAL_ALREADY_CONSUMED' });
  });
  it('a v1 request with no requester can be decided by anyone allowed to (no self-approval check without a requester)', async () => {
    const m = await mission();
    await v1(m, 'APR-old2');
    expect((await decide('APR-old2', 'denied')).status).toBe(200);
  });
});

describe('the client digest is never trusted', () => {
  it('a decision carrying a different digest is refused as stale and decides nothing', async () => {
    const m = await mission();
    const r = await ask(m);
    const bad = await A.admin.req('POST', `/approvals/${r.id}/decision`, { decision: 'approved', digest: digestV2({ ...(await action(r.id)), payload: { x: 99 } }), reason: '' }, { 'idempotency-key': 'd' + Date.now() + n++ });
    expect(bad.status).toBe(409);
    expect(bad.body.code).toBe('APPROVAL_STALE');
    expect((await row(r.id)).state).toBe('pending');
  });
});

describe('payloads and fields that JSON cannot carry', () => {
  it('undefined, Date and NaN values in a payload: the request can still be decided and consumed', async () => {
    const m = await mission();
    const r = await ask(m, 'release', { payload: { a: undefined, when: new Date('2026-01-01T00:00:00Z'), n: NaN, nested: { u: undefined, d: [1, undefined] } } });
    expect((await decide(r.id)).status).toBe(200);
    const a = await action(r.id);
    expect(a.payload).toEqual({ when: '2026-01-01T00:00:00.000Z', n: null, nested: { d: [1, null] } });
    await consume(r.id, a);
  });
  it("empty-string origin, target and task are the same as absent: still decidable and consumable", async () => {
    const m = await mission();
    const r = await ask(m, 'release', { origin: '', target: '', taskId: '' });
    expect((await row(r.id))).toMatchObject({ origin: null, target: null, task_id: null });
    expect((await decide(r.id)).status).toBe(200);
    await consume(r.id, await action(r.id));
  });
});

describe('expiry uses the database clock', () => {
  it('an approved row whose expires_at is already past now() in the database is refused without any test clock', async () => {
    const m = await mission();
    const exp = new Date(Date.now() - 5000);
    const a: BoundAction = { tenantId: 't-1', missionId: m, kind: 'release', payload: { x: 1 }, tier: 'R3', requestedBy: 'release-01', expiresAt: exp.toISOString() };
    await t.pool.query(
      `insert into approval_requests(id, tenant_id, mission_id, agent_id, kind, title, risk, payload, action_digest, digest_version, requested_by, state, expires_at) values ('APR-past','t-1',$1,'release-01','release','T','R3','{"x":1}',$2,2,'release-01','approved',$3)`, [m, digestV2(a), exp]);
    await expect(consume('APR-past', a)).rejects.toMatchObject({ code: 'APPROVAL_EXPIRED' });
  });
});

describe('0029 guards', () => {
  it('an expired request is terminal', async () => {
    const m = await mission();
    const r = await ask(m, 'release', { expiresInMin: -1 });
    await tx(t.app.db, (c) => c.query(`update approval_requests set state='expired' where id=$1`, [r.id]));
    await expect(t.pool.query(`update approval_requests set state='pending' where id=$1`, [r.id])).rejects.toThrow(/cannot change state/);
    await expect(t.pool.query(`update approval_requests set state='approved' where id=$1`, [r.id])).rejects.toThrow(/cannot change state/);
  });
  it('a new row must be v2', async () => {
    const m = await mission();
    await expect(t.pool.query(
      `insert into approval_requests(id, tenant_id, mission_id, agent_id, kind, title, risk, payload, action_digest, digest_version, expires_at) values ('APR-v1new','t-1',$1,'a','release','T','R3','{}','x',1, now()+interval '1 hour')`, [m])).rejects.toThrow(/v2/);
    await expect(t.pool.query(
      `insert into approval_requests(id, tenant_id, mission_id, agent_id, kind, title, risk, payload, action_digest, expires_at) values ('APR-v1def','t-1',$1,'a','release','T','R3','{}','x', now()+interval '1 hour')`, [m])).rejects.toThrow(/v2/);
  });
  it('DELETE and TRUNCATE are refused, except inside the demo purge', async () => {
    const m = await mission();
    const r = await ask(m);
    await expect(t.pool.query(`delete from approval_requests where id=$1`, [r.id])).rejects.toThrow(/append-only|cannot be deleted/);
    await expect(t.pool.query(`truncate approval_requests cascade`)).rejects.toThrow(/append-only|cannot be deleted/);
    expect((await row(r.id))).toBeTruthy();
  });
  it('the demo purge still removes demo missions with their approvals', async () => {
    const m = await mission();
    await t.pool.query(`update missions set demo=true where id=$1`, [m]);
    const r = await ask(m, 'release', { demo: true });
    await decide(r.id);
    const { clearDemo } = await import('../src/seed/demo.ts');
    await clearDemo(t.app.db, 't-1');
    expect(await row(r.id)).toBeUndefined();
  });
});
