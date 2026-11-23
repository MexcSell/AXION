# c89 review: VERDICT CLEAR (no blockers, no majors; 5 minors)

Checked on final tree d25e231: fit-check demo 1366x768 and 1280x760 ALL FIT; a11y demo 55 views, 66 dialogs, 0 violations; vite on port 14650 stopped. I did not run api-c89 (load; its static reading is below). Web only: confirmed (no server/shared change); DL-101 ledger edit legitimate.

Privacy: no leaderboard path. Plan GET only requested when admin (ServerProposals.tsx:75). api/forecasts.ts has only /me and one /users/:id read. Per-person icon only for approved users, opens one dialog, no scores in the users table (UsersSettings.tsx:258). Admin could click through users one by one; acceptable, inherent to DL-101.
Wording: no banned words in new text. Floors honoured (bin 5, class 5, skill from sk.text). Readout says "Counts only".
Correctness: Approve disabled until plan loads (planWait), planSha from loaded plan, only on approve. Double submit guarded (busy + same idempotency key). Final stated before submit. Whole-percent wire.

## Findings
1. minor: Number box clamps while typing. TaskForecast.tsx:84 `set`: clearing the field gives Number('')=0 which becomes 1, so editing "45" by deleting jumps to 1. Fix: keep a string draft, clamp on blur/submit, disable submit when empty/out of range.
2. minor: Default 70% prefilled, one click records a final forecast (TaskForecast.tsx:16). Anchors people and allows an unconsidered final submit. Fix: start unset and require a first touch, or a confirm step.
3. minor: Help permission text is wrong. help/pages/c89-plans-forecasts.ts forecast.control says "Only you see your forecast and its score" but an admin can read one person's record (forecasts.user says so). Fix: reword.
4. minor: Plan load error uses raw message (api/orgProposals.ts useRead, `e.message`), not plainError, so a 403/5xx may show server text in the PlanSection banner (PlanSection.tsx:56). Fix: use plainError.
5. minor: Hardcoded 5 in UI text (MyForecasts.tsx "of 5", "from 5") instead of CALIBRATION_MIN_N and FORECAST_CLASS_MIN_N; unused help key forecasts.tab. Fix: import the contract constants.

Performance (item 5): N+1 is acceptable. Admin only, GET per pending/applied card, re-read on every org event (useRead has no cache or batching, refetch on each tick for every card). Fine at tens of cards; suggest a list-level hasPlan flag or batched endpoint, or fetching applied plans only when a card is expanded, if lists grow.

UI rules: PageFrame tab (Settings > Forecasts, KpiBoard) not hand-made; ? on all numbers and controls; icons and motion consistent; tokens only, dark and light. Screenshots match the existing look. Note plan screenshot verdict text repeats the counts shown below (verbose but wraps, fit OK).

api-c89.mjs: fair and strong (planSha equal to card sha, tampered-request plain error, member 403, bin floor per bin, API-vs-UI numbers, 404 for forecaster list, single-person dialog, NaN scan). Gaps: skill at 20+ and "ready for analysis" state never exercised.
