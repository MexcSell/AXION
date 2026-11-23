# c90 report: peek-safe sequential readout (R5-4), library and simulation only

## In plain words
"Peek-safe" means you may look at the result after every single observation and stop whenever you like, and the chance of
ever being fooled into seeing a difference that is not there stays at or below 5%. The usual interval is only honest if you
look once. If you re-check it after every new observation, a no-effect comparison looks "different" about 32-40% of the
time (measured below). The new module (`server/src/company/sequential.ts`) is a confidence sequence that stays honest
however often you look.

**The price is width.** Intervals are wide at AXION volumes. Median full width of the interval for the difference, with
no real effect:

| n per arm | confidence sequence (p=0.1 / 0.3 / 0.5) | ordinary single-look 95% interval (p=0.3) |
|---|---|---|
| 20 | 0.94 / 1.29 / 1.41 | 0.56 |
| 50 | 0.64 / 0.87 / 0.86 | 0.36 |
| 100 | 0.52 / 0.61 / 0.60 | 0.25 |

(A width over 1 at n=20 is real: it is wider than the whole useful range of -1 to +1 would suggest, because each arm is
bounded separately and the two are combined. At 20 per arm the readout says almost nothing.) At 100 per arm a true gap
of about 30 points or more is needed before the interval excludes zero. Small AXION comparisons will mostly read "cannot
tell yet". That is the honest answer, not a defect.

**Nothing uses it yet.** It is a pure module with tests. No route, page, table or migration. A future readout (for
example on c85's plan lock) would call `sequence()` or `update()`/`readout()`.

## Method (committed first: `c90-method.md`, commit bdddb5e)
Howard, Ramdas, McAuliffe, Sekhon (2021) normal-mixture boundary, one per arm (Bernoulli is 1/4-sub-Gaussian), alpha 2.5%
per arm, combined by a union bound to 5% total. Mixture width rho = 1.3153, from the stated rule "optimal at 50 per arm"
(fixed before any code or run, never changed). Running bounds are intersected, so they are monotone (never widen). Below
10 per arm it returns "not_enough_evidence" with no bounds. No stopping, no "significant" wording. Commit order is the
evidence: method note, then module and tests, then sim script, then runs.

## Simulation results (seeds 90001 and 90002; 1,000 no-effect streams per p, 200 per arm, checked after every observation from 10 per arm)
Limit for (a): 5% + 2 x Monte Carlo SE (0.69 points) = 6.38%.

| seed | p | confidence sequence ever excludes 0 | naive 95% interval re-checked every observation |
|---|---|---|---|
| 90001 | 0.1 / 0.3 / 0.5 | 0.00% / 0.00% / 0.00% | 33.1% / 36.3% / 37.7% |
| 90002 | 0.1 / 0.3 / 0.5 | 0.00% / 0.00% / 0.00% | 31.7% / 39.0% / 40.1% |

Raw outputs: `c90-sim-seed90001.txt`, `c90-sim-seed90002.txt`. Load average 2.1 during both runs (0.2 s each).

## Pass threshold
- Items 1-5: PASS (method note; module; simulation with two seeds; naive contrast; unit tests).
- (a) PASS on both seeds and every p (0.00% against a 6.38% limit).
- (b) covariate adjustment: NOT BUILT (optional in the brief). NOT MET as an item, not attempted. No post-change-variable check exists.
- Tests: 8 new in `server/test/sequential.test.ts` (hand-checked rho and half-width, hand-checked 10 vs 10 case, below-minimum,
  one arm empty, all-0, all-1/all-0 eventually excludes zero, monotone bounds, input validation). GREEN. No RED run was
  recorded: tests and module were written together.
- tsc clean. Full serial vitest: see the hand-back message for the count.

## Concerns
- 0.00% is far below 5%: the method is very conservative (union bound plus a sub-Gaussian bound that ignores that
  proportions near 0 or 1 have small variance). The simulation shows validity, not power. A variance-adaptive or
  betting sequence would be tighter; that is a follow-up, not tried here.
- Only validity under no effect was simulated; coverage under a real effect and power were not.
- Streams alternate arms in equal numbers; unequal or bursty arrival was not simulated (the bound itself is valid for any order).
- Wide at small n, as the research verifier warned.

## Files
`server/src/company/sequential.ts`, `server/test/sequential.test.ts`, `server/scripts/c90-sequential-sim.ts`,
`web/docs/improve/cycles/c90-method.md`, `c90-sim-seed90001.txt`, `c90-sim-seed90002.txt`, `c90-report.md`.
