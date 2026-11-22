# c47 report: evaluation evidence on agent version proposals (E1b)

Lane w46, branch `c47-eval-evidence`. Nothing runs an evaluation and no model is called: runs and results are records written by tests and fixtures only. Nothing promotes automatically.

## What was built
- **Migration 0037.**
  - `eval_runs.subject_version_id` is now nullable and `subject_proposal_id` is new, with a CHECK that exactly one is set. The run guard checks the proposal's tenant, and the immutability tuple now includes the new columns.
  - New columns: `eval_runs.judge_model_family` and `evaluator_id` (so self-judging and evaluator = author come from stored rows), and `agent_version_proposals.override_reason`.
  - Freeze safety:
    - SQL `eval_canon` and `eval_dataset_sha` recompute the hash from the stored cases in the same canonical form as `hashDataset`.
    - `eval_freeze_dataset(id)` locks the dataset row, hashes and freezes in one statement.
    - The dataset trigger refuses a freeze whose hash differs from the stored cases, a zero-case freeze, and an INSERT of an already-frozen dataset.
    - A case insert takes the dataset row FOR SHARE, so freeze and case inserts are serialised (tested with two connections).
  - Down migration restores the 0027 guards.
- **`server/src/evolution/proposal-evidence.ts`.**
  - It loads the latest finished candidate run (holdout preferred) and the base's latest finished run on the same dataset. It recomputes `observedSha256` from stored cases, takes the judge and evaluator from the run row and the author from the proposal row, and calls `verdictV2`.
  - Two loader-level refusals were added: `empty_dataset` and `partial_coverage` (a run that skips cases or attempts).
  - Outcome mapping: `worse` = significantly worse. `not_better` with a significant but too-small gain is shown as `inconclusive` (the reasons say why). Any refusal forces `inconclusive`.
- **DTO** `evaluation` is `{outcome, n, wins, losses, ties, k, delta, ci, baselineMean, candidateMean, passHatK, refusals[], reasons[], notes[], datasetId, datasetSha, baseRunId, candidateRunId}` or null. `overrideReason` is also on the proposal.
- **Promote gate** (after the existing checks, so AGENT_CHANGED, SELF_APPROVAL and the rest keep their order):
  - `worse` gives 409 `EVAL_WORSE`.
  - Not `verified_better` (including no evaluation) requires `overrideReason` of at least 10 trimmed characters, else 409 `EVAL_OVERRIDE_REQUIRED`.
  - Both refusals are audited as denied.
  - An override is stored on the proposal and in the audit row, together with the evaluation seen.
  - Request bodies stay `.strict()`, so fake hashes, scores or outcomes get 400.
- **UI** (Agents › Development, proposal card):
  - an outcome chip with n, wins/losses, mean gain with its 95% interval, and pass^1;
  - the refusal list;
  - a `?` (agent.version.evaluation: "measured on a frozen holdout; inconclusive is not a loss");
  - an override field with a counter and its own `?`, shown only when not verified better, and Promote disabled for a worse candidate;
  - the override reason shown on a promoted proposal.
  - DEMO mode shows a labelled "Sample" evaluation in the Evolving lane.

## Evidence
- RED: `eval-evidence-db.test.ts` was written first and run before the migration existed: 16 failed, 2 passed, 9 skipped (hash, freeze, serialisation, subject, tamper tests). Honest note: the loader and gate were written before `eval-evidence.test.ts`, so that file has no separate RED run (its GREEN run is below).
- GREEN: `eval-evidence-db.test.ts` has 27 tests and `eval-evidence.test.ts` has 39, 66 new in all. Full vitest: 51 files, 1502 tests, all pass. Server tsc and web tsc are clean.
- Browser:
  - `api-c47.mjs`: 24/24.
  - `api-c05.mjs`: 31/31 and `api-stage6.mjs`: 94/94, after one added line in c05 (it fills a fixed override reason before the first Promote click). No assertion was changed.
  - verify-all (demo suite, own OUT dir): ALL 10 STEPS PASSED, including dialog smoke 116 checks, 0 failures.

## Pass threshold
| Item | Status | Evidence |
|---|---|---|
| A caller cannot influence the verdict | PASS | "a caller cannot influence the verdict": fake `observedSha256`, `scores`, `evaluation` and `frozenSha256` on a decision give 400. Fake hash/outcome on create gives 400. Spoofed query parameters on GET leave the evaluation identical. There is no route that writes runs. |
| Dev dataset, unfrozen, mismatched hash, zero-case, self-judging each give inconclusive with the matching refusal | PASS | One test each: `not_holdout`, `not_frozen`, `hash_mismatch`, `empty_dataset`, `self_judging`. Extras: missing judge, evaluator = author, missing evaluator, unpaired, partial coverage, unequal attempts, dev/holdout reuse. A zero-case freeze is also refused by the DB. |
| Promote without verified_better and without override gives 409; with an override it promotes and the audit row holds the reason; worse gives 409 even with an override | PASS | The "promotion gate" tests, plus api-c47 (UI and API, audit row read from the DB). |
| A frozen hash equals `hashDataset(stored cases)`; tampering is refused | PASS | The DB test compares SQL and JS hashes over six value shapes (unicode, control characters, decimals, nesting). A false-hash freeze is refused. With the guard trigger disabled (as a superuser could), a tampered case gives `hash_mismatch`. |
| At least 30 new server tests; full vitest, tsc and verify-all 10/10 | PASS | 66 new tests; 1502/1502; tsc clean; verify-all 10/10. |
| `api-c47.mjs`: chip, refusal list, override field, `?`, 1366x768 fit | PASS | 24/24, including a fit of 0 px page scroll and 0 px side scroll at 1366x768. |
| Dialog ids DL-100..101 | N/A | No new dialog. |

Screenshots: `web/docs/improve/cycles/c47-screens/c47-development-1366x768.png` and `c47-decided-1366x768.png`.

## Files changed
- Migration: `server/migrations/0037_eval_evidence.{up,down}.sql`.
- Server: `server/src/evolution/proposal-evidence.ts` (new) and `server/src/agents/versions.ts`.
- Contracts: `shared/contracts/src/agents.ts` and `shared/contracts/src/errors.ts`.
- Tests: `server/test/eval-evidence-db.test.ts`, `eval-evidence.test.ts` and `eval-fixtures.ts` (new); `eval-model.test.ts` and `version-proposals.test.ts` (edited).
- Web:
  - `web/src/features/agents/VersionProposals.tsx`
  - `web/src/api/versionProposals.ts`
  - `web/src/pages/Agents.tsx` (demo sample)
  - `web/src/help/pages/c05-agent-versions.ts`
  - `web/scripts/api-c47.mjs` (new)
  - `web/scripts/api-c05.mjs` (one line)
  - screenshots.

## Concerns
- `eval-model.test.ts` freezes with made-up hashes (`'a'.repeat(64)`) in three places. The DB now refuses that by design, so those lines call `eval_freeze_dataset` instead. The assertions still check the same things. `version-proposals.test.ts` `decide()` now sends a fixed `overrideReason` on promote (the gate is new behaviour); nothing else was changed.
- The SQL canonical form fails closed: a value that SQL and JS would render differently (for example an exponent-form number, or astral and BMP characters sorting differently) makes a freeze refuse instead of storing a hash the loader would flag.
- The evaluation is computed at read and at decide time and is not part of the proposal `sha`. New runs between review and promote can change what the gate sees. The audit row records the outcome the gate saw.
- Advisory-lock note from the controller: this lane adds no `pg_advisory*` calls (freeze and case serialisation use row locks, `FOR UPDATE` and `FOR SHARE`). `eval-evidence.test.ts` uses `AG = 'knowledge-01'` because `version-proposals.test.ts` deliberately holds coder-01's database-global advisory lock, and parallel files timed out on it (500, "lock timeout"). The integrator is making those keys schema-scoped. The only edit to `version-proposals.test.ts` is the `decide` helper.
- On a 1366x768 screen the page does not scroll, but the proposal list scrolls inside its panel when there are several cards.
- Judge family and evaluator are recorded by whoever writes the run. No route exists to write runs yet (E1c).
