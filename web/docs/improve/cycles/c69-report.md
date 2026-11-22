# c69 report: process metrics next to outcomes (R3-5)

Lane w67, branch `c69-process-metrics`, base `35bb4a9` (c66's tip). No migration. One commit per item, nothing pushed.
Commits: e587363 item 1, 7570cd2 item 2, 0dfb987 item 4, 64ee403 item 3 (item 4 landed before item 3 because the UI reads the route; the c50 inventory also forces route and contracts together).

## Read this first (evidence honesty and what was NOT built)
1. **c58 and c65 are not in this branch's base.** `git merge-base --is-ancestor 7f31c94 HEAD` is false; there is no `approval_decisions.latency_ms`, no `server/src/capacity/`, and the c58/c65 cycle files are absent from this worktree. The brief says to reuse their stored latency and not recompute it. So **approval time-to-decision is an `unmeasured` cell** with that reason (not a number, n unknown). I did not recompute it from timestamps and did not merge c58. When this branch is merged after c58/c65, the cell can read the stored column; that is one more loader query and one `measure` function in `server/src/company/process.ts`.
2. **The "rework" and "first-pass" definitions are this brief's own** (the research pages are UNVERIFIED). They are written in the header of `server/src/company/process.ts` and in the `?` help. A8 and B5's "11x" are not cited. No "good" level is claimed anywhere.
3. **Cost is an unmeasured cell** (Stage 9). **The lag check is dropped.** The leading/lagging tag is not built, because the UI has no use for it (the brief allows dropping it).
4. **"Delegate's first action" is the first started attempt of the delegated task.** The attempt row records no actor, so the record cannot say who started it (today a person does). A delegation with no task attached is not measured.
5. The cause of a return is **not** a "review reason": `task_reviews` has only a verdict and a rubric. The cause is the confirmed failure tag mode known at the window end ("several failure modes" when more than one), else "a criterion failed (no failure tag)" when the review marked a rubric criterion failed, else "no recorded cause".

## What was built
| Item | What | Where |
|---|---|---|
| 1 | Pure read model `computeProcess` and 17 exact-equality tests on hand-computed fixtures | `server/src/company/process.ts`, `server/test/c69-process.test.ts`, `shared/contracts/src/process.ts` |
| 2 | Seven c66 registry rows (kind `process`) with counter-metric or an explicit none, uncovered qualities, inputs; one new input field `task_owner_history.owner`; gameable is derived, never typed | `shared/contracts/src/metric-registry.ts`, `metric-guard.ts`, `server/test/c69-registry.test.ts` |
| 4 | `GET /company/process?window=&department=` (any signed-in user, GET only, no write route), DTO, validator, registry entry, coverage flow, no allowlist line | `server/src/company/process-routes.ts`, `server/test/c69-process-route.test.ts`, `server/test/contracts/*` |
| 3 | A **Process view** of the Dimensions panel (a segmented "Outcomes / Process" control; shares the department and window controls) | `web/src/features/agents/ProcessView.tsx`, `Dimensions.tsx`, `web/src/api/process.ts`, `web/src/data/processDemo.ts`, `web/src/help/pages/c69-process.ts`, `web/src/theme/pages/c69-process.css`, `web/scripts/api-c69.mjs` |

### Why a view and not a seventh row
The Dimensions tab already fills 1366x768 (c54). I built the Process group as a seventh row first and measured it: the tab overflowed by **87 px** with seven cells (two lines), then by **46 px** with five cells and a chip. The cell heights (37 px) and the note line (28 px) are pinned by the unchanged c46 and c66 scripts, so I could not reclaim space from the six rows. The KPI area (Overview scorecard) is also full. So the Process figures are a view of the same panel: same department selector, same window, same guard and help components, default view unchanged. This is "next to" in the sense of one control away, not on the same screen as the six rows. That is a deviation from the brief's wording, stated here.

## Definitions (exactly as implemented)
- **Returned for rework**: of tasks whose FIRST review decision falls in the window, the share returned (changes requested or rejected) on it. Open tasks (status passed or verifying, no review as of the window end) are reported beside it as "open", a snapshot, never in the denominator. Causes shown with n. Needs 3.
- **Accepted first time**: of tasks with at least one review in the window, the share whose FIRST review ever is accepted and not stale (c51 freshness: a later attempt exists). A task accepted only after a return is not first-pass; a stale acceptance never counts. The cohort differs from the rework cohort on purpose (any review in the window vs first review in the window). Needs 3.
- **Duplicate delegations**: current (not superseded) delegation briefs in the window with a goal; goal normalised (trim, lower-case, collapse white space); a delegation is a duplicate when another one of the same mission in the window has the same goal. Count and share with n, repeated goals counted in the evidence. Needs 3.
- **Reassign churn**: for tasks first assigned in the window, changes of owning agent between consecutive `task_owner_history` rows up to the window end (same agent = not a change; a row with no agent is skipped). Median and p90 (nearest rank, the ceil(0.9 n)-th), null below **20** tasks.
- **Wait on a hand-off**: for each `delegated` edge with a task made in the window, hours to the first started attempt of that task, computed in SQL (DB time). Open hand-offs are reported beside, never in the median. Median and p90, needs 3 closed.
- A department keeps tasks by their current owning agent and delegations by the receiving agent. DEMO missions, simulated tasks and missions the caller cannot see are never read.

## Fixtures and hand-computed values (all asserted with exact equality)
Window 30d ending 2026-11-21T12:00Z; previous window the 30 days before it.

**Reviews** (tasks t1-t14, agents a1 a2 Eng, b1 Ops):
- First reviews in the window: t1 accepted, t2 changes_requested (a criterion failed), t3 rejected (tag FM-1.1), t4 changes_requested (tags FM-1.1 and FM-2.2), t5 changes_requested (its only tag is confirmed after the window end, so unknown then), t7 accepted (Ops), t8 accepted but stale. t6 has a first review 40 days old (outside) and a second inside; tx is simulated; t9 passed and t10 verifying have no review (open); t11 running (not open).
- Rework, whole company: cohort 7, returned 4, **4/7 = 57.1**, open **2**, causes FM-1.1 1, a criterion failed 1, no recorded cause 1, several failure modes 1. Eng: 6 tasks, 4 returned = **66.7**. Ops: 1 task = not enough evidence. Previous window: t6, p1 (returned), p2 = **33.3**, trend up.
- First-pass, whole company: cohort 8 (t1 t2 t3 t4 t5 t6 t7 t8); first review accepted and not stale: t1 t6 t7 = 3; **3/8 = 37.5**. Eng: 7 tasks, 2 = **28.6**. A stale t1 gives 2/8 = 25.
- Edge test: a review exactly at `from` and at `to` counts, one ms earlier does not.
**Duplicate delegations**: in-window current briefs b1 b2 b3 b4 b7 = 5 (b5 is 35 days old, b6 is superseded by b7, b8 simulated, b9 has no goal); b1 and b2 share a goal after normalising ("Fix the login bug" and "  fix   the LOGIN bug "); b3 has the same text in another mission. **2/5 = 40**, one repeated goal. Eng 4 briefs, 2 = **50**. Adding a third identical goal: 3/6 = 50.
**Reassign churn** (20 tasks): ten with 0 changes (including two rows with the same agent), four with 1 (one has a null-agent row between), three with 2, one 3, one 5, one 10. Sorted, **median (0+1)/2 = 0.5, p90 = the 18th = 3**. 19 tasks: null with "not enough evidence (n = 19)". A task first assigned 50 days ago, a simulated task and another department's task are out of the cohort.
**Hand-off wait**: Eng waits 2, 4, 6, 9 h, Ops 1 h, one Eng hand-off open. Whole company (5): **median 4, p90 9**; Eng (4): **median 5, p90 9**, open 1.
**Route (real rows, DB time)**: member sees only the shared mission: 4 tasks, 2 returned = **50.0**, open 1; the administrator also sees a private mission (5 of 7 = **71.4**); a DEMO mission and a simulated task are never counted. Hand-off waits of 1, 2, 4, 10 h: **median 3, p90 10**, 1 open. Briefs "Write the report" / "  write   THE report " / "Review it": **2 of 3 = 66.7**.

## RED / GREEN
| Item | RED (first error line) | GREEN |
|---|---|---|
| 1 read model | `Error: Cannot find module '../src/company/process.ts' imported from /home/luca/AXION-w67/server/test/c69-process.test.ts` | 17/17 (the hand computations matched on the first run; I did not tune a fixture to the code) |
| 2 registry | `c66-registry.test.ts > has an entry for every scorecard row, KPI tile and dimension cell...: AssertionError: expected [ …(7) ] to deeply equal []` (seven live process rows with no entry); `c69-registry.test.ts`: `process.rework_rate: expected undefined to be 'process'` (3 of 4 failed) | c69-registry 4/4; c66-registry, c66-writability, c66-contracts pass |
| 4 route and contracts | `c69-process-route.test.ts` on the unchanged server: `AssertionError: expected 404 to be 401` (9 of 9 failed). The contract entries were added with the route (the c50 inventory would fail the build otherwise); no separate RED was observed for them | 9/9; `server/test/contracts` 15/15, with the coverage flow seeded so every nullable field is non-null in some call (trend, p90, open, breakdown) |
| 3 UI | `api-c69.mjs` against the previous `web/src` (restored from HEAD~1): `FAIL script ran to the end — locator.click: Timeout 30000ms exceeded` (the "Process" radio does not exist) | api-c69 34/34 |

c66 tests changed (tightened, with the reason): `c66-registry.test.ts` (a) the live-row list now includes the process cells, so a new process row without an entry fails; (b) the "11 gameable" count and its snapshot are scoped to the three c66 row kinds, because the process rows have their own pin in `c69-registry.test.ts` (`process.rework_rate`, `first_pass_acceptance`, `duplicate_delegation` and `handoff_wait_h` gameable; `reassign_churn`, `approval_decision_h` and `cost` not). `contracts/writability.ts` adds `company/process-routes.ts` to the loader files whose tables must be declared inputs. `contracts/coverage.test.ts` adds the seeded flow (31 lines) and three calls. `validators.ts` adds `'process'` to the row kind. `allowlists.ts` and `exercised.ts` are untouched: **no allowlist line**. No c46, c54 or c66 browser script was edited.

## Pass threshold
| Item | Result | Evidence |
|---|---|---|
| Items 1-4 RED -> GREEN | PASS | table above. Item 4's contract entries have no separate RED (see the table); item 3's RED is the previous UI against `api-c69.mjs` |
| Every c46, c54 and c66 test passes unchanged, or is tightened with a reason | PASS | no c46, c54 or c66 browser script was edited; api-c46 36/36 and api-c66 26/26 unchanged. Server c66 tests: two tightenings (live-row list now includes process rows; the 11-gameable pin is scoped to the c66 row kinds) with the reason above. All c46/c54/c66 server tests pass |
| Full vitest and tsc | PASS | `heavy.sh npx vitest run` at default workers (load 13-17): **82 files, 2205 tests passed, 0 failed**, no connection errors, so the serial fallback was not needed. `tsc --noEmit` clean for server and web |
| api-c69 (new), api-c46, api-c66, api-stage6 | PASS | api-c69 **34/34**, api-c46 **36/36**, api-c66 **26/26**, api-stage6 **94/94** (`E2E_API_PORT=11792 E2E_WEB_PORT=11793`, db axion_e2e6) |
| verify-all 10/10 | PASS | "verify-all: ALL 10 STEPS PASSED" (OUT=/tmp/axion-verify-w67, dev server on :11790, load 13-17), including the help-keys step |
| fit-check clean | PASS | `fit-check.mjs 1366 768`: "ALL FIT". `api-c69` also checks the Process view itself at 1366x768: no inner or page scroll, no card clipped, note line on screen |
| a11y clean in both modes | PASS | demo: 51 views, 64 dialogs, 0 violations. api: 41 views, 64 dialogs, 0 violations |
| api-mobile has no new FAIL | PASS | "NO FAILURES" (its SMALL-target lines are informational; the one new control is the Process view's compact guard, 24 px under the coarse-pointer rule c66 added). `api-c69` checks 390 px: no horizontal scroll, every card on screen |
| (a) each metric has a documented formula and an exact-equality hand-computed fixture | PASS | 17 pure tests plus the route test; formulas in the header of `process.ts` and in the `?` of each card. **Approval time-to-decision is an unmeasured cell** (c58 not in this base), so it has a stated reason and no formula |
| (b) open items reported separately in every rate | PASS | rework, first-pass and hand-off wait carry `open` beside the figure and never in the denominator (tests: 2 open tasks, a task with no review, an open hand-off). Duplicate delegations and churn have no open state |
| (c) lag check | NOT BUILT (dropped by the brief) | the leading/lagging tag is not built either |
| (d) every figure shows n | PASS | every cell is a value with n and window, or "not enough evidence (n = k)", or an unmeasured cell with n unknown; checked in the pure tests, the route test and `api-c69` (DOM equals the API) |
| Handoff wait: time from delegation to the delegate's first action, and approval time-to-decision, reusing c58/c65's stored latency | **PARTLY NOT MET** | the delegation half is built (first started attempt of the task; no actor is recorded on an attempt). The approval half is NOT MET: c58 and c65 are not in this branch, there is no stored latency to reuse, and the brief forbids recomputing it. The cell is honest and blank |
| "Process" group next to the outcome rows, one screen at 1366x768 and 390 px | **PARTLY MET** | the group exists on the company view and, through the department selector, on any department, with n, window, `?` formula and the c66 guard popover. It is a view of the Dimensions panel (one control away), not a seventh row on the same screen: a row overflowed the pinned layout by 46-87 px. Screenshots below |


## Files changed
```
git diff --stat 35bb4a9..HEAD (22 files before this report)
server/src/company/process.ts, process-routes.ts; server/src/app.ts (registers the route)
shared/contracts/src/process.ts, index.ts, metric-guard.ts (one input field), metric-registry.ts (kind + 7 rows)
server/test/c69-process.test.ts, c69-registry.test.ts, c69-process-route.test.ts (new)
server/test/c66-registry.test.ts, contracts/{coverage.test,registry,validators,writability}.ts (additions and the two scoping edits above)
web/src/api/process.ts, data/processDemo.ts, features/agents/ProcessView.tsx, Dimensions.tsx, help/pages/c69-process.ts, theme/pages/c69-process.css
web/scripts/api-c69.mjs, web/docs/screenshots/improve-c69-*.png, this report
```

## Concerns
1. **Approval time-to-decision is not measured** because this branch lacks c58/c65. After they merge, add the stored `latency_ms` read to the loader and a `measure` for `approval_decision_h`; the registry row, DTO field, validator, help entry and UI blank already exist, and the cell would flip from `unmeasured` to a value. The controller should decide whether to merge c58/c65 first or accept the blank.
2. **The Process group is a view, not a row** (see "Why a view"). If the owner wants it visible beside the six rows at once, the six rows must give up height first (their 37 px cells and 28 px note are pinned by the c46 and c66 scripts), or the Process view could default on.
3. **The definitions are mine.** First-pass uses the first review ever; the freshness flag comes from `STALE_BEFORE_SQL` as of the read, not as of the window end (the c54 caveat). Open means status passed or verifying with no review, a snapshot of now (also for the previous window's trend). Churn's cohort is "first assigned in the window" and counts changes up to the window end; a long-lived task assigned before the window is out. A review reason column does not exist, so causes come from confirmed failure tags and failed rubric criteria; untagged returns land in "no recorded cause".
4. **Hand-off wait for the previous window is computed with attempts as of now**, so a delegation that was open then and started later looks closed in the trend baseline. Delegations with no task and the demo seed's staffing edges are not measured.
5. **The writability inventory cannot see `task_owner_history`.** It is written only by a database trigger on `tasks.owner` (migration 0039, outside the source scan). I listed it as a field written where `tasks.owner` is, and a test asserts that no file in `server/src` writes it and that the two fields travel together. A future writer in a script or a migration would not be caught.
6. **Counter-metrics are my reading of the data**, as in c66; read the seven sentences. Two rows (duplicate delegations, approval wait) declare an explicit "none" with a reason. The gameable flag classifies what the code permits (reviews, tags, briefs and delegation edges have agent-reachable writers); no agent executes, so none has been gamed.
7. **Cost of the loader.** Reviews, briefs and owner history are read for the tenant's visible missions without a time bound (a first review can be old); c46 does the same for reviews. It is fine at today's volumes; a bound would need a "first review" column or an index-backed subquery.
8. **A rate over a small cohort is drawn small** (n below 10) and needs 3 (churn needs 20). No composite and no "good" threshold is claimed; the order of the cards says nothing.
9. No migration was needed (no number was used). Background jobs started here (dev server on 11790, vitest, the e2e chain, verify-all and the final checks) were all finished or stopped by port before hand-back.

## Screenshots
`web/docs/screenshots/improve-c69-dark.png`, `improve-c69-light.png`, `improve-c69-mobile.png` (the Process view with seeded rows; 1366x768 dark and light, 390 px).

