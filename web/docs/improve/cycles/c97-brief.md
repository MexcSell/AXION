# c97 brief: outcome graders and tamper detector on toy tasks (R6-7, first slice)

**Lane:** w95 (`/home/luca/AXION-w95`, branch `c97-outcome-graders`), from improve-30h at the commit that adds this brief. Ports 14590–14593. E2E DB **axion_e2e5** (reused; edit the lane `server/.env` after `new-lane.sh`). **A pure server module, fixtures and tests. No route, no migration, no `web/` change, no model calls.**

**Sources:**
- `phase2/research-r6.md` §R6-7 and `phase2/research-r6-verified.md` §R6-7. The verifier's limits are binding:
  - **"toy tasks test the harness, not any agent"**;
  - report the detector rates with n, as fixture-only;
  - keep the C2 benchmark numbers out of any claim about AXION tasks.
- The eval lab (`server/src/evolution/eval-runs.ts`, `judge-calibration.ts`) for naming and style. Don't change them.

**HARD RULE:** never connect to, query or read the live `axion` database in any form. Graders run on in-memory fixture states only, with no filesystem writes outside a temp dir you create and remove.

## Items (each its own commit; thresholds and the seeded-hack design committed before the runs)
1. **Grader interface** (`server/src/evolution/outcome-grader.ts`). A deterministic grader checks an **end state** (an in-memory record of files and their hashes, rows and fields, a page-state fixture), never the agent's statement. Each grader ships with a reference solution that must pass and a null solution that must fail.
2. **10 toy tasks** with graders and reference and null solutions. Threshold (a): every grader passes its reference and fails its null, in 100% of the 10.
3. **Grader validity.** A grader whose pass rate is 0% or 100% over 10 or more trials of varied solutions is flagged. Threshold (c): a broken grader that fails its passing reference is flagged.
4. **Tamper detector** over recorded fixture trajectories (scripted step lists). It flags:
   - writes to grader or evaluator files, the clock, or test directories;
   - reads of "answer" paths;
   - outputs equal to a stored answer;
   - anomalously high scores queued for human review.
   Threshold (b): it flags ≥ 90% of 40 seeded-hack trajectories with a false-flag rate ≤ 10% on 40 clean ones. Report both with n and Wilson intervals.
5. **Trial isolation.** A seeded cross-trial leak (a file left by a prior trial) is caught in 100% of fixtures (threshold d).
6. **Report pass^k next to pass@k** for the toy runs.

## Pass threshold
- Items 1–6 with the thresholds met, or NOT MET honestly.
- Full serial vitest with no failure, or every failure named.
- tsc clean.
- Diff stat: module, fixtures, tests and the report.

## Report
`cycles/c97-report.md`, in plain words: "tests the harness on toy tasks; real tasks need agents to execute". **Deadline:** hand back by about 15:00Z.
