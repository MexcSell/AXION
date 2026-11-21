# Cycle 22 report: long conversation threads load fast (lane w20)

Branch `c22-long-thread-perf`, worktree `/home/luca/AXION-w20`, base f169636. Status: **DONE.**
- The timing threshold is met.
- `api-stage6` passed 94/94 in 2 of 3 runs; the red run failed two agent-version checks, not in thread code.
- `verify-all` on the final HEAD has no FAIL lines.
- The demo flow that failed once fails on the base as well.

## What the browser was doing
Before the fix, a reload issued right after a 130-message burst did not commit for about 55 s. The servers were not the
cause; the old page's main thread was busy the whole time. The CPU profile (traced run, N=130, load ~32) showed:

- **One busy period of 54.3 s**, starting 0.6 s after the burst began. It was almost all `FunctionCall` → `RunMicrotasks`:
  React re-rendering after each store write.
- **The cause is in `api/missionControl.ts`.** `onMissionControlEvent` wrote to the store once per
  `conversation.messageCreated` and once per `conversation.receipt`. Each write re-rendered the whole open thread (every
  bubble, every minimap block, the minimap re-measure, and the ResizeObserver rebuilt over every row). So each event cost
  O(rows), and the burst cost O(n²).
- **Self time by package:** react 14.7 s · native 12.7 s · react-dom 12.6 s · app 8.9 s · motion 3.7 s.
- **Top app functions:** `clock` 4.2 s and `dateLabel` 3.6 s. `toLocaleTimeString` and `toLocaleDateString` build a new
  Intl formatter on every call, for every row, on every render. Next came `ChatBubble` (3.9 s inclusive) and the minimap
  measure and observer effect (3.2 s each).
- **The thread rows probably had a second cost (inferred from the motion 14.14 source, not measured alone).** With its
  default `presenceAffectsLayout`, `AnimatePresence` (`PresenceChild`) gives every row a new presence context on each
  render. So an unchanged `layout` bubble would re-render and re-measure anyway, which would explain the
  `get scrollLeft`/`scrollTop` time. Turning it off is part of ff3c5d5. Motion and scroll-read time did not clearly fall
  in the N=1,000 traces.

The reload itself was cheap: the idle reload took about 2 s both before and after. The stall was the old page working
through its backlog.

## The fix (app side; `api-stage6.mjs` untouched)
| Commit | Change |
|---|---|
| 3ebc333 | **Batch the live conversation events.** `messageCreated` and `receipt` events are queued and applied in arrival order, with the same reducer logic as before, in one store write at most every 60 ms (`setTimeout`, not rAF, so a hidden tab still updates). **Other writers:** every other writer of this store goes through `patchEntry`, and `patchEntry` flushes the queue first. Those writers are `openThread`, `loadOlder`, `rereadThread`, `settle`, `sendMissionMessage`, `fetchPart`, `retryPart` and `taskAction`, so ordering is unchanged. `forget(mid)` and `clearMissionControl()` drop what is queued for what they remove. **`upsert`:** a fast path for "one new message after the newest". |
| ff3c5d5 | **`format.ts`:** one cached `Intl.DateTimeFormat` each for `clock` and `dateLabel`. The output is identical; checked in en-US, de-DE, ja-JP and the default locale. **Memoisation:** `ChatBubble` is `memo` (the store keeps unchanged messages as the same objects), and so are the minimap blocks. **Thread rows:** `AnimatePresence presenceAffectsLayout={false}`. |
| 15ef55c | **`useAuthor`** subscribes to the agent catalog version. The catalog is updated in place in api mode, so a memoised bubble would otherwise keep an old agent name or avatar after `agent.updated`. |
| 5d5c8ce | **Minimap:** one ResizeObserver for the component's life. New rows are added to it, and its callbacks share one measure per frame. Before, it was disconnected and rebuilt over every row on each new message. |

I did not virtualise the list. `api-stage6.mjs` asserts one DOM row and one minimap block per loaded message, and the
fixes above met the threshold without it.

## Measure (`web/scripts/api-c22.mjs`, api mode, lane stack 7092/7093, `axion_e2e20`)
**Method:**
1. Open a real mission's human↔GM thread.
2. POST N commands to it, 10 at a time, while the page shows the thread (the api-stage6 pattern).
3. `page.reload()` and time it to **interactive**: the composer takes focus and the newest message is inside the thread
   viewport.
4. Reload again once the page is idle.

Each size gets 3 timed reps plus 1 traced rep, which is not counted. The trace summary lists main-thread busy periods
(top-level slices merged when the gap is under 1 ms; ≥ 50 ms counts as long) and the CPU profile by self time. A rep that
passes the cap closes and replaces the page.

**Run it:**

    cd web && E2E_API_PORT=7092 E2E_WEB_PORT=7093 /home/luca/AXION-lanes/heavy.sh ./scripts/api-e2e.sh \
      "SIZES=130,1000 REPS=3 TRACE=1 CAP_MS=120000 TRACE_DIR=/tmp/axion-c22/after node scripts/api-c22.mjs"

The summariser also runs alone: `SUMMARISE=<trace.json> node scripts/api-c22.mjs`.

### Reload → interactive after the burst (threshold: 130 ≤ 3 s, 1,000 ≤ 5 s)
| | Load (1-min avg) | N=130, reps 1–3 | N=1,000, reps 1–3 |
|---|---|---|---|
| Before (f169636), predecessor run | 18–22 | 48.3 s · 45.8 s · 37.5 s | > 180 s (cap) |
| Before (f169636), this run | 25–35 | **60.3 s · 59.1 s · 57.1 s** (commit 57.4 / 56.6 / 54.8 s) | **> 120 s · > 120 s · > 120 s** (cap; the reload never committed) |
| After step a only (batching) | 24–27 | 2.1 s (1 rep) | 4.6 s (1 rep) |
| **After (5d5c8ce), traced set** | **22–26** | **1.9 s · 2.2 s · 2.3 s** (commit 60 / 167 / 261 ms) | **2.4 s · 2.6 s · 2.8 s** (commit 394 / 126 / 371 ms) |
| **Final HEAD (15ef55c)** | 14–15 | 1.6 s · 1.8 s · 1.8 s | 1.8 s · 1.8 s · 2.4 s |

The idle reload (no backlog) takes 1.8–2.4 s both before and after. That is the dev-mode cold load of the app plus its
data, and it is most of what remains.

### Main-thread long tasks (traced reps; ms from burst start)
**Before, N=130** (load ~32): 5 long tasks.
- `0.6 s +54,295 ms` · `54.9 s +220` · `55.1 s +83` · `55.2 s +510` · `55.7 s +1,482`
- Reload issued at 1.0 s, commit at 54.9 s, interactive at 57.1 s.
- Sampled JS 57.1 s.

**After, N=130** (load ~23): 4 long tasks, 2.7 s in total.
- `0.5 s +687` · `1.2 s +137` · `1.4 s +383` · `1.8 s +1,541`
- Reload at 0.9 s, commit at 1.1 s, interactive at 3.2 s (traced, so slower).
- Sampled JS 3.2 s.
- Self time: native 1.3 s · react-dom 0.9 s · react 0.7 s · motion 0.13 s · app 0.06 s.

**Before, N=1,000:** not traced. The page was still busy after the 120 s cap, and the trace would have been too large to
parse.

**After, N=1,000** (load ~24): 14 long tasks during the 8.2 s burst, each one batch render, from 0.4 s up to 1.6 s.
- The last task is `9.4 s +2,164`, the new page's first render.
- Reload at 8.2 s, commit at 9.2 s, interactive at 11.6 s (traced).
- Self time: native 5.5 s · react 2.4 s · react-dom 1.8 s · motion 0.8 s · app 0.3 s.

## Pass threshold
| # | Item | Result |
|---|---|---|
| 2a | Reload → interactive, 130 messages, ≤ 3 s at the current load | **PASS**: 1.9 / 2.2 / 2.3 s at load 22–24 (before: 57–60 s at load 25–35) |
| 2a | Reload → interactive, 1,000 messages, ≤ 5 s | **PASS**: 2.4 / 2.6 / 2.8 s at load 24–26 (before: > 120 s × 3) |
| 2b | `api-stage6.mjs` 94/94, including the reload step, timeout unchanged | **PASS, with one red run.** 94/94 on 5d5c8ce (load ~20). On 15ef55c: run 2 was 92/94, run 3 94/94. The base was 34/35, failing at the reload. |
| 2c | Long tasks listed before and after | **PASS**: see above |
| 3 | Paging, gap fill, unread counts | **PASS**: `api-stage6.mjs` 94/94 (paging, no jump, no duplicates, minimap one block per message, the > 50-message outage with no hole, I4 unread) and `api-improve.mjs` 83/83 |
| 3 | Minimap, scroll position, drafts | **PASS**: `api-c22.mjs` behaviour checks 8/8 (both sizes): pinned to the bottom after the reload, minimap 50 blocks / 50 rows, the draft survives a reload, an older page loads with the top message moving 0.4 px and no duplicates |
| 3 | Demo mode unchanged (`verify-all`, FAIL lines grepped) | **PASS**: the final run has 0 FAIL lines. The single Hierarchy FAIL in an earlier run also fails on the base (below). |

### Demo suite (`verify-all`, OUT=/tmp/axion-verify-w20, dev server 7090)
| Run | Tree | Result |
|---|---|---|
| 1 | 5d5c8ce | Cut off by my own 30-minute `timeout` (rc 124) during "u1 flows". Before that: build, crawl (77 views, NO PROBLEMS), deep crawl (NO PROBLEMS), flows, auth flow. One FAIL line, quoted below. |
| 2 | — | Stopped: I edited `src` while it ran. |
| **3** | **15ef55c (final)** | **Complete, rc 0, no FAIL lines:** crawl 77 views and deep crawl NO PROBLEMS; flows, auth flow and u1 flows all PASS with no console errors; dialog smoke 110 checks, 0 failures; dialog ids, help keys and the fs guard OK. |

The FAIL line in run 1:

    FAIL  Hierarchy: click agent → conversation pane beside the graph shows its counterparts: hierarchy conversation pane did not switch

**`flows.mjs` alone, demo mode, to settle that FAIL.** The step clicks and then waits a fixed 500 ms.

| Tree | Hierarchy step | Other FAILs |
|---|---|---|
| HEAD | Failed 2 of 4 runs, counting verify-all run 1 (failed at load 24 and 21.6, passed at 16.9 and 15.7). It then passed in verify-all run 3. | none |
| **Base f169636** (scratch copy, dev server on 7091) | **Failed 1 of 3 runs** (load ~17.7) | "Conversations: mission agents pane on the left switches the thread: thread did not switch to Planner-01" in 1 of 3 runs, also a fixed 500 ms wait |

Both steps fail intermittently on the base. This is a load-sensitive check that already existed, not a regression from
this cycle.

**`api-stage6` run 2 (15ef55c, load ~17): 92/94.** The two FAILs:

    FAIL the server created the next version
    FAIL Versions lists v(n+1) as active and v(n) as earlier — v2.4.0 → v2.4.0

This is the agent Edit dialog → server version step. It touches no thread or event code. It did not reproduce in run 3
(94/94, immediately after). I did not check it on the base.

## Files changed
- `web/src/api/missionControl.ts`: event batching and flush-before-write, `upsert` fast path.
- `web/src/lib/format.ts`: cached formatters.
- `web/src/features/chat/ChatView.tsx`: `ChatBubble` memo, `presenceAffectsLayout={false}` on thread rows.
- `web/src/features/mission/ThreadMinimap.tsx`: memoised blocks, one ResizeObserver.
- `web/scripts/api-c22.mjs` (new): timer, trace summariser and behaviour checks.

No UI change, so there are no screenshots.

## Concerns
- **The 130 margin is about 0.7 s, and it is mostly the cold load.** At load 22–24 the after-burst reload takes about
  2.2 s, and the idle reload alone is about 2 s. A higher load during integration (35+) could approach 3 s. The rest is
  Vite dev-mode module loading and the request chain (`/me` → missions → threads → page), not the thread.
- **A live 1,000-message thread is still effectively frozen while a burst arrives.** It is fine after a reload. Each
  60 ms batch re-renders over 1,000 rows (memo checks, plus `layout` projection and scroll reads) and costs 0.4–1.6 s. So
  the next timer fires at once, and the N=1,000 trace shows 11.5 s of long tasks in 11.6 s, with gaps of only 1–12 ms.
  - The backlog now clears within about 1 s of the burst ending, where before it took minutes; that is why the reload
    passes.
  - A user watching a thread receive hundreds of messages at once would still see a frozen page until the burst ends.
  - Next steps would be a flush interval that adapts to render cost, or virtualising / keeping only a window of rows
    mounted. `api-stage6` counts one DOM row and one minimap block per loaded message, so that needs a coordinated change
    with lane w6.
- **Layout animation of neighbouring rows is reduced.**
  - **Sibling removed** (`presenceAffectsLayout={false}`): rows no longer re-render when a sibling is removed. Removals
    happen when the local pending message is replaced by the server copy (at the end), and in the Compact view filter.
    The Compact toggle changes `compact` on every remaining bubble, so they still re-render and animate.
  - **Height change** (memo): when one bubble changes height, for example its status line, the rows below it no longer
    re-render, so they move without a layout animation. This is usually the last row.
  - **Covered by checks:** the demo flows "Conversation: send command with image → ack → report upward" and the Compact
    toggle paths pass. Nothing measures animation smoothness.
- **Live updates now lag by up to 60 ms.** Every other writer of the store flushes first, so ordering and the
  "early/mine" merging are unchanged. `api-stage6` covers this path: live receipts, the held event copy of my own post,
  and the reconnect gap.
- `TopBar` and `Rail` show 0.5–0.6 s inclusive in single traces of the cold load (dev-mode hooks). I did not investigate
  them.

## Fix round (review c22-review.md)
| Item | Change | Evidence |
|---|---|---|
| **I1** minimap stops watching a row replaced at the same length | `ThreadMinimap.tsx`: the effect that observes new rows now re-runs on every `msgs` change, not only when the count, view or typing state changes. There is still one ResizeObserver; rows already observed are skipped (a `Set`), and rows no longer in the DOM are unobserved, so nothing is retained. Commit 5c2a32e. | New `api-c22` check: send a message, so the local copy is replaced by the server copy at the same length; then grow that row and assert its minimap block grows and every block lines up with its row. **RED** on 15ef55c (checks from cc55d91): block 3.1 → 3.1 px, script rc 1. **GREEN** on 5c2a32e. |
| **M1** the "N new" pill over-counts | `ChatView.tsx`: counts only rows after the last one seen, so an older page landing in the same render no longer adds 50. Commit 5c2a32e. | One line. No check forces the race. |
| **M3** no test of batching order | `api-c22` `batching()` runs on the app's own store in the page: it imports `/src/api/missionControl.ts`, the module the app loaded, which the first check confirms. Commit cc55d91. | 4 checks, all PASS on both the RED and GREEN runs. (1) Nothing is applied before the flush. (2) A receipt before its message is a no-op; a receipt after it applies; receipts never go back; order, count and last are kept. (3) A gap reset (reconnect re-read with more than a page missing, served by a routed page) with a batch still queued applies the queued event first, then restarts from the fresh page: 50 rows, seq 111…160, hasMore, nextBefore 111, count 5. Nothing stale lands afterwards. |
| **M4** the script's exit code | `api-c22` exits 1 on any FAIL check, page error, or threshold miss (`MAX_MS`, default `130:3000,1000:5000`; prints `THRESHOLD MISS`). | The RED run exited rc 1; the GREEN run exited rc 0. |
| **M2** lost layout animation of neighbouring rows | Deferred. It is disclosed above under Concerns and should be recorded in LESSONS/LOG by the integrator; I do not write to the integration tree. | — |
| Residual live freeze at 1,000 | Deferred to the queue: adaptive flush or windowing, coordinated with lane w6. | — |

The checks for I1, M3 and M4 are in cc55d91.

### Runs after the fix (5c2a32e, all through heavy.sh)
- **`api-c22`** (SIZES=130,1000, REPS=3): rc 0, behaviour checks 14/14, page errors 0.
  - Reload → interactive after the burst: N=130 2.0 / 1.7 / 1.8 s (load 15–16); N=1,000 2.7 / 2.8 / 3.3 s (load 16–19).
  - Thresholds are 3 s and 5 s.
- **`api-stage6`**: run 1 was 4/5. It failed at the very start (`locator.waitFor` 15 s on the second user's Connect page, before any thread code), while my verify-all was starting its build and crawl next to it. Re-run once: **94/94**. The designer-01 Edit flake did not appear.
- **`api-improve`**: 83/83.
- **`verify-all`** (OUT=/tmp/axion-verify-w20): rc 0, **0 FAIL lines**. Build, crawl (77 views) and deep crawl NO PROBLEMS; flows, auth flow and u1 flows all PASS with no console errors; dialog smoke 110 checks, 0 failures; dialog ids, help keys and the fs guard OK.
