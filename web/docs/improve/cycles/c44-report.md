# Cycle 44 report: page- and store-level cost of a live message burst (lane w43)

Branch `c44-page-perf`, base c068a6d. Measurement: `web/scripts/api-c26.mjs`, unchanged (same method, whole-trace headline, c22 summariser). Timing runs used `CHECKS=0` (the script's own switch that skips the behaviour checks, so reps are quicker); the base was measured with checks on. Lane stack 9392/9393, `axion_e2e16`.

## Status
- **Full burst (FILL 1,000): NOT MET.** Base 1,528 ms, after the three steps 1,367 ms; the bar is 887 ms.
- **Floor (`FLOOR=1`): PASS.** Base 847 ms, after 492 ms (-42 %; bar 593 ms). Load was 18-22 for that run, so it is not a quiet-machine number.
- **Worst merged period (≤ 250 ms): NOT MET on the whole trace of the full burst.** Base 509-1,013 ms, after 233-318 ms (two of three reps under 250). Floor worst after: 255 / 161 / 125 ms.
- All green checks pass (below).

## Timings (whole trace, 3 reps, mean of 3; load = 1-min load average at each rep)
| Run | Load | Total per rep (ms) | Mean | Worst per rep (ms) |
|---|---|---|---|---|
| Base, full | 8.8 / 9.7 / 10.8 | 1,466 · 1,417 · 1,702 | **1,528** | 1,013 · 509 · 924 |
| Base, floor | 8.9 / 8.5 / 9.0 | 866 · 888 · 788 | **847** | 219 · 156 · 196 |
| Step 1 (`lastEventAt`), full | 11.9 / 11.8 / 12.3 | 1,718 · 1,405 · 1,479 | 1,534 | 675 · 880 · 1,100 |
| Step 1, floor | 14.7 / 14.8 / 15.3 | 904 · 926 · 995 | 942 | 201 · 192 · 193 |
| Step 2 (+ Missions selectors), full | 13.2 / 13.4 / 13.5 | 1,300 · 1,325 · 1,371 | 1,332 | per rep not recorded (burst window 391 · 399 · 646) |
| Step 2, floor | 11.9 / 12.6 / 14.2 | 398 · 572 · 594 | **521** | 250 and below |
| Step 3 (+ adaptive flush), full | 17.4 / 17.7 / 18.9 | 1,196 · 1,131 · 1,773 | **1,367** | 303 · 233 · 318 |
| Step 3, floor | 18.5 / 21.7 / 21.9 | 580 · 537 · 359 | **492** | 255 · 161 · 125 |

Every run after the base ran at a higher load (12-22) than the base (9-11), so the later numbers are, if anything, pessimistic.

## Which step bought what
1. **`lastEventAt` coalescing (`events.ts`): no measurable gain** (1,534 / 942 against 1,528 / 847, within noise at higher load). Kept anyway: it is a correct, cheap reduction of per-event writes, and the freshness dot stays within 250 ms. This breaks the brief's "keep only if it helps"; revert commit 1's `events.ts` hunk if the owner wants the rule applied strictly.
2. **Missions selectors: the big one for the floor** (847 to 521). The real subscription was `useMissionControl(...)` at `Missions.tsx:136` and `:476`, which returns the whole mission-control entry: every thread write replaces the entry object and re-rendered the page shell (MissionRow, Tip, MissionList showed in the floor profile). Both sites only need `nodes`, so they now use a new `useMissionNodes` hook that subscribes to `byMission[id].nodes`. Full burst: 1,528 to 1,332.
3. **Adaptive flush: worst task down, total unclear.** Whole-trace worst fell from 509-1,013 ms to 233-318 ms; the total did not move measurably at the higher load (1,367). Floor 521 to 492.

## Where the rest of the full burst goes
The component-commit profile (`COMMITS=1`, dev only, not shipped) at step 2 showed 31 commits, ThreadRow 256, minimap Block 562 and Tip/Popper about 170-190 renders. The sampled profile is dominated by native time: forced layout from the `scrollTop` read in `ChatView.hold` (about 150-175 ms) plus React dev-mode overhead. That is thread-level work (c26's area), not the page or the store. I did not try to change it in this cycle.

## Changes
| File | Change |
|---|---|
| `web/src/api/events.ts` | `stampEvent()`: `lastEventAt` written at most once per 250 ms (leading write, one trailing write with the newest time) |
| `web/src/api/missionControl.ts` | new `useMissionNodes(missionId, parts)` hook (nodes-only subscription); adaptive flush: `flushDelay()` between 60 and 400 ms from the last batch size (`60 + 12 * batch`, back to 60 ms when the last batch had fewer than 8 events or after 1 s of quiet) |
| `web/src/pages/Missions.tsx` | the two `useMissionControl` calls now `useMissionNodes` |

Behaviour kept: a single message still lands within 60 ms; the pinned reader stays pinned (api-c26 pinned checks pass); SSE resume and dedup are untouched (the dedup is before `stampEvent`).

## Green checks (HEAD ce9782e, load 11-21, all through heavy.sh)
| Check | Result |
|---|---|
| api-c26 behaviour checks (REPS=1, FILL 1,000) | 22/22 |
| api-stage6 | 94/94 |
| api-c22 SIZES=130,1000 REPS=3 | 14/14 |
| api-improve | 107/107 |
| `DATA_MODE=api a11y-check` | 0 violations (40 views, 56 dialogs). Some page probes printed "Request failed" lines under load; no violation |
| verify-all (dev 9390, OUT /tmp/axion-verify-w43) | ALL 10 STEPS PASSED |
| flows.mjs | all PASS, no console errors |
| web `tsc --noEmit` | clean |

No assertion was changed.

## Concerns
- The 887 ms bar for the full burst is NOT MET, and I do not see a page- or store-level step left that would close a 1,367 to 887 ms gap; the rest is thread layout and React dev-mode cost.
- Timings are noisy: load moved from 9 to 22 across runs and the later runs were slower machines. A clean re-run at load below 10 is worth doing.
- Per-rep worst for the step 2 full run was not recorded in this report (only the burst-window figure).
- Adaptive flush adds up to 400 ms of latency while a burst is running; a lone message is still 60 ms.
- The step 1 hunk gave no measurable gain (see above).

## Fix round (review c44-review.md: FAIL on one behaviour regression)

### 1. The regression: older-page anchor (api-c26 I2, "each older page keeps the visible message in place (±8 px)")
**RED** (tip 69bca39 plus the two small fixes below, REPS=1 FILL=1000, load 8.4-10.6): 21/22 three times; shifts `0.8 0.0 360.2 0.1`, and in debug runs `0.2 0.4 386.8 207.9`, `0.3 0.4 423.7 0.3`, `0.7 0.3 0.4 350.1`.

**Mechanism** (instrumented `ChatView`, temporary logs removed): the older-page restore put the anchor row back correctly (the restore logs matched). The next `record()` then recorded a different row (`record 564 top -542`, `record 567 top -118`) as the reader's row, because the window is cut from an estimate-based scroll position and the rows between were not what the reader was on. When the tall rows above were then measured (estimate to real, 350-424 px), `hold()` kept that wrongly recorded row in place and so moved the real anchor by the same amount. The page-shell re-render that `useMissionNodes` removed was not a data dependency: it only changed commit timing, which hid this race. It is a latent race in the c26 anchor, not a stale-data bug in `Missions.tsx`.

A first guess (the row above the anchor shows only its 2 px gutter at the viewport top, so `record()` should skip it) was tried and did NOT fix it (still 21/22, shifts 408 and 441); it was removed.

**Fix** (`web/src/features/chat/ChatView.tsx`): after the older-page restore, the restored row itself is the scroll anchor for `RESTORE_HOLD_MS` = 1,000 ms while nobody scrolls (`restored` ref; dropped when `scrollTop` differs from the position the thread wrote, or after the time). `hold()` corrects against that row when it is rendered; otherwise it falls back to the existing recorded row. The ±8 px assertion is untouched. The `useMissionNodes` selector win is kept.

**GREEN** (HEAD bf367d6, api-c26 REPS=1 FILL=1000, full run): **22/22, 22/22, 22/22**, load 7.6, 8.4 and 6.3 at the start; I2 shifts `0.3 0.5 0.2 0.0`, `0.4 0.3 0.1 0.4`, `0.0 0.3 0.0 0.0` px.

### 2. `lastEventAt`
The coalescing hunk is removed (`events.ts` is back to its c068a6d content). It gave no measured gain.

### 3. Adaptive flush latency
`flushDelay()` now measures the gap between events: the longer interval (60 + 12 per event of the last batch, at most 400 ms) applies only while events arrive less than 100 ms apart and the last batch was at least 8; an event after a pause, or after a small batch, is flushed after 60 ms. It is evaluated for every event, so the gap is tracked correctly.

New script `web/scripts/api-c44.mjs` (own script; no frozen assertion edited): a burst, then a 10-message re-burst, a 150 ms pause, a lone message; the time from the POST to the message being in the store must be at most 200 ms. Result at HEAD: **PASS**, after a burst `111 117 117 118 89` ms, quiet control `118 98 102 101 114` ms, 262 messages held, no page errors. I did not run it against the old `flushDelay` to show it RED; by the code, the old delay after a 10-message batch was 180 ms before the POST and stream time were added.

### 4. Full green set on the final tip (bf367d6; all through heavy.sh)
| Check | Result |
|---|---|
| api-c26 x3 (REPS=1, FILL=1000) | 22/22 x3, load 6.3-8.4 |
| api-c44 | 3/3 checks |
| api-stage6 | 94/94 |
| api-c22 `SIZES=130,1000 REPS=3` | first run (load 9-15): behaviour 9/9 and **one N=1000 rep did not become interactive within the 180 s cap** (rc 1; the other five reps 1.3-1.6 s). Re-run (load 7-8): **14/14**, rc 0, reload to interactive 1.1-1.4 s (130) and 1.1-1.4 s (1,000). I did not reproduce the hang, so I cannot tell whether it is load or a defect in this change; flagged. |
| api-improve | 107/107 |
| `DATA_MODE=api a11y-check` | 0 violations (40 views, 56 dialogs) |
| verify-all (dev 9390) | ALL 10 STEPS PASSED |
| flows.mjs | all PASS, no console errors |
| web `tsc --noEmit` | clean |

### 5. Timing pass (HEAD bf367d6, REPS=3, `CHECKS=0`, whole trace; two passes, load 4.8-8.9, lower than the first round)
| Run | Load | Total per rep (ms) | Mean | Worst per rep (ms) |
|---|---|---|---|---|
| Full burst, pass 1 | 6.5 / 7.0 / 6.3 | 890 · 800 · 712 | **801** | 231 · 160 · 181 |
| Full burst, pass 2 | 4.8 / 5.1 / 5.9 | 1,082 · 786 · 669 | **846** | 339 · 180 · 164 |
| Floor, pass 1 | 6.9 / 7.0 / 8.2 | 348 · 75 · 89 | 171 | 239 · 75 · 89 |
| Floor, pass 2 | 8.9 / 7.9 / 7.3 | 270 · 209 · 228 | 236 | 211 · 94 · 115 |

| Threshold item | Result |
|---|---|
| Full burst total at most 887 ms | **PASS on both passes** (801, 846 ms) at load 5-7. It was NOT MET at load 11-19 in the first round (1,367 ms) and in the reviewer's runs (1,084 ms mean), so it depends on load: report it as PASS at low load, not NOT MET at high load, and not as a quiet-machine guarantee |
| Floor at least 30 % below the own base (847 ms, measured at load 9-10) | **PASS**: 171 and 236 ms (-80 % and -72 %) |
| Worst merged period at most 250 ms | **MET in 5 of 6 reps of the full burst**: one rep was 339 ms. The mean worst per pass is 191 and 228 ms. Strictly, a rep above 250 ms exists, so: **PASS on pass 1 (all three under 250); NOT MET on pass 2 (one rep 339 ms)** |
| Green checks | PASS, with the one api-c22 N=1000 rep 1 hang at load 15 flagged above |

The base in this report (1,528 / 847 ms) was measured at load 9-11; the review's interleaved base was 1,684 / 960 ms. Both agree on the direction.

### Concerns (fix round)
- The restored-row anchor lasts 1 s; a reader who scrolls cancels it. It does not claim to fix other races in the c26 thread anchor.
- The api-c22 N=1000 rep 1 non-interactive reload (load 15) is not explained. Re-run at load 7-8 was clean.
- The latency check was not shown RED against the old flush delay.
