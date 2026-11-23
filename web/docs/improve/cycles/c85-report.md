# c85 report: change plan records for org proposals (R5-1, first slice)

Lane w83, branch `c85-change-plans`, from 2c3b7d5. Server and shared/contracts only; migration 0058 (`0058_change_plans`).

## What it is, and is not
A record of what was planned before an org change, so the metric cannot be chosen after the data is seen. It builds on c64, which already hashes a stated baseline and expected cost. It is the researcher's construction, **not pre-registration in the statistical sense**, and this slice gives no statistical verdict. Source A1 is not cited for pre-specification.

## What was built
- `PUT /organization/proposals/:id/plan` (admin, pending only): one primary metric (registry id, direction, margin), minN, window 7-90 days, 0-3 guardrails (registry id + margin), why 20-1000 chars. Free-text and unknown metric ids are refused; so are registry rows with no recorded observations (`NOT_COUNTABLE`, with reasons).
- Decision route: a proposal with a plan needs `planSha` (the sha the approver reviewed) to approve; otherwise 409 PROPOSAL_CHANGED. Approval writes `plan_sha` in the same statement as `status='applied'` and audits `org.proposal.plan.lock`. A trigger on `org_proposals` locks `plan` and `plan_sha` once the proposal is not pending (a direct SQL write is refused too). A check constraint requires `plan_sha` on an applied proposal that has a plan.
- `POST /organization/proposals/:id/plan/amendments` (admin, applied proposals with a plan): full new plan, reason >= 20 chars, `baseAmendments` compare-and-set; row in `org_plan_amendments` (actor, DB `now()`), audited `org.proposal.plan.amend`; append-only with four guards and the `axion.purge_demo` exception.
- `GET .../plan` (any signed-in user, tenant-checked): plan, sha, locked, amendments (with changed fields), `amendedAfterChange`, change time (`org_revisions.active_from`), windows computed in SQL, per-metric counts in each window with minN met flags, verdict `no_plan | not_applied | not_enough_evidence | ready_for_analysis`. Counts only. "not enough evidence yet" until the post window is complete and minN is met in both windows; then "Ready for analysis (not computed in this version)". Windows: pre `[change-N d, change)`, post `[change, change+N d)`, bounds and `postComplete` from SQL.
- Existing shapes (`CreateIn`, `payloadSha`, `OrgProposalDto`) are unchanged; proposals without a plan behave as before.
- Declared reads: `plan-metrics.ts` maps every registry id to an observation unit or to `NOT_COUNTABLE`; `c85-plan-metrics.test.ts` fails on an unmapped new registry row, a unit reading a table its metric's inputs do not declare, or a write verb in a unit's SQL.

## Decisions to review
- Readout counts and the verdict use the plan **as locked**; an amendment is shown and flagged, and `effectivePlan` is the amended one, but counts are not recomputed for it.
- PUT returns a small `PlanSetDto` (a pending proposal has no window or counts), so no c50 allowlist line was needed.
- No advisory lock added: the proposal row `for update` serialises plan writes and amendments.
- Window units are my mapping of "one observation" per registry row (for example a review, a finished mission, a confirmed tag). Please review `plan-metrics.ts`.
- c83 (column-level loader coverage) is not on this base, so its guard could not be run; observation units live under `organization/`, not `company/`.

## Evidence (RED then GREEN)
- Item 1: `c85-plan.test.ts` RED at commit b31aecc: 9 failed, 2 passed (column "plan" does not exist, 404 on the routes). GREEN: 11/11.
- Item 2: RED run with the plan routes unregistered: 5 failed, 1 passed (the table guard test passes once the migration exists). GREEN: 17 tests in the combined run of `c85-amendments.test.ts` before the helper split; now 6/6. The route landed with item 1 (shared file), so its RED is the unregistered-route run.
- Item 3: RED with `plan-metrics.ts` absent and routes unregistered: both files fail to load. GREEN: readout 8/8, metrics 3/3 (includes RED-proof fixtures for the mapping guard).
- Item 4: RED: c50 inventory (2), c66 writability (2) and c79 `real.test` (1) failed on the new routes. GREEN: ROUTES entries and validators, `ROUTE_NO_INPUT` reasons, `WRITE_CASES` (PUT, amendments) and `needs`, a marker-bearing plan in the c79 fixture, the coverage flow (PUT, GET before and after approval, amend, GET on a plan-less proposal). No allowlist lines, no c79 exceptions.
- `org_plan_amendments` is found by the c80 generated four-guards test (37 tables) and pinned in its FLOOR (one-word edit to the test; the frozen baseline fixture is untouched, c80 lint passes on 0058).

## Pass threshold
(final numbers in the section below)

## Owner question Q17
Which kinds of change should be allowed or required to carry a plan (org changes only, or also process toggles and version promotions)? This slice covers org change proposals only, and a plan is optional.

## Files changed
See `git diff 2c3b7d5..HEAD --stat`: migration 0058 (up, down), `server/src/organization/{plan.ts,plan-metrics.ts,proposals.ts}`, `server/src/app.ts`, `shared/contracts/src/{org-plan.ts,index.ts,errors.ts,metric-guard.ts}`, c85 tests and helpers, c50/c66/c79 test registries and fixtures, `c80-guards.test.ts` floor. No `web/` source file.
