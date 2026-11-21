# c24 review (independent)

Spec verdict: PASS. Quality verdict: PASS with minor findings.

## Checks
1. Desktop isolation: every rule in web/src/theme/touch.css sits inside @media (max-width: 900px | 800px | 440px) (file lines 4-16, 21-28, 29-33, 34-36, 37). No bare selectors, no :root vars, no global element selectors. main.tsx only gains one import (line +7). No JS/TSX change. Desktop >900 px is unaffected by construction.
2. Dialogs/toasts: all dialog and toast rules are at <=800 px, matching the existing shell.css:175-178 phone dialog block. Focus trap is JS in DialogHost and untouched. Rules are grid/overflow only. The drawer (shell.css:173, width 460) at phone is covered by the harness "fits" check, which reported 0 fails.
3. Harness: api-mobile.mjs:70-ish `process.exit(...FAIL ? 1 : 0)` is honest. FAIL on page overflow, clipped control, dialog outside viewport, dialog body sideways scroll, pageerror. The 390 "before" was re-measured with the same harness on old CSS, so 14 -> 0 is like for like and the fix did not make "after" easier than "before" at 390.
4. Owner rules: icon-first kept (logo mark stays, wordmark hidden at <=440 px; touch.css:16-18). The ? help dots stay reachable (not enlarged; the shot shows ? beside the dialog title; top-bar help-btn is already hidden <=480 px by shell.css:306, pre-existing). Development stage: no new hiding; .demo-tag is already hidden <=800 px (shell.css:214, pre-existing), so a phone-width stage chip is not something c24 can be credited or blamed for.
5. Demo mode: touch.css is global but gated at <=900 px; at desktop identical. verify-all result relies on grep, not exit code.

## Findings
- Important (evidence quality): 900 px before/after is not like for like (108 vs 83 states, 51 vs 46 dialogs, older click path). "291 -> 109 small targets" at 900 is therefore not a valid gain claim. The report says so, but the headline table still prints it. 390 numbers are fine.
- Minor: harness uses `click({force:true})` and swallows click and tab failures, so a covered or unreachable control is clicked anyway or silently skipped. Applies equally before and after; still weakens "fits/tappable" claims. Chat dock "opener not found" is only a NOTE, not a FAIL, so a missing chat dock would pass with exit 0.
- Minor: page overflow is measured with documentElement.scrollWidth only; an inner clipped container would not show. Clipped-control check compensates for controls.
- Minor: report says verify-all exit code "was not relied on"; demo-mode non-regression is therefore grep evidence only.
- Minor: after-_overview-390.png shows only skeleton cards (page not loaded when shot), so it does not demonstrate the overview; the Add mission and Agents shots are the real evidence.
- Minor: touch.css has duplicated media blocks (800 px twice, 900 px twice) and `.brand` set twice; tidy only.
- Remaining sub-40 px targets (help dots, tb-toggle, switches, vm-agent chips, chat textarea) are disclosed and justified.

No Critical findings.
