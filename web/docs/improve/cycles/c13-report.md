# Cycle 13 report (lane w11): honest experiment verdict

## Result
Pure `verdict(input)` in `server/src/evolution/verdict.ts`. Verified only when all hold: n >= minCases (5), mean delta >= margin (5 points),
losses <= wins (tie band 0.5), zero failed candidate answers, evaluator differs from author, same dataset hash on both runs.
Every unmet rule is a reason string. Output also carries the policy (version, thresholds, source) and the smallest detectable gain
(margin + 1.645 x se of paired deltas, plus the false-verify chance). Extra guards: policy set by the author is refused, invalid policy,
unpaired/duplicate cases, out-of-range scores. The frozen built-in policy v1 has source "built-in"; a custom policy must state its source.

## Evidence
- RED: `test/verdict.test.ts` failed with the module missing (no tests ran).
- GREEN: 39 tests in the file. One first-run failure was a mistake in my test (4 cases against minCases 5); fixed the test data to 6 cases, no rule changed.
- Full server suite via heavy.sh: 25 files, 370 tests passed. `tsc --noEmit` clean.

## Threshold
1. verdict.ts + >= 25 tests (39), every rule and boundary, reasons text, versioned policy with recorded source: PASS.
2. Optional route / help entry: NOT DONE (kept small; no fake data anywhere).
3. No model or process call: a test checks the source has no process, network or package imports. Suite green: PASS.
4. Whole suite green: PASS.

## Files
- server/src/evolution/verdict.ts (new)
- server/test/verdict.test.ts (new)
- web/docs/improve/cycles/c13-report.md (new)

## Concerns
- The purity test is a source-text check, not a dedicated runtime guard test; no separate execution guard test exists in the repo by that name.
- minCases 5 and margin 5 are my chosen defaults (reference uses 3 and 5). Adjust via a new policy version.
- Policy "cannot be changed by the author" is enforced only when setBy is supplied; the future caller must pass it.
- Never used git stash.
