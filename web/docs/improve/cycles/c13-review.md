# Cycle 13 review (lane w11): experiment verdict

Spec verdict: PARTIAL (all six rules and the 25+ tests are met; the "author can't change the policy" requirement is only decorative).
Quality verdict: good, one Important fix needed.

## Rules (server/src/evolution/verdict.ts)
- n >= minCases: L178 (n counts only pairs scored on both sides); reason text L179. Boundary tested (test 71-80). OK.
- mean delta >= margin: L181 `delta < margin` fails, so delta == margin passes. Raw delta compared, rounded only in text. OK.
- losses <= wins: L186 `losses > wins`; tie band strict (L175-176). OK.
- zero failed candidate answers: L163-166, L187. Counted from every null candidate score, even when unpaired. OK.
- evaluator != author: L130-134, trimmed and case-insensitive; missing either is a reason. OK.
- same dataset hash: L135-139; missing hash is a reason. OK.
- Extra, sound: duplicate ids, unpaired cases, scores outside 0..100 all become reasons. verified = no reasons && n>0 (L200).
- Detectable gain: se = sd/sqrt(n) of paired deltas with n-1 sample sd (L192-196); gain = margin + 1.645 se is the true gain that passes the margin 95% of the time; falseVerify = 1 - Phi(margin/se) = 0.5 erfc(margin/(se sqrt2)) with A&S 7.1.26. Math is correct. It is informational only and does not gate the verdict (matches the brief).
- Purity: no imports, no I/O, no calls. Test at verdict.test.ts:299.

## Execution guard
The guard exists: server/test/approvals.test.ts:102 'no server module imports a process, browser or model runner'. It walks every .ts under server/src recursively (L104-105), so src/evolution/verdict.ts IS covered, and nothing in it matches the banned regex. The implementer's concern that no such test exists is wrong; the extra source-text test is harmless redundancy.

## Findings
- Important (I1): the policy guard is decorative. `policy` is a caller-supplied field and `setBy` is optional (verdict.ts:16, L109). A policy with no `setBy` and any non-empty `source` is accepted, e.g. {minCases:1, margin:0, source:'x'} returns verified (test at verdict.test.ts:36-39 even locks in acceptance of a custom policy with no setBy). Also a custom policy may claim `version: 1` with different thresholds. Fix: a non-built-in policy must carry a non-empty `setBy` (reject when missing), and a policy claiming version 1 must equal EVALUATION_POLICY_V1; better, accept only a policy identifier resolved from a trusted registry by the caller. Add tests for missing setBy and for a forged v1.
- Minor (m1): the setBy check is skipped when authorId is empty (L109); harmless since a missing author is already a reason.
- Minor (m2): setBy comparison catches only exact author id; a setBy that is a different alias of the author is not detectable in a pure function; the caller must pass the real identity (document it).
- Minor (m3): detectableGain with se=0 and margin 0 gives falseVerify 0.5; harmless.
- Minor (m4): baseline failures silently drop pairs (reduce n) without a reason beyond n < minCases; tested and acceptable.
- Minor (m5): defaults minCases 5 and margin 5 are fixed before the change and are stricter than reference (3); fine.

## Tests
39 tests in server/test/verdict.test.ts assert real outcomes (boundaries, reason text, math, no mutation, determinism). Exceeds 25. Missing only the policy tests in I1. Route and help entry not done (optional). No fake data.
