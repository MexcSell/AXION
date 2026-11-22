import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import pg from 'pg';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { makeSchema, makeTestApp, withAdmin, TEST_DB, type TestApp } from './helpers.ts';
import { migrate } from '../src/migrate.ts';
import { clearDemo } from '../src/seed/demo.ts';
import { JOB_STATUSES, isLegalEdge, nextOnFail, nextOnReclaim, classifyRefusal, type JobStatus } from '../src/jobs/machine.ts';
import { watch, MAX_TEST_CONNECTIONS } from './pool-probe.ts';
import { enqueueJob, claimJob, heartbeatJob, completeJob, failJob, reclaimExpired, requestCancel, acknowledgeCancel, getJob, type Job } from '../src/jobs/store.ts';

const K = ['noop.test'] as const;
let s: Awaited<ReturnType<typeof makeSchema>>;
let n = 0;
beforeAll(async () => { s = await makeSchema(); });
afterAll(async () => { await s.drop(); });

/** A fresh tenant per test, so counts never depend on other tests. */
async function tenant() { const id = `tj-${++n}`; await s.pool.query(`insert into tenants(id, name) values ($1,$1)`, [id]); return id; }
const enq = (tenantId: string, key = `k${++n}`, extra: Partial<Parameters<typeof enqueueJob>[1]> = {}) => enqueueJob(s.pool, { tenantId, kind: 'noop.test', idempotencyKey: key, createdBy: 'tester', ...extra });
const claim = (tenantId: string, owner = 'w1', leaseSeconds = 60) => claimJob(s.pool, { owner, kinds: [...K], leaseSeconds, tenantId });
/** Test-only: the guard refuses to move a live lease's expiry backward, so tests age a lease with the trigger switched off for one statement. */
async function rawAge(pool: pg.Pool, where: string, params: unknown[] = []) {
  const c = await pool.connect();
  try {
    await c.query('begin'); await c.query('alter table system_jobs disable trigger system_jobs_no_edit');
    await c.query(`update system_jobs set lease_expires_at = now() - interval '1 second' where ${where}`, params);
    await c.query('alter table system_jobs enable trigger system_jobs_no_edit'); await c.query('commit');
  } catch (e) { await c.query('rollback'); throw e; } finally { c.release(); }
}
const expire = (id: string) => rawAge(s.pool, 'id=$1', [id]);
const row = async (id: string) => (await s.pool.query('select *, lease_token::int tok from system_jobs where id=$1', [id])).rows[0];
const auditCount = async (tenantId: string, action: string) => (await s.pool.query('select count(*)::int n from audit_events where tenant_id=$1 and action=$2', [tenantId, action])).rows[0].n;
const leased = async (max = 3) => { const t = await tenant(); const { job } = await enq(t, undefined, { maxAttempts: max }); const c = (await claim(t))!; return { t, id: job.id, c }; };

describe('machine (pure)', () => {
  it('terminal states have no outgoing edge, queued can only lease or cancel', () => {
    for (const f of ['succeeded', 'failed', 'canceled', 'dead'] as JobStatus[]) for (const t of JOB_STATUSES) expect(isLegalEdge(f, t)).toBe(false);
    expect(isLegalEdge('queued', 'succeeded')).toBe(false);
    expect(isLegalEdge('queued', 'leased')).toBe(true);
  });
  it('a failed attempt retries until max_attempts, then dead; cancel wins; non-retryable is final', () => {
    expect(nextOnFail({ attempt: 1, maxAttempts: 3, cancelRequested: false })).toBe('queued');
    expect(nextOnFail({ attempt: 3, maxAttempts: 3, cancelRequested: false })).toBe('dead');
    expect(nextOnFail({ attempt: 1, maxAttempts: 3, cancelRequested: true })).toBe('canceled');
    expect(nextOnFail({ attempt: 1, maxAttempts: 3, cancelRequested: false }, false)).toBe('failed');
  });
  it('an expired lease is requeued, dead-lettered after the last attempt, or canceled', () => {
    expect(nextOnReclaim({ attempt: 1, maxAttempts: 2, cancelRequested: false })).toBe('queued');
    expect(nextOnReclaim({ attempt: 2, maxAttempts: 2, cancelRequested: false })).toBe('dead');
    expect(nextOnReclaim({ attempt: 1, maxAttempts: 2, cancelRequested: true })).toBe('canceled');
  });
  it('refusal reasons', () => {
    expect(classifyRefusal(null, 1)).toBe('not_found');
    expect(classifyRefusal({ status: 'dead', leaseToken: 3, expired: false }, 3)).toBe('terminal');
    expect(classifyRefusal({ status: 'queued', leaseToken: 3, expired: false }, 3)).toBe('not_leased');
    expect(classifyRefusal({ status: 'leased', leaseToken: 4, expired: false }, 3)).toBe('stale_token');
    expect(classifyRefusal({ status: 'leased', leaseToken: 3, expired: true }, 3)).toBe('lease_expired');
  });
});

describe('migration 0035', () => {
  it('up, down and up again leave the table in place and then gone', async () => {
    const m = await makeSchema({ migrate: false });
    await migrate(m.pool, 'up');
    const has = async () => (await m.pool.query(`select to_regclass('system_jobs') r`)).rows[0].r !== null;
    expect(await has()).toBe(true);
    await migrate(m.pool, 'down', 34);
    expect(await has()).toBe(false);
    await migrate(m.pool, 'up');
    expect(await has()).toBe(true);
    await m.drop();
  });
  const raw = (cols: string, vals: unknown[]) => s.pool.query(`insert into system_jobs(tenant_id, kind, idempotency_key, created_by${cols}) values ('t-1', 'noop.test', 'raw-${++n}', 'x'${vals.map((_, i) => `, $${i + 1}`).join('')})`, vals);
  it('only the noop.test kind exists', async () => {
    await expect(s.pool.query(`insert into system_jobs(tenant_id, kind, idempotency_key, created_by) values ('t-1','shell.exec','a','x')`)).rejects.toThrow(/check/);
  });
  it('payload_ref is an opaque token of at most 512 characters, never a command line', async () => {
    await expect(raw(', payload_ref', ['rm -rf /'])).rejects.toThrow(/check/);
    await expect(raw(', payload_ref', ['a;b'])).rejects.toThrow(/check/);
    await expect(raw(', payload_ref', ['a'.repeat(513)])).rejects.toThrow(/check/);
    await raw(', payload_ref', ['mission:M-1/step#2']);
  });
  it('max_attempts must be 1..10', async () => {
    await expect(raw(', max_attempts', [0])).rejects.toThrow(/check/);
    await expect(raw(', max_attempts', [11])).rejects.toThrow(/check/);
    await raw(', max_attempts', [10]);
  });
  it("'leased' needs an owner, an expiry and a token", async () => {
    await expect(raw(", status, lease_expires_at, heartbeat_at, lease_token", ['leased', new Date(Date.now() + 1e5), new Date(), 1])).rejects.toThrow(/check|inserted queued/);
    await expect(raw(", status, lease_owner, heartbeat_at, lease_token", ['leased', 'w', new Date(), 1])).rejects.toThrow(/check|inserted queued/);
    await expect(raw(", status, lease_owner, lease_expires_at, heartbeat_at, lease_token", ['leased', 'w', new Date(Date.now() + 1e5), new Date(), 0])).rejects.toThrow(/check|inserted queued/);
  });
  it('last_error is bounded', async () => {
    const t = await tenant(); const { job } = await enq(t);
    await expect(s.pool.query('update system_jobs set last_error=$2 where id=$1', [job.id, 'e'.repeat(1001)])).rejects.toThrow(/check/);
  });
});

describe('enqueue', () => {
  it('creates a queued job with attempt 0 and token 0', async () => {
    const t = await tenant();
    const { job, created } = await enq(t, 'a', { payloadRef: 'ref:1' });
    expect(created).toBe(true);
    expect(job).toMatchObject({ status: 'queued', attempt: 0, leaseToken: 0, maxAttempts: 3, payloadRef: 'ref:1', leaseOwner: null, cancelRequested: false });
  });
  it('the same idempotency key returns one row', async () => {
    const t = await tenant();
    const a = await enq(t, 'same'); const b = await enq(t, 'same', { payloadRef: 'other' });
    expect(b.created).toBe(false);
    expect(b.job.id).toBe(a.job.id);
    expect(b.job.payloadRef).toBeNull();
    expect((await s.pool.query('select count(*)::int n from system_jobs where tenant_id=$1', [t])).rows[0].n).toBe(1);
  });
  it('parallel enqueues of one key make one row', async () => {
    const t = await tenant();
    const rs = await Promise.all(Array.from({ length: 8 }, () => enq(t, 'race')));
    expect(new Set(rs.map((r) => r.job.id)).size).toBe(1);
    expect(rs.filter((r) => r.created).length).toBe(1);
  });
  it('the same key in two tenants is two jobs', async () => {
    const a = await tenant(); const b = await tenant();
    expect((await enq(a, 'x')).job.id).not.toBe((await enq(b, 'x')).job.id);
  });
  it('writes one audit row for a new job and none for a repeat', async () => {
    const t = await tenant();
    await enq(t, 'au'); await enq(t, 'au');
    expect(await auditCount(t, 'job.enqueue')).toBe(1);
  });
  it('refuses a bad payload reference', async () => {
    const t = await tenant();
    await expect(enq(t, 'bad', { payloadRef: 'echo hi; rm -rf /' })).rejects.toThrow(/check/);
  });
});

describe('claim', () => {
  it('takes the oldest first, once each', async () => {
    const t = await tenant();
    const ids = []; for (let i = 0; i < 3; i++) ids.push((await enq(t)).job.id);
    expect((await claim(t))!.id).toBe(ids[0]);
    expect((await claim(t))!.id).toBe(ids[1]);
    expect((await claim(t))!.id).toBe(ids[2]);
    expect(await claim(t)).toBeNull();
  });
  it('sets owner, attempt 1, token 1 and an expiry in the future', async () => {
    const t = await tenant(); await enq(t);
    const j = (await claim(t, 'worker-a', 30))!;
    expect(j).toMatchObject({ status: 'leased', leaseOwner: 'worker-a', attempt: 1, leaseToken: 1 });
    const d = new Date(j.leaseExpiresAt!).getTime() - new Date(j.heartbeatAt!).getTime();
    expect(d).toBeGreaterThan(29000); expect(d).toBeLessThan(31000);
  });
  it('claims nothing when the kind list is empty or the tenant differs', async () => {
    const t = await tenant(); await enq(t);
    expect(await claimJob(s.pool, { owner: 'w', kinds: [], leaseSeconds: 5, tenantId: t })).toBeNull();
    const other = await tenant();
    expect(await claim(other)).toBeNull();
  });
  it('the token goes up on every claim and every reclaim', async () => {
    const { id } = await leased();
    expect((await row(id)).tok).toBe(1);
    await expire(id); await reclaimExpired(s.pool, { allTenants: true });
    expect((await row(id)).tok).toBe(2);
    const t = (await row(id)).tenant_id;
    const c = (await claim(t))!;
    expect(c.leaseToken).toBe(3); expect(c.attempt).toBe(2);
  });
  it('rejects a silly lease length', async () => {
    await expect(claimJob(s.pool, { owner: 'w', kinds: [...K], leaseSeconds: 0, allTenants: true })).rejects.toThrow(/leaseSeconds/);
  });
});

describe('heartbeat', () => {
  it('extends the lease for the current token', async () => {
    const { t, id, c } = await leased();
    const r = await heartbeatJob(s.pool, { tenantId: t, id, token: c.leaseToken, leaseSeconds: 600 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(new Date(r.job.leaseExpiresAt!).getTime()).toBeGreaterThan(new Date(c.leaseExpiresAt!).getTime() + 500000);
  });
  it('refuses a wrong token', async () => {
    const { t, id, c } = await leased();
    expect(await heartbeatJob(s.pool, { tenantId: t, id, token: c.leaseToken + 1, leaseSeconds: 60 })).toEqual({ ok: false, reason: 'stale_token' });
  });
  it('refuses an expired lease even before anyone reclaimed it', async () => {
    const { t, id, c } = await leased(); await expire(id);
    expect(await heartbeatJob(s.pool, { tenantId: t, id, token: c.leaseToken, leaseSeconds: 60 })).toEqual({ ok: false, reason: 'lease_expired' });
    expect((await row(id)).status).toBe('leased');
  });
  it('fencing: the old holder cannot heartbeat after a reclaim, nor after a second worker claimed', async () => {
    const { t, id, c } = await leased();
    await expire(id); await reclaimExpired(s.pool, { allTenants: true });
    expect(await heartbeatJob(s.pool, { tenantId: t, id, token: c.leaseToken, leaseSeconds: 60 })).toEqual({ ok: false, reason: 'not_leased' });
    const c2 = (await claim(t, 'w2'))!;
    expect(await heartbeatJob(s.pool, { tenantId: t, id, token: c.leaseToken, leaseSeconds: 60 })).toEqual({ ok: false, reason: 'stale_token' });
    expect((await heartbeatJob(s.pool, { tenantId: t, id, token: c2.leaseToken, leaseSeconds: 60 })).ok).toBe(true);
    expect((await row(id)).lease_owner).toBe('w2');
  });
});

describe('complete', () => {
  it('finishes a job once', async () => {
    const { t, id, c } = await leased();
    const r = await completeJob(s.pool, { tenantId: t, id, token: c.leaseToken });
    expect(r.ok && r.job).toMatchObject({ status: 'succeeded', leaseOwner: null });
    expect(await completeJob(s.pool, { tenantId: t, id, token: c.leaseToken })).toEqual({ ok: false, reason: 'terminal' });
  });
  it('fencing: a stale holder cannot complete after a reclaim and a new claim', async () => {
    const { t, id, c } = await leased();
    await expire(id); await reclaimExpired(s.pool, { allTenants: true }); await claim(t, 'w2');
    expect(await completeJob(s.pool, { tenantId: t, id, token: c.leaseToken })).toEqual({ ok: false, reason: 'stale_token' });
    expect((await row(id)).status).toBe('leased');
  });
  it('an expired holder cannot complete, even if nobody reclaimed yet', async () => {
    const { t, id, c } = await leased(); await expire(id);
    expect(await completeJob(s.pool, { tenantId: t, id, token: c.leaseToken })).toEqual({ ok: false, reason: 'lease_expired' });
  });
});

describe('fail and dead letter', () => {
  it('a failed attempt goes back to queued with the error and a bumped token', async () => {
    const { t, id, c } = await leased();
    const r = await failJob(s.pool, { tenantId: t, id, token: c.leaseToken, error: 'boom' });
    expect(r.ok && r.job).toMatchObject({ status: 'queued', lastError: 'boom', attempt: 1, leaseToken: 2 });
    expect(await failJob(s.pool, { tenantId: t, id, token: c.leaseToken, error: 'again' })).toEqual({ ok: false, reason: 'not_leased' });
  });
  it('max_attempts leads to dead, with an audit row', async () => {
    const t = await tenant(); const { job } = await enq(t, undefined, { maxAttempts: 2 });
    let c = (await claim(t))!; await failJob(s.pool, { tenantId: t, id: job.id, token: c.leaseToken, error: 'e1' });
    c = (await claim(t))!;
    const r = await failJob(s.pool, { tenantId: t, id: job.id, token: c.leaseToken, error: 'e2' });
    expect(r.ok && r.job).toMatchObject({ status: 'dead', attempt: 2, lastError: 'e2' });
    expect(await claim(t)).toBeNull();
    expect(await auditCount(t, 'job.dead')).toBe(1);
  });
  it('max_attempts of 1 dies on the first failure', async () => {
    const { t, id, c } = await leased(1);
    const r = await failJob(s.pool, { tenantId: t, id, token: c.leaseToken, error: 'x' });
    expect(r.ok && r.job.status).toBe('dead');
  });
  it('a non-retryable failure is final (failed)', async () => {
    const { t, id, c } = await leased();
    const r = await failJob(s.pool, { tenantId: t, id, token: c.leaseToken, error: 'bad input', retryable: false });
    expect(r.ok && r.job).toMatchObject({ status: 'failed', finishedAt: expect.any(String) });
  });
  it('fencing: a stale holder cannot fail a job it no longer owns', async () => {
    const { t, id, c } = await leased();
    await expire(id); await reclaimExpired(s.pool, { allTenants: true }); await claim(t, 'w2');
    expect(await failJob(s.pool, { tenantId: t, id, token: c.leaseToken, error: 'late' })).toEqual({ ok: false, reason: 'stale_token' });
    expect((await row(id)).last_error).toBeNull();
  });
  it('an expired lease cannot be failed by its holder', async () => {
    const { t, id, c } = await leased(); await expire(id);
    expect(await failJob(s.pool, { tenantId: t, id, token: c.leaseToken, error: 'late' })).toEqual({ ok: false, reason: 'lease_expired' });
  });
  it('stores at most 1000 characters of error', async () => {
    const { t, id, c } = await leased();
    const r = await failJob(s.pool, { tenantId: t, id, token: c.leaseToken, error: 'z'.repeat(5000) });
    expect(r.ok && r.job.lastError!.length).toBe(1000);
  });
});

describe('reclaimExpired', () => {
  it('requeues an expired lease and bumps the token', async () => {
    const { id } = await leased(); await expire(id);
    const r = await reclaimExpired(s.pool, { allTenants: true });
    expect(r.find((j) => j.id === id)).toMatchObject({ status: 'queued', leaseOwner: null, leaseToken: 2 });
  });
  it('dead-letters an expired lease on the last attempt, with an audit row', async () => {
    const { t, id } = await leased(1); await expire(id);
    expect((await reclaimExpired(s.pool, { tenantId: t }))[0]).toMatchObject({ status: 'dead' });
    expect(await auditCount(t, 'job.dead')).toBe(1);
  });
  it('leaves live leases alone', async () => {
    const { t, id } = await leased();
    expect(await reclaimExpired(s.pool, { tenantId: t })).toEqual([]);
    expect((await row(id)).status).toBe('leased');
  });
  it('an expired lease with a cancel request ends canceled', async () => {
    const { t, id } = await leased();
    await requestCancel(s.pool, { tenantId: t, id, actor: 'a' }); await expire(id);
    expect((await reclaimExpired(s.pool, { tenantId: t }))[0].status).toBe('canceled');
  });
  it('really waits: a short real lease expires on the database clock', async () => {
    const t = await tenant(); await enq(t);
    const c = (await claim(t, 'w', 0.3))!;
    expect((await heartbeatJob(s.pool, { tenantId: t, id: c.id, token: c.leaseToken, leaseSeconds: 0.3 })).ok).toBe(true);
    await new Promise((r) => setTimeout(r, 450));
    expect((await reclaimExpired(s.pool, { tenantId: t })).length).toBe(1);
  });
});

describe('cancel', () => {
  it('a queued job is canceled at once and can no longer be claimed', async () => {
    const t = await tenant(); const { job } = await enq(t);
    const r = await requestCancel(s.pool, { tenantId: t, id: job.id, actor: 'luca' });
    expect(r.ok && r.outcome).toBe('canceled');
    expect((await row(job.id)).status).toBe('canceled');
    expect(await claim(t)).toBeNull();
    expect(await auditCount(t, 'job.cancel')).toBe(1);
  });
  it('a leased job is only flagged; the holder sees it on its heartbeat and then acknowledges', async () => {
    const { t, id, c } = await leased();
    const r = await requestCancel(s.pool, { tenantId: t, id, actor: 'luca' });
    expect(r.ok && r.outcome).toBe('flagged');
    expect((await row(id)).status).toBe('leased');
    const hb = await heartbeatJob(s.pool, { tenantId: t, id, token: c.leaseToken, leaseSeconds: 60 });
    expect(hb.ok && hb.job.cancelRequested).toBe(true);
    const ack = await acknowledgeCancel(s.pool, { tenantId: t, id, token: c.leaseToken });
    expect(ack.ok && ack.job.status).toBe('canceled');
  });
  it('a holder cannot acknowledge a cancel nobody asked for, or with a stale token', async () => {
    const { t, id, c } = await leased();
    expect(await acknowledgeCancel(s.pool, { tenantId: t, id, token: c.leaseToken })).toEqual({ ok: false, reason: 'not_leased' });
    await requestCancel(s.pool, { tenantId: t, id, actor: 'a' });
    expect(await acknowledgeCancel(s.pool, { tenantId: t, id, token: c.leaseToken + 5 })).toEqual({ ok: false, reason: 'stale_token' });
  });
  it('a failing holder with a cancel request ends canceled, not retried', async () => {
    const { t, id, c } = await leased();
    await requestCancel(s.pool, { tenantId: t, id, actor: 'a' });
    const r = await failJob(s.pool, { tenantId: t, id, token: c.leaseToken, error: 'x' });
    expect(r.ok && r.job.status).toBe('canceled');
  });
  it('a finished or missing job cannot be canceled', async () => {
    const { t, id, c } = await leased(); await completeJob(s.pool, { tenantId: t, id, token: c.leaseToken });
    expect(await requestCancel(s.pool, { tenantId: t, id, actor: 'a' })).toEqual({ ok: false, reason: 'terminal' });
    expect(await requestCancel(s.pool, { tenantId: t, id: '00000000-0000-0000-0000-000000000000', actor: 'a' })).toEqual({ ok: false, reason: 'not_found' });
  });
});

describe('the trigger refuses illegal transitions through raw SQL', () => {
  it('a finished job never changes', async () => {
    const { t, id, c } = await leased(); await completeJob(s.pool, { tenantId: t, id, token: c.leaseToken });
    await expect(s.pool.query(`update system_jobs set status='queued', finished_at=null where id=$1`, [id])).rejects.toThrow(/finished job never changes/);
    await expect(s.pool.query(`update system_jobs set last_error='x' where id=$1`, [id])).rejects.toThrow(/finished job never changes/);
  });
  it('rows cannot be deleted or truncated', async () => {
    const { id } = await leased();
    await expect(s.pool.query('delete from system_jobs where id=$1', [id])).rejects.toThrow(/append-only/);
    await expect(s.pool.query('truncate system_jobs')).rejects.toThrow(/append-only/);
  });
  it('a demo purge may delete, and clearDemo still works with jobs present', async () => {
    const t = await tenant(); const { job } = await enq(t);
    const c = await s.pool.connect();
    try { await c.query('begin'); await c.query("set local axion.purge_demo = 'on'"); await c.query('delete from system_jobs where id=$1', [job.id]); await c.query('commit'); } finally { c.release(); }
    expect((await row(job.id))).toBeUndefined();
    await enq('t-1'); await expect(clearDemo(s.pool, 't-1')).resolves.toBeTruthy();
  });
  it('queued cannot jump to succeeded, failed, dead or leased without a proper claim', async () => {
    const t = await tenant(); const { job } = await enq(t);
    for (const st of ['succeeded', 'failed', 'dead']) await expect(s.pool.query(`update system_jobs set status=$2, finished_at=now() where id=$1`, [job.id, st])).rejects.toThrow(/illegal job transition/);
    await expect(s.pool.query(`update system_jobs set status='leased', lease_owner='x', lease_expires_at=now()+interval '1 min', heartbeat_at=now(), attempt=1, lease_token=5 where id=$1`, [job.id])).rejects.toThrow(/bumps attempt and token by one/);
    expect((await row(job.id)).status).toBe('queued');
  });
  it('a lease keeps its token, owner and attempt; counters never go down', async () => {
    const { id } = await leased();
    await expect(s.pool.query(`update system_jobs set lease_token = lease_token + 1 where id=$1`, [id])).rejects.toThrow(/keeps its owner, token and attempt/);
    await expect(s.pool.query(`update system_jobs set lease_owner='thief' where id=$1`, [id])).rejects.toThrow(/keeps its owner/);
    await expect(s.pool.query(`update system_jobs set attempt = 0 where id=$1`, [id])).rejects.toThrow(/counters only grow/);
  });
  it('releasing a lease must bump the token; an expired lease cannot succeed', async () => {
    const { id } = await leased();
    await expect(s.pool.query(`update system_jobs set status='queued', lease_owner=null, lease_expires_at=null where id=$1`, [id])).rejects.toThrow(/bumps the token/);
    await expire(id);
    await expect(s.pool.query(`update system_jobs set status='succeeded', finished_at=now(), lease_owner=null, lease_expires_at=null where id=$1`, [id])).rejects.toThrow(/lease has expired/);
  });
  it('dead needs max attempts, canceled needs a request, and the identity never changes', async () => {
    const { id } = await leased();
    await expect(s.pool.query(`update system_jobs set status='dead', lease_token=lease_token+1, finished_at=now(), lease_owner=null, lease_expires_at=null where id=$1`, [id])).rejects.toThrow(/dead needs max attempts/);
    await expect(s.pool.query(`update system_jobs set status='canceled', lease_token=lease_token+1, finished_at=now(), lease_owner=null, lease_expires_at=null where id=$1`, [id])).rejects.toThrow(/after a cancel request/);
    await expect(s.pool.query(`update system_jobs set max_attempts = 10 where id=$1`, [id])).rejects.toThrow(/identity never changes/);
    await expect(s.pool.query(`update system_jobs set tenant_id = 't-1' where id=$1`, [id])).rejects.toThrow(/identity never changes/);
    await expect(s.pool.query(`update system_jobs set cancel_requested = false where id=$1`, [id])).resolves.toBeTruthy(); // no-op
    await requestCancel(s.pool, { tenantId: (await row(id)).tenant_id, id, actor: 'a' });
    await expect(s.pool.query(`update system_jobs set cancel_requested = false where id=$1`, [id])).rejects.toThrow(/counters only grow/);
  });
  it('the trigger agrees with the pure machine for every (from, to) pair', async () => {
    const mk = async (st: JobStatus): Promise<string> => {
      const t = await tenant(); const { job } = await enq(t, undefined, { maxAttempts: 1 });
      if (st === 'queued') return job.id;
      if (st === 'canceled') { await requestCancel(s.pool, { tenantId: t, id: job.id, actor: 'a' }); return job.id; }
      const c = (await claim(t))!;
      if (st === 'leased') return job.id;
      if (st === 'succeeded') await completeJob(s.pool, { tenantId: t, id: job.id, token: c.leaseToken });
      if (st === 'failed') await failJob(s.pool, { tenantId: t, id: job.id, token: c.leaseToken, error: 'x', retryable: false });
      if (st === 'dead') await failJob(s.pool, { tenantId: t, id: job.id, token: c.leaseToken, error: 'x' });
      return job.id;
    };
    for (const from of JOB_STATUSES) for (const to of JOB_STATUSES) {
      if (from === to) continue;
      const id = await mk(from);
      expect((await row(id)).status, `setup ${from}`).toBe(from);
      // best-effort raw update that is otherwise consistent with the check constraints; only the edge itself may be refused
      const leasing = to === 'leased';
      const sql = `update system_jobs set status=$2, ${leasing ? `lease_owner='x', lease_expires_at=now()+interval '1 min', heartbeat_at=now()` : 'lease_owner=null, lease_expires_at=null'},
        finished_at = ${['succeeded', 'failed', 'canceled', 'dead'].includes(to) ? 'now()' : 'null'},
        lease_token = lease_token + ${from === 'leased' && to === 'succeeded' ? 0 : 1}, attempt = attempt + ${from === 'queued' && leasing ? 1 : 0}, cancel_requested = ${to === 'canceled'} or cancel_requested where id=$1`;
      let ok = true; try { await s.pool.query(sql, [id, to]); } catch { ok = false; }
      if (!isLegalEdge(from, to)) expect(ok, `${from} -> ${to} must be refused`).toBe(false);
    }
  });
});

describe('fix round: trigger lease edges, insert guard, cancel edge', () => {
  const lease = async () => { const x = await leased(); return x; };
  it('a leased row cannot have its expiry moved while only raw SQL is used: not forward by a day, not into the past', async () => {
    const { id } = await lease();
    await expect(s.pool.query(`update system_jobs set lease_expires_at = now() - interval '1 second' where id=$1`, [id])).rejects.toThrow(/lease/);
    // a live lease may be pushed forward (that is what a heartbeat does)
    await s.pool.query(`update system_jobs set lease_expires_at = lease_expires_at + interval '1 minute', heartbeat_at = now() where id=$1`, [id]);
  });
  it('an expired lease cannot be revived by raw SQL (only a reclaim may touch it)', async () => {
    const { id } = await lease(); await expire(id);
    await expect(s.pool.query(`update system_jobs set lease_expires_at = now() + interval '1 day', heartbeat_at = now() where id=$1`, [id])).rejects.toThrow(/lease/);
    expect((await row(id)).status).toBe('leased');
  });
  it('heartbeat time cannot go backward, and a lease change may not edit other columns', async () => {
    const { id } = await lease();
    await expect(s.pool.query(`update system_jobs set heartbeat_at = heartbeat_at - interval '1 hour' where id=$1`, [id])).rejects.toThrow(/lease/);
    await expect(s.pool.query(`update system_jobs set last_error='sneaky' where id=$1`, [id])).rejects.toThrow(/lease/);
  });
  it('a heartbeat with a shorter lease never shortens the expiry', async () => {
    const { t, id, c } = await lease();
    const r = await heartbeatJob(s.pool, { tenantId: t, id, token: c.leaseToken, leaseSeconds: 1 });
    expect(r.ok && new Date(r.job.leaseExpiresAt!).getTime()).toBeGreaterThanOrEqual(new Date(c.leaseExpiresAt!).getTime());
  });
  it('flagging a cancel on a lease that has already expired is still allowed', async () => {
    const { t, id } = await lease(); await expire(id);
    expect((await requestCancel(s.pool, { tenantId: t, id, actor: 'a' })).ok).toBe(true);
  });
  it('an unexpired lease is released to queued only with a recorded failure; an expired one by reclaim', async () => {
    const { id } = await lease();
    await expect(s.pool.query(`update system_jobs set status='queued', lease_token=lease_token+1, lease_owner=null, lease_expires_at=null where id=$1`, [id])).rejects.toThrow(/unexpired lease|illegal job transition/);
    await s.pool.query(`update system_jobs set status='queued', lease_token=lease_token+1, lease_owner=null, lease_expires_at=null, last_error='holder failed' where id=$1`, [id]);
    const b = await leased(); await expire(b.id);
    await s.pool.query(`update system_jobs set status='queued', lease_token=lease_token+1, lease_owner=null, lease_expires_at=null where id=$1`, [b.id]);
  });
  it('INSERT guard: a row can only appear queued, fresh and unleased', async () => {
    const ins = (cols: string, vals: unknown[]) => s.pool.query(`insert into system_jobs(tenant_id, kind, idempotency_key, created_by, ${cols}) values ('t-1','noop.test','ig-${++n}','x', ${vals.map((_, i) => '$' + (i + 1)).join(',')})`, vals);
    await expect(ins('status, attempt, lease_token, lease_owner, lease_expires_at, heartbeat_at', ['leased', 1, 1, 'w', new Date(Date.now() + 1e5), new Date()])).rejects.toThrow(/inserted queued/);
    await expect(ins('lease_token, attempt', [99, 2])).rejects.toThrow(/inserted queued/);
    await expect(ins('lease_token', [1])).rejects.toThrow(/inserted queued/);
    await expect(ins('cancel_requested', [true])).rejects.toThrow(/inserted queued/);
    await expect(ins('status, finished_at', ['succeeded', new Date()])).rejects.toThrow(/inserted queued/);
    await expect(ins('last_error', ['pre-failed'])).rejects.toThrow(/inserted queued/);
    await expect(ins('heartbeat_at', [new Date()])).rejects.toThrow(/inserted queued/);
    await ins('payload_ref', ['ok:1']);
  });
  it('queued -> canceled needs cancel_requested = true', async () => {
    const t = await tenant(); const { job } = await enq(t);
    await expect(s.pool.query(`update system_jobs set status='canceled', finished_at=now() where id=$1`, [job.id])).rejects.toThrow(/cancel/);
    await s.pool.query(`update system_jobs set status='canceled', cancel_requested=true, finished_at=now() where id=$1`, [job.id]);
  });
});

describe('fix round: token validation in Node, fail-closed tenancy, reclaim batch', () => {
  const boom = { query: () => { throw new Error('SQL must not be touched'); }, connect: () => { throw new Error('SQL must not be touched'); } } as unknown as pg.Pool;
  const bad: unknown[] = [1.5, NaN, Infinity, 2 ** 70, -1, '1', null, undefined, {}];
  it('a token that is not a safe non-negative integer is a stale_token and never reaches SQL', async () => {
    const id = '00000000-0000-0000-0000-000000000000';
    for (const token of bad) {
      const tk = token as number;
      expect(await heartbeatJob(boom, { tenantId: 't', id, token: tk, leaseSeconds: 5 })).toEqual({ ok: false, reason: 'stale_token' });
      expect(await completeJob(boom, { tenantId: 't', id, token: tk })).toEqual({ ok: false, reason: 'stale_token' });
      expect(await failJob(boom, { tenantId: 't', id, token: tk, error: 'x' })).toEqual({ ok: false, reason: 'stale_token' });
      expect(await acknowledgeCancel(boom, { tenantId: 't', id, token: tk })).toEqual({ ok: false, reason: 'stale_token' });
    }
  });
  it('claimJob and reclaimExpired throw unless given a tenantId or an explicit allTenants: true', async () => {
    await expect(claimJob(s.pool, { owner: 'w', kinds: [...K], leaseSeconds: 5 } as never)).rejects.toThrow(/tenantId|allTenants/);
    await expect(reclaimExpired(s.pool)).rejects.toThrow(/tenantId|allTenants/);
    await expect(reclaimExpired(s.pool, {})).rejects.toThrow(/tenantId|allTenants/);
    await expect(claimJob(s.pool, { owner: 'w', kinds: [...K], leaseSeconds: 5, allTenants: false } as never)).rejects.toThrow(/tenantId|allTenants/);
    await expect(claimJob(s.pool, { owner: 'w', kinds: [...K], leaseSeconds: 5, tenantId: '' })).rejects.toThrow(/tenantId|allTenants/);
  });
  it('reclaimExpired takes a batch limit (default 100) and leaves the rest for the next call', async () => {
    const t = await tenant(); const ids: string[] = [];
    for (let i = 0; i < 5; i++) { await enq(t); ids.push((await claim(t))!.id); }
    await rawAge(s.pool, 'tenant_id=$1', [t]);
    expect((await reclaimExpired(s.pool, { tenantId: t, limit: 2 })).length).toBe(2);
    expect((await s.pool.query(`select count(*)::int n from system_jobs where tenant_id=$1 and status='leased'`, [t])).rows[0].n).toBe(3);
    expect((await reclaimExpired(s.pool, { tenantId: t })).length).toBe(3);
    await expect(reclaimExpired(s.pool, { tenantId: t, limit: 0 })).rejects.toThrow(/limit/);
    await expect(reclaimExpired(s.pool, { tenantId: t, limit: 100000 })).rejects.toThrow(/limit/);
  });
  it('stress: 6 workers with 0.05 s leases, 2 reclaimers and a canceller never double-hold a job', async () => {
    const m = await makeSchema();
    const pool = new pg.Pool({ connectionString: TEST_DB(), options: `-c search_path=${m.schema}`, max: 12 });
    const claims = new Map<string, string>(); const dupes: string[] = []; const badWins: string[] = [];
    let stop = false;
    try {
      for (let i = 0; i < 24; i++) await enqueueJob(pool, { tenantId: 't-1', kind: 'noop.test', idempotencyKey: `s${i}`, createdBy: 't', maxAttempts: 3 });
      const worker = async (w: number) => {
        while (!stop) {
          const j = await claimJob(pool, { owner: `w${w}`, kinds: ['noop.test'], leaseSeconds: 0.05, allTenants: true });
          if (!j) { await new Promise((r) => setTimeout(r, 5)); continue; }
          const key = `${j.id}:${j.leaseToken}`;
          if (claims.has(key)) dupes.push(key); claims.set(key, `w${w}`);
          const act = Math.random();
          if (act < 0.3) await new Promise((r) => setTimeout(r, 80)); // outlive the lease
          const ok = act < 0.6 ? await completeJob(pool, { tenantId: 't-1', id: j.id, token: j.leaseToken })
            : act < 0.8 ? await failJob(pool, { tenantId: 't-1', id: j.id, token: j.leaseToken, error: 'e' }) : await heartbeatJob(pool, { tenantId: 't-1', id: j.id, token: j.leaseToken, leaseSeconds: 0.05 });
          if (ok.ok && ok.job.leaseOwner !== null && ok.job.leaseOwner !== `w${w}`) badWins.push(key);
        }
      };
      const reclaimer = async () => { while (!stop) { await reclaimExpired(pool, { allTenants: true, limit: 5 }); await new Promise((r) => setTimeout(r, 15)); } };
      const canceller = async () => { while (!stop) { const r = (await pool.query(`select id from system_jobs where status in ('queued','leased') order by random() limit 1`)).rows[0]; if (r) await requestCancel(pool, { tenantId: 't-1', id: r.id, actor: 'c' }); await new Promise((r2) => setTimeout(r2, 60)); } };
      const runs = [...Array.from({ length: 6 }, (_, w) => worker(w)), reclaimer(), reclaimer(), canceller()];
      await new Promise((r) => setTimeout(r, 2500)); stop = true; await Promise.all(runs);
      expect(dupes).toEqual([]); expect(badWins).toEqual([]);
      const rows = (await pool.query('select status, attempt, lease_token::int tok, lease_owner, lease_expires_at from system_jobs')).rows;
      for (const r of rows) { expect(r.tok).toBeGreaterThanOrEqual(r.attempt); expect((r.status === 'leased') === (r.lease_owner !== null)).toBe(true); }
      expect(claims.size).toBeGreaterThan(24);
    } finally { stop = true; await pool.end(); await m.drop(); }
  }, 30_000);
});

describe('tenant isolation', () => {
  it('another tenant cannot read, heartbeat, complete, fail, cancel or acknowledge a job', async () => {
    const { t, id, c } = await leased();
    const o = await tenant();
    expect(await getJob(s.pool, o, id)).toBeNull();
    expect(await heartbeatJob(s.pool, { tenantId: o, id, token: c.leaseToken, leaseSeconds: 60 })).toEqual({ ok: false, reason: 'not_found' });
    expect(await completeJob(s.pool, { tenantId: o, id, token: c.leaseToken })).toEqual({ ok: false, reason: 'not_found' });
    expect(await failJob(s.pool, { tenantId: o, id, token: c.leaseToken, error: 'x' })).toEqual({ ok: false, reason: 'not_found' });
    expect(await requestCancel(s.pool, { tenantId: o, id, actor: 'a' })).toEqual({ ok: false, reason: 'not_found' });
    expect(await acknowledgeCancel(s.pool, { tenantId: o, id, token: c.leaseToken })).toEqual({ ok: false, reason: 'not_found' });
    const r = await row(id);
    expect(r).toMatchObject({ status: 'leased', cancel_requested: false, tenant_id: t });
    expect(await claim(o)).toBeNull();
  });
});

describe('the database clock decides, not the Node clock', () => {
  it('a Node clock a day ahead does not expire a live lease; a day behind does not revive an expired one', async () => {
    const { t, id, c } = await leased();
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 86_400_000 });
    try {
      expect((await heartbeatJob(s.pool, { tenantId: t, id, token: c.leaseToken, leaseSeconds: 60 })).ok).toBe(true);
      expect(await reclaimExpired(s.pool, { tenantId: t })).toEqual([]);
    } finally { vi.useRealTimers(); }
    await expire(id);
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() - 86_400_000 });
    try {
      expect(await heartbeatJob(s.pool, { tenantId: t, id, token: c.leaseToken, leaseSeconds: 60 })).toEqual({ ok: false, reason: 'lease_expired' });
      expect(await completeJob(s.pool, { tenantId: t, id, token: c.leaseToken })).toEqual({ ok: false, reason: 'lease_expired' });
      expect((await reclaimExpired(s.pool, { tenantId: t })).length).toBe(1);
    } finally { vi.useRealTimers(); }
  });
  it('the store source never compares times in Node', () => {
    const src = readFileSync(join(__dirname, '../src/jobs/store.ts'), 'utf8');
    expect(src).not.toMatch(/Date\.now\(\)|new Date\(\)\.getTime|performance\.now/);
  });
});

describe('concurrency', () => {
  it('20 parallel claimers over 50 jobs: each job is claimed exactly once, and the table agrees', async () => {
    const m = await makeSchema();
    const pool = new pg.Pool({ connectionString: TEST_DB(), options: `-c search_path=${m.schema}`, max: MAX_TEST_CONNECTIONS }); // c70 (H14): 20 claimers share a bounded pool
    const seen = watch(pool);
    try {
      for (let i = 0; i < 50; i++) await enqueueJob(pool, { tenantId: 't-1', kind: 'noop.test', idempotencyKey: `j${i}`, createdBy: 't' });
      const claimed: Job[][] = await Promise.all(Array.from({ length: 20 }, async (_, w) => {
        const mine: Job[] = [];
        for (;;) { const j = await claimJob(pool, { owner: `w${w}`, kinds: ['noop.test'], leaseSeconds: 60, allTenants: true }); if (!j) break; mine.push(j); }
        return mine;
      }));
      const all = claimed.flat();
      expect(all.length).toBe(50);
      expect(new Set(all.map((j) => j.id)).size).toBe(50);
      const rows = (await pool.query('select id, status, attempt, lease_token::int tok, lease_owner from system_jobs')).rows;
      expect(rows.length).toBe(50);
      for (const r of rows) {
        expect(r).toMatchObject({ status: 'leased', attempt: 1, tok: 1 });
        const holder = claimed.findIndex((mine) => mine.some((j) => j.id === r.id));
        expect(r.lease_owner).toBe(`w${holder}`);
        expect(claimed.filter((mine) => mine.some((j) => j.id === r.id)).length).toBe(1);
      }
      // second generation: all leases expire, five reclaimers race, then 20 claimers again
      await rawAge(pool, 'true');
      const rc = await Promise.all(Array.from({ length: 5 }, () => reclaimExpired(pool, { allTenants: true })));
      expect(rc.flat().length).toBe(50);
      expect(new Set(rc.flat().map((j) => j.id)).size).toBe(50);
      const gen2: Job[][] = await Promise.all(Array.from({ length: 20 }, async (_, w) => {
        const mine: Job[] = [];
        for (;;) { const j = await claimJob(pool, { owner: `v${w}`, kinds: ['noop.test'], leaseSeconds: 60, allTenants: true }); if (!j) break; mine.push(j); }
        return mine;
      }));
      expect(gen2.flat().length).toBe(50);
      expect(new Set(gen2.flat().map((j) => j.id)).size).toBe(50);
      const rows2 = (await pool.query('select status, attempt, lease_token::int tok, lease_owner from system_jobs')).rows;
      for (const r of rows2) expect(r).toMatchObject({ status: 'leased', attempt: 2, tok: 3 });
      expect(new Set(rows2.map((r) => r.lease_owner)).size).toBeGreaterThan(1);
      // c70 (H14): the test's own footprint is bounded (the shared role is capped at 45 connections), yet the claimers really overlapped
      expect(seen.peakClients, 'connections this test opened').toBeLessThanOrEqual(MAX_TEST_CONNECTIONS);
      expect(seen.peakBusy, 'claimers in flight at the same moment').toBeGreaterThanOrEqual(4);
    } finally { await pool.end(); await m.drop(); }
  }, 60_000);
});

describe('GET /operations/queues (admin only, tenant scoped)', () => {
  let t: TestApp; let A: Awaited<ReturnType<typeof withAdmin>>;
  afterAll(async () => { await t?.close(); });
  it('counts by kind and status, oldest queued age and expired leases; members are refused', async () => {
    t = await makeTestApp();
    A = await withAdmin(t.app); const m = await A.member('Mina');
    const tid = (await t.pool.query('select id from tenants limit 1')).rows[0].id as string;
    const other = 'other-tenant'; await t.pool.query(`insert into tenants(id,name) values ($1,$1)`, [other]);
    const q = (k: string, tn = tid) => t.pool.query(`insert into system_jobs(tenant_id, kind, idempotency_key, created_by, created_at) values ($1,'noop.test',$2,'x', now() - interval '2 minutes')`, [tn, k]);
    await q('a'); await q('b'); await q('c'); await q('foreign', other);
    const l = (await claimJob(t.pool, { owner: 'w', kinds: ['noop.test'], leaseSeconds: 60, tenantId: tid }))!;
    await rawAge(t.pool, 'id=$1', [l.id]);
    const r = await A.admin.req('GET', '/operations/queues');
    expect(r.status).toBe(200);
    expect(r.body.kinds).toHaveLength(1);
    expect(r.body.kinds[0]).toMatchObject({ kind: 'noop.test', total: 3, counts: { queued: 2, leased: 1, succeeded: 0, failed: 0, canceled: 0, dead: 0 } });
    expect(r.body.expiredLeases).toBe(1);
    expect(r.body.oldestQueuedAgeSec).toBeGreaterThanOrEqual(119);
    expect(r.body).toMatchObject({ total: 3, execution: 'disabled', recordsOnly: true });
    expect(JSON.stringify(r.body)).not.toMatch(/lease_token|leaseToken|idempotency/);
    expect((await m.b.req('GET', '/operations/queues')).status).toBe(403);
    expect((await new (await import('./helpers.ts')).Browser(t.app).req('GET', '/operations/queues')).status).toBe(401);
  });
  it('has no client route that enqueues, claims or cancels', async () => {
    for (const [method, url] of [['POST', '/operations/queues'], ['POST', '/operations/jobs'], ['POST', '/operations/jobs/claim'], ['PUT', '/operations/queues'], ['DELETE', '/operations/queues']]) {
      const r = await A.admin.req(method, url, {});
      expect([404, 405]).toContain(r.status);
    }
    const before = (await t.pool.query('select count(*)::int n from system_jobs')).rows[0].n;
    expect(before).toBeGreaterThanOrEqual(0);
  });
  it('an empty tenant shows zeros and no age', async () => {
    const t2 = await makeTestApp();
    try {
      const A = await withAdmin(t2.app);
      const r = await A.admin.req('GET', '/operations/queues');
      expect(r.body).toMatchObject({ total: 0, oldestQueuedAgeSec: null, expiredLeases: 0 });
    } finally { await t2.close(); }
  });
});

describe('execution stays disabled', () => {
  // NOTE: these are greps over source text, not proofs. They catch accidents and the obvious bypasses (dynamic import, extra
  // route methods, sleep loops); a determined author can still evade them. The real guarantee is code review plus the fact
  // that no code in this build instantiates a worker.
  const walk = (d: string): string[] => { try { return readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? (f === 'node_modules' ? [] : walk(p)) : /\.(ts|mjs|js|sh)$/.test(p) ? [p] : []; }); } catch { return []; } };
  const ROOT = join(__dirname, '..');
  const SRC = join(ROOT, 'src');
  const outside = [...walk(SRC), ...walk(join(ROOT, 'scripts'))].filter((f) => !f.includes('/src/jobs/'));
  const STORE_FNS = /\b(claimJob|reclaimExpired|enqueueJob|heartbeatJob|completeJob|failJob|requestCancel|acknowledgeCancel)\b/;
  it('nothing outside src/jobs (src and scripts) imports the store, statically or dynamically, or names a store function', () => {
    expect(outside.length).toBeGreaterThan(20);
    for (const f of outside) {
      const txt = readFileSync(f, 'utf8');
      expect(txt, f).not.toMatch(/jobs\/store/);
      expect(txt, f).not.toMatch(/import\s*\([^)]*jobs/);
      expect(txt, f).not.toMatch(/require\s*\([^)]*jobs/);
      expect(txt, f).not.toMatch(STORE_FNS);
    }
  });
  it('the jobs code starts no timer, interval, sleep loop, worker, child process or listener', () => {
    for (const f of walk(join(SRC, 'jobs'))) {
      const txt = readFileSync(f, 'utf8');
      expect(txt, f).not.toMatch(/setInterval|setTimeout|setImmediate|child_process|worker_threads|node-cron|\.listen\(|pg_sleep|while\s*\(\s*(true|1)\s*\)|for\s*\(\s*;\s*;\s*\)|\bsleep\b/);
    }
  });
  it('no route registration mentions jobs or queues except the one read-only GET in ops/routes.ts', () => {
    const REG = /\b[A-Za-z_$][\w$]*\.(get|post|put|patch|delete|route|all|head|options)\s*\(\s*([^)]{0,300})/g;
    for (const f of [...outside, ...walk(join(SRC, 'jobs'))]) {
      const txt = readFileSync(f, 'utf8');
      for (const m of txt.matchAll(REG)) {
        if (!/jobs?\b|queues?\b/i.test(m[2])) continue;
        const ok = f.endsWith('/src/ops/routes.ts') && m[1] === 'get' && /'\/operations\/queues'/.test(m[2]);
        expect(ok, `${f}: ${m[0].slice(0, 80)}`).toBe(true);
      }
    }
  });
  it('the ops route file has no write handler at all', () => {
    expect(readFileSync(join(SRC, 'ops/routes.ts'), 'utf8')).not.toMatch(/\.(post|put|patch|delete|route)\s*\(/);
  });
});
