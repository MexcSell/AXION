# c45 report: durable job records with a lease state machine (J1, records only)

Lane w44, branch `c45-job-leases`, migration 0035. Execution stays disabled.

## What was built
- **Migration 0035 `system_jobs`** (`server/migrations/0035_system_jobs.up/down.sql`): columns as briefed (plus `seq` for oldest-first order, `finished_at`, `updated_at`), closed kind list (`noop.test`), `payload_ref` limited to 512 characters of `[A-Za-z0-9_.:/@#=+-]` (never executable), unique `(tenant_id, kind, idempotency_key)`, CHECK constraints (leased needs owner, expiry, heartbeat and token above 0; finished iff `finished_at`). The `system_jobs_guard` trigger enforces: a finished job never changes; identity columns never change; counters (attempt, token, cancel flag) never go down; queued may only go to leased (attempt and token +1) or canceled; leased may go to leased (heartbeat), succeeded/failed (lease must be unexpired by `now()`), or queued/dead/canceled (token +1; queued needs attempts left and no cancel request; dead needs attempt = max_attempts; canceled needs a cancel request). DELETE and TRUNCATE are refused (DELETE allowed only under the `axion.purge_demo` flag, like 0007/0008).
- **`server/src/jobs/machine.ts`** (pure edges, `nextOnFail`, `nextOnReclaim`, refusal reasons), **`store.ts`** (enqueue, claim with `FOR UPDATE SKIP LOCKED` oldest first, heartbeat, complete, fail, acknowledgeCancel, reclaimExpired, requestCancel, getJob; every time comparison is SQL `now()`), **`summary.ts`** (read-only counts).
- **`GET /operations/queues`** in `server/src/ops/routes.ts`: admin only, tenant scoped, counts by kind and status, oldest queued age, expired leases, `execution: disabled`, `recordsOnly: true`. No other route touches jobs.
- **UI**: `web/src/features/ops/JobRecords.tsx`, shown on System Operations > Queues for administrators in api mode; `?` help `ops.jobRecords` (in `help/pages/stage5.ts`), empty state, "Records only: no workers run in this build", read-only chip.
- **Audit** through the plain `audit()` helper (`job.enqueue`, `job.cancel`, `job.dead`; actor `system` for dead letters). The c31 audit chain is NOT in this tree: the integrator should confirm these calls still go through the chained helper after merge (same `audit(c, {...})` signature, called inside the job's own transaction).
- No dialog ids were added (DL-96/97 unused).

## Evidence
- Test-first honesty note: the test file and the implementation were written in the same sitting and the first full run happened with both present, so there is no pure RED for the store tests. What was RED on first run: 8 of 63 (the route tests, until `GET /operations/queues` existed; the `payload_ref` check, which failed on Postgres' 255 repetition limit in my first regex and was fixed by a separate length check; and two test-harness mistakes). Afterwards a mutation (dropping the token predicate from the lease WHERE clause) turned 23 tests red; restoring it turned all 63 green.
- `server/test/jobs.test.ts`: **63 tests, all green**. Server `tsc --noEmit` clean; full vitest suite **38 files, 649 tests green**.
- Web `tsc --noEmit` clean. `web/scripts/api-c45.mjs`: **10/10 PASS** (admin empty state, `?` help, counts, no controls, fits 1366x768 with `main` overflow 0, API 200 for admin, 403 for a member, member sees no panel, no page errors).
- Screenshot: `web/docs/screenshots/improve-c45-job-records-dark.png`.

## Pass threshold
- **>= 35 server tests incl. 20 claimers over 50 jobs: PASS.** 63 tests. The concurrency test claims 50 jobs with 20 parallel claimers, checks the table (all `leased`, attempt 1, token 1, owner equals the one claimer that got it, no job in two claimers' lists), then expires all leases, races 5 reclaimers (each job reclaimed once) and 20 claimers again (generation 2: attempt 2, token 3, once each).
- **Stale token cannot heartbeat, complete or fail after a reclaim (fencing): PASS** (heartbeat/complete/fail tests, including after a second worker claimed).
- **Same idempotency key returns one row: PASS** (sequential, parallel x8, and across audit).
- **Expiry uses DB time: PASS.** A test shifts the Node `Date` a day ahead and a day behind; results are unchanged. A static test also forbids `Date.now`/`new Date().getTime` in `store.ts`.
- **Illegal transitions refused by the trigger through raw SQL: PASS.** Includes an exhaustive (from, to) matrix that checks the trigger refuses every edge the pure machine calls illegal. Note: the matrix proves "machine-illegal implies trigger-refused"; it does not prove the reverse for every legal edge (those are exercised by the store tests).
- **max_attempts leads to dead: PASS** (via fail and via reclaim, with `job.dead` audit rows).
- **Cancel works in both states: PASS** (queued: canceled at once; leased: flagged, visible on heartbeat, then acknowledged or reclaimed to canceled).
- **Cross-tenant reads and writes refused: PASS** (get, heartbeat, complete, fail, cancel, acknowledge all `not_found` and the row is unchanged; claim with another tenant filter returns nothing).
- **`/operations/queues` 403 for members: PASS** (also 401 unauthenticated; a second test checks no POST/PUT/DELETE route exists).
- **No new long-running process, interval or timer; nothing calls claim outside tests: PASS.** Static tests scan `server/src`: nothing outside `src/jobs/` imports `jobs/store` or names any store function, `src/jobs/` contains no `setInterval/setTimeout/child_process/worker_threads/.listen(`, and the ops route has no write handler. The grep is a test, so it keeps running in CI.
- **Server tsc plus full vitest green: PASS** (tsc clean; 38 files, 649 tests).
- **verify-all 10/10: PASS** (`ALL 10 STEPS PASSED`, own OUT dir, dev server on 9490).
- **`web/scripts/api-c45.mjs` covers the ops view and fits 1366x768: PASS.** 10/10 checks run exactly as `./scripts/api-e2e.sh api-c45.mjs` (ports 9492/9493); `main` overflow 0 at 1366x768; admin sees counts, member gets 403 and no panel.
- **Dialog ids: n/a** (none added).

## Concerns for the integrator
- **Not strictly test-first** (see the note above).
- **`failed` status** is reachable only through `failJob(..., { retryable: false })`, which the brief did not describe (it only has retry then `dead`). I kept the status because the brief lists it.
- **Extra operation** `acknowledgeCancel` (the holder's way to end a flagged lease) is not in the brief's list; without it a flagged job could only end by lease expiry or by a failure.
- **Tenant scope of workers**: `claimJob` and `reclaimExpired` span all tenants when `tenantId` is omitted (worker-level, by design). Every id-addressed operation requires the tenant.
- **Audit**: plain `audit()` helper, because the c31 chain is not in this tree. Confirm after merge that it chains.
- **Migration and clearDemo**: `system_jobs` rows are not demo rows, so `clearDemo` never touches them (tested); DELETE is only allowed under `axion.purge_demo`. No raw inserts into `system_jobs` exist in scripts or fixtures other than the api-c45 e2e fixture.
- **Commit trailer**: used the `Co-Authored-By: Claude Opus 5.5` line the lane rules require; the session model is actually Sonnet 5.5, so the controller may want to adjust.
- **Tests make leases expire by raw UPDATE** of `lease_expires_at` (the guard allows it on a leased row), plus one real 0.3 s lease; `leaseSeconds` accepts 0.05 to 3600 so tests can be short. A worker should use whole seconds.

## Fix round (review verdict PASS-WITH-FIXES)
Work was test-first: the 13 new tests were written and run against the unfixed code (RED: 10 failed, 66 passed of 76; the stress test was already green, which is its finding: no double holder before or after). Then fixed (GREEN: 76/76 in `jobs.test.ts`; full server suite 38 files, 662 tests).

| # | Fix | Where | Test |
|---|---|---|---|
| 1 | leased -> leased: only heartbeat, expiry and the cancel flag may change; expiry/heartbeat only while the lease is unexpired (DB `now()`) and only forward; a lease change may not touch `last_error`/`finished_at`. Tokens and attempts never decrease (already). | 0035 trigger | lease-edge tests |
| 1b | leased -> queued: allowed on an expired lease (reclaim), or on an unexpired lease only when a failure is recorded (`last_error` set). **Deviation from the controller's wording** ("only when expired or cancel requested"): a holder's own retry after `failJob` must release an unexpired lease, and cancel-requested jobs never go to queued (they go to canceled), so I required a recorded failure instead. Residual: raw SQL that sets any `last_error` can still release an unexpired lease; the token still bumps. | trigger | "released only with a recorded failure" |
| 2 | INSERT guard trigger: a row is inserted queued, attempt 0, token 0, no owner/expiry/heartbeat, no cancel flag, no result. | `system_jobs_insert_guard` | 7 raw-insert probes |
| 3 | queued -> canceled requires `cancel_requested = true`. | trigger | raw update test |
| 4 | Token that is not a safe non-negative integer (1.5, NaN, Infinity, 2**70, -1, '1', null, undefined, {}) returns `stale_token` without any SQL (test passes a db that throws on touch). | `store.ts` | token test |
| 5 | `claimJob` and `reclaimExpired` require `tenantId` or `allTenants: true`; neither, an empty tenant, `allTenants: false` or both all throw. | `store.ts` | fail-closed test |
| 6 | `reclaimExpired` takes `limit` (default 100, 1..1000); the rest stays for the next call. | `store.ts` | batch test (5 expired, limit 2 then 3) |
| 7 | Static tests now scan `src` and `scripts`, catch dynamic `import(`/`require(` of jobs, timers, `setImmediate`, `pg_sleep`, `while(true)`/`for(;;)`/`sleep` in `src/jobs`, and any `.post/.put/.patch/.delete/.route/.all/...(` registration whose path mentions jobs or queues (the only allowed one is the GET in `ops/routes.ts`). The test comment says plainly these are greps, not proofs. | `jobs.test.ts` | 4 static tests |
| 8 | Comment on `claimJob`: `null` under contention means try again, not "queue empty". | `store.ts` | n/a |
| 9 | The old mock Queues panel now says "Prototype sample data (DEMO): not the job records" next to its existing DEMO tag. | `Operations.tsx`, `api-c45.mjs` check 11 | e2e |

Also: a heartbeat with a shorter lease never shortens the expiry (`greatest(...)`), because the trigger now refuses a backward move. An empty failure message is stored as `unspecified failure`. Down migration drops the insert-guard function too.

Consequence for tests: the guard now refuses moving a live lease's expiry backward, so tests age a lease with the trigger switched off for one statement (`rawAge`, test-only `alter table ... disable trigger` inside a transaction). That is the one intentional back door and it is only in tests.

Stress test added (own, not the reviewer's): 6 workers (complete / fail / heartbeat / outlive their 0.05 s lease), 2 reclaimers with batch limit 5, a random canceller, 24 jobs, 2.5 s. Asserts no duplicate (job, token) claim, no success returned to a non-owner, `lease_token >= attempt`, leased iff owner. Green.

Checks: server tsc clean; web tsc clean; server vitest 38 files / 662 tests green; `api-c45.mjs` 11/11 (new DEMO-label check); verify-all result below.
verify-all: ALL 10 STEPS PASSED (after the fixes).
