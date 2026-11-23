# c86 brief: forecast ledger, first slice (R5-7)

**Lane:** w84 (`/home/luca/AXION-w84`, branch `c86-forecast-ledger`), from improve-30h at the commit that adds this brief. Ports 13490–13493. E2E DB **axion_e2e3** (reused; edit the lane `server/.env` after `new-lane.sh`). **Server and shared/contracts only: no file under `web/` may change.** **One migration allowed: 0059**, and only if needed. It must not depend on 0058, which belongs to the c85 lane running in parallel; your migration must apply cleanly with or without 0058 present.
**Sources:**
- `phase2/research-r5.md` §R5-7;
- `phase2/research-r5-verified.md`: its R5-7 section and closing recommendation. **Its required changes are binding.**
- task reviews (`server/src/tasks/reviews.ts`, migration 0031, c51's freshness rule in `company/stale.ts`);
- delegation briefs with task class and difficulty (c42, c72);
- c72's no-leaderboard guards (`test/contracts/value-order.ts` RATING_FIELDS, c78);
- `server/src/company/clock.ts`.

**HARD RULE:** never connect to, query or read the live `axion` database in any form. Never run migrate, demo:* or audit:* CLIs. Your tests migrate their own DBs.

## What this is
People in the company record a probability that a task will be **accepted at its first review**, before that review exists. When the first review lands, the forecast resolves and is scored. Small studies suggest that models' own estimates are unreliable. That is motivation only, not an AXION effect, and it doesn't apply to this slice, which has **human forecasts only**.

## Items (each RED first, then GREEN, each its own commit)
1. **Forecast record.** A user records a probability (0.01–0.99, two decimals) that a given task's first review will be "accepted".
   - Allowed only while the task has no review row. Check this in SQL in the same statement or transaction as the insert, under a lock from `locks.ts`, so a forecast can never be made after its outcome exists.
   - `made_at` comes from DB `now()`.
   - One forecast per user per task. A second is refused (409) and never overwrites the first.
   - Rows are append-only, with all four guards and the `axion.purge_demo` exception (the c80 lint and the generated four-guards test must cover the table). Each write is audited.
2. **Resolution.** The outcome is the first `task_reviews` row per task, by `seq`: accepted or not.
   - Compute it at read time from the review table; store no copy that could drift. If you store one, prove it can't disagree.
   - A forecast whose task has no review is "open". If a task is archived without a review, the forecast is "void", not scored.
3. **Scores.**
   - Score each resolved forecast with Brier and log score. State the probability clamp for log, which equals the input bounds.
   - Per forecaster: the count; the mean Brier; the mean log; and calibration bins (5 bins, each with its n; show a bin's rate only when its n is at least 5).
   - **Reference-class baseline:** for each task class × difficulty (only briefs that name both), the historical first-review acceptance rate over resolved tasks before the forecast's `made_at`. Use the baseline's Brier on the same tasks as the skill reference. A forecaster's skill shows only when they have at least 20 resolved forecasts. Below that, say "not enough evidence (n of 20)".
4. **No leaderboard.** Each person sees their own scores, and admins see each person's scores one person at a time (follow c72's per-agent pattern). No route returns forecasters ordered by a score. Register the score fields in RATING_FIELDS so c78's value-order scan guards them, and pass the c72 no-ranking key scan.
5. **Contracts and guards.** DTOs, validators and the c50 registry entries for every new route and field, with **no allowlist lines**.
   - The c79 sweep must cover the new routes (add `QUERY` entries if needed, never exceptions).
   - If a score is a metric shown to the owner, register it in the c66 metric registry with its inputs.
   - Keep every time comparison and bound in SQL with DB `now()`.
6. **Out of scope:** duration and "done by" questions (`tasks` has no completion time), conformal intervals, agent forecasts and any UI.

## Pass threshold
- Items 1–5 RED → GREEN, including:
  - a race test: concurrent forecast and first review never yields a scored forecast made after its outcome;
  - a hand-computed Brier and log check on a fixture.
- The c80 lint passes on 0059.
- The four-guards test covers the new table.
- c79 test/tenant, c50, c66 and c78 are green.
- Full serial vitest with no failure, or every failure named.
- tsc clean.
- Diff stat: no `web/` file; one migration (0059) at most.

## Report
`cycles/c86-report.md`. Follow the LANES.md Finishing rule. **Deadline:** hand back by about 13:00Z.
