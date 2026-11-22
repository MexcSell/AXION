# c66 report: metric-gaming guard for the scorecards (R3-4)

Lane w64, branch `c66-metric-guard`, base `78e149f` (c54's tip). One migration (0050). One commit per item, nothing pushed.
Commits: cfb67d7 item 2, 9075ffb item 1, 75a7042 item 3, 39449d6 item 4, 245118b item 5, 066e942 item 6.

**Read this first (evidence honesty).** B2's "about half of episodes" figure is a motive only and is not used anywhere. The seeded-trial result below (threshold c) is a
fixture test of the flag, and it is circular: the fixture defines what "gamed" means, then checks that a flag built on that same disagreement fires. It shows the arithmetic
of the flag is sound. It is not evidence that the flag catches real gaming. No agent executes yet, so no real gaming exists to catch. Likewise, the "gameable" flag classifies what
the code permits today (a service function that takes an agent identity). It does not say an agent has written anything.

## What was built

| Item | What | Where |
|---|---|---|
| 2 | Writability inventory: 23 input fields, 23 write sites, who can reach each (human through a route, agent through a service function, system) | `shared/contracts/src/metric-guard.ts` |
| 1 | Row registry: 33 rows (11 scorecard incl. throughput, 4 KPI tiles, 18 dimension cells), each with a counter-metric or an explicit "none" with a reason, uncovered quality dimensions and input fields | `shared/contracts/src/metric-registry.ts` |
| 3 | `GET /company/metric-guard`: the registry plus the derived `gameable` flag, in plain words. The promotion rule is only a note (R3-3, owner Q13) | `server/src/company/metric-guard-routes.ts` |
| 4 | Audit scaffold: append-only `metric_audit_labels` (migration 0050), `POST /company/metric-audits` (administrators), a divergence flag with a stated bar | migration 0050, `server/src/company/metric-audit.ts` |
| 5 | UI: a shield on every scorecard row and measured KPI tile, a cue and a note-line button on dimension cells, a popover with a `?` | `web/src/components/ui/MetricGuard.tsx` and the three host files |
| 6 | Contract entries (registry, DTO, validators, coverage calls) for both routes, no allowlist line, sizes pinned | `server/test/contracts/*`, `server/test/c66-contracts.test.ts` |

### How the writability inventory works, and how it is tested against the route table
- `INPUT_FIELDS` lists the stored fields any row reads (`tasks.status`, `task_reviews.review`, `approval_requests.record`, ...), each with the tables a write goes through.
- `WRITE_SITES` lists every place that writes one: a route handler (inline SQL) or an exported service function, with the actor `kinds` it can be reached by (`human`, `agent`, `system`),
  the routes that reach it, the fields it writes, and optionally the `gate` between an agent-written value and a row.
- `ROUTE_NO_INPUT` lists the write routes that touch no input, each with a reason of at least 30 characters.
- `writabilityOf(inputs)` is pure: a row is agent-writable when any site that writes one of its inputs has `agent` in its kinds. **No row declares a flag.** The registry test fails if a row carries `gameable`, `writable` or `agentWritable`.
- Two tests keep it honest (`server/test/c66-writability.test.ts`):
  1. **Route table.** The Fastify route table is read from a running app. Every non-GET route must be reached by a site or be in `ROUTE_NO_INPUT`, exactly once, and every classified route must exist. A RED proof adds a dummy `POST /zz-score-writer` through the app's `configure` hook and shows it reported ("a write route with no classification").
  2. **Source scan.** Every `insert into` / `update` / `delete from` on an input table in `server/src` (seed and cli included), and every `type: 'mission.stateChanged'` or `action: 'agent.rollback'` emit, must be a declared (file, table) pair, and no declaration may be stale. Declared functions must be exported from their file. This is what catches a new service function that no route reaches.
- A loader test (`c66-registry.test.ts`) reads the three company loaders' SQL and fails when they read a table that no row declares as an input.
- What the inventory says today: agent-reachable inputs are reviews, failure-tag modes, lesson candidates, approval requests, delegation briefs, instances and delegation edges. Decisions, grants, catalogue edits, task status and mission runs are not.
  14 of the 33 rows are gameable by that rule (6 dimension cells, `kpi.approvals`, `kpi.staffedAgents`, `kpi.success.api`, and the verified/unverified/review scorecard rows). The list is pinned in a snapshot, so a change is a reviewed decision.
- Limits (so nobody over-reads it): the scan is at table level, not column level; an agent that could write through a path the code does not have is out of scope; and `eval_runs` has no writer in `server/src` on purpose (c53), so the scan fails if one appears.

## RED / GREEN evidence

| Item | RED (before the code, first error line) | GREEN |
|---|---|---|
| 2 inventory | First run of `c66-writability.test.ts`: `every insert/update/delete on an input table ... is a declared site` failed with `instances/backfill.ts is declared as a writer of agent_instances but the source no longer writes it (stale site)` (my own over-declaration, found by the scan). In-test RED proofs: a dummy route, an undeclared writer, a stale declaration and a missing function are each reported. | 8/8 |
| 1 registry | First run of `c66-registry.test.ts`: `tables read by a loader that no row declares as an input: expected [ 'audit_events', 'events' ]`. The snapshot first listed `scorecard.finished` and `kpi.activeMissions` as gameable because `requestApproval` and `settleMission` were one site; I split it (an agent request never writes a mission state), re-ran, and reviewed the snapshot. In-test RED proofs: a live row without an entry, a filler counter-metric, a self reference, empty uncovered, a hand-typed flag. | 5/5 |
| 3 route | `c66-metric-guard-route.test.ts` on the unchanged server: `expected 404 to be 401`, 3 of 4 failed. | 4/4; `server/test/contracts` 15/15 |
| 4 audit | `c66-audit-flag.test.ts`: `Cannot find module '../src/company/metric-audit.ts'`. `c66-metric-audits.test.ts`: `expected 404 to be 401`, 8 of 8 failed. After the route: the contract run failed `routes without a contract-valid 2xx call: [ 'POST /company/metric-audits' ]`, then `every object array was filled and every nullable field was non-null` until the flow posted 64 labels. | audit-flag 6/6, audits 8/8, contracts 15/15 |
| 5 UI | `api-c66.mjs` on the unchanged UI: `FAIL every scorecard row has a guard button`, 3/7 before the script stopped. | 24/24 |
| 6 contracts | The entries were added with their routes (items 3 and 4), because the c50 inventory and coverage tests fail the build otherwise (the RED lines above). The item 6 commit adds a pin test: 4/4. No honest RED exists for it on its own. | 4/4 |

## Measured trial rates (item 4) and the circularity caveat

Setup (fixed before any trial, in `server/test/c66-audit-flag.test.ts`): bar 15% (three times the assumed 5% auditor error), minimum 60 audited samples. A sample is "gamed" with probability g
when the metric counted it a success while a person finds it is not. Otherwise the metric equals the truth. The auditor reports the truth, flipped with probability e. 1,000 seeded trials per cell (`mulberry32`).

Threshold case (chosen in advance): 100 samples per audit, e = 5%.

| Seeds | gamed 20% fires (need >= 95%) | gamed 0% fires (need <= 5%) |
|---|---|---|
| 660001.. (design) | 97.8% | 0.1% |
| 9900001.. (fresh) | 98.9% | 0.0% |

Full grid, seed 660001 (no cell dropped, nothing tuned after seeing it):

| sample n | auditor error | 20% gamed fires | 0% gamed fires | skipped (n below minimum) |
|---|---|---|---|---|
| 30 | any | n/a | n/a | all (below the minimum, the row says "not enough audited samples") |
| 60 | 0% | 87.6% | 0.0% | none |
| 60 | 5% | 94.8% | 0.2% | none |
| 60 | 10% | 98.2% | 14.7% | none |
| 100 | 0% | 92.3% | 0.0% | none |
| 100 | 5% | 97.8% | 0.1% | none |
| 100 | 10% | 99.5% | 8.2% | none |
| 200 | 0% | 97.4% | 0.0% | none |
| 200 | 5% | 99.7% | 0.0% | none |
| 200 | 10% | 100.0% | 2.0% | none |

Reading it honestly: the threshold holds at 100 samples and 5% auditor error. It does **not** hold everywhere. At the 60-sample minimum the fire rate at 20% gamed is 94.8% (just under 95%) and with a 10% auditor error
the false alarm rate is 14.7%. At 100 samples with no auditor error it is 92.3% (a 20% share is only about 4 standard errors above a 15% bar, so binomial spread alone costs power). The minimum of 60 therefore lets the flag be evaluated at a sample size where
the 95% claim does not yet hold; I left it at 60 because I did not tune it after seeing the grid. The 0%-gamed rate is trivially 0 without auditor noise, so the table varies it. Circularity: every number above
is a property of the arithmetic of "disagreements at or above a bar on n samples", under a model the fixture itself defines. None of it says a real gamed agent would produce 20% disagreement, or that a real auditor errs at 5%.

## Pass threshold

| Item | Result | Evidence |
|---|---|---|
| Items 1-6 RED -> GREEN | PASS, with the item 6 note | table above |
| (a) 100% of rows declare counter-metric / uncovered / inputs, enforced by a contract test over the registry | PASS | `c66-registry.test.ts`: 33 live rows (taken from the pure functions' output and the command center source) and 33 entries, 0 problems. 9 rows declare an explicit "no known counter-metric" with a reason |
| (b) an agent-writable field feeding a row is flagged in 100% of cases | PASS | `c66-writability.test.ts`: every one of the fields with an agent site flags a one-input row; every other field does not |
| (c) seeded 20% gamed fires >= 95% of 1,000 trials; 0% gamed <= 5% | PASS at the stated case (100 samples, 5% error), NOT MET at the 60-sample minimum | tables above. Circular, see the caveat |
| Every c46 and c54 test passes unchanged | PASS | `git diff 78e149f` shows no change to `dimensions*.test.ts`, `clock-bounds.test.ts`, `c54*` tests or to `api-c46.mjs`, `api-c06.mjs`, `api-stage6.mjs`, `api-improve.mjs`. The only edit to an existing c50 test file is 4 added lines in `coverage.test.ts` (new calls for the two new routes). Nothing was tightened or loosened; `allowlists.ts` and `exercised.ts` are untouched. |
| Full vitest (serial fallback; name every failure) and tsc | PASS | `heavy.sh npx vitest run` at default workers (load 11-15): 78 files, 2165 tests passed, 0 failed, 0 connection errors, so the serial fallback was not needed. `tsc --noEmit` is clean for server and web. |
| api-c46, api-c06, api-stage6, improve | PASS | api-c46 36/36, api-c06 25/25, api-stage6 94/94, api-improve 107/107 (all unchanged scripts, `E2E_API_PORT=11492 E2E_WEB_PORT=11493`, db axion_e2e9). The new `api-c66.mjs` is 24/24. |
| verify-all 10/10 | PASS | "verify-all: ALL 10 STEPS PASSED" (OUT=/tmp/axion-verify-w64, dev server on :11490, load 11-15; it took about 19 minutes). |
| fit-check and a11y clean in both modes | PASS | `fit-check.mjs 1366 768`: "ALL FIT", every route and tab mainOver 0. `a11y-check` demo: 51 views, 64 dialogs, 0 violations. `a11y-check` api: 41 views, 64 dialogs, 0 violations (the "probe ... fail" lines are the script's deliberate injected 500s). `api-c66` also checks, at 1366x768, that rows are still 18 px, dimension cells still 37 px, the note line 28 px and no page scroll. |

## Screenshots
`web/docs/screenshots/improve-c66-overview-dark.png`, `improve-c66-dimensions-dark.png`, `improve-c66-guard-open-dark.png`, `improve-c66-guard-open-light.png`.

## Files changed
```
git diff --stat 78e149f..HEAD (27 files, +1332 -9)
server/migrations/0050_metric_audit_labels.{up,down}.sql
server/src/app.ts                         (registers the route file)
server/src/company/metric-audit.ts        (pure divergence arithmetic, bar 15%, minimum 60)
server/src/company/metric-guard-routes.ts (GET /company/metric-guard, POST /company/metric-audits)
shared/contracts/src/metric-guard.ts      (inventory: fields, write sites, route classification, writabilityOf)
shared/contracts/src/metric-registry.ts   (33 rows, guardOf, registryProblems, DTO types)
shared/contracts/src/index.ts
server/test/c66-writability.test.ts, c66-registry.test.ts (+ snapshot), c66-metric-guard-route.test.ts,
  c66-audit-flag.test.ts, c66-metric-audits.test.ts, c66-contracts.test.ts
server/test/contracts/writability.ts, registry.ts, validators.ts, coverage.test.ts (additions only)
web/src/api/metricGuard.ts, web/src/components/ui/MetricGuard.tsx, web/src/help/pages/c66-metric-guard.ts, web/src/theme/pages/c66-metric-guard.css
web/src/components/layout/CommandCenter.tsx, PageFrame.tsx, web/src/features/agents/Dimensions.tsx
web/scripts/api-c66.mjs
web/docs/screenshots/improve-c66-*.png (4), this report
```

## Concerns
1. **The flag is a statement about code paths, not behaviour.** No route lets a client name an agent and agents do not execute, so today nothing agent-written exists. The flags will change when Stage 7 adds an executor and its write sites. The inventory test is what forces that update, but it works at table level.
2. ~~The minimum audit size (60) was below the size at which the 95% claim holds.~~ Fixed in the fix round: the minimum is now 100.
3. ~~`verified_success_rate` and its relatives are flagged gameable through `mission_delegations.edge`.~~ **Wrong, corrected in the fix round:** the instance service writes only `delegated` edges, and the verified rule reads `verifies` edges, which no agent-reachable code writes. The flag was an over-flag from table-level granularity. The field is now split by edge kind and those three rows are not gameable.
4. **DEMO-only KPI tiles** (Operations, Agents pages, and the demo Overview) show invented numbers. They have no registry row and no guard (listed in the test as an explicit exclusion). Department facts (`/departments`) are counts with n and window, not scorecard or dimension rows, and are not covered; flag if the controller wants them.
5. **Existing popover behaviour.** Escape closes a tooltip before a popover, and clicking another trigger does not dismiss an open popover (the help popovers behave the same, so I did not change shared behaviour). The new check closes popovers through their close button.
6. **Counter-metrics are my reading of the data, not a measured relation.** Each says what would rise if the number were gamed; none was tested against real gaming. A reviewer should read the 33 sentences.
7. **Migration 0050** adds a table with no demo link, so the demo purge neither reads nor removes labels; it carries the standard four guards anyway (UPDATE, DELETE, TRUNCATE, purge exception). If c60's "every column mapped" OTel test is in the integration tree, `metric_audit_labels` needs a row in the mapping table at merge time (this base has no such test).
8. The audit labels are binary (the metric counted it / the person agrees). A richer rubric, and a periodic reminder to audit, are not built.

## Fix round (review: CLEAR AFTER FIXES)

Base `138b201`. One commit per item. Each item was test-first (RED on 138b201, then GREEN).
Commits: 0bdf12f S1, 40ce588 S2, 13bbcb6 S3, 0937eed minors, and the report commit that follows.

| Item | Result | RED then GREEN |
|---|---|---|
| S1 scan holes | DONE | RED: the reviewer's probe strings, `insert into public.task_reviews` first (`expected [] to deeply equal [ StringMatching ]`), then templated names, and `scanCallers is not a function`. GREEN 13/13 in `c66-writability.test.ts`. The scan now reads `insert into`, `update [only]`, `delete from [only]`, `merge into`, `truncate [table] [only]` and `copy`, on a bare, schema-qualified or quoted table, over several lines. A templated name (`${...}`) is reported as `file\|${templated}` and fails unless declared. A caller scan compares the importers of 16 exported write helpers (`insertDelegation`, `insertInstance`, `joinMission`, `setInstanceState`, `attachSimBrief`, `proposeLesson`, `createTag`, `decideTag`, `recordReview`, `createBrief`, `requestApproval`, `consumeApproval`, `settleMission`, `createOrgRevision`, `switchVersion`, `addVersion`) with `HELPER_CALLERS`. RED proof: a fake new caller of `insertDelegation`, a stale caller and an unknown helper are each reported. |
| S2 headline over-flag | DONE | RED: the snapshot still listed `kpi.success.api`, `scorecard.completed_unverified` and `scorecard.verified_success_rate`. `mission_delegations.edge` is split into `delegated_edge` (written by the agent-reachable `joinMission`, with a gate note) and `verifies_edge` (no agent-reachable writer). GREEN: those three rows are not gameable, **11 of 33 rows are gameable** (was 14), pinned in the snapshot and by an explicit count. |
| S3 minimum 100 | DONE | RED: `expected 60 to be 100` (3 tests). `AUDIT_BAR` and `AUDIT_MIN_N` moved to the shared contracts, so the help text reads the constants. Tests, the coverage flow (100 labels, 20 disagreeing) and api-c66 (100 labels, 22%) updated. |
| Minors | DONE | RED: `expected ... to contain 'task reviews'`. The popover says no agent executes today and who enters the labels (and that the metric label is typed, so a flag is only as good as the sampling); plain words replace function names; the compact guard has a 24 px hit area under `(pointer: coarse), (max-width: 720px)` through negative margins (api-c66 measures 24x24 with the row still 18 px at 390 px); the help notes that the demo-only tiles and `/departments` facts are not covered. api-c66 is now 26/26. |

### Remaining limits of the writability scan (also in the test header)
Literal SQL in `server/src` only: SQL in scripts or migrations is not seen. Triggers and foreign-key cascades are not seen (checked by hand: no trigger writes an input table; `DELETE /missions/:id` and `clearDemo` cascade, both human or system). The scan is at table level, so a new column written by an agent site on a declared table is invisible. The caller scan covers helpers by name and by import, not what a caller passes as an argument. Which kinds reach a site is typed by hand in `WRITE_SITES` and checked against the code by review, so threshold (b) re-derives those typed kinds and is close to a tautology.

### Trial rates after the change (minimum audit size 100)
At n = 100 and 5% auditor error the rates are the same as before, because the seeds and model are unchanged: seed 660001: 20% gamed fires **97.8%**, 0% gamed fires **0.1%**; fresh seed 9900001: **98.9%** and **0.0%**. Threshold (c) is PASS at every size the flag can now be evaluated at, with 5% auditor error (100: 97.8 / 0.1, 200: 99.7 / 0.0). It is still not met at 100 samples with no auditor noise (92.3%) and the 10% auditor-error false-alarm rate at 100 samples is 8.2%. Still circular. Full grid, seed 660001, 1,000 trials per cell (the two n = 60 rows were measured with the old minimum of 60; the flag no longer evaluates below 100):

| sample n | auditor error | 20% gamed fires | 0% gamed fires | note |
|---|---|---|---|---|
| 30 | any | n/a | n/a | below the minimum |
| 60 | 0% | 87.6% | 0.0% | now below the minimum (measured before the change) |
| 60 | 5% | 94.8% | 0.2% | now below the minimum (measured before the change) |
| 60 | 10% | 98.2% | 14.7% | now below the minimum (measured before the change) |
| 100 | 0% | 92.3% | 0.0% | |
| 100 | 5% | 97.8% | 0.1% | |
| 100 | 10% | 99.5% | 8.2% | |
| 200 | 0% | 97.4% | 0.0% | |
| 200 | 5% | 99.7% | 0.0% | |
| 200 | 10% | 100.0% | 2.0% | |

### Re-run results
- tsc: server and web clean.
- Full vitest via heavy.sh at default workers (concurrent with the browser checks, load high): 79 files, 2175 tests, **2 failed**, both in `test/seed.test.ts` with `too many connections for role "axion"` (the shared 45-connection cap): `demo seed > runs automatically when the first admin registers (DEMO_SEED)` and `demo clear after a decision > removes demo missions even when one of their approvals was decided (append-only decisions cascade)` (the second also `Called end on pool more than once`, a consequence of the first). Serial fallback (`--maxWorkers=1 --no-file-parallelism`) on that file: 3/3 passed. So 2173 passed first time, the other 2 on the serial rerun, and no failure is a c66 test.
- api-c66 26/26, api-c46 36/36, api-stage6 94/94 (heavy.sh api-e2e.sh, ports 11492/11493, db axion_e2e9).
- api-mobile: "NO FAILURES". Its SMALL-target notes are informational (the script does not fail on them); the compact guard is still listed once, now at 24x24 instead of 14x14 (the script's own bar is higher than the 24 px asked for).
- fit-check 1366x768: ALL FIT. a11y api: 41 views, 64 dialogs, 0 violations.
- Dev server on 11490 stopped; ports 11490-11493 are free.
