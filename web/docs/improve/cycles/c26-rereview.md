# Cycle 26 re-review: fix round (virtualised conversation threads, lane w24)

Scoped re-reviewer, read-only. Inputs: `c26-review.md`, the "Fix round" section of `/home/luca/AXION-w24/web/docs/improve/cycles/c26-report.md`, the fix diff (afd2015, 48e9731, cb8020f, 048c19f, ed531d8 on top of cec94bd). Line numbers are for the w24 worktree at ed531d8 unless stated. I ran no servers and no tests, so every run result below is **as reported**. The I3 conflicts were checked by a trial three-way `git merge-file` on scratch copies (base a67d2dd, ours improve-30h 4ff1b40, theirs ed531d8). Nothing in either repository was changed.

`git diff --stat 48e9731 ed531d8 -- web/src` is empty, so the last two commits are test and docs only, as claimed.

## Verdicts on the review's findings

### I1: ADDRESSED
Unmeasured rows' height and minimap width are now estimated per message kind from measured rows, and learned again when the width changes.
- **Model, `web/src/features/chat/threadWindow.ts`:**
  - `newEstimate` :32; `learn` :36 (the first 30 samples per kind and overall, then held); `relearn` :43; `estRow` :44 (per kind, falling back to the overall mean); `estWidth` :45 (per kind, then the overall mean, then the old text-length guess).
  - Used by `layoutRows` (spacers) and `mapRows` (minimap), so the spacers and the blocks agree.
- **Wiring, `ChatView.tsx`:**
  - `ThreadRow` carries `data-kind`, and `learn` runs on a row's first measurement (:329).
  - On a width change, the ResizeObserver calls `relearn` and re-measures the rows on screen at once (:340-345).
- **Check:** api-c26 `widths()` (`web/scripts/api-c26.mjs:295-320`) runs at the bottom and again after a 1600→1480 px narrowing. It requires every off-screen block to be within ±25 % of the measured mean of its kind, and that mean to be over 4 px.
- **Evidence (as reported):**
  - RED on 82eef4a: 936/986 and 986/988 blocks outside the band (8.2 px against a 23.5 px mean).
  - GREEN on 48e9731: 0/1,186 and 0/1,189.
- **Report §8:** corrected, and the api after-shots were regenerated.
- **Caveat (Minor):** the check runs only on the uniform FILL thread. Every message in the mixed pass is `kind: 'command'` (api-c26.mjs:352), so the per-kind split and its fallback are never exercised with more than one kind. The ±25 % check proves the slivers are gone. It does not prove that kinds are told apart.

### I2: ADDRESSED
The mixed-height pass exists and covers all four items. It found two real bugs, and both are fixed.
- **Fixture:** `mixed()` (api-c26.mjs:328-456) uses 240 messages of seven shapes (one-liners, a 90-word paragraph, 20 lines, 8-line lists), with a PNG upload on every sixth message.
- **Older-page anchoring:** :364-389. The page request is held by `p.route` until the anchor is recorded, which also closes the review's Minor 5. The tolerance is ±8 px, not the ≤ 4 px the review asked for. Measured 0.1–0.4 px; tighten the tolerance to 4 px if cheap.
- **Bottom pin under late measurement (image rows):** :357-362, distance from the bottom every 250 ms for 3 s.
- **Keyboard focus scroll:** :421-439, Home / End / Home / ↓×25. The check requires the focused row's top to be in view. The tall-End bug was found and fixed: `ChatView.tsx:449` uses `block: 'start'` when the row is taller than the view.
- **Minimap alignment:** :440-456, ±1.5 px, matched by id, in the middle and at the bottom.
- **Also:** a walk with no blank viewport (:393-409) and the ±3 px scroll-back check (:410-420, cb8020f).
- **RED → GREEN (as reported):** first older page 74.8 / 188 / 589.8 / 100 px → 0.1–0.4 px; End RED → ok.
- **Gap (see N1):** every movement in the pass is an instant `scrollTop` write or a key press. No script in `web/scripts/` uses `mouse.wheel`, `behavior: 'smooth'`, the `.new-pill` button or a minimap rail click.

### I3: ADDRESSED, with two small corrections
The conflict notes are exact. The trial merge gives exactly two conflict hunks, both where the notes say:
- `ChatView.tsx` `onScroll`: improve-30h :261 against c26 :509-517.
- `api-stage6.mjs`: improve-30h :254 `calm` against c26 :271 `waitForTimeout(400)`.

Every line reference checks out:
- improve-30h: `captureAnchor` :225, `requestOlder` :230, `onScroll` :261, stage6 `calm` :254/259/303.
- c26: `requestOlder` :410, `onScroll` :509, stage6 waits :271/276/326.
- `captureAnchor` and `requestOlder` auto-merge as the notes describe.

Corrections:
1. The notes say "its two remaining `waitForTimeout(400/200)` calls" but list three lines. In the merge, :276 and :326 resolve to `calm()` without a conflict, so only the :271 hunk needs a hand edit.
2. The `Reply…` `replyTo: m.id` change and `ChannelChat`'s `flushChannelMark` come from c09 (f344340 / b18c5a2), not c25. Both auto-merge.

Two process notes:
- The combined `onScroll` in the notes has never run. c25's stale-anchor check must pass on the merged tree, together with c26's mixed pass.
- c24 (4ff1b40) landed after the notes were written. It adds no thread rules to `touch.css`, but `api-mobile` belongs in the merged-tree run list.

## The new own-scroll anchor and `overflow-anchor: none`

**(a) Scope: OK.** `overflow-anchor: none` is set only on `.thread-body` (`web/src/theme/pages/chat.css:52`). That class is rendered only by `ChatThreadView` (`ChatView.tsx:502`), and no other `overflow-anchor` rule exists in `web/src`. Side effects:
- The thread's subtree can no longer be the anchor node for an outer scroller, such as a phone page that scrolls. That is harmless.
- The file header comment `ChatView.tsx:191-192` still says "overflow-anchor is left at its default, auto". It is stale and should be updated (Minor).

**(b) The own anchor.** `record` is at `ChatView.tsx:261-267` and `hold` at :268-276. `hold` runs from a layout effect after every commit (:463) and from the ResizeObserver whenever a row changes size (:350). It skips when pinned or when `scrollTop` has moved since the last `record`.
- **Rows above change height without paging (late images): correct.** The ResizeObserver fires after layout and before paint. `hold` sees an unchanged `scrollTop` and moves it by the anchor row's shift. If the growing row is itself the first visible row, the content below it moves. That matches what browser anchoring would do.
- **While the user is actively scrolling: NOT ESTABLISHED (N1, Important, unverified).**
  - `onScroll` calls `record()` on every scroll event (:511), so `scrollTop === v.st` holds in almost every commit and ResizeObserver callback during a gesture. The guard does not detect a scroll that is still in flight.
  - A write therefore happens whenever the reader's row has shifted. That happens on upward scrolls into rows not yet measured. It also happens on downward scrolls, because `layout` refreshes only on the `geoV` debounce (100–400 ms): a row measured and then unmounted inside that gap goes back to a spacer of estimated height, and shifts again when `geoV` lands.
  - The old mechanism, browser anchoring, adjusted the scroll in cooperation with the scroller. The new one writes `scrollTop` from script.
  - I cannot verify from here whether such a write cuts short an in-flight wheel smooth-scroll animation or a `scrollTo({ behavior: 'smooth' })`. CSSOM View's "perform a scroll" says a new scroll aborts an ongoing smooth scroll.
  - The smooth scrolls affected would be the "N new" pill (:534 → `scrollTo 1e6 smooth`), a minimap rail click and minimap Home/End (`ThreadMinimap.tsx:128,149-150`), and wheel notches on platforms with smooth wheel scrolling.
  - The symptom would be a hitchy upward scroll, or a pill or minimap jump that stops short. The pill also clears itself (`setNewCount(0)`), so a reader left mid-thread has nothing to click again.
  - No check covers any of this (see I2's gap).
- **At the bottom pin: correct.** `hold` is skipped while `atBottomRef` is set (:271), and the `[geoV]` re-pin (:428) still owns that case. `atBottomRef` is refreshed in `onScroll` and from state before `hold` (:463). The reload trail stays below 60 px (as reported).
- **After a gap reset or fill: no regression.**
  - If the remembered row is gone, `hold` only records.
  - If rows are inserted above a surviving row, the reader's row is kept in place, as browser anchoring did.
  - If the insert is taller than the overscan, the remembered row is not rendered in that commit and no correction happens. That is also what happened before.
- **After sign-out: safe.** `hold` and `record` guard on `scroller.current`, the ResizeObserver is disconnected on unmount (:379), and a stale `vis` id simply is not found.
- **Interaction with c25's restore: none.** The older-page restore (:417-423) runs before `hold`. `hold` then sees a changed `scrollTop` and only records. After the merge, c25's `captureAnchor` during a slow page measures the same first-visible row, so the two agree.
- **Cost (Minor):** `record()` forces layout on every commit, including pinned bursts where `hold` writes nothing. Returning early in `hold` while pinned would avoid that.

**(c) A focused message taller than the view: correct, with Minor notes.**
- `block: 'start'` when `offsetHeight > clientHeight` (:449) shows the message's start, and the anchor then holds that row.
- (Minor, carried over from the original c26, not new) the arrow keys and PgUp/PgDn move one message at a time. Keyboard-only sighted users cannot reach the middle of a message taller than the view. PgDn could scroll within a tall message before it moves on.
- (Minor) `scrollIntoView` also scrolls ancestors. With `start`, a phone layout whose page scrolls may push the thread head out of view. Setting the scroller's `scrollTop` directly would avoid that.

**(d) The api-c22 condition wait (048c19f, `web/scripts/api-c22.mjs:162-164`): not masking anything. It does not block.**
- `until(...)`'s result is not asserted, and the check that follows is unchanged. If the thread never pinned, or never loaded a page, the test would still fail. The wait cannot turn "never loads" green.
- In the app, `requestOlder` (:410-415) has no one-shot latch. Its guards (`hasOlder`, `!loadingOlder`, `armed`) re-arm, so any later scroll to the top asks again. A user cannot be left unable to load older messages.
- The root cause is unproven. The implementer's hypothesis is plausible: `loaded()` reads the store (:151), so the jump could come before React committed and pinned the rows.
- A second candidate is a c26-original race: the `[geoV]` re-pin (:428) uses the `atBottom` state. That state still says "pinned" between a script write to `scrollTop` (the test's jump, or a minimap click) and its scroll event in the next frame. If a debounced bump fires in that frame, the reader is snapped back to the bottom once, and the next scroll works.
- The new wait does not remove this second race. It is rare (the failure did not recur in 24 runs) and recoverable. It is worth one guard later, for example re-pinning only if `scrollTop` has not moved since the last pin. Not a blocker.

## New findings
- **N1 (Important, unverified).** `hold()` writes `scrollTop` from script during user, wheel or smooth scrolls. Its guard cannot tell that a scroll is in flight. It may cut short wheel or smooth scrolls (the "N new" pill, minimap click or Home/End) on mixed-height threads. No check covers wheel or smooth scrolling.
  - **Required check on the mixed thread:**
    - wheel up (`page.mouse.wheel`) 3,000 px through unmeasured rows, then assert the distance travelled is at least 90 % of the requested distance;
    - from 3,000 px up, with a new message arriving, click the pill, then assert the reader ends pinned;
    - click the minimap rail at about 10 %, then assert the view lands within half a view of the target.
  - **If any of these fail:** skip `hold`'s write while a smooth scroll is in flight, by flagging the app's own `scrollTo(..., smooth)` calls until `scrollend` and re-issuing the scroll to its target. Another option is to restore `overflow-anchor: auto` and apply the own anchor only within the older-page restore window, which was the case the browser missed.
- **Minor:**
  - the stale header comment (`ChatView.tsx:191-192`);
  - the mixed pass is single-kind (`kind: 'command'`), so the I1 per-kind fallback is untested;
  - the mixed older-page tolerance is ±8 px rather than ≤ 4;
  - `record()` forces layout on pinned commits;
  - the tall-message keyboard reach and `scrollIntoView` scrolling ancestors (both above).
- **Timing note:** the fix-round worst task is 814 / 429 / 594 ms, against 464–518 ms before, at unequal load (about 45 → 10). "Changes no timing claim" is therefore not demonstrated, though the threshold already stands as NOT MET. Record the fix-round figures in LOG.md beside the earlier ones.

## Recommendation: NOT CLEAR, pending one check
I1, I2 and I3 are addressed. Nothing else found blocks. The one open question is N1: the new script-driven anchor replaced the browser's cooperative anchoring, and its effect on scrolls already in flight is untested.

Run the three-part N1 check above on the mixed thread, in this lane or on the merged tree:
- **If it passes:** CLEAR for merge. Then do the I3 hand-merge and the full merged-tree run list: api-stage6, api-c22, api-c26 (with the mixed pass), api-c09, api-improve, api-mobile, a11y (demo and api), flows and verify-all. Include c25's stale-anchor check and record PARTIAL / timing NOT MET in LOG.md.
- **If it fails:** apply one of the two mitigations above, re-run the mixed pass and the N1 check, and then clear.
