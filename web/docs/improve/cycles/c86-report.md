# c86 report: forecast ledger, first slice (R5-7)

Lane w84, branch `c86-forecast-ledger`, from 2c3b7d5. Server and shared/contracts only. One migration: **0059_forecasts** (independent of 0058).

## What was built
- `forecasts` table (0059): append-only, four guards plus the `axion.purge_demo` exception, one row per (task, forecaster), probability numeric(3,2) in 0.01..0.99, `made_at` default `now()`. No outcome, score or resolved column.
- Routes: `POST /tasks/:id/forecasts` (any person who can see the task), `GET /me/forecasts`, `GET /users/:id/forecasts` (admin, one person at a time). No route lists forecasters.
- Lock: `taskReviewLock` in `locks.ts`. `recordReview` and `recordForecast` both take it as their first statement. The forecast insert is `insert ... select where not exists (review)` in one statement after the lock. Duplicate and closed cases are 409 `CONFLICT` with `fieldErrors.forecast` = `exists` or `closed` (no new error codes, to avoid touching the shared ERROR_CODES line).
- Read model (`forecasts/ledger.ts`, pure scoring in `shared/contracts/src/forecasts.ts`): outcome = first `task_reviews` row by seq, joined at read time. States: open, void (task canceled or mission archived, no review), resolved (`made_at < first review created_at`, compared in SQL), late (review exists but is not later than the forecast; shown, never scored).
- Scores: Brier and log loss (both lower-is-better; log loss is the negative log score). Clamp [0.01, 0.99] = input bounds, so only a reference-class rate of exactly 0 or 1 is altered. 5 bins on whole percents, rate shown from n >= 5. Per-class means (n >= 5).
- Baseline: same class x difficulty (first brief made at or before the forecast naming both), tasks of the same company, not simulated/demo, first review strictly before `made_at`, used from 5 tasks. Skill = 1 - meanBrier / baseline meanBrier on the same tasks, shown only from 20 resolved forecasts **that have a baseline** (stricter than 20 resolved); otherwise "not enough evidence (n of 20)".
- Contracts: DTOs, validators, 3 registry entries (no allowlist lines), `RATING_FIELDS` for both GET routes with reasoned `RATED_LIST_ALLOWED` entries for the person's own lists, `ROUTE_NO_INPUT` classification for the POST (c66 writability), c79 write case, coverage flow seeded so every nullable and array is exercised. The POST answers with a small shape that has no nullable field. No c66 metric-registry entry: forecasts are not a scorecard, KPI or dimension row (nothing shows them to the owner yet; UI is out of scope).

## RED / GREEN
- Item 1 RED (197379f): 10 of 10 tests in `c86-record.test.ts` failed (route absent; `taskReviewLock is not a function`). GREEN (3b5c2c7): 10/10 pass.
- Items 2-3: tests (ae36b07) were written after the read model existed (it was needed by the same commit), so RED was shown by mutation against the final tests, each restored afterwards:
  - M1 remove the in-statement review check: 2 fail (closed-after-review, forced-order race);
  - M2 remove the lock from `recordForecast`: forced-order race fails;
  - M3 baseline ignores time: 2 fail;
  - M4 baseline includes simulated tasks: 2 fail;
  - M5 late counted as resolved: the late test fails.
- Item 4-5 (648331e): guards, c79, c66, c78, c72, c80 suites listed below.
- Hand-computed fixture: five forecasts (0.80 yes, 0.30 no, 0.99 no, 0.01 yes, 0.50 yes) give Brier .04/.09/.9801/.9801/.25 (mean .46804) and log loss .22314/.35667/4.60517/4.60517/.69315 (mean 2.09666); boundary 0 and 1 clamp checks; a 20-forecast DB fixture with a baseline of 2/3 (n 6) gives skill = 1 - .085/(5/18).
- Race tests: 12 concurrent forecast+review rounds (row exists iff 201; never a 409 with a row), 8 more rounds in the score file (a row is "resolved" exactly when made strictly before the outcome), and a forced-order test (a review holding the lock and committing first makes the waiting forecast 409).

## Threshold
| Item | Result |
|---|---|
| Items 1-5 RED then GREEN, race test, hand-computed Brier and log | PASS (items 2-3 RED shown by mutation, see above) |
| c80 lint passes on 0059 | PASS (c80-migration-lint, plus own check) |
| Four-guards test covers the table | PASS (discovered from the catalog; c80-guards green; applies without 0058, down re-runnable) |
| c79 test/tenant, c50, c66, c78 green | PASS (13 files green after one flaky mutants run; M08 seeding crashed once under load, re-run alone 18/18) |
| Full vitest, no failure or each named | PASS with one named transient: full run (parallel, load ~11) 3451 passed, 36 skipped, 1 failed: `site-grants.test.ts > loadGrants returns nothing for an agent that is not staffed...` first error `admin connect failed {"code":"INTERNAL"...}` (harness, unrelated); re-run alone 21/21. Not run serially. |
| tsc clean | PASS (server; web tsc also exit 0) |
| Diff: no web/ file, at most 0059 | PASS (only docs report under web/docs/improve/cycles) |

## Concerns
- A forecast whose transaction started after the review transaction started but took the lock first has `made_at` after the review's `created_at` (both are `now()`, transaction start), so it reads as "late" and is not scored. Conservative, tiny window.
- Baseline is company-wide (aggregate, tenant-scoped) and not restricted by the viewer's mission visibility.
- Edited shared files: `locks.ts`, `tasks/reviews.ts` (one line), `app.ts`, `metric-guard.ts` (one ROUTE_NO_INPUT line), contract test registries; small merge-conflict risk with c85.
- The 20-forecast floor counts forecasts with a baseline.
