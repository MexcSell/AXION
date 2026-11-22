# c32 report: evaluation data model and honest verdicts (lane w30, migration 0027)

Branch `c32-eval-model` (from improve-30h 4ff1b40). Records and pure functions only: no route or job runs an evaluation.

## RED / GREEN
- RED: the three new test files written first; `npx vitest run test/stats.test.ts test/verdict-v2.test.ts test/eval-model.test.ts` gave "3 failed (3) files, 9 skipped" (modules and tables missing).
- GREEN: stats 15/15, verdict-v2 18/18, eval-model 9/9. Full server suite: 40 files, 625 tests passed (c13 `verdict.test.ts` unchanged). `tsc --noEmit` clean (server and web).
- One earlier full run showed 3 transient failures (agents PATCH/rollback timeouts in agents.test.ts and version-proposals.test.ts, 4-5 s) under machine load; the rerun after my last edit was fully green. Those tests don't touch the new code.

## Design
- `server/src/evolution/stats.ts`: exact two-sided binomial sign test (BigInt sum, no float overflow), Student t CDF/quantile by incomplete beta + bisection (exact to 1e-12), paired t 95 % CI, pass^k estimator C(c,k)/C(m,k) (equals the share passing all k when k=m), mulberry32 seeded PRNG and a seeded percentile bootstrap (available; the verdict uses the t interval).
- `server/src/evolution/verdict-v2.ts`: new `EVALUATION_POLICY_V2` (alpha 0.05, minCases 10, margin 5, tieBand 0.5, passScore 70) and `verdictV2`. v1 and `EVALUATION_POLICIES` are untouched (v2 has its own constant so v1's "unknown version falls back to latest" behaviour does not change).
  - outcome: `verified_better` needs n >= 10, p < 0.05, wins > losses, mean gain >= margin, and 95 % CI above 0. `not_better`: significantly worse, or significant but under the margin. Otherwise `inconclusive` with reasons.
  - refusals (outcome inconclusive, `refusals[]` with code): `holdout_missing`, `not_holdout`, `not_frozen`, `hash_mismatch`, `dev_holdout_reuse`, `self_judging`, `evaluator_is_author`, `unequal_attempts`, `unpaired_cases`, `bad_scores`.
  - reports pass@1 and pass^k (k = 1..attempts), mean cost per case for both and "better but costlier by X%" in `notes`.
  - a failed attempt (score null) counts as 0 and as not passing. `hashDataset` = sha256 of canonical JSON of cases sorted by id.
- `server/migrations/0027_eval_model.{up,down}.sql`: `eval_datasets`, `eval_cases`, `eval_runs`, `eval_results`. Freezing needs a sha256 and is one-way; a frozen dataset and its cases cannot be changed or deleted; a run needs a frozen dataset of the same tenant; `finished_at` can be set once and nothing else about a run changes; results check attempt <= k, case in the dataset, run not finished, score 0..100 or null, trace must be an object with a `steps` array; results append-only (existing `instances_append_only`, which allows only the demo purge cascade).
- No `GET /evaluations/:id` (not needed; nothing to show yet).

## Threshold
| Item | Result |
|---|---|
| Known-answer sign test and CI match to 4 dp | PASS. n=10, 9 wins: p=0.0215 (2*11/1024); n=5, 5 wins: 0.0625; 8/2: 0.1094; 7/3: 0.3438; ties excluded. t(0.975): df1 12.7062, df4 2.7764, df9 2.2622, df29 2.0452, df120 1.9799. CI of [1..5]: 3 (1.0368, 4.9632) |
| Fixture v1 "verified" but not significant -> v2 inconclusive | PASS. 12 cases, 7 wins of +20 and 5 losses of -3: v1 verified=true; v2 p=0.774, inconclusive, "not significant". Also 5 straight wins: v1 verified, v2 inconclusive (needs 10) |
| pass^k for k=1..4 on a known fixture | PASS. attempts passing 4/4, 2/4, 0/4 give [0.5, 0.3889, 0.3333, 0.3333] |
| Hash mismatch, dev/holdout reuse, self-judging refused with reason | PASS (`hash_mismatch`, `dev_holdout_reuse`, `self_judging`; plus missing/not-holdout/not-frozen) |
| c13 verdict tests unchanged and green; tsc clean; full vitest green | PASS. 625/625, verdict.test.ts and verdict.ts untouched |

## Verification
- Migration up -> down -> up: PASS inside a populated test schema (`eval-model.test.ts`, on axion_test).
- Browser check: `E2E_API_PORT=8092 E2E_WEB_PORT=8093 heavy.sh ./scripts/api-e2e.sh api-improve.mjs` -> `107/107 passed`, no page errors, 0 FAIL. It ran against `axion_e2e4`, a retired lane's e2e DB that the controller pointed this lane at, because `axion_e2e30` could not be created (the `axion` role has no CREATEDB). No web code changed.

## Files changed
- new: server/src/evolution/stats.ts, server/src/evolution/verdict-v2.ts, server/migrations/0027_eval_model.up.sql, server/migrations/0027_eval_model.down.sql, server/test/stats.test.ts, server/test/verdict-v2.test.ts, server/test/eval-model.test.ts, this report.

## Fix round (after review CLEAR)
RED first: 4 new tests failed (zero-case freeze, truncate x4 tables, cross-tenant run, tQuantile975(Infinity)).
- TRUNCATE guards (statement-level, `instances_append_only`) added on `eval_datasets` and `eval_cases` (`eval_runs` and `eval_results` already had them); test truncates all four with cascade and expects refusal.
- Freezing a dataset with zero cases is refused (`eval_datasets_guard`).
- `eval_runs` insert checks the subject version's agent belongs to the run's tenant (join agent_versions -> agent_definitions; cheap).
- Tests now assert `unpaired_cases` (candidate missing a case) and `bad_scores` (score 150, negative cost) with their codes; the verdict code already behaved correctly.
- `tQuantile975(Infinity)` returns 1.959964.
- Migration 0027 edited in place (unmerged, reserved to this lane). v1 untouched.
- Result: server tsc clean; full vitest 40 files, 630 tests passed.
- Left to the wiring follow-up: checking `content_sha256` against the stored cases, and binding `observedSha256` / run -> dataset inside the verdict input.

## Concerns
- (Accepted by the controller.) Policy numbers not fixed by the brief and chosen by me: minCases 10 (a two-sided sign test cannot reach p < 0.05 below n = 6, and I wanted headroom), passScore 70, null attempt = 0. The controller may want to confirm.
- Requiring the t-interval lower bound > 0 in addition to the sign test is stricter than the brief's minimum; it only ever turns a "verified" into "inconclusive".
- Migrations 0024-0026 are on other lanes; the migration test computes the previous version dynamically so it holds after they merge.
- Nothing yet wires `verdictV2` into the version-proposal flow (proposals still show `evaluation: null`).
