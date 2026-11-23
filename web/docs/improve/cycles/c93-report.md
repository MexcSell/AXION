# c93 report: connection-cap resilience (H14b)

Lane w91, branch `c93-conn-cap`, base 4860e96. Server only, no migration, no `web/` change.
All vitest runs used `TEST_DATABASE_URL` overridden to `axion_e2e4` (lane-only; stock vitest uses the shared `axion_test`), serial: `heavy.sh npx vitest run --maxWorkers=1 --no-file-parallelism`. The sampler (`server/scripts/conn-peak.mjs`, one own connection, SQL-filtered to `datname='axion_e2e4' and usename='axion'`, 50 ms) never touched `axion`.

## Item 1: measure (PASS)
Baseline (e366a81 tree, load 6.05): 3656 tests green, 11.5 min, **peak 15 connections**.
Top 5 by peak during the file's window (approximate, matched by timestamps): c39-ledgers 15, tenant/vis-mutants 14, playbooks 13, review-fixes 12, tenant/real 11 (jobs 11).
Why: each app = pool max 10 + one LISTEN client outside the pool; `makeSchema` adds a fixture pool (max 4) and two short admin clients; stress tests open their own pools (jobs 12 and 8, approval-binding 8).

## Item 2: bound test pools (PASS, modest effect)
One place: `vitest.config.ts` sets `AXION_TEST_POOL_MAX=3`; `makePool` uses it as default only under vitest. `Config.dbPoolMax` overrides per app. Fixture pool in `helpers.ts` is 3 (via `makePool`). Why 3: tests are mostly sequential injects; peak busy per file is a few; the LISTEN client is extra. Explicit exceptions: jobs stress 12 and 8 claimers (commented), approval-binding 8. Production default stays 10.
**Peak after: 11, 12, 11** (3 runs) versus 15 before. The gain is real but small: LISTEN clients, two pools per file, and the explicit stress pools dominate the rest. No `timeout exceeded when trying to connect` anywhere.

## Item 3: retry (PASS)
`acquireWithRetry` in `src/db.ts`: 5 tries, backoff 50-100, 100-200, 200-400, 400-800 ms (random half-jitter), stop if waits would exceed 3 s, then the original error is thrown. Only SQLSTATE 53300 or message "too many connections". Wraps `pool.connect` (promise and callback forms, so `pool.query` is covered) and `connectClient` (standalone clients). Never retries a query, a transaction or another code. Each retry logs at warn (`app.log.warn` in `buildApp`).
**Production gets this too.** It is safe because a refused connection has run no SQL, so a retry cannot repeat a write, and the wait is bounded.
Unit tests (`test/c93-conn-retry.test.ts`, 9 tests): fake pool 53300 twice then success; other codes (28P01, 57P03, timeout) not retried; message-only match; bounded (5 tries, under 3 s); a failing query is not retried (connects stay 1); real-pool fault tests; production default max 10.
Commits: items 2 and 3 are in one commit (975a4c9) because both change `makePool`.

## Item 4: fault injection (PASS)
Test-only, active only under vitest: `AXION_TEST_FAULT_53300=K` makes the first K acquisitions of every pool/client throw a 53300 error; `AXION_TEST_NO_RETRY=1` disables the retry. No extra real connections held. K=2, each file run alone:

| file | RED (no retry) first error | GREEN (retry) | retries seen |
|---|---|---|---|
| auth | 22/22 fail, `too many connections for role "axion"` | 22/22 pass | 176 |
| site-grants | 21/21 fail, same | pass | 168 |
| c86-record | suite fails in setup, same | 11/11 pass | 8 |
| playbooks | suite fails in setup, same | 78/78 pass | 8 |
| jobs | suite fails in setup, same | 76/76 pass | 44 |

Note: RED surfaces as the 53300 text from makeSchema/admin connect (the `admin connect failed` wrapper appears when the app pool is the one refused).

Three consecutive full serial runs from committed tree 975a4c9 (3665 tests each, 0 failures, 0 failed suites):

| run | time (UTC) | load at start | peak |
|---|---|---|---|
| 1 | 09:38-09:49 | 8.59 | 11 |
| 2 | 09:49-10:00 | 5.41 | 12 |
| 3 | 10:00-10:11 | 3.64 | 11 |

No test failed, so there is no failure to name. tsc clean.

## Files
`server/src/db.ts`, `src/app.ts`, `src/config.ts`, `vitest.config.ts`, `scripts/conn-peak.mjs`, `test/helpers.ts`, `test/jobs.test.ts`, `test/approval-binding.test.ts`, `test/eval-evidence-db.test.ts`, `test/c93-conn-retry.test.ts`.

## Concerns
- Peak fell only 15 to about 12; the retry, not the bound, is the real protection.
- Production now carries a fault-injection path in `db.ts`, gated on `process.env.VITEST`; it also appends to `AXION_TEST_FAULT_LOG` when set under fault.
- I ran one single-file vitest without heavy.sh (site-grants, 36 s, one worker) during debugging.
- Suggestion for heavy.sh (not edited): none needed.
