# c55 review (independent), branch c55-thread-followups bfe891e..4cac406

Verdict: CLEAR AFTER FIXES (one should-fix, the rest minor). All runs via heavy.sh, ports 10492/10493, DB axion_e2e3, load printed per run. Scratch worktree /tmp/c55rev-base (base bfe891e) created and removed; nothing in the lane or /home/luca/AXION was modified.

## Findings

1. SHOULD-FIX: api-c55 anchor check is flaky at load ~16 and its pass window is a fixed 600 ms. One of 8 candidate runs FAILED (THROTTLE=4, load 15.8 to 16.8):
   `FAIL ... worst shift 0.3 300.3 0.4 px`. Page 2 stayed 300 px off past the 600 ms window. The seven other runs (x1 and x4, load 11-21) passed, 0.1-0.5 px.
   Every page shows a one-sample 300 px spike at the moment of the grow: the test grows the row, and the thread has not committed yet because RO is delayed 3 s. The bar drops samples from LATE_AT-100 to LATE_AT+600 (api-c55.mjs ~line 130). Under load the commit lands later than 600 ms, and the check then reports the pre-commit state as a failure.
   The code under test is probably fine (the spike resolves in the other 7 runs); the test is not robust. It also means the report's "GREEN x4 0.3 0.3 0.2" is not stable.
   Fix: wait for the commit with a condition (a thread-write marker, or hold() having run) instead of 600 ms, or require the row to return within the bar by a deadline (like "settles within N s, and never drifts after settling"). Keep the RED on base: base x4 gave 300.4 300.3 299.8 px, load 15.8-16.8.
   Related: the exclusion window means a transient 300 px visual jump for one commit is by design not tested (it is partly artificial, because the test delays RO; with a real RO, hold() runs in the callback).

2. MINOR: item 1 release logic (ChatView.tsx hold(), `unmeasuredAbove` and the `commit && !meter.pending` release). Read the code; it looks right.
   - Release needs a commit with no measurement pending and every rendered row above the anchor present in geo. `meter.pending` is set in bump and cleared by its own timer, which GEO_MAX_WAIT bounds.
   - After release, a late growth of the sliver row above the anchor (an image) is anchored to the recorded first-visible row (the sliver), so the reader's anchor row can shift by the growth. The hold now just lasts until measurement; images or fonts arriving after release are not covered. The brief asked only for hold-until-measured; note it as a residual.
   - Timers and listeners: the restoreT timer is cleared on a new restore and on unmount (the cleanup in the mount effect). Messenger's Thread is keyed per agent|cp, and ChatDock and JobSearch key ChannelChat, so a thread switch remounts. AgentProfile's ChannelChat is not keyed, but a scroll or a changed anchor row cancels `restored` (scrollTop !== own), and the timer is harmless when it fires. No leak found.
   - The 10 s bound warns once and only if rows are unmeasured. `MODE=never` is covered by api-c55, but I did not run it. Acceptable.
   - The RED is constructed (a 300 px grow after the old 1 s timer), as the lane says. It models "a row above changes size after the timer and before measurement". On base x4 it fails reliably (300 px x3), on the candidate it passes. It is a fair proxy of the policy, not of a natural race; the lane disclosed that.

3. PASS: api-c26 on the candidate, 3 runs, load 10.2, 23.2 and 17.9: 22/22 each; I2 shifts 0.6 0.4 0.2 0.1 / 0.9 0.1 0.3 0.2 / 0.5 0.3 0.5 0.5 px. Note: the assertion is ±8 px (not 0.3 px). The script has no CPU-throttle option, so there was no throttled c26 run; the throttle coverage is api-c55 x4.

4. PASS (item 2) with a caveat. Interleaved api-c55-burst, REPS=1 FILL=1000 BURST=200:
   | run | load at start | forced layouts in hold/record | long tasks (whole trace) |
   |---|---|---|---|
   | base 1 | 18.3 | 29, 182 ms | 5, 1718 ms |
   | cand 1 | 18.3 | 8, 7 ms | 8, 1053 ms |
   | base 2 | 17.2 | 30, 122 ms | 8, 1205 ms |
   | cand 2 | 16.1 | 7, 8 ms | 7, 1222 ms |
   Reproduces the lane's direction (311 to 33 and 123 to 7 ms); the hold/record attribution is the result, the whole-trace totals are load noise. Skips reviewed: a row above the reader resizing during an append goes through the RO (`above` is true when the row is at or before the reader's row, or the reader row is not rendered), so hold() still runs; a late image is a resize and takes the same path; the layout-effect gate keys on geoV, window, firstShown, view and atBottom, so appends below the reader skip hold only. The pinned early return skips record(); onScroll records. I found no case that breaks the anchor, but there is no direct test for "a row above the reader grows during an append" beyond api-c26/c55.

5. PASS (item 3). api-c44, interleaved with the mutation (pre-fix flushDelay without the gap condition, applied in the scratch worktree), load 20-22:
   | variant | THROTTLE | excess (median after minus median quiet) |
   |---|---|---|
   | mutation | 1 | 337, 340 ms: FAIL |
   | mutation | 4 | 321, 373 ms: FAIL |
   | candidate | 1 | 6, -4 ms: PASS |
   | candidate | 4 | -0, 51 ms: PASS |
   The comparison is sound: same run, same page and flags, interleaved, medians. The margin (80 ms) is about 0.25x of the smallest mutation excess (321 ms), and 29 ms above the worst correct-code excess (51 ms at x4, load 19-22). It is principled enough (the flush adds 60 ms; the mutation adds up to 300 ms), but the headroom on the good side at x4 is thin. Minor: the first quiet probe in the mutated runs is an outlier (466, 479, 713, 691 ms: it follows the 200-message burst before the flush state has settled); the median hides it. The 30-message re-burst is justified (a 10-message re-burst passed the mutation at x1, per the lane). Not loosened vs the old bar in a meaningful way: old 200 ms absolute failed correct code at x4 (the lane's RED), and the new bar fails the known-bad mutation.

6. api-c22 N=130 flake: NOT REPRODUCED, cannot be attributed to c55. Interleaved base (bfe891e) and candidate, 4 pairs each, `SIZES=130 REPS=3`, load 11.5-17.8 at start: 8 of 8 runs 9/9 green ("50 to 100 rows, shift 0.0-0.3 px"). Code reading: requestOlder is called from onScroll at scrollTop<80 and is guarded by hasOlder/loadingOlder/armed, none of which c55 touched. The hold change cannot suppress a scroll event; `hold()` writes scrollTop only when not at the bottom. Mechanism of the original failure (a scrollTop=0 that produced no scroll event, or a pin after the jump) is independent of the c55 diff. Treat as a pre-existing flake; keep it on the backlog with the load figure (19.8).

7. PASS (item 5, reader not pinned after a fast burst): confirmed on base. api-c55-burst, base: "still pinned false (15667 px / 15754 px from the bottom)"; candidate: false (16811 / 17074 px). Same on both, so c55 does not make it worse. It is pre-existing; a separate backlog item (the smooth follow-scroll falling behind). Note it is the reason hold() still runs during bursts, so the item 2 gain is realised only because of the other changes.

8. MINOR: test changes. api-c44's bar is relative (and robust, see 5); `check('the burst arrived whole')` was adjusted to a larger count (BURST + 1 + PROBES*(REBURST+2)), same intent. The initial wait `>= BURST+1` is a condition wait. api-c55 and api-c55-burst use a few fixed `waitForTimeout` calls (800 ms settle, LATE_AT 1300, 600/300 ms), each a settle or a scripted delay rather than a wait on state; finding 1 is the one that matters. The api-c44 header comment has a duplicated phrase ("60 + 12 per event of the last batch, 60 + 12 per event...").

9. MINOR: the item 5 hang (N=1000) is recorded NOT REPRODUCED (21 reps); I did not retry. Fine.

## Verdict
CLEAR AFTER FIXES: make api-c55's anchor check wait for the commit by condition instead of a fixed 600 ms exclusion (finding 1), then re-run x4 several times. Code changes are OK to merge as written.
