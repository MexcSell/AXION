# Cycle 26 review: virtualised conversation threads (lane w24)

Reviewer: independent, read-only. Branch `c26-thread-virtualise` (worktree `/home/luca/AXION-w24`, base a67d2dd, app code
82eef4a, HEAD cec94bd). Inputs: brief, PROCESS.md safety rules, `c26-report.md`, `c26-shots/`, the diff. I ran no servers,
so the timings, the forced-defect REDs and the green runs below are **as reported**, not re-run.

## Verdicts
- **Recommendation: MERGE AFTER FIXES.** The change is a real net improvement: burst cost no longer grows with thread
  length, total cost is 2.1× lower at 1,000 messages, the worst merged period is about 5× lower, and no single task is over
  200 ms. Nothing found is Critical, and nothing touches the untouchable areas. The fixes are small: the minimap block
  shapes, one mixed-height check, and the report's visual claim. The merge itself needs care, because c25 changed the same
  lines.
- **Spec verdict: PARTIAL. The timing threshold is NOT MET, and that label should stand.**
  - Long-task total is 47 % of before (limit 30 %).
  - The worst merged task is 464–518 ms (limit 200 ms).
  - Reload → interactive PASSES (1.5–2.1 s).
  - Every behaviour item PASSES as reported, except api-c09, which was not run because it is not in the base. It must run
    on the merged tree.
  - Merging an honestly labelled NOT MET cycle has precedent (c06 item 3, c23 threshold 4). It does not weaken the
    threshold, as long as LOG.md records it as NOT MET.
- **Quality verdict: GOOD, with a moderate complexity cost.** The code is careful and well commented. It is guarded by 11
  new behaviour checks (api-c26) on top of the updated stage6 and c22 checks. Its weak spot is evidence: every test fixture
  has uniform row heights.

## Findings

### Critical
None.

### Important
**I1. In long threads, minimap blocks for rows that were never rendered are drawn at a too-narrow estimated width. The
minimap is a staircase that changes with scroll history. The report's "same look" claim is wrong for the api pairs.**
- Where: `threadWindow.ts:75` estimates `w = min(.85, .22 + text.length / 420)`. For "fill 0150" that is about 0.24, or 8 px
  of the 34 px lane. A measured bubble is about 0.7, because the meta line sets a minimum width.
- Evidence: in `c26-shots/api-thread-after-mid.png` and `api-thread-after.png`, the rail is full-width only where rows were
  rendered. Everywhere else it is an 8 px sliver with a right-hand border line. Both `*-before*.png` shots show a uniform
  full-width column. (Enlarged side by side:
  `/tmp/claude-0/-home-luca-AXION/110db678-84c0-496e-aaa7-b625859aebb5/scratchpad/mm-compare.png`.)
- How much: in a 1,000-message thread, almost every block is estimated, so most of the rail looks wrong.
- It also gets worse: any width change of `.thread-body` clears the whole cache (`ChatView.tsx` ResizeObserver branch,
  `geo.current.clear()`). A splitter drag, a window resize or the minimap toggle therefore turns every off-screen block back
  into a sliver.
- The 413-px "unchanged" figure is true only for the demo thread, where every row is measured.
- The owner asked for this minimap ("owner 2026-11-20 (d)") and wants reference-exact UI.
- **Fix (cheap):** estimate `w` from measured rows, for example a running mean of measured `w` per side or per kind, kept
  across width resets as a ratio. Then correct report §8, which says the api pairs look the same.

**I2. Evidence gap: every fixture has uniform heights, so the estimate-error paths are untested.**
- Where: `api-c26.mjs:74` uses `fill 0001…`, and `api-stage6.mjs:231/301` use `paging message 001…` and `gap message 001…`.
  These are all one-line commands of the same kind with no attachments.
- Why it matters: the estimate is the mean of the first 30 measured rows, so in these tests estimate ≈ actual. The code
  that exists *because* estimates are wrong is therefore never exercised:
  - browser scroll anchoring absorbing corrections above the viewport (`ChatView.tsx` comment block, line ~192);
  - the 100–400 ms geometry lag;
  - the pinned re-pin (`useLayoutEffect(..., [geoV])`);
  - the `focusRow` correction with `scrollIntoView` ("the estimate may have been off");
  - api-c26's "never a blank viewport".
- These paths cover question (2) directly: scroll anchoring, older-page load and gap fill.
- **Fix:** one api-c26 run, or an extra pass, on a thread that mixes lengths: one-line, ~600-character and multi-paragraph
  texts, and a few image attachments. Re-assert the walk/blank check, the older-page "no jump" check (≤ 4 px), the
  scroll-back check (≤ 3 px), and pinned-after-reload.

**I3 (merge condition, not a code defect): c25 has since changed the same lines. Merge by hand, then re-run everything on
the merged tree.**
- `ChatView.tsx` `onScroll`: c25 (aaa18f6) added the stale-anchor fix,
  `if (loadingOlder && anchor.current) captureAnchor(el)`, and split `requestOlder` into `captureAnchor`. c26 rewrote that
  handler. Keep both: c25's re-capture during a slow page and c26's `flushSync(moveVp)` before `requestOlder`.
- `api-stage6.mjs` paging loop: c25 replaced `waitForTimeout(400/200)` with `calm()` on the lines that c26 edited.
- After the merge, run api-stage6 (94/94), api-c22, api-c26, **api-c09** (now on improve-30h via b18c5a2), api-improve,
  a11y-check (demo and api), flows (c25's Hierarchy fix) and verify-all.

### Minor
1. **Own messages and receipts are no longer announced.** Before, the polite log read out your own appended row ("…
   sending") and, with the default `aria-relevant="additions text"`, receipt text changes ("queued" → "acknowledged").
   - Now the log is `aria-live="off"` (`ChatView.tsx`, the `role: 'log'` spread), and the status line skips own and pending
     messages on purpose.
   - Failed sends are still announced: they raise a toast (`Messenger.tsx:182`, `ChannelChat.tsx:48`) and put the draft
     back.
   - The report mentions skipping own messages but not that receipts went silent.
   - Acceptable, but document it, or add a short "Sent" / "Acknowledged by …" line to the status region.
2. **The announcer has no fallback when the previous last id is gone.** It speaks only when
   `i = messages.findIndex(prevLast) >= 0`. The "N new" counter has a fallback for this case; the announcer does not.
   Missed announcements:
   - the first message from someone else into an empty, loaded thread (the `armed` layout effect absorbs it);
   - a reply that lands in the same render in which `settle()` swaps `local-N` for the server copy
     (`missionControl.ts:419-431`). This is a narrow race.

   Separately, an announcement whose text matches the previous one exactly is not re-read, because the DOM text does not
   change. Fix: use the `known` id set, or a seq high-water mark, instead of `prevLast`; key or clear the status text so a
   repeat is re-read.
3. **Screen-reader browse mode is unverified, as the report says.**
   - Only the rendered window (about 15–26 rows) is in the accessibility tree. In browse mode, reading further depends on
     the screen reader scrolling the container as its cursor moves.
   - The arrow, PgUp and PgDn handlers reach the page only in focus/forms mode.
   - The pattern is the one the brief allowed. PgUp/PgDn moving one message matches the APG *feed* pattern, so it is not a
     bug. `role="feed"` would be the canonical container for this.
   - Queue a manual NVDA and VoiceOver smoke test as an owner question, with the default "accept".
4. **Safari scroll anchoring is unverified.**
   - Corrections above the viewport rely on `overflow-anchor: auto`. Every test runs in Chromium. Safari has historically
     lacked CSS scroll anchoring.
   - Without it, scrolling up mounts rows whose real height differs from the estimate, and the content shifts by the
     difference.
   - This does not block, because the project tests only Chromium. Note it.
5. **The "no jump" checks got a timing window.**
   - `api-stage6.mjs` (paging loop) and `api-c22.mjs` (`behaviour`) now capture the anchor two rAFs after `scrollTop = 0`.
     The app's `onScroll` has already called `requestOlder` by then.
   - If a fast local page landed within those two frames, the ≤ 4 px check would compare a restored position with a
     restored position.
   - The check still has teeth: it went RED (999 px) on 08ad30e, as reported.
   - A sturdier form: hold the older-page route until the anchor has been captured.
6. **The focused and Tab-stop "islands" are never released.**
   - `focusId` is set in `onFocus` and never cleared on blur, so one extra row stays mounted after focus leaves the
     thread. This is harmless.
   - `AgentProfile.tsx:328` renders `ChannelChat` without `key`, so window and focus state carry over between agents. The
     geometry cache is keyed by message id, so this is harmless too.
   - Messenger threads are keyed per partner (`Messenger.tsx:108`), and ChatDock and JobSearch key per channel.
7. **The performance caveat qualifies the 47 %.** Report §9 says the reader is unpinned early in every burst, before and
   after. Burst rows therefore mostly never mount in the "after" runs, and a pinned reader during a burst was not measured.
   The cost should still be bounded by the window size, but it is unmeasured.

## Answers to the controller's questions

**(1) Accessibility.**
- **Reachable by keyboard: yes.**
  - One roving Tab stop (`tabIndex={tab ? 0 : -1}` in `ThreadRow`).
  - ↑ ↓ PgUp PgDn Home End are handled only when the event target is the row itself: `!t.matches('[data-mid]')` returns
    early, and modified keys are ignored.
  - ↑ on the first loaded row asks for the older page.
  - The focused row and the Tab-stop row are kept mounted (`segs` islands).
  - Reported by api-c26 checks at lines 156, 163 and 171.
- **No conflict and no trap:**
  - The handler sits on `.thread-body`, and the composer is outside it (`{composer}` after `.thread-scroll`).
  - Buttons inside bubbles keep their native keys.
  - Tab and Shift+Tab move normally.
  - a11y-check's Tab walk is reported green.
- **Reachable by screen reader:**
  - Every row is an `article` with `aria-posinset`/`aria-setsize`, where setsize counts the older messages not yet loaded
    (`base = total - messages.length`).
  - In focus mode, every message is reachable.
  - Browse mode is unverified (Minor 3).
- **Announcements:**
  - Messages from others are announced in order by the status line: "N new messages. Latest, who: text", capped at 200
    characters. During a 200-message burst that is far quieter than the old polite log, which would have read every row.
  - Own messages and receipts are no longer announced (Minor 1).
  - Edge cases are missed (Minor 2).
- **c23 states are intact:** the `emptyState` branch still drops `role=log` and makes the empty block `role=alert` or
  `role=status`, unchanged, and "Loading older messages…" is still `role=status`.

**(2) Correctness.**
- **Bottom pin:** the pinned window always includes the newest rows (`if (atBottom && n) … e = n`). A re-pin follows each
  measurement. RED → GREEN 136 → 0 px, as reported.
- **Older-page load:**
  - The window is shifted by the new rows' model height in render, so the same rows stay mounted and the existing anchor
    restore finds its row.
  - `flushSync(moveVp)` before `requestOlder` fixes the jump-to-top case (RED 999 px → GREEN).
  - Older pages are proven only with uniform heights (I2).
- **Gap fill:** rows inserted mid-thread go into the spacer; stage6's after-reconnect walk renders all 192.
- **"N new":** the logic is unchanged.
- **Drafts:** the composer is outside the changed code. api-c22's draft check is green.
- **Minimap accuracy:**
  - The "12 % tolerance" is cosmetic only. Positions are exact: `top·sb` stretched by `s/sb` gives `top·s`. Only the
    stripe thickness and the 3 px minimum height stretch, by at most 12 %.
  - c22-I1 is still within 1.5 px for rendered rows, as drawn. **Acceptable.**
  - The real inaccuracy is the estimated *width and height* of rows never rendered (I1). Their *positions* match the
    scroller, because the spacers use the same estimates.
- **Late heights (≤ 400 ms):** mounted rows are already laid out by the browser. Only the spacers and the minimap catch
  up, and scroll anchoring holds the view in Chromium.
- **Read marks: not affected.** Read is set per thread or channel when it opens or grows, not per visible row:
  - `ChannelChat.tsx:34` calls `markChannelRead` / `markRead` on `stored.length`;
  - `missionControl.ts:214` sets `unread: 0` on load;
  - no IntersectionObserver or "seen" logic exists anywhere in `src`.

  Virtualisation cannot mark unseen rows read, or seen rows unread, beyond the existing "opening means read" behaviour.

**(3) Tests: intent kept, not weakened.**
- **api-stage6:**
  - `loaded()` reads minimap ids.
  - The new "every loaded message is reachable" check cross-checks three sources: DOM rows rendered on a top-to-bottom
    walk, in order; minimap ids; and `aria-setsize` against the server count.
  - Removing a row from the DOM, or a message from the model, turns it RED (85/94 and 90/94, as reported).
  - The old "one minimap block per loaded message" intent survives as walk count = block count.
- **api-c22:** the I1 alignment check now covers only rendered rows. That narrowing is inherent, since off-screen rows
  have no DOM position. Blocks are matched by id, which is stricter than matching by index. The tolerance is still 1.5 px.
- **Caveats:** uniform fixtures (I2) and the rAF window in the "no jump" capture (Minor 5).

**(4) Visual.**
- Demo: unchanged (413 / 463,360 px).
- Long api threads: **not unchanged.** The minimap blocks for unrendered rows are narrow slivers (I1). The thread body
  itself looks the same in the shots. The in-view .55/.95 contrast was already overridden by motion's inline opacity 1
  before this cycle, and that is kept on purpose.

**(5) Cost against benefit.**
- **Cost:** about +250 dense lines in `ChatView.tsx` and a new 78-line `threadWindow.ts`, using several subtle mechanisms:
  - state derived during render;
  - `flushSync` inside a scroll handler;
  - a debounced ResizeObserver;
  - frozen estimates;
  - focus islands;
  - the minimap's chunk, scale and transform layering.
- **Mitigation:** the code is well commented, and api-c26 guards the tricky behaviour.
- **Benefit:**
  - cost stays flat in thread length: 50 → 1,000 messages is 1,513 → 1,385 ms after, against 1,650 → 2,958 ms before;
  - the DOM holds 15–26 rows instead of 1,202;
  - reload is unchanged and within its thresholds.
- The remaining distance to the threshold is page- and store-level: the floor run alone averages 1,007 ms. A future cycle
  can attack that (narrower Missions subscription, the `lastEventAt` writes, an adaptive flush) without revisiting this
  code.
- **Worth it**, given that cycle 22 identified long threads as the growth risk.

## Fix list before merge
1. I1: estimate minimap block widths (and ideally heights per kind) from measured rows; correct report §8.
2. I2: add one mixed-height pass (long texts and attachments) to api-c26 and run it; the existing checks must stay green.
3. I3: hand-merge with c25's ChatView `onScroll` and stage6 `calm()` changes, then run api-stage6, api-c22, api-c26,
   api-c09, api-improve, a11y (demo and api), flows and verify-all on the merged tree.
4. Record c26 in LOG.md as **PARTIAL: timing NOT MET** (47 %, worst 464–518 ms), with the floor-run explanation.
5. Optional: Minor 1–2, a small announcer fallback and a receipts line.
