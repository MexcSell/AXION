import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeSchema, makeTestApp, withAdmin, type TestApp } from './helpers.ts';
import { effectiveHaltOf, readEffectiveHalt, recordHalt, type HaltRow } from '../src/jobs/run-halts.ts';
import { verifyChain } from '../src/audit.ts';
import type { RunCaps, RunClassBreaker } from '../../shared/contracts/src/index.ts';
import { HALT_CASES, THRESHOLDS_A2, type HaltScopeF } from './phaseA/halt-fixtures.ts';
import { DurableFakeStore } from './phaseA/durable-store.ts';
import { interleavings, workerOps } from './c95/fake-executor.ts';

/** Phase A, A2: the halt-record table and the durable source the caps checker reads. Nothing executes; the halt is data. */
const LOOSE: RunCaps = { maxSteps: 1000, maxWallMs: 3_600_000, maxToolCallsPerMinute: 1000, maxDistinctOrigins: 1000, reservedMoneyMicros: 1e12, reservedTokens: 1e12 };
const BR: RunClassBreaker = { taskClass: 'fixture', stage: 2, maxConsecutiveFailures: 1000 };

let s: Awaited<ReturnType<typeof makeSchema>>;
beforeAll(async () => { s = await makeSchema(); }, 60_000);
afterAll(async () => { await s?.drop(); });
const q = (sql: string, p: unknown[] = []) => s.pool.query(sql, p);

describe('the reducer (pure): hand-derived answers', () => {
  it('has at least 20 cases', () => { expect(HALT_CASES.length).toBeGreaterThanOrEqual(THRESHOLDS_A2.minCases); });
  for (const c of HALT_CASES) {
    it(`${c.id}: ${c.why}`, () => {
      const rows: HaltRow[] = c.rows.map((r, i) => ({ id: i + 1, ...r }));
      const e = effectiveHaltOf(rows, c.query);
      expect(e.halted).toBe(c.expect.halted);
      expect(e.scope ?? null).toBe(c.expect.scope);
      if (c.expect.halted) expect(e.reason).toBe(`${c.expect.scope}: ${c.expect.reason}`);
      // rows are decided by id, not by array order
      expect(effectiveHaltOf([...rows].reverse(), c.query)).toEqual(e);
    });
  }
  it('fails closed on garbage: a malformed row is never read as "not halted" by accident', () => {
    expect(effectiveHaltOf([{ id: 1, scope: 'galaxy' as unknown as HaltScopeF, target: '', halted: true, reason: 'x' }], { runId: 'r', taskClass: 'c' }).halted).toBe(true);
  });
});

describe('the table gives the same answers as the reducer', () => {
  let n = 0;
  for (const c of HALT_CASES) {
    it(`${c.id}`, async () => {
      const tenant = `a2-case-${++n}`; // a fresh tenant: the global scope is per tenant and the table is append-only
      for (const r of c.rows) await recordHalt(s.pool, tenant, { ...r, createdBy: 'u-test' });
      const e = await readEffectiveHalt(s.pool, tenant, c.query);
      expect(e.halted).toBe(c.expect.halted);
      expect(e.scope ?? null).toBe(c.expect.scope);
      if (c.expect.halted) expect(e.reason).toBe(`${c.expect.scope}: ${c.expect.reason}`);
    });
  }
  it('another tenant\'s halt, even a global one, never halts this tenant', async () => {
    await recordHalt(s.pool, 'a2-tenant-x', { scope: 'global', target: '', halted: true, reason: 'x', createdBy: 'u' });
    expect((await readEffectiveHalt(s.pool, 'a2-tenant-y', { runId: 'r', taskClass: 'c' })).halted).toBe(false);
    expect((await readEffectiveHalt(s.pool, 'a2-tenant-x', { runId: 'r', taskClass: 'c' })).halted).toBe(true);
  });
});

describe('run_halts is append-only and checked', () => {
  it('UPDATE, DELETE and TRUNCATE are refused', async () => {
    await recordHalt(s.pool, 'a2-ao', { scope: 'global', target: '', halted: true, reason: 'x', createdBy: 'u' });
    await expect(q(`update run_halts set halted=false where tenant_id='a2-ao'`)).rejects.toThrow(/append-only/);
    await expect(q(`delete from run_halts where tenant_id='a2-ao'`)).rejects.toThrow(/append-only/);
    await expect(q(`truncate run_halts`)).rejects.toThrow(/append-only/);
  });
  it('refuses a bad scope, a global row with a target, a class or run row without one, an empty or over-long reason', async () => {
    const bad = (o: object) => recordHalt(s.pool, 'a2-chk', { scope: 'global', target: '', halted: true, reason: 'x', createdBy: 'u', ...o } as never);
    await expect(bad({ scope: 'galaxy' })).rejects.toThrow();
    await expect(bad({ scope: 'global', target: 'x' })).rejects.toThrow();
    await expect(bad({ scope: 'class', target: '' })).rejects.toThrow();
    await expect(bad({ scope: 'run', target: '' })).rejects.toThrow();
    await expect(bad({ reason: '' })).rejects.toThrow();
    await expect(bad({ reason: 'x'.repeat(501) })).rejects.toThrow();
    expect((await q(`select count(*)::int n from run_halts where tenant_id='a2-chk'`)).rows[0].n).toBe(0);
  });
  it('the database clock stamps created_at', async () => {
    const r = await recordHalt(s.pool, 'a2-clock', { scope: 'global', target: '', halted: true, reason: 'x', createdBy: 'u' });
    const at = (await q(`select created_at from run_halts where id=$1`, [r.id])).rows[0].created_at as Date;
    expect(Math.abs(Date.now() - at.getTime())).toBeLessThan(60_000);
  });
});

describe('threshold: zero accepted steps after a halt row, against the table, in every interleaving', () => {
  const run = async (lists: ReturnType<typeof workerOps>[], scope: HaltScopeF, label: string, recheck = true) => {
    let n = 0, violations = 0, effects = 0;
    for (const order of interleavings(lists)) {
      n++;
      const st = new DurableFakeStore(s.pool, `a2-${label}-${recheck ? 'ok' : 'neg'}-${n}`, `run-${n}`, 'web-research', LOOSE, BR, scope, recheck);
      for (const op of order) await st.apply(op);
      effects += st.effects.length;
      violations += st.effects.filter((e) => e.afterHaltRow).length;
    }
    return { n, violations, effects };
  };
  const H3 = () => [workerOps(1, 1), workerOps(2, 1), workerOps(3, 1), [{ kind: 'halt' } as const]];
  const H2 = () => [workerOps(1, 2), workerOps(2, 2), [{ kind: 'halt' } as const]];
  for (const scope of ['global', 'class', 'run'] as const) {
    it(`H3 with a ${scope} halt: 630 interleavings, 0 steps accepted after the halt row`, async () => {
      const r = await run(H3(), scope, `h3${scope}`);
      expect(r.n).toBe(THRESHOLDS_A2.interleavings.H3);
      expect(r.violations).toBe(0);
      expect(r.effects).toBeGreaterThan(0); // the runs were not all refused
    }, 300_000);
  }
  it('H2 with a global halt: 630 interleavings, 0 steps accepted after the halt row', async () => {
    const r = await run(H2(), 'global', 'h2');
    expect(r.n).toBe(THRESHOLDS_A2.interleavings.H2);
    expect(r.violations).toBe(0);
  }, 300_000);
  it('negative control (a store that skips the re-check at commit) does accept steps after the halt, so the fixtures can fail; excluded from the counts', async () => {
    const r = await run(H3(), 'global', 'h3neg', false);
    expect(r.violations).toBeGreaterThan(0);
  }, 300_000);
});

describe('routes: POST and GET /operations/halts', () => {
  let t: TestApp, a: Awaited<ReturnType<typeof withAdmin>>, mem: { b: { req: (...x: any[]) => Promise<any> } };
  let n = 0;
  const key = () => ({ 'idempotency-key': 'halt-' + ++n });
  beforeAll(async () => { t = await makeTestApp(); a = await withAdmin(t.app); mem = await a.member('Mina'); }, 60_000);
  afterAll(async () => { await t?.close(); });

  it('only an administrator can read or write', async () => {
    expect((await mem.b.req('GET', '/operations/halts')).status).toBe(403);
    expect((await mem.b.req('POST', '/operations/halts', { scope: 'global', halted: true, reason: 'x' }, key())).status).toBe(403);
    expect((await t.pool.query('select count(*)::int n from run_halts')).rows[0].n).toBe(0);
  });
  it('a reason is required; unknown keys and bad scopes or targets are refused', async () => {
    for (const body of [{ scope: 'global', halted: true }, { scope: 'global', halted: true, reason: '  ' }, { scope: 'galaxy', halted: true, reason: 'x' }, { scope: 'class', halted: true, reason: 'x' },
      { scope: 'global', target: 'x', halted: true, reason: 'x' }, { scope: 'global', halted: 'yes', reason: 'x' }, { scope: 'global', halted: true, reason: 'x', createdBy: 'me' }, { scope: 'run', target: 'a b', halted: true, reason: 'x' }]) {
      const r = await a.admin.req('POST', '/operations/halts', body, key());
      expect(r.status, JSON.stringify(body)).toBe(400);
    }
    expect((await t.pool.query('select count(*)::int n from run_halts')).rows[0].n).toBe(0);
  });
  it('sets, lists and lifts a halt; each is audited with the administrator and the reason; the chain still verifies', async () => {
    const set = await a.admin.req('POST', '/operations/halts', { scope: 'class', target: 'web-research', halted: true, reason: 'Odd spend' }, key());
    expect(set.status).toBe(201);
    expect(set.body.halt).toMatchObject({ scope: 'class', target: 'web-research', halted: true, reason: 'Odd spend', createdBy: a.adminId });
    let list = (await a.admin.req('GET', '/operations/halts')).body;
    expect(list.active.map((h: any) => `${h.scope}:${h.target}`)).toEqual(['class:web-research']);
    const lift = await a.admin.req('POST', '/operations/halts', { scope: 'class', target: 'web-research', halted: false, reason: 'Fixed' }, key());
    expect(lift.status).toBe(201);
    list = (await a.admin.req('GET', '/operations/halts')).body;
    expect(list.active).toEqual([]);
    expect(list.recent.map((h: any) => h.halted)).toEqual([false, true]); // newest first
    const rows = (await t.pool.query(`select action, actor, subject, detail from audit_events where action like 'run.halt.%' order by seq`)).rows;
    expect(rows.map((r) => r.action)).toEqual(['run.halt.set', 'run.halt.lift']);
    expect(rows[0]).toMatchObject({ actor: a.adminId, subject: 'class:web-research', detail: { reason: 'Odd spend', scope: 'class', target: 'web-research' } });
    expect((await verifyChain(t.pool, 't-1')).ok).toBe(true);
  });
  it('a retried request with the same idempotency key writes one row', async () => {
    const k = key();
    const body = { scope: 'run', target: 'run-77', halted: true, reason: 'x' };
    const r1 = await a.admin.req('POST', '/operations/halts', body, k);
    const r2 = await a.admin.req('POST', '/operations/halts', body, k);
    expect(r1.status).toBe(201); expect(r2.status).toBe(201);
    expect((await t.pool.query(`select count(*)::int n from run_halts where target='run-77'`)).rows[0].n).toBe(1);
  });
});
