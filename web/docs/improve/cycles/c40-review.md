# c40 review (mobile debt, lane w38, tip 38306f5, base 4ff1b40)

Reviewer: independent. Lane left at 38306f5, clean tree. Servers on 8890-8893 stopped, scratch worktree removed.

## Verdict: PASS-WITH-FIXES

The work does what it claims and I found no harness loosening and no desktop regression. Two items should be fixed before merge or immediately after (KPI strip, keyboard scrolling of the new help scroller). Neither blocks the gate.

## Gates re-run (all on tip 38306f5)

| Gate | Result |
|---|---|
| `api-e2e.sh "DATA_MODE=api node scripts/api-mobile.mjs"` | 650 states, 361 dialogs, NO FAILURES, 0 FAIL lines |
| `api-c40.mjs` (390/900/1280) | NO FAILURES (but see finding M2: 0 popovers measured at 390) |
| selftest-mobile.mjs | 5/5 PASS |
| web tsc `--noEmit` | clean |
| fit-check 1366x768 | ALL FIT |
| fit-check 1280x760 | ALL FIT |
| a11y-check demo | 50 views, 56 dialogs, 0 violations |
| a11y-check api | 40 views, 56 dialogs, 0 violations |
| verify-all, OUT=/tmp/axion-verify-w38r | ALL 10 STEPS PASSED |

(States 650 / dialogs 361 versus the report's 653 / 360: live-data variance, not a gap.)

## 1. Harness integrity: confirmed clean

- I diffed the old in-file `MEASURE` in api-mobile.mjs (base) against `_mobile-measure.mjs` line by line. The only changes are `export` and the one added `vis()` line `if (el.closest('[data-exiting="true"]')) return null;`. Thresholds (39.5 px, 1 px tolerances), selectors, the scroll-ancestor exemption and dialog scoping are byte-identical. api-mobile.mjs otherwise only loses the function and gains the import; its state list, SIZES, SHOT_KEYS and `record()` are untouched (git diff of that file: +1/-25, all of it the move).
- Scope of the skip is tight: `closest()` on the exact attribute value `"true"`; selftest proves `"false"` does not hide a clipped control, and a static clipped control (right and left) still FAILs. I ran it: 5/5.
- The only producer of the marker is `ToastCard` (`Toasts.tsx:13`), set from `useIsPresent()`, so it is present only after AnimatePresence has started the exit. Grep finds no other `data-exiting` in src or scripts.
- Plausible but unconfirmed residual risk (low): if AnimatePresence never completes an exit (tab backgrounded so rAF stops, or a toast whose exit never resolves), a toast could keep `data-exiting="true"` while still painted, and the harness would skip it. By then it is at opacity 0 or translated, and an at-rest toast is never marked. I could not reproduce a stuck exit. Not blocking.
- Plausible (info): the selftest exercises only `MEASURE`, not the real `ToastCard` marker. No test fails if someone later removes the attribute from `Toasts.tsx` (the old 3 toast FAIL lines would return, i.e. fail-closed, so this is safe).

## 2. Desktop unchanged: confirmed, within noise

Method: scratch worktree at 4ff1b40 (dev server 8891) versus lane (8890), demo mode, 1366x768 and 1672x941, reduced motion, particles off. Pages: Missions, Mission Activity tab (M-126), Mission conversations tab, Operations/agents, Agent profile, Overview, a help popover, and the longest help popover found; dialogs DL-75 equivalent (`agent-version-propose`), `agent-rollback`, `help-drawer`.

- PIL pixel diff (threshold 8): Missions, Overview, help popover, rollback and help-drawer dialogs: 0 differing pixels at both sizes. The other pages differ by 6 to ~5500 pixels, and the set that differs changed between my two runs (agents 0 px in run 1, 5530 px in run 2). Side-by-side crops show only live demo data (merge countdown timers, VM names, sparklines, avatar animation). No layout shift.
- One 1 px vertical shift of the Skills chip row in `agent-version-propose` at 1366 (about 1900 px). I did not reproduce it as systematic (only seen in the first run; DL-75 in demo mode is api-only anyway). Treat as noise unless it recurs.
- Dialog geometry (this answers check 3): I opened every registered dialog id (56) through the test hook on base and tip at 1366x768 and 1672x941 and compared the `[role=dialog]` rect: 0 differences out of 112 measurements, including `drawer-layer` dialogs (`help-drawer`, `agent-evidence`), narrow, normal, lg and xl. `grid-template-columns:minmax(0,1fr)` does not change centring or width on desktop. (Reasoning: a single auto column already stretched to the container; the change only removes the min-content floor.)
- Mobile (<=800 px) `.modal-layer` rules are unchanged; the 24 px padding at 900 px shows DL-75 at 852 px, as claimed.

## 3 and 4. Help popover at 1280x760

Confirmed findings:

- **M1 (medium, a11y): a popover that really overflows cannot be scrolled from the keyboard.** `HelpTrigger.tsx:31` `.help-pop-body` is `overflow:auto` but not focusable, and the only tabbable elements in the popover are the two header buttons. Scenario: viewport 1280x520, open the first "Active agents" `?` with Enter. Body has 62 px hidden (scrollHeight 315 vs clientHeight 253). Focus is on "Open help in side drawer"; PageDown and ArrowDown leave `scrollTop` at 0; Tab only toggles between "Open help in side drawer" and "Close help" (focus trap); the mouse wheel does scroll it (scrollTop 114). So the hidden "Example" section is unreachable by keyboard. Before c40 the content was off-screen and equally unreachable, so this is not a regression, but the change introduces a scroller and should make it reachable. Fix: when the body overflows, give it `tabIndex={0}`, `role="region"` and an `aria-label`, or move focus handling so arrow keys scroll it.
  - Escape closes the popover and returns focus to the `?` trigger: works (verified).
  - Focus ring on the header buttons is visible (yellow ring in the screenshot).
- **L1 (low, cosmetic): at 1280x760 the same "Active agents" popover is clamped by 2 px.** Base popover is 379 px high (bottom 750), tip is capped at Radix's available height of 377 (bottom 748). The body gets scrollHeight 315 vs clientHeight 313, so the "Example" box's bottom border is clipped and a pointless 2 px scroll exists. Look at `.help-pop` (`base.css:370`) `max-height:var(--radix-popover-content-available-height)`. A popover that only barely fits is now clipped instead of overflowing by 2 px. Fix: add a small tolerance (for example `max-height: calc(var(--radix-popover-content-available-height) + 4px)`) or reduce padding when clamped. The short popover case (the Overview "Active agents" popover at 1366x768, not clamped) is pixel-identical to base.
- Plausible (low): `overflow:auto` on `.help-pop-body` can clip a focus ring or box-shadow of a link inside the body at the edges, and the scrollbar now sits inside the popover's 16 px side padding. Not seen in the screenshots; I did not test a popover with links.

## M2 (medium, test strength): api-c40 is vacuous for help popovers at 390 px
`web/scripts/api-c40.mjs:41-44`: the loop counts `n` only when a `.help-pop` is found. In my run the output was `390 help popovers measured=0 outside=0` and `900 ... measured=5`. At 390 the probe passes without having opened a single popover (touch mode, forced click, 220 ms wait). The popover fix at 390 is still covered by api-mobile (which opens ~20 popovers per page via dialog-less `Help:` buttons and reports none outside), so the gate stays valid, but the new probe cannot RED/GREEN that case. Add `if (!n) fails.push(...)` per size, as the Activity branch already does with "no act-card found". (The report claims the probe was RED on base with 15 lines; I did not rerun base.)

## 6. Owner's taste: Activity KPI strip at 390 (confirmed ugly, recommend fixing in c40)

`c40-shots/after-activity-390.png` (and my own rerun): the five `.act-kpi` tiles share one row (`mission-activity.css:3`, `repeat(5,minmax(0,1fr)) auto`; the max-width 1280 rule gives `repeat(3,...)` only). At 390 px the tiles squeeze to icon width and the values overlap: "140.1k", "4h 2m" and "38%" print on top of each other, "9 min" wraps over three lines, and the labels are gone. That is overlapping text, not just a cramped look, and the harness cannot catch it. It also existed before c40 (before-activity-390.png), so it is not a regression, but this is the "mobile debt" cycle and it is directly above the cards c40 fixed.

Suggested fix (one rule, no desktop impact): in a `@media (max-width: 800px)` block, `.act-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}` and let the trailing `auto` tile (RAM now) span both columns (`grid-column:1 / -1`). With 5 KPIs plus RAM that is 3 rows of 2, each tile about 170 px, enough for icon, value and label. Re-run api-mobile and the 390 Activity screenshot afterwards.

## Other notes

- Behaviour change worth knowing: `.act-body{grid-template-columns:minmax(0,1fr)}` in the 1280 media rule (`mission-activity.css:30`) is a safe equivalent of `1fr`; the desktop Activity layout at 1366 and 1672 diffs as live-data noise only.
- `touch.css` additions are scoped to `@media (max-width: 800px)`; they do not affect the 1366 and 1672 screenshots (0 diff for Mission conversations at 1366).
- The report's statement "I did not pixel-diff all pages" is accurate; I did the pixel and geometry diff above.

## Summary of findings by severity

Confirmed:
1. Medium: M1 keyboard cannot scroll a help popover that overflows (`HelpTrigger.tsx:31`, `base.css:371`).
2. Medium: M2 api-c40 passes with 0 popovers measured at 390 (`api-c40.mjs:41-44`).
3. Medium (polish, owner priority): Activity KPI strip at 390 overlaps text (`mission-activity.css:3`); recommend the 2-column grid under 800 px now.
4. Low: L1 2 px clamp clips the bottom border of a nearly fitting help popover at 1280x760 (`base.css:370`).

Plausible, not reproduced:
5. Low: stuck `data-exiting` after an interrupted exit would hide a toast from the harness.
6. Low: `overflow:auto` clipping a focus ring or shadow of an in-body link.
7. Info: selftest does not exercise `ToastCard` itself.
