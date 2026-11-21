# Cycle 6 review: department facts from recorded data (theme B)

Independent review of branch `c06-department-facts` (worktree `/home/luca/AXION-w4`, base `f7c7bca`, head `c02006b`).

**Inputs:**
- the brief `c06-brief.md`;
- the safety rules in `PROCESS.md`;
- the implementer report `c06-report.md`;
- the diff `f7c7bca..HEAD` (screenshots excluded).

I looked outside the diff only for named risks:
- `VISIBLE_SQL`;
- cycle 1's `latestRevision` and its `DEPT_WITHOUT_HEAD` rule;
- cycle 3's `reliability.ts`, on the base and on `improve-30h`;
- the task state machine and the reassign route;
- the seed;
- the Overview "Staffed Agents" tile;
- `fit-check.mjs`;
- the other lanes' reports.

**What I ran:** `npx tsc --noEmit -p .` in `server/` and in `web/`. Both are clean.

**What I did not re-run:** vitest, `api-c06.mjs`, `verify-all.sh` and `fit-check.mjs`. The rules for this review allowed no servers and no database writes. The results "352/352", "25/25", "ALL FIT at 1672" and "10 views BAD at 1366" are the implementer's claims. I read them but did not reproduce them.

## Verdicts

- **Spec: PARTIAL.**
  - Items 1 and 2 are met as far as reading the code and tests can show.
  - Item 3 is **NOT MET**, and the report says so honestly. The failure is a 1366×768 overflow on the Agent Profile, a page this cycle does not touch.
  - The cycle cannot be called PASS until the profile fit is green on the merged tree.
- **Quality: good, approve after small fixes.**
  - No Critical findings.
  - The privacy and integrity work is careful. `VISIBLE_SQL`, the tenant filter, `deleted_at` and the DEMO switch are in every mission-scoped query, and the code reuses cycle 2's cache instead of copying it.
  - Two Important findings concern definitions:
    - outcome attribution and finish time diverge from cycle 3's rule as it now stands on `improve-30h`;
    - the head is chosen by a heuristic for most departments, and the owner was never asked about it.

## 1. Spec compliance

| Brief item | Where | Result |
|---|---|---|
| `GET /api/v1/departments?window&includeDemo`, any signed-in user, default 30d, DEMO excluded | `departments-routes.ts:9,16-22` (`requireUser`, zod enums, defaults `'30d'`/`'0'`) | ✓ |
| Response shape `{window, from, to, departments[...]}` | `shared/contracts/src/departments.ts:7-35` | ✓ Two additive fields: `includeDemo` and `gmReports`. |
| Membership from `agent_definitions.dept` | `departments.ts:50-53,77` (active agents only) | ✓ |
| Head = active member whose supervisor is `gm` in the latest revision (`max(seq)`, as in `latestRevision`) | `departments.ts:142` (`order by seq desc limit 1`, identical to `agents/org.ts:39`), `:78-81` | ✓ The tie-break when several members qualify is the implementer's own rule (see I3). |
| Staffed agents / active missions | `departments.ts:88-93`, SQL `:143-145` | ✓ |
| Open tasks running / waiting / failed | `departments.ts:27-30,98` | ✓ Queued tasks are excluded, as declared. |
| Outcomes passed / failed / retried with n, no server ratio | `departments.ts:99-105` | ✓ No ratio anywhere. "too few to rate" appears in the evidence (`:122`) and on the card (`ServerDepartments.tsx` outcome sub-line). |
| `lastOrgChange {revision, at}` | `departments.ts:107-110`, SQL `:164-173` | ✓ Lines are keyed by subordinate. Executive is always `null` (m9). |
| No new table; migration 0016 only if needed | none added | ✓ |
| Pure `departmentFacts(rows)` with unit tests | `departments.ts:48-129`, `test/departments.test.ts` (22 tests) | ✓ |
| "Use one grouped query; no N+1" | five fixed queries in one `Promise.all` (`:139-174`) | ~ There is no N+1. It is not literally one query (m3). |
| Web cards: head or amber "No head", member avatars, staffed + missions link, open tasks, outcomes with n and window, "rev N · when" | `ServerDepartments.tsx` (DeptCard) | ✓ The missions link is generic (m6). |
| Capacity ring, coverage bars and KPI deltas removed from api mode | `OrgSections.tsx`: `Departments()` = `isApi() ? <ServerDepartments/> : <DemoDepartments/>` | ✓ They are removed outright, not folded into a DEMO block. |
| "Edit draft" and other controls unchanged, hidden from members as before | "Edit draft" is behind `canEdit`. "Assign manager" is identical to `OrgSections.tsx:67-68`. | ✓ |
| Live refetch on `instance.*`, `task.*`, `org.*`, `agent.*`, `mission.*`, debounced | `events.ts:83` (400 ms), on reconnect `:109`, cancel and clear on sign-out `:134,146` | ✓ |
| `?` help for every new fact, saying where it comes from | `help/pages/c06-departments.ts`, 6 keys per card plus `dept.api` | ✓ Small text nits in m8. |
| One-screen fit at 1366×768 and 1672×941 | `api-c06.mjs` fit checks (claimed `over:0` at both sizes). Demo `fit-check` shows Departments `ok`. | ✓ for this page, as claimed. |
| Tests written first | the report shows a RED log | ✓ |

### Pass threshold

1. **Server tests pass, suite green: met as claimed.** Not re-run (see the top of this review). `tsc` is clean.
   - The tests cover every behaviour the brief lists:
     - membership, head and tie-break;
     - staffed counts and their exclusions;
     - the open-task buckets;
     - outcomes, including `retried`;
     - the window bounds, inclusive and ±1 ms;
     - the 7d/30d/90d windows;
     - simulated exclusion;
     - visibility, the other tenant and deleted missions;
     - DEMO only with `includeDemo=1`;
     - `lastOrgChange` following `POST /agents`.
   - The 29/31 → 31/31 correction (Executive `null`) changed an expectation to another exact value (`toBeNull()`, `departments-route.test.ts:72,174`). It did not loosen anything.
   - I checked that the assertions are not vacuous. In the seed, `security-01` belongs to Governance, `knowledge-01` to Knowledge, `comms-01` to Operations and `mentor-01` to QA. So the deleted-mission, other-tenant and ended-instance rows each land in a department whose asserted count would change if the filter were missing:
     - Governance: n=0;
     - Knowledge: all zeros;
     - Operations: staffed 2, not 3.
2. **No fixture numbers in api mode; browser recount; live; member visibility: met.**
   - The recount comes from `/agents`, `/missions` and `/agent-instances`, never from `/departments` (`api-c06.mjs` `recount`). It uses the same mission states as the server: `toUiStatus` maps only `waiting_approval` to `waiting`, so `planning/running/verifying/waiting` is equivalent to the server's set.
   - The live checks cover a mission staffed by the simulation, reassign, cancel, mission cancel and a new org revision. No reload happens: the `window.__c06` marker survives throughout.
   - Member visibility is checked in the UI and confirmed by a server call as Mina.
3. **verify-all and fit checks green, demo mode unchanged: NOT MET. The label is honest.** Evidence that this cycle did not cause the failure, from the diff alone (I could not re-measure):
   - The overflow is on `/agents/coder-01?tab=*`. `AgentProfile.tsx` imports none of the touched files. `OrgSections` is imported only by `pages/Agents.tsx:36`.
   - Every selector in `c06-departments.css` starts with `.dpa-`. The file reuses `.oa-dept-grid` and `.sc-demo` but does not redefine them, so nothing leaks into the profile even though the CSS is bundled whenever `OrgSections` loads.
   - `fit-check.mjs` runs in demo mode. The only other shared changes are the `events.ts` lines, which are api-only, and one `Agents.tsx` toolbar line, which is api-only and applies to the Departments tab only.
   - The implementer's baseline used `git stash` and was taken before the no-stash rule. It shows the same 10 views BAD with mainOver 13.
   - **I could not corroborate this from other lanes.** `verify-all.sh` does not run `fit-check` at all. c07's "ALL FIT (77 views)" states no size; the script's default is 1672×941, and c07 shares base `f7c7bca`, so it neither confirms nor refutes the 1366 result. No other lane reports a demo-mode profile check at 1366.
   - `improve-30h` has since changed `components/agents/Reliability.tsx` (`46c1c45`). The profile result at 1366 must therefore be measured on the merged tree, not inferred.

## 2. Privacy and integrity

`MISSIONS` (`departments.ts:138`) =
`m.tenant_id = $1 and m.deleted_at is null and ${VISIBLE_SQL('$2','$3')} and ($4::boolean or not m.demo)`.
The bind parameters are `[tenant, admin, userId, includeDemo]`, which matches `visibility.ts`.

| Sub-query | Tenant | Visibility / DEMO |
|---|---|---|
| agents (`:140`) | `tenant_id = $1` | not mission data. The catalog is already readable by any signed-in user. |
| latest edges (`:141-142`) | through `org_revisions.tenant_id = $1` | not mission data. Same exposure as `/organization/graph`. |
| instances (`:143-145`) | `i.tenant_id = $1` **and** `m.tenant_id = $1` | `MISSIONS`, plus `ended_at is null` and active states |
| tasks `vis` (`:147-150`) | `t.tenant_id = $1` **and** `m.tenant_id = $1` | `MISSIONS`. The `left join agent_instances i` has no tenant predicate, but it joins on the FK `owner_instance_id`, and reassign only accepts an instance of the same mission (`tasks/routes.ts:45`). Safe (m11). |
| `ev` (`:152-154`) | `e.tenant_id = $1` | `subject_id in (select id from vis …)` |
| `att` (`:155-158`) | inherited | `task_id in (select id from vis)` |
| org diff (`:164-173`) | `r` is tenant-filtered; `lag(id)` runs over the tenant's own rows | not mission data |

- **`includeDemo` cannot reveal hidden missions.** `$4` only toggles `not m.demo`. `VISIBLE_SQL` is always applied, and it is independent of `$4`.
- **Simulated rows on real missions** are flagged `(i.simulated or m.demo)` and `(t.simulated or m.demo)`. They are excluded in the pure function unless `includeDemo` is set (`departments.ts:54,90,96`).
- **Nothing is loosened.**
  - Sign-in is `requireUser`.
  - No permission, audit, append-only or "nothing executes" code changed.
  - `app.ts` gained two additive lines.
- **No N+1.** The query count is fixed whatever the number of departments or rows.
- **Test gap (m1), a repeat of c03's m7.** The DEMO mission `DM` is shared (`departments-route.test.ts:97`). So no test shows that a member with `includeDemo=1` still cannot count a **private** DEMO mission. It is safe on reading, but it is the same gap c03 was asked to close.

## 3. Correctness of each fact

- **Membership.** Active agents only. A department with only retired agents is not listed.
  - Latent: `of()` resolves a department through `deptOf`, which includes retired agents. A retired agent's live instance would therefore count as staffed, which allows "2 of 1" (m4).
  - There is no retire path in the server today (no writer sets `'retired'`), so this cannot happen yet.
- **Head.** It is consistent with cycle 1's `DEPT_WITHOUT_HEAD` (`validate.ts:105-110`), which defines only whether a head exists. The tie-break (most department members in the subtree, then lowest id) is new.
  - The seed puts all 17 first-level agents under the GM. Four of the six non-Executive departments have several GM reports: Engineering 4, Operations 6, R&D 3, QA 2.
  - So on real data the crowned "Head" is a heuristic pick in most departments (I3).
  - The cross-department subtree test does discriminate: with cross-department counting, eng-a would win the tie by id.
- **Staffed and active missions.** These are distinct agents and distinct missions on visible, not-ended, active missions. Simulated instances and DEMO missions count only with `includeDemo`.
  - This matches the Overview tile (`CommandCenter.tsx:43-44`).
  - Real missions' instances are `simulated=false` (`instances/backfill.ts:9,24`).
- **Open tasks.** Buckets as declared. Tasks on completed, canceled or archived missions are not open. A failed task appears both as open-failed and, inside the window, as a failed outcome; this is declared.
  - The owner is `coalesce(i.agent_id, t.owner_agent)`. Reassign updates both columns (`tasks/routes.ts:50`), so the reassign check in the browser test is real.
- **Outcomes.** Passed or failed now, with the finish time inside an inclusive window. `retried` means more than one attempt; canceled tasks are excluded.
  - Two divergences from cycle 3 **as it now stands** on `improve-30h` (I2):
    - **Owner at the time.** A `failed` task can be reassigned and stays `failed` (`tasks/machine.ts:19`). Its failure then moves to the receiving agent's department, and the original department loses it. A retry and pass under the new owner turns it into a "passed, retried" for the new department. c03's fix round (`46c1c45`, I2) changed this rule for reliability: outcomes count against the owner at that time.
    - **Finish time.** c06 copies the pre-fix rule `coalesce(ev.at, greatest(att.at, created_at))` (`departments.ts:161`). `improve-30h` now uses `greatest(ev.at, att.at, created_at)` (c03's m4).
  - The report says it uses "cycle 3's finish time". After the merge, the two pages would compute it differently.
- **lastOrgChange.** The `except` both ways per revision against `lag(id)` handles additions, removals and re-pointed lines. Revision 1 sees `prev = null`, so all its lines are changes.
  - It is correct on reading, but only the "added line" case is exercised through SQL (`POST /agents`). Re-pointing and removal are covered only in the pure test, where the rows are handed in directly (m1).
  - Executive is always "no org change", because the GM's own line does not exist (m9).

## 4. Honesty

- **Api-mode cards show no invented numbers.**
  - The capacity percentage, skill coverage and KPI deltas are gone.
  - The panel's DEMO tag appears only while "include DEMO" is on (`ServerDepartments.tsx`, `AnimatePresence` around `DemoTag`).
  - The browser check asserts no `%`, no coverage or KPI text, no `.oa-kpis3` and no `.demo-tag` with DEMO off.
- **The StaffRing is still an arc of staffed ÷ members.** It is labelled with counts, which is fine as a census, but it sits where the removed capacity ring was and has no minimum size (m5, owner question).
- **Demo mode is unchanged.**
  - `DemoDepartments` has the old body under a new name, plus a dead `isApi() && <DemoTag/>` branch.
  - The toolbar line is api-only.
  - The CSS is `.dpa-`-scoped.
- **Fit.** The api-mode Departments page fits at both sizes (claimed by `api-c06.mjs`). Demo Departments is `ok` at 1366 (claimed).
- **Cache.** `api/departments.ts` creates a second instance of `makeScorecardCache`, cycle 2's session-safe cache (`scorecardCache.ts:11`). It is not a copy. `clearDepartments()` runs in the `useServerSync` cleanup. ✓
- **Page-level tiles outside the panel.** The "Working / Learning / Evolving" tiles have no DEMO tag in api mode. This predates c06 and the implementer declares it. Brief item 2 is about department numbers, so I treat it as out of scope for c06 and a **backlog item** (m10). The browser check's "no prototype figure" test only looks inside the panel.

## 5. Fixed waits in `api-c06.mjs`

These are **acceptable and do not weaken the checks.**
- `:146`: a 1.2 s pause before Mina's negative check. It widens the window in which a wrong update could appear, so it makes the check stricter. The server call as Mina then confirms the result.
- `:211`: a 900 ms settle after a fresh load, before the fit measurement. It mirrors `fit-check.mjs:28` (600 ms), and the measurement is gated by `ready()`, which is a condition wait on `data-departments="ready"`.
- `:154`: screenshot only.
- The `act()` retry loop and `until()` are polling loops, which is fine.

Two small points (m2):
- The report says "every pass condition is a condition wait". The fit and clip checks are in fact one-shot measurements taken after a fixed settle.
- "M sees none of these private tasks" is an instant snapshot with no wait. Only the server visibility test really proves it.

## Findings

### Critical

None.

### Important

**I1. Pass-threshold item 3 is NOT MET.** This is a gate, not a c06 defect.
- `fit-check 1366 768` reports 10 Agent Profile views BAD (mainOver 13), as the implementer reports. Section 1 gives the reasons the diff cannot cause it.
- Until the profile fits, the cycle result is PARTIAL.
- **Fix:** run `fit-check.mjs 1366 768` on the merged tree. `improve-30h` changed `Reliability.tsx` after this branch was cut. Then either fix the profile in a separate change or record the failure as pre-existing in BACKLOG.
- **The verdict must not be upgraded without that run.**

**I2. Outcomes diverge from cycle 3's rule as it now stands on `improve-30h`.** Affected code: `departments.ts:96-105,146-162`.
- **Context.** c06 matched cycle 3 as it was on its base `f7c7bca`, and the brief does not ask for owner-at-the-time attribution. So this is a merge-alignment issue, not a spec breach:
  - the finish-time formula is the concrete inconsistency after the merge;
  - attribution is a definition to confirm.
- **Attribution.** The final owner takes the outcome. A failed task reassigned to another department moves its failure there. c03's fix (`46c1c45`, I2) changed this rule: outcomes count against the owner at the time.
- **Finish time.** c06 uses `coalesce(ev.at, …)`; main now uses `greatest(ev.at, att.at, created_at)` (c03's m4).
- The report says it uses "cycle 3's finish time". After the merge, the Departments page and the profile would apply different rules to the same task.
- **Fix:**
  - take over `greatest(...)`;
  - either attribute a failed outcome to the owner of the last attempt or handover, as the merged `reliability.ts` does, or state the final-owner rule explicitly in the help and the report as a deliberate department-level choice;
  - add one route test: a failed task is reassigned to another department.

**I3. The "Head" is a heuristic pick in four of the six seeded departments, and the owner was never asked.**
- The seed has all first-level agents under the GM: Engineering 4, Operations 6, R&D 3, QA 2. The card crowns one of them using a rule the brief did not set (`departments.ts:78-80`).
- The amber "1 of N → GM" chip and the evidence text disclose this, so the card is not dishonest. But PROCESS.md asks for owner questions to be queued in `LOG.md` with a safe default, and nothing was queued.
- **Fix:** queue the question: is the head chosen by the subtree tie-break, or is the card amber "N report to the GM" with no single head? Keep the current rule as the default until the owner answers. No code change is needed unless the owner chooses otherwise.

### Minor

- **m1. Test gaps.**
  - No route test with a **private** DEMO mission and a member using `includeDemo=1`. This repeats c03's m7.
  - The SQL org diff for a re-pointed or removed line is untested. Only the "added" case goes through `POST /agents`.
  - The cross-tenant fixtures are all-t-2, so the test cannot tell which of the two tenant predicates is doing the work. The defence in depth is fine, but no single predicate is pinned.
- **m2. The fixed waits are fine (see §5).** The report's "every pass condition is a condition wait" is slightly overstated, and the browser check that M sees none of the private tasks is an instant snapshot.
- **m3. Five queries, not "one grouped query".** The spirit (no N+1) holds. The org-diff query recomputes every revision on every call, O(revisions × edges). That is fine now, but worth an index or cache once org history grows.
- **m4. Retired agents.** A retired agent's live instance would be counted as staffed in its old department ("2 of 1"). This is latent, because there is no retire writer yet. Filter on `active` in the staffed loop, or say in the help that staffed counts include retired agents.
- **m5. The StaffRing arc** is a ratio with no minimum size, in the old capacity ring's place. Owner question; declared.
- **m6. The missions link** goes to `/missions?filter=active`.
  - That filter excludes waiting-for-approval missions (`Missions.tsx:59`), while the count includes them.
  - The list may also include DEMO missions while the count excludes them.
  - So the list and the number can differ. Declared in part.
- **m7. A failed re-read keeps showing old data.** The cache keeps the last data on error, and the panel still shows `data-departments="ready"` with no error hint.
- **m8. Help text nits.**
  - `dept.openTasks`: "the agent of the task's owner instance". The server falls back to `owner_agent` when there is no instance.
  - `dept.outcomes` does not mention the attempt or creation-time fallback.
- **m9. Executive always shows "no org change"** (subordinate-keyed lines). Declared. It could also attribute lines whose supervisor is the GM to Executive.
- **m10. The page-level Working / Learning / Evolving tiles** have no DEMO tag in api mode. Pre-existing and outside this panel, so it goes to the **backlog**.
- **m11. `left join agent_instances` without a tenant predicate** (`departments.ts:148`). Safe through the FK and reassign's same-mission check. Adding `and i.tenant_id = $1` would be a free tightening.
- **m12. Merge risks.**
  - `improve-30h` now has c07's lazy help registry. Re-run `check-help` on the merged tree so `c06-departments.ts` is still picked up.
  - The c03 fix round touches the same task-finish logic (I2).
  - The `server/README.md` test count was not updated (declared).
- **m13. Process.** `git stash` was used once, before the rule existed.
  - `git diff --stat f7c7bca..HEAD` matches the report's file list exactly.
  - The worktree is clean apart from the untracked `node_modules` symlinks.
  - `git stash list` is now empty (the c07 entry the report mentions is gone).
  - Nothing to fix.

## What is good

- Every mission-scoped sub-query repeats the tenant, `deleted_at`, `VISIBLE_SQL` and the DEMO condition. `includeDemo` is cleanly separated from visibility.
- All rules live in one pure function. The tests are exact and not vacuous: each excluded row lands in a department whose asserted count would change.
- The browser recount is independent of `/departments`. It is done for both the administrator and a member, and the live checks follow real user actions.
- The NOT MET is reported plainly, with a baseline and environment notes, rather than argued away.
- Cycle 2's cache and debounce pattern is reused, not copied. Demo mode is cleanly split off, as Proposals was.
