# c61 review (R2-2 audit record, R2-3 attestation, R2-1 calibration scaffold)

Reviewer: independent, read-only. Lane /home/luca/AXION-w60, commits 2d23cca..1b2cd46. My probes live in the scratchpad dir `probe/` (outside the lane); the lane was not edited. Every heavy run went through heavy.sh; no ports were opened, no processes of mine remain. No "too many connections" occurred in my runs.

Re-run in the lane (heavy.sh): eval-attestation, eval-audit, judge-calibration, eval-evidence, eval-evidence-db, eval-integrity-db, eval-model, contracts/* = 10 files, 323 tests, all pass. The only test files changed against c53 are eval-fixtures.ts (additive optional fields), contracts/coverage.test.ts (fixture data) and contracts/validators.ts; no c47/c53 assertion changed, no allowlist line added (`git diff` grep for "allow" = 0).

## Summary of findings
| # | Severity | Item |
|---|---|---|
| 1 | should-fix (high) | R2-2: informative ungradedness plus case-level exclusion turns a tie into `verified_better` at exactly the 0.8 gate |
| 2 | should-fix | R2-3: the "attestor is not the author" rule can be defeated by rewriting a NULL `created_by` with one UPDATE; `created_by` is free text |
| 3 | should-fix | R2-2: a re-grade diff is a self-reported claim; a fabricated diff turns "worse" into `verified_better` |
| 4 | should-fix | R2-1: coverage claim is only for judges at 0.8-0.95 and equal class sizes; after the `judge_too_weak` gate, conditional coverage falls to 82-90% in hard cells |
| 5 | minor | R2-3: UI does not explain that pre-c61 datasets can never be attested (`author_unknown`) |
| 6 | minor | R2-2: omitting the grader on both runs equals "same grader" (bypass by omission once a writer exists) |
| 7 | minor | R2-3: `btrim` only strips spaces (tab-suffixed author id), author id formats are not normalised |
| 8 | minor | R2-1: overlap detection is exact canonical input only (extra key or whitespace variant passes); "A1 pilot uses 10 per class" is a pilot size for allocation, not an inference minimum |
| 9 | minor | UI tooltip names only the candidate grader; the baseline grader (and a re-grade link) is not shown |

## 1. R2-1 estimator

**Formulas verified against the paper (the lane's open item is closed).** I could not render the PDF either, but arXiv's HTML page carries the LaTeX source in `alttext` attributes; I extracted them directly (`curl https://arxiv.org/html/2511.21140`, grep alttext), and two WebFetch answers agree.
- Eq. 7: `\hat\theta = (\hat p + \hat q_0 - 1)/(\hat q_0 + \hat q_1 - 1)`. Code: `theta = (p + q0 - 1)/(q0 + q1 - 1)`. Match.
- Eq. 9-11: `\tilde n = n + z^2`, `\tilde m_0 = m_0+2`, `\tilde m_1 = m_1+2`, `\tilde p = (n\hat p + z^2/2)/(n+z^2)`, `\tilde q_0 = (m_0\hat q_0+1)/(m_0+2)`, `\tilde q_1` likewise, `\tilde\theta = (\tilde p+\tilde q_0-1)/(\tilde q_0+\tilde q_1-1)`. Code `nT, m0T, m1T, pT, q0T, q1T, thetaT`. Match.
- Eq. 12, the centring term: `d\tilde\theta = 2 z^2 ( -(1-\tilde\theta) \tilde q_0(1-\tilde q_0)/\tilde m_0 + \tilde\theta \tilde q_1(1-\tilde q_1)/\tilde m_1 )`. Code: `d = 2*z*z*(-(1-thetaT)*v0 + thetaT*v1)`. Match, including the factor 2z^2 and both signs.
- Eq. 8: `\tilde\theta + d\tilde\theta \pm z\sqrt{ [ \tilde p(1-\tilde p)/\tilde n + (1-\tilde\theta)^2 v_0 + \tilde\theta^2 v_1 ] / (\tilde q_0+\tilde q_1-1)^2 }`, truncated to [0,1]. Code `half` and the clamps. Match. z is the (1-alpha/2) quantile, 1.96 at 0.05; code uses 1.95996.
- The code comment's "unverified transcription" and the report's "Estimator provenance (honest limit)" can now be replaced by "verified against the arXiv HTML LaTeX source".

**Edge cases (probe est.probe.ts, direct calls):**
- sens+spec = 1 (5/5/5/5) and below chance (2/8/3/7): `judge_too_weak`, no NaN, no inverted interval. Good.
- Class with zero items (10/0/0/0): `too_few_calibration`; tiny set (3/2/3/2): `too_few_calibration`. Good.
- Adjusted margin D < 0.2 (e.g. 6/4/6/4, 11/9/12/8): `judge_too_weak`. Good.
- Perfect judge, judgedPass 0 and n: interval [0, 0.071] and [0.929, 1]: clamped, sensible. n = 1: [0.096, 1], wide but valid.
- Point estimate inside its own interval: 0 violations over 1440 grid points. The point estimate is clamped to [0,1].
- Input validation: non-count or judgedPass > n throws. Fine.

**Coverage simulation.**
- The RNG is seeded (mulberry32, seed 20261122 plus cell-dependent offsets), SE = sqrt(c(1-c)/1000) is the right binomial SE, and cells where no interval is produced count as not covered (conservative). The sampling model is right (positives ~ theta, judge errs with 1-q0 / q1, calibration binomials). I cannot verify "grid fixed before results were seen": the test and code are one commit (4eb3e2c).
- **Finding 4 (should-fix).** The grid has judges only at (0.9,0.9), (0.8,0.95), (0.95,0.8), equal class sizes (50+50, 20+20), theta 0.2-0.8. It has no judge near chance, no unequal classes, no extreme theta. The brief asked for hard cases. I ran my own fixed grid (probe est.probe.ts, seed 424242, 1000 sets per cell, 48 cells: theta 0.05/0.5/0.95, judges .6/.6, .7/.65, .55/.9, .9/.9, sizes (n, m0, m1) = (30,10,10), (100,10,60), (100,60,10), (200,50,50)), computing coverage among cells that return `ok`:
  - 8 of 48 cells under 93%. Worst: theta .95, judge .6/.6, n 100, m 60+10: 81.7% (ok in 449 of 1000); theta .05, .6/.6, n 100, 10+60: 85.5%; theta .05, .6/.6, n 200, 50+50: 89.0%; theta .95, .6/.6, n 200: 90.3%; theta .5, .6/.6, n 100, 10+60: 91.0%.
  - The cause is selection: the `judge_too_weak` gate skips 55-58% of draws for a .6/.6 judge, and the survivors are the draws where the calibration set made the judge look good, so the interval is too narrow. Cells with judge accuracy >= 0.7 and 0.9/0.9 mostly pass (min 92.9% at .6/.6 theta .05 n 30). This is real selection bias that the lane's grid (all judges >= 0.8, nothing skipped) cannot show.
  - The report's "PASS on the stated grid" is literally true, but the pass-threshold row reads broader than the evidence. Fix: add weak-judge and unequal-class cells to the fixed grid and report conditional coverage and the skip rate, or raise the margin so the gate does not bite in the region where coverage is poor (and state the coverage floor as conditional on a judge with D >= some value), and say plainly in the report that coverage degrades for judge accuracy near 0.6.
- The lane's own weakest cell (93.3%, 0.4 SE above the floor) is disclosed. Fine.

**Calibration disjointness.** Enforced in a BEFORE INSERT trigger (`eval_calibration_labels_check`): dataset must be frozen (so cases cannot change later), then `eval_input_sha(input)` must not equal any case's canonical hash; hash computed in the DB, caller value ignored. Probe cal.probe.ts: same input with another key order refused; `3.0` vs `3` refused; a whitespace/case variant and an extra-key variant accepted (finding 8; documented as near-duplicates, but an extra key is a trivial leak, not a paraphrase). One label per (dataset, family, item) holds (duplicate key refused). Disjointness is only against this one dataset's cases, not against other datasets the candidate was tuned on; acceptable for a scaffold, worth one sentence.

**Other.** `calibratedVerdict` rule (non-overlap by margin 0.05, "worse" only when wholly below) is conservative and clearly labelled as ours. `calibratedEvaluation` correctly leaves ungraded attempts out of n. The statement "judges exist only as family labels, so this is scaffolding" is in the code header, the report and the test; nothing in the verdict path calls it (grep: only judge-calibration.ts references it). Honest.

## 2. R2-2 instrument audit

**Verified behaviour (probe rg.probe.ts and the lane's tests):**
- Ungraded never a failure; 50% ungraded: inconclusive (lane test, pure and loader). `worse` also requires `v.grading.sufficient`.
- Grader mismatch: `Rubric 1` vs `rubric 1` (case): refused `grader_mismatch` (strict comparison, conservative). Recorded vs NULL candidate: refused. Both NULL: accepted (pre-c61 meaning; finding 6).
- A re-grade diff cannot link unrelated runs: it is keyed by `run_id`, the loader only looks for diffs of the base run or of the candidate run itself, requires from/to to equal the two runs' graders, and requires the diff to cover every stored result (count of cases equals count of results; PK plus per-row existence check make that exact). The DB refuses a diff from a grader the run did not record, an unfinished run, a wrong old grade, a cross-tenant diff.
- Derived counts instead of columns: sound. `eval_results` is append-only (trigger 0027) and a result cannot be inserted once its run is finished (`eval_results_check`), so the counts of a finished run cannot change; a stored counter could only disagree. `eval_run_audit()` is stable and cheap. The deviation from the brief is justified and disclosed.
- Parameters: 0.8 graded fraction, two-version rule and 10 per class are all labelled "ours". See finding 1 for why 0.8 on attempts is not defensible by itself. The margin 0.2 and 10 per class: see finding 4.

**Finding 1 (should-fix, high): exclusion bias is large, not small.** Cases with an ungraded attempt on either side are removed, and the gate is on the attempt fraction (0.8), not on the fraction of cases left. Probe bias.probe.ts uses the pure `verdictV2` (100 cases, k=1): base and candidate each fail 40 cases (overlap 24), true difference 0. Result with no ungraded: `inconclusive`, delta 0, n 100. If 20 of the candidate's own failures time out (candidate graded fraction exactly 0.80, so `sufficient: true`): **`verified_better`, delta +14, n 80, 16 wins / 0 losses, no refusal, no reason.** The note "20 cases left out" is the only trace. The mapping is plausible in practice (timeouts and unparseable output correlate with long or failing answers). Also with k>1 the case-level loss is amplified (20% ungraded attempts at k=5 can exclude ~89% of cases, which only the minCases rule catches, as an unrelated message). Recommended fix: (a) gate on the cases retained (e.g. gradable cases / shared >= 0.8) AND require that ungradedness is not worse on one run than the other beyond a tolerance; (b) only allow `verified_better` if the verdict still holds in a worst-case bound (excluded cases scored as base-pass, candidate-fail), otherwise `inconclusive` with a reason naming the excluded count. At minimum, make an asymmetric exclusion downgrade `verified_better` to inconclusive. Since `verified_better` is what lets a promote go through without an override (versions.ts line 215), this matters before any run writer exists.

**Finding 3 (should-fix): a re-grade diff is a claim, not evidence.** `eval_regrades.created_by` is free text (no FK to users, no role check) and `new_score` is unchecked against anything. Probe: base run graded rubric v1 at 90, candidate graded rubric v2 at 40 (12 cases) is `inconclusive` (grader_mismatch). One `recordRegrade` by `'anyone'` with new_score 5 for all cases makes the loader return `verified_better`, `regradeId` FAKE. No write route exists, so this is not reachable over HTTP today, but the brief's rule is that mismatched graders may be compared only when a diff links them; the diff should have a person of standing (approved admin, not the evaluator or the candidate's author) and the verdict should say it rests on a re-grade. Suggest: FK created_by to users with an approved role check, refuse author/evaluator, and add a note and a `regraded` flag to the DTO so the reviewer sees the grades came from a diff.

**Finding 6 (minor): omission bypass.** Both grader columns NULL = equal, so a writer that records no grader on either run evades `grader_mismatch` (probe: null-both, 90 vs 40, gives a normal `worse` verdict). This is c53 behaviour preserved for old runs, but it should be closed for new runs (`startRun` requiring `grader`, or a DB check for runs started after 0046, e.g. `started_at` after a cutover or a `grader_required` marker).

## 3. R2-3 attestation

**Verified:**
- Raw insert: the trigger overrides version and hash (raw insert with version 99 and zero hash stored version 1 and the real `eval_dataset_sha`). UPDATE, DELETE, TRUNCATE refused (`append-only`), probe attest.probe.ts.
- Admin only (`role='admin' and status='approved'`); member and disabled admins refused in the lane's tests. An agent id cannot be an attestor (FK to users).
- NULL author refused (`author_unknown`). All 12 items answered; NA needs a 10-character reason (a note of ten identical characters is accepted, as expected from a length rule; whitespace-only refused).
- A changed answer creates version n+1 bound to the new hash; an identical resubmission is refused (`attestation_unchanged`).
- Freeze not blocked: `attested_version` computed by the guard. A spoofed `attested_version = 7` in the freeze UPDATE is overwritten to NULL. Cases added after attestation: freeze records `attested_version` NULL (stale), so flagged. 25 of 25 flagged per lane; I did not re-count.
- The dataset must be unfrozen to attest (`dataset_frozen`).

**Finding 2 (should-fix): author rule is bypassable and the author is not identity-typed.**
- `eval_datasets.created_by` is free text, not a FK to users. The guard only forbids changing it once non-NULL. Every existing dataset has NULL, and **an UPDATE can set it from NULL to any string on an unfrozen dataset**. Probe: dataset created without author; attestation by admin u-a refused with `author_unknown`; `update eval_datasets set created_by='someone-else'`; the same admin u-a then attests successfully (version 1). So the real author can attest their own dataset by naming somebody else first.
- The comparison is `lower(btrim(attestor)) = lower(btrim(created_by))`. Accepted as "not the author" for attestor `u-a`: `u-a@x.io`, `user:u-a`, `u-a/`, `"U-A\t"` (tab: `btrim` strips spaces only), `agent:coder-01`. The lane's tests cover case and space only.
- Fix: make `created_by` insert-only and mandatory for new datasets (reject NULL to value updates, or require it on INSERT), reference `users(id)` (with an agent-author case spelled out), and normalise with a full whitespace trim. Also note an author means the creator only, not those who added cases later; state it.

**Finding 5 (minor): pre-c61 datasets, `author_unknown`.** Acceptable as a conservative choice (the rule cannot be checked, so refuse), and it is stated in the report (Concerns). It is not explained in the UI: the chip says only "not attested before it was frozen, so this evidence is unvalidated" (VersionProposals.tsx), and there is no writer route for attestation in any case. Add one line: "datasets created before the author was recorded cannot be attested; freeze a new dataset". Also the owner needs the decision on a backfill; the report names it.

## 4. Append-only and guards
New tables: eval_regrades, eval_regrade_cases, eval_attestations, eval_calibration_labels, each with an UPDATE/DELETE trigger and a separate TRUNCATE trigger using `instances_append_only()`, which allows DELETE only under `axion.purge_demo = on` (0007). Probe confirmed UPDATE, DELETE, TRUNCATE on eval_attestations refused; the lane's tests cover the other tables and the purge exception. `eval_runs_guard` was re-issued with the grader columns in the immutable tuple.

**Down migration after 0040:** probe down.probe.ts: fresh schema migrated to 45 (which is 0040 here) vs fresh schema migrated to 46 then `down 45`: all functions (schema name normalised), columns and triggers are identical. Down again is a no-op (re-runnable); `up -> down 39 -> up` on the schema returns 46. The 0037 dataset guard and 0040 run guard are restored correctly (0040 did not touch the dataset guard).

## 5. Decision binding
`evaluationSha` hashes `[run ids, dataset, outcome, runCount, refusal codes, grading, validity]`. `grading` is a plain object built in a fixed key order, so `JSON.stringify` is stable; `validity` comes from the immutable freeze-time `attested_version` and an immutable attestation row, so it does not change by itself. The promote route (versions.ts 211-214) still compares the client sha to the recomputed one and returns 409 `EVALUATION_CHANGED` before the worse/override checks; I found no path that skips it (the c47/c53 tests for it still pass unchanged). Side effect disclosed by the lane: an open card goes stale when grading changes. Note: the refusal's audit `seen` object does not include grading, which is fine.

## 6. No loosening
Confirmed from the diff: only eval-fixtures.ts, coverage.test.ts, validators.ts changed in existing test files; fixture changes add optional fields and keep the old insert statement when no grader/ungraded is given. The coverage fixture now records graders, a regrade diff and an attested dataset to make the new DTO fields non-null; the coverage rule itself ("never non-null") is unchanged and no allowlist line added.

## 7. Contracts
No route added. Response fields `evaluation.grading` and `evaluation.validity` have DTO types (`GradingDto`, `DatasetValidityDto`, `ProposalEvaluationDto`), validators (validators.ts) and are exercised by the coverage test. No registry change needed (no route). OK.

## 8. Boundary and honesty
No write route, no execution, no model call. Scaffolding status for R2-1 is stated in the code header, tests and report; there is no UI for calibration so nothing misleading there. The report states that attestation and re-grade diffs have no route and every real dataset is unvalidated. The report's wording "PASS on the stated grid" for coverage is accurate but should name the grid's limit (finding 4). Minor 9: the proposal card's tooltip shows only the candidate grader; after a re-grade link the baseline's effective grader is in the DTO but not displayed.

## Verdict: CLEAR AFTER FIXES
Required before merge:
1. (finding 1) Make ungraded-exclusion unable to produce `verified_better` by itself: gate on retained cases and add an asymmetry or worst-case check; add a test with my construction (tie, 20 candidate-failure timeouts => not `verified_better`).
2. (finding 2) Make `created_by` insert-only (no NULL to value update) and normalise/type the comparison; add tests for the NULL-rewrite and tab/format variants.
3. (finding 3) Constrain who may record a re-grade diff (approved admin, not evaluator/author) and show "based on a re-grade" in the DTO/UI; or, at least, never allow `verified_better` to rest on an unverified diff without a flag.
4. (finding 4) Extend the fixed coverage grid to weak judges and unequal classes, report conditional coverage and skip rate, and state the limit in the report; or raise `MIN_JUDGE_MARGIN`.
Optional (minor): findings 5-9, and replace the "centring term unverified" caveat with the verification recorded above.

---

# Re-review (fix rounds), 1b2cd46..43c1b7c

Scope: commits c5014b0, adcfbb5, 5280ed9, 45ab30d, 64f0782, 43c1b7c, read-only, against HEAD 43c1b7c (clean tree). Re-ran in the lane with heavy.sh (`--maxWorkers=1`, no connection problems): judge-calibration, eval-audit, eval-attestation, eval-evidence, eval-evidence-db, eval-integrity-db, eval-model, contracts/* = 10 files, 323 tests, all pass. New probes (scratchpad `probe/r2.probe.ts`, `old18.probe.ts`) ran in isolated schemas of axion_test; no processes or ports left behind.

## 1. Earlier findings re-probed

| Earlier finding | Result at 43c1b7c |
|---|---|
| 1. Tied base, 20 candidate timeouts (80% graded) | `inconclusive`, `grading.robust = false`, reason names the worst case. Fixed. |
| 2. Author bypasses | At INSERT, `created_by` of `u-a<TAB>`, `user:u-a`, `u-a@x.io`, `U-A`, `u-a ` are all refused `author_invalid`. NULL to value UPDATE refused ("set when created and cannot change"). NULL author: attest refused `author_unknown`. Real author attesting own: `attestor_is_author`. An agent-authored dataset can be attested by an admin (accepted, correct: an agent is not the attestor). Fixed. |
| 3. 'anyone' re-grade | `regrader_unknown` (FK to users plus approved check). Fixed. |

New bypass attempts:
- **Admin who is the proposer, diff on the candidate run:** refused `regrader_is_author`. **On the base run:** the DB accepts it (the DB check only fires when the run has a `subject_proposal_id`), but the loader refuses to link it (`g.created_by <> proposal author`): outcome stays `inconclusive` with `grader_mismatch`, `grading.regrade` null. Safe, but the DB rule is weaker than the report's wording ("the database refuses regrader_is_author"). Minor (M-a): either say "the loader" for base runs, or check against any proposal whose base is that version.
- **Scores outside 0..100 once rounded:** `100.0004`, `-0.0004`, `NaN`, `100.004` all refused by the check constraint; `100` and `99.99999` accepted. An ungraded reason with a score is refused. No rounding hole.
- **Worst-case imputation, both sides excluding** (pure `verdictV2`, 100 cases): the imputation is per side (a side with an ungraded attempt is imputed, the other keeps its own mean), so cases excluded on different sides are handled correctly.
  - Truly better candidate, 5 base and 5 candidate exclusions on different cases: `verified_better` survives (n 90, robust).
  - Truly worse, 5 + 5: `worse` survives.
  - Same 10 cases excluded on both sides, truly better (delta +23.3): `inconclusive`, robust false. This is over-conservative (an exclusion shared by both runs is imputed as base 100, candidate 0), but it fails closed, so it is acceptable. Minor (M-b): for a case excluded on both sides the imputation could use the other bound only against the verdict direction; note it in the backlog, not a blocker.
- Other: duplicate diffs for the same run and graders are allowed and the loader takes the earliest (a later, conflicting diff is silently ignored). Minor (M-c).

## 2. Coverage and policy

- **Honesty of the help text and report.** The help text (`agent.version.evaluation`) says calibration is groundwork, not used in the result, and that the guarantee holds only for judges that clearly pass 0.5; weaker judges are refused because selection bias makes them unreliable. The report's Fix round 2 states plainly that item 4 remains NOT MET, that the gate is "fail closed by policy, not a coverage guarantee", and that middling judges (true margin 0.35 and 0.45) still miss when a lucky calibration set carries them over 0.5. I checked the numbers: the pinned lists contain only judge (.7,.65) and (.55,.9) cells (12 and 13 entries on the two seeds; zero cells of the .9/.9 judge), so "true margin 0.8 meets it in every cell" is correct. One wording gap (minor M-d): the help text says the guarantee holds for judges that "clearly pass" 0.5, but a judge that passes the gate by chance is not covered; add "a judge near the margin can still pass the gate by chance and under-cover".
- **Pinned NOT_MET lists really fail on change.** The test asserts `expect(failing).toEqual(NOT_MET[seed])` per seed, so a cell entering or leaving the list fails the test in either direction; the RNG is deterministic (mulberry32, `seed + 7919*cellIndex`), so the lists are stable between runs. The lane's own RED run (lists no longer matched after the margin change) shows it bites. Caveat (minor M-e): a cell is assessed with as few as 30 gate-passing draws (`MIN_OK`), where the 93% line is noisy; the lists are therefore partly seed noise (the two seeds differ by one cell). That is acceptable for a pin, but the report should not read them as "these cells are bad", only "these cells missed on this seed".
- **No other expectation loosened.** The old per-cell `expect(coverage) >= 0.93` for the original 18 cells and the "pooled" test were replaced, so I re-ran those exact 18 cells under the new gate (margin 0.5, 20 per class) with my own seed (555): all 18 are at or above 94.5% conditional coverage, none under 93%, gate passes 975-1000 of 1000. The original claim still holds under the stricter policy. The replaced grid pins failures instead of asserting success, which is how the report describes it. The assertions on estimator formulas, edge cases and refusals were not weakened (diff shows only constants and signatures changed). No c47/c53 assertion changed: since 2d23cca the changed test files are still only the c61 ones plus eval-fixtures.ts, coverage.test.ts and validators.ts.

### Opinion for the backlog: gate on a lower confidence bound of the margin?
Not by itself. The selection bias comes from conditioning on a statistic (the observed margin D̂ = q̃0 + q̃1 − 1) that is computed from the same calibration labels that produce the correction and its interval. A lower bound D_L ≥ c is still a function of those labels, so it still keeps the draws where q̂ happened to be high and the interval comes out too narrow; it moves the cut-off, it does not remove the dependence. (The lane's own search found a lower-bound floor no better; I did not re-simulate it.) The bias is worst for a judge whose true margin sits near the cut-off, which is what the pinned cells show. Better remedies, in order:
1. **Sample splitting (A1's own pilot idea).** Decide eligibility on a pilot subset of the labels (say the first 10 per class), then compute q̃ and the interval only from the remaining labels. The gate is then independent of the data in the interval, so the interval's conditional coverage is that of an ordinary Wald on the rest. Cost: fewer labels per interval (needs about 30 per class to keep 20).
2. **Qualify the judge once, outside the evaluation.** A judge (family and version) is admitted to calibrated verdicts by a one-off qualification set that is never reused for an interval; evaluations use fresh labels only.
3. **No gate, a Fieller-type (or profile-likelihood or bootstrap) interval** for θ = (p + q0 − 1)/(q0 + q1 − 1). When the denominator's confidence set includes 0 the interval is unbounded, so the verdict is inconclusive for the right reason and no draw is dropped, so there is nothing to select on. This is the principled fix, at the price of a new estimator that is not A1's.
I have not run simulations of 1-3; these are expectations from the structure of the problem, to be tested on the same 72-cell grid.

## 3. Item 5: grader missing on both sides is `grader_unknown`
- The rule is right: both NULL now refuses `grader_unknown` (pure verdict test at eval-audit.test.ts line 75, loader test at line 214), one NULL and one recorded stays `grader_mismatch`.
- `eval-fixtures.addRun` now defaults to `{fixture-grader, 1}` when `grader` is undefined and uses `grader: null` for "not recorded". This does not hide a case: every old fixture that formerly relied on "both not recorded = equal" now has the same grader on both runs and gets the same verdict as before, while the two places that need "not recorded" pass `null` explicitly and assert the refusal. Risk left (minor M-f): since every fixture run now carries a grader, no c47/c53 test exercises a legacy run (both NULL) through the loader except the one explicit test; if that test is removed the default hides the case. Consider a comment in the fixture or a test that fails when the default is changed.
- `web/scripts/api-c47.mjs` now inserts `'rubric','1'` for both runs. It mirrors the fixtures and covers the browser path for graded runs; no browser assertion changed. It does not exercise `grader_unknown` in the UI (the refusal text shows in the card's refusals list through the normal path). Not hiding anything, but it means the legacy-run state is not browser-tested.
- Consequence to put on the owner's list: every run recorded before c61 has no grader, so any evaluation built from such runs is now `inconclusive` (grader_unknown) permanently. That is the intended fail-closed behaviour, and it matches the earlier `author_unknown` decision for pre-c61 datasets.

## Verdict: CLEAR
All four should-fix findings are closed (1, 2, 3 verified by probe; 4 closed by the controller's fail-closed policy with item 4 honestly NOT MET and pinned) and the item 5 minors are fixed. Remaining items are minor and need no re-review: M-a (DB check for base-run diffs by the proposer; the loader already ignores them), M-b (over-conservative same-case imputation), M-c (duplicate diffs, first wins), M-d (help text: a judge near the margin can pass the gate by chance), M-e (pins partly seed noise, MIN_OK 30), M-f (fixture default grader could hide the legacy-run case).
