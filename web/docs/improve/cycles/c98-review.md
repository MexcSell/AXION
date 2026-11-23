c98 review: CLEAR (two minors)
1 (minor) c93 assertions weakened: the pool-level "failed query (select 1/0) is not retried: acquired==1, warns unchanged" and the promise-form pool.connect() check were dropped; the report says "kept in the unit test", but that test (c93 "any other error code is not retried") covers acquireWithRetry only. Fix: re-add the select 1/0 assertion to c98-db-hooks.test.ts.
2 (minor) Old fault log counted retries ("retry N"); new one logs faults. Equivalent with retry on; cosmetic.
Production safety OK: src/db.ts has no VITEST/AXION_TEST/fs/fault branch (grep + test). setPoolDefaults is called only from test/setup.ts and the c98 test; no src caller. acquireWithRetry is unchanged, so the retry policy is the same. Pool max stays 10 (app.ts passes cfg.dbPoolMax, undefined -> 10; main.ts goes through buildApp; CLIs pass explicit max).
Rethrow OK: then(onOk, onErr) means a throwing cb is not re-called by the rejection handler (no double callback); the error goes to nextTick, so it is an uncaught exception, not swallowed.
Isolation OK: setupFiles runs per file in forks; the module-level default is per process. The c98 test resets it via applyTestDefaults.
M2c OK: c83 tests lines 147-156 cover extract() and fail-closed cases; the comma-join-after-sub-select case is at ~83-155.
Scope OK: server only, 7 files, no migration. tsc clean; c98+c93+auth: 34/34 pass.
