# c45 brief: durable job records with a lease state machine (Wave 4 · J1, records only)

**Lane:** w44 (from improve-30h at the current tip). Ports are 9490 (dev), 9491 (preview) and 9492–9493 (e2e). E2E DB **axion_e2e17**. **Migration 0035.**
**Source:** spec §10 ("Jobs use lease/heartbeat, idempotency key and cancellation token"), the `system_jobs` table in the spec's data model, and the Stage 5 scope (run/task state machines, durable work). Like Stage 5, execution stays **disabled**. No worker process is started, nothing runs a job's work, and there is no kind that does anything outside the DB.

## Hypothesis
A DB-backed job record can stay correct under crashes and concurrent claimers if it combines:
- lease plus heartbeat, using DB `now()` only;
- a monotonic **fencing token** per claim;
- an idempotency key unique per tenant and kind;
- cancellation;
- a dead-letter state after max attempts.

Then a stale worker (expired lease, or reclaimed) can never complete, fail or extend a job it no longer owns, and two claimers never hold the same job. All of this can be proven with tests before any worker exists.

## Build (test-first)
1. **Migration 0035, `system_jobs`:**
   - **Columns:** id, tenant_id, kind (a closed CHECK list: `noop.test` only, for now), payload_ref (opaque text ≤ 512, never executable), status (`queued|leased|succeeded|failed|canceled|dead`), attempt, max_attempts (1–10), lease_owner, lease_token (bigint, monotonic), lease_expires_at, heartbeat_at, cancel_requested, idempotency_key, created_by, timestamps, last_error (bounded text).
   - **Uniqueness:** (tenant_id, kind, idempotency_key).
   - **Trigger guard on illegal transitions:** a terminal state is final, and `leased` requires an owner, token and expiry. Follow the repo's existing state-machine pattern. Down migration included.
2. **A pure `server/src/jobs/machine.ts`** (transitions and reason codes) plus `server/src/jobs/store.ts` (SQL), with these operations:
   - **enqueue:** idempotent; it returns the existing row for the same key.
   - **claim(owner, kinds, leaseSeconds):** `FOR UPDATE SKIP LOCKED`, oldest first. The token is incremented on every claim.
   - **heartbeat(id, token):** extends the lease only if the token matches and the lease is unexpired.
   - **complete/fail(id, token):** fail retries until max_attempts, then `dead`.
   - **reclaimExpired():** expired leases go back to `queued` (or `dead`), and the token is bumped.
   - **requestCancel:** a queued job becomes `canceled` at once; a leased job is flagged so the holder sees it on heartbeat.

   All time comparisons happen in SQL with `now()`.
3. **Read-only ops view:** `GET /operations/queues`, admin only, tenant-scoped: counts by kind and status, the oldest queued age and expired leases. Show it on System Operations (Workers/Queues area) with `?` help, an empty state and "records only: no workers run in this build". **No client route enqueues or claims.** Only tests and an internal function do.
4. **Audit:** enqueue, cancel and dead-letter write audit rows through the existing audit helper (the c31 chain, if it is in your tree; otherwise the plain helper, with a note for the integrator).

## Pass threshold (fixed)
- **≥ 35 server tests.** They must include a concurrency test in which 20 parallel claimers race over 50 jobs. Every job is claimed exactly once per lease generation, with no double holder; check the table, not only the results.
- A stale token can't heartbeat, complete or fail after a reclaim (fencing).
- The same idempotency key returns one row.
- Expiry uses DB time: a test skews the Node clock and the result doesn't change.
- Illegal transitions are refused by the trigger even through raw SQL.
- max_attempts leads to `dead`.
- Cancel works in both states.
- Cross-tenant reads and writes are refused.
- `/operations/queues` returns 403 for members.
- No new long-running process, interval or timer starts in the API. A test or grep proves nothing calls claim outside tests.
- Server tsc plus the full vitest suite green. verify-all 10/10. A new `web/scripts/api-c45.mjs` covers the ops view (admin sees counts, member gets no access) and fits 1366×768.
- Dialog ids, if any: DL-96..DL-97.

## Report
`cycles/c45-report.md`.
