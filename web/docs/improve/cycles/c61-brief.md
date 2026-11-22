# c61 brief: evaluation instrument records (R2-2, R2-3, R2-1)

**Lane:** w60 (`/home/luca/AXION-w60`, branch `c61-eval-instruments`). **Branched from `c53-eval-integrity` at 2d23cca** (c53 is cleared and queued as batch 15 but not merged yet, and you build on its tables). Ports 11090–11093. E2E DB **axion_e2e13** (reused). Migration **0046**.
**Docs:** this brief, the research files and the Wave 5 standing rules are on improve-30h, not on your base. Read them **read-only** from `/home/luca/AXION/web/docs/improve/`: this brief, `PHASE2.md` (Wave 5 standing rules, Wave 6), `phase2/research-r2.md` §R2-1–R2-3, and `phase2/research-r2-verified.md` (required changes). Read LANES.md and the c47/c53 cycle files from your own worktree.
**Boundary:** records, validation and arithmetic only. No eval-run write route, no execution, no model calls. Judges exist today only as family labels (c53), so R2-1 is **scaffolding** until judges are used, and the report must say so.

## Items (each test-first, each its own commit; order R2-2 → R2-3 → R2-1)
1. **R2-2, instrument audit record.** Extend the existing `eval_runs` columns (`evaluator_id`, `k`) with episodes attempted, episodes graded, ungraded episodes with a reason code, and grader name and version.
   - Define a **re-grade diff** record first: which run, which grader versions, and per-case old and new grades. Then a verdict refuses to compare two runs whose grader versions differ unless a re-grade diff links them.
   - Show the graded fraction beside every pass rate in the verdict output, and in the proposal card if it already shows a pass rate.
   - An ungraded episode never counts as a failure: a fixture with 50% ungraded must become inconclusive, never "worse".
   - "Cost from root spans only" is a fixture-only test, because usage isn't recorded until Stage 9.
   - The evidence is a single-author preprint (A6). Say the checks are cheap and the evidence is only the motive.
2. **R2-3, dataset attestation.** Before a dataset is frozen as a holdout, an owner or admin completes an ABC-style attestation (A3: task validity, outcome validity, reporting). Every item gets a stored answer, or "not applicable" with a reason.
   - **The attestor must not be the dataset's author.**
   - The attestation is stored with the content hash; changing an answer creates a new attestation version bound to the hash.
   - Unattested datasets can still be used, but their verdicts carry a visible "unvalidated" flag. A freeze without an attestation is flagged in 100% of tests.
   - **Deferred:** the per-run "disallowed source reachable" flag. It needs execution.
3. **R2-1, judge calibration scaffold.**
   - **First open A1** (the URL is in research-r2.md) and read its estimator formulas; the verifier read only the abstract. Name the estimator in the code and the report, and state its scope: binary judge verdicts, mapped to AXION's paired pass/fail cases.
   - Add a store for human calibration labels per (judge family, dataset), **disjoint from the test set** (enforced).
   - A pure function estimates judge sensitivity and specificity and reports a bias-corrected interval for the pass rate.
   - The verdict is inconclusive without enough calibration data, or when the interval spans the margin. It always shows raw and corrected side by side.
   - Property test with a **seeded RNG**: simulated judges of known error over 1,000 datasets at a nominal 95%. Report the measured coverage and its standard error; the target is at least 93%. If the target isn't met, report NOT MET honestly and don't tune the test to pass.
4. **Contracts:** registry, DTO and validator entries for every new field or route. No allowlist lines.

## Pass threshold
- Items 1–4 RED → GREEN. Every c47 and c53 test passes unchanged, or is tightened with a stated reason.
- Full vitest (the connection-cap family, BACKLOG H14, can be re-run serially; name every failure). tsc.
- api-c47, api-c05 and api-stage6 pass. a11y clean if the UI changed.

## Report
`cycles/c61-report.md` in your worktree. Follow LANES.md's Finishing rule: start the final checks early, record PIDs, and hand back exactly once.
