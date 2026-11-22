# Cycle 43 (lane w42): flows.mjs hardening under load (H7)

## RED
`FLOWS_CPU_THROTTLE=4 node scripts/flows.mjs`, 5 runs plus 1 extra: 6/6 runs failed the same two steps.
| Step | Error |
|---|---|
| Command palette navigates (Ctrl+K) | `page.waitForURL: Timeout 30000ms exceeded` |
| Theme toggle switches html data-theme | `locator.click: Timeout 30000ms exceeded` (consequence: the palette was still open and covered the button) |
All other steps passed in those runs. (c29 listed Hierarchy, Conversations, help popover, News, Chat dock as flaky; they passed here at 4x but were hardened anyway, see below. News failed later in plain runs, cause 2.)

## Causes (two real app races, not test races)
1. **Palette Enter did nothing (app).** Screenshot: palette open, query intact, results correct, Help group loaded. An in-page keydown log showed the highlighted row index 10 of 25 at typing time and none highlighted among 4 results at Enter. `onMouseEnter` set the highlight from a pointer parked over the long initial list; once the list shrank, `sel` pointed past the results, so `results[sel]` was undefined and Enter ran nothing. Reproduces only with a late hover (throttle + the pointer left by the earlier drag step); any added delay hides it. Fix in `CommandPalette.tsx`: the highlight is clamped to the results (`at = min(sel, len-1)`, used for aria-selected, Enter, arrow keys, the waiting-Enter path) and the hover sets it on `onMouseMove` (a real pointer move), not `onMouseEnter`.
2. **News post silently failed in plain runs (app).** 3 of 10 plain runs (and 2 of 30 in a probe) failed "u1 · News"; state dump: title input held `E2E news headlinePosted by the flow test.` and the textarea was empty. `Modal` focuses its first field 30 ms after mount; when that timer fired between Playwright's focus of the textarea and its typing, the text went into the title. Same thing can happen to a fast typist. Fix in `Modal.tsx`: the late focus only runs if focus is not already inside the dialog.

## Regression checks
- Palette: the flows.mjs palette step itself, kept in its original form (fill then Enter at once, no waits): RED 6/6 FAIL before the fix, passes 20/20 after. I could not make a separate deterministic 1x script (a parked-pointer script at 8 positions passed on the old code), so the flows step is the check.
- Modal: `web/scripts/c43-modal-focus.mjs` (deterministic): focuses the textarea in the same task the dialog appears, waits past the 30 ms timer. Old Modal: `FAIL focus moved to INPUT.input`. New: `PASS`.

## Test changes in flows.mjs (same assertions, same messages)
Helpers added: `until` (waitForFunction, timeout swallowed), `appears` (locator waitFor visible, timeout swallowed). A timed-out wait falls through to the unchanged assertion, which FAILs with its own message. No fixed sleeps remain (`grep waitForTimeout` is empty); all 18 removed sleeps became condition waits.
| Step | Before | After |
|---|---|---|
| start | `waitForTimeout(800)` | wait `.mission-row` |
| Add mission | `waitForTimeout(900)` then count | wait row with the title, then same count assertion |
| Edit mission | `waitForTimeout(500)` | wait row `pricing page v2` |
| Approve | sleep 500, read badge | wait Approve button before reading `before`; wait badge == before-1 |
| Hierarchy | sleep 800; waits 8 s | wait `.hnode`; waits 15 s |
| Missions overview | sleep 600 | wait `.mw-list` |
| Conversations | sleep 600; 10 s wait | wait view radio; 15 s |
| Dividers | sleeps 600/800, 150 after each drag | wait splitters/panes; two animation frames after each drag |
| Conversation send | sleep 3000 / 4600 | wait ack (20 s) / report (20 s) |
| Theme | sleep 300 | wait `data-theme` != before |
| Help popover | click, check, sleep 250 | wait button/popover; wait popover gone |
| Modal focus trap | sleep 400 | wait dialog gone |
| u1 Search | sleep 250 | wait `job search` group |
| Settings > Navigation | sleep 300 | wait rail item |
| Job Search, News, Chat dock, VMs | timeouts 5/8/4/6/4 s | 15 s (same wait, same assertion) |
| Help in dialog | sleeps 400/300/100/400/500 | wait help button, popover, focus in popper, popover gone, dialog gone |
Palette steps: unchanged (the app was fixed instead).

## GREEN (after both app fixes)
- `FLOWS_CPU_THROTTLE=4`: 10/10 runs, 21 PASS, 0 FAIL, no console errors.
- Plain: 10/10 runs, 21 PASS, 0 FAIL. (Both loops ran at the same time, plus other lanes, so the load was higher than normal.)
- verify-all (`OUT=/tmp/axion-verify-w42`): ALL 10 STEPS PASSED.
- api-flows (e2e 9292/9293, DB axion_e2e15): 23/23 passed.
- `tsc --noEmit`: clean.

## Item 4 (merge archive-race scripts)
NOT DONE, by the brief's own condition: `c34-archive-race.mjs` is not in this tree (only on `c34-staffing-fresh`). Integrator: when c34 merges, fold its store-subscription check into `c29-archive-race.mjs` (keep the final-state check, add `STOP=archived|paused`) and delete the duplicate.

## Files
`web/scripts/flows.mjs`, `web/src/components/layout/CommandPalette.tsx`, `web/src/components/ui/Modal.tsx`, `web/scripts/c43-modal-focus.mjs`, this report.

## Concerns
- The palette fix changes hover selection to pointer movement; a keyboard-only user is unaffected, a mouse user sees the highlight follow real movement as before.
- The Modal change touches every dialog; verify-all (dialog smoke, ids, focus trap flow) passes.
- The palette race has no separate deterministic script; its check is the flows step under 4x throttle.

## Fix round (controller review PASS, two follow-ups)
1. **Deterministic palette check: `web/scripts/c43-palette-hover.mjs`.** Real mouse, CPU throttle 4x, 6 tries (alternating "hover then type" and "hover racing the typing"): open the palette, `mouse.move` onto row 10 of the long list, `fill('settings navigation')` (4 results), Enter, assert the palette closes (Enter ran a row).
   - RED, only `CommandPalette.tsx` reverted to ac1a48c: `FAIL try 1: Enter did nothing after a hover on row 10 and a shorter result list (palette still open)`, 2/2 runs. Only try 1 fails each time (the others pass on old code), so it is a reliable detector but not a stress test.
   - GREEN, the fix restored: `PASS ... 6/6`, 2 runs.
   - First draft asserted the URL `/settings?tab=navigation`. That failed on the fix too: the hover legitimately highlights the row under the pointer and Enter ran it (it went to the Help row). The assertion is now "Enter runs the highlighted row (the palette closes)", which is what the old code violated. `CommandPalette.tsx` was restored afterwards (`git status` clean for src).
2. **Dividers step:** the two-frame settle is now `until` the splitter has moved from its pre-drag x (the pane beside it resizes with it). Same assertions. Verified flows: 3 runs at 4x and 2 plain, 21 PASS each, 0 FAIL.
