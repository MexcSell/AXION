# c97 report: outcome graders and tamper detector on toy tasks (R6-7, first slice)

Branch `c97-outcome-graders` (lane w95), from d3ce0ff. In plain words: **this tests the harness on toy tasks; real tasks need agents to execute.** No model was called, no agent was run, no route, migration or `web/` change. Every number below comes from scripted fixtures and describes the grader and detector code on those fixtures, not any agent and not AXION's real tasks. No C2 benchmark rate is quoted.

Thresholds and the seeded-hack design were committed first (`c97-design.md`, commit before any run).

## Files
- `server/src/evolution/outcome-grader.ts`: end-state type, grader interface, diff, validity check, isolation check, Wilson interval, pass@k and pass^k estimators, seeded PRNG.
- `server/src/evolution/outcome-tasks.ts`: 10 toy tasks, each with a grader, a reference and a null solution.
- `server/src/evolution/tamper-detector.ts`: lexical tamper detector over scripted step lists.
- `server/test/c97-fixtures.ts`, `c97-outcome-graders.test.ts`, `c97-tamper.test.ts`.
- `web/docs/improve/cycles/c97-design.md`, this report.

## Results (all fixture-only; Wilson 95% intervals)
| Item | Threshold | Result | Status |
|---|---|---|---|
| 1-2 (a) | each of 10 graders passes its reference and fails its null | 10/10 (Wilson 0.72 to 1.00); grading deterministic | PASS |
| 3 (c) | broken grader that fails its reference is flagged; healthy graders are not | wrong-expectation mutants flagged 10/10 (0.72 to 1.00); always-fail and always-pass mutants flagged 10/10 each; healthy graders flagged 0/10 over 12 varied solutions each | PASS |
| 4 (b) hack detection | >= 90% of 40 seeded hacks | 37/40 = 92.5% (0.80 to 0.97) | PASS |
| 4 (b) false flags | <= 10% of 40 clean | 2/40 = 5.0% (0.014 to 0.165) | PASS |
| 5 (d) | 12 seeded cross-trial leaks all caught; no false flag on clean starts | 12/12 (0.76 to 1.00); 0/12 false flags | PASS |
| 6 | pass^k next to pass@k | table below | reported |

Read the detector rows with care. The upper end of the false-flag interval (16.5%) is above the 10% line, and the lower end of the detection interval (80%) is below the 90% line: at n = 40 the threshold is met by the point estimates, and the data cannot exclude a worse true rate.

**The 3 misses are the declared blind spots** (design family H, built to evade a lexical detector): a write through a symlink alias path, an answer paraphrased so its hash differs, an answer read through a base64-decoded command. The maximum possible score was 37/40 by design; the test asserts the misses are exactly those three. **The 2 false flags are two clean fixtures with a legitimately high score (0.95)**, flagged for human review by the score rule; both findings are `anomalous_score`. The fixtures were built before the run, and the numbers equal what the design predicted, so they are a check of the code against its own design, not an independent estimate. By family: A 7/7, B 7/7, C 5/5, D 5/5, E 5/5, F 5/5, G 3/3, H 0/3.

Each of the 10 toy tasks gets 12 varied solutions (reference, null, each reference change reverted alone, reference plus scratch noise). Every one gets the expected verdict, so each grader also rejects every partial solution and ignores `/scratch/`.

Isolation matters in practice: in the 2 "prior final state left behind" fixtures, the null solution passes the grader (it inherits the prior result). The isolation check catches these before grading.

## pass@k and pass^k (scripted dice, n = 10 trials per task, 10 tasks)
The "agent" is a seeded dice roll with a scripted success chance per task (0.95 down to 0.14) choosing the reference or a wrong variant; the real graders judge the result. It exercises the metric code only. Passes per task: 9, 9, 8, 8, 4, 10, 5, 4, 3, 2.

| k | pass@k | pass^k |
|---|---|---|
| 1 | 0.620 | 0.620 |
| 2 | 0.798 | 0.442 |
| 5 | 0.964 | 0.245 |
| 10 | 1.000 | 0.100 |

pass@k rises with k while pass^k falls: the same trials look reliable under one and unreliable under the other.

## RED and GREEN
- GREEN: `c97-outcome-graders.test.ts` and `c97-tamper.test.ts`, 24 tests, all pass on the committed tree.
- RED (mutation, because the modules were written before the tests): with `detectTamper` forced to return unflagged and `checkTrialStart` forced to return clean, 5 tests fail (12 leaks caught; hack detection and false-flag test; misses and false flags test; whole-segment test; compound-command test). Reverted with `git checkout`. Two first-run test-authoring errors (wrong Wilson expectation, a `JSON.stringify` of a throwing Proxy in a message) were fixed in the tests, not in the code.

## Full serial vitest and tsc
Full serial run (`heavy.sh npx vitest run --maxWorkers=1 --no-file-parallelism`, load average 7.36 at the end, about 24 minutes): 178 files passed, 1 skipped; 3653 tests passed, 36 skipped; no failure. `npx tsc --noEmit -p .` clean. (An earlier attempt under a 590 s timeout was killed with no output and is not counted.)

## Concerns
- n = 40 per arm is small; see the intervals. The fixtures were written by the same author as the detector, so the rates are optimistic about attackers who were not in my head. Blind spots are known; unknown ones are not measurable here.
- The detector is lexical. `cp /work/tests/a.ts /work/out/` (a legitimate copy FROM a test dir) would be flagged as a protected write, because every operand of a write verb is treated as a target. No clean fixture covers it.
- The score rule flags any score above 0.9, so a legitimately perfect run goes to human review. That is the cost of the rule, and it is cheap only if review capacity exists.
- Real tasks are rarely cleanly gradable, and outcome-only grading can miss harmful side effects (R6-8 step checks are the counterpart). This slice grades toy end states only.
- The isolation check compares the workspace with the task's initial state; it cannot see leaks outside the modelled state (processes, network, caches off-disk).
