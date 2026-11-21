# Cycle 19 report: mentoring plans, recorded and honest (theme C)

Lane w17, worktree `/home/luca/AXION-w17`, branch `c19-mentoring-plans`, built on cycle 5 (`7a27cc5`). Brief: `c19-brief.md`.

## What I built
**Server**
- Migration **0023** `mentoring_plans` + `mentoring_milestones` (down drops both and their guard functions).
  - Plan: id `MP-`+128 bits, mentee, mentor (`check mentor <> mentee`), skill, `reeval_on` date, status active|completed|cancelled, closed_by/at, note. Unique partial index: one active plan per agent.
  - Milestone: seq 1-5, text, done_by/done_at (both set or both null).
  - Triggers keep it append-only: no delete or truncate on either table; a closed plan never changes; a plan can only be closed (identity columns frozen); a milestone's text never changes, it is ticked once, and only while its plan is active.
- `server/src/agents/mentoring.ts`:
  - `GET /mentoring`, `GET /agents/:id/mentoring` (any signed-in user, newest first).
  - `POST /agents/:id/mentoring` (admin, Idempotency-Key): the mentor must be another active agent of the tenant (422 with `fieldErrors.mentorId`); skill non-empty, 1-5 milestones, `reevalOn` a real date not in the past (422); unknown body fields refused (no invented numbers); 409 `MENTORING_ACTIVE` when the agent already has an active plan.
  - `POST /mentoring/:pid/milestones/:mid/done` (admin; 409 `MILESTONE_DONE` or `PLAN_CLOSED`).
  - `POST /mentoring/:pid/close {outcome, note}` (admin; closing twice is 409 `PLAN_CLOSED`).
  - Audit: `mentoring.plan|milestone|close` (refusals on an existing plan are audited as `denied` and commit). Events `mentoring.planned|milestoneDone|closed`, audience all, subjectKind agent, subject = mentee.
  - DTO `evaluation` is always `null`; there is no score or gain field.
- Contracts: `MentoringPlanDto`, three error codes, three event types.

**Web (api mode; demo unchanged)**
- `api/mentoring.ts` (reads re-run on `mentoring.*` events and on reconnect), `features/agents/Mentoring.tsx`, dialog DL-77 `dialogs/defs/agent-mentoring.tsx`, help entries `help/pages/c19-mentoring.ts` (a `?` on every control).
- Agent Profile › Mentoring (api mode): active plan with milestones (tick button for admins, who/when shown), "N of M milestones done" (a count, no %), re-evaluation date and "Needs evaluation data: agents don't execute yet", Complete / Cancel plan with note, History panel, "Start a plan" (disabled while a plan is active; members see "Read only").
- Agents › Development (api mode): a Mentoring plans panel under Version proposals.

## RED / GREEN
- RED: with the route registration commented out, `test/mentoring.test.ts` gave 13 failed / 13. (I wrote the code before the first run, then removed the registration to produce the RED run; one early test bug, the nonexistent agent id `qa-01`, was fixed before GREEN.)
- GREEN: server `npx vitest run`: 26 files, **358 tests** (345 + 13 new), all pass. `tsc` clean (server and web).

## Threshold
1. Server: PASS. Migration 0023; the routes; admin-only writes with Idempotency-Key on create; the mentor-is-mentee 422; close twice 409; member 403 (create, tick, close); another tenant 404 (reads, tick, close, create) and another tenant's agent refused as mentor; audit and events asserted; migration down/up/up on a populated schema asserted.
2. Web: PASS. `web/scripts/api-c19.mjs` 30/30 (create via dialog, tick, close, live in a 2nd browser (B) and a member browser (C), member read only, no horizontal overflow at 1600px, no % or "gain" on the card, `?` triggers present in the dialog). Run as `E2E_API_PORT=6792 E2E_WEB_PORT=6793 heavy.sh ./scripts/api-e2e.sh api-c19.mjs`.
3. Suite: PASS. verify-all on the lane dev server (build, crawls, flows, auth, u1, dialog smoke 56 dialogs, dialog ids, help keys, fs guard) exited 0. The cycle 5 browser check `api-c05.mjs` still passes 31/31.

## Files
`server/migrations/0023_mentoring_plans.{up,down}.sql`, `server/src/agents/mentoring.ts`, `server/src/app.ts`, `server/test/mentoring.test.ts`, `shared/contracts/src/{agents,errors,events}.ts`, `web/src/api/{mentoring,events}.ts`, `web/src/features/agents/{Mentoring,VersionProposals}.tsx`, `web/src/dialogs/defs/agent-mentoring.tsx`, `web/src/help/pages/c19-mentoring.ts`, `web/src/pages/AgentProfile.tsx`, `web/scripts/api-c19.mjs`.
Screenshots (not committed, in `/tmp/axion-api-c19-6793/`): `improve-c19-dialog.png`, `improve-c19-profile-dark.png`, `improve-c19-development-dark.png`, `improve-c19-history-dark.png`.

## Concerns
- The Development KPI tiles ("Learning 9", "Evolving 4") and the other sub-tab counts are still DEMO fixture numbers in api mode (cycle 5 left them); not touched here. The Development tab badge counts only pending version proposals, not active plans.
- The Agent Profile header's demo `growth` chips and the Mentor button's `mentoring-session` dialog (demo) are unchanged.
- One active plan per agent is my design choice (the brief does not say); it is enforced by a unique index.
- Migration 0023 leaves a gap (0016-0022 belong to other lanes); the migration runner applies by version, so it is fine once they merge.
- `verify-all.sh` writes to the shared `/tmp/axion-verify` by default, so concurrent lanes can overwrite each other's logs.

## Fix round (review c19-review.md)
- **I2:** `git rm --cached server/node_modules` (link kept on disk); `git ls-tree -r --name-only HEAD | grep node_modules` prints nothing after the commit.
- **I1:** in api mode the Agents KPI tiles are now server facts: Learning = agents with an active mentoring plan ("active mentoring plans"), Evolving = agents with a pending version proposal ("pending version proposals"); the Development tab badge = pending proposals + active plans. Demo mode unchanged (`web/src/pages/Agents.tsx`).
- **Minors:** the retired-mentor test restores the agent in try/finally. Closed plans already refuse ticks (409 PLAN_CLOSED, plus a database trigger) and there is no route to add milestones after creation, so nothing more was needed.
- Verification: server suite 358/358 (`--maxWorkers=2`), server and web tsc clean, api-c19.mjs 30/30.
