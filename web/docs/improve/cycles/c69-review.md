# c69 review (process metrics, R3-5), lane w67, 35bb4a9..6a25524

Verdict: CLEAR AFTER FIXES (one should-fix on the first-pass definition, rest minor).

## Checks run (all in the lane worktree, ports 11790-11793, axion_e2e6, via heavy.sh)
- tsc server and web: clean. Full vitest (serial gate, 2 workers): 82 files, 2207 tests passed, 0 failed, no "too many connections". (Lane reported 2205 before its last server edits; now 2207.)
- Independent SQL oracle (my own queries, written from the brief, not from the lane code) vs GET /company/process, on 5,000 tasks (and again on 25,000): rework, first-pass, duplicates, churn median/p90 and hand-off median/p90/open, 7d/30d/90d, admin and member, with and without a department: 12 of 12 cases equal at both volumes. Note: the oracle must use N*24 hours, not `interval 'N days'`, because of the DST shift the c54/c65 notes describe; the lane's 24h windows are the consistent choice.
- Hand recomputation of the lane fixtures (churn 20 tasks: median 0.5, p90 = 18th = 3; hand-off 1,2,4,6,9 gives median 4, p90 9; Eng 2,4,6,9 gives 5 and 9; rework 4/7 = 57.1; first-pass 3/8 = 37.5; duplicates 2/5): all equal.
- Demo-mode Process view rendered by me on :11790 (1366x768 dark and light, 390 px).

## Findings

### F1 should-fix: "first-pass" is "first review ever accepted", not "accepted on attempt 1"
Brief: "share accepted on attempt 1". `ProcInput.reviews` (server/src/company/process.ts, type) has no attempt number and the loader (process-routes.ts, reviews query) never reads `task_attempts.attempt_no` of the review's attempt. A task whose attempt 1 failed (not reviewable), was retried (routes.ts:84-90 creates attempt 2), then accepted on its first review counts as first-pass. That is the normal fail-then-retry path and it inflates the figure. The help text and report state the "first review ever" reading but never say attempt 1 is not checked.
Fix: load `(select ra.attempt_no from task_attempts ra where ra.id=r.attempt_id)` and count a task only when its first review is accepted, not stale, and on attempt_no 1; add a fixture (attempt 1 failed, attempt 2 accepted: not first-pass). Or, if the controller prefers the current reading, rename the card and `?` ("Accepted at first review") and drop "attempt 1".

### F2 minor: cause breakdown attributes task-level tags to the first return
Tags are per task (`subject_kind='task'`), not per review. A tag confirmed weeks after the return, or about a later attempt, is shown as the cause of the first-review return (process.ts rework measure; only tags confirmed after the window end are excluded). Order (tag mode, failed criterion, "no recorded cause") is honest and labelled, but the UI title "Causes of the returns" overstates it. Suggest "Failure tags on the returned tasks" and/or only counting tags decided at or after the first review's time is not right either, so prefer the relabel. Also tags on `task_attempt` subjects are ignored.

### F3 minor: reassign with an unchanged goal counts as a duplicate delegation
The reassign route writes a new brief for the new instance (tasks/routes.ts:76) and supersession only matches the same `to_instance`, so reassigning with the same goal text is a "duplicate". Intended by the definition (same goal in same mission) but worth a sentence in the `?`.

### F4 minor: Process view not covered by fit-check, a11y-check or api-mobile
View is local state (no URL), and both scripts navigate by URL (a11y-check.mjs views list also lacks `sub=dimensions` entirely; fit-check reaches Dimensions through ROUTE_TABS only on the Outcomes view). Add `?view=process` (read on mount in Dimensions.tsx) so fit-check, a11y-check and api-mobile can list `/operations?tab=agents&sub=dimensions&view=process`; add `sub=dimensions` to a11y-check views. I ran the lane's own `audit` and Tab-walk functions on the Process view in demo mode at 1672x941, 1366x768 and 390: 0 violations at all three. Fit: main scrollHeight 688 = clientHeight 688 at 1366x768 dark and light, no inner scroll, note line on screen (y 619-647).

### F5 minor: the footnote is clipped at 390 px
`.proc-note` at 390 px: scrollHeight 41 vs clientHeight 28 (overflow hidden from `.dim-note`); the tail "no total, no good level" is cut. The 390 view otherwise has no horizontal scroll (doc 390x390) and cards are 318 px wide, scrolling inside `.main` as on other mobile views.

### F6 minor: Outcomes/Process radiogroup has no arrow-key support
`Segmented` (shared, pre-existing) is role=radiogroup of buttons: Tab to the group then Enter works (verified), ArrowRight does nothing. Not specific to c69.

### F7 minor: registry rows that measure nothing declare `covers`
`process.approval_decision_h` covers timeliness and `process.cost` covers cost while both are unmeasured cells. The guard shows the "does not cover" list, so no wrong claim is displayed, but `covers` is a promise the row cannot keep today.

### F8 minor: "why" lines in help are interpretation stated as fact
e.g. "A task that keeps changing hands is a task nobody owns for long", "repeated work, or a hand-over that lost context". No "good" level is claimed anywhere (grepped ProcessView, processDemo, process.ts, process.ts contract, help page: none), but these sentences read as findings. Soften to "may".

## Check-by-check answers
1. Definitions. Rework: matches the brief (first review in window, returned on that first decision, open outside the denominator, open is a snapshot of now and says so in the card, `?` and report). Churn: matches (changes after first assignment, same agent not counted, null agent skipped, n<20 null, nearest-rank p90). Hand-off wait: "first action" = first started attempt at or after the delegation, in SQL with `<= now()`; open ones beside. Duplicates: matches; excluding `created_by 'system'` simulator briefs is right (they are not delegation decisions and share a fallback goal; attachSimBrief is the only system writer, service.ts). First-pass: see F1. Windowing: every bound is DB time (dbWindow, snapshotTx REPEATABLE READ, `<= now()`, lower bound a superset of 2*len+2 ms, pure function places rows; 24h windows, previous window ends 1 ms before). Known caveat (in report): stale flag and open status are read as of now, also for the previous window.
2. Honest cells. Approval and cost are unmeasured cells with `n: null`, dashed strip, "not measured in this version" / "not measured until Stage 9", help text states it. "Open" is labelled a snapshot. Cause order as specified (see F2 for the task-level caveat). No "good" claim anywhere.
3. Registry. Seven rows, each with a real counter-metric or "none" with a reason. Sentences read sensibly: rework to failure_rate, first-pass to tasks_verified_by_review, churn to median_cycle_time_h, hand-off to task_recovery_rate; duplicates, approval and cost are "none" with reasons (the duplicates one describes how it is gamed more than why no counter exists; fine). `task_owner_history.owner` has `tables: []` and is counted as a declared table through the `id.split('.')[0]` prefix in c66-registry.test.ts; classification is correct: only `tasks.owner` writers exist in src (human reassign route, system backfill) so churn is not gameable, and the test asserts that tasks.owner and the history field travel together in every WRITE_SITE. The trigger blind spot is real (a script or migration writing history would not be seen) and the lane discloses it; it does not change the flag today. c66 registry, writability, contracts tests pass. The two server tightenings (live-row list includes process cells; 11-gameable pin scoped to the three c66 kinds, with a separate exact pin for the seven process rows; snapshot file untouched) are legitimate; loaderTables adds the new loader file, contracts coverage seeded flow added, no allowlist line.
4. Privacy. Member vs admin on the same data: member counts exclude the admin's private mission (rework n 2986 vs 3733 at 90d) and match the oracle restricted to the shared mission. No per-person data in the DTO (cells, failure-mode labels, counts only). Department filter cannot widen visibility (visible-missions predicate applied first); duplicate `department` param is 400, unknown key 400, unknown department 404, anonymous 401, writes refused. `departments` lists all active departments to any user (same as c54).
5. UI. See F4, F5, F6. Demo Process view: seven cards labelled "SAMPLE", plus the DEMO tag, unmeasured strip, guard shields and ? present, no console errors, no violations, fits. Keyboard: Tab then Enter on the switch works; guard buttons have names ("Goodhart guard for Returned for rework: gameable").
6. Performance. 5,000 tasks (about 5,100 reviews, 5,000 briefs, 6,500 history rows): route 120-180 ms (scorecard 125 ms, dimensions 150 ms). 25,000 tasks: process 520-930 ms (scorecard 3.9-4.1 s, dimensions 720-760 ms). No time bound on reviews/briefs/history is not a problem at these volumes; linear.
7. Tests. Full vitest green (above). api-c69 and the browser chain were not re-run by me (not needed for the verdict; the lane reports 36/36 and the rest).

## Verdict: CLEAR AFTER FIXES
Required: F1 (attempt-1 check or an honest rename plus a fixture). Recommended with it: F2 relabel, F4 `?view=process` URL param so fit-check/a11y-check/api-mobile cover the Process view. F3, F5-F8 may be backlog.
