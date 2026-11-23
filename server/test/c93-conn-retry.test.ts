import { describe, it, expect } from 'vitest';
import { acquireWithRetry, isConnectionCap } from '../src/db.ts';

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
// c98: the real-pool fault tests moved to test/c98-db-hooks.test.ts (acquireHook option instead of env knobs inside src/db.ts)
