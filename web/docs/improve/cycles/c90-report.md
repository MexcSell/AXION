# c90 report: peek-safe sequential readout (R5-4), library and simulation only

## In plain words
"Peek-safe" means you may look at the result after every single observation and stop whenever you like, and the chance of
ever being fooled into seeing a difference that is not there stays at or below 5%. The usual interval is only honest if you
look once. If you re-check it after every new observation, a no-effect comparison looks "different" about 32-40% of the
time (measured below). The new module (`server/src/company/sequential.ts`) is a confidence sequence that stays honest
however often you look.

**The price is width, and power is very low at AXION volumes.** Median full width of the interval for the difference, with
no real effect (after the alpha correction below):

| n per arm | confidence sequence (p=0.1 / 0.3 / 0.5) | ordinary single-look 95% interval (p=0.3) |
|---|---|---|
| 20 | 0.99 / 1.35 / 1.50 | 0.56 |
| 50 | 0.68 / 0.93 / 0.93 | 0.36 |
| 100 | 0.54 / 0.66 / 0.65 | 0.25 |

A width above 1 at 20 per arm means the interval covers more than half of the whole possible range of the difference
(-1 to +1): at 20 per arm it tells you almost nothing. Share of streams that EVER exclude zero under a real effect
(seed 90001 / 90002, 1,000 streams per cell):

| true rates (before vs after) | n=50 per arm | n=100 | n=200 |
|---|---|---|---|
| 0.3 vs 0.5 (20-point gap) | 0.4% / 0.7% | 4.1% / 3.9% | 25.0% / 25.5% |
| 0.3 vs 0.7 (40-point gap) | 24.3% / 25.8% | 85.5% / 87.7% | 99.8% / 100.0% |
| 0.2 vs 0.8 (60-point gap) | 95.7% / 94.3% | 100% / 100% | 100% / 100% |

Plainly: a 20-point gap is almost undetectable below 200 per arm, and even at 200 per arm it is caught only about a
quarter of the time. Only large gaps (40 points or more) show up at 100 per arm. Small AXION comparisons will mostly
read "cannot tell yet". That is the honest answer, not a defect. Raw outputs: `c90-power-seed90001.txt`, `c90-power-seed90002.txt`.

**Nothing uses it yet.** It is a pure module with tests. No route, page, table or migration. A future readout (for
example on c85's plan lock) would call `sequence()` or `update()`/`readout()`.

## Method (committed first: `c90-method.md`, commit bdddb5e)
Howard, Ramdas, McAuliffe, Sekhon (2021) normal-mixture boundary, one per arm (Bernoulli is 1/4-sub-Gaussian), combined by a
union bound to 5% total. **Correction after review (commit `fix(c90): per-arm alpha/4`):** the 2·log(1/a) form is the ONE-sided
bound, so the first version (a = 2.5%) guaranteed only 10%. Now a = ALPHA/4 = 1.25% per arm (two-sided 2.5%), so the 5% claim
is true. Mixture width rho = 1.1320 (was 1.3153), by the same pre-committed rule, from the stated rule "optimal at 50 per arm"
(fixed before any code or run, never changed). Running bounds are intersected, so they are monotone (never widen). Below
`MIN_PER_ARM = 10` per arm it returns "not_enough_evidence" with no bounds. No stopping, no "significant" wording. Commit order is the
evidence: method note, then module and tests, then sim script, then runs.

## Simulation results (seeds 90001 and 90002; 1,000 no-effect streams per p, 200 per arm, checked after every observation from 10 per arm)
Limit for (a): 5% + 2 x Monte Carlo SE (0.69 points) = 6.38%.
Raw outputs: `c90-sim-seed90001.txt`, `c90-sim-seed90002.txt` (re-run after the alpha correction).

| seed | p | confidence sequence ever excludes 0 | naive 95% interval re-checked every observation |
|---|---|---|---|
| 90001 | 0.1 / 0.3 / 0.5 | 0.00% / 0.00% / 0.00% | 33.1% / 36.3% / 37.7% |
| 90002 | 0.1 / 0.3 / 0.5 | 0.00% / 0.00% / 0.00% | 31.7% / 39.0% / 40.1% |

, `c90-sim-seed90002.txt`. Load average 2.1 during both runs (0.2 s each).

## Pass threshold
- Items 1-5: PASS (method note; module; simulation with two seeds; naive contrast; unit tests).
- (a) PASS on both seeds and every p (0.00% against a 6.38% limit, re-run after the correction). 0% is far below 5%; the method is conservative.
- (b) covariate adjustment: NOT BUILT (optional in the brief). NOT MET as an item, not attempted. No post-change-variable check exists.
- Tests: 11 new (8 original, plus arrival order, [-1,1] clip, coverage under a 0.3 vs 0.5 effect) in `server/test/sequential.test.ts` (hand-checked rho and half-width, hand-checked 10 vs 10 case, below-minimum,
  one arm empty, all-0, all-1/all-0 eventually excludes zero, monotone bounds, input validation). GREEN. No RED run was
  recorded: tests and module were written together.
- tsc clean. Full serial vitest (re-run after the fix round; --maxWorkers=1 --no-file-parallelism, load average 7.0 at the end, 769 s): 173 files passed, 1 skipped; 3584 tests passed, 36 skipped, 0 failed.

## Concerns
- 0.00% is far below 5%: the method is very conservative (union bound plus a sub-Gaussian bound that ignores that
  proportions near 0 or 1 have small variance). The simulation shows validity, not power. A variance-adaptive or
  betting sequence would be tighter; that is a follow-up, not tried here.
- The null simulation alternates arms in equal numbers; unequal and bursty arrival orders are covered by a unit test (same bounds for any order at equal counts).
- Wide at small n, as the research verifier warned.

## Files
`server/src/company/sequential.ts`, `server/test/sequential.test.ts`, `server/scripts/c90-sequential-sim.ts`,
`web/docs/improve/cycles/c90-method.md`, `c90-sim-seed90001.txt`, `c90-sim-seed90002.txt`, `c90-power-seed90001.txt`, `c90-power-seed90002.txt`, `c90-report.md`.
