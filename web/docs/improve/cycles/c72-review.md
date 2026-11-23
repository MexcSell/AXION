# c72 review (independent): difficulty-adjusted skill ratings, no leaderboard

Branch c72-skill-ratings, commits c852be8..238a791, worktree /home/luca/AXION-w70. Read only. I never touched the live `axion` DB.
I ran no DB-backed suite (vitest, api-c72) because the harness is outside my allowance; the lane's test results are not re-verified by me.
What I ran: the pure estimator and the guard helpers in plain node (no DB); a demo-mode Vite on 12090 (proxy pointed at the unused 12091, so nothing could reach the live API), driven by Playwright at 1366x768 and 390 px in dark and light. The Vite process (PID 3589352) is stopped.
Scripts and output are in the scratchpad: cov/cov.mjs, cov/fp.mjs, cov/g.mjs, ui.mjs, ui2.mjs.

## Verdict: CLEAR AFTER FIXES

Fixes: F1 (label stamped before the outcome and failure transfer), F2 (do not claim 95% where it is not measured), F3 (own-level cells), F4 (guard reach), F5 (390 px picker). The rest are minor.

## Findings

### F1 (should-fix) The "first brief" rule does not stop a delegator relabelling after the outcome is known
The report says "a later brief cannot relabel a known outcome". That holds only per owner. Two routes break it:
- `server/src/tasks/machine.ts:19` allows `reassign` on a `failed` task (`failed: { retry, reassign: 'failed', cancel }`). `server/src/tasks/routes.ts:68` then updates `owner_agent` and keeps the status `failed`, and the new brief goes to the new owner. `loadSkillOutcomes` (`server/src/agents/skills.ts`, lateral join `d.to_agent = o.owner order by d.seq asc limit 1`) takes the new owner's first brief, which was written after the failure. The delegator therefore picks the label of a known failure (for example "difficulty 5, Very hard"). Two side effects:
  - A's failure vanishes from A's record, because the outcome belongs to the owner at the end.
  - B inherits it.
- `createBrief` (`server/src/delegation/service.ts` ~line 78) only checks that the task is in the mission, not its status. An admin or mission owner can post a first-ever brief to the owner of an already `passed` or `failed` task with a label of their choice.
Fix: count a brief's label only if the brief's `created_at` is before the task first became passed/failed (task_attempts or audit time), or otherwise refuse a labelled brief on a finished task. Decide and state what happens to a failure that moves with a reassignment. Add a test for both paths.

### F2 (should-fix) 95% is claimed for the standardised rate and was never measured
The report says coverage "was not measured and is not claimed". But the method string (`SKILL_METHOD`: "95% Wilson interval on the effective sample size"), the help text, the panel header "Adjusted pass rate, 95% interval" and the `/skills` DTO all say 95% on the cell itself. Only the comparison's false-positive rate was measured.
My own check (grid and seed fixed before running; `cov/cov.mjs`):
- Seed 4242 (mulberry32), 20,000 repetitions per cell, 40 cells.
- The grid: true skill in {0.3, 3, -3, 5} with the lane's DELTA offsets, crossed with 10 fixed designs:
  - one level at n 5, 10 and 40;
  - levels 2 and 3 at 20 each;
  - levels 1 to 5 at 4 each and at 8 each;
  - level 1 at 10 plus level 5 at 1;
  - levels 1, 3 and 5 at 5, 1 and 1;
  - level 1 at 20 plus level 5 at 5;
  - levels 2 and 4 at 5 each.
- Truth is the mean of the true per-level rates over the levels used. The interval is `standardise()` as shipped.
- Result: 23 of 40 cells land in 94 to 100%. **17 of 40 are below 95%. The minimum is 78.5%.**
  - Mid skill (0.3): 94.3 to 100%.
  - Skill 3, level 1 n 10 plus level 5 n 1: 81.6%.
  - Skill 3, levels 1, 3, 5 at 5/1/1: 78.5%.
  - Skill 5, level 1 n 20 plus level 5 n 5: 86.0%.
  - Skill 3, one level n 10: 91.9%. This is plain Wilson, so ordinary discreteness.
  - Skill 3 or -3, levels 2 and 4 at 5 each: about 92%.
- Cause: sparse strata at extreme true rates. The point estimate is the unsmoothed weighted rate, while the variance uses half-observation smoothing. A stratum with n=1 can carry half the weight.
- Related: the effective n exceeds the raw n in many cells (up to 100% of trials for levels 1 to 5 at 8 each), so the interval can be narrower than the plain Wilson interval on the raw n, while the screen shows only the raw n.
- The comparison itself is conservative, so F2 does not weaken the simulation verdict. `cov/fp.mjs`, same seed, A/B overlap mixes, equal skill, 5,000 trials:

| skill | n each | false positive |
|---|---|---|
| 0.3 | 20 | 0.48% |
| 0.3 | 60 | 0.88% |
| 2 | 60 | 0.42% |
| 3 | 60 | 0.02% |
| -3 | 60 | 0.02% |

  The lane's 0.6 to 0.9% reproduces. The overlap simulation is fair: equal truth on every level, and the estimator never sees DELTA. Its own grid is single-skill (0.3) only.
Fix: either say "interval, nominal 95%, under-covers when a level has very few tasks" wherever 95% is written (method string, help, header), or measure on a grid like the above and gate the interval (for example a minimum n per used level, or merge sparse levels). Report the measured coverage in the cycle file.

### F3 (should-fix, decision) Own-level cells still invite a side-by-side rank
I confirmed the lane's 97%: the primary case's own cells are apart in 97% of trials. The UI relies on a small "levels used" chip and a footer.
Evidence: the light screenshot shows "Finding things out 100% (57-100) level 1" in the same big type as a cell built from levels 2 to 3. An easy-only agent's "adjusted" rate equals its raw rate (one level, standardised over itself), and the column is headed "Adjusted pass rate".
Recommendation:
- Head the column "Pass rate on the levels it has", not "Adjusted".
- Show the plain number only when the cell covers all five levels (or at least three, a threshold you define). Otherwise show the interval as a muted range with the chip first, not a big percentage.
- Do not print the unadjusted `raw` figure next to it.
The help text already says "comparable only when levels match", which is the honest statement. The screen should not undo it with a headline number.

### F4 (should-fix) The no-leaderboard guard has gaps, and is not route-table-wide
`server/test/c72-no-ranking.test.ts` sweeps a fixed list of 10 routes plus per-agent routes. `rankingKeyProblems` and the order scan are not applied to every route: `coverage.test.ts` hits the whole route table but never calls them (grep: only the c72 test and `no-ranking.ts` mention them).
I ran the helpers (`cov/g.mjs`):
- A "top 2" list sorted by rating gives `[]` (the order scan needs 3 or more rated agents: `ids.filter(...).length >= 3` and `vals.length < 3`).
- A comparator split over lines (`xs.sort(\n (p,q) =>\n q.adjusted.value - p.adjusted.value)`) gives `[]`.
- A comparator calling a function (`sort((p,q)=>score(q)-score(p))`) gives `[]`.
- A body that renames the value (`pct` instead of `adjusted.value`) gives `[]` from `ratingsInBody` and `rankingKeyProblems`.
- Keys such as `rankIndex`, `top` and `leaders` are not in the banned list (it is exact-match).
- The source scan covers only files whose name matches /skill/i, so a new `leaders.ts` is never read.
A new route that returned the rating in other words, to fewer than three agents, would pass all four guards unless it were added to the sweep by hand.
Fix:
- Run `rankingKeyProblems` (extend it to match as a prefix or substring: rank*, leader*, top*) on every response in the contract coverage run, so the whole route table is covered.
- Lower the order scan to 2 or more rated entries, or ban any list of agents whose entries carry a rating field.
- Scope the source scan to all server and web source, and to multi-line sorts (strip newlines before matching).
- Add a test that fails when a route's DTO validator contains a field that holds a skill value outside `agentSkillsBody`.
What does hold: I found no route, query or sort parameter that orders agents by this rating (`grep` of routes and `skillsOf`/`standardise`/`compareSkill` users: only `agents/routes.ts`, `agents/skills.ts`, shared `skills.ts` and the web demo fixture; no `sort`/`order` query parameter on the agents routes; /attention, departments, directory and company routes never read skills). The compare picker lists by name (`SkillVector.tsx:83`).

### F5 (should-fix) At 390 px the Compare picker and the DEMO or measured tag are cut off
Demo mode, 390x844, dark and light, panel-scoped screenshot `ui-390-panel.png`: the header actions overflow the panel (select right edge 572 px, tag 633 px, panel right 380 px; `svOverflowX` 254), so "Compare with" is clipped to "Co... wit..." and cannot be used. Page-level horizontal scroll is 0, so a page-wide check would not catch it. Fix: wrap the panel actions at the narrow breakpoint (the `@media (max-width: 820px)` block already exists).

### F6 (minor) Exclusions are not neutral and have no retained-share figure
Per the lesson on exclusions: the cell counts only tasks with a class and a difficulty. A task with no brief to its owner at all is dropped by the inner lateral join and appears in no count. A task with an unlabelled brief is "unrated" (shown only as a number). The delegator chooses whether to label, so leaving failures unlabelled raises the rate with nothing flagged. Add a retained-share figure per class (rated / finished) and show it next to n; consider greying a cell when it is under, say, 80%.

### F7 (minor) Other items
- At 1366x768 in demo mode `mainOver` is 0 and there is no page horizontal scroll, but the panel's last row ends at y=806 (8 rows plus header above the other Performance panels). That fits the project's `.fit-scroll` convention but is below the fold; the lane's own screenshot clips the eighth row.
- `title`-only help on the levels chip, n and raw (not focusable). The values and verdict chips are focusable with `Tip`, so this is a small gap.
- `/agents/:id/skills` is open for every agent, so a client can scrape N agents and sort them itself. The API orders nothing, but the leaderboard is one script away. Worth a line in the help or the report; no code change.
- Orderings by raw success already exist in the demo UI (`web/src/pages/Agents.tsx:385` "top 5 by success", `AgentHierarchy.tsx:137`, `AgentProfile.tsx:72`). They are older and outside this cycle's rating, so the guard rightly ignores them, but the "no leaderboard" claim is about the new rating only.
- `DelegationBriefData.taskClass` is typed `string`, not the enum (`shared/contracts/src/delegation.ts`).

## Checks with no finding
1. **Method.** Direct standardisation with Wilson on the effective n is computed as documented. One level gives exactly Wilson. All successes at n=5 gives 57 to 100. Two levels at 5/0 and 5/5 produce an effective n of about 33, above the raw n of 10; this is correct stratified variance but see F2. n is null below 5 and the comparison needs 5 on shared levels. Comparing on shared levels only is sound, and a 95% non-overlap test is conservative (see the false-positive table).
2. **Simulation.** The overlap set-up is fair. Interval coverage of the standardised rate was not measured by the lane and I did it in F2. The primary threshold passes by refusal, and the report says so.
5. **Inventory.** Both fields are in `INPUT_FIELDS`, in `createBrief`'s writes, and in the e2e harness declarations; the registry note is derived (`skillRatingDependsText` from `writabilityOf`). One wording point: the text says "an agent identity can write them", but `createBrief`'s agent path needs an admin or the mission owner acting for the agent, so it is a person writing on an agent's behalf. Harmless.
6. **Contracts.** Registry (two routes), validators (`agentSkillsBody`, `skillCompareBody`, brief fields) and coverage calls are present; no allowlist or exclusion lines were added in the diff.
7. **UI.** Plain words, `?` help (`agent.skillVector`, `delegation.taskClass`), icons, no rank or position text (regex check on the panel text at 1366 and 390: false), fixed class order, null cells say "not enough evidence (n of 5)". A11y: values and chips are focusable with visible focus rings. Failures are F3 and F5 above.

---

# Re-review (fix rounds), 238a791..b18932c

Scope: read-only, no live DB. Run: pure helpers and `sortScan`/`skillFileSorts` on the tip in plain node (`cov/g2.mjs`), and a demo-mode Vite on 12090 (proxy to the unused 12091) with Playwright (`ui3.mjs`, `ui4.mjs`). I did not run vitest, api-c72 or the other DB-backed scripts, so the lane's reported counts (3167 tests, api-c72 53 PASS, ...) are not re-verified by me. The Vite process (PID 3854774) is stopped; nothing is left running.

**Standing check (stat).** `git diff 238a791..b18932c --stat` is 20 files and contains every file the Fix round section names (skills.ts server and shared, coverage test, no-ranking.ts, coverage.test.ts, validators, delegation.ts, SkillVector.tsx, css, help page and registry, skillDemo, Agents.tsx, orgdemo.ts, AgentHierarchy.tsx, api-c72.mjs, the e2e fixture, the report). Nothing claimed is missing. Not in the section but changed: `server/src/cli/e2e-skill-fixture.ts` (2 lines) and `validators.ts`, both consistent with the claims.

## F1 (label before first finish, owner from task_owner_history): mostly fixed, one new hole
Verified by reading `server/src/agents/skills.ts`: the brief must satisfy `d.created_at < o.fin`, `fin` is the earliest `task.stateChanged` event to passed/failed/canceled (else the task's creation time), the owner is read from `task_owner_history` at `fin`, and a task without a usable label is now counted as unrated (left join). I did not re-run my two probes against a DB; the lane's tests for them (c72-skill-model.test.ts lines 191 to 230) assert exactly my two probes (reassign after failure moves nothing; first-ever brief on a finished task counts 0 and shows 5 unrated). By reading, both now fail closed. A brief cannot be backdated: `DelegationBriefIn` is strict and has no created_at.

**New finding N1 (should-fix): the status is the CURRENT status, the owner and label are from the FIRST finish.** The outer select returns `t.status` (current). Attack: A fails a task (first finish, owner A, label stated before it). The task goes to `retry_ready`, which allows `reassign` (machine.ts: `retry_ready: { requeue, reassign }`), and then to B, who passes it. The outcome row is (owner A, status **passed**, A's label). A's failure becomes a pass credited to A, and B, who did the work, gets nothing. Same with a plain retry by the same owner: A's first failure disappears from A's record (the report says "belongs to the owner at the first finish" but does not say the first outcome is replaced by the last). Fix: take the outcome (`to`) of the first finish event rather than `t.status`; if the first finish was a failure, it stays a failure for that owner, and the later pass is a second outcome for whoever owned the task at that finish (or is not counted). Add a test: fail, retry_ready, reassign, pass.
Other new attacks I tried by reading: reassign while running is refused by the machine; fail, reopen, finish again uses `min(occurred_at)`, so the first finish fixes the owner and label (fine, apart from N1); canceled is terminal. A task with no event row falls back to its creation time and so can never count a brief written after it (fails closed to unrated). One thing I could not check without a DB: that every route transition writes the `task.stateChanged` event in the same transaction. If an event were ever missing for a real task, that task would become unrated, not mislabelled.

## F2 (nominal 95%)
Verified by `grep`: the user-visible texts now say nominal: the method string, the column header "On the levels it has (nominal 95% range)", the help `what` and `how`, the footer and the "distinguishable" reason. **One miss (minor):** the "indistinguishable" reason string in `shared/contracts/src/skills.ts:95` still reads "The 95% intervals on the shared levels overlap." (shown in the verdict chip tooltip). Add "nominal". I did not re-run my coverage grid (the lane's 11/36 below, minimum 86.1% is in its test output; I accept "nominal 95%" with honest reporting as the controller ruled). The remaining shortfall is stated in the help (86 to 94% on a test grid).

## F3 (own-level cells)
Fixed in the way described: column "On the levels it has", levels chip before the rate, under 3 levels a muted range without a headline number, raw not printed beside it (it is behind the row's `?`). The demo screenshot (`ui3-1366.png`) shows "57-100%" muted for one level.
Residual (minor): the primary case still invites comparison by eye. An easy-only agent and a hard-only agent each show a muted range and a bar with a point marker (`Bar` still draws the dot at the point estimate for every non-null cell), so two profiles side by side still show A's bar far to the right of B's. The chip says which levels, and no number is headlined, which is a real improvement. If you want it closed: do not draw the point marker (or the bar) when `headline` is false.

## F4 (guard coverage), probes re-run on the tip (`cov/g2.mjs`)
- top-2 list: now caught. Multi-line comparator: caught. Function comparator `score(q)-score(p)`: caught. Keys `rankIndex`, `leaders`, `topAgents`, `top`, `winners`: caught. `sortScan` and `skillFileSorts` on the tip: both empty (no unreviewed sort).
- A list of two rated entries under any key: caught by `ratedListProblems`.
- **Still not caught:** the renamed `pct` field. `ratingsInBody` and `ratedListProblems` key on `classId` plus `adjusted.value`; `pct` is not a banned key. Also a comparator that calls an unrelated name (`foo(q)-foo(p)`) is invisible in a file that does not import a skill-specific module. `SKILL_IMPORT` excludes the contracts index and `@contracts`, and a route could compute ratings with `standardise` imported through the index. Banned-word misses by design: `podium`, `ladder`, `elo`, `ahead`, `tier`, `first`.
- The metamorphic reversal covering only the 10 sweep routes is a real but small gap: the key scan runs on the whole route table, and the order scan needs the rating values, so a new route that returns agents ordered by a renamed rating field outside the sweep passes everything. I rate it minor, given the allowlist-by-reason design and that the renamed-field case also defeats the sweep unless the entries still carry `adjusted.value`. Cheap improvement: in the coverage run, flag any response containing a number-valued field in a list of agents that equals a skills value of that agent (value-based, not name-based).
- Allowlists: the 4 key entries are sound (`minPercentileN` x2 about review times, `skills/retirement-proposals::score` about a skill record, `attention::ranking` about the "Needs you" queue). They are keyed by route, so an exemption cannot spread. The sort allowlist now holds 5 entries (conversations rank, command-palette match score, capability strings in a brief, one agent's metric names, threads by recency), each reasoned and correct; the two removed ones are gone.

## F5 (390 px)
Fixed. Demo, 390x844, dark and light: panel `scrollWidth - clientWidth` = 0, no descendant outside the panel rect; Compare picker and the DEMO tag sit inside; no rank-like text in the panel (regex).

## Last commit b18932c (name order)
Changes the demo's department heads. In demo mode the Departments tiles (Agents > Departments) now show: R&D Analyst-01, Engineering Browser-01, Operations Comms-01, Governance Security-01, Knowledge Knowledge-01, QA Mentor-01 (I did not capture the old values). Examples of what is now odd: Browser-01 as head of Engineering and Comms-01 as head of Operations are simply first by name, not who really manages. `AgentHierarchy` shows the crown on the manager first (unchanged when a manager is set), and `OrgSections.tsx:44` and the department dialogs read `DEPTS[].managerId`. Agent profiles keep their own `managerId` (Planner-01 still reports to GM), so tile and profile can now disagree about who the head is. That is a demo-only content change, it fits the "no ordering by success" ruling, but it is visible: no other Overview or Departments tile is ordered by this. Minor, controller's call: pick a stable role-based head (for example the agent whose `managerId` is outside the department, which `AgentHierarchy` already does in api mode) instead of the alphabetical first.

## Verdict: NOT CLEAR
What remains:
1. **N1 (should-fix)**: attribute the outcome status to the first finish, not the current status (fail, retry or reassign, pass currently shows A's failure as a pass). Add the test.
2. Minor, can ship with a note: the "95% intervals ... overlap" reason lacks "nominal"; non-headline cells still draw a bar and marker; the guard misses a renamed field outside the sweep; demo department heads are now arbitrary and can differ from agent profiles.
After N1 is fixed with a test, this is CLEAR.
