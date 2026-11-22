import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeTestApp, withAdmin, type TestApp } from './helpers.ts';
import { requestApproval, consumeApproval, loadBoundAction } from '../src/approvals/service.ts';
import { tx } from '../src/db.ts';
import { BULK_TIERS } from '../src/approvals/quality.ts';
import { Browser } from './helpers.ts';

let t: TestApp;
let A: Awaited<ReturnType<typeof withAdmin>>;
let mid: string;
beforeEach(async () => { t = await makeTestApp({ staffingStepMs: 60_000 }); A = await withAdmin(t.app); mid = (await A.admin.req('POST', '/missions', { text: 'Send it.', files: [], shared: true }, { 'idempotency-key': 'q' + Date.now() })).body.mission.id as string; });
afterEach(async () => { await t.close(); });

let n = 0;
const key = () => ({ 'idempotency-key': 'c58q-' + Date.now() + '-' + n++ });
const ask = (kind = 'submit_form', extra: Record<string, unknown> = {}) => tx(t.app.db, (c) => requestApproval(c, { tenantId: 't-1', missionId: mid, agentId: 'release-01', kind, title: 'T' + n++, detail: 'd', payload: { x: n }, expiresInMin: 60, ...extra } as any));
const decide = async (who: { req: Function }, id: string, decision: 'approved' | 'denied' = 'approved') => {
  const dto = (await who.req('GET', '/approvals')).body.approvals.find((x: any) => x.id === id);
  return who.req('POST', `/approvals/${id}/decision`, { decision, digest: dto.digest, reason: 'ok' }, key());
};
const rec = async (id: string) => (await t.pool.query('select * from approval_decisions where approval_id=$1', [id])).rows[0];
/** A decision row from an approver in the past or by another user, inserted directly (append-only allows inserts) so the statistics have material. */
const seed = async (approvalId: string, by: string, decision: 'approved' | 'denied', latencyMs: number, queue = 1, fast = false, daysAgo = 0) =>
  t.pool.query(`insert into approval_decisions(approval_id, decision, reason, digest, decided_by, decided_at, latency_ms, queue_size, fast_bulk) values ($1,$2,'','d',$3, now() - ($4 || ' days')::interval, $5,$6,$7)`, [approvalId, decision, by, String(daysAgo), latencyMs, queue, fast]);

describe('c58 item 4a: decision records (latency from the database clock, queue size, advisory fast-bulk flag)', () => {
  it('records the latency against the request row and the pending queue size at decision time', async () => {
    const old = await ask('submit_form', { createdAgoMin: 5 });
    await ask(); await ask(); // two more pending: the queue holds three
    const r = await decide(A.admin, old.id);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const d = await rec(old.id);
    expect(Number(d.latency_ms)).toBeGreaterThanOrEqual(5 * 60_000 - 1000);
    expect(Number(d.latency_ms)).toBeLessThan(5 * 60_000 + 60_000);
    expect(d.queue_size).toBe(3);
  });
  it('latency is computed in SQL from the row, not from a clock the client or the app supplies', async () => {
    const a = await ask('submit_form', { createdAgoMin: 120 });
    await decide(A.admin, a.id);
    const d = await rec(a.id);
    const sqlLatency = (await t.pool.query(`select (extract(epoch from (d.decided_at - r.created_at)) * 1000)::bigint as ms from approval_decisions d join approval_requests r on r.id=d.approval_id where r.id=$1`, [a.id])).rows[0].ms;
    expect(Math.abs(Number(d.latency_ms) - Number(sqlLatency))).toBeLessThan(2000); // same database clock (now() is the transaction start)
  });
  it('a body field cannot supply latency, queue or the flag', async () => {
    const a = await ask();
    const dto = (await A.admin.req('GET', '/approvals')).body.approvals.find((x: any) => x.id === a.id);
    const r = await A.admin.req('POST', `/approvals/${a.id}/decision`, { decision: 'approved', digest: dto.digest, latencyMs: 1, queueSize: 99, fastBulk: false }, key());
    expect(r.status).toBe(200); // unknown body fields are dropped by the schema (it names only decision, digest and reason) and never read
    const d = await rec(a.id);
    expect(d.queue_size).toBe(1); expect(d.queue_size).not.toBe(99);
    expect(d.latency_ms === null || Number(d.latency_ms) !== 1).toBe(true);
  });
  it('the third R2+ decision by one approver inside a minute is flagged; the first two are not', async () => {
    const ids = [(await ask()).id, (await ask()).id, (await ask()).id, (await ask()).id];
    for (const id of ids) expect((await decide(A.admin, id)).status).toBe(200);
    expect((await Promise.all(ids.map(rec))).map((d) => d.fast_bulk)).toEqual([false, false, true, true]);
  });
  it('NO FLAG CHANGES ANY DECISION: a flagged decision is recorded as decided, the approval can be consumed, and a denial stays a denial', async () => {
    const ids = [(await ask()).id, (await ask()).id, (await ask()).id, (await ask()).id];
    const out = [] as string[];
    for (const [i, id] of ids.entries()) { const r = await decide(A.admin, id, i === 3 ? 'denied' : 'approved'); expect(r.status).toBe(200); out.push(r.body.approval.state); }
    expect(out).toEqual(['approved', 'approved', 'approved', 'denied']);
    expect((await rec(ids[3])).fast_bulk).toBe(true);
    const row = (await t.pool.query('select state from approval_requests where id=$1', [ids[2]])).rows[0];
    expect(row.state).toBe('approved'); // the flagged third decision stands
    await tx(t.app.db, async (c) => consumeApproval(c, { approvalId: ids[2], action: await loadBoundAction(c, 't-1', ids[2]), by: 'release-01' })); // and the approval still spends
  });
  it('R3 requests count as R2 or above, and the tiers the flag looks at are the existing table from R2 up', async () => {
    expect(BULK_TIERS).toEqual(['R2', 'R3', 'R4']);
    const ids = [(await ask('release')).id, (await ask('release')).id, (await ask('release')).id];
    for (const id of ids) await decide(A.admin, id);
    expect((await rec(ids[2])).fast_bulk).toBe(true);
  });
  it('decisions made earlier than a minute ago are not bulk (the window is judged by the database clock)', async () => {
    const [old1, old2, b] = [(await ask()).id, (await ask()).id, (await ask()).id];
    await seed(old1, A.adminId, 'approved', 1000, 1, false, 0.0069); // about 10 minutes ago, in days
    await seed(old2, A.adminId, 'approved', 1000, 1, false, 0.0062); // about 9 minutes ago
    expect((await decide(A.admin, b)).status).toBe(200);
    expect((await rec(b)).fast_bulk).toBe(false);
  });
});

describe('c58 item 4b: the statistics (n and window; below 5, "not enough evidence"; admins see approvers, everyone else aggregates)', () => {
  it('below 5 decisions: not enough evidence, no numbers; at 5: numbers', async () => {
    const ids = [] as string[];
    for (let i = 0; i < 4; i++) ids.push((await ask()).id);
    for (const id of ids) await seed(id, A.adminId, 'approved', 10_000);
    let q = (await A.admin.req('GET', '/approvals/quality')).body.quality;
    expect(q).toMatchObject({ n: 4, enough: false, approvalRate: null, medianLatencyMs: null, fastBulk: null, minEvidence: 5, windowDays: 30 });
    expect(typeof q.windowStart).toBe('string');
    await seed((await ask()).id, A.adminId, 'denied', 30_000);
    q = (await A.admin.req('GET', '/approvals/quality')).body.quality;
    expect(q).toMatchObject({ n: 5, enough: true, approvalRate: 0.8, medianLatencyMs: 10_000, fastBulk: 0 });
  });
  it('the window is applied by the database clock: older decisions drop out', async () => {
    for (let i = 0; i < 5; i++) await seed((await ask()).id, A.adminId, 'approved', 1000, 1, false, 40);
    expect((await A.admin.req('GET', '/approvals/quality?windowDays=30')).body.quality).toMatchObject({ n: 0, enough: false });
    expect((await A.admin.req('GET', '/approvals/quality?windowDays=90')).body.quality).toMatchObject({ n: 5, enough: true, windowDays: 90 });
    expect((await A.admin.req('GET', '/approvals/quality?windowDays=0')).status).toBe(400);
    expect((await A.admin.req('GET', '/approvals/quality?windowDays=abc')).status).toBe(400);
  });
  it('decisions without a recorded latency (made before this feature) are not counted', async () => {
    for (let i = 0; i < 6; i++) await t.pool.query(`insert into approval_decisions(approval_id, decision, reason, digest, decided_by) values ($1,'approved','','d',$2)`, [(await ask()).id, A.adminId]);
    expect((await A.admin.req('GET', '/approvals/quality')).body.quality).toMatchObject({ n: 0, enough: false });
  });
  it('administrators get a per-approver table with n, window and "not enough evidence" per person', async () => {
    const mina = await A.member('Mina');
    for (let i = 0; i < 5; i++) await seed((await ask()).id, A.adminId, i < 4 ? 'approved' : 'denied', 8000 + i * 1000);
    for (let i = 0; i < 2; i++) await seed((await ask()).id, mina.id, 'approved', 2000);
    const r = await A.admin.req('GET', '/approvals/quality/approvers');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ windowDays: 30, minEvidence: 5 });
    const by = Object.fromEntries(r.body.approvers.map((x: any) => [x.name, x]));
    expect(by.Luca).toMatchObject({ userId: A.adminId, n: 5, enough: true, approvalRate: 0.8, medianLatencyMs: 10_000 });
    expect(by.Mina).toMatchObject({ n: 2, enough: false, approvalRate: null, medianLatencyMs: null });
  });
  it('a member sees aggregates only: the per-approver route is refused and the aggregate names nobody', async () => {
    const mina = await A.member('Mina');
    for (let i = 0; i < 5; i++) await seed((await ask()).id, A.adminId, 'approved', 8000);
    const refused = await mina.b.req('GET', '/approvals/quality/approvers');
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe('FORBIDDEN');
    expect(JSON.stringify(refused.body)).not.toContain('Luca');
    const agg = await mina.b.req('GET', '/approvals/quality');
    expect(agg.status).toBe(200);
    expect(agg.body.quality).toMatchObject({ n: 5, enough: true });
    const text = JSON.stringify(agg.body);
    expect(text).not.toContain('Luca'); expect(text).not.toContain(A.adminId); expect(agg.body.approvers).toBeUndefined(); expect(agg.body.quality.approvers).toBeUndefined();
  });
  it('signed out: refused', async () => {
    expect((await new Browser(t.app).req('GET', '/approvals/quality')).status).toBe(401);
    expect((await new Browser(t.app).req('GET', '/approvals/quality/approvers')).status).toBe(401);
  });
  it('the decision record on a decided approval is shown to administrators only', async () => {
    const mina = await A.member('Mina');
    const a = await ask();
    expect((await decide(A.admin, a.id)).status).toBe(200);
    const adm = (await A.admin.req('GET', '/approvals')).body.approvals.find((x: any) => x.id === a.id);
    expect(adm.decisionRecord).toMatchObject({ fastBulk: false, queueSize: 1 });
    expect(typeof adm.decisionRecord.latencyMs).toBe('number');
    const mem = (await mina.b.req('GET', '/approvals')).body.approvals.find((x: any) => x.id === a.id);
    expect(mem.decisionRecord).toBeNull();
  });
  it('the decision rows stay append-only', async () => {
    const a = await ask(); await decide(A.admin, a.id);
    await expect(t.pool.query(`update approval_decisions set latency_ms=0 where approval_id=$1`, [a.id])).rejects.toThrow(/append-only/);
    await expect(t.pool.query(`delete from approval_decisions where approval_id=$1`, [a.id])).rejects.toThrow(/append-only/);
  });
});
