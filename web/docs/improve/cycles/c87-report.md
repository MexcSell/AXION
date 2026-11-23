# Cycle 87 report: in-tenant visibility sweep (private missions)

Lane w85, branch `c87-visibility-sweep`, from `dce8d78` (improve-30h with the c87 brief). Database `axion_test` (one fresh schema per world, as c79); the live `axion` database was never touched, no migrate, demo or audit CLI was run. **Tests only: nothing under `server/src`, `shared`, `web/` or `migrations/` changed. Not in this base:** `server/src/forecasts` (c86) and c81's MR2/MR4 files, so the c86 baseline leak itself cannot be reproduced here; the sweep was built to catch that shape (see V02 below).

## What was built (all under `server/test/tenant/`, new files only)
- `vis-fixture.ts` (item 1): one tenant (`t-1`, the c79 seed, so M gets the full visible c79 baseline), an administrator, member **M** (the viewer) and member **O** (approved before the first snapshot, so the only change between states is the private mission). M has 4 finished tasks of his own on agent `coder-01`, class `coding`, difficulty 3 (2 passed with accepted reviews, 2 failed with rejected reviews): **n = 4, one under the skill floor of 5**, so one hidden outcome would cross it. O's private mission (`shared:false`) holds: an upload, mission text, title and criteria, 3 finished tasks with typed delegation briefs (class and difficulty) and reviews, an open task, 2 approvals, a thread with a message and an attachment, a task ledger, a site grant, three notifications (one owner-only), and in state b2 a failure tag with attribution. about 40 markers (`ZQPRIVnnnQ`) cover every free-text field.
- `vis.ts` (items 2 to 4, 7): the detector. `vis-tables.ts` (item 5): `VISIBILITY_ALLOWED`, `VISIBILITY_FINDINGS`, `classify`. `vis.test.ts`: the suite. `vis-mutants.ts`, `vis-mutants.test.ts` (item 6): the mutants.
- Reused from c79 unchanged: `getCases`/`QUERY`/`PARAM` id resolution, `canon` and its **VOLATILE_KEYS and UNORDERED_KEYS (no new normalisation)**, `freshSessions`, `WRITE_CASES`, `seam.ts`, `openStream`.

## The relations
States, in ONE world (two separately seeded worlds would differ in ids and timestamps and need new normalisations): **a** O exists, the private mission does not; **b1** it exists with GOOD outcomes (passed tasks, accepted reviews, one approval approved); **b2** the outcomes are FLIPPED (the same passed tasks now fail, two more tasks fail with rejected reviews, the waiting approval is denied, a failure tag is added). Deviation from the brief, stated plainly: reviews and approval decisions are append-only, so the flip is done by changing task statuses in place and ADDING the opposite verdicts, not by rewriting old reviews.
- **V1 invariance:** M's response on every swept GET route is identical in a, b1 and b2 (compared a to b1 and b1 to b2). Preceded by a CONTROL pair (a to a, b2 to b2) that must be identical, which proves the c79 normalisation is enough. Every violation records the JSON paths that differ, so a BY-DESIGN entry excuses only the paths it names.
- **V2 marker absence:** none of the markers in any M response (in all four snapshots) or in M's SSE stream. Positive controls: M's own later event arrives on his stream; private markers do reach the administrator's stream (4 events) and O's stream (4 events); O's own responses carry markers on 4 routes.
- **ID:** for the 14 GET cases that take a private id (`/missions/:id` and its 8 sub-routes, `/tasks/:id`, `/tasks/:id/reviews`, `/threads/:id/messages`, `/uploads/:id`, `/agent-instances/:id`, `/failure-tags?subjectId=`) M asks for the private id and for a well-formed nonexistent id of the same shape: same status, same body once the id is masked, no marker. For the 15 write routes a member may call and that take a mission-scoped id (delete, patch, share, actions, staffing retry, briefs, ledgers, threads, thread messages, task actions, reviews, approval decision, failure-tag decision and attribution, notification ack) the same comparison, and the administrator's view of the private mission must be unchanged afterwards. Administrator-only write routes (21) and 4 whose ids are not mission-scoped are listed as skipped in the code.
- **Non-vacuity (item 7):** the administrator's response changes between the states on **22 routes**, including every route the table below talks about; on all 14 private-id GET routes the administrator gets an answer that differs from the ghost id's (`adminSame` is asserted empty); the test also asserts the SSE streams really carry private events. Routes whose administrator response does NOT change (the fixture does not reach them, or they are not about missions) are printed by the test; the notable ones are `GET /company/failure-patterns`, `GET /company/metric-guard`, `GET /policy/baseline`, `GET /operations/queues`: they are swept, but only vacuously for this fixture.

## Route counts
GET routes in the table: **72**. Swept: **71** (76 cases with query variants; each as member, administrator and O, at 4 states = 912 responses). The 72nd, `GET /events/stream`, is excepted from the byte comparison (c79's reason) and has its own V2/SSE relation. 12 of the 71 are administrator-only (M gets 403, still compared and still marker-checked). **Skipped: none** other than that stream. Write routes: 55 registered, 41 with an id, 15 exercised by the ID relation, 21 administrator-only and 4 not mission-scoped skipped, 1 inherited c79 exception (revision counter).

## BY-DESIGN (VISIBILITY_ALLOWED; both approved by the controller)
1. `GET /approvals/quality`, path `quality.n`. A tenant-wide count of decided approvals; the c58 floor nulls every other figure for a member but keeps n. Ruling: `cycles/c58-review.md:83` ("Backlog only: ... n/approverCount visibility below the floor (F3 residue)"), also `c58-review.md:79` and `c58-brief.md:25`. Worded as an accepted residual, not an endorsement. Controller-approved.
2. `GET /review-capacity`, paths `review.total.n` and `review.departments[].n`. Everyone but administrators gets aggregates "with c58's floor"; the count n stays visible. Rulings: `c65-brief.md:32`, `c65-review.md:20` ("n is allowed by the brief"), `server/test/c65-privacy.test.ts:42` (test title "n stays visible"), `c65-report.md:66`.

## FINDINGS (VISIBILITY_FINDINGS; backlog id TBD for each)
1. **`GET /review-capacity`, `review.littles.openNow`: FIXED in this lane (controller ruling, own commit).** It was an ungated tenant-wide count that moved with hidden approvals. `server/src/capacity/model.ts` now returns `openNow`, `avgOpen` and `lambdaTimesW` as null for a member unless the total clears the c58 floor (5 items, 3 people); administrators unchanged; `openNow` is nullable in the DTO and the c50 validator, no allowlist line. RED: `server/test/c87-opennow.test.ts` failed 2 of 3 on the old code (scratchpad `c87-red2.txt`), GREEN after. The entry is removed from VISIBILITY_FINDINGS, so the sweep guards it. **Web:** `web/src/features/ops/ReviewCapacity.tsx:71` prints `open now ${r.littles.openNow}` when avgOpen is null, so a member under the floor would see the text "open now null" (no crash, tsc clean). Not edited; needs a small web fix.
2. **`POST /notifications/:id/ack` (IDW, low, known since c79 concern 3). Fixed by c81 (batch 40), not in this base; the integrator removes the entry at merge. It is marked `fixedBy` so the suite tolerates either outcome (200 here, 404 after the merge).** Answers 200 for any well-formed id, including a private mission's notification, and stores a read marker for the caller without a lookup. A nonexistent id gives the same answer, so it reveals nothing; the id is sequential (`n-8`). Fix: 404 when the notice is missing or not visible.

No marker (V2, SSE, private id) leaked anywhere: **no text leak found.** Every other member-reachable GET route is invariant. In particular the skill cells, scorecard, departments, attention queue, approvals, notifications and instances all stayed identical for M while the administrator's changed.

## Seeded mutants (item 6): 8 of 8 killed (`vis-mutants.test.ts`)
Each runs the whole sweep in a fresh world with a seeded fault on the app's pool or an `onSend` hook (never in src), asserts the fault was applied, asserts its intended route is NOT excused by a table, and needs an UNEXPLAINED violation on that route. The `VISIBLE_SQL` mutants append `or true` inside the predicate (the bind parameters stay used; replacing it with `true` makes pg reject the query, c68-review.md:59).
| Id | Seeded fault | Killed by |
|---|---|---|
| V01 | mission list drops VISIBLE_SQL | V1 `GET /missions` |
| V02 | skill cells count every mission's outcomes, so the n >= 5 floor is crossed with hidden outcomes (the c86 shape) | V1 `GET /agents/:id/skills` |
| V03 | company scorecard loader reads every mission | V1 `GET /company/scorecard` |
| V04 | task lookup by id drops VISIBLE_SQL | ID `GET /tasks/:id` (also `/failure-tags`) |
| V05 | thread lookup by id drops VISIBLE_SQL | ID `GET /threads/:id/messages` |
| V06 | approval list drops VISIBLE_SQL | V1 `GET /approvals` |
| V07 | nested field: `GET /agents/:id` carries a private text at `agent.recent[].events[].detail.items[].text` | V2 `GET /agents/:id` |
| V08 | SSE treats every mission as shared | SSE `GET /events/stream` |
Applied counts per mutant are printed by the test (21 to 89 rewrites; V07 by hook count). 8 hand-picked shapes: the rate shows the suite catches these, not every leak.

## RED and GREEN
- RED (item 5): with both tables emptied the suite fails with "a route in neither table" and 7 unexplained violations (`GET /approvals/quality`, `GET /review-capacity` x4, `POST /notifications/:id/ack`, ...); saved at `/tmp/claude-0/-home-luca-AXION/110db678-84c0-496e-aaa7-b625859aebb5/scratchpad/c87-red1.txt`. GREEN: tables restored, `vis.test.ts` 5 passed.
- RED by mutation: the first mutants run had V06 fail ("its intended route is excused by a table", the regex also matched `/approvals/quality`) and V07 fail (wrong column); both were detector or mutant faults, fixed in the mutant definition, never by loosening a check. A first sweep run died on `GET /audit/verify` 429 (6 a minute per session): the administrator now signs in again before every snapshot and CONTROL compares the member's responses only (the administrator's own sign-ins move the audit chain). A 429 or 5xx throws `DetectorInvalid`, so it can never count as a kill.

## Pass threshold
| Item | Result | Evidence |
|---|---|---|
| 1 Fixture | PASS | above; marker count asserted over 25 |
| 2 MR-V1 | PASS | 71 routes, 3 states, member compared byte for byte after the c79 normalisation (none added) |
| 3 MR-V2 | PASS | all responses and SSE, with positive controls |
| 4 Ids | PASS | 14 GET cases and 15 write routes against ghost ids |
| 5 Classification | PASS | 2 BY-DESIGN with citations, 2 FINDINGS, stale and missing entries fail the suite |
| 6 Mutants | PASS | 8 of 8 |
| 7 Non-vacuity | PASS | 22 routes change for the administrator; limits listed above |
| Full serial vitest | PASS | `heavy.sh npx vitest run --maxWorkers=1 --no-file-parallelism` on the committed tree (tip before this report `6f0db00`): 155 files passed, 1 skipped (pre-existing); **3444 tests passed, 36 skipped, 0 failed**; 716 s, load average 8.00 at the end |
| tsc | PASS | `npx tsc --noEmit -p .` clean in `server` |
| Diff stat | PASS | `git diff dce8d78..HEAD --stat`: `server/test/tenant/vis*.ts` (7 files) plus this report; nothing else |

## Concerns
- The two FINDINGS and the two BY-DESIGN entries need the controller's decision; nothing in `src` was touched.
- The sweep ran 72 GET routes but the fixture does not move four of them for the administrator (listed above): a leak that needs data this fixture lacks (eval datasets, failure patterns above their thresholds, policy baselines) would not show. The SSE check sees only the event kinds the private mission produced.
- State b2 flips outcomes by adding opposite verdicts, not by rewriting old ones (append-only tables).
- The session model that wrote this report differs from the commit trailer the lane rules require (Opus 5.5); the trailer follows LANES.md.
- Run time: `vis.test.ts` about 11 s, `vis-mutants.test.ts` about 80 s (load average 7 to 9 at the time).
