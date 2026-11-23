# c91 report: skill promotion gate (R5-5), pure module on synthetic data

**This tests the gate, not any skill.** Every score here is made up by a seeded random generator. No skill was written or scored, no model was called, no database was read, nothing calls the gate yet.

Branch `c91-skill-gate` from `17c5ee8`. Files: `server/src/evolution/skill-gate.ts`, `server/test/skill-gate.test.ts`, `server/scripts/c91-gate-fixtures.ts`, `cycles/c91-gate-results-seed20261123.txt`, `cycles/c91-gate-results-seed91.txt`, this report. No route, DTO, migration or `web/` change.

## Commit order (evidence)
1. `6329927` gate module with its constants, and the unit tests (written first; RED was "no tests, import fails" before the module existed, then 21 passed).
2. `a4c3088` the fixture design and runner, with the design written in its header. Not run until after this commit.
3. The two result files and this report, after the runs.

## Constants (named, exported, documented in the module header)
Margin on probe A 0.03; margin on probe B 0.03; regression budget 0.02 per class on replay; at least 20 items per class on every set (both arms); at most 20 candidates per probe A. They are choices, not derived from any source. A gain must be strictly above its margin; a loss exactly at the budget is allowed.

## What each check protects against
- Gain on A: a skill that does nothing useful.
- Gain on B (held out, never shown to the generator): a candidate that won on A by luck or by tuning. This is the required second probe.
- Replay budget per class: a skill that helps on average and breaks one kind of work. A big gain elsewhere does not buy it back.
- Leakage: a skill written from the same tasks it is scored on.
- Minimum items: a verdict from too few items is "not enough evidence", not a pass or a quiet refuse.
- Attempt cap (`checkAttemptCap`, and `probeAAttempts` in the gate): many candidates against one probe A will eventually beat it by chance; after 20 it must be replaced. Probe B is the fresh check in between.
- A contract text and at least one evidence id are required.
The verdict "admit" only means "may go to a human". Nothing here activates a skill.

## Fixture results (design: 4 classes, 40 items per class per set, incumbent 0.60, item sd 0.15, paired; 50 candidates per kind, 300 per seed)
Both seeds (20261123, 91), counts out of 50:

| kind | seed 20261123 admit / refuse / not enough | seed 91 admit / refuse / not enough |
|---|---|---|
| true gain | 50 / 0 / 0 | 50 / 0 / 0 |
| no gain, noise | 0 / 50 / 0 | 0 / 50 / 0 |
| harmful on one class | 0 / 50 / 0 | 0 / 50 / 0 |
| gain only on A (overfit) | 0 / 50 / 0 | 0 / 50 / 0 |
| leaky evidence | 0 / 50 / 0 | 0 / 50 / 0 |
| too-small probe | 0 / 0 / 50 | 0 / 0 / 50 |

Overfit candidates refused by the probe B check: 50/50 and 48/50 (all 50 were refused overall; the other two seed-91 ones failed on replay).

## Pass threshold
- Item 1 gate module: PASS. Item 2 repeated-candidate correction (probe B fresh check plus cap of 20 as a pure check): PASS.
- Item 3 fixtures, 300 candidates per seed, results saved: PASS.
  - True gain admitted 100%: MET both seeds.
  - Harmful on one class refused 100%: MET. Leaky refused 100%: MET.
  - Overfit refused by probe B in at least 90%: MET (100% and 96%).
  - No-gain false-admit rate against the stated bound of 2%: 0/50 on both seeds, MET.
  - Too-small never admitted (all "not enough evidence"): MET.
- Item 4 unit tests: PASS, 21 tests: each reason path, exactly at the margin (refuses), exactly at the budget (allowed), one over the budget, exactly the minimum items (enough) and one under, purity.
- tsc clean: PASS. Full serial vitest (`--maxWorkers=1 --no-file-parallelism`, load average 9.5 at the end, 13m38s): 172 files passed, 1 failed; 3593 tests passed, 1 failed, 36 skipped. The one failure: `test/playbooks.test.ts` "the skill lock key folds case in SQL ... (H10 item 1)", first error line `error: too many connections for role "axion"` (the known shared-role cap, BACKLOG H14, plus an afterAll hook timeout). Re-run alone: 78/78 passed. The new file `skill-gate.test.ts` passes 21/21. PASS with the failure named.

## Honest limits
- The fixtures are easy. Paired item noise is small (class-balanced gain sd is about 0.012), so a margin of 0.03 is about 2.5 sd and no-gain candidates fail on A alone every time (50/50 on both seeds). Analytically the chance that a no-gain candidate passes both A and B is about 4e-5. A 0% false-admit rate here says little about real tasks, where scores are noisier (unpaired items, 0/1 outcomes at sd about 0.5 per item would give a sd near 0.056 and a false-admit rate of a few percent). The bound of 2% was chosen before the run and is not tested at that noise level.
- The fixtures only show the gate does what its rules say. They do not show the margins are right for real work; that needs real scores (EXEC).
- Probe B is spent a little by every candidate that reaches it. The cap covers probe A only; B needs its own refresh rule once real candidates exist. No R5 source supports a specific cap or margin number, and the verifier found no source for admission-time verification, so this report does not claim one.
- Leaky and too-small candidates were built from true-gain scores, so they show the check fires, not that the other checks would have passed them.

## Still EXEC (needs real use)
Real skill scores; whether 20 items per class and the margins fit real variance; the owner's regression budget per class (open owner question from R5); gate-run records (append-only table, R5-5 threshold d) are not built here; a human activation step; probe rotation and retirement.
