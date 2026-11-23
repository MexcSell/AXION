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
All from the committed tree (before the report commit), load average about 11-12.
- Items 1-4 RED to GREEN: PASS (evidence above).
- c80 migration lint on 0058, frozen baseline unedited: PASS. Four-guards test covers `org_plan_amendments`: PASS.
- c79 tenant tests green with the new routes swept (write cases and a marker plan, no exceptions): PASS.
- c50, c66, c78 guards green: PASS (c83 not on this base).
- Full vitest: a parallel run hit "too many connections for role axion" (35 failures, all that message, other lanes' load). Serial fallback (`--maxWorkers=1 --no-file-parallelism`): **156 files passed, 1 skipped; 3442 tests passed, 36 skipped, 0 failed**: PASS. An earlier parallel run also showed security.test.ts "route table" failing because the two new write routes were not in `LIMITED_ROUTES`; fixed in `src/ratelimit.ts` (proposals bucket), which is a real find of the existing guard.
- tsc clean: PASS.
- Diff stat: no `web/` source file (this report is under web/docs only); one migration (0058): PASS.

## Owner question Q17
Which kinds of change should be allowed or required to carry a plan (org changes only, or also process toggles and version promotions)? This slice covers org change proposals only, and a plan is optional.

## Files changed
See `git diff 2c3b7d5..HEAD --stat`: migration 0058 (up, down), `server/src/organization/{plan.ts,plan-metrics.ts,proposals.ts}`, `server/src/app.ts`, `shared/contracts/src/{org-plan.ts,index.ts,errors.ts,metric-guard.ts}`, c85 tests and helpers, c50/c66/c79 test registries and fixtures, `c80-guards.test.ts` floor. No `web/` source file.

## Fix round (review c85-review.md)
1. `GET .../plan` is now `requireAdmin` (counts include private missions). Test: member 403 FORBIDDEN, anonymous 401, and an administrator's count includes a member's private mission. c50 entry marked `admin: true`.
2. Approving a planned proposal without `planSha` is 409 `PLAN_SHA_REQUIRED` ("This proposal has a change plan. Approve it through the API with the plan's sha (planSha). The app does not show plans yet."); a wrong sha stays `PROPOSAL_CHANGED`. Added to contracts. The web UI needs a plan view and a planSha on approve: BACKLOG item for the controller.
3. Units: demo/deleted-mission filter added to grants, confirmed tags and owner changes. Lessons, playbooks, eval runs and promotions have no mission link and no demo marker (the demo seed never writes them), so no filter is possible there. `lessons_rolled_back` and `verdict_outcomes` are NOT_COUNTABLE and refused. The readout gains `otherChanges` and says "Another change took effect during the window: counts mix both".
4. The readout shows the stored `plan_sha` and `shaMatches`; a mismatch adds a warning. The trigger now refuses a plan change in the update that decides the proposal and a plan_sha set while pending (migration 0058 edited in place; it is unmerged).
5. U+0000 in the plan `why` and amendment `reason` is a 400.
RED: `c85-fix.test.ts` 9 failed before the fixes. c83 guard not run (base predates it; the integrator runs it).
Fix-round runs: server and web tsc clean; full serial vitest 156 files passed, 1 skipped; 3450 passed, 36 skipped, 1 failed (`jobs.test.ts` lease stress test, a timing test under load average about 8; passes alone, 76/76). No `admin connect failed`.
