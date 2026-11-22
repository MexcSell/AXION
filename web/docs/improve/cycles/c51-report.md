# c51 report: task-review hardening and required delegation briefs (O3a + O2a)

Lane w50, branch c51-review-hardening, from improve-30h at b06554e. Migration 0039. E2E DB axion_e2e16.

## What was built
1. **Owner history (migration 0039).** `task_owner_history` is append-only (UPDATE/DELETE/TRUNCATE refused, `axion.purge_demo` exception for DELETE only, same function pattern as 0007/0031/0034). Triggers on `tasks` (after insert, after update of owner_agent / owner_instance_id) write one row per owner change, raw SQL included. Backfill from reassign audit rows, delegations and the current owners. `reviews.ts` reads the history, fail-closed: a task with an owner but no history row refuses every review (403 REVIEW_NOT_INDEPENDENT, "The owner history of this task is missing ..."), in the POST and in GET `canReview`. The old audit and delegation sources are still unioned in, but can only add names.
2. **Freshness.** `STALE_BEFORE_SQL` (in `reviews.ts`): a review is stale when the task has a later attempt than the one it was written against, or the latest attempt started (DB time) after the review was created. GET returns `stale: {beforeAttempt}` per review and `verified`; the scorecard row "Tasks verified by review" ignores a stale latest review (no fallback to older ones). UI shows a "stale (before attempt N)" chip.
3. **Vendor matching.** o-series is `o1`/`o3`/`o4` followed by `-`, `_`, `:` or the end. A path prefix or dotted provider part that names a vendor must agree with the model, otherwise null (`anthropic/gpt-4`, `anthropic.gpt-4`). Routers (openrouter, azure, bedrock, vertex...) are still ignored. Alias table: openai, anthropic, google, meta, meta-llama, mistral, mistralai, cohere, amazon, microsoft, alibaba, qwen, deepseek, deepseek-ai, xai, x-ai.
4. **O2a.** `POST /tasks/:id/reassign` without a brief (missing or null) is 400 `BRIEF_REQUIRED` (new code in shared contracts), checked after visibility (404 first) and before the state machine (409) and target (422). The reassign dialog in api mode disables Submit until at least one acceptance criterion exists and always sends a brief.
5. No locks added. No new event types.

## Callers checked (grep of `/reassign` and the dialog)
- UI: `web/src/dialogs/defs/missions.tsx` (only caller of `taskAction(..., 'reassign')`).
- Scripts: api-stage6 (2 places), api-c06, api-improve (2 places) now send a brief. api-c42 already did.
- Server tests: tasks, c09-minors, departments-route, agent-reliability, delegation-brief now send a brief (`BRIEF` const). One assertion in delegation-brief.test.ts was INVERTED, because it asserted the c42 legacy behaviour the brief explicitly closes: "reassign without a brief still works (legacy)" is now "is 400 BRIEF_REQUIRED" (also checks the owner is unchanged and no brief row exists). instances.test.ts: its test-only wipe of `tasks` now also disables the new history guard trigger for that statement, like it already does for mission_delegations. No other assertion was changed or loosened.

## api-stage6 diff (only the brief added)
```
@@ reassign dialog step
     await A.p.getByPlaceholder(/needs browser specialist/).fill('stage 6 e2e reassign');
+    await A.p.getByLabel('Acceptance criteria').fill('The reassigned task result is attached'); // c51: the hand-off brief is required
     await A.p.getByRole('button', { name: 'Submit Reassignment' }).click();
@@ running-task step
-    const r = await apiA('POST', `/tasks/${running.id}/reassign`, { toInstanceId: other.instanceId }, { 'idempotency-key': key() });
+    const r = await apiA('POST', `/tasks/${running.id}/reassign`, { toInstanceId: other.instanceId, brief: { goal: 'Take over the task', acceptance: ['The result is attached'], capabilities: [{ kind: 'read' }], escalation: 'Ask the mission owner when unsure' } }, { 'idempotency-key': key() });
```
No assertion changed.

## RED / GREEN
- RED: new file `server/test/c51-review-hardening.test.ts` run before any implementation: 41 failed, 37 passed (78 tests; the 37 are pure-function controls and cases the old code already satisfied).
- GREEN after implementation: 78/78.
- Full vitest after fixing the callers: 64 files, 2040 tests, all pass (first full run had 8 failures, all callers of reassign without a brief plus the instances.test wipe, fixed as listed above).
- tsc: server and web clean.

## Pass threshold
- Owner-history tests: PASS. Trigger records insert, owner_agent change, owner_instance_id change, 3-owner chain, route reassign and raw SQL; no row for unrelated updates or the same owner. UPDATE/DELETE/TRUNCATE refused; a task delete outside the demo purge is refused; clearDemo still works and leaves no orphan history. A task with an owner and no history row (trigger disabled in the test) refuses POST (403) and GET canReview. A prior owner cannot verify after the reassign audit rows are deleted and the delegation rows are purged through the `axion.purge_demo` path.
- Freshness tests: PASS. fail, retry, pass with only the old accepted review leaves the scorecard value unchanged (not verified); a fresh review verifies it; GET shows `stale: {beforeAttempt: 2}` and `verified` false/true; stale review hides behind a newer rejected one; DB-time case with a future-started attempt.
- Vendor tests: PASS. `o1-mini` and `o3` openai; `o10x`, `bo1` null; `anthropic/gpt-4` null; plus 9 positive, 11 negative o-series cases, 10 contradictory-prefix nulls and 12 consistent-prefix cases.
- O2a: PASS. No brief: 400 BRIEF_REQUIRED, owner unchanged, no audit row. api-stage6 94/94 (diff above). api-c42 16/16.
- At least 30 new server tests: PASS, 78 (74 of them in the new file's pure and DB groups, plus the adjusted delegation-brief test).
- Full vitest 2040/2040, tsc, verify-all ALL 10 STEPS PASSED: PASS. api-c38 23/23, api-c42 16/16, api-c06 25/25: PASS. api-improve (touched, two request bodies) was NOT run: NOT MET for that script.

## Files changed
Server: `migrations/0039_task_owner_history.{up,down}.sql`, `src/tasks/reviews.ts`, `src/tasks/review-rules.ts`, `src/tasks/routes.ts`, `src/company/routes.ts`, `src/company/scorecard.ts`; tests `c51-review-hardening.test.ts` (new), `tasks`, `c09-minors`, `departments-route`, `agent-reliability`, `delegation-brief`, `instances`. Shared: `contracts/src/reviews.ts`, `contracts/src/errors.ts`. Web: `src/dialogs/defs/missions.tsx`, `src/features/review/TaskReviews.tsx`, `src/help/pages/c42-delegation.ts`, `scripts/api-stage6.mjs`, `api-c06.mjs`, `api-improve.mjs`.

## Concerns
- **o2 and o5-o9 stay unknown.** The brief says `o[1-9]`, but the frozen existing assertion `o2` has no family says otherwise, and the table lists only o1/o3/o4. I kept the table and the old assertion and only tightened the match; widening is one line plus a deliberate edit of that assertion.
- Making the brief required means a non-owner member (who cannot write root briefs, c42 I4) can no longer reassign at all; before they could without a brief. Only admins and the mission owner can reassign now.
- Freshness is evaluated against the task's current attempts, not as of the scorecard window end, like the existing "task is still passed" rule. A retry attempt has `started_at` null, so staleness there rests on the attempt number; the DB-time comparison applies when an attempt has a start.
- The history trigger also records `on delete set null` of an instance (owner_instance_id becomes null) as a "change" row with the same agent. Harmless.
- Backfill cannot know owners that left no audit or delegation trace; those tasks only get their current owner (the same blind spot as before, now closed for the future).
- api-improve.mjs was edited but not run in this lane.
