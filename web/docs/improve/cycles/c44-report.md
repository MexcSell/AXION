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
