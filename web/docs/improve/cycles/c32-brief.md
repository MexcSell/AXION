# c32 brief: evaluation data model and honest verdicts (Phase 2 · Wave 1 · E1)

**Lane:** w30 (ports 8090 / 8091 / 8092–8093, DB axion_e2e30). Migration **0027**.
**Sources (verified):** τ-bench pass^k 2406.12045; Adding Error Bars to Evals 2411.00640; AI Agents That Matter 2407.01502 (cost with accuracy, holdouts); SWE-Bench+ 2410.06992 (leakage, weak tests); LLM judges prefer their own output 2404.13076.

## Hypothesis
`server/src/evolution/verdict.ts` (c13) says "verified better" on a mean margin over ≥ 5 paired cases. With few cases that is often noise. If the verdict needs a significance test, has an explicit **inconclusive** outcome, reports pass^k reliability and cost, and evaluates on frozen, hashed datasets with a holdout split, then a "win" means something.

## Build (test-first)
1. Migration 0027: `eval_datasets` (id, tenant, name, version, content_sha256, frozen_at, split 'dev'|'holdout'), `eval_cases` (dataset, case_id, input jsonb, expected jsonb), `eval_runs` (dataset, subject version id, k, started/finished), `eval_results` (run, case_id, attempt 1..k, score 0..100 or null, cost_units, trace jsonb with a schema check). Append-only triggers on results; a frozen dataset's cases can't change.
2. `verdict.ts` v2 as a new policy version (keep v1 working and its tests green):
   - paired **sign test** (exact binomial, two-sided) on non-tied cases plus a bootstrap or t-based 95 % CI on the mean difference (seeded, deterministic);
   - outcome ∈ `verified_better | not_better | inconclusive`; `inconclusive` whenever p ≥ α or n is below the minimum, with reasons;
   - **pass^k**: for each version, the share of cases passing in all k attempts (τ-bench), reported alongside pass@1;
   - cost: mean cost per case for both, and "better but costlier by X %" is stated, never hidden;
   - holdout: a verdict must name the holdout dataset; it refuses when the holdout's `content_sha256` doesn't match the frozen value, or when the same dataset was used to tune (dev) and judge;
   - judge independence: refuse when `judgeModelFamily` equals the candidate's model family (2404.13076), reason `self_judging`.
3. Pure functions in `evolution/stats.ts` with exact known-answer tests (e.g. sign test n=10, 9 wins → p = 0.0215; n=5, 5 wins → p = 0.0625).
4. No route that runs an evaluation (no execution without the owner). Read-only `GET /evaluations/:id` if useful.

## Pass threshold (fixed)
- Known-answer tests for the sign test and CI match to 4 decimal places.
- A fixture where v1 says "verified" but the result isn't significant: v2 says `inconclusive` (test).
- pass^k computed for k = 1..4 on a fixture with known values.
- Hash mismatch, dev/holdout reuse and self-judging are each refused with their reason (tests).
- Existing c13 verdict tests unchanged and green; server tsc clean; full vitest green.

## Report
`cycles/c32-report.md`.
