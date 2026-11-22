# c65 report: review-capacity view (R3-10) (lane w63, branch c65-review-capacity, from c58-rule-of-two at 7f31c94)

## What was built
- **Read model** (`server/src/capacity/model.ts`). Items that need a person: **approvals** and **tasks waiting for a person** (`waiting_user`, from `task.stateChanged` events). Task reviews and delegations have no "awaiting a decision" state in the data, so they are not counted (stated in the `?` and the DTO docs). Per department and in total, over a fixed window of 7, 30 or 90 days: arrivals (n), arrival rate per day, decided count, distinct people, p50 and p95 time to decision, open backlog, median queue size. Approval latency and queue size are **c58's stored columns** (`approval_decisions.latency_ms`, `queue_size`), not recomputed; the test stores values that differ from the timestamps and checks the stored ones win. Task-wait durations come from event times in SQL. Every bound and duration uses DB `now()`; the window is N x 24 hours (not `make_interval(days)`, which shifts an hour across a DST change; found when the simulation was one row off).
- **Department mapping rule** (`DEPARTMENT_RULE`, tested). An item belongs to the department of the agent that raised it (approval: `agent_id`) or owns the task (`owner_agent`), from `agent_definitions.dept`. No catalogue entry, or a task with no owner, is "Unassigned" (shown, never dropped). The mission's department is not used (missions have none).
- **Little's law** (`littles.ts`). Compares the time-averaged number open over the window (L) with lambda x W. **Tolerance: pass when |L - lambda*W| <= max(0.25 items, 15% of the larger side).** Boundary effects (carry-in, items cut off at "now") are about W/T, hence a relative tolerance. A closed state with no close record (approval approved/denied with no decision row; a task wait whose task moved on with no event out of `waiting_user`) fails as `missing_close` even if the averages agree, and `assertLittle` throws `LittleLawError`. The UI shows an alert.
- **Utilisation: dropped from v1** (the brief allows it). AXION records waiting time, not handling time, and there is no hours-per-week setting; a number would be invented. The DTO carries `utilisation: { value: null, reason: 'not_measured', note }` and the panel says so with a `?`. No migration (0049 unused), no setting route.
- **Observed span**: per supervisor in the latest org revision, active agents and open items of those agents. Measure only: no field holds a limit, the note says "No recommended number", rows alphabetical. Rows are agents, so members see them.
- **Privacy**: `GET /review-capacity/people` is admin only (403 FORBIDDEN otherwise), alphabetical, percentiles null below 20. `GET /review-capacity` for everyone; non-admins see numbers only when the cell has >= 5 items and >= 3 distinct people (per department cell too), `n` always shown. Query schema is strict: only `windowDays` in {7,30,90}; sort, order, user or any other parameter is 400. No other method or per-person route exists.
- **UI**: compact "Review capacity" panel at the top of System Operations, Queues tab (`features/ops/ReviewCapacity.tsx`): five cells (arrivals/day, median, slowest 5%, waiting now, data check), each with `n` and a `?`; department table, span table, per-person table behind a Show button (admins; members see "administrators only"), "Utilisation: not measured" with `?`. Demo mode shows labelled DEMO sample numbers.
- **Contracts**: DTOs in `shared/contracts/src/api.ts`, validators, registry (people route `admin: true`), coverage calls (admin, member, people). No allowlist line (the test diffs both allowlist files against 7f31c94).

## RED / GREEN
| Item | RED (before the code) | GREEN |
|---|---|---|
| 1 `c65-model.test.ts` | `Error: Cannot find module '../src/capacity/model.ts'` (suite failed to load) | 8/8 (ddd3b46) |
| 2 `c65-little.test.ts` | `Error: Cannot find module '../src/capacity/littles.ts'` | 7/7 (5031f5b) |
| 3 `c65-utilisation.test.ts` | 2 failed: `expected undefined to deeply equal { value: null, ... }`, `.toMatch() expects to receive a string, but got undefined` | 3/3 (cbb6784) |
| 4 `c65-span.test.ts` | 4 failed: `TypeError: Cannot read properties of undefined (reading 'rows')` | 4/4 (fe3cc40) |
| 5 `c65-privacy.test.ts` | 8 failed: `AssertionError: expected 404 to be 200` (no route), `Cannot read properties of undefined (reading 'total')` | 8/8 (db4eddd); also `contracts/coverage` needed 20 decided rows so p50/p95 are non-null somewhere (no allowlist line) |
| 6 `api-c65.mjs` | panel removed: `FAIL unexpected locator.waitFor: Timeout 15000ms exceeded ... '.ops-review-capacity'` | 0 FAIL (525a5fb) |
| 7 `c65-contracts.test.ts` | registry entries removed: `expected undefined to match object { v: [Function] }` and `route inventory ... expected [ ...(2) ] to deeply equal []` (3 failures) | 18/18 with `contracts/` (9a1f0e7). Note: the route and its registry entries landed in item 5's commit because the inventory test forces them; item 7 adds the strictness tests |

## Threshold
| Item | Result | Evidence |
|---|---|---|
| Items 1-7 RED then GREEN | PASS | table above, one commit per item (item 5 carries the route contract entries, see note) |
| Seeded arrival simulation matches a reference calculation within the stated tolerance | PASS | `c65-little`: about 1959 arrivals over 40 days (mulberry32 seed 20261122, exponential service, mean 4 h); arrival rate exact (< 1e-9), p50 and p95 within 1 ms of an independent JS reference, open count equal, L and lambda*W within 1% of the reference, Little status pass, and the reference itself inside the 15% / 0.25 tolerance. Utilisation is not part of v1 (dropped, item 3) |
| Little's law fails loudly on a missing close event | PASS | DB fixture (approved, no decision row) and a task-wait fixture: status `fail`, reason `missing_close`, `LittleLawError` thrown; UI alert shown in api-c65 |
| Percentiles null below 20, every cell shows n | PASS | model test (19 null, 20 numbers); UI `n =` in every cell |
| No per-person route for non-admins (contract test) | PASS | `c65-privacy` route-table contract test plus api-c65 (403, 0 browser requests, no id or name in the body) |
| tsc | PASS | server and web clean |
| Full vitest | PASS | one parallel run via heavy.sh: 82 files, 2321 passed, 0 failed (load average 10 to 12; no serial fallback needed) |
| api-c58, api-c48, api-stage6 | PASS | api-c58 RESULT: all PASS (0 FAIL); api-c48 31 PASS, 0 FAIL; api-stage6 94/94 |
| api-c65 (with member privacy checks) | PASS | 0 FAIL: admin numbers and n, `?` on each of 5 cells, per-person table A to Z, no sort control, windows, help opens, member sees aggregate only, member 403 on people and 400 on sort, member never requested the people route, lost close event shows an alert, 1366x768 fit in dark, light and member, no page errors |
| verify-all 10/10 | PASS | `ALL 10 STEPS PASSED` (own OUT `/tmp/axion-verify-w63`, dev server 11390). A first attempt wrapped in `timeout 580` was cut off during the deep crawl (my wrapper, not a failure) and was rerun without it |
| fit-check | PASS | `ALL FIT` demo, 1366x768, dark; `/operations?tab=queues` fits. Light mode and member fit are covered by api-c65 (the script is dark only) |
| a11y, both modes | PASS | demo 51 views, 66 dialogs, 0 violations; api 41 views, 66 dialogs, 0 violations |
| api-mobile | NOT RUN | not asked for in this lane's finish list; the panel has a single-column rule under 820 px but it was not checked at phone width |
| No allowlist lines | PASS | `c65-contracts` diff test |
| Servers stopped | PASS | see end of file |

## Files changed
server: `src/capacity/{model,littles,routes}.ts` (new), `src/app.ts`, `src/cli/e2e-capacity-seed.ts` (harness, e2e DBs only); tests `c65-fixtures.ts`, `c65-model`, `c65-little`, `c65-utilisation`, `c65-span`, `c65-privacy`, `c65-contracts`, `contracts/{registry,validators,coverage}`.
shared: `contracts/src/api.ts`. web: `src/features/ops/ReviewCapacity.tsx`, `src/api/reviewCapacity.ts`, `src/data/reviewCapacityDemo.ts`, `src/help/pages/c65-review-capacity.ts`, `src/theme/pages/c65-review-capacity.css`, `src/pages/Operations.tsx`, `scripts/api-c65.mjs`. Screenshots: `web/docs/improve/cycles/shots-c65/`. No migration.

## Evidence honesty
No source gives a safe span of control; none is claimed. B7 is not cited. The utilisation-to-wait relationship and Little's law are standard queueing mathematics, not from the papers (stated in the `?` text).

## Concerns
1. **Scope of "needs a human"**: only approvals and `waiting_user` task waits. Reviews and delegations have no pending state; adding one is a data-model change for the owner to decide.
2. **Utilisation dropped** for lack of a handling-time record and an hours setting. If the owner wants it, it needs a migration (0049 is reserved) and an operator setting.
3. Task waits depend on `task.stateChanged` events; a task whose events are missing is flagged by the Little check as a missing close.
4. Department mapping depends on the agent catalogue; retired agents keep their department, unknown ones are Unassigned.
5. c58's windows still use `make_interval(days)` (calendar days); c65 uses 24-hour multiples. The two views can differ by an hour across a DST change.
6. The Little check uses the time-averaged open count, not the instantaneous backlog, because that is what the law states; the instantaneous count is shown separately as "Waiting now".
7. Real volume is low today, so most cells will read "not enough evidence" until usage grows.
