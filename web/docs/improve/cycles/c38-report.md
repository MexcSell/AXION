# c38 report: independent task review, producer != verifier (Phase 2 · Wave 3 · O3)

Lane w36, branch `c38-task-reviews` (from improve-30h 4ff1b40). Migration 0031. Dialog DL-80. E2E DB axion_e2e10.

## What was built
- **Migration 0031 `task_reviews`** (append-only; UPDATE/DELETE trigger and TRUNCATE trigger raise, except a DELETE while `axion.purge_demo = 'on'`).
  Columns as in the brief, plus `seq` (bigserial, orders "later review"), `principal_id` (the mission owner at review time) and `attempt_id`.
  DB CHECKs: `reviewer_id <> producer_id`; `reviewer_id <> principal_id`; accepted needs `jsonb_array_length(evidence) >= 1`; a user reviewer has no model family;
  two agents need BOTH families non-null and different (NULL comparison spelled out, tested with equal, NULL/known and known/NULL).
- **Producer and principal are derived on the server** (`server/src/tasks/reviews.ts`): the producer is the task's owning agent (its instance's PINNED version model, falling back to the active version only when the task has no instance); the principal is the mission owner; the reviewer is the signed-in person. The model family is `modelFamily()` in `review-rules.ts` (leading letters of the model name, so claude-opus and claude-haiku are one family). The body is `.strict()`: a client-sent producer/reviewer/family is 400.
- **Routes** (`server/src/tasks/routes.ts`): `GET /tasks/:id/reviews` (reviews oldest first, `canReview` + reason decided by the server, mission criteria, evidence options, per-reviewer agreement) and `POST /tasks/:id/reviews` (idempotent, 201, visible mission only, shared `proposals` rate-limit bucket, audit `task.review`, event `task.reviewed`). Evidence refs (file, message, url) are validated to belong to the mission; urls must be http(s).
- **Scorecard**: two new rows at the END of the list, nothing existing changed in meaning: `approved_by_non_owner` (approval rule alone: completions with a non-owner human approval before completion, n = completions) and `tasks_verified_by_review` (tasks whose LATEST review as of the window end is accepted, cites evidence and is by someone who is neither producer nor mission owner; placed in the window by that review's time; n = tasks reviewed in the window; unit `tasks`). The mission-level `verified_success_rate` and `completed_unverified` keep their rule; their `?` help now points at the two new rows.
- **Agreement** (`reviewerAgreement`, pure): for each review R, the first later review of the same task by a different reviewer; agreed when verdicts are equal; `rate = agreed/n`; `state 'ok'` only from n >= 5 (MIN_AGREEMENT_N), otherwise "not enough evidence" is shown with n.
- **UI**: the task drawer (DL-13) lists independent reviews (verdict chip, reviewer, family, producer, rubric tally, evidence count, agreement with n) and has a **Review** button with a `?` (`review.who`); it is disabled when the server says no (reason in the tooltip) and the `?` explains why the producer or commissioner cannot review. New dialog **DL-80** `task-review`: verdict, rubric built from the mission's acceptance criteria (free criteria when none), evidence picker (files, messages of the task, https links), Cancel/Escape exits. Two scorecard rows with icons and `?`. 9 new help entries.

## Decision to flag: who is "the producer" for a person
Tasks are owned only by agents and people can only retry/reassign/cancel. So no person is ever the recorded producer. The only human on the producing side is the **mission owner** (the commissioner), matching the old "non-owner" rule. The rule is: the reviewer may be neither the producer agent nor the mission owner; both the route, the DB CHECK (`reviewer_id <> principal_id`) and the UI (`canReview`) enforce it. Written into `review.who` help. If the owner wants owners to be allowed to review, that is a one-line change (remove the principal check and CHECK), but it would reintroduce self-verification.

## RED / GREEN
- RED: `test/task-reviews.test.ts` failed at import (`Failed to resolve import ../src/tasks/reviews.ts`, "no tests") before the service existed; the migration and the pure rules/scorecard tests were written in the same step as their code. The refusal tests assert the error CODE (a bare 403 would already have passed through the old `/tasks/:id/:action` route as ACTION_NOT_ALLOWED).
- GREEN: new tests 41 (`task-review-rules` 17, `task-reviews` 17, `scorecard-reviews` 7); full server suite **622/622** in 40 files, server `tsc` clean, web `tsc` clean.

## Pass threshold (fixed)
| Item | Result | Evidence |
|---|---|---|
| Producer/commissioner reviewing own task: 403 and the DB refuses | PASS | route 403 `REVIEW_NOT_INDEPENDENT`, nothing stored; direct inserts with reviewer = producer / = principal fail the CHECK |
| Same-model-family agent refused | PASS | service 403 `REVIEW_SAME_MODEL_FAMILY` (no HTTP path names an agent reviewer, so it is tested at the service function) and DB CHECK for equal, NULL/known, known/NULL families; control with different families passes; producer family comes from the pinned version |
| Accepted review without evidence: 400 | PASS | 400 VALIDATION `fieldErrors.evidence`; DB CHECK too; a failed criterion cannot be accepted |
| Invisible mission: 404 | PASS | POST and GET 404 `NOT_FOUND`, nothing stored; unknown task 404; anonymous 401 |
| Append-only holds | PASS | UPDATE, DELETE, TRUNCATE and the cascade from `tasks` raise; `clearDemo` still removes demo reviews (test seeds demo, inserts a review, clears, counts) |
| Scorecard verified count exact, with n | PASS | `scorecard-reviews.test.ts` fixture: 9 reviewed rows give value 3, n 8 (latest wins, no evidence / reviewer=producer / reviewer=owner never counted, out-of-window excluded); over HTTP value +1 and n +2 after one accepted and one rejected review; private-mission reviews are not in a non-viewer's numbers |
| Agreement known-answer | PASS | 3 of 4 -> rate 0.75, n 4, state `none`; 4 of 5 -> 0.8, state `ok`; own later reviews skipped; tasks never mix |
| `api-c38.mjs` | PASS 23/23 | A (mission owner) sees Review disabled with code and `?`; B (member) records the review (Escape and Cancel exits tested, accepting without evidence refused), sees the Accepted chip, scorecard row 0/0 -> 1/1 live; A sees the chip, still disabled, and a direct POST is 403 |
| Server tsc + vitest, web tsc | PASS | 622/622; both tsc clean |
| api-flows, api-stage6 | PASS | api-flows 23/23; api-stage6 94/94 on the second run. **The first run was 92/94** (two FAILs: "the server created the next version" and the Versions list after an agent Edit/Save, nothing to do with reviews; machine load average was 11). Rerun alone: 94/94 |
| a11y clean | PASS | demo: 50 views, 57 dialogs, 0 violations; api: 40 views, 57 dialogs, 0 violations |
| Dialog ledger includes the new dialog | PASS | `docs/dialog-ledger.txt`: task-review no-props and props, DL-80, PASS |
| fit-check ALL FIT | PASS | demo ALL FIT; api mode ALL FIT (77 views, the Overview with the 2 extra scorecard rows included) |
| Demo suite | PASS | `verify-all.sh` ALL 10 STEPS PASSED; `grep -c FAIL` on its output = 0 (77 views crawled, 57 dialogs x2) |

NOT MET items: none.

## Screenshots (web/docs/screenshots)
- `improve-c38-review-dialog-dark.png` (DL-80), `improve-c38-task-drawer-dark.png` (Accepted chip, Review action with `?`), `improve-c38-scorecard-dark.png` (the two new rows). More under `/tmp/axion-api-c38-8693/`.

## Files changed
- New: `server/migrations/0031_task_reviews.{up,down}.sql`, `server/src/tasks/reviews.ts`, `server/src/tasks/review-rules.ts`, `shared/contracts/src/reviews.ts`, `server/test/{task-reviews,task-review-rules,scorecard-reviews}.test.ts`, `web/src/api/taskReviews.ts`, `web/src/features/review/TaskReviews.tsx`, `web/src/dialogs/defs/task-review.tsx`, `web/src/theme/pages/task-review.css`, `web/src/help/pages/c38-task-reviews.ts`, `web/scripts/api-c38.mjs`, 3 screenshots.
- Edited: `server/src/tasks/routes.ts` (2 routes), `server/src/company/{scorecard,routes}.ts` (reviews input, 2 rows), `server/src/ratelimit.ts` (1 line), `shared/contracts/src/{company,errors,events,index}.ts` (additive), `web/src/api/events.ts` (task.reviewed), `web/src/dialogs/defs/missions.tsx` (drawer), `web/src/components/layout/CommandCenter.tsx` (2 icons), `web/src/help/registry.ts` (one sentence on `scorecard.verified_success_rate`), `web/docs/dialog-ledger.txt`.
- Existing assertions changed (listed so nothing is silent): `scorecard.test.ts` row-key list now ends with the two new keys; `scorecard-trend.test.ts` line 46 accepts unit `tasks` like `missions` (counts have previous 0, no trend); `security.test.ts` route-table pattern gains `|\/reviews$` and the expected list gains `POST /api/v1/tasks/:id/reviews`.

## Concerns / for the reviewer and merge
1. **Producer for people** (see the decision above): the mission owner cannot review their own mission's tasks. In a one-person company nobody can verify, which is honest but strict.
2. **Merge conflicts, all additive**: `ratelimit.ts` LIMITED_ROUTES, `security.test.ts` regex (keep every other lane's alternation), `errors.ts` (I added one new line, not editing an existing line), `events.ts`, `index.ts`, `web/src/api/events.ts`. **Dialog id DL-80** was chosen without a registry (c33 DL-78, c36 DL-90): check uniqueness at merge. **CSRF list**: `SINCE_STAGE5_WRITES` in security.test.ts was not extended (the route is covered by the global CSRF hook and by api-c38's 403 flow; add it to the list if the integrator wants the per-route CSRF cases).
3. The task state chip for status `passed` still reads **"Verified"** in the existing UI (TASK_STATE label). It now sits next to "Independent review (0)". I did not rename it (many checks match that text); suggest "Passed" in a follow-up so "verified" means reviewed.
4. Scorecard rows on DEMO missions count only with the DEMO switch on (the fixture tasks are `simulated`); a review of a demo task is a real recorded act but is tagged DEMO in the numbers.
5. Reviews on `simulated` tasks are allowed (needed for the browser check on the seeded missions).
6. No HTTP path lets an agent review (agents do not execute). The service and DB support it and are tested; the route intentionally has no `reviewerAgentId` field.
7. Model family = vendor lineage by the leading letters of the model name: `claude-haiku` vs `claude-opus` count as the same family. A model string with no leading letters is "unknown" and never independent.
8. Agreement is computed per reviewer over reviews of missions the viewer can see; two viewers may see different n. The first api-stage6 run flaked under load (above).
9. In the Overview aside the label "Approved by a non-owner" truncates with an ellipsis (full text in the tooltip and the accessible name).
