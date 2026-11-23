# c89 brief: screens for change plans and forecasts (BACKLOG U8)

**Lane:** w87 (`/home/luca/AXION-w87`, branch `c89-plans-forecasts-ui`), from improve-30h at the commit that adds this brief (batches through 42 merged: c85 and c86 are live on the server). Ports 13790–13793. E2E DB **axion_e2e15** (reused; edit the lane `server/.env` after `new-lane.sh`). **Web only (`web/src`, `web/scripts`), plus server test fixtures if a browser script needs seeded data through an existing e2e CLI. No server route change, no migration.**

**This lane touches `web/` and must merge before the 16:00Z web freeze, so it must be done (committed, checks run, report written) by about 12:00Z.** If it isn't ready by then, the controller parks it; nothing half-done merges. Cut scope rather than hand back late: item 2 alone is a valid outcome.

**Sources:**
- BACKLOG U8.
- `cycles/c85-report.md` and `cycles/c86-report.md`, plus their reviews, for what the API returns and what it must not claim.
- The contracts in `shared/contracts/src/org-plan.ts` and `forecasts.ts`.
- `web/src/dialogs/defs/org-proposals.tsx`, `web/src/features/agents/ServerProposals.tsx`, `web/src/features/review/TaskReviews.tsx`, `web/src/dialogs/defs/task-review.tsx`.
- **The owner's UI rules:**
  - every page fits one screen at 1366×768 and 1280×760 (fit-check), and only tab content scrolls;
  - the shared `PageFrame` (TopBoard/FrameBody/BottomBoard), with no hand-made headers or KPI tiles;
  - icon-first, with animation on actions;
  - a `?` help on every number and control, through the help registry;
  - dark and light modes;
  - match the existing look exactly; no new visual language.

**HARD RULE:** never connect to, query or read the live `axion` database in any form, and never use ports 5190/5191. Use your lane ports and `axion_e2e15` only.

## Items (each its own commit)
1. **Change plan in the org proposal view (admin only).** In the existing proposal dialog or panel:
   - a compact "Change plan" section showing:
     - the primary metric (its registry label), direction, margin, minimum n and window;
     - guardrails;
     - the why;
     - the sha (short, with copy);
     - amendments, with "amended after the change" called out plainly;
   - for an applied proposal, the readout:
     - counts per window for each metric;
     - "not enough evidence yet" or "ready for analysis (not computed in this version)";
     - the "another change took effect during the window" flag;
     - any sha mismatch.
   - **Approving a planned proposal must send `planSha`**, so `PLAN_SHA_REQUIRED` no longer blocks the UI.
   - Editing or creating a plan from the UI is optional. If you build it, it is admin-only, metrics come from a picker over the registry (no free text), and the NOT_COUNTABLE metrics are not offered.
   - Words: never "significant", "proved", "worked" or "pre-registered". These are counts only.
2. **Forecast on a task (everyone who can see the task).**
   - Before the task's first review, a small "Your forecast" control: the chance it is accepted at first review, 1–99%. One forecast, never editable afterwards (say so before submitting).
   - After the first review: the person's forecast, the outcome, and their Brier for that task.
   - A "My forecasts" view (a tab or a section in an existing settings or profile area; no new page unless the frame needs it) showing:
     - count, mean Brier, mean log;
     - calibration bins (a bin's rate only from n≥5);
     - skill against the baseline only from 20 forecasts with a baseline, else "not enough evidence (n of 20)";
     - the method text from the API.
   - **No leaderboard,** no other person's scores. An admin may look at one person's scores at a time, if there is an existing per-person admin view; otherwise skip it.
3. **States and errors.**
   - Every API error code these routes can return (409 exists/closed, 404, `PLAN_SHA_REQUIRED`, `PLAN_LOCKED` …) shows a plain message.
   - Loading text sits in role=status.
   - Nothing ever prints `null`, `undefined` or `NaN`.
4. **Browser check script** `web/scripts/api-c89.mjs`, run with `DATA_MODE=api` through `api-e2e.sh`. In it:
   - the admin sees the plan section and approves a planned proposal (planSha sent);
   - a member makes a forecast before review, can't make a second one, and sees their score after review;
   - the "My forecasts" bins and floors are honoured;
   - a member never sees a plan section, and never sees another person's scores.
   Seed through the existing API only.

## Checks before hand-back (through `heavy.sh`, with load printed)
- web tsc and build;
- `api-c89.mjs`;
- verify-all (own OUT dir);
- fit-check demo and api at 1366×768 and 1280×760 (ALL FIT);
- a11y both modes (0 violations);
- api-c64 and api-c20 (org proposals unchanged for plan-less proposals);
- the task-review api script that covers TaskReviews;
- api-mobile full (`DATA_MODE=api`, 0 FAIL);
- screenshots, dark and light, at 1366×768 and 390 px, in `cycles/c89/` (small PNGs).

## Report
`cycles/c89-report.md`. Follow the LANES.md Finishing rule, including the committed-diff check.
