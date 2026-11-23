import { appendFileSync } from 'node:fs';
import { setPoolDefaults } from '../src/db.ts';

/**
 * c98 (H14c): the test knobs that used to live in src/db.ts. Runs once per test file (vitest setupFiles).
 *  - AXION_TEST_POOL_MAX (vitest.config.ts): default pool size of every test pool; a test that needs more passes its own max.
 *  - AXION_TEST_FAULT_53300=K: the first K connection attempts of every pool / connectClient call throw a real-looking 53300, so the retry can be
 *    proven without holding extra real connections on the shared role. AXION_TEST_NO_RETRY=1 turns the retry off (shows the same runs failing).
 *  - AXION_TEST_FAULT_LOG=<file>: each injected fault is appended, so a run can count them (one fault = one retry with the retry on).
 */
const k = Number(process.env.AXION_TEST_FAULT_53300 || 0);
const log = process.env.AXION_TEST_FAULT_LOG;
const max = Number(process.env.AXION_TEST_POOL_MAX || 0);
export function applyTestDefaults(): void {
  setPoolDefaults({
  ...(max > 0 ? { max } : {}),
  ...(process.env.AXION_TEST_NO_RETRY === '1' ? { retry: false } : {}),
  ...(k > 0 ? {
    acquireHook: (n: number) => {
      if (n > k) return;
      if (log) try { appendFileSync(log, `${process.env.VITEST_POOL_ID ?? ''} fault ${n}\n`); } catch { /* best effort */ }
      throw Object.assign(new Error('too many connections for role "axion"'), { code: '53300', severity: 'FATAL' });
    },
  } : {}),
  });
}
applyTestDefaults();
