# Cycle 2 (theme B, company performance): an honest company scorecard from recorded events

## Hypothesis
In api mode the company's performance numbers are invented. Overview shows "Mission Success 96.4% (+2.1%)" and
"Tokens Today 1.84M". The Missions list header shows "96.4% success". Nothing behind them is measured. After this cycle
the company's performance comes from one server scorecard computed only from recorded data. Each row shows its value,
its sample size n, its time window and a sentence naming the evidence. When there is no evidence the row says so and
shows no number. Pattern: subnet-scout `analytics.py` (state 'none' when nothing measured; "validated" means checked by
someone other than the author). Spec: §16 "cost per *verified* successful outcome"; §11 invariant 9 ("All metrics show
actual observation window and sample size; unknown values remain unknown").

## Measure and pass threshold (fixed now; never lowered)
1. Server: the tests below pass; the whole suite stays green.
2. In api mode no company-level performance number on Overview or in the Missions list header is a hard-coded constant.
   The token tile is removed in api mode (tokens aren't recorded until Stage 9; the owner already removed a token total).
   A browser check asserts:
   - a fresh database shows "not enough evidence" (no %);
   - after the script drives missions to terminal states through the API, the success row shows the value the server
     computed, with its n;
   - demo missions are excluded by default.
3. `verify-all.sh` (demo mode) stays green, and demo mode keeps today's numbers.

## Server
- **New module `server/src/company/`.** A pure function computes the scorecard from rows, plus a route.
  - `GET /api/v1/company/scorecard?window=30d|7d|90d&includeDemo=0|1`, default `30d`, demo excluded. Any signed-in user
    may call it, but it counts **only missions the caller can see** (reuse `VISIBLE_SQL`), so it never leaks private
    missions.
  - The response: `{window, from, to, includeDemo, rows: Row[]}`.
  - Each `Row` is `{key, label, value: number|null, unit, n, evidence: string, state: 'ok'|'none'}`. Use `state:'none'`
    and `value:null` when n is too small.
- **Rows.** Each is computed only from the `missions`, `mission_runs`, `tasks`, `task_attempts`, `approval_decisions` and
  `events` tables. Mission state history comes from `events` of type `mission.stateChanged` with its payload.
  - `started`: missions whose first run started in the window.
  - `finished`: missions that reached completed, failed or canceled in the window.
  - `verified_success_rate`: verified completions ÷ finished.
    - A completion is *verified* only if the mission has at least one approval decision by a human other than the
      mission owner, or every task is `passed` and at least one `verifies` delegation exists.
    - The other completions count as "completed, unverified". The evidence sentence names both counts, e.g.
      "3 of 7 finished missions verified · 2 completed unverified".
    - Value null when finished < 3.
  - `completed_unverified`: count.
  - `median_cycle_time_h`: first run start → terminal state, over finished missions. Null when n < 3.
  - `failure_rate`: (failed + canceled) ÷ finished. Null when finished < 3.
  - `task_recovery_rate`: tasks with more than one attempt that ended `passed`, ÷ tasks with more than one attempt.
    Null when n < 3.
  - `waiting_approval_median_h`: median time spent in `waiting_approval` (from events). Null when n < 3.
- **Event:** none needed. The client refetches on `mission.stateChanged` and `task.stateChanged` events, debounced.
- **Tests (write first):**
  - pure-function tests for each row, including the n-thresholds giving null, and window boundaries;
  - verified vs unverified;
  - demo excluded unless `includeDemo=1`;
  - a member never counts a private mission they can't see;
  - another tenant's missions never count;
  - an admin sees all.

## Web
- **Overview, api mode:**
  - the "Mission Success" tile shows `verified_success_rate` with its n as a hint, or "not enough evidence" with the
    evidence sentence in its tooltip or help;
  - no fake `delta`;
  - the "Tokens Today" tile is removed in api mode.
  - A "Company scorecard" panel lists all rows with value or "—", n, window and evidence, plus a 7d/30d/90d switch and
    an "include DEMO missions" switch (off by default; when on, the panel shows a DEMO tag).
  - The panel goes where it fits without breaking the Overview one-screen rule; `node scripts/ov-fit.mjs` must stay
    NO SCROLL. Put it in the existing CompanyHealth aside if needed.
- **Missions list header, api mode:** the "96.4% succe…" text shows the verified success rate with its n, or nothing
  when there isn't enough evidence.
- **Demo mode unchanged.**
- **Help:** add `?` entries for the scorecard and each row, explaining what counts as verified and why numbers can be
  empty.
- **Browser check** (`web/scripts/api-improve.mjs`, extend it):
  - a fresh database shows "not enough evidence";
  - drive at least 3 missions to terminal states through the API (complete is system-only; use whatever the existing
    e2e or test seam allows, or seed through the API `e2e-serve` fixture path; document how);
  - assert the tile and the panel show the server's numbers and n;
  - the include-DEMO switch adds the DEMO tag.

## Constraints
- **Never touch the live system:**
  - don't run anything against the real `axion` database or the API on 127.0.0.1:5191;
  - never restart 5190;
  - no `npm run dev`, `migrate` or `demo:*` in server/.
- **Database:** no new migration unless needed; if needed, it is 0014 (0013 is cycle 1's).
- **Keep the safeguards:** don't loosen auth, visibility, append-only, the execution guard or any test.
- **Owner UI rules:** icon-first, animated, `?` help, the shared PageFrame, the Overview one-screen fit.
- **Verify:**
  - `cd server && npx tsc --noEmit -p . && npx vitest run`
  - `cd web && npx tsc --noEmit -p . && ./scripts/api-e2e.sh api-auth-flow.mjs api-flows.mjs api-stage6.mjs api-improve.mjs && ./scripts/verify-all.sh && node scripts/ov-fit.mjs`
- **Commit** on `improve-30h` with only your files. End the message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
