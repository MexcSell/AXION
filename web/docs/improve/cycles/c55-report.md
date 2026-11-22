# Cycle 55 report: thread follow-ups (P2b), lane w54

Branch `c55-thread-followups`, base bfe891e. E2E DB `axion_e2e3`, ports 10490-10493. No migration, no server change. The machine was shared and busy the whole time (1-minute load 10 to 21), so every number below carries its load, and absolute timings are noisy; the comparisons that matter were interleaved at the same load with the same flags.

## Status
| Item | Result |
|---|---|
| 1 Restore anchor | **PASS** RED to GREEN (RED needed a constructed late-measurement, see below) |
| 2 Forced layout in `hold` | **PASS** RED to GREEN (forced-layout time in hold/record 123-311 ms down to 7-35 ms) |
| 3 Relative latency bar | **PASS** RED to GREEN, and still fails a known-bad mutation |
| 4 Production number | **PASS** (measured): prod 717-780 ms against dev 1,365-1,647 ms whole-trace long-task total |
| 5 api-c22 N=1000 hang | **NOT REPRODUCED** (21 N=1000 reps in 7 attempts, none hung) |

## Threshold table
| Threshold item | Result | Evidence |
|---|---|---|
| Items 1-3 RED to GREEN | PASS | sections 1-3 |
| Item 4 measured | PASS | section 4 |
| Item 5 recorded honestly | PASS (NOT REPRODUCED) | section 5 |
| api-c26 passes | PASS | 22/22 three times on the final ChatView (shifts for I2 0.1-0.5 px, load 9.7-17.7) |
| api-c44 passes | PASS | 3/3, excess -4 ms (load 17.6); also x1 and x4 throttle |
| api-c22 passes | PASS with one flake | 5 attempts rc 0; attempt 6 (run beside verify-all, load 17-21) failed one behaviour check, see section 5 |
| api-stage6 | PASS | 94/94 (load 17.9) |
| api-improve (extra) | PASS | 107/107 |
| web and server `tsc --noEmit` | PASS | clean |
| verify-all 10/10 | PASS | "ALL 10 STEPS PASSED", `OUT=/tmp/axion-verify-w54`, dev 10490 |
| flows | PASS | no FAIL, "no console errors" at `FLOWS_CPU_THROTTLE=1` and `=4`; the 10 s anchor warning did not fire |
| a11y (`DATA_MODE=api`) | PASS | 41 views, 65 dialogs, 0 violations (some page probes print "Request failed" under load, as in c44) |

## 1. Restore anchor (`ChatView.tsx`)
**Change.** `RESTORE_HOLD_MS` (1 s) is gone. After an older page lands, the restored row stays the scroll anchor until every rendered row above it has an entry in the geometry cache (`unmeasuredAbove`, a DOM walk with no layout read). The check runs only after a commit with no measurement pending (`meter.pending`, new: set by `bump`, cleared when its timer fires), so a commit that mounts new unmeasured rows above the anchor keeps the hold. The scroll cancel is kept (`scrollTop !== own`). The bounded exit is `RESTORE_MAX_MS` = 10 s on its own timer (cleared on a new restore and on unmount): it releases the anchor and, only if rows above are still unmeasured, logs one `console.warn` ("[chat] restore anchor released after 10000 ms with rows above it still unmeasured"). `warn`, not `error`, because flows asserts no console errors.

**RED** (test `api-c55.mjs`, check "the restored row stays within 8 px for 4 s after each older page while rows above it are measured 3000 ms late", on the unchanged ChatView, load 18.5): first error line `FAIL the restored row stays within 8 px ... worst shift 300.1 300.1 300.4 px`. Method: the thread (200 mixed-height messages) is reloaded, each older page request is held then released, ResizeObserver callbacks are delayed 3 s, and 1.3 s after the page lands the row just above the anchor grows by 300 px (as an image or font arriving late would) and a thread write follows so the thread commits. Old code: the 1 s timer has expired, `hold()` falls back to the recorded row (the 2 px sliver of the row above the anchor), and the anchor stays 300 px off. Samples are taken every 100 ms for 4 s; the bar uses samples from 600 ms after the grow, once the thread has committed.

**Honest limit of the RED.** I could not make the old code drift from a delayed measurement alone: delaying ResizeObserver by 1.5 s, 2.5 s and CPU throttle x4 and x6 all gave shifts of 0.1-0.8 px on the old code. The c44 race (recorded row differing from the reader's row) needs a row above the anchor to change size inside the window where the timer has run out and the measurement has not landed; the grow step builds exactly that. So the RED proves the policy ("hold until measured"), not a naturally occurring drift under throttle.

**GREEN** (HEAD): `api-c55` anchor 0.2 0.3 0.3 px (x1, load 21.5) and 0.3 0.3 0.2 px (x4, load 18.5); final run 0.5 0.2 0.2 px (x1, load 15) and 0.3 0.5 0.2 px (x4, load 16). Safety exit (`MODE=never`, callbacks swallowed, reader stays): no release for the bound, then exactly one warning, 7.4 s after the 4 s sample. api-c26 I2 ("each older page keeps the visible message in place (±8 px)") x3: shifts 0.5 0.4 0.2 0.2 / 0.3 0.4 0.1 0.5 / 0.4 0.4 0.2 0.2 px.

**Discrepancy to note.** The brief says api-c26's I2 bar is 0.3 px. The assertion in `api-c26.mjs` is 8 px (measured values are 0.1-0.5 px). I left api-c26 untouched.

## 2. Forced layout in `ChatView.hold`
**Measure.** New `api-c55-burst.mjs`: a 1,000-message thread, 200 live messages posted 10 at a time, a Chromium trace with the stack category; it counts `Layout` and `UpdateLayoutTree` events that carry a JavaScript stack (forced layouts) and groups them by the first frame in the page's code. Dev build only for the attribution. RED/GREEN bar: forced-layout time attributed to `hold`/`record` at most 40 ms per burst.

**Change.** (a) `hold()` returns at once when the reader is pinned to the bottom and no restore is running (no `scrollTop` read, no `record()`); (b) the layout effect after each commit calls `hold()` only when something above the reader could have moved (`geoV`, the window, the first message, the view, `atBottom` changed, or a restore is active), so a commit that only appended messages below the reader skips it; (c) the ResizeObserver callback calls `hold()` only when a changed row is at or before the reader's row (or the width changed). A first version with (a) and (b) only still left 25 hold events because the thread is not pinned during these bursts (see concerns); (c) was added after reading the trace.

Interleaved pairs, same flags (`REPS=1 FILL=1000 BURST=200`), file swapped between runs, load printed at each start:
| Pair | Variant | Load at start | hold/record forced layouts | `get scrollTop` self | whole-trace long tasks |
|---|---|---|---|---|---|
| 1 | base | 16.0 | 36 events, 311 ms | 213 ms | 10, 2,882 ms (worst 1,184) |
| 1 | candidate | 20.3 | 18 events, 33 ms | 61 ms | 7, 1,779 ms (worst 676) |
| 2 | base | 19.1 | 26 events, 123 ms | 119 ms | 7, 1,173 ms (worst 269) |
| 2 | candidate | 19.5 | 8 events, 7 ms | 12 ms | 6, 1,045 ms (worst 312) |
The dev/prod runs of section 4 add three more candidate dev runs: 13, 10 and 35 ms in hold/record.

**RED** on base: the script printed `FAIL ... forced-layout time in hold/record <= 40 ms` (311 ms and 123 ms). **GREEN** on the candidate: 33, 7 ms, and 13, 10, 35 ms in later runs. Totals (second column of long tasks) improve in the same direction but are not a clean claim: load moved 16 to 20 between the base and candidate runs, so only the hold/record attribution is the result.

**What is left.** Forced layouts in the burst still total 130-220 ms; the largest one is not hold: `measureDocumentScroll` inside motion (framer) called 18-28 times, 139-160 ms, from the layout animations. That is a separate follow-up (suggest `layout` props on `ChatBubble` rows).

api-c26 x3 on the final ChatView: 22/22 each, load 15.5-17.7 at start, I2 shifts as above, no FAIL. api-c55 anchor re-run after the change: PASS.

## 3. Relative latency bar (`api-c44.mjs`)
**Change.** The 200 ms absolute bar is now "median of the after-burst probes no more than `MARGIN` = 80 ms over the median of a quiet control from the same run". Quiet and after-burst probes alternate on the same filled thread (quiet, 30-message re-burst, pause 150 ms, probe, repeat x5), same page, flags and `THROTTLE`. The re-burst grew from 10 to 30 messages: with 10 the old rule's delay was not reliably triggered (the mutation below passed at x1).

**RED** (old script with only a CPU-throttle line added, on correct code): x4 `FAIL a lone message 150 ms after a burst is in the store within 200 ms — after a burst: 297 277 257 274 264 ms · quiet control: 239 228 267 242 234 ms`; x6 `FAIL ... 550 416 394 408 394 ms · quiet control 369 363 352 345 354 ms` (load 9.7 and 8.5). The old bar fails a loaded machine with no fault in the flush (the quiet control is itself over 200 ms).

**GREEN** (new script, correct code): x1 excess 0 ms (load 12.6), x4 excess 26 ms (load 12.3); also x4 6 ms and x6 -9 ms (load 9.5 and 7.4) with the earlier 10-message variant; final run excess -4 ms (load 17.6).

**Known-bad mutation** (uncommitted, reverted with `git checkout`): `flushDelay` returning `lastBatch >= 8 ? min(400, 60 + lastBatch*12) : 60` (the pre-fix rule, no gap condition). New script FAILS: x1 `excess 335 ms` (after 482 469 470 463 468, quiet median 134), x4 `excess 444 ms` (load 12). The 10-message re-burst version passed this mutation at x1 (excess 23 ms), which is why the re-burst grew. Diff used: one line in `missionControl.ts` (`void streaming; return lastBatch >= 8 ? ... : FLUSH_MS;`).

## 4. Production number (secondary)
Production build (`vite build --outDir /tmp/w54-dist`, `vite preview` on 10491 with `AXION_API` pointing at the e2e API, started and stopped inside the api-e2e command by recorded PID), same script and flags as dev, alternating dev and prod, candidate ChatView, load 15-17:
| Pair | Build | Load | Whole-trace long tasks (count, total, worst) | Store has the burst after |
|---|---|---|---|---|
| 1 | dev | 15.3 | 6, 1,365 ms, 616 ms | 1,726 ms |
| 1 | prod | 15.9 | 4, 780 ms, 385 ms | 1,627 ms |
| 2 | dev | 15.6 | 6, 1,387 ms, 456 ms | 1,578 ms |
| 2 | prod | 17.2 | 5, 734 ms, 248 ms | 1,845 ms |
| 3 | dev | 17.2 | 5, 1,647 ms, 892 ms | 1,722 ms |
| 3 | prod | 15.8 | 6, 717 ms, 200 ms | 1,792 ms |
So the full-burst cost on a production build is 717-780 ms (mean 744) against 1,365-1,647 ms (mean 1,466) in dev, about half. Forced layouts are not attributed in prod (minified names). A c26-style `held()` cannot run on a production build (it imports `/src/...`), so the script counts minimap blocks instead.

## 5. api-c22 N=1000 reload hang
Attempts (`SIZES=130,1000 REPS=3`, each 3 reps per size, rc and load at start): 5 sequential attempts at load 10.9-16.0, rc 0 for all five; two more attempts while verify-all ran (load 17.6 and 20.0): attempt 7 rc 0, attempt 6 rc 1. Totals: **21 N=1000 reps, none hung**; reload to interactive 1.2-1.9 s (cap 180 s), at load 11.5-20.9. **NOT REPRODUCED.**

Attempt 6's failure was a different check: `FAIL N=130: scrolling up loads the next older page, the top message stays put, no duplicates — 50 → 50 rows, shift 0.0 px` (rep 1 of N=130, load 19.8): the older page was not requested within 8 s. Not seen in the other 17+ N=130 reps. To see whether the c55 changes cause it I ran N=130 x3, base (bfe891e ChatView) and candidate alternating, three pairs, with six busy-loop processes of mine running (load 11.6-20.4, PIDs recorded, gone afterwards): 9 base reps and 9 candidate reps, all green. So it is not reproduced on either, and I cannot say it is unrelated. The test comment (cycle 26 fix round) already names this class: a pin landing after the scroll-to-top jump. Candidate mechanism, untested: the `[geoV]` effect re-pins to the bottom while `atBottom` is still true after the jump. c55 does not change when `bump` is called.

## Files changed
| File | Change |
|---|---|
| `web/src/features/chat/ChatView.tsx` | items 1 and 2 (restore anchor, `meter.pending`, `holdKey`, ResizeObserver `above`) |
| `web/scripts/api-c55.mjs` (new) | anchor check (`MODE=anchor`, `MODE=never`), RO delay, `THROTTLE` |
| `web/scripts/api-c55-burst.mjs` (new) | burst cost, forced-layout attribution, works on dev and prod |
| `web/scripts/api-c44.mjs` | relative bar, interleaved control, `THROTTLE`, `REBURST` |
Commits: 459477e (RED test), a771189 (item 1), 60f4da1 (item 2), 861f964 (item 3), then this report.

## Concerns
1. **The reader is not pinned after a fast burst, even on base.** In api-c26 and api-c55-burst the page reports "still pinned false" (about 5,000-17,000 px from the bottom) after 100-200 live messages arrive while the reader was at the bottom, in dev and (3 of 4 runs) on the prod build, and on bfe891e. Probably the smooth follow-scroll falls behind the growing content, onScroll sees "not at bottom" and `atBottom` stays false. I did not investigate; it is outside the brief. It matters here because it is why `hold` runs during these bursts. `api-c55-burst` prints it and does not gate on it.
2. Item 1's RED is constructed (late growth of the row above), not a natural throttle drift; see section 1.
3. The 10 s bound is a guess; a thread whose rows cannot be measured (hidden tab, `display: none`) logs one warning per restore.
4. api-c22 attempt 6 behaviour failure (older page not requested, N=130), unexplained; section 5.
5. Remaining forced layout in a burst is motion's `measureDocumentScroll` (about 140-160 ms), not addressed.
6. The relative bar's margin (80 ms) leaves 40 ms of headroom below the +120 ms the old rule adds at a 10-message batch, and the mutation only shows at a 30-message re-burst; a different flush bug could slip through. Timings were taken at load 10-21 throughout.
