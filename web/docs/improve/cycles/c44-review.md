# c44 review (independent): page- and store-level cost of a live 1,000-message burst

Lane w43, branch `c44-page-perf`, tip `69bca39`, base `c068a6d`. Reviewer ran everything through heavy.sh on the lane's e2e stack (9392/9393, `axion_e2e16`, dev 9390 for flows). No scratch worktree was needed: for the base I swapped the three app files to their `c068a6d` versions in the lane and restored them with `git checkout 69bca39 -- ...` after each run. The lane ends at `69bca39`, clean.

## Verdict: FAIL (fix needed before merge); the timing result itself is PASS-AS-PARTIAL

The floor win is real and larger than claimed. But the tip **breaks a behaviour check that the base passes**: api-c26 `I2 mixed heights: each older page keeps the visible message in place (±8 px)` fails 3 of 3 runs on the tip (shifts of 150-436 px on pages 3 and 4) and passes 2 of 2 on the base. The report says 22/22. Bisect points at the `Missions.tsx` change (`useMissionNodes`). Reverting only `Missions.tsx` gave 22/22; reverting only the adaptive flush or only the `lastEventAt` hunk still failed.

## Findings

### Confirmed (reproduced)
1. **High: older-page anchoring regression in a long mixed-height thread.** Check: `web/scripts/api-c26.mjs` (the I2 older-pages check, around line 389). Failure scenario: open a long thread with images, scroll to the top so older pages load; the visible message jumps 150-436 px on the 3rd and 4th page. Evidence (REPS=1 FILL=1000, load 6-8, same machine):
   - tip: FAIL, FAIL, FAIL (shifts `0.1 0.4 404.7 213.2`, `0.7 0.2 436.1 233.4`, and the first run `... 213.2`);
   - base: PASS, PASS;
   - tip with `Missions.tsx` at base: PASS (22/22);
   - tip with flush fixed at 60 ms: FAIL; tip with `events.ts` at base: FAIL.
   Mechanism not established (see Plausible). It is a user-visible scroll jump, not a flaky timing.
   The implementer's "22/22" was measured at HEAD `ce9782e` at load 11-21; I could not reproduce that at low load.
2. **Low: `stampTimer` is not cleared on sign-out.** `web/src/api/events.ts:34-45`; the `startSync` cleanup (about line 150) cancels the debouncers but not `stampTimer`. A write up to 250 ms after sign-out sets `lastEventAt` on a cleared store. Harmless today (the only readers are the unmounted `ServerHealth` and the Overview freshness line), but it is a leaked timer.
3. **Low: a lone message right after a burst can wait up to 400 ms.** `missionControl.ts` `flushDelay`: if the last batch was >= 8, the next flush waits `60 + 12*batch` ms (capped at 400) as long as the last flush was under 1 s ago. It falls back to 60 ms after one small batch, so it never stays stuck. The report's "a single message still lands within 60 ms" is true only when quiet. Quiet lone messages measured 95-110 ms end to end including the POST (base 180-220 ms in the same probe, noise).
4. **Info: the report's headline numbers do not hold as stated.** The base ran with checks on and the later runs with `CHECKS=0`; in api-c26 the checks run after the measured reps, so this does not change the timings (my runs used `CHECKS=0` on both sides). The report's own admission about step 1 (no gain) is honest.

### Plausible (not proven)
- Why `useMissionNodes` breaks the I2 check: the Missions page shell no longer re-renders on a thread write, so something that used to be re-run on each thread commit (for example props that re-key or re-measure the thread, or a layout read after the older page arrives) no longer happens at the point the anchor is restored. Messenger/ChatView have their own `useMissionControl`, so there is no stale data (see "No problem found"), but ordering/timing of measurement versus page commit changed. Needs a look at `ChatView` older-page anchoring (`hold`, `record`, `ChatView.tsx` about 903-920) with the page not re-rendering.
- The ChatView `hold` forced layout (`scrollTop` read, 120-165 ms in every profile I saw) is indeed the largest remaining app cost. The implementer's conclusion that the rest is thread-level matches my profiles (native 1.9-2.3 s of sampled time, `get scrollTop` 120 ms, `hold` 150-165 ms inclusive). Not verified by a change.

## Fair measurement (my runs)
Same command both sides: `REPS=3 FILL=1000 CHECKS=0 node scripts/api-c26.mjs` (and `FLOOR=1`), whole-trace headline, interleaved A/B, same ports, sequential. Load is the 1-min average printed at the start of each run.

| Run | Load (start..end) | Whole-trace total per rep (ms) | Mean | Worst task per rep (ms) |
|---|---|---|---|---|
| A1 base full | 10.7 .. 14.0 | 1,740 / 1,501 / 1,783 | 1,675 | 1,027 / 1,132 / 852 |
| A2 tip full | 14.0 .. 15.3 | 1,779 / 1,485 / 694 | 1,319 | 527 / 650 / 182 |
| A3 base floor | 15.3 .. 14.2 | 978 / 1,248 / 869 | 1,032 | 231 / 230 / 228 |
| A4 tip floor | 14.2 .. 15.2 | 438 / 272 / 357 | 356 | 298 / 93 / 116 |
| B1 tip full | 15.2 .. 14.2 | 909 / 871 / 766 | 849 | 295 / 248 / 213 |
| B2 base full | 14.2 .. 16.2 | 1,592 / 1,813 / 1,675 | 1,693 | 958 / 1,449 / 1,019 |
| B3 tip floor | 16.2 .. 14.5 | 415 / 292 / 237 | 315 | 222 / 102 / 105 |
| B4 base floor | 14.5 .. 12.8 | 898 / 1,006 / 763 | 889 | 210 / 162 / 175 |

All runs were at load 11-16 (above the brief's "repeat if > 12" line; both sides saw the same range, so the comparison is fair, the absolute numbers are pessimistic). Page errors 0.

Threshold items from my runs:
| Item | Base (mean of 2 runs) | Tip (mean of 2 runs) | Bar | Status |
|---|---|---|---|---|
| Floor long-task total | 960 ms | 336 ms (-65 %) | at least 30 % below base | **PASS** (stronger than the reported -42 %) |
| Full burst total | 1,684 ms | 1,084 ms (runs: 1,319 and 849) | <= 887 ms | **NOT MET** on the mean; one of the two tip runs (849) is under the bar, load 12-15 |
| Worst merged period | 1,000+ ms | 527/650/182 and 295/248/213 | <= 250 ms | **NOT MET** (3 of 6 reps under 250 ms) |

So the full-burst result is better than the report says (1,367 → 1,084 vs a like-for-like base of 1,684, about -36 %) but still misses the bar.

## Behaviour checks
- api-c26 behaviour (REPS=1): tip **21/22, 21/22, 21/22** (I2 older pages fails each time); base 22/22 twice. See finding 1.
- api-stage6: 94/94 on the tip.
- flows.mjs (dev 9390, demo): all PASS, no console errors.
- Probe I wrote (scratchpad `probe.mjs`, one mission, 200-message burst plus lone messages, tip vs base): no lost, duplicated or reordered messages (0 dups, seqs strictly increasing, same count as base); the "N new" pill count was the same on both ("251 new" vs "261 new", counting the seed plus burst); `lastEventAt` writes 22-25 on the tip vs 99-106 on the base, never moved backwards (0 backwards in both), min gap 2-3 ms comes from other writers in `data.ts`. My probe's reader was not pinned on either side (a probe artefact, identical on base), so pinning is covered only by the api-c26 pinned checks, which passed (pinned after reload, 3 s stability, N1 pill click).
- Selector stability: `useMissionNodes` returns `byMission[id]?.nodes`, the same array reference until nodes change, so no re-render loop. Confirmed in the browser: the page, header fold button, tab switches, and agent switching worked with no page errors, the header shows the lead version and node count (6) after the burst.

## Answers to the check list
1. `useMissionNodes`: both sites (`Missions.tsx:137`, `:477`) read only `.nodes` from `getMissionControl(m)` (line 139 and line 477). Everything else on the page subscribes on its own (Messenger, WorkspaceTabs, MissionAgents, HierarchyGraph, PartStatus all call `useMissionControl`), so nothing I found goes stale. The risk is the timing change in finding 1, not stale data.
2. Adaptive flush: queue order is preserved (one array, applied in order), no loss or duplicates seen; dedup in `events.ts` runs before the queue so SSE resume and dedup are untouched. Timer cleanup: `clearMissionControl()` -> `dropQueued()` clears the timer on sign-out. A stuck 400 ms interval is not possible (falls to 60 ms after a small batch or 1 s quiet), but see finding 3.
3. `lastEventAt`: leading write plus one trailing write per 250 ms, so the last event time is not dropped (trailing writes `Date.now()`, later than the event, never earlier). `data.ts` writers use `Date.now()` too, so the value cannot move backwards (observed 0 backwards). Timer not cleared on sign-out (finding 2). Freshness stays within 250 ms.
6. Judgement: the NOT MET is honestly reported, and the report's explanation of the rest (thread layout, dev-mode React) fits my profiles. The `lastEventAt` hunk gave no gain: the brief says keep a step only if it helps, so it should go (or be kept only with an explicit owner decision); it cuts store writes 4x (99 to 25) but is the one hunk with a leaked timer. Cost of dropping it: none measured.

## Required fixes
1. Make the api-c26 I2 older-page check pass again on the tip (22/22 at low load, repeated at least twice). Start with `Missions.tsx`: either revert both call sites to `useMissionControl` (loses most of the floor gain, the report says step 2 was the big one) or find what the missing page re-render used to trigger and do that explicitly in ChatView.
2. Clear `stampTimer` in the `startSync` cleanup, or remove the hunk.
3. Update the report: 21/22 or 22/22 as measured, and the like-for-like base numbers above.

---

# Re-review of the fix round (tip `0abda0c`, code final at `bf367d6`)

Same rules as round 1 (heavy.sh, ports 9390/9392/9393, DB `axion_e2e16`). The lane ends at `0abda0c`, clean; `web/src` is identical to the tip. Servers stopped by port.

## Verdict: CLEARED-AS-PARTIAL
The round-1 regression is fixed and the fix holds, including at high load. The thresholds are only met at low load (see 5), and two weak spots remain (below). Nothing blocks merging.

## 1. The I2 fix (`ChatView.tsx`, `restored` ref, `RESTORE_HOLD_MS = 1000`)
Results (api-c26, REPS=1 FILL=1000, all checks on):

| Run | Load (start) | Checks | I2 older-page shifts (px) |
|---|---|---|---|
| tip 1 | 6.7 | 22/22 | 0.2 0.5 0.0 0.5 |
| tip 2 | 8.2 | 22/22 | 0.1 0.4 0.3 0.3 |
| tip 3 | 6.5 | 22/22 | 0.3 0.3 0.0 0.1 |
| loaded 1 (8 busy-loop node processes beside it, load 5.8 at start, climbing) | 5.8 (rising to about 17) | 22/22 | 0.0 0.3 0.0 0.5 |
| loaded 2 | 17.1 | 22/22 | 0.1 0.2 0.5 0.4 |

Round 1 on the same tip without the fix: 150-436 px on 3 of 3. So the fix is not a timing coincidence at either load; it held at load 17. (api-c26 has no CPU-throttle switch, hence the busy-loop processes; with 32 cores that is a moderate stress, not a 4x slowdown.)

- **Mechanism:** plausible and consistent with my bisect (only the commit timing changed with `useMissionNodes`; the base had the race latent). I read the code and did not re-instrument. The restore sets the anchor row at `ChatView.tsx:450`, and `hold()` (lines 282-299) now corrects against that row instead of the freshly recorded one.
- **1 s window:** the weak spot. Rows measured after 1 s (heavy load, slow image decode) fall back to the old behaviour, i.e. the original race. Passing at load 17 shows the window is enough for the test's images, but there is no condition-based end (for example "until the rows above are all measured"). Low severity, plausible only.
- **Pinned reader:** no conflict. The correction runs only when `!atBottomRef.current`, and the pin effect at line 457 resets `own.current`, which also cancels a pending hold. New messages append below the anchor, so they do not move it.
- **User-scroll detection:** the hold is dropped when `el.scrollTop !== own.current`, i.e. by position, not by input type, so wheel, keys, touch, scrollbar drag and any programmatic scroll all cancel it (the over-cancelling side is safe). It is the same test the existing `onScroll` uses (line 541, `moving`). Gap: the cancel is only evaluated when `hold()` next runs, but the first `hold()` after a user scroll cancels before correcting, so a scroll is never fought. Not exercised by a test; checked by reading.

## 2. api-c22 N=1000 reload hang
`SIZES=130,1000 REPS=3` twice on the tip: **14/14 and 14/14**, all six N=1000 reps interactive in 1.16-1.51 s, at load 14-16 and 12-13 (higher than the 9-15 where the implementer saw the hang). Not reproduced, so I cannot attribute it. Nothing in the c44 diff touches the reload path (flush only affects live events, the anchor fix only older-page loads, `useMissionNodes` is the page shell). I did not run the base: with zero hangs in 2 runs there was nothing to compare. Judgement: most likely load or an existing flake; keep it flagged, not blocking.

## 3. api-c44 RED/GREEN
- Round-1 `missionControl.ts` (from `69bca39`) restored temporarily: **FAIL**, lone message after a burst 261 173 197 174 179 ms vs quiet 136 100 110 94 124 (load 12). Restored exactly (`git checkout 0abda0c -- ...`).
- Tip, same load: **PASS**, 121 118 121 130 112 ms, no loss, no page errors.
- Weakness: the RED margin is thin. Four of five round-1 probes were under the 200 ms bar, only one failed. Under heavy load a correct implementation could also exceed 200 ms (quiet control reaches 136 ms). A tighter bar (for example compare against the quiet control + 60 ms) would discriminate better. Low severity; the check works as a regression guard today.

## 4. `events.ts`
`git diff --quiet c068a6d HEAD -- web/src/api/events.ts` is clean: **byte-identical** to the base. The leaked `stampTimer` is gone with the hunk.

## 5. Thresholds: what to record
- **Floor:** PASS. Report both numbers: -65 % in my interleaved round-1 runs at load 11-16, and -72/-80 % in the implementer's low-load runs.
- **Full burst total (<= 887 ms):** record as **PASS at load below 8** (implementer 801 / 846 ms), **NOT MET at load 11-16** (my round-1 tip: 1,319 / 849 on the unfixed tip, mean 1,084 against a like-for-like base of 1,684). State the load next to the number; do not call it unconditional. I did not repeat the full-burst timings in this re-review (the single REPS=1 c26 runs gave 1,181 ms at load 7 and 1,289 ms at load 17, whole trace including the profiler start-up task, so they are not comparable with the REPS=3 means).
- **Worst merged period (<= 250 ms):** record as **NOT MET, strictly**. A rep of 339 ms exists in 6 low-load reps (5 of 6 under 250; per-pass means 191 and 228), and my round-1 runs at load 11-16 had 527/650/295. Say "met in 5 of 6 low-load reps", not "met".
- The base figures differ by load as well (implementer 1,528 / 847 at load 9-11; mine 1,684 / 960 at 11-16); both agree on direction.

## Findings
- Low (plausible): 1 s fixed hold may expire before late row measurements under heavy load (`ChatView.tsx:RESTORE_HOLD_MS`, hold at line 288).
- Low (confirmed): `api-c44.mjs` RED margin is thin (1 probe of 5 failed on the old logic); consider a relative bar.
- Info: api-c22 N=1000 hang not reproduced in 12 reps over 2 runs at load 12-16.
- Info: report's "I did not run it RED" is now closed by this re-review.
