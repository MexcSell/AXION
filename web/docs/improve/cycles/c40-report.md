# c40 report: mobile layout debt (lane w38, branch c40-mobile-debt)

## Result
api-mobile.mjs (api mode, 653 states, 360 dialogs): **0 FAIL**, exit 0. Threshold: PASS on every item (details below).

## Important note on how the harness is run
`scripts/api-mobile.mjs` measures the real 651-state surface only with `DATA_MODE=api`
(`api-e2e.sh "DATA_MODE=api node scripts/api-mobile.mjs"`). The brief's literal form `api-e2e.sh api-mobile.mjs` leaves DATA_MODE unset,
so the script runs in demo mode (346 states, no Activity cards, no DL-75) and shows only one FAIL on the base tree. I recorded RED
and GREEN in both forms. The real gate is the api-mode form.

## RED (base 4ff1b40, api mode, 651 states, 37 FAIL lines)
Log kept at /tmp/w38-red-final.log (not committed). Families:
1. Help popovers outside the viewport (dialog id null): 390 Company scorecard (top -295), AXION server, Development stage, Reliability (top -667), Mentoring plan, Start a plan, Propose a change, Roll back, Version proposals, Mission agents views; 900 Company scorecard (bottom 1235), Reliability, Mentoring plan, Roll back, Version proposals. 16 lines.
2. Activity: act-card x=27..445 at 390 (M-134), icon-btn.xs "Chat with X" at x=392..457 (/missions tab=Activity and /missions/M-134). 9 lines.
3. DL-75 "Propose a change to Analyst-01" at 900: 1040 px wide, outside viewport; Close, Help: Evaluation, textarea, input, Submit clipped. 6 lines.
4. Conversations tab at 390: seg-btn "Assignment -> report" x=300..393, help-btn Reply/Command x=374..392 (not in the brief). 4 lines.
5. "Dismiss notification" clipped at x=365..405 / 868..908 (toast exit animation): 3 lines (harness artefact).
Also reproduced directly with the new probe `api-c40.mjs` on base: act-card 27..445, icon 416, help popovers outside at 390/900 and at 1280 (a desktop popover taller than the screen: bottom 842 > 760), DL-75 24..1064 at 900.

## Fixes
- Activity cards (`theme/pages/mission-activity.css`): grid track `minmax(min(250px,100%),1fr)`, `.act-card{min-width:0}`, the narrow-width 1-column rule uses `minmax(0,1fr)`. Cards 336 px wide at 390; at 900 and 1280 the positions are identical to before.
- Help popovers (`components/ui/HelpTrigger.tsx`, `theme/base.css`): the body sits in `.help-pop-body` (scrolls), `.help-pop` is a flex column capped at Radix's `--radix-popover-content-available-height`. Header, close button and arrow stay put. Popovers that already fit are unchanged. Fixes the 1280 case too.
- DL-75 and every wide dialog (`theme/shell.css`): `.modal-layer` gets `grid-template-columns:minmax(0,1fr)` so `max-width:100%` resolves against the screen (the auto track had grown to the 1040 px content). 900 px: dialog 852 wide inside the 24 px padding; 1280: still 1040 px, centred (120..1160), same as before.
- Conversations (`theme/touch.css`, <=800 px only): `.thread-head` and the composer mode row wrap.
- Toast (harness item 4): `Toasts.tsx` marks a leaving toast `data-exiting="true"` (via `useIsPresent`, moved into a `ToastCard` component; visuals identical). The harness skips only elements inside `[data-exiting="true"]`. The check moved verbatim into `scripts/_mobile-measure.mjs` (imported by api-mobile.mjs, nothing else loosened). `scripts/selftest-mobile.mjs` proves: a static control clipped by 10 px still FAILs (right and left), a fitting one is clean, `data-exiting="true"` is skipped, `data-exiting="false"` is not. 5/5 PASS.
- Toast at rest fits: `.toast-stack` is `left:12px;right:12px` at <=800 px (c24); the api-mobile run measures every at-rest toast and reports none clipped.

## GREEN (HEAD of c40-mobile-debt)
| Check | Result |
|---|---|
| `tsc --noEmit` (web) | clean |
| selftest-mobile.mjs | 5/5 PASS |
| api-mobile.mjs, DATA_MODE=api | states 653, dialogs 360, `NO FAILURES`, 0 FAIL, exit 0 |
| brief form `api-e2e.sh api-mobile.mjs api-flows.mjs api-stage6.mjs` | api-mobile 346 states NO FAILURES; api-flows 23/23 passed; api-stage6 94/94 passed |
| api-c40.mjs probe (390/900/1280) | NO FAILURES (RED on base: 15 FAIL lines) |
| verify-all (demo, dev 8890, OUT=/tmp/axion-verify-w38) | ALL 10 STEPS PASSED, 0 FAIL |
| fit-check 1672x941 / 1366x768 / 1280x760 | ALL FIT each, 0 FAIL |
| a11y-check (demo) | 50 views, 56 dialogs, 0 violations |

An intermediate full run (before the composer-row fix) had 2 FAIL (help-btn Reply/Command, x=374..392, 1 px past 391); fixed and re-run clean. Dev server on 8890 stopped by port.

## Pass threshold
- api-mobile 0 FAIL, exit 0: **PASS** (653 states, api mode).
- Harness change with selftest (static 10 px clipping still FAILs): **PASS**.
- Desktop fit ALL FIT at three sizes: **PASS**. verify-all 10/10: **PASS**. a11y 0 violations: **PASS**.
- Desktop screenshots unchanged: **PASS** by measurement (activity, DL-75 at 1280 identical geometry; the only desktop change is a help popover that was taller than the screen now scrolls). I did not pixel-diff all pages.

## Screenshots (c40-shots/)
before-/after- `activity`, `help`, `dl75` at 390 and 900 (help = the first failing popover on /overview; at 390 the "before" popover starts at y=-294). Taken with api-c40.mjs on base and on HEAD.

## Files changed
web/src/theme/{mission-activity,base,shell,touch}.css, web/src/components/ui/{HelpTrigger,Toasts}.tsx, web/scripts/{api-mobile,_mobile-measure,selftest-mobile,api-c40}.mjs, this report and c40-shots/.

## Concerns
- The brief's verify command lacks DATA_MODE=api for api-mobile (see above); the integrator should run the api form for the real gate.
- Not in the brief, fixed anyway: Conversations header/composer overflow at 390.
- Polish not covered by the harness: at 390 the Activity KPI strip (5 tiles) is cramped (tiles squeeze to icons and wrapped numbers, see after-activity-390.png). It passes the check but is not reference-exact; a follow-up cycle should lay it out as a 2-column grid under 800 px.
- `.modal-layer` grid change is global (all dialogs); it only changes behaviour when a dialog is wider than the screen.
