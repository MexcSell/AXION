import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type pg from 'pg';
import { makeSchema, makeTestApp, withAdmin, type TestApp } from './helpers.ts';
import { migrate } from '../src/migrate.ts';
import { tx } from '../src/db.ts';
import { audit, verifyChain } from '../src/audit.ts';
import { seedDemo } from '../src/seed/demo.ts';
import { EVENTS_LOCK } from '../src/events/log.ts';

const T = 't-1';
const put = (c: any, n: number, tenantId = T, detail: Record<string, unknown> = { n }) =>
  audit(c, { tenantId, actor: 'u1', action: 'test.event', subject: 'x' + n, result: 'ok', correlationId: 'c' + n, detail });
/** Test-DB-only: the append-only triggers are switched off inside the test itself, as a superuser-style tamperer would. */
async function tamper(pool: pg.Pool, sql: string, params: unknown[] = []) {
  const c = await pool.connect();
  try {
    await c.query('alter table audit_events disable trigger user');
    try { await c.query(sql, params); } finally { await c.query('alter table audit_events enable trigger user'); }
  } finally { c.release(); }
}

describe('audit chain', () => {
  let s: Awaited<ReturnType<typeof makeSchema>>;
  beforeAll(async () => { s = await makeSchema(); });
  afterAll(async () => { await s.drop(); });
  const fresh = async (tenant: string, n = 6) => { for (let i = 1; i <= n; i++) await put(s.pool, i, tenant); };

  it('an empty tenant verifies ok with nothing checked', async () => {
    expect(await verifyChain(s.pool, 'nobody')).toEqual({ ok: true, checked: 0 });
  });

  it('rows get seq 1..n, link by prev_hash, and verify ok', async () => {
    await fresh('t-ok');
    const rows = (await s.pool.query(`select seq, prev_hash, row_hash from audit_events where tenant_id='t-ok' order by seq`)).rows;
    expect(rows.map((r) => Number(r.seq))).toEqual([1, 2, 3, 4, 5, 6]);
    expect(rows[1].prev_hash).toBe(rows[0].row_hash);
    expect(rows[0].prev_hash).toBe('0'.repeat(64));
    expect(await verifyChain(s.pool, 't-ok')).toEqual({ ok: true, checked: 6 });
  });

  it('chains are per tenant', async () => {
    await put(s.pool, 1, 't-a'); await put(s.pool, 1, 't-b'); await put(s.pool, 2, 't-a');
    expect((await s.pool.query(`select seq from audit_events where tenant_id='t-a' order by seq`)).rows.map((r) => Number(r.seq))).toEqual([1, 2]);
    expect((await s.pool.query(`select seq from audit_events where tenant_id='t-b' order by seq`)).rows.map((r) => Number(r.seq))).toEqual([1]);
  });

  it('secrets are redacted before they are hashed or stored', async () => {
    await put(s.pool, 1, 't-sec', { password: 'hunter2', token: 'abc', keep: 'yes' });
    const r = (await s.pool.query(`select detail from audit_events where tenant_id='t-sec'`)).rows[0];
    expect(r.detail).toEqual({ keep: 'yes' });
    expect((await verifyChain(s.pool, 't-sec')).ok).toBe(true);
  });

  it('UPDATE and DELETE are refused by the trigger', async () => {
    await fresh('t-trg', 2);
    await expect(s.pool.query(`update audit_events set detail='{}' where tenant_id='t-trg'`)).rejects.toThrow(/audit_events is append-only/);
    await expect(s.pool.query(`delete from audit_events where tenant_id='t-trg'`)).rejects.toThrow(/audit_events is append-only/);
    await expect(s.pool.query(`update audit_events set row_hash='x' where tenant_id='t-trg'`)).rejects.toThrow(/append-only/);
    await expect(s.pool.query(`truncate audit_events`)).rejects.toThrow(/append-only/);
    expect((await verifyChain(s.pool, 't-trg')).ok).toBe(true);
  });

  it('an edited detail is found at that row', async () => {
    await fresh('t-edit');
    await tamper(s.pool, `update audit_events set detail = '{"n":99}' where tenant_id='t-edit' and seq=3`);
    expect(await verifyChain(s.pool, 't-edit')).toMatchObject({ ok: false, firstBadSeq: 3 });
  });

  it('an edited actor / result is found too', async () => {
    await fresh('t-edit2');
    await tamper(s.pool, `update audit_events set result='denied' where tenant_id='t-edit2' and seq=5`);
    expect(await verifyChain(s.pool, 't-edit2')).toMatchObject({ ok: false, firstBadSeq: 5 });
  });

  it('a deleted row in the middle is found at the gap', async () => {
    await fresh('t-del');
    await tamper(s.pool, `delete from audit_events where tenant_id='t-del' and seq=4`);
    const r = await verifyChain(s.pool, 't-del');
    expect(r).toMatchObject({ ok: false, firstBadSeq: 4 });
    expect(r.reason).toBeTruthy();
  });

  it('two rows swapped (their seq exchanged) are found at the first of them', async () => {
    await fresh('t-swap');
    await tamper(s.pool, `update audit_events set seq = seq + 1000 where tenant_id='t-swap' and seq in (2,3);
      update audit_events set seq = case seq when 1002 then 3 else 2 end where tenant_id='t-swap' and seq in (1002,1003)`);
    expect(await verifyChain(s.pool, 't-swap')).toMatchObject({ ok: false, firstBadSeq: 2 });
  });

  it('a forged row appended with a made-up hash is found at its seq', async () => {
    await fresh('t-forge');
    await tamper(s.pool, `insert into audit_events(tenant_id, actor, action, subject, result, correlation_id, detail, seq, prev_hash, row_hash)
      values ('t-forge','mallory','x','x','ok','c','{}',7,'${'a'.repeat(64)}','${'b'.repeat(64)}')`);
    expect(await verifyChain(s.pool, 't-forge')).toMatchObject({ ok: false, firstBadSeq: 7 });
  });

  it('a forged row inserted in the middle (seq reused through a shift) is found', async () => {
    await fresh('t-forge2');
    await tamper(s.pool, `update audit_events set seq = seq + 1000 where tenant_id='t-forge2' and seq >= 4;
      update audit_events set seq = seq - 999 where tenant_id='t-forge2' and seq >= 1004`);
    await tamper(s.pool, `insert into audit_events(tenant_id, actor, action, subject, result, correlation_id, detail, seq, prev_hash, row_hash)
      values ('t-forge2','mallory','x','x','ok','c','{}',4,'${'a'.repeat(64)}','${'b'.repeat(64)}')`);
    expect(await verifyChain(s.pool, 't-forge2')).toMatchObject({ ok: false, firstBadSeq: 4 });
  });

  it('a verify of a long chain walks in batches and reports the exact count', async () => {
    for (let i = 1; i <= 2300; i += 100) await Promise.all(Array.from({ length: 100 }, (_, k) => put(s.pool, i + k, 't-long')));
    expect(await verifyChain(s.pool, 't-long')).toEqual({ ok: true, checked: 2300 });
  }, 60_000);

  it('50 concurrent audit() calls on one tenant make one unbroken chain 1..50 (pool and transaction callers mixed)', async () => {
    const jobs = Array.from({ length: 50 }, (_, i) => i % 2 === 0 ? put(s.pool, i, 't-par') : tx(s.pool, (c) => put(c, i, 't-par')));
    await Promise.all(jobs);
    const seqs = (await s.pool.query(`select seq from audit_events where tenant_id='t-par' order by seq`)).rows.map((r) => Number(r.seq));
    expect(seqs).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    expect(await verifyChain(s.pool, 't-par')).toEqual({ ok: true, checked: 50 });
  }, 60_000);

  it('a rolled-back transaction leaves no gap', async () => {
    await fresh('t-rb', 2);
    await expect(tx(s.pool, async (c) => { await put(c, 3, 't-rb'); throw new Error('boom'); })).rejects.toThrow('boom');
    await put(s.pool, 3, 't-rb');
    expect(await verifyChain(s.pool, 't-rb')).toEqual({ ok: true, checked: 3 });
  });
});

describe('audit chain migration 0026', () => {
  it('backfills pre-existing rows (several tenants, unicode, nested detail) and they verify ok; up → down → up keeps working', async () => {
    const s = await makeSchema({ migrate: false });
    try {
      await migrate(s.pool, 'up', 25);
      const details: unknown[] = [{}, { a: 1, b: [1, 2, { z: null, y: 'éü\n"q"' }], c: true }, { 'ключ': 'значение', k: 1.5, e: [] }, { nested: { b: 1, a: { d: 'x', c: 'y' } } }, { emoji: '😀 \\ \t' }];
      for (let i = 0; i < 40; i++) {
        await s.pool.query(`insert into audit_events(tenant_id, actor, action, subject, result, correlation_id, detail, at) values ($1,'u','a.b',$2,'ok',$3,$4, now() - make_interval(secs => $5))`,
          [i % 3 === 0 ? 't-x' : 't-1', 's' + i, 'c' + i, JSON.stringify(details[i % details.length]), 100 - i]);
      }
      await migrate(s.pool, 'up');
      expect(await verifyChain(s.pool, 't-1')).toEqual({ ok: true, checked: 26 });
      expect(await verifyChain(s.pool, 't-x')).toEqual({ ok: true, checked: 14 });
      await put(s.pool, 1, 't-1'); // new rows continue the backfilled chain
      expect(await verifyChain(s.pool, 't-1')).toEqual({ ok: true, checked: 27 });
      await migrate(s.pool, 'down', 25);
      expect((await s.pool.query(`select column_name from information_schema.columns where table_schema=$1 and table_name='audit_events'`, [s.schema])).rows.map((r) => r.column_name)).not.toContain('row_hash');
      await expect(s.pool.query(`update audit_events set action='x'`)).rejects.toThrow(/append-only/); // still append-only after down
      await migrate(s.pool, 'up');
      expect(await verifyChain(s.pool, 't-1')).toEqual({ ok: true, checked: 27 });
    } finally { await s.drop(); }
  }, 60_000);

  it('a database seeded with the demo data backfills and verifies ok', async () => {
    const t = await makeTestApp({ staffingStepMs: 60_000 });
    try {
      const A = await withAdmin(t.app);
      await seedDemo(t.app.db, 't-1', A.adminId);
      const n = Number((await t.pool.query(`select count(*) from audit_events where tenant_id='t-1'`)).rows[0].count);
      expect(n).toBeGreaterThanOrEqual(3);
      await migrate(t.pool, 'down', 25); // drops the chain columns: the rows are "pre-chain" again
      await migrate(t.pool, 'up');
      expect(await verifyChain(t.pool, 't-1')).toEqual({ ok: true, checked: n });
    } finally { await t.close(); }
  }, 60_000);
});

describe('GET /audit/verify', () => {
  let t: TestApp;
  let A: Awaited<ReturnType<typeof withAdmin>>;
  beforeAll(async () => { t = await makeTestApp({ staffingStepMs: 60_000 }); A = await withAdmin(t.app); });
  afterAll(async () => { await t.close(); });

  it('administrators get the result; members and anonymous callers are refused', async () => {
    const m = await A.member('Mina');
    const r = await A.admin.req('GET', '/audit/verify');
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.checked).toBeGreaterThan(0);
    expect((await m.b.req('GET', '/audit/verify')).status).toBe(403);
    const anon = await t.app.inject({ method: 'GET', url: '/api/v1/audit/verify' });
    expect(anon.statusCode).toBe(401);
  });

  it('reports a tampered chain, and is rate limited', async () => {
    await tamper(t.pool, `update audit_events set action='forged' where tenant_id='t-1' and seq=1`);
    const r = await A.admin.req('GET', '/audit/verify');
    expect(r.body).toMatchObject({ ok: false, firstBadSeq: 1 });
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) codes.push((await A.admin.req('GET', '/audit/verify')).status);
    expect(codes).toContain(429);
  });
});

describe('fix round c31', () => {
  it('M1: a lock timeout while auditing a denied sign-in still returns the 401 (and the failed audit write is not hidden)', async () => {
    const t = await makeTestApp({ staffingStepMs: 60_000 });
    const hold = await t.pool.connect();
    try {
      const A = await withAdmin(t.app);
      const { Browser } = await import('./helpers.ts');
      const b = new Browser(t.app);
      await hold.query(`select pg_advisory_lock(${EVENTS_LOCK})`); // a writer stuck holding the events lock
      const r = await b.connect('Luca', 'wrong-password');
      expect(r.status).toBe(401);
      expect(r.body.code).toBe('WRONG_PASSWORD');
      await hold.query(`select pg_advisory_unlock(${EVENTS_LOCK})`);
      expect((await verifyChain(t.pool, 't-1')).ok).toBe(true);
      void A;
    } finally { hold.release(); await t.close(); }
  }, 30_000);

  it('M2: rows written in one transaction keep their id order when sorted by at (reliability orders handovers by at, id)', async () => {
    const s = await makeSchema();
    try {
      await tx(s.pool, async (c) => { for (let i = 1; i <= 5; i++) await put(c, i, 't-ord'); });
      const rows = (await s.pool.query(`select id, at, seq from audit_events where tenant_id='t-ord' order by at, id`)).rows;
      expect(rows.map((r) => Number(r.seq))).toEqual([1, 2, 3, 4, 5]);
      const asc = (await s.pool.query(`select id from audit_events where tenant_id='t-ord' order by id`)).rows.map((r) => r.id);
      expect(rows.map((r) => r.id)).toEqual(asc);
    } finally { await s.drop(); }
  });
});
