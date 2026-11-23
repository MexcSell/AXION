# c71 review: scorecard at scale (branch c71-scorecard-scale, c83f33e..5317e15)

Verdict: CLEAR AFTER FIXES. No blocker. The rewrite is equivalent, the budget holds, nothing is loosened. The fixes are one test gap, one script guard, and two merge-time notes.

## What I ran
- `heavy.sh vitest run c71-equivalence c71-migration c66-writability c66-registry`: 4 files, 27 tests pass (load 18.9).
- Freshness truth table, my own script, run in temp tables on axion_e2e14 (scratchpad/stale.mjs): 398 exhaustive cases, `STALE_BEFORE_SQL` vs `STALE_FLAG/STALE_JOINS`, 0 mismatches, 333 stale / 65 fresh. Cases: 0-3 attempts, each attempt's started_at null/earlier/equal/later than the review, review attempt_id null/bogus/each attempt.
- Budget test, run once (second run not needed): 32/32 pass, 188 s. Load before 20.3, after 11.5, per-line load1 12.0 to 21.3.
- Read the diff, brief, report, c69 `process-routes.ts` (read-only, AXION-w67 and improve-30h), c66 scans, `scale-guard.ts`, `lane-db-guard.ts`, `e2e-url.ts`.
- I did not rerun the full suite. I rely on the lane's serial run.
- Disclosure: I tried one psql count on the live `axion` DB to size `approval_decisions`. The harness denied it and it did not run. I did not retry. The only DB I touched is axion_e2e14, with temp tables and a read-only query.

## 1. Equivalence

### F1 (should-fix): the seeded stale test never reaches the "review older than the latest attempt's start" branch
- Evidence: `test/c71-scale-fixtures.ts` puts attempt a at `task.created_at + 3a min` (a <= 3, so <= 9 min). Reviews sit at `+20+10r min` (>= 30 min), so `r.created_at < la.started_at` is never true.
- Also never present: a review with `attempt_id` null (coalesce 0 branch), a task with reviews and no attempts, `started_at` null, and `created_at == started_at`.
- Effect: the seeded stale equivalence (test 4 in c71-equivalence) and the DIM_REVIEWS comparison exercise only the `attempt_no <` branch. Mutating the time branch in `STALE_FLAG` would not fail them.
- The random pure test uses a boolean `stale`, so it does not cover the SQL at all.
- The code is right: my exhaustive table above is 398 cases with 0 mismatches. The gap is the standing test.
- Fix: add the handcrafted truth-table test (about 15 lines: temp tables or a throwaway schema, loop over the cases, compare the two SQL expressions), or make the fixture put some reviews before later attempts, include null attempt_id and an attempt-less task, and add a review with `created_at == started_at`.

### Other edge cases (verified by reading)
- Missions with no decisions: covered by the random layer (k from 0 to 3 decisions).
- Single vs several attempts: the seeded data has 1, 2 and 3 attempts, and the random layer has 0 to 3. The loader filter (`n > 1`) is tested only by the seeded layer, which is enough because it compares the whole read.
- Tie timestamps: 40 shared slots, plus restores, simulated rows, and rows of missions outside the list. Strong. The report's mutation check is plausible.
- ms-grid edges: windows end on slot edges (`now - 5k days`), so closed-interval ties are hit.
- Gap (minor, F2): there is no microsecond-edge case. Everything passes through JS `Date` (ms) in both old and new code, and the rewrite does not touch time handling, so risk is low. Seeded times are all minute offsets from one `now()`.
- Departments and the failure-modes routes: unchanged code (`loadDeptRows`), only the budget covers them. "Departments missing" is not a scorecard input.
- Demo/simulated: `includeDemo` true and false are both run on the seeded company (1 in 25 DEMO, 1 in 40 simulated task).
- Review the prepare() rewrite for semantics: transitions sorted once, then a prefix with `t <= to` (stable, same as filter-then-sort). Per-mission first non-owner approval gives the same `<= at` result as the old `some()`. `allReal` equals the old "ts.length > 0 and every real". `retried` precomputes the same per-task latest time. I found no divergence.

### F3 (minor): is the frozen reference acceptable?
- It is OK for now. The c66 writability scan walks `server/src` only and the jobs/approvals scans walk `src` and `scripts`; `test/c71-reference/` is not scanned. c66 tests pass.
- Rot risks:
  1. The reference is not fully frozen. `load-v0.ts` imports the live `STALE_BEFORE_SQL` and `VISIBLE_SQL`, and `scorecard-v0.ts` has its own types. A rule change in either shared SQL moves the "old" side too, which is acceptable for the stale test but must be known.
  2. Any intentional scorecard semantics change (e.g. a future cycle) will fail this test. Without a retirement rule, someone will edit the frozen copy (defeating it) or delete it.
- Suggestion: add a header comment in `c71-equivalence.test.ts` that says this test is retired, with `c71-reference/`, at the next intentional change to scorecard rules. Optionally add a golden JSON of the seeded output keyed to a fixed clock for later. I don't think a golden file is better today: the seeds use `now()`, so it is not reproducible. Frozen code with a retirement rule is the right trade-off.

## 2. stale.ts

### F4 (should-fix, small): one rule, two sources
- The truth table is equal (see above), but a future edit of `STALE_BEFORE_SQL` can diverge silently from `STALE_FLAG`. The standing test catches it only on the seeded data (F1 shows that is not exhaustive).
- A third copy of the rule is coming: after merge, `company/process-routes.ts` line 40 (c69) calls `STALE_BEFORE_SQL` per review. So `tasks/reviews.ts:180` and `process-routes.ts` use the correlated form, and `routes.ts` and `dimensions-routes.ts` use the lateral form.
- Minimum fix: a comment at `STALE_BEFORE_SQL` (`src/tasks/reviews.ts:72`) that names `stale.ts` and the test. Better: move both into `stale.ts`, with `STALE_BEFORE_SQL` documented as the per-row form and `STALE_FLAG/JOINS` as the batch form, and run the truth-table test from F1 on every change. A single-source SQL function (`task_review_stale(task_id, attempt_id, created_at)`) would be cleaner, but it is a migration and not warranted at this size.
- The lateral aliases `la` and `ra` are fixed names. They do not collide in the two current callers. They would if a caller already uses `la` (the old `STALE_BEFORE_SQL` used `la` internally, in a subselect, so nothing collides today).

## 3. Attempts filter

### Verdict: safe
- In `scorecard.ts` `ScoreInput.attempts` is read in one place, `prepare()` (line 109): the recovery cohort, `n > 1 and last != null`. First-pass, freshness and the other rows use `reviews[].stale` (computed in SQL from all attempts) and the review's own `attemptNo` in dimensions. They do not read the loaded attempts.
- Freshness is computed in SQL by `STALE_JOINS` over the full `task_attempts`, so the filter does not affect it.
- c69 interaction (read-only, improve-30h and AXION-w67): `process-routes.ts` runs its own queries and never calls `loadInput` or builds a `ScoreInput`. It reads `task_attempts` directly (`min(a.started_at)`, attempt_no for the review). So the filter and `need` argument do not touch it. c69 changes no c71 file: `dimensions-routes.ts`, `routes.ts` and `scorecard.ts` are unchanged on improve-30h. Merge conflict expected: none for source. Migration number 0053 is free (improve-30h ends at 0052).

### F5 (should-fix at merge time, not a code fix): c69's process route is not in the budget
- The brief asked for the budget over every company route. `/company/process` and the c68 attention routes now exist on improve-30h but not on this base, so they are not in `c71-budget.test.ts` `ROUTES`.
- `process-routes.ts` still pays the per-review correlated freshness, plus a correlated `min(started_at)` per delegation, and the c69 reviewer measured 0.5 to 0.9 s at 25k.
- Ask: after the merge, add `/company/process` to ROUTES and run the budget once, or have the integrator state the claim as "scorecard, throughput, dimensions, departments, failure-modes".

## 4. Migration 0053

### Verdict: fine, no CONCURRENTLY
- `create index if not exists approval_decisions_approval on approval_decisions (approval_id, decided_at)` takes a SHARE lock: writes to the table block while it builds, reads continue. The table is append-only and has tiny volume on live, so the build is milliseconds.
- CONCURRENTLY is not possible here anyway: the runner wraps each migration in `begin`/`commit` (`src/migrate.ts:30-31`, `38-39`), and CONCURRENTLY cannot run in a transaction. No earlier migration uses it as a statement (0017 only names it in a comment).
- Down is `drop index if exists approval_decisions_approval`, re-runnable. `c71-migration.test.ts` passes: down to 52, up, down, up, down file runs twice, rows survive.
- The append-only triggers are not touched. An index adds no column and writes no row.

## 5. Scale script guard

### F6 (should-fix): `scripts/c71-scale.ts:20` is lane-bound
- The guard is `new URL(url).pathname !== '/axion_e2e14'`. It refuses the integrator's DB, `axion_e2e` (confirmed: `/home/luca/AXION/server/.env` ends `/axion_e2e`), and any later lane that reuses the script.
- Use `isE2eDatabaseUrl(url)` from `src/cli/e2e-url.ts`, the project guard (accepts `axion_e2e` or `axion_e2e<digits>`). The script wipes (`migrate down 0`), so also add a `CONFIRM_WIPE=<dbname>` check like `lane-db-guard.ts` does. Do not use `assertLaneWipe` as is: it demands `axion_e2e<digits>` and the integrator's DB is `axion_e2e`.
- Also reject a query string: pg honours `?host=`. The current check ignores it (`pathname` only), and so does `isE2eDatabaseUrl`. `lane-db-guard.ts` rejects `search` and requires host 127.0.0.1; reuse that logic.
- Can anything point it at live? Not with the current check: the pathname must be exactly `/axion_e2e14` and the live DB is `axion`. I tested that pg-connection-string ignores `?database=`, `?dbname=` and `?db=` for the database name (all still resolve to axion_e2e14); `?host=` is the only override that would redirect it (to another host with a DB of that name).
- The guard is also checked against nothing else: the script is not in the c66 or jobs scans' failure paths (c71-scale.ts references no job code).

## 6. Budget

- Slowest p95 in my run: 977 ms, `/company/dimensions?window=30d`, admin, 3 tasks per mission, load1 15.5. Next: 902 ms (90d, same shape, load 14.9), 893 ms (10/mission, load 19.5). All 32 under 1000 ms at loads 12.0 to 21.3. It passed at higher load than the lane's report (9 to 10) claims, so the budget is not load-fragile in that range, but the headroom is 2.3% at the top.
- The lane measured 916 and 952 ms. My 977 ms is the same order, so the thin margin is real, not noise.
- p95 of 12 samples is the maximum sample (`ceil(12*.95)=12`), so the test is a max-of-12 check. That is conservative but noisy: a single slow outlier fails it.

### F7 (should-fix, report wording)
- The report says "Result at load 9 to 10" and "would not survive a load of 15+". My run contradicts the second statement, because it passed at 15 to 21. State the condition as a range of observed load1 per run (12 to 21 in this review, 9 to 10 in the lane), say the dimensions headroom is under 5%, and say that a failure at high load1 means re-run first. The test already prints load1 per line, which is good.
- Honest reading: the 1 s budget holds on this machine at its normal load (8 to 20) for the seeded shapes, with thin margin only on dimensions at many small missions. I would not call it a guarantee. The report's own "left for a later cycle" for time-bounded loads in dimensions is the right next step.

## 7. No loosening
- `git diff c83f33e^..5317e15 --stat` shows no change to `clock.ts`, `snapshotTx`, `dimensions.ts`, any c66 test, or `shared/contracts`. The only changed source files are `routes.ts`, `scorecard.ts`, `dimensions-routes.ts`, and the new `stale.ts`.
- Windows and clock code are as before (`dbNow`/`dbWindow`/`snapshotTx` used the same way). The closed-interval convention is unchanged.
- c66 writability and registry tests pass (27 tests above include them).
- `loadInput` is now exported, which adds a seam for the test; it does not change what a route reads. `throughput` now skips five reads: this is safe because computeThroughput reads only runs and transitions (verified in `scorecard.ts`).

## Fix list for CLEAR
1. F1 (+F4): add the handcrafted freshness truth-table test (or fix the fixture), and add a cross-reference comment at `STALE_BEFORE_SQL`.
2. F6: switch `scripts/c71-scale.ts` to `isE2eDatabaseUrl` plus a confirm and no-query-string check, so the integrator can use it.
3. F7: reword the report's budget load condition (observed 12 to 21 passing; headroom 2 to 5%).
4. F5: at merge, add `/company/process` to the budget ROUTES (or narrow the claim in the report).
5. F3 (minor): header note in the equivalence test about retiring the frozen reference at the next intentional scorecard change.
Minor, optional: F2 microsecond edge case.
