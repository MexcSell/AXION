# Cycle 3 fix round: scoped re-review (fad7ac3..46c1c45, read-only, nothing run)

## Verdicts
- I1 ADDRESSED: 3b is NOT MET in the report table (c03-report.md:185), D9 (:96), the supplementary step label (api-improve.mjs:10, :348, :414), the caption (:227) and the Fix round (:274). No "fallback" wording is left (grep). The threshold is unchanged and the seam is labelled supplementary.
- I2 ADDRESSED: reliability.ts classification loop. `taken` is a per-task Set (each earlier owner charged "reassigned away" once, also across A to B to C). The final owner is judged only on attempts after the last handover (`own`, `since`). A failed task handed over in state failed with no own attempt gives "inherited" (not counted). A to B to A charges A once as reassigned away (the `taken.has(owner)` skip).
- m2 ADDRESSED: `else if (own === 0) x.noAttempt++` is outside n, and the sentence says "passed with no recorded attempt of its own (not counted)".
- m4 ADDRESSED: SQL `greatest(ev.at, att.at, v.created_at)`, where `ev` is the last stateChanged into the current status.
- m10 ADDRESSED: Reliability.tsx shows "—", `data-reliability="unknown"` and "not measured: the server sent no reliability" for a missing field.
- m3 ADDRESSED: help text (overview-org-agent.ts:83-85) covers the attribution rule, "exactly one own attempt", every "not counted" case, and the finish time being a lower bound.
- m7 ADDRESSED by claim and by the diff's test list: multiple reassignments (unit A to B to C and A to B to A; route Coder-01 to GM to Tester-01), a member with includeSimulated and a private DEMO mission, and exact per-user values. I read the test descriptions, not the bodies, and did not run them.

## Privacy and double counting in the changed query
- No privacy regression. `vis` (tenant, deleted_at, VISIBLE_SQL, the simulated toggle) is byte-for-byte the same. `ev`, `att` and `moved` still key off `subject_id/task_id in (select id from vis)`. The only additions are `x.detail->>'from'` (the task status at the handover) and the `at` and `id` ordering, and both are scoped to `moved`'s existing filters.
- No double counting. The Set is per task, so one task never charges the same agent twice. Across several reassignments each earlier owner is charged once and the final owner only for its own outcome. Total charges per task are at most the number of distinct owners, and each owner gets exactly one.

## New findings (none Critical or Important)
- Minor N1: the own-attempt test uses `coalesce(started_at, finished_at) > handover` (reliability.ts SQL `att`), but the comment and help say "started or finished after". An attempt that started before the handover and finished after it is not the new owner's. If a task is handed over while running and the new owner finishes it, the result is "passed with no own attempt (not counted)" or, if failed, a failure charged to the new owner anyway (state is 'running', not 'failed'). That is conservative-ish and disclosed by the sentence, but the comment should say "started".
- Minor N2: the strict `>` compares the audit `at` (transaction `now()`) with attempt starts. Equal timestamps are not own. A reassign and an attempt insert never share a transaction in tasks/routes.ts, so this is theoretical.
- Minor N3: a handover row with `state` null (older audit rows) counts a failed task as `failed` for the receiver. That is the old behaviour for legacy rows only, and tiny.

## DEMO passes dropped with includeSimulated=1
Acceptable, but with a caveat. Not a regression in honesty: the sentence says "N passed with no recorded attempt of its own (not counted)", the default (real tasks only) is unaffected, and nothing is invented.
- Caveat 1: it is asymmetric. A DEMO task with `failed` and no attempts and no handover is still counted as `failed` (`else x.failed++`), while a DEMO pass is dropped. With includeSimulated=1 the DEMO value is therefore biased downward (pessimistic).
- Caveat 2: this rests on a future runner recording one attempt per real task. If it doesn't, every real pass will be dropped.
- Recommend: leave as is, and queue an owner question: either also drop `failed` with no attempt, or treat attempt-less fixture tasks as one attempt.
