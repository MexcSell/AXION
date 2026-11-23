# c89 report: screens for change plans and forecasts (BACKLOG U8)

Lane w87, branch `c89-plans-forecasts-ui`, from 44db33b. Web only (`web/src`, `web/scripts`, this report). No server route change, no migration, no server test fixture.

## What was built
**Item 1, change plan on org proposals (administrators only).**
- `features/agents/PlanSection.tsx`, shown inside each pending or applied proposal card. The server's `GET .../plan` is admin-only, so members never request it and never see the section.
- Shows the primary metric (registry label from `METRIC_BY_ID`), direction, margin, minimum n, window days, guardrails, the why, the short sha with a copy button (check-mark animation), and a "locked at approval" chip.
- Amendments are listed with reason, author, time, changed fields and a plain "amended after the change" chip; counts stay on the locked plan and the card says so.
- Applied proposals get the readout: pre and post window dates, counts per window for each metric as `pre 0 / 3` with a tick when the minimum is reached, the server's verdict text ("not enough evidence yet" or "ready for analysis (not computed in this version)"), the "another change took effect during the window" flag and a sha-mismatch warning.
- **Approve sends `planSha`**: the card reads the plan, and Approve stays disabled until the plan is read ("Reading the change plan"); a plan-less proposal sends no `planSha`. `PLAN_SHA_REQUIRED` can no longer block the UI.
- Not built (optional in the brief): creating or editing a plan from the UI.

**Item 2, forecasts.**
- Task drawer (`features/review/TaskForecast.tsx`): "Your forecast" with a 1 to 99 slider and number input, the sentence that a forecast is final shown before submitting, then the locked forecast; after the first review the outcome chip, Brier and log loss for that task. Open, void, late and "no forecast before the first review" states are worded.
- Settings > Forecasts (`features/settings/MyForecasts.tsx`, new tab in the existing Settings): KpiBoard tiles (count with resolved/open/void/late, mean Brier, mean log loss, skill), calibration bins (rate and mean forecast only from n of 5, else "not enough forecasts to show a rate (n of 5)"), per-class means (from 5), the forecast list, and the method text from the API. Skill below 20 with a baseline reads the API's "not enough evidence (n of 20)" and shows no number.
- Admin per-person view: a "Forecasts of NAME" icon on each approved user in Settings > Users opens dialog DL-101 for that one person (`GET /users/:id/forecasts`). No list of people, no ordering by score, no other person's scores anywhere else.
- Demo mode shows an empty state ("stored on the server").

**Item 3, states and errors.** `lib/plainError.ts` maps every code these routes can give (409 `CONFLICT` with `fieldErrors.forecast` exists or closed, 404, 403, `PLAN_SHA_REQUIRED`, `PLAN_LOCKED`, `PLAN_NOT_APPLIED`, `PLAN_MISSING`, `PROPOSAL_CHANGED`, network, 429, 5xx, validation) to a plain sentence; unknown codes use the server message only if it is clean, else a generic one. `fixed()` and `percent()` print `n/a` instead of null, undefined or NaN. Loading text is in `LiveStatus` (role=status), load failures in role=alert with Retry. Help keys: 33 new entries in `help/pages/c89-plans-forecasts.ts` (a `?` on every number and control). Words "significant", "proved", "worked", "pre-registered" are not used in any new text (the api-c89 script asserts this on the plan section and readout).

## Reused patterns
Panel, KpiBoard, Chip, HelpTrigger, Segmented, EmptyState, LiveStatus, Modal, IconButton, the `oa-*` and `rv-*` classes, the settings tab frame (TopBoard tabs, FrameBody). New CSS is one small file (`c89-plans-forecasts.css`), tokens only, so dark and light follow.

## Browser check `web/scripts/api-c89.mjs` (api mode, through `api-e2e.sh`)
Seeded through the existing API only. Three users: Luca (admin), Omar (second admin, approves), Mia (member). It checks:
- the plan section values; a decision with `planSha` removed in flight shows the plain message; the real approval request carries `planSha` equal to the card's sha; the readout and "not enough evidence yet"; an amendment shown as made after the change and the counts still on the locked plan; a member sees no plan section and gets 403 from the server;
- Mia records 80% (UI), the form disappears, a second API forecast is 409 `exists`, a stale form in another tab gets the plain refusal, she reviews and the drawer shows the outcome and Brier 0.040;
- My forecasts matches the API (count, mean Brier, mean log loss), every bin honours the floor of 5 (a bin with 6 forecasts shows its rate, the others do not), skill reads "not enough evidence (0 of 20)", the method text is the API's, every number has a `?`, the tab fits one screen;
- there is no route listing forecasters (404), Luca's ledger and page have none of Mia's data, a member gets 403 on another person's forecasts and has no per-person button, an administrator opens exactly one person's record;
- no page text prints null, undefined or NaN.

## Checks (all from the committed tree; load averages as printed by the chain scripts)
| Check | Result | Load (1/5/15 min) |
|---|---|---|
| web tsc (`tsc --noEmit -p .`) and `vite build` | PASS | n/a (no gate) |
| `api-c89.mjs`, final run after the last code commit 6c7eb47 | PASS, all checks, no page errors | 4.39 5.74 6.65 |
| verify-all (OUT=/tmp/axion-verify-w87) | PASS, all 10 steps | 5.43 5.64 5.20 |
| fit-check demo 1366x768, 1280x760 | PASS, ALL FIT (both) | 5.76 7.13 7.15; 4.80 6.18 6.78 |
| fit-check api 1366x768, 1280x760 (includes Settings > Forecasts) | PASS, ALL FIT (both) | 8.53 7.68 6.19; 8.92 8.84 7.00 |
| a11y demo / api | PASS, 0 violations (55 views, 66 dialogs / 45 views, 66 dialogs) | 5.85 5.95 6.57 / see log |
| api-c64, api-c20 (org proposals, plan-less) | PASS, exit 0, no FAIL line | 8.82 7.62 6.11 / 8.99 7.67 6.13 |
| api-c38 (the TaskReviews script) | PASS, exit 0 | 8.45 7.60 6.13 |
| api-mobile full (390 and 900, DATA_MODE=api) | PASS, "NO FAILURES" (small tap targets listed only, mostly existing 18px help buttons) | 7.52 8.21 7.43 |

Note on timing: verify-all, fit, a11y, c64/c20/c38 and api-mobile ran on 08:11Z to 09:50Z on tree up to 6c7eb47 minus the verdict-wrap CSS fix, except api-mobile and the api fit/a11y runs, which started after it (the fix is a CSS/markup change inside the admin plan readout only; api-c89 was re-run on the final tree). The only later commit is the generated dialog ledger (DL-101 lines).

Screenshots (small PNGs, dark and light, 1366x768 and 390): `c89/plan-{dark,light}-{1366,390}.png` (applied proposal with plan, amendment and readout), `c89/forecasts-{dark,light}-{1366,390}.png` (Settings > Forecasts), `c89/forecast-form-dark-1366.png`, `c89/forecast-result-dark-1366.png` (task drawer).


## Files changed
See `git diff 44db33b..HEAD --stat`: `web/src/api/{forecasts.ts,orgProposals.ts,taskReviews.ts}`, `web/src/lib/plainError.ts`, `web/src/features/agents/{PlanSection.tsx,ServerProposals.tsx}`, `web/src/features/review/TaskForecast.tsx`, `web/src/features/settings/{MyForecasts.tsx,UsersSettings.tsx}`, `web/src/dialogs/defs/{user-forecasts.tsx,missions.tsx}`, `web/src/pages/Settings.tsx`, `web/src/config/nav.ts`, `web/src/help/pages/c89-plans-forecasts.ts`, `web/src/theme/pages/c89-plans-forecasts.css`, `web/scripts/{api-c89.mjs,a11y-check.mjs}`, this report and `c89/` screenshots. No `server/` or `shared/` file.

## Concerns
- The proposal cards gain one line ("No change plan recorded") for administrators on plan-less pending or applied proposals, and an N+1 plan read (one `GET .../plan` per pending or applied card, re-read on every org event). Fine at today's list size; a list-level flag on `OrgProposalDto` would avoid it (server change, out of scope).
- Plan create and amend UI is not built; plans are set through the API for now.
- The demo seed has 18 reviewable tasks for a member, so the n of 5 bin rate was exercised; skill from 20 with a baseline was not reachable with seeded data (the floor text was checked, and the server tests cover the number).
- Settings gained a tab, so `a11y-check.mjs` lists it; fit-check reads tabs from `nav.ts` and covers it automatically.
