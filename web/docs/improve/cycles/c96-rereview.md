# c96 scoped re-review (b14cbf3..1798f15): CLEAR, with one new minor

This is the controller's copy of the hand-back. tsc is clean, and exec-plan.test.ts passes 95/95.

1. **Untrusted narrowing: CLEAR.**
   - An untrusted subset, or an `omitNarrows` argument, gives `deny:untrusted_narrowing`.
   - With user provenance, an empty `subsetOf` needs approval, and an omitted exact argument gives `missing_arg`.
   - User narrow-allow occurs only for a non-empty strict subset, or a declared `omitNarrows`, and never grants more than the plan approved.
2. **T-b: CLEAR.** On the shop plan, 6 of 240 injected calls are allowed; on the form plan, 2 of 240. These are in-plan calls, and the report says plainly that a plan check can't stop them.
3. **Mapper: CLEAR.** It is faithful, and every `extra_arg` denial is carried by the corpus action itself.
4. **Minors: CLEAR.** Integer ranges, case-insensitive forbiddenTools, `subsetOf` labelling and the stub test all work.
   - **New gap:** `normalisePathish` leaves relative paths and non-https URLs unchanged, so a prefix of `reports/` allows `reports/../../etc`. Sent back for a fix.
5. **No loosening: CLEAR.** T-a1 is unchanged at n=82. T-a2 went from 40 to 37 rows: three rows whose old narrow-allow expectation is now wrong by design were replaced by stricter probes. Every added argument is required by the new rules.
