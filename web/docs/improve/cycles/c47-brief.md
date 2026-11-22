# c47 brief: evaluation evidence on agent version proposals (E1b)

**Lane:** w46, branched from improve-30h at 09dd6cb (batches 7, 8 and 8b merged; c32 eval model in). Ports 9690 (dev), 9691 (preview) and 9692–9693 (e2e). E2E DB **axion_e2e2**. Migration **0037**, only if needed.
**Source:** BACKLOG E1b, plus the c32 review minors:
- verdict-v2 trusts a caller-supplied `observedSha256`;
- runs aren't tied to the holdout dataset;
- the DB doesn't check `content_sha256` against the cases;
- a dataset can be frozen with zero cases;
- freezing isn't serialised against case inserts.

Today `agents/versions.ts` returns `evaluation: null` on every proposal.

## Hypothesis
A version proposal can carry honest evaluation evidence computed only from stored rows:
- the base version's runs and the candidate's runs on the same frozen **holdout** dataset;
- a hash recomputed from the stored cases;
- `verdictV2` producing `verified_better`, `inconclusive` or `worse` with its refusal reasons.

No caller-supplied number can make a candidate look better. Nothing runs an evaluation: runs and results are records, written in tests and fixtures only.

## Build (test-first)
1. **Subject of a run.** A candidate isn't an `agent_versions` row until it is promoted, so let a run name either a version or a proposal.
   - For example, migration 0037 adds `subject_proposal_id` with a CHECK that exactly one of the two subjects is set.
   - Keep append-only and the tenant triggers.
   - Make freeze safe: freezing locks the dataset row, refuses zero cases, and stores the hash computed in the same transaction from the stored cases with `hashDataset`. A trigger, or a check in a SECURITY-INVOKER function the app must call, verifies the hash matches.
   - Refuse an INSERT of an already-frozen dataset.
2. **Pure loader plus verdict.** For a proposal, load the base runs (subject = base version) and the candidate runs (subject = proposal) on holdout datasets, pair them by case, and compute `observedSha256` from the stored cases, never from input.
   - Self-judging and evaluator = author come from the stored rows (judge family and author).
   - Feed everything to `verdictV2`.
3. **DTO.** `evaluation` becomes `{ outcome, n, wins, losses, delta, ci, passHatK, refusals[], datasetId, datasetSha }`, or null when there are no runs.
   - In the UI (Agents › Development, proposal card), show the outcome chip, n and the refusal reasons, with a `?` explaining "measured on a frozen holdout; inconclusive is not a loss".
   - DEMO mode shows a labelled sample.
4. **Promotion gate (evidence, not automation).** Promote stays a manual admin decision.
   - If the outcome is not `verified_better`, promote requires an explicit `overrideReason` (≥ 10 characters), which is audited and shown on the proposal.
   - If the outcome is `worse`, promote is refused (409 `EVAL_WORSE`).
   - Nothing promotes automatically.
   - The api-stage6 / api-c05 promote steps must keep working; they have no runs, so the override path applies. Update only what's needed, in new scripts or with a fixed `overrideReason`, and never loosen assertions.

## Pass threshold (fixed)
- A caller can't influence the verdict. A test sends a fake hash or fake scores in the request and the result doesn't change.
- A run on a dev dataset, an unfrozen dataset, a mismatched hash, a zero-case freeze or self-judging gives `inconclusive` with the matching refusal (one test each).
- Promote without `verified_better` and without an override gives 409. With an override, it promotes and the audit row holds the reason. `worse` gives 409 even with an override.
- A frozen dataset's hash always equals `hashDataset(stored cases)`. A test tampers with a case through raw SQL and gets refused.
- ≥ 30 new server tests. Full vitest, tsc and verify-all 10/10 must pass. A new `web/scripts/api-c47.mjs` covers the chip, the refusal list, the override field, `?` and the 1366×768 fit.
- Dialog ids, if a new dialog is needed: DL-100..DL-101.

## Report
`cycles/c47-report.md`.
