# c98 report: test-infrastructure follow-ups (H14c, M2c)

Lane w96, branch `c98-test-infra`, base 4156c39. Server only, no migration, no `web/` change. DB axion_e2e17. Every vitest run went through heavy.sh.

## Item 1, H14c-1: fault hook out of src (PASS)
`src/db.ts` no longer has a VITEST check, an `AXION_TEST_*` read, `node:fs` or a fault branch (a test asserts this by reading the file). `makePool(url, schema, max, warn, opts)` and `connectClient(cfg, warn, opts)` take `PoolOpts { acquireHook(attempt), retry, max }`. `setPoolDefaults()` lets the vitest setup file (`test/setup.ts`, via `setupFiles`) apply the old env knobs (`AXION_TEST_POOL_MAX`, `AXION_TEST_FAULT_53300=K`, `AXION_TEST_NO_RETRY=1`, `AXION_TEST_FAULT_LOG`) to every pool without touching production. Production never calls it: default pool max 10, retry on.
- RED (commit before the fix): `test/c98-db-hooks.test.ts` 6 of 7 failed.
- GREEN: c98 + c93 files 12/12 pass.
- Five flakes, K=2, serial, each file run in one command (load average 4-6):
  - retry off (RED): 5 of 5 files failed, 43 tests failed, 165 skipped, first error `too many connections for role "axion"`; 46 faults injected.
  - retry on (GREEN): 5 of 5 files pass, 208/208 tests, 404 faults hidden by the retry.
  - Files: auth, site-grants, c86-record, playbooks, jobs.
- The env-driven real-pool tests of c93 moved into the c98 file as option-driven tests (same assertions: 2 warns, failed query not retried is kept in the unit test, retry off gives 53300, connectClient retries). Nothing was loosened.

## Item 2, H14c-2: callback rethrow (PASS)
A throwing `pool.connect(cb)` callback is caught and rethrown on `process.nextTick` (uncaught exception, as in pg-pool). RED: the callback error landed in `unhandledRejection`. GREEN: `rejected == []`, `uncaught == [boom]`. A non-throwing callback still gets `(undefined, client, done)` exactly once.

## Item 3, M2c remaining scanner items (already done)
M2c-1 (comma join after a sub-select, `extract(epoch from t.col)`) was fixed in c92 (8aefd141). `test/c83-registry-columns.test.ts` covers both (lines 140-155, including the fail-closed `nosuch` cases); 14/14 pass here. M2c items 2-4 are not scanner items (sample_ref lock, counters, UI text) and are untouched.

## Files
server/src/db.ts, server/src/config.ts (comment), server/vitest.config.ts, server/test/setup.ts (new), server/test/c98-db-hooks.test.ts (new), server/test/c93-conn-retry.test.ts.

## Full serial run
Tree 8b1cc941 plus the report commit, `heavy.sh npx vitest run --maxWorkers=1 --no-file-parallelism`, started 12:41Z, finished 12:53Z (about 11.5 min; an earlier attempt was cut off by my own `timeout 590`, not a failure): **189 files (188 passed, 1 skipped), 4412 tests passed, 36 skipped, 0 failed.** `tsc --noEmit` clean. Load average at start about 6.

## Concerns
- `setPoolDefaults` is a module-level mutable in src. Inert unless called; only `test/setup.ts` calls it.
- Direct `buildApp()` calls in tests get the hook and the pool size through these defaults, not through Config.
