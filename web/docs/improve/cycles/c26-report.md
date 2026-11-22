# Cycle 26 report: virtualised conversation threads (lane w24)

Branch `c26-thread-virtualise`, worktree `/home/luca/AXION-w24`, base a67d2dd. App code final at 82eef4a.

**Status: NOT MET on the timing threshold** (long-task total and worst task). The pass line was fixed in the brief and is
not moved here. Every behaviour check and verify-all are green.
- **What improved:** virtualisation works. A live burst into a 1,000-message open thread now costs the same as one into a
  50-message thread, and less than half of what it cost before.
- **Why it still misses:** the remaining busy time is page-level work that does not depend on the thread. A control run with
  the burst's thread *not on screen* (same page, same store traffic) already costs 815–1,178 ms with a worst task of
  163–343 ms, which is above or at the thresholds by itself.
- **Behaviour:** every behaviour check is green. api-stage6 94/94, api-c22 14/14 (reload 1.5–2.1 s), api-improve 107/107,
  a11y-check 0 violations in demo and api mode.
- **verify-all:** all 10 steps pass on the final app code (82eef4a). An earlier run at load 20–39 had two red steps; §7 has
  the comparison with the base.

## 1. Measure (`web/scripts/api-c26.mjs`, new)
The method is cycle 22's, applied to the brief's scenario:
1. Open a real mission's human↔GM thread (api mode, lane stack 7492/7493, `axion_e2e24`, viewport 1600×940).
2. Fill it live with 1,000 messages and wait until the page is quiet (no long task for 1.5 s). The reader is pinned to the
   bottom.
3. Start a Chromium trace (same categories as api-c22), POST a burst of 200 messages, 10 at a time, and stop the trace once
   the store holds all 200 and the page is quiet for 1 s.
4. Summarise the trace with c22's own summariser (`SUMMARISE=<trace> node scripts/api-c22.mjs`): renderer-main top-level
   slices are merged into busy periods (gaps under 1 ms join), and a period of ≥ 50 ms is a long task.
5. A `PerformanceObserver('longtask')` count is printed beside it, as context only.

Run: `cd web && E2E_API_PORT=7492 E2E_WEB_PORT=7493 heavy.sh ./scripts/api-e2e.sh "REPS=3 FILL=1000 node scripts/api-c26.mjs"`.
Diagnosis options:
- `FLOOR=1`: show another partner's thread during the burst;
- `FILL=50`;
- `MINIMAP=0`;
- `COMMITS=1`: React commits per component through the DevTools hook;
- `KEEP_TRACES=1`;
- `SHOT=<png>`.

**Headline numbers: whole trace, the same script on both sides.** Starting the V8 profiler costs the page one ~150–230 ms
task (`V8.InvokeApiInterruptCallbacks`) at its next JavaScript.
- **Burst window (secondary):** the second version of the script runs some JavaScript, waits for quiet, marks the burst start
  in the trace (`console.timeStamp`) and also prints a "burst window" count from that mark. I added the window **after**
  seeing results, and in one rep per size the start-up task still landed after the mark. The window numbers are therefore
  secondary.
- **The verdict below uses the whole trace.**

## 2. Results
### Long tasks during the burst (c22 method, whole trace, 3 reps each)
| Run | Load (1-min) | Long-task total per rep | Mean | Worst task per rep |
|---|---|---|---|---|
| **Before** a67d2dd, FILL 1,000, first run (script 505a248) | 8.0–8.7 | 3,342 · 3,168 · 3,219 ms | **3,243** | 3,342 · 2,371 · 1,709 ms |
| **Before** a67d2dd, FILL 1,000, second run (final script) | 8.1–9.2 | 3,064 · 2,900 · 2,909 ms | **2,958** | 2,376 · 2,662 · 2,328 ms |
| **After** 82eef4a, FILL 1,000 | 7.6–7.9 | 1,368 · 1,383 · 1,405 ms | **1,385** | 464 · 518 · 478 ms |
| Before a67d2dd, FILL 50 | 11.6–12.2 | 1,575 · 1,822 · 1,553 ms | 1,650 | 1,130 · 1,323 · 1,183 ms |
| After 82eef4a, FILL 50 | 12.2–12.6 | 1,496 · 1,302 · 1,741 ms | 1,513 | 428 · 820 · 567 ms |
| **Floor**: after, FILL 1,000, the burst's thread **not on screen** (`FLOOR=1`) | 12.8–14.2 | 1,027 · 1,178 · 815 ms | 1,007 | 265 · 343 · 163 ms |

The burst-window variant gives the same picture:
- before: 2,802 mean, worst 2,328–2,662 ms;
- after: 1,280 mean, worst 464–518 ms;
- floor: 838 mean, worst 163–343 ms.

### PerformanceObserver (individual browser tasks ≥ 50 ms, context only)
| Run | Total | Worst task |
|---|---|---|
| Before (FILL 1,000) | 1,442–1,598 ms | 467–628 ms |
| After (FILL 1,000) | 700–887 ms | 170–197 ms |

### What the numbers say
- **The cost no longer grows with thread length.** Before, 50 → 1,000 messages took the burst from 1,650 to about 3,000 ms.
  After, it is 1,513 → 1,385 ms (within noise). The DOM holds 15–26 rows for 1,202 messages, against 1,202 rows before.
- **Long-task total: 2,958 → 1,385 ms, about 47 % of before** (43 % against the first before-run). The threshold is ≤ 30 %
  (≤ 887 ms, or ≤ 973 ms against the first run). **NOT MET.** The floor alone averages 1,007 ms.
- **Worst merged task: 2,328–3,342 → 464–518 ms. NOT MET** (≤ 200 ms). No *individual* browser task now exceeds 200 ms (the
  PerformanceObserver worst is 170–197 ms). But SSE event tasks arrive back to back (median gap 4 µs), so c22's under-1 ms
  merge rule chains them into periods of about 0.5 s. The floor's worst is 163–343 ms.
- **Where the rest goes:** I attributed every CPU sample to the nearest component (scratch analysers). After the thread
  changes, the remaining cost is React development-mode overhead per rendered component (`runWithFiberInDEV`,
  `logComponentRender`), Radix tooltips and lucide icons in the page around the thread, motion's layout projection (the
  forced layout per commit), and the Missions page re-rendering on mission-control store writes. Getting under the line
  needs page- or store-level changes, listed under Concerns. I did not make them in this cycle.

### Reload → interactive (cycle 22's thresholds, api-c22, final HEAD, load 14–15)
- **N=130:** 1,474 · 1,552 · 1,767 ms (≤ 3 s). **PASS.**
- **N=1,000:** 1,680 · 2,073 · 1,898 ms (≤ 5 s). **PASS.**

## 3. Pass threshold
| # | Item | Result |
|---|---|---|
| 1 | Before measured, c22 method, total and worst, 3 runs | **PASS.** Two before-runs of 3 reps each (table above) |
| 2 | Long-task total ≤ 30 % of before | **NOT MET.** 1,385 / 2,958 = 47 % (43 % against the first run). The floor alone is 34 % |
| 2 | Worst single task ≤ 200 ms | **NOT MET.** The worst merged period is 464–518 ms; no individual task is over 197 ms; the floor is 163–343 ms |
| 2 | Reload → interactive within 3 s / 5 s | **PASS.** 1.5–1.8 s and 1.7–2.1 s |
| 3 | api-c22 green | **PASS.** 14/14 behaviour checks, rc 0 (checks updated, see §6) |
| 3 | api-stage6 94/94 | **PASS.** 94/94 on 82eef4a (checks updated, see §6) |
| 3 | api-improve green | **PASS.** 107/107 |
| 3 | api-c09 green | **NOT RUN.** `api-c09.mjs` is absent at a67d2dd: it exists only on the unmerged branch `c09-server-minors` |
| 3 | a11y-check 0 violations | **PASS.** Demo: 50 views, 55 dialogs, 0. Api: 40 views, 55 dialogs, 0 |
| 3 | verify-all passes every step | **PASS.** 10/10 on 82eef4a (load about 10–19). An earlier run at load 20–39 was 8/10; §7 |
| 3 | The minimap still counts every message | **PASS.** One block per message, in order (`data-mm` = message id), 1,202/1,202 |
| 4 | DOM-row check asserts the intent; it fails on a forced defect | **PASS.** See §6, both defects RED |

## 4. What changed
| File | Change |
|---|---|
| `web/src/features/chat/threadWindow.ts` (new) | The geometry model. Each message's height is measured once and cached by id (with or without a day separator; full or compact), or estimated until then. The estimate is the mean of the first 30 measured rows, then fixed, so the spacers do not churn. The file also holds the row offsets, a binary-search window (`rangeFor`), the minimap rows (`mapRows`) and per-message label caches (`dayOf`, `clockOf`). |
| `web/src/features/chat/ChatView.tsx` | **Rendering:** `ChatThreadView` renders only the rows within 900 px above and below the viewport, with spacers for the rest. The window follows the scroll position in 300 px steps. While the reader is pinned, the newest rows render at once. **Measuring:** one ResizeObserver per thread; a re-render for new measurements waits at most 100–400 ms. **Scroll position:** estimates corrected above the viewport are left to the browser's scroll anchoring (`overflow-anchor` stays `auto`). **Older pages:** an older page that lands keeps the window on the same rows, so the existing anchor restore finds its row. A jump to the top renders the top rows (`flushSync`) before the anchor is taken. Switching Full/Compact re-reads the scroll position. A pinned reader is re-pinned when measurements land. **Rows:** each row is a `ThreadRow`: an article with `aria-posinset` / `aria-setsize` and a roving `tabindex`. The entrance animation plays only for messages that join the thread, not for rows scrolled back in. **Smaller:** the head's controls are memoised. |
| `web/src/features/mission/ThreadMinimap.tsx` | **Positions:** blocks come from the model (every message, rendered or not), not from DOM rows. The content height comes from the model too; the scroll position is read only on scroll and resize. **Chunks:** blocks render in memoised chunks of 64, so a new message renders one chunk; each chunk has `contain: layout`. **Layer and scale:** blocks sit in one layer laid out at a base scale and stretched by `scaleY` (a re-layout every 12 % of growth, not on every message). **Blocks:** each is a plain `span` with a CSS entrance (the same fade and scale) instead of a motion component, and keeps opacity 1 inline, which is what motion left behind. **Smaller:** labels use an O(n) partition instead of a sort, and the current and visible blocks use binary search. The component is memoised. |
| `web/src/theme/pages/chat.css`, `mission-control.css` | `.thread-spacer`, `.thread-row` (focus ring); `.mm-blocks`, `.mm-chunk`, `@keyframes mm-in`. |
| `web/scripts/api-c26.mjs` (new) | The measure and 10 behaviour checks (§5). |
| `web/scripts/api-stage6.mjs`, `web/scripts/api-c22.mjs` | Assertions changed to the intent (§6). |

## 5. Accessibility: the choice
**The choice:** `role=log` with rows as articles that carry `aria-posinset` / `aria-setsize`.
- **Why not "load more":** with a "load more" approach, the DOM, and so the cost, grows again as soon as a reader expands
  it.
- **Why posinset/setsize:** they tell a screen reader where a row is in the *whole* thread, counting older messages not yet
  loaded. `aria-setsize` is the thread's length.

To make every message reachable, not only described:
- **Keyboard:** one row is in the Tab order (roving tabindex). On a row, ↑ ↓ PgUp PgDn Home End move to the previous, next,
  first or last message, scrolling it in and mounting it. ↑ on the first loaded row asks for the older page.
- **Focus:** the row holding focus (the row or a button in it) and the Tab-stop row are never unmounted. Focus on a bubble's
  button does not move the Tab stop. That keeps the a11y-check Tab walk sound.

**A departure from cycle 23 and from the brief's wording.** The log is now `aria-live="off"`. A polite log would read every
row mounted by scrolling as a new message. A sibling `role=status` line announces messages that really arrive at the end,
in order: "*N new messages. Latest, author: text*". It skips my own and pending messages.

**Not done:** I did not test with a real screen reader. Rows have no `aria-label`, so their content is their name.

## 6. Test changes (every changed assertion) and RED/GREEN
**`api-stage6.mjs`.** The thread is virtualised, so a DOM-row count no longer equals the loaded count.
- **New helpers:** `loaded()` reads the loaded messages in order from the minimap (`.mm-block[data-mm]`, one per message).
  `reach()` walks the thread from top to bottom and records each row rendered on the way, plus the first row's
  posinset/setsize.
- **Changed assertions:**
  - "opening the long thread loads the newest 50": `loaded().length === 50`, was the DOM row count.
  - Paging loop: before/grew counted with `loaded()`. The top message is taken after the jump has rendered (two frames),
    because virtualised rows render on the frame after the jump. The ≤ 4 px shift assertion is unchanged.
  - "scrolling up loads older pages" and "no duplicates": on `loaded()`.
  - **"the minimap still works on the long thread (one block per loaded message)" was replaced by** "every loaded message is
    reachable on the long thread". It requires all of:
    - the walk renders each loaded message, in order;
    - the first row is the first message with `aria-posinset` 1;
    - `aria-setsize` equals the server's count;
    - the minimap exists.
  - Gap section: "no hole" and "reaches the whole thread" are on `loaded()`. The latter also requires the walk to render all
    192.

**`api-c22.mjs` behaviour checks.**
- **Changed assertions:**
  - Loaded messages are read from the app's store.
  - The minimap check compares block ids with the store (count and order).
  - The paging check uses those counts and takes the top message after the jump has rendered.
  - I1: block geometry is read as drawn (`getBoundingClientRect` in the scaled layer), and blocks are matched to rendered
    rows **by id**, still within 1.5 px.
- **New `behaviour(n, mid, tid)` signature.**

**RED/GREEN**
| Evidence | RED | GREEN |
|---|---|---|
| api-c26 checks on the base (a67d2dd) | 4/10 at FILL 300. FAIL: window small (302 DOM rows), minimap ids (no `data-mm`), aria posinset/setsize, keyboard, focus row kept, Tab stop. PASS: pinned after reload, walk, view switch, scroll-back | 10/10 on 82eef4a (FILL 1,000 and 300) |
| **Forced defect A**: one row is never rendered (`ChatView` skips the middle index) | api-stage6 85/94. "every loaded message is reachable" FAIL: 131 rendered on the walk / 132 blocks; "after the reconnect" FAIL: 191 rendered / 192 | 94/94 without the defect |
| **Forced defect B**: one message is lost from the view's model | api-stage6 90/94. "scrolling up loads older pages" FAIL: 131/132; "every loaded message is reachable" FAIL: aria-setsize 131 ≠ 132; "after the reconnect" FAIL: 191/192 | 94/94 |
| Older page after a jump to the top (found by api-stage6 / api-c22 on 08ad30e) | "no jump" FAIL: worst shift 999 px (anchor row gone) | PASS after 7696380 (`flushSync` window before the anchor) |
| Pinned after a reload (found by api-stage6 / api-c22 on 7696380) | api-c26: 136 px off the bottom for 3 s | 0 px every 250 ms after 82eef4a |

Defects were applied in the working tree only and reverted with `git checkout`; they were never committed.

## 7. Runs on the final HEAD (82eef4a, all through heavy.sh)
- **api-e2e.sh:** `api-stage6.mjs` **94/94**; `api-c22.mjs SIZES=130,1000 REPS=3` **14/14**, rc 0; `api-improve.mjs`
  **107/107**; `DATA_MODE=api a11y-check.mjs` **0 violations**. Load 14–23.
- **a11y-check, demo** (dev 7490): **0 violations** (50 views, 55 dialogs).
- **api-c26** (FILL 1,000, REPS 3): 10/10 checks, page errors 0. The timing is in §2. Later, a check for the status-line
  announcer was added (script only, committed after the report): 11/11 at FILL 300.
- **verify-all** (OUT=/tmp/axion-verify-w24, dev 7490, app code 82eef4a): **ALL 10 STEPS PASSED**, rc 0. That covers the
  build, both crawls, flows, auth flow, u1 flows, dialog smoke, dialog ids, help keys and the fs guard.

### The earlier red verify-all run
Run 1 (on 24d3183, load 20–39): 2 of 10 steps failed, flows and auth flow. I re-ran both alone at load 28–37 on HEAD and on
the base (a67d2dd, a scratch copy served on 7491):
- **auth-flow, base and HEAD alike:** "member has no admin approvals panel" and "v1 → v2 migration loads the old missions —
  0 rows". They touch no thread code.
- **flows:**
  - On HEAD: "Hierarchy: … conversation pane did not switch".
  - On the base: "Conversations: … thread did not switch to Planner-01".
  - Both steps use the fixed 500 ms wait that cycle 22 already reported as load-sensitive. Run 1 also had "Delete (archive)"
    and "Modal focus trap" FAIL at load 39; neither recurred in the re-run.
- **flows.mjs, three times each, back to back, after verify-all passed:**
  - **HEAD:** all PASS at load 9.3, 10.0 and 12.9.
  - **Base:** all PASS at load 8.9 and 11.3. At load 71, Hierarchy, Conversations switch, command palette and theme toggle
    FAIL.
  - Counting verify-all run 2, the Hierarchy step passed 4 of 4 times on HEAD at load ≤ 19. It failed on HEAD only at load
    28–39 and on the base at load 71. I read it as the known load-sensitive wait, not a regression. It does exercise the
    conversation pane that this cycle changed, so I name it here.

## 8. Screenshots (`web/docs/improve/cycles/c26-shots/`)
| Pair | Before / after | Difference |
|---|---|---|
| Demo M-126 conversation | `demo-conv-before.png` / `demo-conv-after.png` | 413 of 463,360 pixels: the first minimap block about 1 px lower (model offset) and the robot avatar's blink |
| Api thread of 302 messages, pinned | `api-thread-before.png` / `api-thread-after.png` | **Corrected in the fix round.** The first-round claim "same look" held for the thread body only: the minimap blocks of rows never rendered were 8 px slivers (review I1). The after shots were regenerated on the fix-round code; the minimap is a full-width column again |
| Api thread of 302 messages, scrolled to the middle | `api-thread-before-mid.png` / `api-thread-after-mid.png` | As above (regenerated). The message order differs only because the burst was posted 10 at a time |

## 9. Concerns
- **Threshold NOT MET** (total and worst). The floor run shows the remaining cost is page- and store-level. Candidates for a
  next cycle, each with its own behaviour risk, so not done here:
  - **Adaptive flush:** let the conversation flush interval adapt to render cost (cycle 22's suggestion).
  - **Narrower Missions-page subscription:** `Missions.tsx:136`/`:476` subscribe to the whole mission-control entry and
    re-render the page on every thread write.
  - **`lastEventAt`:** `useData.setState({ lastEventAt })` runs once per SSE event (`events.ts:71`) and re-renders the
    Overview tab 400 times per burst.
  - **Method:** measuring a production build, or not merging back-to-back tasks, would also change the picture. That is a
    method change for the owner to decide.
- **The reader is unpinned early in every burst, before and after alike.** The 30 ms smooth scroll is overtaken by the next
  batch, so the reader stops at the old bottom and the "N new" pill counts. Behaviour is unchanged, but it means most burst
  rows never mount in these runs.
- **Accessibility departures** (§5): the log is `aria-live=off` with a separate status line. That reverses part of cycle 23's
  setup and the brief's wording, and I did not test it with a real screen reader.
- **The minimap was reworked to stay cheap at 1,200 blocks:**
  - chunks with containment;
  - a stretched layer, so between re-layouts the blocks can be up to 12 % taller or shorter than exact;
  - a CSS entrance instead of motion. With motion, the blocks kept opacity 1 inline, so the designed .55/.95 in-view
    contrast never showed. I kept opacity 1 so nothing changes visually; whether to restore the contrast is a design
    question.
- **Geometry lags measurement by up to 400 ms:** the minimap and spacers catch up after rows are measured. The browser's
  scroll anchoring keeps the visible rows in place meanwhile. Pinned readers are re-pinned explicitly, because anchoring does
  not move a scroller that sits at its end.
- **api-c09 was not run:** it is not in the base.

## Fix round (review c26-review.md)
The timing threshold stays **NOT MET**. The fix round changes no timing claim.

App code is final at 48e9731; the last commit, 048c19f, is test-only.

| Commit | What |
|---|---|
| afd2015 | I1 fix and the I1/I2 checks |
| 48e9731 | I2 fix: the thread's own scroll anchor; a tall focused message shows its start |
| cb8020f | Scroll-back check on the mixed thread |
| 048c19f | api-c22 condition wait |

### I1: minimap blocks of rows never rendered (fixed)
**Model (`threadWindow.ts`).** Rows not measured yet now take their estimates from the measured rows of the same message
kind:
- the height (spacer and block) and the block width are each the mean of the first 30 measured rows of that kind;
- before a kind has any measured row, they fall back to the mean of all measured rows, then to the old first guess;
- the means are then held, so the spacers and the minimap do not churn;
- they are learned again when the thread's width changes (text re-wraps). The cache clears, the estimates restart, and the
  rows on screen are measured again at once (`relearn`, `ChatView` ResizeObserver).

**New check (api-c26 `widths`).** On a long thread with the reader at the bottom, every minimap block of a row not on
screen must be within ±25 % of the mean measured width of its kind. The same check runs after the thread gets narrower
(viewport 1600 → 1480, thread 366 → 274 px), and the mean must be over 4 px, so a hidden minimap cannot pass.

| Run | Reader at the bottom | After the thread got narrower |
|---|---|---|
| **RED** (82eef4a app code, 1,002 messages) | 936 of 986 off-screen blocks outside ±25 %: 8.2 px against a 23.5 px mean | 986 of 988 outside |
| **GREEN** (48e9731, 1,202 messages) | 0 of 1,186 outside, all 23.5 px | 0 of 1,189 outside, all 26.7 px |

**Report §8 corrected.** "Same look" was true for the demo pair only. The api after-shots were regenerated on the
fix-round code, and the minimap is a full-width column again.

### I2: mixed heights (a bug found and fixed)
**New api-c26 `mixed()` pass.** A fresh thread of 240 messages, rotating through:
- one line;
- a 90-word paragraph;
- a 20-line message;
- three lines;
- a 30-word line;
- an 8-line list;
- a PNG attachment on every 6th message (uploaded through `/uploads`).

It asserts:
1. after a reload, the reader is pinned and stays pinned for 3 s;
2. each older page keeps the visible message in place (±8 px). The page request is **held until the test has recorded the
   message**, which answers review Minor 5's timing window;
3. a top-to-bottom walk renders all 242 messages in order, never with a blank viewport;
4. scrolling up 1,200 px and back puts the same message at the same place (±3 px);
5. Home, End, Home and ↓×25 each focus the right message and show it in the viewport;
6. minimap blocks match the rendered rows within 1.5 px, in the middle and at the bottom.

**What it found.**
- **First older page jumped (RED on 82eef4a).** The message moved 74.8, 188, 589.8 and 100 px in four runs; later pages
  stayed under 1 px.
  - The app restored the anchor correctly; that was confirmed by instrumentation that was not committed.
  - The scroll event from that restore then mounted rows above with real heights far from the estimates. The browser's scroll
    anchoring did not compensate a scroll set by code that was followed at once by rows mounting above.
  - **Fix:** the thread keeps its own anchor, and `overflow-anchor` is now `none` on `.thread-body`. The first visible row and
    its offset are recorded on every scroll and after every change. After each commit, and in the ResizeObserver when a
    rendered row changes size, the scroll position follows that row, provided nobody scrolled in between (the recorded
    `scrollTop` is unchanged) and the reader is not pinned to the bottom.
- **End left a tall message's top out of view (RED on 82eef4a).** The last message is 20 lines plus an image, taller than
  the 374 px view, and `scrollIntoView({ block: 'nearest' })` showed its bottom. **Fix:** a focused message taller than the
  view now shows its start.
- **GREEN on 48e9731:** older pages 0.3 / 0.1 / 0.4 / 0.4 px; walk 242/242 with 0 blank viewports; scroll-back 0.0 px;
  keyboard all four ok; minimap 0 of 11 and 0 of 5 blocks off; pinned 0 px throughout.

### I3: merging with c25 (now on improve-30h, aaa18f6). Not done here, as instructed
**`web/src/features/chat/ChatView.tsx`**
- **c25's changes:**
  - `requestOlder` is split into `captureAnchor(el)` plus `requestOlder` (improve-30h lines 225–234);
  - the `onScroll` one-liner gains `if (loadingOlder && anchor.current) captureAnchor(el);` (improve-30h line 261);
  - the bubble's **Reply…** passes `replyTo: m.id` (line 92). That is a separate fix and should merge cleanly.
- **c26's changes:** `requestOlder` is at c26 line 410, and the whole `onScroll` handler is rewritten (c26 lines 509–517):
  `record()`, `far`, `flushSync(moveVp)` before `requestOlder`, and `moveVp` otherwise.
- **How to combine:** keep c25's `captureAnchor` helper. In c26's handler, put c25's re-capture **after the window has
  followed the scroll**, so the anchor is a row the reader can see:

      const el = ev.currentTarget; const b = …; setAtBottom(b); if (b) setNewCount(0);
      atBottomRef.current = b; record();
      const far = Math.abs(el.scrollTop - vpRef.current.top) > DRIFT || el.clientHeight !== vpRef.current.h;
      const atTop = el.scrollTop < 80;
      if (far && (atTop || (loadingOlder && anchor.current))) flushSync(() => moveVp(el)); // render the rows first
      else if (far) moveVp(el);
      if (loadingOlder && anchor.current) captureAnchor(el); // c25: a slow page; the anchor follows the reader
      if (atTop) requestOlder(el);                           // c26 + c25: requestOlder calls captureAnchor

- **Interaction with c26's own anchor:** c26's `hold()` does not conflict with c25's restore. The restore effect sets
  `scrollTop`, and `hold()` then sees a changed `scrollTop` and only records.

**`web/scripts/api-stage6.mjs` paging loop**
- **c25's changes:**
  - `await calm(A.p)` replaces `waitForTimeout(400)` after the page grows (improve-30h line 254) and `waitForTimeout(200)`
    after "leave the top" (line 259, and line 303 in the gap section);
  - adds `import { calm } from './_session.mjs'`.
- **c26's changes to the same loop (c26 lines 260–276 and 318–326):**
  - counts use `loaded()`, not `mids()`;
  - the anchor is captured after two animation frames;
  - adds the `reach()` walk.
- **How to combine:** take c26's version of those lines and replace its two remaining `waitForTimeout(400/200)` calls
  (c26 lines 271, 276, 326) with `await calm(A.p)`.

**After the merge:** run api-stage6, api-c22, api-c26, api-c09 (now on improve-30h), api-improve, a11y-check (demo and
api), flows and verify-all on the merged tree.

### Review minor items
- **Minor 1 (documented, not changed).** The user's own messages and receipt changes ("queued" → "acknowledged") are no
  longer announced: the log is `aria-live=off`, and the status line skips own and pending messages. Failed sends still raise
  a toast.
- **Minor 2 (open).** There is no announcer fallback when the previous last message is gone, and a repeat of identical
  text is not re-read.
- **Minors 3 and 4 (open).** Screen-reader browse mode and Safari, which has no CSS scroll anchoring, are untested. c26 no
  longer relies on the browser's anchoring: the thread keeps its own anchor.
- **Minor 5 (fixed in the mixed pass).** The page request is held until the anchor is recorded. The stage6 and c22 loops
  keep the two-frame capture.

### Runs on the fix-round code (all through heavy.sh, lane stack 7492/7493, dev 7490)
| Check | Result |
|---|---|
| **api-c26**, FILL 1,000, 3 reps | 19/19 behaviour checks (10 earlier + announcer + I1 ×2 + I2 ×6), page errors 0 |
| api-c26 timing (load fell from about 45 to 10 during the run) | whole trace 1,575 / 1,121 / 1,252 ms (mean 1,316), worst 814 / 429 / 594 ms: **NOT MET** (≤ 30 % of 2,958 = 887 ms; ≤ 200 ms) |
| api-c26 SHOT run (FILL 300, regenerating the after shots) | 13/13 |
| **api-stage6** | 92/94 in the first run (load ~16): the two failures were the designer-01 Edit version step, the known flake recorded in c01 and c22. **94/94** on re-run |
| **api-c22** | First run 13/14 (load ~16): N=1,000 "scrolling up loads the next older page" stayed 50 → 50 |
| api-c22, the 50 → 50 failure | Suspected cause: the store held the reloaded page before the thread had rendered and pinned it, so the jump to the top came before the pin. Unproven: the failure did not recur, so I could not confirm the race. Hardened with a condition wait (048c19f) |
| api-c22 re-runs | **10/10** (REPS 1) and **14/14** (REPS 3); reload → interactive 1.6–1.8 s (130) and 1.7–2.1 s (1,000) |
| **api-improve** | **107/107** |
| **a11y-check, api** | 1 LIVEPROBE in each of two runs at load 16–21, on other pages, both page probes outside the thread (`/agents/coder-01` and the proposals page) still showing the lazy page skeleton "Loading…" after `settle(400)`. **0 violations** at load 8 |
| **a11y-check, demo** | **0 violations** (50 views, 55 dialogs) |
| **verify-all** | **ALL 10 STEPS PASSED**, rc 0 |
