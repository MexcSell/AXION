# c90 brief: peek-safe sequential readout, library and simulation only (R5-4)

**Lane:** w88 (`/home/luca/AXION-w88`, branch `c90-sequential`), from improve-30h at the commit that adds this brief. Ports 13890–13893. E2E DB **axion_e2e17** (reused; edit the lane `server/.env` after `new-lane.sh`). **One pure module plus tests and a simulation script. No route, no DTO, no migration, no `web/` change, no data dependency.**

**Sources:**
- `phase2/research-r5.md` §R5-4 and `phase2/research-r5-verified.md` §R5-4. The verifier's limits are binding: a library function with the simulation suite only, no page, no data dependency; say clearly that intervals are wide; acceptance is by simulation, not by the papers.
- c85 (`server/src/organization/plan.ts`, the plan lock) for how a future readout would call this module. Don't wire it in.
- c84's simulation style (`server/scripts/c84-coverage-sim.ts`): fixed printed seeds, rule committed before the run.

**HARD RULE:** never connect to, query or read the live `axion` database in any form. No model or provider calls.

## Items (each its own commit; commit the method and thresholds before running the simulation)
1. **Method note (commit first).** Pick one anytime-valid method for the difference of two proportions: a confidence sequence, or e-values with a stated mixture or betting form. Name the source in the code header, and state alpha (5%). Choose the tuning (mixture width, prior or betting fraction) by a stated rule, **before** any simulation; the commit order is the evidence.
2. **Pure module** `server/src/company/sequential.ts`.
   - Input: a stream of (arm, outcome∈{0,1}) observations, or before/after.
   - Output, at every step: the current lower and upper bound on p_after − p_before, and whether 0 is excluded.
   - No automatic stopping, no "significant" wording. Below a stated minimum per arm it returns "not enough evidence".
   - Optional, only if time allows: a pre-period covariate adjustment as a separate function, with the "post-change variable refused" check from the research file's threshold (c).
3. **Simulation** `server/scripts/c90-sequential-sim.ts`, run with two fixed seeds. Thresholds from the research file:
   - (a) on 1,000 simulated no-effect streams, checked after every observation, the share that ever exclude zero is ≤ 5% plus the Monte Carlo error (state it);
   - (b) if the adjustment is built: adjusted intervals are narrower than unadjusted with no loss of coverage, in ≥ 90% of seeds, when the pre-period correlation is ≥ 0.5;
   - also report the median interval width at n = 20, 50 and 100 per arm, so the "wide at small n" warning is quantified.
   Save the outputs under `cycles/`.
4. **Contrast:** show that a naive fixed-horizon interval re-checked after every observation exceeds alpha on the same streams. This is the "peeking" error the module prevents. Report its rate.
5. **Unit tests:** degenerate streams (all 0, all 1, one arm empty), monotone validity of the bounds (state whether you intersect running bounds), and a hand-checked small case.

## Pass threshold
- Items 1–5 done.
- (a) met on both seeds, or NOT MET stated honestly.
- Full serial vitest with no failure, or every failure named.
- tsc clean.
- Diff stat: the new module, its tests, the sim script and outputs, the report; nothing else.

## Report
`cycles/c90-report.md`, in plain words for the owner: what "peek-safe" means, how wide the bounds are at AXION volumes, and that nothing uses it yet. **Deadline:** hand back by about 13:00Z.
