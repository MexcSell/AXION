# c86 review (forecast ledger), 2c3b7d5..aabaf75: NOT CLEAR

Independent reviewer, 2026-11-23. The reviewer's scratch file was a stub; this is the controller's copy of the hand-back.

**Checks run:**
- tsc: clean.
- c86 files, test/tenant, test/contracts and the c80 tests: 116 passed.
- `c86-record.test.ts` failed once under load with "admin connect failed" (the H14 class), then passed 11/11 alone.

## Findings
1. **MAJOR: the baseline leaks private-mission outcomes.**
   - `server/src/forecasts/ledger.ts`, the `hist` CTE (~line 33), filters by tenant, not simulated, not demo and mission not deleted, but not by `VISIBLE_SQL`. The DTO exposes the baseline's `n` and `rate`.
   - A member who can see 4 of the 5 tasks in a class×difficulty cell, at the n=5 floor, reads the fifth (hidden) task's verdict from `rate`.
   - Forecasts made at different times show deltas in n and x, so a member can detect hidden tasks resolving.
   - The fix is to compute the baseline over tasks the viewer can see (join missions with `VISIBLE_SQL`). Add a test that a hidden task changes neither n nor rate, and a mutation for it. State in `FORECAST_METHOD` that the baseline varies by viewer.
   - A floor alone does not close the leak.
2. **MINOR: no RED-by-mutation for visibility.** There is no mutation for the baseline's visibility or for the 404 on private tasks. `c86-record.test.ts:82-87` does assert the 404, for a hidden task and a missing one alike.
3. **MINOR: one review insert takes no lock.** `server/src/cli/e2e-attention.ts:41` is a dev-only CLI and the only other `task_reviews` insert in src. It skips the lock, which yields "late" (never scored), so the outcome is conservative. Add a comment, or a test that pins "every insert goes through recordReview".
4. **MINOR (cosmetic).**
   - The `forecasts_task` index duplicates the leading column of the unique key.
   - `made_at = now()` is the transaction start, so a forecast that wins the lock can still read as "late". That is safe.

## Verified OK
- **Lock.** The lock order matches audit's. The insert is a single-statement `where not exists` after the lock wait, and "late" forecasts are unscored.
- **Admin route.** It is tenant-scoped.
- **Idempotent replay.** It re-checks visibility.
- **Migration 0059.**
  - It has the four guards and the `purge_demo` exception, and does not depend on 0058.
  - The down migration is re-runnable.
  - The FK and indexes are fine.
  - c80 lint passes, and the baseline is untouched.
- **Scoring.** Brier and log are correct, with the clamp stated. Bins show a rate only when n≥5. The baseline uses only reviews before `made_at` and briefs naming both class and difficulty. The skill floor of 20 is honestly described.
- **Guards and contracts.** There is no leaderboard, and RATING_FIELDS is registered. The c50 contracts carry no allowlist lines. The c66 writability entry is present. The c79 sweep covers the new routes.
