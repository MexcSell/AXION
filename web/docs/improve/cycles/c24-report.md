# Cycle 24 (lane w22) report: the api-mode surfaces at phone width

Branch `c24-mobile-fit`. Files: `web/scripts/api-mobile.mjs` (new), `web/src/theme/touch.css` (new, imported last in `main.tsx`),
`web/src/main.tsx` (one import), screenshots in `web/docs/improve/cycles/c24-shots/`.

## Measurement (api-mobile.mjs, via api-e2e.sh)
Visits every api route and tab, the connect and waiting screens, the chat dock and every dialog reachable by clicking buttons
(help popovers included). Records horizontal overflow, clipped controls, dialogs not fitting the viewport, buttons under 40 px.

| | before | after |
|---|---|---|
| 390x844 states / dialogs measured | 143 / 92 | 150 / 84 |
| 390 FAIL lines | 14 (5 dialogs taller or wider than the screen, 9 clipped controls inside them) | 0 |
| 390 distinct controls under 40 px | 310 | 149 |
| 900x1000 FAIL lines | 0 (108 states / 51 dialogs) | 0 (83 states / 46 dialogs) |
| 900 distinct controls under 40 px | 291 | 109 |
| page horizontal overflow | 0 | 0 |

Note on the 390 "before": the first harness version could not click anything at 390 px (Playwright's scroll-into-view stalls on the
animated page), so it saw only 2 dialogs and reported 3 spurious KPI "clipped" lines. The harness now centres the element and taps
with force, and the 390 "before" was re-measured with that harness on the old CSS (touch.css import removed). The 900 "before" used
the older click path; after the harness fix the 900 run reaches fewer states (83 vs 108), so the 900 numbers are not like for like.

## Changes (all in `touch.css`, gated by max-width media queries; desktop above 900 px is untouched)
- at <=900 px: icon buttons, brand, avatar, tabs, `.btn`, selects, inputs, menu items, segmented buttons, result rows, share chip get min 40 px; nav items 42 px.
- at <=800 px: dialogs are a one-cell grid so the modal fills the screen and its body scrolls inside; header/footer children can shrink; rows and segmented controls wrap inside dialogs; toasts span the screen width.
- at <=440 px: the wordmark is hidden (logo mark stays) so six 40 px top-bar buttons fit 390 px.

## Pass threshold
1. Script + before numbers: PASS (above).
2. 0 horizontal overflow and 0 clipped primary controls at both sizes: PASS (0 FAIL lines at 390 and 900).
   Remaining small targets, with reasons: inline `?` help dots (18 px, sit inside headings and KPI tiles; the popover is also reachable by keyboard; 40 of the 60 listed at 390), the fold handle `tb-toggle` (56x15, a hover strip on the card edge), toggle switches (38x21, their row label is also tappable), `a.vm-agent` chips (32 px), the chat message textarea (24 px high, grows on input), one 34 px icon-only tab. The listing is capped at 60 lines per size.
3. No desktop change: fit-check 1672x941 ALL FIT. At 1366x768 and 1280x760 there are 10 views that need work (`/agents/coder-01?tab=...`, mainOver 13): identical with and without touch.css (diff of the two runs empty), so they exist on the base and are not caused by this cycle. verify-all (demo mode, dev server 7290): grep FAIL gives no lines, every section reached "fs guard OK"; its exit code was not relied on.
4. Screenshots at 390 px before/after: `c24-shots/` (waiting/signed-in overview, overview, Operations > Agents, Add mission dialog).

## Concerns
- The pre-existing 10 fit failures at <=1366 px on agent profile pages are outside this cycle.
- Harness coverage differs between versions (see note); numbers are comparable within the 390 runs only.
- Help dots and switches stay under 40 px by design; enlarging them would change the desktop-identical look.
- Not tested on a real phone or touch emulation beyond Playwright `hasTouch`.
