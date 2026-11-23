import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makePool, connectClient, setPoolDefaults } from '../src/db.ts';
import { applyTestDefaults } from './setup.ts';
import { TEST_DB } from './helpers.ts';

const capErr = () => Object.assign(new Error('too many connections for role "axion"'), { code: '53300' });

describe('c98 H14c-1: no test hook in src/db.ts, fault injection through the acquireHook option', () => {
  it('src/db.ts has no VITEST check, no AXION_TEST env read and no fs import', () => {
    const t = readFileSync(join(__dirname, '../src/db.ts'), 'utf8');
    expect(t).not.toMatch(/VITEST|AXION_TEST|appendFileSync|node:fs/);
  });
  it('acquireHook failing the first 2 attempts: the retry hides it (2 warns), pool.query succeeds', async () => {
    const warns: unknown[] = [];
    const pool = makePool(TEST_DB(), undefined, 2, (i) => warns.push(i), { acquireHook: (n) => { if (n <= 2) throw capErr(); } });
    try { expect((await pool.query('select 1 as n')).rows[0].n).toBe(1); expect(warns.length).toBe(2); } finally { await pool.end(); }
  });
  it('with retry: false the same fault surfaces as 53300 (the flake)', async () => {
    const pool = makePool(TEST_DB(), undefined, 2, undefined, { retry: false, acquireHook: (n) => { if (n <= 1) throw capErr(); } });
    try { await expect(pool.query('select 1')).rejects.toMatchObject({ code: '53300' }); } finally { await pool.end(); }
  });
  it('connectClient takes the same options', async () => {
    const warns: unknown[] = [];
    const c = await connectClient({ connectionString: TEST_DB() }, (i) => warns.push(i), { acquireHook: (n) => { if (n <= 2) throw capErr(); } });
    try { expect((await c.query('select 1 as n')).rows[0].n).toBe(1); expect(warns.length).toBe(2); } finally { await c.end(); }
  });
  it('production default: a 10-connection pool, with no option and no env knob', () => {
    setPoolDefaults({}); // what production has: no test defaults
    const p = makePool(TEST_DB()); try { expect((p as unknown as { options: { max: number } }).options.max).toBe(10); } finally { void p.end(); applyTestDefaults(); }
  });
});

describe('c98 H14c-2: a throwing callback of pool.connect(cb) is not an unhandled rejection', () => {
  it('it is rethrown on process.nextTick as an uncaught exception, like pg-pool', async () => {
    const pool = makePool(TEST_DB(), undefined, 1);
    const saved = { u: process.listeners('uncaughtException'), r: process.listeners('unhandledRejection') };
    process.removeAllListeners('uncaughtException'); process.removeAllListeners('unhandledRejection');
    const uncaught: unknown[] = [], rejected: unknown[] = [];
    process.on('uncaughtException', (e) => uncaught.push(e)); process.on('unhandledRejection', (e) => rejected.push(e));
    try {
      const boom = new Error('callback boom');
      pool.connect((err, c, done) => { expect(err).toBeUndefined(); done?.(); throw boom; });
      await new Promise((r) => setTimeout(r, 300));
      expect(rejected).toEqual([]);
      expect(uncaught).toEqual([boom]);
    } finally {
      process.removeAllListeners('uncaughtException'); process.removeAllListeners('unhandledRejection');
      for (const l of saved.u) process.on('uncaughtException', l); for (const l of saved.r) process.on('unhandledRejection', l);
      await pool.end();
    }
  });
  it('a callback that does not throw still gets (undefined, client, done) once', async () => {
    const pool = makePool(TEST_DB(), undefined, 1);
    try {
      let calls = 0;
      await new Promise<void>((res, rej) => pool.connect((err, c, done) => { calls++; if (err) return rej(err); c!.query('select 1').then(() => { done?.(); res(); }, rej); }));
      expect(calls).toBe(1);
    } finally { await pool.end(); }
  });
});
