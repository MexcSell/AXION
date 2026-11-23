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
