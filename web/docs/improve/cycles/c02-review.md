# Cycle 2 review: honest company scorecard (theme B)

Independent reviewer. Range `b2c02ed..c615458` on `improve-30h`. Inputs: `c02-brief.md`, PROCESS.md "Safety rules",
`c02-report.md`, and the diff (screenshots excluded). I only looked outside the diff to check named risks.

**Method and limits.** This was a read-only review. I ran no tests, servers or databases: vitest writes to `axion_test`,
and the browser checks and ov-fit need servers. The tags below say how each item was checked:
- **[read]**: I checked it myself by reading code.
- **[claimed]**: the implementer reports it and I did not reproduce it.

The [claimed] items are:
- server 284/284 and `tsc` clean;
- `api-improve.mjs` 50/50 (the last two runs);
- api-stage6 93/94 in the combined run, 94/94 alone;
- `verify-all.sh` green;
- ov-fit NO SCROLL in demo mode and in api mode.

## Verdicts

- **Spec compliance: PASS.** Every pass-threshold item is met as written.
- **Quality: APPROVE WITH ONE FIX (1 Important, 7 Minor).** The server side is correct and well scoped. The one
  Important finding is an unmeasured number left on the top board that the cycle claims to have cleaned.

## 1. Spec compliance (brief item by item)

| Brief item | Result | Evidence |
|---|---|---|
| New `server/src/company/`: pure function plus route | ✓ [read] | `server/src/company/scorecard.ts` (`computeScorecard`, `windowOf`); `server/src/company/routes.ts`; registered at `server/src/app.ts` (`companyRoutes`, `/api/v1`) |
| `GET /company/scorecard?window=7d\|30d\|90d&includeDemo=0\|1`, default 30d, demo excluded | ✓ [read] | `routes.ts:9` zod enum with `.default('30d')` and `.default('0')`; a bad value gives 400 via `parse`; tested in `company.test.ts` "unknown window…400" and "fresh database: defaults" |
| Any signed-in user; counts only visible missions (`VISIBLE_SQL`) | ✓ [read] | `routes.ts:18` `requireUser`; `routes.ts:24` `tenant_id=$1 and deleted_at is null and VISIBLE_SQL('$2','$3') and ($4 or not demo)`. This is the same predicate and parameters as the mission list (`missions/service.ts:85`) |
| Response `{window, from, to, includeDemo, rows}`; Row `{key,label,value,unit,n,evidence,state}` | ✓ [read] | `shared/contracts/src/company.ts`; `scorecard.ts` return value; pure test "the response carries the window…" |
| Rows use only the listed tables; state history from `mission.stateChanged` events | ✓ [read] | `routes.ts:28-39` reads `mission_runs`, `events` (type `mission.stateChanged`, payload `from`/`to`), `tasks`, `task_attempts`, `approval_requests`/`approval_decisions` and `mission_delegations`. The last one is not on the brief's list, but the brief's own verified rule needs the `verifies` delegation, so it is implied |
| started, finished, verified rate (null < 3), completed_unverified, median cycle (null < 3), failure rate (null < 3), task recovery (null < 3), waiting_approval median (null < 3) | ✓ [read] | See §3 |
| Evidence sentence names both counts ("3 of 7 … verified · 2 completed unverified") | ✓ [read] | `scorecard.ts` `verifiedSentence`; asserted exactly in `company.test.ts` and `scorecard.test.ts` |
| No new event; the client re-reads on `mission.stateChanged`/`task.stateChanged`, debounced | ✓ [read] | `web/src/api/events.ts` `scorecard = debounceKeyed(…, 400)`, also triggered by `mission.shared`/`mission.deleted` and on reconnect; cancelled on sign-out |
| Tests: pure per-row tests incl. n thresholds and window boundaries; verified vs unverified; demo; member/private; other tenant; admin | ✓ [read] | `server/test/scorecard.test.ts` (18), `server/test/company.test.ts` (8); detail in §3 |
| Overview api mode: tile shows `verified_success_rate` with n, or "not enough evidence" with evidence in a tooltip; no fake delta; Tokens tile removed | ✓ [read] | `CommandCenter.tsx:30-52`. The n is a `badge` beside the value, not the hint; this is a reasoned deviation because the hint is hidden on short screens, and the n is still shown |
| "Company scorecard" panel: all rows, value or "—", n, window, evidence, 7d/30d/90d switch, include-DEMO switch (off by default) with a DEMO tag | ✓ [read] | `CommandCenter.tsx` `CompanyScorecard`; window in the footer and row tooltip, evidence in the row tooltip |
| Panel placement keeps the one-screen rule; ov-fit NO SCROLL | ✓ [claimed] | It replaces the `CompanyHealth` aside in api mode (`Overview.tsx:42`), which the brief allows. `_session.mjs:8` honours `DATA_MODE=api`, so the implementer's api-mode ov-fit run is meaningful. That run is the only fit evidence for the new panel, because default ov-fit uses demo mode on 5190 |
| Missions header, api mode: verified rate with n, or nothing | ✓ [read] | `Missions.tsx:285` plus `ListSuccess` |
| Demo mode unchanged | ✓ [read] | Demo tiles, ring, Period select and "96.4% success rate" are kept verbatim in the `!isApi()` branches. `KpiTile` changes apply only when `text`/`badge` are set, which demo mode never does |
| `?` help for the scorecard and each row | ✓ [read] | `help/registry.ts`: `company.scorecard`, `kpi.success.api`, `scorecard.<8 keys>`; e2e asserts 8 row `?` buttons |
| Browser check (fresh DB "not enough evidence"; ≥ 3 missions to terminal states through the API, documented; tile and panel show the server's numbers and n; DEMO switch adds the tag) | ✓ [read] / [claimed] for the pass | `web/scripts/api-improve.mjs` c02 sections. The terminal states are 3 cancels through user actions, documented as D8. Only 0.0% is provable in the browser (see Concerns); the brief allowed "whatever the existing e2e or test seam allows" |
| No migration; no live system touched | ✓ [read] | No files under `migrations/`; the scripts use 5192/5193 and `axion_e2e` |

**Pass threshold.** (1) [claimed] 284/284. (2) Met on the surfaces it names. For the success tile and the Missions
header, see the Important finding for the Active Agents tile next to them. (2a)/(2b)/(2c) are asserted by the c02 checks. (3)
[claimed] verify-all green, and demo constants are unchanged [read].

## 2. Privacy and integrity

- **Mission set** [read]: `routes.ts:24` uses the caller's tenant, not-deleted, `VISIBLE_SQL` with `(isAdmin, userId)`
  bound from `ctx`, and the DEMO filter. `includeDemo=1` only drops `not m.demo` and keeps `VISIBLE_SQL`, so it cannot
  reveal a hidden mission. A member with `includeDemo=1` sees only shared DEMO missions, and `company.test.ts` asserts
  Mina's 5 vs the admin's 6.
- **Every sub-query is keyed by that id set** [read], `routes.ts:28-39`:
  - `events`: `tenant_id=$1` and `mission_id = any(ids)`;
  - `tasks`: `tenant_id=$1` and the id set;
  - `task_attempts`: joined to `tasks` with `t.tenant_id=$1` and the id set;
  - approvals: `r.tenant_id=$1` and the id set; the humanness check joins `users` with `u.tenant_id=r.tenant_id`;
  - `mission_runs` and `mission_delegations`: the id set only (these tables have no `tenant_id`).

  This is safe because `missions.id` is a global primary key (`migrations/0002_missions.up.sql:5`), so an id from the
  caller's visible set cannot match another tenant's rows.
- **Second guard** [read]: `scorecard.ts` `mine()` and the `taskMission` check drop rows of any mission outside the input
  set. This is tested in "only the missions it is given".
- **Tests** [read]: they cover a member's private-mission exclusion, including its task-recovery and wait rows, and the
  other tenant's shared mission with a wait. That case would raise the admin's `finished` to 7 and the wait n to 2, so a
  missing tenant filter on `missions` would fail the test. The admin case excludes DEMO, deleted and other-tenant missions.
- **No route loosened** [read]: the diff adds one route and touches no existing server route, guard, migration or
  append-only trigger.

## 3. Correctness of the row definitions

All [read], against `server/src/company/scorecard.ts`.

- **Window**: `inWin` (line 50) is inclusive at both ends. Events are loaded with `occurred_at <= to`. The `from`
  boundary is tested to the millisecond (exactly at `from` counts, 1 ms earlier does not). The `to` side is not tested;
  see Minor m4.
- **started**: the minimum run start per mission is in the window. A later resume run does not re-start a mission, and
  this is tested.
- **finished** (line 72): the last transition into completed, failed or canceled at or before `to`, excluding
  `from='archived'`. One entry per mission (the map is keyed by mission), so it cannot double-count.
  - This matches the restore path: `missions/machine.ts` restore re-emits the pre-archive final state from `archived`.
  - `archive` with `cancelFirst` emits two events in one transaction with the same `occurred_at`; the SQL orders by `id`
    and JS `sort` is stable, so the order holds.
  - Tested: fail → retry → complete counts once; a restore is not a finish.
- **verified_success_rate**: the numerator is verified completions and the denominator is all finished missions; null
  when finished < 3. The verification rule is the declared strict reading:
  - an approved decision by a same-tenant user who is not the owner, decided at or before completion;
  - or at least one task, every task passed, and a non-simulated `verifies` edge.

  Each condition can only lower the rate, which is the safe direction. Every branch is tested: another human, the owner,
  a non-human, after completion, a denial, a missing edge, an open task, no tasks, a simulated edge. Only ids that exist in the
  same tenant's `users` table count as human (the left join on `users`), so `'system'` is excluded.
- **completed_unverified** = completed − verified. `state: 'ok'` always, with n = completions (D3). This is reasonable: a
  count of 0 is a measured 0.
- **median_cycle_time_h**: first run → final moment, over finished missions that had a run. `median()` is the textbook
  median (odd: middle; even: mean of the two middle values). Tested at n=3 → 4 and n=4 → 3.
- **failure_rate**: (failed + canceled) ÷ finished, null when < 3. Tested at n=2 → null and n=4 → 50.
- **task_recovery_rate**: tasks with more than one attempt whose current status is `passed`, divided by tasks with more
  than one attempt. A task is placed by its latest non-null attempt time (D4: `task_attempts` has no creation time, and
  `started_at` is nullable since 0009). Tested, including null `started_at` and a task outside the window.
- **waiting_approval_median_h** (lines 109-117): closed `waiting_approval` intervals from events, counted in the window
  where they end. A pause ends an interval (D5); open intervals are excluded.
  - The intervals are real: `approvals/service.ts:56` emits waiting_approval → running, and resume can re-enter
    `waiting_approval`.
  - Tested.
- **Rates and rounding**: one decimal for %, two for h. `fmtRow` shows "—" for `state:'none'` and never branches on
  truthiness, so 0.0% renders.
- **Pure tests assert real behaviour**: they compute exact values (33.3, 66.7, 25, 50, medians) and exact evidence
  strings, not just non-null. The report says one fixture was fixed after the first GREEN run with no assertion changed;
  the diff is consistent with that.

## 4. Honesty (api mode, Overview and Missions header)

Fixed by this cycle [read]:
- "Mission Success 96.4% (+2.1%)" is now the server value;
- "Tokens Today 1.84M" is gone;
- the Active Missions "+2" delta is gone;
- the Missions header "96.4%" is now the server value or nothing;
- the untagged DEMO "Company Health" ring (98, 12/12, 99.9%) is replaced by the scorecard;
- the demo-only Period select is hidden.

Still on the api-mode Overview with no DEMO tag [read]:

| Where | What | Source | Severity |
|---|---|---|---|
| Top board, **Active Agents tile** (`CommandCenter.tsx:50`) | e.g. "N of 24 · one per role" | `AGENTS` statuses in api mode come from the server catalog, but the server copies the frontend fixture status into `profile` at seed, tagged `provenance: 'demo-fixture'` (`server/src/agents/seed.ts:18-22`, `agents/service.ts:30`). Nothing executes, so no agent is really "active / in-mission" | **Important I1** |
| Pulse, **Active Agents board** title count and strip (`Overview.tsx:101`) | "(N)" and agents shown as "In mission / Active" | the same fixture statuses | Minor m1 (same root cause as I1) |
| Pulse, **Recent Verified Outcomes** (`Overview.tsx:183-184`) | rows of "verify" events plus the "+N" overflow | `api/missionControl.ts:421,427`: in api mode the timeline is the DEMO fixture of DEMO missions, shown with no tag, while the scorecard beside it says 0 verified. "+N" is a list-overflow count, not a rate | Minor m1 |
| Activity, "Events by type" / "Most active agents" (`Overview.tsx:411-416`) | counts | the same DEMO fixture timelines, no tag | Minor m1 |
| Health, Event Freshness / Queue Depth ("Total N jobs queued, oldest 14s") / Connectivity ("Token expires in 12d") (`Overview.tsx:482-498`) | operational numbers | `seeded()` and constants; only the System Health panel above them has a DEMO tag | Minor m1 |

Why I1 is Important and the rest are Minor:
- I1 sits on the exact surface threshold item 2 governs: the four-tile top board that the cycle rebuilt.
- The e2e check is named "c02 api mode: no invented company numbers on the top board", and its regex cannot see this
  tile.
- PROCESS.md's first safety rule says any number that isn't measured is shown as "not enough evidence" or tagged DEMO.
- It is not a *performance* number in the brief's narrow sense, so I don't fail the spec on it. But the cycle's own claim
  overreaches, and the fix is small: count real live agent instances, show "—", or tag it DEMO.

The other rows are pre-existing, outside the brief's surfaces, and not company performance rates. They should go into the
backlog; the report names only two of them.

Demo mode [read]: unchanged (see §1). ov-fit [claimed]: NO SCROLL in both modes.

## 5. Tests weakened?

- **The 1.5 s wait** (`web/scripts/api-improve.mjs:194`): **not a weakening.**
  - No assertion, timeout or expected value changed.
  - The race is in the test's own setup. The script edits `expires_at` directly in the DB while other browsers'
    `org.proposalCreated` re-reads are still in flight, and any of those reads legitimately expires P3 on the server.
    The product behaves correctly.
  - The wait makes the precondition (P3 still pending and visible in B's Pending filter at click time) hold more often.
    It does not hide a product defect.
  - A fixed sleep is still a flakiness smell. See Minor m3.
- **Other removed test lines** [read]: in the diff's test and script files, the only removed line is the old `DOC_SHOT`
  comment in `api-improve.mjs`. Every server test is new, and verify-all, ov-fit and the other e2e scripts are untouched.
  **No test was weakened.**
- **Report accuracy**: the report says `api-improve.mjs` "(c02 section; the cycle 1 flow is unchanged)", but the cycle 1
  flow did gain the wait. The Concerns section does disclose it. See Minor m7.

## Findings

### Critical
None.

### Important
- **I1. Active Agents tile on the api-mode top board shows a demo-fixture count, untagged.**
  - Where: `CommandCenter.tsx:50` (`activeAgents` from `AGENTS` statuses). Those statuses are seeded from the frontend
    fixture with `provenance: 'demo-fixture'` (`server/src/agents/seed.ts:18-22`, `server/src/agents/service.ts:30`).
  - Why it matters: this breaks the "honest numbers only" safety rule on the surface this cycle rebuilt and claims clean.
    The e2e check "no invented company numbers on the top board" does not cover it.
  - Fix: in api mode, count agents with a live non-simulated instance (or show "—" / "not measured"), or tag the tile
    DEMO. Extend the e2e check to assert it.

### Minor
- **m1. Other untagged fixture data on the api-mode Overview** (table in §4): Active Agents board, Recent Verified
  Outcomes, Activity side panels, Health side panels. These are pre-existing and outside the brief's surfaces. Add them to
  the BACKLOG as one honesty sweep; today none of them is listed there.
- **m2. The client cache can carry a previous user's numbers across sign-out in one tab**
  (`web/src/api/scorecard.ts:15,21-26`).
  - `clearScorecard` empties `byKey` but not `inflight` or `tick`. A request in flight at sign-out resolves after the
    clear and writes user A's response into `byKey`.
  - If user B signs in before it finishes, B's `load` is skipped by `inflight.has(once)`, because the key and tick are the
    same. B then sees A's aggregate counts until the next bump.
  - The window is narrow and only counts leak, but it is a privacy item. Fix: add a generation counter, or the user id, to
    the key, and drop responses from an older generation.
  - Related nit: the `.catch` branch writes an entry without `tick`, so a stale older success can later overwrite it.
- **m3. Fixed 1.5 s sleep** (`api-improve.mjs:194`). Prefer a condition: wait until A's and C's proposal lists show P3
  and no request is in flight. Or move the expiry edit before the other browsers subscribe.
- **m4. No test for the `to` boundary.** No test shows that an event after `to` is excluded. The pure function filters
  `at <= to` and the route filters `occurred_at <= $3`. Add one case where a final state 1 ms after `to` is not counted.
- **m5. The browser check proves only 0.0%.** This is declared and inherent: cancel is the only user-reachable terminal
  state. A tile that renders 0 whenever `state:'ok'` would still pass the browser check. The panel's `finished=3` and
  `failure_rate=100.0%` checks and the server tests reduce the risk. A test-only seam in `e2e-serve.ts` for a verified
  completion would close it; this is acceptable to defer.
- **m6. `tasks.simulated` is not checked** in the tasks-plus-verifies verification route; only the delegation's
  `simulated` flag is. It is harmless today, because DEMO tasks come with simulated edges and nothing passes real tasks.
  It is cheap to make symmetric.
- **m7. Report accuracy.** "the cycle 1 flow is unchanged" (Files changed) contradicts the added wait. The "PASS" on
  threshold item 2 ("no invented company numbers on the top board") overclaims given I1.

### Notes (no action needed)
- Loading every `mission.stateChanged` event of the visible missions on each read is needed for the last-final-state
  rule. It uses the `events_mission_seq (mission_id, seq)` index. It is fine at current sizes; the report already names
  the next step (migration 0014).
- "started" counts the staffing simulation's automatic planning → running start, because that inserts a real run row. It
  is declared, and acceptable: the run exists.
- The api-stage6 I2 failure in the combined run (passed alone) is unrelated to this diff. It should be tracked as
  flakiness, not ignored.
