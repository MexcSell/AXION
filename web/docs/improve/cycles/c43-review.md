# c43 review (independent): H7 flows hardening

Tip reviewed: `281ccb1` (base `ac1a48c`), lane w42. Branch left exactly at 281ccb1, working tree clean, dev server on 9290 stopped.

## Verdict: PASS (no blockers, no majors, two minors, one note)

## Confirmed by running
- tsc (web): clean.
- `c43-modal-focus.mjs` on new Modal: PASS. With only Modal.tsx reverted to `ac1a48c` (working-tree copy, restored with `git checkout`): FAIL "focus moved to INPUT.input" 3 of 3 times. The regression check is deterministic and discriminates.
- flows.mjs at `FLOWS_CPU_THROTTLE=4`: 3 runs, 21 PASS / 0 FAIL each, "no console errors" each.
- flows.mjs plain: 2 runs, 21 PASS / 0 FAIL each.
- verify-all (`OUT=/tmp/axion-verify-w42r`): "ALL 10 STEPS PASSED" (its embedded flows step: 21 PASS, 0 FAIL).
- Palette probe on new code (Playwright real mouse): hover row 3 gives aria-selected index 3 and activedescendant matching; ArrowDown with the pointer parked gives 4 (keyboard wins, no snap-back); a no-match query shows the empty state, aria-activedescendant removed, Enter/ArrowDown/ArrowUp do not throw and the palette stays open; refill gives index 0.
- No `waitForTimeout`/`setTimeout` remain in flows.mjs (grep).

## Assertion audit (flows.mjs), by reading the diff
- `until` / `appears` return `undefined` on timeout (catch swallows only the wait's own timeout) and the original assertion line follows each one unchanged, so a real failure still fails with its original message. They cannot produce a pass: their return value is never used in an assertion. Checked every changed step; no assertion was removed or loosened.
- Timeouts raised 4-8 s to 15 s only lengthen waits; the final `expect` is unchanged.
- Approve step: added `appears(Approve once)` before reading `before`. Correct, and stricter than before (the old code could read a 0 badge before render).
- Dividers: sleeps replaced by two animation frames. Assertions (clamp, persistence, +100 px) unchanged. Frame-based settle is a heuristic, not a condition, but the 3 throttled runs passed.

## Findings
### Confirmed (by running)
- None blocking.

### Plausible only
1. minor, `web/scripts/flows.mjs` `frames()` (Dividers step, ~line 130): two rAFs assume the pane width is applied on the next painted frame; under a much heavier throttle than 4x or a slow commit, the drag measurement could read the width one frame early. Failure scenario: `drag` then `w()` reads the pre-update width, "pane did not resize" flake. Not observed in 5 runs. Suggest `until` on the width differing from `before`.
2. minor, `web/src/components/ui/Modal.tsx:36`: the 30 ms timer is still not cleared on unmount (pre-existing). The new guard means an unmounted dialog's timer is harmless (`first.focus()` on a detached node is a no-op), so no regression, just untidy. Cheap fix: store the id and `clearTimeout` in the cleanup.
3. note, `web/src/components/layout/CommandPalette.tsx`: the palette handler is `onMouseMove`, so a synthetic `pointermove` dispatch does not drive it (React needs `mousemove`). A deterministic palette regression check is feasible with `p.mouse.move` onto a row, then `fill`, then Enter, asserting the highlighted row runs; the implementer's "parked-pointer probe passed on old code" is consistent with Chrome not firing a `mousemove` for layout-induced hover changes, so the old-code failure came from `mouseenter`-driven `sel` leaking past a shrunken list. I did not run the palette against the old code, so the claim that the palette change fixes a flake is unverified; the new code is correct on the cases I probed.

## Palette correctness (reasoned and probed)
- `at = clamp(sel, 0, len-1)` is used consistently for aria-selected, activedescendant, the corner icon, Enter, scrollIntoView and `latest.current`. Arrow keys step from `at` (not stale `sel`), so no off-by-one after the list shrinks. Empty results: at = 0, `results[0]` undefined, Enter does nothing (probed). `sel` can go to -1 via ArrowDown on an empty list, harmless because `at` clamps. `setSel(0)` on q change is retained.
- Mouse hover highlighting is preserved (probed). Keyboard scrolling under a parked pointer no longer snaps the highlight back via mouseenter, which is the intended improvement.

## Modal correctness and accessibility
- Initial focus still lands on the first field when nothing inside is focused (flows dialog steps and the c43 check on the old code show the late focus does run). `data-autofocus` still wins in `first` selection; callers use `data-autofocus` (settings-ops, evolution-models, browser-results), and none rely on React `autoFocus` inside Modal. If a caller did, the focus would now be kept there, which is right.
- Nested dialogs: guard uses `el.contains`, per-dialog, so an inner dialog does not affect the outer. The `document.activeElement === el` clause keeps the case where the dialog container itself holds focus (Tab pull-in) moving to the first field.
- Focus trap and restore-on-close code is untouched.
- Slight behaviour change: if the user clicks the header close or help button inside the 30 ms window, focus stays there instead of jumping to the first field. Acceptable.

## Not met
- c29/c34 archive-race merge: not possible, c34 absent; agreed.
