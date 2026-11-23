# c95 review: CLEAR (3 minor findings, 0 blocker, 0 major)

Verified: tsc clean; the 92 c95 tests plus my 5 scratch probes ran (scratch file deleted, tree clean, no DB, no web change).

1. Order: real. 70aeb12 (bound) -> 481caa5 (specs) -> c0b20ba (RED stub, always-continue) -> 9758d03 (checker). `git diff 70aeb12 HEAD` on run-caps.ts contracts is empty; fixture-specs.ts has a single commit. Nothing changed after the checker existed.
2. Checker: caps are enforced at cap (steps, wall, rate, origins, money, tokens all count the step's own estimate); the +1 comes only from an under-estimate or a wall step begun before the deadline. Probes: est 0 passes money but steps still bound; negative or NaN actual cost is caught as bad_input next step (fail closed); counter at MAX_SAFE_INTEGER stops; wall exactly at cap stops; halt is checked first; latch holds 70 s later; equality fencing matches c45 (`lease_token=$3`; requestCancel is a flag only, no bump); partial or missing caps at stage 2 or 3 give caps_missing.
3. Zero after halt: limit stated plainly in contracts header B3 and the report (atomic check+effect, "not built"). Negative control is real (skip commit re-check -> violations > 0, excluded from counts). Minor: the report does not say that a real store needs the re-check inside the same SQL statement or transaction as the effect.
4. Fixtures: 29 = 8+6+7+5+3 counted from the spec; 630/630/30/6 = 1296 re-derived and correct; generators run in the test; counts committed before any run.
5. Wording: engineering control, not evidence, nothing executes, no digest binding. Correct.
6. Scope: module, contracts plus one export line, tests, report. No route, no migration, no web code.
7. c82-pixel.mjs:7 contains a 5190 default; the file is untouched by this branch (last change fd28d4b, outside the range). Unrelated.

## Findings
- F1 (minor): the +1 slack is never exercised. For the two hidden-spike fixtures, capSteps is set equal to accepted (3 and 2), but "steps the tightest cap allows in actual terms" would be 2 and 1, so accepted = cap+1 there. The assertion `accepted <= capSteps+1` is vacuous for those. Evidence: fixture-specs.ts spend-hidden-spike, tokens-hidden-spike. Fix: set capSteps 2 and 1, and update the why text.
- F2 (minor): rate window ignores out-of-order time. After calls at 100000 and 100001 with limit 2, a proposal at atMs 50000 continues (probe), because the filter keeps only t <= atMs. Fix: refuse step.atMs < the latest callTimesMs (bad_input), or count all calls with t > atMs-60000.
- F3 (minor): origin strings are compared raw. "A.test" vs "a.test" counts as two origins (over-counts, so it is safe), and the caller must pre-normalise with normaliseOrigin. recordRunStep does not validate outcomes (negative or NaN is caught only at the next check). Fix: document both in the module header and add one test.
