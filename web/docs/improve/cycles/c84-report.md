# c84 report: judge calibration without selection bias (E1e)

Lane w82, branch `c84-judge-split`, from 5891ad7. Server only: `server/src/evolution/judge-calibration.ts`, tests, one simulation script and its outputs. No `web/` code, no migration, no route or DTO change. Nothing here calls a model, a provider or a database for the simulation; every number is a fixed-seed simulation.

## In plain words
c61 trusted a judge when its measured quality (sensitivity + specificity - 1, "the margin") was at least 0.5, and then used the same human labels to build the confidence interval. A middling judge mostly gets past that gate when its labels happened to look good, and those same lucky labels make its interval too tight. The result: in 12 to 13 of the 27 assessed cells the interval covered the truth only 67% to 93% of the time, against a promise of 95%.

The fix I wired in is **sample splitting**. Half of each class of labels decides whether the judge is good enough; the interval is built only from the other half, which the gate never looked at. Being let through then says nothing about how lucky the second half is.

The result is honest but not perfect. On both seeds, 29 of the 30 assessed cells now reach 93%. One cell does not (88% on both seeds), so one pin stays. The price is that intervals are wider (each half has half the labels), and an eligible judge with few labels often gets an interval that spans most of 0 to 1.

## What was conditioned on, and what was not (method note)
- **c61 gate:** conditioned on the estimated margin of all labels being at least 0.5, and used the same labels for the interval. That is selection on the data the interval is built from.
- **Split:** the interval is conditioned on the pilot half passing (this is independent of the holdout half apart from the fixed total counts) and on the holdout showing a margin above 0, which any finite interval needs. It is not conditioned on the holdout margin being large.
- **Fieller:** no gate. It uses all labels and gives no bound at all when the confidence set of the margin reaches 0.
- All coverage numbers are **conditional on being admitted** (the judge got an interval). A judge that is refused has no coverage figure, and that is the point of failing closed.

## Item 1: the c61 grid reproduced (PASS)
Same 72 cells (3 true pass rates x 4 judges x 6 sizes), 1000 simulated datasets per cell, same generator and per-cell seeds as the c61 test. Seeds 424242 and 77031, printed in the output files. All three methods see the same draws.

| seed | c61 gate: cells assessed | pooled coverage | cells under 93% |
|---|---|---|---|
| 424242 | 27 | 94.46% | 12 (same list as the c61 pin) |
| 77031 | 27 | 94.64% | 13 (same list as the c61 pin) |

Examples from the gate on seed 424242: theta 0.05, judge .7/.65, 200 test items, 50+50 labels: 76.7% (SE 6.44, 43 admitted); theta 0.95, same judge and size: 71.1% (SE 6.76); theta 0.05, judge .55/.9, 100 items, 20+60: 80.9% (SE 2.41). Full list per cell: `c84-sim-seed424242.txt`, `c84-sim-seed77031.txt`.

## The split rule (committed first)
Commit `bf94472` holds the rule and the two pure functions. The grid script came in the next commit, `141ea37`, so the rule was fixed before the grid ran with it. The rule: each class is halved (pilot gets floor(m/2), holdout the rest) by a fixed pseudo-random draw seeded only by the four calibration counts. Why a half: eligibility and interval need the same kind of information, and any other fraction would have to be tuned. Eligibility: at least 10 per class in the pilot and adjusted margin at least 0.5 (the c61 floor, unchanged). Interval: adjusted-Wald from the holdout only; the only test on the holdout is that it supports a finite interval (margin above 0). Fail closed: no interval, reason "not enough evidence". The 20-per-class total minimum is kept, which is exactly 10 + 10 per half.

Note on evidence: my first unit-test run of the pure functions failed twice (a bad Fieller point estimate and a case where an inverted judge got a bounded Fieller interval); both were bugs I fixed in the same commit before any grid ran. I did not keep a RED run from before the functions existed.

## Item 4: results (both seeds, three methods)
Simulation: 72 cells x 1000 datasets x 3 methods on the same draws, about 0.3 s per seed (load average 9.2 at run time). The 36 cells with under 20 labels in a class are refused by size for every method (same as c61). "Admitted" is the share of the 1000 datasets that got a bounded interval. A cell is PASS only if coverage is at least 93% and at least 30 draws were admitted; the Monte Carlo SE, sqrt(c(1-c)/admitted), is in the output files for every cell.

Summary of the 36 size-eligible cells, by judge quality (true margin = sensitivity + specificity - 1):

| judge (spec/sens, margin) | method | admitted share (seed 424242 / 77031) | cells PASS / NOT MET (424242) | (77031) |
|---|---|---|---|---|
| .6/.6 (0.2) | gate | 1% / 1% | 0 / 0, 9 refused | 0 / 0 |
| | split | 2% / 2% | 3 / 0, 6 refused | 3 / 0 |
| | Fieller | 37% / 37% | 5 / 4 | 6 / 3 |
| .7/.65 (0.35) | gate | 7% / 7% | 3 / 6 | 2 / 7 |
| | split | 11% / 11% | 8 / 1 | 8 / 1 |
| | Fieller | 79% / 78% | 9 / 0 | 9 / 0 |
| .55/.9 (0.45) | gate | 26% / 26% | 3 / 6 | 3 / 6 |
| | split | 25% / 24% | 9 / 0 | 9 / 0 |
| | Fieller | 95% / 96% | 9 / 0 | 9 / 0 |
| .9/.9 (0.8) | gate | 100% / 100% | 9 / 0 | 9 / 0 |
| | split | 98% / 98% | 9 / 0 | 9 / 0 |
| | Fieller | 100% / 100% | 9 / 0 | 9 / 0 |

Totals, cells with enough admitted draws, NOT MET cells and pooled conditional coverage:

| seed | method | cells assessed | cells under 93% | pooled coverage |
|---|---|---|---|---|
| 424242 | gate | 27 | 12 | 94.46% |
| | **split** | 30 | **1** | 97.70% |
| | Fieller | 36 | 4 | 96.14% |
| 77031 | gate | 27 | 13 | 94.64% |
| | **split** | 30 | **1** | 97.78% |
| | Fieller | 36 | 3 | 96.01% |

- **Split's one miss:** theta 0.05, judge .7/.65, 100 test items, 20 + 60 labels: 88.1% (SE 4.21, 59 admitted) on seed 424242 and 88.1% (SE 3.96, 67 admitted) on seed 77031. It is the same cell on both seeds, so I treat it as real. The holdout there holds only 10 human-positive items.
- **Fieller's misses:** all in the weakest judge (.6/.6) with 20+20 or 20+60 labels: 90.7%, 91.6%, 88.6%, 92.9% on seed 424242; 86.4%, 90.3%, 89.8% on seed 77031. The sets of cells differ between seeds, but the 20+20 cells fail on both.
- **Width:** median interval width is wider under split than under the gate in the same cell (for example .55/.9, 100 items, 20+20: 0.70 versus 0.49), and 1.000 (the whole range) in some weak-judge cells with 20+20 labels, where split admits a handful of draws. Fieller is narrower than split in most cells (it uses all labels) but admits far more weak judges.
- **Weak evidence flagged:** some PASS cells rest on few admitted draws (for example 34 admitted at 100% with SE 0.00, or 33 at 93.9% with SE 4.15). SE of 2 points or more means the PASS is only weakly established. These are the .6/.6 and a few .7/.65 cells; see the output files.

## Item 5: what is wired in
**Sample splitting** is wired in, behind the unchanged `correctedPassRate` interface: same inputs, same `RateEstimate`, same status values (a judge that is not eligible reports `judge_too_weak` with a "not enough evidence" reason), so `calibratedVerdict`, `calibratedEvaluation` and the DTOs are untouched.
- Choice rule, as the brief states it: the remedy that meets 93% with the least loss of admitted judges. Neither meets 93% in every assessed cell, so I took "the better one" by the plain count of cells under 93% on both seeds: split 1 and 1, Fieller 4 and 3. The split admits about as many judges as the old gate (within one point at three of the four quality levels, and 11% against 7% for the .7/.65 judge), so there is no real loss of admitted judges against c61.
- **The honest trade-off:** Fieller admits many more judges (about 79% of the .7/.65 judge against 11% for split) and passes every cell for the .7/.65 and .55/.9 judges. Its misses are in the weakest regime, where it admits judges that c61 policy wants refused. If the owner prefers more judges admitted over a fail-closed floor, Fieller on top of a pilot gate is a follow-up I did not run (it would be a new tuning step).
- `fiellerInterval` stays as a tested pure function, documented as the alternative. The c61 gate stays as `correctedPassRateGate`, used only as the simulation baseline and pinned with its old lists in the test.
- Behaviour change in the wired function: the point estimate and the interval come from the holdout half; the reported sensitivity and specificity still come from all labels. The old hand-checked closed-form test now runs against `correctedPassRateGate`, and a new test checks the split version against the holdout counts. That is the one existing test I edited in meaning; the others pass unchanged.
- **Pins:** the c61 `NOT_MET` lists (12 and 13 cells) are replaced by a split list of one cell per seed, `0.05/0.7/0.65/100/20+60`. Twelve cells on seed 424242 and thirteen on seed 77031 under the gate were removed, and all of those except that one reach 93% on both seeds under the split. The test still fails if the list changes in either direction, for both the split and the old gate.

## Item 6: docs
The method note is in the header of `judge-calibration.ts` and in this report.

## Pass threshold
| item | result | evidence |
|---|---|---|
| 1 reproduce the c61 grid, two seeds, pinned cells shown | PASS | c61 pins reproduced exactly (12 and 13 cells), list in the output files |
| 2 split implemented with tests, rule written and committed before the grid, fail closed | PASS | `bf94472` before `141ea37`; `server/test/judge-calibration-remedies.test.ts` |
| 3 Fieller implemented with tests (unbounded case, all-agree) | PASS | same test file, 13 tests in total with the split |
| 4 table per cell, both seeds, coverage with SE, admitted share, median width | PASS | `c84-sim-seed424242.txt`, `c84-sim-seed77031.txt` (all 72 cells x 3 methods) and the summary above |
| 5 one remedy wired, c61 tests green except honest pin removal | PASS | split wired; the pins that remain are one cell. Coverage in every assessed cell: **NOT MET** (88.1% in one cell, both seeds) |
| 6 docs | PASS | header and report |
| full serial vitest | PASS | `heavy.sh npx vitest run --maxWorkers=1 --no-file-parallelism` on the code of `e6a24d2`: 153 files passed, 1 skipped; 3430 tests passed, 36 skipped, 0 failed (load average 8.5 at start, 10.7 at end, about 10 minutes) |
| tsc clean | PASS | `npx tsc --noEmit -p .` |
| diff stat: no web code, no migration | PASS | only `server/` files and `web/docs/improve/cycles/` notes (docs, not web code) |

## Concerns
- The wired split still misses one cell (88%). It is one cell of 30, but it is not on the old list of "weak judge only": it is a mid-quality judge with 10 positives in the holdout.
- Splitting halves the labels, so with 20 per class the holdout has 10, and eligible judges there often get a very wide interval (up to the whole 0 to 1). Raising the minimum is a policy question and would be tuning against this grid, so I did not.
- The split is a deterministic draw from the four counts rather than a split by item, because the function sees only the 2x2 table. The simulation runs the real wired function, so that is what was tested.
- Cells are small-sample Monte Carlo (1000 draws, admitted often a few dozen to a few hundred): a cell around 93% to 95% can fall under on another seed.

## Files changed
- `server/src/evolution/judge-calibration.ts` (split rule, `splitCalibration`, `splitInterval`, `fiellerInterval`, wiring, method note)
- `server/test/judge-calibration.test.ts` (pins, two methods, one hand-check test moved to the gate)
- `server/test/judge-calibration-remedies.test.ts` (new, 13 tests)
- `server/scripts/c84-coverage-sim.ts` (new)
- `web/docs/improve/cycles/c84-sim-seed424242.txt`, `c84-sim-seed77031.txt`, `c84-report.md`
