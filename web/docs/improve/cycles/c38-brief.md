# c38 brief: independent task review, producer ≠ verifier (Phase 2 · Wave 3 · O3)

**Lane:** w36 (from improve-30h). Ports 8690 / 8691 / 8692–8693. E2E DB **axion_e2e10**. Migration **0031**.
**Sources:**
- spec invariant 5: "Every 'verified' item references evidence and a verifier distinct from its producing actor when independent review is required";
- LLM Evaluators Recognize and Favor Their Own Generations, 2404.13076;
- Judging LLM-as-a-Judge, 2306.05685;
- JudgeBench, 2410.12784 (all verified);
- MAST (verification failures are a whole category).

## Hypothesis
"Verified" means little today. The scorecard counts a completion as verified when a non-owner approved one of its approvals (company/scorecard.ts:12), but no record says *who checked what, against which criteria, with what evidence*. A first-class review record makes "verified" auditable:
- the reviewer must differ from the producer;
- an agent reviewer must not share the producer's model family;
- the reviewer's own agreement rate is shown with n, rather than a bare badge.

## Build (test-first)
1. Migration 0031, `task_reviews`:
   - columns: id, tenant_id, mission_id (FK, cascade), task_id, attempt_id?, reviewer_id, reviewer_kind 'user'|'agent', reviewer_model_family?, producer_id, producer_kind, producer_model_family?, rubric jsonb (list of criteria with pass/fail/na and a note each), verdict 'accepted'|'changes_requested'|'rejected', evidence jsonb (refs: artifact ids, message ids, URLs; at least 1 required for 'accepted'), created_at;
   - append-only, with TRUNCATE and DELETE guards and the purge_demo exception;
   - DB CHECK/trigger: reviewer_id ≠ producer_id; and when both are agents, reviewer_model_family ≠ producer_model_family. The model family comes from the agent version's config, so look up where agent versions store their model and derive the family server-side, never from the client.
2. Service and routes:
   - `POST /tasks/:id/reviews`: visible mission only; producer derived server-side from the task's assignee / attempt actor; rate-limited.
   - `GET /tasks/:id/reviews`.
   - Emit `task.reviewed`.
3. Scorecard: "verified" becomes *a task with an accepted review by a reviewer ≠ producer, with evidence*. Keep the old approval-based rule as a separate, clearly labelled row ("approved by a non-owner") so nothing silently changes meaning. Each row shows n and the window.
4. Reviewer agreement: for each reviewer, show how often a later review of the same task by a different reviewer agreed, with n, or "not enough evidence" below 5. Pure function with fixture tests.
5. UI:
   - In the task detail, a "Review" action and dialog: rubric checklist built from the mission's acceptance criteria (where they exist; otherwise free criteria), verdict, evidence picker, and `?` help explaining why the producer can't review.
   - Reviews are listed with their verdict chip.
   - The scorecard shows the new rows.
   - Match the existing look; fit one screen.

## Pass threshold (fixed)
- Tests:
  - a producer reviewing their own task → 403 and the DB refuses;
  - same model family agent → refused;
  - an accepted review without evidence → 400;
  - an invisible mission → 404;
  - append-only holds;
  - the scorecard verified count on a fixture with known reviews is exact, with n.
- Agreement function: known-answer tests (e.g. 3 of 4 agreements → 0.75, n=4 → "not enough evidence" under 5).
- Browser check `web/scripts/api-c38.mjs`: user A completes a task's review flow as non-producer, sees the verdict chip and the scorecard count change. The producer sees the Review action disabled with its `?`.
- Server tsc and vitest green; web tsc; api-flows and api-stage6 pass; a11y clean; dialog ledger includes the new dialog; fit-check ALL FIT.

## Report
`cycles/c38-report.md`.
