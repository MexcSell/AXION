import { describe, it, expect, afterEach } from 'vitest';
import { acquireWithRetry, isConnectionCap, makePool, connectClient } from '../src/db.ts';
import { TEST_DB } from './helpers.ts';

const cap = () => Object.assign(new Error('too many connections for role "axion"'), { code: '53300' });
const noSleep = { sleep: async () => {}, random: () => 0.5 };

/** a fake pool: connect() throws 53300 `fails` times, then hands out a client */
function fakePool(fails: number, err: () => Error = cap) {
  const s = { connects: 0, queries: 0 };
  const client = { query: async () => { s.queries++; return { rows: [{ ok: 1 }] }; } };
  return { s, connect: async () => { s.connects++; if (s.connects <= fails) throw err(); return client; } };
}

describe('c93 connection-acquisition retry (unit)', () => {
  it('53300 twice, then success: three attempts, two warn lines, the caller sees success', async () => {
    const p = fakePool(2); const warns: unknown[] = [];
    const c = await acquireWithRetry(p.connect, { ...noSleep, warn: (i) => warns.push(i) });
    expect(p.s.connects).toBe(3); expect(warns.length).toBe(2);
    expect((await c.query()).rows[0].ok).toBe(1);
  });
  it('any other error code is not retried', async () => {
    for (const mk of [() => Object.assign(new Error('boom'), { code: '28P01' }), () => Object.assign(new Error('x'), { code: '57P03' }), () => new Error('timeout exceeded when trying to connect')]) {
      const p = fakePool(5, mk); const warns: unknown[] = [];
      await expect(acquireWithRetry(p.connect, { ...noSleep, warn: (i) => warns.push(i) })).rejects.toThrow();
      expect(p.s.connects).toBe(1); expect(warns.length).toBe(0);
    }
  });
  it('the pg message alone ("too many connections") also counts', () => {
    expect(isConnectionCap(new Error('sorry, too many connections already'))).toBe(true);
    expect(isConnectionCap(Object.assign(new Error('x'), { code: '53300' }))).toBe(true);
    expect(isConnectionCap(new Error('syntax error'))).toBe(false);
    expect(isConnectionCap(null)).toBe(false);
  });
  it('bounded: always-53300 gives up after 5 attempts, total waits under 3 s, and throws the original error', async () => {
    const p = fakePool(99); const waits: number[] = [];
    await expect(acquireWithRetry(p.connect, { sleep: async (ms) => { waits.push(ms); }, random: () => 0.999 })).rejects.toThrow(/too many connections/);
    expect(p.s.connects).toBe(5);
    expect(waits.reduce((a, b) => a + b, 0)).toBeLessThan(3000);
  });
  it('a failing QUERY is never retried: only acquisition is wrapped', async () => {
    let connects = 0, queries = 0;
    const acquire = async () => { connects++; return { query: async () => { queries++; throw cap(); } }; };
    const c = await acquireWithRetry(acquire, noSleep);
    await expect(c.query()).rejects.toThrow(/too many connections/);
    expect(connects).toBe(1); expect(queries).toBe(1);
  });
});

describe('c93 retry inside makePool and connectClient (fault injection, real test DB, no extra connections held)', () => {
  const saved = { f: process.env.AXION_TEST_FAULT_53300, n: process.env.AXION_TEST_NO_RETRY };
  afterEach(() => { for (const [k, v] of [['AXION_TEST_FAULT_53300', saved.f], ['AXION_TEST_NO_RETRY', saved.n]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });

  it('the first 2 acquisitions of the pool fail with 53300: pool.query still succeeds, 2 warn lines, and a failed query is not retried', async () => {
    process.env.AXION_TEST_FAULT_53300 = '2'; delete process.env.AXION_TEST_NO_RETRY;
    const warns: unknown[] = [];
    const pool = makePool(TEST_DB(), undefined, 2, (i) => warns.push(i));
    try {
      expect((await pool.query('select 1 as n')).rows[0].n).toBe(1);
      expect(warns.length).toBe(2);
      let acquired = 0; pool.on('acquire', () => acquired++);
      await expect(pool.query('select 1/0')).rejects.toMatchObject({ code: '22012' });
      expect(acquired).toBe(1); expect(warns.length).toBe(2); // one acquisition, no retry of the failed statement
      const c = await pool.connect(); c.release(); // promise form too
    } finally { await pool.end(); }
  });
  it('without the retry the same fault surfaces as 53300 (this is the flake)', async () => {
    process.env.AXION_TEST_FAULT_53300 = '1'; process.env.AXION_TEST_NO_RETRY = '1';
    const pool = makePool(TEST_DB(), undefined, 2);
    try { await expect(pool.query('select 1')).rejects.toMatchObject({ code: '53300' }); } finally { await pool.end(); }
  });
  it('connectClient retries the same way', async () => {
    process.env.AXION_TEST_FAULT_53300 = '2'; delete process.env.AXION_TEST_NO_RETRY;
    const warns: unknown[] = [];
    const c = await connectClient({ connectionString: TEST_DB() }, (i) => warns.push(i));
    try { expect((await c.query('select 1 as n')).rows[0].n).toBe(1); expect(warns.length).toBe(2); } finally { await c.end(); }
  });
  it('production defaults: no fault and a 10-connection pool outside vitest knobs', () => {
    delete process.env.AXION_TEST_FAULT_53300; delete process.env.AXION_TEST_NO_RETRY;
    const v = process.env.VITEST; delete process.env.VITEST;
    try { const p = makePool(TEST_DB()); expect((p as unknown as { options: { max: number } }).options.max).toBe(10); void p.end(); } finally { process.env.VITEST = v; }
  });
});
