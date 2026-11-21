# Cycle 22 report: long conversation threads load fast (lane w20)

Branch `c22-long-thread-perf`, worktree `/home/luca/AXION-w20`, base f169636. Status: **DONE: threshold met.** The demo
suite has one FAIL line; see "No behaviour change" below.

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
- **The Missions page had a second cost.** `AnimatePresence`, with its default `presenceAffectsLayout`, gives every row a
  new presence context on each render. So even an unchanged `layout` bubble re-rendered and re-measured, which shows up as
  `get scrollLeft`/`scrollTop`.

The reload itself was cheap: the idle reload took about 2 s both before and after. The stall was the old page working
through its backlog.

## The fix (app side; `api-stage6.mjs` untouched)
| Commit | Change |
|---|---|
| 3ebc333 | **Batch the live conversation events.** `messageCreated` and `receipt` events are queued and applied in arrival order, with the same reducer logic as before, in one store write at most every 60 ms (`setTimeout`, not rAF, so a hidden tab still updates). **Other writers:** every other writer of this store goes through `patchEntry`, and `patchEntry` flushes the queue first. Those writers are `openThread`, `loadOlder`, `rereadThread`, `settle`, `sendMissionMessage`, `fetchPart`, `retryPart` and `taskAction`, so ordering is unchanged. `forget(mid)` and `clearMissionControl()` drop what is queued for what they remove. **`upsert`:** a fast path for "one new message after the newest". |
| ff3c5d5 | **`format.ts`:** one cached `Intl.DateTimeFormat` each for `clock` and `dateLabel`. The output is identical; checked in en-US, de-DE, ja-JP and the default locale. **Memoisation:** `ChatBubble` is `memo` (the store keeps unchanged messages as the same objects), and so are the minimap blocks. **Thread rows:** `AnimatePresence presenceAffectsLayout={false}`. |
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
| **After (5d5c8ce)** | **22–26** | **1.9 s · 2.2 s · 2.3 s** (commit 60 / 167 / 261 ms) | **2.4 s · 2.6 s · 2.8 s** (commit 394 / 126 / 371 ms) |

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
| 2b | `api-stage6.mjs` 94/94, including the reload step, timeout unchanged | **PASS**: 94/94 at load ~20 (it was 34/35 on this base, failing at the reload) |
| 2c | Long tasks listed before and after | **PASS**: see above |
| 3 | Paging, gap fill, unread counts | **PASS**: `api-stage6.mjs` 94/94 (paging, no jump, no duplicates, minimap one block per message, the > 50-message outage with no hole, I4 unread) and `api-improve.mjs` 83/83 |
| 3 | Minimap, scroll position, drafts | **PASS**: `api-c22.mjs` behaviour checks 8/8 (both sizes): pinned to the bottom after the reload, minimap 50 blocks / 50 rows, the draft survives a reload, an older page loads with the top message moving 0.4 px and no duplicates |
| 3 | Demo mode unchanged (`verify-all`, FAIL lines grepped) | See below |

### Demo suite (`verify-all`, OUT=/tmp/axion-verify-w20, dev server 7090)
**Run 1 was cut off by my own 30-minute `timeout` wrapper** (rc 124) during "u1 flows", after typecheck+build, the
route×tab crawl (77 views, NO PROBLEMS), the deep crawl (NO PROBLEMS), flows and the auth flow (all PASS). It had one FAIL
line:

    FAIL  Hierarchy: click agent → conversation pane beside the graph shows its counterparts: hierarchy conversation pane did not switch

That step clicks a hierarchy node and checks the pane after a fixed 500 ms wait, at load ~24. Run 2 is below.

RUN2_PLACEHOLDER

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
- **A live 1,000-message thread is still heavy while a burst arrives.** It is fine after a reload. Each 60 ms batch
  re-renders over 1,000 rows (cheap memo checks, plus `layout` projection reads), so the page is busy in 0.4–1.6 s chunks
  during the 8 s burst. It stays responsive between batches. Virtualising, or keeping only a window of rows mounted, would
  fix this, but `api-stage6` counts one DOM row and one minimap block per loaded message. That would need a coordinated
  change with lane w6.
- **Rows no longer re-render when a sibling is removed** (`presenceAffectsLayout={false}`). The only removal in a thread
  is a local pending message being replaced by the server copy, which always sits at the end. So no visible layout
  animation is lost in practice.
- **Live updates now lag by up to 60 ms.** Every other writer of the store flushes first, so ordering and the
  "early/mine" merging are unchanged. `api-stage6` covers this path: live receipts, the held event copy of my own post,
  and the reconnect gap.
- `TopBar` and `Rail` show 0.5–0.6 s inclusive in single traces of the cold load (dev-mode hooks). I did not investigate
  them.
