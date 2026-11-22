# c32 review (independent): evaluation data model and honest verdicts

Reviewed tip 74205fc on c32-eval-model. Verdict: **CLEAR** (no Important findings; Minor notes below).

## 1. Statistics
- Sign test (stats.ts:4-20): exact BigInt sum, two-sided = min(1, 2*tail), n=0 gives p=1, ties are the caller's job. Checked: 9/1 -> 0.021484375 (=22/1024), 1/1 -> 1, 3000/2900 -> 0.197 (no overflow).
- t quantile 97.5 % (stats.ts:79-89): ran df 1,2,3,5,10,20,30,60,100,1000 and all match published tables to 4 dp (12.7062, 4.3027, 3.1824, 2.5706, 2.2281, 2.0860, 2.0423, 2.0003, 1.9840, 1.9623); df 1e6/1e9 tend to 1.95996. Paired CI uses n-1 df and sample sd; [1..5] gives 1.0368..4.9632 (correct).
- pass^k (stats.ts:105-117): the unbiased C(c,k)/C(m,k) estimator as a falling-factorial product, averaged over cases; null for k>m, empty, or k<1. Checked [T,F,T],k=2 -> 1/3; [T],k=1 -> 1; [T,F],k=3 -> null. Not the naive "first k".
- mulberry32 and bootstrap are seeded and deterministic (n=1 collapses to the point; empty throws). The verdict does not use the bootstrap, only the t interval.
- NaN/out-of-range scores: verdictV2 counts them as `bad_scores` and refuses (verdict-v2.ts:155-158). All ties: n=0, p=1, inconclusive.
- Minor, stats.ts:79: tQuantile975(Infinity) returns about 3e-55 (nonsense); unreachable since df = n-1 is finite. Non-integer df is accepted silently. Harmless.

## 2. Verdict logic
- verified_better requires: zero refusals, n >= 10, p < 0.05, wins >= losses (not losses > wins), delta >= 5, CI low > 0. Refusals (hash mismatch, not frozen, not holdout, dev/holdout reuse, self_judging incl. missing judge, evaluator = author incl. missing ids, unpaired, unequal attempts, bad scores) all force inconclusive because outcome is only set inside `refusals.length === 0`. I found no path to verified_better without these.
- v1 unchanged: `git diff improve-30h...c32-eval-model --stat` shows no change to verdict.ts or test/verdict.test.ts; v2 has its own policy constant.
- Minor, verdict-v2.ts:177: minCases counts tied cases (10 cases with 6 wins, 0 losses, 4 ties passes: p=0.031). Defensible, but the "minimum" is not a minimum of informative pairs. State it in the policy docs or count non-ties.
- Minor, verdict-v2.ts:55-69: the hash check trusts the caller-supplied `observedSha256`; nothing in the function ties the baseline/candidate runs to the named holdout dataset (CaseRuns carry no dataset id), and `tunedOnDatasetIds` is compared only against the holdout id. Fine as a pure function; the wiring (out of scope) must compute the hash from the cases actually run and take dataset ids from eval_runs.
- Minor, verdict-v2.ts:147: with unequal-but-matched attempt counts across cases (some cases 2 attempts, others 3 on both sides) there is no refusal and k = min; pass^k for k=3 would be reported null. Acceptable.

## 3. Migration 0027
- Numbering: 0027 with 0023 the latest present; no collision (0024-0026 reserved elsewhere). Down migration drops the tables then the four functions; up/down/up is tested on a populated schema.
- Triggers follow 0007/0008: results use the existing `instances_append_only` (update/delete/truncate; delete allowed only under transaction-local `axion.purge_demo`). eval_runs has the same exception for DELETE and a truncate guard. Datasets and cases allow delete of frozen rows only under purge_demo; inserts and updates of frozen cases are never allowed.
- Frozen immutability: UPDATE of frozen_at back to null is blocked (guard fires on old.frozen_at not null); a frozen dataset cannot be deleted without the flag, so delete-and-reinsert of the dataset is blocked; case insert/update/delete on a frozen dataset is blocked; moving a case between datasets is blocked. Freezing requires a content_sha256 (check constraint) and a run requires a frozen dataset of the same tenant; results check attempt <= k, case in the run's dataset, run unfinished; score 0..100 or null; trace is an object with a steps array.
- Minor, 0027_eval_model.up.sql:60-72: no TRUNCATE guard on eval_cases or eval_datasets (0007/0008 guard truncate on their append-only tables). `truncate eval_cases` bypasses the frozen guard (eval_datasets truncate fails on the FK anyway). Add `before truncate` triggers using instances_append_only.
- Minor, up.sql:16-19: the DB does not verify that content_sha256 matches the cases; the hash is whatever the app writes at freeze. Freeze with a false hash is possible; the app must compute it with hashDataset in the same transaction. Also a dataset can be frozen with zero cases, and freezing is not serialised against concurrent case inserts (no row lock).
- Minor, up.sql:28-35: eval_runs.tenant_id is matched against the dataset but not against the subject agent_version's tenant; eval_cases/eval_results carry no tenant (scoped through the parent). Fine if all reads join through tenant-checked parents.
- Not exercised by tests: the purge_demo exception paths.

## 4. Scope
No route, job or model call added: the diff touches only migrations, two pure evolution modules, three tests and the report. verdict-v2.ts imports only node:crypto and stats.

## 5. Test honesty
- stats, verdict-v2 and (per the report) eval-model tests match the claims; I re-ran stats + verdict-v2 (33 pass). No skip/only/todo. Known-answer values asserted to 4 dp.
- Minor, verdict-v2.test.ts:116-119: the test is titled "evaluator = author, unequal attempt counts, unpaired cases" but never asserts `unpaired_cases`; `bad_scores` is also untested.
- Minor: the pass^k fixture only has equal attempt counts (m=k at the top); the C(c,k)/C(m,k) with m>k path is covered only by the stats.test fixture (it is, with m=4, k=1..3). OK.
- Not run by me: eval-model.test.ts (needs a DB, not allowed). The report says 9/9 and honestly records that axion_e2e30 and the browser check were not run.
