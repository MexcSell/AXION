# Cycle 2 report: an honest company scorecard from recorded events (theme B)

Implementer report for `c02-brief.md`. Branch `improve-30h`, base `b2c02ed`.

## What was built

### Server
- **No migration and no new event.** The scorecard reads only existing tables.
- **Contracts** (`shared/contracts/src/company.ts`): `SCORECARD_WINDOWS`, `ScorecardRow`
  `{key, label, value: number|null, unit: '%'|'h'|'missions', n, evidence, state: 'ok'|'none'}` and `CompanyScorecardDto`
  `{window, from, to, includeDemo, rows}`.
- **Pure function** `computeScorecard(input, {window, from, to, includeDemo})` (`server/src/company/scorecard.ts`) plus `windowOf`.
  - The input is rows only: missions, runs, `mission.stateChanged` transitions (payload `from`/`to`), tasks, task attempts,
    approval decisions and delegations.
  - Rows of any mission that is not in the input mission set are ignored inside the function too. The route already
    scopes them, so this is a second guard.
  - Windows are inclusive at both ends. Rates and medians need n ≥ 3 (`MIN_N`); below that the row has
    `value: null, state: 'none'`.
  - Rates are percentages with one decimal. Hours are rounded to two decimals.
- **Route** `GET /api/v1/company/scorecard?window=7d|30d|90d&includeDemo=0|1` (`server/src/company/routes.ts`, registered in
  `app.ts`).
  - Any signed-in user can call it; anonymous callers get 401.
  - Parameters are checked with zod: an unknown window or `includeDemo` value is 400.
  - The mission set is `tenant_id = caller's tenant and deleted_at is null and VISIBLE_SQL and (includeDemo or not demo)`.
    That is the same rule as the mission list. Every other table is read only for those mission ids, and also filtered by
    tenant where the table has one.
- **Rows**:

  | key | value | n |
  |---|---|---|
  | `started` | missions whose first run (`min(mission_runs.started_at)`) is in the window | the count |
  | `finished` | missions whose final moment (see D1) is in the window | the count |
  | `verified_success_rate` | verified completions ÷ finished (null if finished < 3) | finished |
  | `completed_unverified` | completions that are not verified | completions |
  | `median_cycle_time_h` | first run start → final moment, median (null if n < 3) | finished missions that had a run |
  | `failure_rate` | (failed + canceled) ÷ finished (null if finished < 3) | finished |
  | `task_recovery_rate` | retried tasks that are `passed` ÷ tasks with more than one attempt (null if n < 3) | tasks with more than one attempt |
  | `waiting_approval_median_h` | median length of closed `waiting_approval` stays (null if n < 3) | closed waits (see D5) |

  Evidence sentences name the counts, for example `3 of 7 finished missions verified · 2 completed unverified`.
- `server/README.md`: the route is documented, and the test count is updated.

### Web
- **`web/src/api/scorecard.ts`**: `useScorecard(window, includeDemo)`.
  - One shared zustand cache per query, so the tile, the panel and the Missions header share one read.
  - A slower, older response never overwrites a newer one.
  - `bumpScorecard` triggers a re-read; `fmtRow` shows "—" for `state: 'none'`. It never branches on truthiness, so 0 is
    a value.
- **`web/src/api/events.ts`**: a debounced (400 ms) re-read on `mission.stateChanged`, `task.stateChanged`, `mission.shared`
  and `mission.deleted`, and on every stream reconnect. The debounce is cancelled on sign-out and the cache is cleared.
- **Overview, api mode** (`CommandCenter.tsx`, `Overview.tsx`):
  - **Verified Success tile.**
    - With evidence, it shows the server's `verified_success_rate` with an `n=…` badge beside the value (evidence sentence
      in its tooltip) and "finished missions · 30 days" under it.
    - Without evidence, it shows "not enough evidence" (no %) with the `n=0` badge.
    - The badge sits beside the value, not in the hint line, because short screens hide the hint (`frame.css`, max-height
      860px). The n stays visible at 1366×650; the browser check asserts this.
    - No delta; help key `kpi.success.api`.
  - **Tokens Today tile:** removed.
  - **Active Missions tile:** the fake `+2` delta is removed.
  - **Company Scorecard panel:** replaces the DEMO "Company Health" ring (98, "12 / 12", "99.9%", untagged) as the top-board
    aside.
    - It lists all 8 rows: icon, label, value or "—", `n=…`, and a `?` per row.
    - The tooltip on each row gives the evidence sentence, the window with its dates, "missions you can see", and "DEMO
      included" when the switch is on.
    - Controls: a 7d/30d/90d switch, and an "include DEMO missions" switch (off by default). With the switch on, the panel
      header shows a DEMO tag.
    - The footer shows the date range.
  - The demo-only Period select is hidden in api mode; it only ever showed a "(demo)" toast.
- **`KpiTile`** (`PageFrame.tsx`): two new optional fields, `text` (replaces the counted-up number) and `badge` (a small note
  beside the value that stays visible on short screens). Neither is set in demo mode, so the demo path renders exactly as
  before.
- **Missions list header, api mode:** `N open · 0.0% verified success (n=3)` (server value, 30d, DEMO excluded), with the
  evidence in a tooltip. With no evidence it shows only `N open`.
- **Demo mode is unchanged:** the 96.4% / +2.1% / 1.84M / +2 tiles, the Company Health ring and the Missions header
  "96.4% success rate".
- **Help:** new entries `company.scorecard`, `kpi.success.api` and `scorecard.<each of the 8 keys>`. They explain what counts
  as verified, the n ≥ 3 rule and why rows are empty (nothing executes yet).

## Choices where the brief left one
- **D1. Final moment.** A mission's final moment is its last transition into completed, failed or canceled at or before `to`.
  Transitions out of `archived` don't count, because a restore re-emits the old final state. The mission is finished in the
  window when that moment falls inside it, and its outcome is that transition's `to`.
  - Each mission counts once: fail → retry → complete counts as completed, and archive with `cancelFirst` counts as one
    cancel.
  - A mission that failed and is now running again (retried) still counts as failed: the failure was recorded.
- **D2. Verified.** "An approval decision by a human other than the owner" is read strictly. Only an **approved** decision
  counts; a denial is not a verification. It must be made by a user row of the same tenant (not `system`), be different
  from the mission owner, and be decided **at or before** the completion.
  - The task route requires at least one task (so a mission with no tasks is never verified by default), and the
    `verifies` delegation must be real (`simulated = false`). A simulated fixture edge is not evidence.
  - Each of these choices is stricter than a literal reading, so none can inflate the rate.
- **D3. Counts are always `state: 'ok'`.** `started`, `finished` and `completed_unverified` are measured facts, so 0 is
  shown as 0. Only rates and medians use `none`/null.
- **D4. Task recovery window.** `task_attempts` has no creation time, and `started_at` can be null since 0009. A task is
  placed in the window by its latest non-null `started_at`/`finished_at` over all its attempts. A task with no timestamp at
  all is left out.
- **D5. n of the approval-wait row.** It counts closed waits, not missions: a mission can wait several times, and a pause ends
  a wait. A wait that is still open is not counted. A wait counts in the window where it ended.
- **D6. Cycle time** counts only finished missions that had a run. A mission canceled while still planning is finished but
  has no run start.
- **D7. The tile and the Missions header are pinned to 30d with DEMO excluded.** The panel's switches affect only the panel.
- **D8. Browser seam: none added.** The check drives missions only through API user actions: create, `start` (planning →
  running inserts a run), then `cancel`. The script retries on a 409 when the staffing step changed the status meanwhile.
  `server/src/cli/e2e-serve.ts` is unchanged, and so is the production app.
  - The honest result is three canceled missions: verified success **0.0%** with n=3, failure rate 100%.
  - DEMO exclusion is tested by canceling one seeded DEMO mission (M-134) the same way. It is counted only with
    `includeDemo=1`. Seeded DEMO missions carry no state history, so without this step the check would be vacuous.

## TDD evidence

RED, with the tests written first and before any implementation
(`cd server && npx vitest run test/scorecard.test.ts test/company.test.ts`):
```
 FAIL  test/scorecard.test.ts [ test/scorecard.test.ts ]
Error: Cannot find module '../src/company/scorecard.ts' imported from /home/luca/AXION/server/test/scorecard.test.ts
 FAIL  test/company.test.ts > access and parameters > anonymous is 401
AssertionError: expected 404 to be 401 // Object.is equality
 FAIL  test/company.test.ts > access and parameters > an unknown window or includeDemo value is 400
AssertionError: expected 404 to be 400 // Object.is equality
 FAIL  test/company.test.ts > access and parameters > a fresh database: defaults 30d / demo excluded, no evidence for any rate
 … (all 8 route tests: expected 404 to be 200)
 Test Files  2 failed (2)
```
On the first GREEN run, two pure tests failed for a fixture reason: their tasks belonged to a mission missing from the
input set, and the function correctly ignored them. The fix added the mission to those fixtures; no assertion changed.
Then:
```
 Test Files  2 passed (2)
      Tests  26 passed (26)
```
Full suite (`cd server && npx tsc --noEmit -p . && npx vitest run`):
```
TSC OK
 Test Files  21 passed (21)
      Tests  284 passed (284)
```

Tests added:
- `server/test/scorecard.test.ts`, 18 pure tests:
  - windows;
  - the empty history;
  - each row with its n threshold (null below 3);
  - window boundaries (exactly at `from` counts, 1 ms earlier doesn't);
  - first run vs a later run;
  - a restore is not a finish; fail → retry → complete counts once;
  - verified vs unverified: another human, the owner, a non-human, a decision after completion, a denial, tasks +
    `verifies`, a missing edge, an open task, no tasks, a simulated edge;
  - attempts with a null `started_at`;
  - a pause ends a wait, and an open wait is not counted;
  - rows of missions outside the set are ignored.
- `server/test/company.test.ts`, 8 route tests:
  - 401 for anonymous; 400 for bad parameters;
  - the fresh-database defaults;
  - an admin sees all missions of the tenant (DEMO, deleted and other-tenant missions are excluded);
  - a member never counts a private mission they can't see, including its task-recovery and approval-wait rows;
  - DEMO is counted only with `includeDemo=1`;
  - another tenant's missions never count, including its shared mission's approval wait;
  - every task passed + a `verifies` delegation verifies a completion; the owner's own approval does not.

## Pass threshold

| # | Item | Result | Evidence |
|---|---|---|---|
| 1 | Server tests pass; the whole suite stays green | **PASS** | 284/284 tests, `tsc` clean (above) |
| 2 | In api mode, no company performance number on Overview or in the Missions header is a hard-coded constant; Tokens tile removed | **PASS** | `api-improve.mjs` "c02 api mode: no invented company numbers on the top board (no Tokens Today, no 96.4%, no trend delta, no DEMO health ring)" |
| 2a | A fresh database shows "not enough evidence" (no %) | **PASS** | "c02 fresh database: the tile says "not enough evidence" with no %, n=0", "the scorecard row shows "—" and n=0", "the Missions list header shows no success rate" |
| 2b | After API-driven final states, the success row shows the server's value with its n | **PASS** | "the server counts the 3 canceled missions …", "the tile follows live (no reload): the server value 0.0% with n=3", "the panel rows show the server values and n", "the Missions list header shows the server rate with n" |
| 2c | DEMO missions are excluded by default; the switch adds the DEMO tag | **PASS** | "a canceled DEMO mission (M-134) is not counted by default; with includeDemo=1 it is — default 3, with DEMO 4", ""include DEMO missions" on: the panel is tagged DEMO and counts 4 finished" |
| 3 | `verify-all.sh` (demo mode) green; demo mode keeps today's numbers | **PASS** | `./scripts/verify-all.sh` rc=0: build ✓, route×tab crawl 77 views NO PROBLEMS, deep crawl NO PROBLEMS, flows / auth flow / u1 flows no errors, dialog smoke 106 checks 0 failures, all help keys defined, fs guard OK. The demo path keeps its constants (96.4% / +2.1%, 1.84M, +2, the health ring, "96.4% success rate") in the `!isApi()` branch, unchanged |

Other verification:
- `cd web && npx tsc --noEmit -p .`: clean.
- `./scripts/api-e2e.sh api-auth-flow.mjs api-flows.mjs api-stage6.mjs api-improve.mjs`: 15/15, 23/23, 93/94 and 49/49.
  - The one failure was in api-stage6 ("I2: a real mission's Reports tab says reports arrive…", an 8 s wait right after the
    simulated server restart in that script).
  - Rerunning api-stage6 alone gave 94/94. The check does not involve the scorecard (see Concerns).
  - Two earlier `api-improve.mjs` runs failed on things that are fixed now. One was my own header overlap: the DEMO
    switch sat under the window switch, which is why the switch went back to the footer. The other was a cycle 1 race,
    seen twice.
  - The race: after P3 is created, A's or C's re-read on `org.proposalCreated` could land after the script moved P3's
    expiry into the past. The server then expired P3 on that read, the card left B's Pending filter, and the Approve
    click timed out.
  - The fix waits 1.5 s for those re-reads to finish before the expiry. No assertion changed. The final two runs passed
    50/50 each (the c02 section now also checks 1366×650).
- `node scripts/ov-fit.mjs` (demo mode, 5190): **NO SCROLL ANYWHERE** (8 sizes × 4 tabs).
- `./scripts/api-e2e.sh "DATA_MODE=api node scripts/ov-fit.mjs …"` (api mode, where the new panel is): **NO SCROLL ANYWHERE**
  (8 sizes × 4 tabs).
  - The Pulse region keeps about the demo-mode height: 611 px vs 622 px at 1672×941, and 320 px vs 321 px at 1366×650.

## Files changed
- New:
  - `server/src/company/scorecard.ts`
  - `server/src/company/routes.ts`
  - `server/test/scorecard.test.ts`
  - `server/test/company.test.ts`
  - `shared/contracts/src/company.ts`
  - `web/src/api/scorecard.ts`
  - `web/docs/screenshots/improve-c02-scorecard-dark.png`
  - this report
- Changed:
  - `server/src/app.ts` (registers the route)
  - `server/README.md`
  - `shared/contracts/src/index.ts`
  - `web/src/api/events.ts`
  - `web/src/components/layout/CommandCenter.tsx`
  - `web/src/components/layout/PageFrame.tsx` (optional `text`)
  - `web/src/pages/Overview.tsx`
  - `web/src/pages/Missions.tsx`
  - `web/src/help/registry.ts`
  - `web/src/theme/frame.css`
  - `web/src/theme/pages.css`
  - `web/scripts/api-improve.mjs` (c02 section; the cycle 1 flow is unchanged)

Screenshot: `web/docs/screenshots/improve-c02-scorecard-dark.png`. It shows api-mode Overview at 1600×940, dark, after the
three canceled missions, with the DEMO switch off and the window at 30d. Write it with
`DOC_SHOT_C02=docs/screenshots/improve-c02-scorecard-dark.png ./scripts/api-e2e.sh api-improve.mjs`.

## Concerns
- **Only cancel is reachable, so the browser check proves a 0.0% rate.**
  - Complete and fail are system-only actions, so in the browser the only honest final state is canceled.
  - Non-zero verified rates, approvals, waits and task recovery are covered only by the server tests (direct SQL
    fixtures).
  - A positive rate in the browser would need a test-only seam in `e2e-serve.ts`, which I chose not to add.
- **Most rows will stay "—" on the live system** until Stage 7 executes work. Nothing enters `waiting_approval` through a
  recorded event today: only the DEMO seed sets that status directly, and `requestApproval` does not move missions. Tasks
  are never retried by execution. This is the intended honest outcome.
- **The staffing simulation's planning → running event carries `simulated: true`, also on real missions.** The scorecard
  uses it like any other transition (it only creates the run that "started" counts). A reviewer may want "started" to
  require a user `start`; today the run row is what counts.
- **The Company Health ring is gone in api mode.** It was untagged DEMO data, and the Health tab still has the service view.
  If the owner wants it back, it needs real checks or a DEMO tag.
- **Performance.** Every `mission.stateChanged` event of the visible missions is loaded on each read. With debounced reads
  that is fine at current sizes; at scale, a `(tenant_id, type, mission_id)` index or an incremental table would be the next
  step, and that needs migration 0014.
- **Flaky browser checks.**
  - api-stage6 I2 failed once in the combined run and passed alone (94/94). It is unrelated to this change and could be
    made more robust in a later cycle.
  - The cycle 1 expiry race in `api-improve.mjs` is mitigated with a settle wait (see above), not removed. Expiry on read
    by any client can still race with a fixed DB update.
- **Threshold item 2 covers the top board and the Missions header.** The rest of the api-mode Overview body still shows
  prototype panels. Most carry a DEMO tag: Mission Pipeline, Verified Completions, Health. "Recent Verified Outcomes" (with
  its "+N") and the Active Agents board have no tag. They are list items from mission data, not company-level rates, and
  I left them for a later cycle rather than widen this one.
