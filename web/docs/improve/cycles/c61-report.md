# c61 report: evaluation instrument records (R2-2, R2-3, R2-1)

Lane w60, branch `c61-eval-instruments`, from `c53-eval-integrity` at 2d23cca. Records, validation and arithmetic only: no eval-run write route, no execution, no model calls, no new route and no new allowlist line. Migration **0046** (one file, extended per item; its down is re-runnable and restores the 0037 dataset guard and the 0040 run guard). One commit per item: R2-2 `f87ba43`, R2-3 `53800c4`, R2-1 `4eb3e2c`. Load average 11-14 during every run below (heavy.sh).

## What was built

**R2-2 instrument audit record.** The evidence is one single-author preprint (A6); the checks are cheap and the evidence is only the motive.
- `eval_runs.grader_name`, `grader_version` (both or neither; NULL = not recorded, as on every older run), immutable in the run guard. `startRun` takes an optional `grader`.
- `eval_results.ungraded_reason` (six codes; only on a NULL score). A NULL score with no reason is still a graded failure (c47/c53 meaning unchanged). **Deviation from the brief's wording:** episodes attempted, graded and ungraded-with-reason are DERIVED from the stored results (`eval_run_audit(run)`, `runAudit`), not stored as `eval_runs` columns, because the run is append-only and a stored counter could disagree with its rows.
- **Re-grade diff** = `eval_regrades` (run, from grader, to grader, by whom) + `eval_regrade_cases` (per case and attempt: old grade, new grade). The database checks that it starts from the grader the run recorded, that the run is finished, and that every old grade equals the stored one. Four append-only guards plus the purge_demo exception.
- Verdict rule: `verdictV2` refuses `grader_mismatch` when the graders differ (name or version; recorded vs not recorded differ; both not recorded are equal) unless a diff links them. The loader links a pair only when a diff covers every stored result of its run and reaches the other run's version, and then **compares the NEW grades** of the re-graded run.
- Ungraded attempts are left out of every number (a case with an ungraded attempt on either side is excluded and the note says how many). Below a graded fraction of 0.8 on either run (`minGradedFraction`, ours) the verdict is inconclusive with a reason, and the loader's `worse` mapping is blocked too, so 50% ungraded can never be "worse".
- `ProposalEvaluationDto.grading` states graded/attempted for both runs and the grader beside the pass rate; the proposal card shows it next to pass^1. `evaluationSha` now covers it.
- Cost from root spans (`rootSpanCost`): fixture-only, no usage is recorded until Stage 9.

**R2-3 dataset attestation.** ABC-style (A3, NeurIPS 2025 Datasets and Benchmarks): 12 items in task validity, outcome validity and reporting. The wording is ours; we do not claim the paper's item list (the paper was not opened).
- `eval_attestations` (dataset, version, content hash, attestor, answers). Every item needs yes, no, or not_applicable with a reason of 10+ characters. The hash and the version are computed by the database. Changing an answer is a new version; an identical resubmission is refused.
- The attestor must be an approved **administrator** (only `admin` and `member` roles exist, so "owner or admin" means admin) and **not the dataset's author**. `eval_datasets.created_by` is new (immutable once set). A dataset with no recorded author cannot be attested (`author_unknown`), because the rule could not be checked.
- Attestation comes before the freeze: a frozen dataset cannot be attested (`dataset_frozen`). The freeze guard computes `eval_datasets.attested_version` (the latest version whose hash equals the frozen hash, or NULL); the caller cannot set it. Cases changed after the attestation make it stale, so that freeze is unattested.
- A freeze is never refused for lack of one. The verdict DTO carries `validity` (`unvalidated`, `status` attested/failing/unattested, version, failed items); a "no" answer gives `failing`, still unvalidated. The card shows an "unvalidated" chip. Outcomes of c47/c53 are unchanged.
- Deferred, as briefed: the per-run "disallowed source reachable" flag.

**R2-1 judge calibration scaffold.** Nothing in a proposal's verdict calls it yet: judges exist only as family labels (c53), so this is **scaffolding until judges are used**.
- **Estimator (named in code and here): A1, Lee, Zeng, Jeong, Sohn, Lee, "How to Correctly Report LLM-as-a-Judge Evaluations", ICML 2026, arXiv 2511.21140 (v4). Rogan-Gladen point estimate (Eq. 7) with the adjusted-Wald interval (Eq. 8-12, "add two successes and two failures").**
- **Scope: binary judge verdicts**, mapped to one pass/fail verdict per case (attempt 1, pass = score at or above the policy's `passScore`, ungraded attempts excluded from n). Assumptions from A1: human labels are ground truth, the judge errs equally on calibration and test items, sensitivity + specificity > 1.
- Ours, not A1's: the minimum of 10 labelled items in each class, a minimum adjusted sensitivity + specificity - 1 of 0.2 (otherwise `judge_too_weak`, never NaN or an inverted interval), the Wilson interval for the raw rate, and the two-version rule in `calibratedVerdict` (verified better only when the candidate's corrected interval is above the base's by the margin, 5 score points read as 0.05 of pass rate; worse when wholly below; otherwise inconclusive). Raw and corrected figures are always both returned.
- Store `eval_calibration_labels` (judge family via the c38 table, frozen dataset, input, the judge's verdict, the human label, labeller). **Disjoint from the test set, enforced in the database** by canonical input hash (key order does not hide an overlap); the dataset must be frozen; one label per item; four append-only guards. Near-duplicates (different wording of the same question) are not detected.
- `calibratedEvaluation(base run, candidate run)` composes stored runs and labels; different judge families or datasets are inconclusive.

## Estimator provenance
The independent review checked the estimator term by term against the LaTeX source in the paper's HTML page (arXiv 2511.21140v4), including the 2z² centring term and the truncation: it matches. (The first version of this report called it an unverified transcription; that caveat is withdrawn.)

## Coverage (R2-1 threshold)
Seeded RNG (mulberry32, seed 20261122), grid fixed in the test before the first run: theta in {0.2, 0.5, 0.8} x judge (specificity, sensitivity) in {(0.9,0.9), (0.8,0.95), (0.95,0.8)} x (test n, calibration m0+m1) in {(200, 50+50), (100, 20+20)}. Each cell is 1000 simulated datasets at a nominal 95%; SE = sqrt(c(1-c)/1000).

| theta | spec/sens | n, m | coverage | SE | | theta | spec/sens | n, m | coverage | SE |
|---|---|---|---|---|---|---|---|---|---|---|
| 0.2 | .9/.9 | 200, 50+50 | 95.8% | 0.63 | | 0.5 | .95/.8 | 100, 20+20 | 96.8% | 0.56 |
| 0.2 | .9/.9 | 100, 20+20 | 96.3% | 0.60 | | 0.8 | .9/.9 | 200, 50+50 | 95.1% | 0.68 |
| 0.2 | .8/.95 | 200, 50+50 | 96.1% | 0.61 | | 0.8 | .9/.9 | 100, 20+20 | 96.7% | 0.56 |
| 0.2 | .8/.95 | 100, 20+20 | 96.2% | 0.60 | | 0.8 | .8/.95 | 200, 50+50 | 97.2% | 0.52 |
| 0.2 | .95/.8 | 200, 50+50 | 94.6% | 0.71 | | 0.8 | .8/.95 | 100, 20+20 | 98.3% | 0.41 |
| 0.2 | .95/.8 | 100, 20+20 | 97.0% | 0.54 | | 0.8 | .95/.8 | 200, 50+50 | 95.5% | 0.66 |
| 0.5 | .9/.9 | 200, 50+50 | 95.0% | 0.69 | | 0.8 | .95/.8 | 100, 20+20 | 95.5% | 0.66 |
| 0.5 | .9/.9 | 100, 20+20 | **93.3%** | 0.79 | | 0.5 | .8/.95 | 200, 50+50 | 95.3% | 0.67 |
| 0.5 | .8/.95 | 100, 20+20 | 94.8% | 0.70 | | 0.5 | .95/.8 | 200, 50+50 | 95.2% | 0.68 |

**Pooled over the 18 cells: 95.82% (pooled SE 0.15 points); minimum cell 93.3% (SE 0.79).** All 18 cells meet the 93% floor in this run; the weakest (theta 0.5, a 0.9/0.9 judge, 20+20 calibration) is only 0.4 SE above it, so a different seed could dip under. The grid is small and uses equal-sized calibration classes; it is evidence for these cells, not for every judge or size.

## RED / GREEN
- **R2-2 RED** (`test/eval-audit.test.ts`, unchanged code, migration missing): 24 of 27 failed. First error, test "a fixture with 50% ungraded candidate episodes is inconclusive, never worse": `AssertionError: expected 'not_better' to be 'inconclusive'`; the others `Cannot read properties of undefined (reading 'sufficient')` (no `grading`), `expected [] to include 'grader_mismatch'`, a missing migration 46 and missing `eval_regrades`. **GREEN** 27/27 (one append-only test needed its truncate check reworded: truncating the parent table alone is refused by the foreign key before the trigger, so the test truncates both tables together and asserts `append-only`).
- **R2-3 RED** (`test/eval-attestation.test.ts`): whole file failed, `Error: Cannot find module '../src/evolution/attestation.ts'`. **GREEN** 19/19.
- **R2-1 RED** (`test/judge-calibration.test.ts`): whole file failed, `Error: Cannot find module '../src/evolution/judge-calibration.ts'`. **GREEN** 46/46 (one test first compared a message where the error carries a `code`; the test was corrected to check the code, no assertion loosened).
- Contract coverage (`test/contracts/coverage.test.ts`) went RED after the DTO change (10 "never non-null" entries for `grading.*` and `regradeId`) and is GREEN because its c50 fixture now records graders, a re-grade diff and an attested dataset. No allowlist line was added.
- Existing c47 and c53 tests pass **unchanged**: only `eval-fixtures.ts` gained optional fields (`grader`, `ungraded`, `createdBy`, `attestBy`) and the coverage fixture gained the data above.

## Pass threshold
| Item | Status | Evidence |
|---|---|---|
| Items 1-4 RED then GREEN | PASS | see above, one commit per item; item 4 (contracts) is the DTO/validator/registry work: `GradingDto`, `DatasetValidityDto`, validators, coverage fixture. The calibration scaffold adds no field or route. |
| Every c47 and c53 test passes unchanged or is tightened with a stated reason | PASS | no assertion changed; helpers extended additively |
| R2-2: a 50% ungraded fixture is inconclusive, never worse | PASS | pure and loader tests |
| R2-2: grader-version mismatch rejected in 100% of tests | PASS | 200-pair sweep plus loader tests; one recorded vs not recorded also refused |
| R2-2: nested-cost fixture counts each call once | PASS (fixture only) | `rootSpanCost` |
| R2-3: freeze without an attestation flagged in 100% of tests | PASS | 25 of 25 flagged |
| R2-3: attestor is not the author; every item answered or N/A with reason; changed answer is a new version bound to the hash | PASS | DB-enforced, tested with raw inserts too |
| R2-1: coverage at least 93% at nominal 95%, seeded, with SE reported | PASS on the stated grid | pooled 95.82% (SE 0.15), min cell 93.3% (SE 0.79); caveats above |
| R2-1: inconclusive without calibration data in 100% of fixture cases; raw and corrected always shown | PASS | 100 of 100 |
| Full vitest | NOT MET strictly | 73 files, 2304 passed, 1 failed: `test/jobs.test.ts > concurrency > 20 parallel claimers over 50 jobs: each job is claimed exactly once, and the table agrees`, first error `too many connections for role "axion"` (the BACKLOG H14 family). Re-run alone with `--maxWorkers=1`: 76/76 passed. No file I changed is involved. |
| tsc | PASS | server and web clean |
| api-c47, api-c05, api-stage6 (heavy.sh, ports 11092/11093) | PASS | 26/26, 31/31, 94/94 on the first run |
| a11y (UI changed) | PASS | `a11y-check (api): 41 views, 65 dialogs, 0 violations` (the "probe ... fail" lines are its deliberate failed-load probes) |

## Files changed
- `server/migrations/0046_eval_instruments.{up,down}.sql`
- `server/src/evolution/`: `verdict-v2.ts`, `proposal-evidence.ts`, `eval-runs.ts`; new `attestation.ts`, `judge-calibration.ts`
- `shared/contracts/src/agents.ts`; `server/test/contracts/validators.ts`, `coverage.test.ts`
- `web/src/features/agents/VersionProposals.tsx` (graded fraction beside pass^1, "unvalidated" chip), `web/src/pages/Agents.tsx` (demo sample)
- Tests: new `eval-audit.test.ts`, `eval-attestation.test.ts`, `judge-calibration.test.ts`; edited `eval-fixtures.ts`

## Concerns
- **No write route.** Attestation, calibration labels and re-grade diffs have services and database rules but no HTTP route and no UI, so a person cannot yet do them; that is an owner decision (it needs routes with registry, DTO, validator and flow entries). Until then every real dataset is `unvalidated`.
- **Datasets before c61 have no author**, so they can never be attested (`author_unknown`); a freeze of them is flagged. Backfilling an author is a judgement call left open.
- `evaluationSha` now includes `grading` and `validity`, so a reviewer's open card goes stale if an attestation or a grading record changes (intended, but visible).
- `minGradedFraction` 0.8, the calibration minimum of 10 per class, the 0.2 judge margin and the non-overlap rule are our choices, not A1's or A6's. A graded-fraction of 0.8 still excludes the cases with an ungraded attempt, which can bias the comparison if grading failures are not random; the note says how many cases were left out.
- A calibration overlap is detected only on identical canonical input, not on paraphrases.
- The centring term transcription (see Estimator provenance). Minimum coverage cell is 0.4 SE above the floor.
- Servers on ports 11092/11093 were started and stopped by api-e2e.sh itself; nothing of mine remains listening on 11090-11093.

## Fix round (review c61-review.md: CLEAR AFTER FIXES)

Commits after 1b2cd46: item 1 `c5014b0`, item 2 `adcfbb5`, item 3 `5280ed9`, item 4 `45ab30d`, item 5 `64f0782`. Migration 0046 was extended in place; its down stays re-runnable. Each item was RED on the unchanged code with the reviewer's probe, then GREEN. Where a fix changes older code, the RED run was made with the old source restored (so the tests failed for the reason named).

| # | Result |
|---|---|
| 1 | Each side must keep at least 80% of its cases (not only of its attempts) and a verdict must survive the worst case: a `verified_better` must survive imputing every excluded case as a candidate loss and a base win; a `worse` must survive the mirror; if not the verdict is inconclusive with the reason "worst case". RED (the reviewer's tied-base probe, 20 candidate failures timed out): `expected 'verified_better' to be 'inconclusive'`, also through `loadEvaluations`. DTO: `grading.retained`, `grading.robust`. |
| 2 | `eval_datasets.created_by` is checked at insert to be a real user or a real agent id of the tenant (`author_invalid` for free text, `u-a@x.io`, `user:u-a`, `u-a/`, case or tab or space variants), and an UPDATE of it is refused, including NULL to value. The attestor is compared by exact id (both ids are database-checked). Datasets from before c61 keep `author_unknown`; the card says so in words with a `?` (`canBeAttested` in the DTO, help key `agent.version.unvalidated`). RED: each bypass resolved instead of rejecting (`promise resolved "[ 'c01', ... ]"`, NULL rewrite then a successful attest). |
| 3 | A re-grade diff's author must be an approved user of the tenant and not the proposal's author (the database refuses `regrader_unknown` and `regrader_is_author`; the loader also does not link a diff by the proposal's author on the base run). New scores stay in 0..100. A diff must cover every GRADED result of its run (an ungraded result stays ungraded). A verdict that relies on a re-grade carries `grading.regrade = {id, by, byName}` and the card shows "re-graded by NAME". RED (the probe: 90 vs 40, diff by 'anyone'): `promise resolved "undefined" instead of rejecting`, and `expected undefined to be null`. The card's grader tooltip now names both graders (minor 9). |
| 4 | See coverage below. Gate changed from 10 per class and margin 0.2 to **20 per class and margin 0.3**. 2 weak-judge regimes are **NOT MET**; no gate fixes them. |
| 5 | A grader missing on both runs is `grader_unknown` (refusal, inconclusive), not "the same". `eval-fixtures.addRun` now records a default grader (a test that wants none passes `grader: null`) and `web/scripts/api-c47.mjs` records one: stated reason, no assertion changed. The "A1 pilot uses 10 per class" wording is fixed (it is a pilot allocation size, not an inference minimum). The other minors are in backlog E1d. |

### Coverage after the fix round (item 4)
Grid: the reviewer's 48 cells (theta 0.05/0.5/0.95 x judge (specificity, sensitivity) .6/.6, .7/.65, .55/.9, .9/.9 x (n, m0+m1) 30/10+10, 100/10+60, 100/60+10, 200/50+50) plus 24 of ours at the new minimum size (100/20+20, 100/20+60): 72 cells of 1000 datasets, nominal 95%. **Coverage is conditional on passing the gate; the skip rate is per cell in the test output.** Seeds: **424242** (the grid's seed, used to choose the gate) and **77031** (named before the confirmation run).
- Gate search on seed 424242 (simulation outside the suite, 48-cell grid): a Youden-style floor on the observed margin does not remove the failure, it moves it. Margin 0.3/0.4/0.5 with 20 per class leaves 2/3/4 cells under 93% among cells passing the gate 30+ times; a lower-confidence-bound floor was no better; 10 per class under-covers at every margin. Selection on the observed margin biases the interval for any judge whose true margin sits near the floor.
- 36 of the 72 cells are **refused regimes** by design: a calibration class under 20 (every cell with 10 per class) never passes the gate (skip 100%), so they have no coverage figure.
- The 36 assessed cells: seed 424242 pooled conditional coverage 95.28%, **8 cells under 93%**; seed 77031 pooled 95.28%, **7 cells under 93%**. The failing cells are almost all the weak judge (specificity 0.6, sensitivity 0.6, true margin 0.2: 66.7% to 88.2% where it fails, passing the gate in 11-24% of draws), plus a few cells of the .7/.65 judge at 92.3% to 92.9% (within about one SE of the floor and not the same cells on the two seeds). Lists are pinned in `NOT_MET` in the test, which fails if either list changes.
- **NOT MET** for those cells. I did not make the verdict refuse the weak regime: a higher observed-margin floor refuses the .6/.6 judge but fails more cells of the .7/.65 and .55/.9 judges (see the search above). Open decision for the controller: require a demonstrated margin of at least 0.5 (accuracy about 0.75) in policy and accept that the guarantee is only for judges that clearly pass it, or keep 0.3 and keep this caveat. Until judges are used nothing depends on it.

### Verification (fix round)
Load average 16-19 during every run below (heavy.sh). tsc: server and web clean.
- **Full vitest** (heavy.sh, run in parallel with the browser checks): 73 files, 2246 passed, **50 failed**, all the connection-cap family (`error: too many connections for role "axion"`, `admin connect failed`) in 7 files: `test/c09-minors.test.ts` (6), `test/contracts/coverage.test.ts` (4), `test/direct.test.ts` (16), `test/eval-evidence-db.test.ts` (11 plus a file-level `Called end on pool more than once`), `test/jobs.test.ts` (2), `test/policy-approvals.test.ts` (28), `test/tasks.test.ts` (6). Re-run serially (`--maxWorkers=1`) the seven files gave 192 passed and 3 failed: `test/direct.test.ts > direct channels > agent channel: honest note names the agent, unknown agent and agent:gm are 404` and `... > privacy: no one reads or writes another user's gm/agent channel; admin line of another user is admin-only` (first error `admin connect failed {"code":"INTERNAL"...}`) and `test/jobs.test.ts > concurrency > 20 parallel claimers over 50 jobs: each job is claimed exactly once, and the table agrees` (`too many connections for role "axion"`). `direct.test.ts` and `jobs.test.ts` re-run together serially: 87/87 passed. Strictly NOT MET (no clean single full run), and no failure touches files of this lane.
- **api-c47** 25/26 on the first run: `with an evaluation on the card, its override field and Promote are visible without scrolling the panel` (the layout check that also flaked on c53 at load 17); re-run alone: **26/26**. **api-c05** 31/31. **api-stage6**: the first run crashed (`TypeError: Cannot read properties of undefined (reading 'csrf')`, a sign-in failure in the script at load 19); re-run alone: **94/94**.
- **a11y** (UI changed: re-graded chip, unvalidated help, tooltips): `41 views, 65 dialogs, 0 violations`.
- Concern added: the c47 layout check is load-sensitive and the card now has up to two more chips (unvalidated, re-graded) on its first row; it wraps, but the check has failed once on this lane and once on c53.


### Fix round 2: controller ruling on item 4 (fail closed at margin 0.5)
Ruling: a corrected verdict is issued only for a judge whose adjusted sensitivity + specificity - 1 is at least **0.5** (`MIN_JUDGE_MARGIN`, a named policy constant in `judge-calibration.ts`); below it the verdict is inconclusive with `judge_too_weak`. The 72-cell grid was re-run on both seeds (RED: the pinned `NOT_MET` lists no longer matched, then pinned again).
- Seed 424242: 27 cells assessed (gate passes at least 30 of 1000), 45 refused regimes, pooled conditional coverage 94.46%, **12 cells under 93%**. Seed 77031: 27 assessed, 45 refused, pooled 94.64%, **13 under 93%**. Both lists are pinned in `NOT_MET` and the test fails if they change.
- **Honest reading.** The weak judges (true margin 0.2) are now refused almost everywhere. What still misses 93% is the judge of true margin about 0.35 (specificity .7, sensitivity .65) and 0.45 (.55, .9) when a lucky calibration set carries it over the 0.5 floor: selection bias again, only moved. The ruling is therefore **fail closed by policy, not a coverage guarantee for those judges**: the 93% target holds in the assessed cells of judges that clearly pass the margin (the specificity .9, sensitivity .9 judge, true margin 0.8, meets it in every cell on both seeds), and selection bias makes weak or middling judges unreliable even when they pass a gate. The help text for the evaluation card says so. Item 4 remains NOT MET for the cells marked below.

Per cell (cells where the gate passes fewer than 30 draws are refused regimes and omitted; per-cell skip rates are in the test output):

| cell (theta/specificity/sensitivity/n/m0+m1) | seed 424242: gate passes, conditional coverage | seed 77031: gate passes, conditional coverage |
|---|---|---|
