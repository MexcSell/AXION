# c46 report: six-dimension scorecard (Wave 3, M1)

Lane w45, branch `c46-six-dimensions`, no migration (read model only; 0036 unused).

## What was built
- `shared/contracts/src/dimensions.ts`: the DTO. Dimension objects hold only `key`, `label`, `cells`. A cell holds value, unit, n, minN, basis, from/to, evidence, state, previous, trend. No score/total field exists.
- `server/src/company/dimensions.ts`: pure `computeDimensions` (18 cells in 6 dimensions). Imports only `MIN_N`, `trendOf`, `windowOf` from `scorecard.ts` (not edited) and `outcomesOf` from `departments.ts` (not edited).
- `server/src/company/dimensions-routes.ts`: `GET /company/dimensions?window=7d|30d|90d&department=` (strict query: `includeDemo` is 400, unknown department 404). One DB-clock `now()` for the whole read.
- UI: dialog DL-98 "Six dimensions" (`web/src/dialogs/defs/dimensions.tsx`), opened from the Overview scorecard header and Agents > Departments (and, in demo mode, from Company Health, showing labelled SAMPLE cells). Department selector, window switch, a `?` on each row, the selector, the window and "reading a cell". Help text in `help/pages/c46-dimensions.ts`.
- `web/scripts/api-c46.mjs`: 23 browser checks.

## Cells and sources (and where the brief was refined, with reasons)
| Dimension | Cell | Source | Department key |
|---|---|---|---|
| Cognitive | Verified on first attempt | task_reviews (latest per task), tasks with one attempt | task owner |
| Cognitive | Missions with a flagged stall | mission_ledgers progress, shared `stallCheck` | mission |
| Capability | Playbook items in force (snapshot) | latest playbooks version per active agent, per role in evidence | agent |
| Capability | Tasks passed first time (min 5) | `outcomesOf` (same attribution as departments) | task owner |
| Capability | Site grants active | site_grants (admin only) | mission |
| Environmental | Tagged failures of environment type | failure_tags confirmed, failed/retried tasks | task owner |
| Environmental | Website navigation; Model availability | none: n = 0, "not measured until Stage 7" | |
| Collective | Delegations with a brief | mission_delegations vs delegation_briefs | to-agent |
| Collective | Agent reviews across model families | task_reviews | task owner |
| Collective | Median approval decision time | approval_requests/decisions | mission |
| Knowledge | Lessons proposed / accepted / rolled back (admin only) | lesson_candidates | agent |
| Evolutionary | Promotions; rollbacks | agent_version_proposals; audit `agent.rollback` | agent |
| Evolutionary | Evaluation verdicts | none: n = 0 | |
| Evolutionary | Org revisions applied | org_revisions (first revision excluded) | subordinate |

Refinements and honest gaps:
1. **verdictV2 outcomes cannot be sourced.** Nothing stores a verdict and nothing reads eval_runs; shipped as a real cell with n = 0 and a reason (c47 owns eval evidence).
2. **Environmental tag map.** None of the 14 MAST modes is strictly environmental. The reviewed constant `FAILURE_MODE_DIMENSION` maps all 14 once; the environment set is FM-1.4 (history lost) and FM-2.1 (conversation reset), my reading, not the paper's. The denominator is tagged failures only, so untagged failures never produce 0 %. Needs owner review.
3. **Review independence.** DB checks already force reviewer != producer and different families for agent pairs, so a share would be 100 % by construction. The cell is "agent-on-agent across model families", with the people-written count in the evidence.
4. **Skills per role.** `skills` has no agent or role link; replaced by accepted playbook items per active agent, per role in the evidence.
5. **Reliability** uses pooled task outcomes (passed first time) in the query window with the 5-row floor, not an average of agent percentages.
6. **Visibility of non-mission data.** Site grants and lessons under review are admin-only in their own routes, so a member gets `none`, n = 0 for those cells, never a count.
7. Counts (promotions, rollbacks, org revisions, grants, lessons proposed) follow the same n >= 3 rule as everything else.
8. Snapshot cell (playbooks) is computed as of the end date and as of the previous end date, so its trend is real.

## Pass threshold
| Item | Result | Evidence |
|---|---|---|
| Every cell: value with n and window, or "not enough evidence (n = k)", for empty, small and large fixtures | PASS | `dimensions.test.ts` "every cell is a value..." x3 fixtures x 3 windows x 3 department scopes; route test on a fresh DB; browser check on live DOM |
| No aggregate field in the response | PASS | schema-level tests (exact key sets at 3 levels, forbidden names, one-cell-changes-only-itself); browser check scans the live response |
| Simulated rows change no value | PASS | `polluted()` fixture equals the clean one at company and department level, plus a non-vacuity test; route test with DEMO mission and simulated tasks. Mutation check: removing the filters fails 2 tests |
| Member does not see indicators from invisible missions | PASS | route test: rows in 8 mission-scoped sources on an admin-private mission leave the member's whole response unchanged, appear for the admin, and appear for the member when the mission is shared |
| Trend null when previous window empty | PASS | three trend tests (previous empty, current empty, up/down/flat); mutation of the trend rule fails |
| >= 30 server tests | PASS | 46 (36 pure + 10 route). Full suite 60 files, 1722 tests passed |
| `api-c46.mjs` passes | PASS | 23/23: admin, member, department switch, 9 `?` popovers, 1366x768 fit (modal 55..712 px, no inner scroll) |
| verify-all 10/10 | PASS | "ALL 10 STEPS PASSED" |
| tsc clean | PASS | server and web |
| a11y 0 violations | PASS | demo-mode `a11y-check` (A11Y_FAST), 51 views, 65 dialogs, 0 violations (covers DL-98 with sample data). Not re-run in api mode |

## RED/GREEN
Honest note: the pure module was drafted before its tests, so there is no RED for it by order. Instead mutation checks prove the tests bite: dropping the simulated/DEMO filters made 2 tests fail; replacing the trend rule made the trend test fail (all restored, 36/36 green). The route tests and browser check were also written after the route. First browser runs failed for script-side reasons (no DATA_MODE, device approval for a member, a strict-mode locator clash) and were fixed in the script, not by loosening assertions.

## Files
Server: `src/company/dimensions.ts`, `src/company/dimensions-routes.ts`, `src/app.ts` (register), tests `test/dimensions.test.ts`, `test/dimensions-route.test.ts`. Shared: `contracts/src/dimensions.ts`, `index.ts`. Web: `api/dimensions.ts`, `data/dimensionsDemo.ts`, `dialogs/defs/dimensions.tsx`, `help/pages/c46-dimensions.ts`, `theme/pages/c46-dimensions.css`, `components/layout/CommandCenter.tsx`, `features/agents/ServerDepartments.tsx`, `scripts/api-c46.mjs`, `docs/dialog-ledger.txt`.

## Screenshots
`web/docs/screenshots/improve-c46-dimensions-dark.png`, `improve-c46-dimensions-light.png` (api mode, 1366x768; values come from five seeded tasks and four reviews).

## Concerns
- The Environmental tag map (FM-1.4, FM-2.1) is a judgement call; confirm or empty it.
- Commit trailer: LANES.md says Opus 5.5, the session reminder says Sonnet 5.5; LANES.md was followed.
- Admin-only cells are empty for members by design; a member-visible aggregate could be added later if the owner wants it.
- The Missions KPI entry point was not added (Overview and Departments cover the brief's "pick the place").
- The first verify-all attempt was killed by my own wrapper timeout (not a failure); a second run passed. A concurrent older run was killed by pid.
