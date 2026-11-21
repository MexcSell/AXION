# Cycle 6 report: department facts from recorded data (theme B)

Implementer report for `c06-brief.md`. Parallel lane: worktree `/home/luca/AXION-w4`, branch `c06-department-facts`,
base `f7c7bca`. E2E on 5492/5493 (database `axion_e2e4`), demo dev server on 5490.

## What was built

### Server (no migration, no new table)
- **Contract** `shared/contracts/src/departments.ts` (one export line added to the index): `DepartmentFacts`,
  `DepartmentsDto`, `DEPT_MIN_SAMPLE = 5`. The brief's shape plus one additive field, `gmReports` (see choices).
- **Pure function** `departmentFacts(rows, {window, from, to, includeDemo})` in `server/src/company/departments.ts`.
  Every rule lives there; the route only loads rows.
- **Loader** `loadDeptRows(db, viewer, includeDemo)`: five queries whatever the number of departments (no N+1):
  catalog, edges of the latest revision (`max(seq)` via `order by seq desc limit 1`, as cycle 1's `latest()`),
  live instances, tasks (with attempt counts and cycle 3's finish time from `task.stateChanged`), and the org diff (each
  revision against the one before it, `except` both ways, keyed by subordinate). Every mission-scoped query joins
  `missions m` and repeats tenant, `deleted_at is null`, `VISIBLE_SQL` and the DEMO condition; catalog and org queries
  are tenant-only (`org_edges` reached through `org_revisions`).
- **Route** `GET /api/v1/departments?window=7d|30d|90d&includeDemo=0|1` in a new file
  `server/src/company/departments-routes.ts` (two additive lines in `app.ts`). Any signed-in user; zod-checked query
  (anything else is 400); default 30d, DEMO excluded; window from cycle 2's `windowOf`.

### Web (api mode only; demo mode unchanged)
- `web/src/api/departments.ts`: `useDepartments(window, includeDemo)`, `bumpDepartments`, `clearDepartments`. It
  **reuses** cycle 2's `makeScorecardCache` (a second instance, not a copy): one read per key and tick, older reads never
  overwrite newer ones, a sign-out drops in-flight responses.
- `web/src/api/events.ts` (additive lines only): a 400 ms debounced re-read on `instance.*`, `task.*`, `org.*`,
  `agent.*`, `mission.*`; also on stream reconnect; cancelled on sign-out; cache cleared in `useServerSync` cleanup.
- `web/src/features/agents/ServerDepartments.tsx` + `web/src/theme/pages/c06-departments.css` (new):
  - `Departments()` in `OrgSections.tsx` is now `isApi() ? <ServerDepartments/> : <DemoDepartments/>` (same split as
    Proposals). The demo body is byte-for-byte the old one, renamed.
  - Each card: department icon and hue; member avatars (click → agent; "+k"); an animated ring of **staffed / members
    as counts** ("2/3", no percentage); the head (button → agent), or **"No head" in amber**; an amber "1 of N → GM" chip
    when several members report to the GM; three fact tiles: **Staffed** (n of members + "N missions" link to
    `/missions?filter=active`), **Open tasks** (running · waiting · failed, "now"), **Outcomes** (passed · failed ·
    retried, `n=… · 30d`, "too few to rate" below 5; no ratio at any size); **"rev N · when"** last org change;
    "Edit draft" (admins only, as before) and "Assign manager" (unchanged).
  - Panel controls: window 7d/30d/90d, "include DEMO" switch (a DEMO tag appears only while it is on), "New
    department" (admins only, as before).
  - Removed from api mode: capacity ring, skill coverage bars, KPI values/deltas and the panel's DEMO tag (nothing
    invented is left on the card). The charter text is not shown either (it was prototype prose).
  - Data attributes for checks: `data-dept`, `data-staffed`, `data-missions`, `data-members`, `data-head`,
    `data-open`, `data-outcomes-n`, `data-org-rev`; panel `data-departments=ready|loading|error`.
- Help (`web/src/help/pages/c06-departments.ts`, new, glob-loaded): `dept.api`, `dept.head`, `dept.members`,
  `dept.staffed`, `dept.openTasks`, `dept.outcomes`, `dept.lastOrgChange` — each says where the number comes from.
  Every card carries 6 `?` (one per fact).
- `web/src/pages/Agents.tsx`: the toolbar note for Departments in api mode (one line).
- Browser check `web/scripts/api-c06.mjs` (new file, no edit to `api-improve.mjs`).

## Choices (definitions frozen by the tests)
- **Members**: active agents with `agent_definitions.dept` = the department. A department with only retired agents is
  not listed. Tasks, instances and org lines belong to their agent's department (retired included).
- **Head**: the GM in the GM's own department. Elsewhere the active member reporting to `gm` in the latest revision.
  The seed puts every first-level agent under the GM (Operations has six), so a single `headAgentId` needs a tie-break:
  **most members of the same department under it, then lowest id**. `gmReports` lists all candidates (head first);
  the card shows "1 of N → GM" and the evidence says so. No candidate → `null` → amber "No head".
- **Active mission / staffed**: the Overview "Staffed Agents" rule: mission planning/running/verifying/waiting for
  approval, instance not ended, not simulated and not on a DEMO mission (unless includeDemo). So the departments' staffed
  sum and the Overview tile agree.
- **Open tasks (now)**: running = running + verifying; waiting = waiting_agent + waiting_user; failed = failed; only on
  missions that are not completed, canceled or archived (a failed mission can be retried, so it counts). Queued
  (created, ready, retry_ready) are not open-and-started and are not counted (said in the help).
- **Outcomes (window, inclusive)**: tasks passed or failed now whose finish time (cycle 3's rule) is in the window.
  `n = passed + failed`; `retried` ⊆ n (more than one attempt). Canceled is not an outcome. Simulated tasks / DEMO
  missions only with includeDemo. No ratio anywhere; "too few to rate" below 5.
- **Last org change**: newest revision whose diff with the previous one (added, removed or re-pointed line) touches a
  line whose **subordinate** is in the department. Every revision stores the full edge set, so "newest revision with a
  line" would always be the latest; the diff avoids that, and a test asserts other departments don't move. The GM
  reports to nobody, so Executive (only the GM) has `null` ("no org change").
- **Agents.tsx / events.ts / app.ts / contracts index**: single additive lines only (other lanes edit them).

## RED / GREEN evidence

RED (tests written first, before `departments.ts` and the route existed):
```
$ cd /home/luca/AXION-w4/server && npx vitest run test/departments.test.ts test/departments-route.test.ts
 FAIL  test/departments.test.ts [ test/departments.test.ts ]
Error: Cannot find module '../src/company/departments.ts' imported from /home/luca/AXION-w4/server/test/departments.test.ts
 FAIL  test/departments-route.test.ts > access and shape > anonymous is 401; an unknown window or includeDemo is 400
AssertionError: expected 404 to be 401 // Object.is equality
 FAIL  test/departments-route.test.ts > access and shape > a fresh database: … AssertionError: expected 404 to be 200
 … (all 9 route tests: 404) …
 Test Files  2 failed (2)
      Tests  9 failed (9)
```
First GREEN run: 29/31. Two route assertions expected `lastOrgChange.revision = 1` for Executive; under the rule above
(the GM has no line) it is `null`. The expectation was corrected to the documented rule (Executive `null`, all others
1), not loosened: the "other departments keep their revision" assertion still covers Operations, QA and R&D.

GREEN:
```
$ npx vitest run test/departments.test.ts test/departments-route.test.ts
 Test Files  2 passed (2)
      Tests  31 passed (31)
```
Full suite and typecheck (after the web work):
```
$ cd /home/luca/AXION-w4/server && npx tsc --noEmit -p . && npx vitest run
TSC_OK
 Test Files  26 passed (26)
      Tests  352 passed (352)      (24 files / 321 tests before this cycle + 2 files / 31 new tests)
```
Web: `npx tsc --noEmit -p .` clean; `npm run build` ✓ (inside verify-all).

Browser check (api mode, lane ports, fresh `axion_e2e4` per run):
```
$ cd /home/luca/AXION-w4/web && E2E_API_PORT=5492 E2E_WEB_PORT=5493 \
    DOC_SHOT_C06=docs/screenshots/improve-c06-departments-dark.png ./scripts/api-e2e.sh "DATA_MODE=api node scripts/api-c06.mjs"
PASS A: every department card's staffed agents and active missions equal the recount from /agents, /missions, /agent-instances
PASS M (member): the same, from what Mina can see
PASS api mode: no prototype figure on the cards (no capacity %, skill coverage, KPI deltas, no DEMO tag while DEMO is off)
PASS every card has a ? for each fact (head, members, staffed, open tasks, outcomes, last org change) — [6,6,6,6,6,6,6]
PASS heads, members and the last org change on the cards are the server's (Executive: GM, no line; Engineering: rev 1)
PASS outcomes say "too few to rate" with n=0 · 30d
PASS include DEMO on: a DEMO tag shows and the cards equal the recount with DEMO missions (simulated staffing) — staffed with DEMO: 14
PASS a real private mission of A is staffed by the simulation (GM + executor + team) — gm, researcher-01, analyst-01
PASS A live: the cards follow the new staffing without reload and equal the recount — staffed 0 → 4
PASS A: R&D (the executor's department) counts the mission: 1 active mission
PASS M (member) does not count A's private mission: her cards equal her recount and stay at the earlier numbers — M total 0, A total 4
PASS M: the server agrees (GET /departments as Mina has no active mission in that department from A)
PASS user action: the waiting task is reassigned from researcher-01 to the GM
PASS A live: open tasks follow the reassign (R&D running 1, waiting moves to Executive) — R&D 1/0/0, Executive 0/1/0
PASS user action: the running task is canceled; A live: R&D running 0 — R&D 0/0/0
PASS M sees none of these private tasks
PASS A live: after the mission is canceled the cards equal the recount again (back to the earlier numbers) — total 0 vs 0
PASS user action: an administrator adds an Engineering agent under Coder-01 (a new org revision)
PASS A live: Engineering shows "rev 2" and one more member, without reload; other departments keep their revision
PASS M live: Engineering shows "rev 2" and one more member, without reload; other departments keep their revision
PASS a new department whose only member does not report to the GM shows the amber "No head", live, with a ? on every fact — 201
PASS fit at 1366×768: the page does not scroll, the departments scroll inside their region — {"over":0,"regions":[367],"hOver":0}
PASS fit at 1672×941: the page does not scroll, the departments scroll inside their region — {"over":0,"regions":[307],"hOver":0}
PASS DEMO on at 1366×768: some open-task / outcome counts are non-zero and no fact row clips — clipped 0, nonZero true
PASS no page errors
25/25 passed
```
(Output trimmed: some long `—` details are cut. The full lines are printed by the script.)
The "No head" and "DEMO on, non-zero counts" checks were added after a review. The first run of the second one failed
(`clipped 8`): at 1366 the fact labels, each with an icon and a `?`, were wider than a card in the 3-column layout. I
fixed it by dropping the label icons; the counts keep theirs.
The recount is computed from `/agents`, `/missions` and `/agent-instances` (the Overview "Staffed Agents" rule), never from
`/departments`. "No reload" = a `window.__c06` marker set before the actions survives. The two task rows are fixture rows
written only into the lane's e2e database (passed/running are system-only states; real missions have no tasks yet, as
in cycle 3); the reassign and cancel are real API user actions.

Regression, api mode (events.ts changed): `./scripts/api-e2e.sh` default → `api-auth-flow.mjs 15/15`, `api-flows.mjs 23/23`.

## Pass threshold

1. **Server: new tests pass, the whole suite stays green — PASS.** 22 unit + 9 route tests (membership, head and
   tie-break, GM department, staffed counts and exclusions, open-task buckets, outcome counts, inclusive window bounds,
   7d/30d/90d, simulated exclusion, last org change; route: 401/400, visibility, other tenant, deleted mission, DEMO
   missions and simulated tasks only with includeDemo=1, window, `lastOrgChange` following `POST /agents` for that
   department only). Full suite 352/352, `tsc` clean.
2. **Api mode: no department number is a fixture unless DEMO-tagged — PASS.** The capacity ring, coverage bars and KPI
   deltas are gone from api mode; the only DEMO tag appears while "include DEMO" is on. Browser check:
   - staffed agents and active missions equal a server recount on every card, for the admin and for a member — PASS;
   - live update without reload after user actions (a new mission staffed by the simulation; a task reassigned; a task
     canceled; the mission canceled; a new agent / org revision) — PASS;
   - a member doesn't count missions she can't see (A's private mission and its tasks) — PASS;
   - also checked: amber "No head" renders (a new department whose only member reports to Coder-01), and non-zero
     open-task and outcome counts (DEMO on) render without clipping at 1366×768 — PASS.
3. **verify-all and the fit checks stay green, demo mode unchanged — NOT MET as written, because of a pre-existing
   1366×768 failure on the Agent Profile that this cycle did not cause and did not fix.** Everything this cycle touches
   is green. The evidence follows.
   - **Lane setup first.** In this worktree `web/node_modules` is a symlink to `/home/luca/AXION/web/node_modules`, so
     fonts are served from `/@fs/home/luca/AXION/web/node_modules/…`, which is outside Vite's `fs.allow` and returns 403.
     The first `verify-all.sh` run (default config) exited 0, but dialog smoke had 1 failure (`agent-evidence no-props`:
     403) and the logs were full of 403 lines. I reran on 5490 with a temporary, untracked Vite config that extends the
     repo config and adds that path to `fs.allow` (deleted afterwards, never committed). The font URL then returned 200.
   - **With fonts served** (`BASE=http://127.0.0.1:5490`, each script's full output kept):
     - `npm run build` ✓
     - `crawl.mjs`: "visited 77 route/tab views · NO PROBLEMS"
     - `crawl-deep.mjs`: NO PROBLEMS
     - `flows.mjs`: 21 PASS, 0 FAIL, no console errors
     - `auth-flow.mjs`: 17 PASS, 0 FAIL, no page errors
     - `u1-flows.mjs`: 8 PASS, 0 FAIL
     - `dialog-smoke.mjs`: "106 checks, 0 failures"
     - `check-dialogs`: all defined
     - `check-help`: "help entries defined: 324 … All referenced help keys are defined."
     - `fs-guard`: OK
     - These scripts don't set a non-zero exit code on FAIL, so the PASS/FAIL lines were counted from the full output.
       The regenerated `docs/dialog-ledger.txt` was reverted.
   - **`fit-check.mjs`, demo mode, fonts served:**
     - 1672×941: **ALL FIT**.
     - 1366×768: Departments `ok` (mainOver 0). **10 views BAD**: `/agents/coder-01?tab=*`, mainOver 13.
     - Baseline: with this cycle's three tracked web edits set aside, the same 10 views were BAD with mainOver 13. With
       fonts loading they are still BAD, so missing fonts are not the cause. The failure predates this cycle. Cycle 3
       reported the profile fitting at 1366×768, so it probably came in later. Left for the merge review.
   - **Demo mode:** `Departments()` renders the old body unchanged (`DemoDepartments`), and every new element is
     api-only.
   - **Api-mode regression** (`events.ts` changed): `api-auth-flow.mjs` 15/15 and `api-flows.mjs` 23/23.

## Files changed
- server: `src/company/departments.ts` (new), `src/company/departments-routes.ts` (new), `src/app.ts` (+2 lines),
  `test/departments.test.ts` (new, 22 tests), `test/departments-route.test.ts` (new, 9 tests)
- shared: `contracts/src/departments.ts` (new), `contracts/src/index.ts` (+1 line)
- web: `src/api/departments.ts` (new), `src/api/events.ts` (additive lines), `src/features/agents/ServerDepartments.tsx`
  (new), `src/features/agents/OrgSections.tsx` (mode split, demo body unchanged), `src/pages/Agents.tsx` (1 line),
  `src/help/pages/c06-departments.ts` (new), `src/theme/pages/c06-departments.css` (new), `scripts/api-c06.mjs` (new),
  `docs/screenshots/improve-c06-departments-dark.png` (new), this report.

## Concerns
- **Head tie-break** is a rule I chose (most department members under the candidate, then lowest id), because the seed
  gives most departments several members reporting to the GM. The DTO carries `gmReports` so the UI can say "1 of N → GM";
  the owner may prefer "no single head" (amber) instead. Queue for the owner if wanted.
- **lastOrgChange ownership** is the subordinate's department. Executive (only the GM) therefore always shows "no org
  change". A head being re-pointed under another department's manager shows on the moved agent's department only.
- **Open tasks** exclude queued tasks (created/ready/retry_ready); outcomes exclude canceled. Both stated in the help.
- **The panel no longer shows the charter text** in api mode (prototype prose; the brief didn't ask for it).
- **Page-level tiles above the tab bar** (System Operations › Agents: "23 Working", "9 Learning", "95.4% Verified Success
  DEMO") are outside the Departments panel and unchanged by this cycle; "Working/Learning/Evolving" have no DEMO tag in
  api mode. Worth a later cycle.
- **In-place resize**: shrinking the viewport from 1672 to 1366 without reloading leaves the "Agent boards" open (its
  default is decided at mount by `innerHeight >= 880`) and the page then overflows by 263 px; a fresh load fits. This is
  `BottomBoard` behaviour, not new; the c06 check measures fresh loads, like `fit-check.mjs`.
- **Lane environment:** the symlinked `node_modules` makes every lane's dev server return 403 for fonts, which turns
  verify-all red. Use a temporary config with a wider `fs.allow`, kept out of git. The 1366×768 profile overflow is a
  separate problem: it remains with the fonts loaded. Re-run `fit-check 1366 768` on the merged tree.
- **`git stash` during the profile baseline:** I set the three tracked web edits aside with `git stash push -- <paths>`
  and popped them a few minutes later, before the controller's "never use git stash" rule arrived. The pop restored
  exactly my three files: `git status` and the diff against `f7c7bca` match the intended edits. The one stash still in
  the list (`WIP on c07-bundle-split`) belongs to another lane and was not touched.
- **Staff ring:** it draws staffed ÷ members as an arc, even for a one-member department. It is labelled with counts
  ("1/1", no %) and is a current fact, not a rate. The owner may still prefer no arc below a minimum size.
- **Missions link:** it opens the generic `/missions?filter=active` list, not this department's missions. The Missions
  page has no department filter yet.
- **Fixed waits:** the browser check has a few short ones after navigation or resize (layout and animation settle) and
  one 1.2 s pause before the member's negative check. Every pass condition is a condition wait.
- `api-improve.mjs` (cycles 1–3) requires a database named exactly `axion_e2e`, so it can't run in this lane; I didn't
  touch it. `server/README.md` test count not updated (other lanes edit it; merge-time).
- `/agent-instances` returns at most 500 rows; the browser recount relies on it (fine for the e2e data).

## Fix round (review `c06-review.md`; coordinator rulings)

### Changes
- **I2, finish time:** `greatest(last task.stateChanged into the current status, last attempt time, created_at)`, the same
  as cycle 3 after its fix round (m4). It was `coalesce(ev.at, …)` (`departments.ts`, loader).
- **I2, attribution (coordinator ruling):** every department outcome counts against the department of the agent that owned
  the task when the outcome happened, as cycle 3's reliability does. The new exported pure helper `outcomesOf(task)`
  splits ownership at the handovers, which come from the `task.reassign` audit rows: `{from, at, state}`, the same CTE as
  cycle 3.
  - **An owner that handed the task over while it was `failed` keeps that failure.** The exception is an owner that had
    itself received the task already failed and made no attempt. So a reassigned failure never moves to the receiving
    department. A → B → C (all while failed) charges only A, and A → B → A charges A once.
  - **The final owner is judged on its own attempts after the last handover.** A retry's placeholder that has not started
    yet counts as its own attempt.
    - `failed` is charged to it, unless it received the task failed and made no attempt.
    - `passed` needs at least one own attempt; with none the task is not counted.
  - **`retried`:** an outcome whose owner made more than one attempt.
  - **`n`** is passed + failed per department, so one task can give one department a failure and another a pass.
  - **The window:** the task's finish time places all of its outcomes in it, as in cycle 3.
  - Open tasks still belong to the current owner. That is current work, not an outcome.
- **Rows:** `DeptRows.tasks[].attempts` is now the attempt times (start, else finish; `null` = not started), and
  `handovers` was added. The `moved` CTE is restricted to the visible passed and failed tasks: tenant-filtered, with
  `subject in (select id from vis …)`.
- **Help:** `dept.outcomes` now states the owner-at-the-time rule, the "not counted" case and the finish time.
- **Tests:**
  - **Unit:** 10 new tests:
    - a failure reassigned while failed;
    - a retry passed by the new owner;
    - a retry failed again;
    - a placeholder attempt;
    - `retried` per owner;
    - a handover while open;
    - a pass with no attempt of its own, with or without a handover;
    - A → B → C;
    - A → B → A;
    - the window set by the task's finish time.
    The existing unit fixtures use attempt arrays now; their expected values are unchanged.
  - **Route:** 3 new tests:
    - a failed Engineering task reassigned to Operations through `POST /tasks/:id/reassign`: Engineering's outcomes are
      unchanged and Operations' are unchanged (the open "failed" moves with the task);
    - the new owner's retry through `POST /tasks/:id/retry`, then a system pass written directly: Operations gains
      passed 1 and n 1, and Engineering keeps its failure;
    - from review m1: a member with `includeDemo=1` cannot count a private DEMO mission.
  - **Route fixture correction:** the helper wrote attempt times of 29–30 h ago and `created_at = now()` for every task.
    Under the corrected finish time (`greatest`), that moved the "finished 10 days ago" task into the 7-day window. The
    attempts now end at the task's finish time and `created_at` is before it. The assertion is unchanged.
- **I3:** the head rule is unchanged. The coordinator queues it as an owner question.
- **I1:** item 3 stays **NOT MET**. The Agent Profile overflow at 1366×768 predates this cycle; another lane fixes it, and
  AgentProfile was not touched.

### Evidence
RED (new tests before the code):
```
$ npx vitest run test/departments.test.ts test/departments-route.test.ts
     × passed, failed and retried (a subset: more than one attempt) …        (row shape: attempt times)
     × a failed task reassigned (while failed) to another department stays a failure of the original department only
     × the new owner's own retry counts for the new department (passed), the earlier failure stays with the original one
     × a retry that fails again under the new owner is a failure of the new department too
     × retried means more than one attempt by the same owner
     × passed with no attempt of its own (after the last handover, or none at all) is not counted
     × A → B → C while failed: only A (who failed it) is charged; B made no attempt
     × a failed task reassigned to another department stays counted against the original department      (route)
     × a retry by the new owner counts for the new department; the original failure stays where it happened (route)
      Tests  9 failed | 35 passed (44)
```
GREEN:
```
$ npx vitest run test/departments.test.ts test/departments-route.test.ts
 Test Files  2 passed (2)
      Tests  44 passed (44)
```
Full suite (`cd server && npx tsc --noEmit -p . && /home/luca/AXION-lanes/heavy.sh npx vitest run`):
- `tsc`: clean.
- **The first two full runs failed for a reason outside this change.** Postgres was out of connections while many lanes
  ran at once: 7 failures, then 39, with "remaining connection slots are reserved for roles with the SUPERUSER
  attribute", `db: 'down'` and "admin connect failed … INTERNAL". None of the failing tests were in the departments
  files.
- **The six failing files rerun alone:** 6 files, 60/60 passed.
- **A full run with fewer parallel workers, so it opens fewer connections:**
```
$ /home/luca/AXION-lanes/heavy.sh npx vitest run --maxWorkers=2
 Test Files  26 passed (26)
      Tests  365 passed (365)        (352 before this round + 13 new)
```
Web: `npx tsc --noEmit -p .` is clean. Browser check, run with the command exactly as the coordinator gave it:
```
$ E2E_API_PORT=5492 E2E_WEB_PORT=5493 /home/luca/AXION-lanes/heavy.sh ./scripts/api-e2e.sh api-c06.mjs
== api-c06.mjs
… (the same 25 checks as above) …
25/25 passed
```
`api-c06.mjs` now sets api mode itself, so the plain `api-e2e.sh api-c06.mjs` form works. Before, it needed
`DATA_MODE=api` and the "full command" form. It no longer imports `settle` from `_session.mjs`: a local `settle` waits
for the shell and the live badge, never for networkidle.

### Files changed in this round
- `server/src/company/departments.ts`: `outcomesOf`, the row shape, the `att` and `moved` CTEs, and `greatest(...)`.
- `server/test/departments.test.ts`: 10 new tests; fixtures now use attempt arrays.
- `server/test/departments-route.test.ts`: 3 new tests; fixture times corrected.
- `web/src/help/pages/c06-departments.ts`: the `dept.outcomes` text.
- `web/scripts/api-c06.mjs`: runs without `DATA_MODE`.
- This report.
