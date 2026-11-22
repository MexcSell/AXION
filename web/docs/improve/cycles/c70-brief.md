# c70 brief: server hardening bundle (H11b, H14, E1d)

**Lane:** w68 (`/home/luca/AXION-w68`, branch `c70-hardening`), from improve-30h at the commit that adds this brief. Ports 11890–11893. E2E DB **axion_e2e5** (reused). Migration **0052** only if needed.
**Source:** BACKLOG rows H11b, H14 and E1d. Read them in full, and read the cycle reviews they cite: c54, c53 and c61.

## Items (each test-first, each its own commit)
1. **H11b, remaining app-clock bounds.**
   - `agents/reliability.ts` `reliabilityWindow(new Date())` is a real window bound. Move it to c54's `dbWindow` in `company/clock.ts`.
   - In `grants/routes.ts`, `issued_at` and `expires_at` are written from the app clock and compared to it. Use DB `now()` both for writing and for comparing.
   - `approvals/routes.ts` computes the approvalDto expiry state on the app clock. Compare it in SQL instead.
   - RED: a skewed fake app clock (the c54 method) shows each bug.
   - Presentation-only uses (notifications agoMin, mission timestamps) can stay; list them in the report.
   - Also fix the `loadEvaluations` N+1 on dimensions reads, if it's cheap. Show the query count before and after.
2. **H14, the connection footprint of `jobs.test.ts`.** The test "20 parallel claimers over 50 jobs" opens 20 clients and fails under the shared 45-connection role cap.
   - Bound its own connections, for example with a pool of at most 8. It must keep proving "each job claimed exactly once" under real concurrency: show the race is still exercised, e.g. by counting lock waits or contention.
   - Do the same for `approval-binding` "20 concurrent consumes".
   - Never weaken what either test proves.
3. **E1d, holdout shopping gaps** (c53 and c61 reviews).
   - Key the holdout limit on **dataset content hash** too, so the same content under a new dataset id is caught.
   - A re-grade diff by the proposal's author on the **base** run is refused in the DB, not only ignored by the loader.
   - `eval_canon_config` collapses all Unicode whitespace (tab, NBSP), drops empty-string skills, and NFC-normalises skill names.
   - The `dev_holdout_reuse` repeat exemption applies only to short inputs (keep c53's threshold rule).
   - Keep a test with an explicit `grader: null` legacy run.
   - **Not in scope:** variant-B shopping and re-created base versions. Record them as still open.
   - RED: each reviewer probe named in the backlog row.

## Pass threshold
- Items 1–3 RED → GREEN, with no test loosened.
- Full vitest **in one parallel run** (that's H14's point), plus a serial run, with every failure named. tsc.
- api-c47, api-c05, api-c58, api-c36 and api-stage6 pass. Migrate down/up once if you add a migration.

## Report
`cycles/c70-report.md`. Follow the LANES.md Finishing rule.
