# c90 review: NOT CLEAR (one major, fixable in minutes)

Checked: tsc clean; 8 new tests pass; hand values reproduced (rho 1.31533, armHalfWidth(10) 0.56755). Diff scope is clean (module, tests, sim script, outputs, report, method note); no route, DTO, page or migration.

1. MAJOR: the alpha claim is wrong by a factor of two. sequential.ts:23-24, 32 and c90-method.md say each arm uses a = 2.5% two-sided. The boundary sqrt((v+rho)(log((v+rho)/rho)+2log(1/a))) is the ONE-sided Howard et al. normal-mixture bound at level a. Used as |S_t| it is two-sided at 2a = 5% per arm, so the union bound over two arms gives 10%, not 5%. The 0.00% simulation is consistent with it only because the sup-over-time loss, the Hoeffding 1/4 proxy and the union bound are all slack. The proven guarantee is 10%. Fix: ARM_ALPHA = ALPHA/4 (L = ln(80)), recompute rho and the test values. Widths grow about 7%. Or keep the code and state "guaranteed at most 10%, observed 0%". The rule would have to be re-committed visibly, and the interval has not been tuned on any result, so the integrity is preserved.
2. Otherwise the method is valid. The sub-Gaussian proxy 1/4 and v = n/4 are correct. rho only sets the tuning point. Rho formula = Howard's optimal-at-t* closed form, applied with the one-sided alpha. Two per-arm sequences are each time-uniform in their own sample index, so the union is valid at every stopping time and any interleaving. Intersecting running bounds and clipping to [0,1] are valid.
3. Tuning order: GOOD. bdddb5e (09:48:14) fixes rho and the plan; module and sim script follow; runs come after the 36a6f6b cleanup. The rule is not changed afterwards.
4. Simulation: GOOD. It imports the real module; it checks every observation from 10 per arm; seeds are printed; the naive Wald contrast runs on the same streams and handles se=0 sensibly. Single-look Wald widths are a fair reference, labelled as such. Minor: the sequential.ts:20 header says full width at 100 per arm is "roughly 0.5", but the sim shows 0.52-0.61. The report's "wider than the useful range" sentence about width over 1 is muddled (script/report).
5. Honesty: mostly good. The report says "wide" and "validity, not power", and gives the 0.30 gap at 100. MINOR: it never says plainly that this is very low power. MINOR: the 10-per-arm floor is stated in the code (MIN_PER_ARM) and the method note, but the report does not name it as a constant.
6. Power check, recommended and cheap (0.2 s). I ran it with the real module (1000 streams, equal n per arm, ever-exclude by n):
   - 0.3 vs 0.5: 0.4% (n=50), 8.6% (100), 35.8% (200).
   - 0.3 vs 0.7: 37% (50), 91% (100), 100% (200).
   - 0.2 vs 0.8: 96% (50), 100% (100).
   Add a table like this to the report. It states the real cost: a 20-point gap is almost undetectable below 200 per arm.
7. Tests: MINOR gaps. No test for unequal arrival or interleaving order, for the clip bounds [-1,1], for extreme n (n=0 gives Infinity, never reached), or for a coverage check under an effect. No RED run recorded (report states this). Intersection monotonicity is tested; degenerate and validation cases are covered.

Verdict: NOT CLEAR until finding 1 is fixed or the guarantee is restated at 10%. Everything else is minor.
