# Cycle 12 review (independent)

Spec verdict: PASS with one rule question. Quality verdict: good, one Important fix before merge.

## 1. Trend rules (OK)
- Null on a null value or n < MIN_N (3) on either side: `server/src/company/scorecard.ts:157`. Flat band 1 point, 0.1 h, equal for counts: `:151`, `:158`.
- Previous window is adjacent, same length: `scorecard.ts:166` (from-len-1 .. from-1, both inclusive, so the same ms count as the current window). The boundary test in `scorecard-trend.test.ts` covers it. The previous window's transitions are cut at its own `to`, so it is "as known then".
- A count row with n = 0 gets previous.value 0 (not null), but its trend is null. No fake delta.

## 2. Throughput
- Privacy is OK. The shared loader (`routes.ts:21`) applies tenant, deleted, VISIBLE_SQL and the DEMO flag. Events are tenant-filtered, the other tables are read only for visible ids. `/company/throughput` is behind requireUser (`:59`) with zod bounds (1..26). Route tests cover Mina/Kenji private, DEMO, other tenant, deleted and older-than-8-weeks.
- IMPORTANT: the double counting contradicts cycle 2's rule "a mission counts once by its last final state" (`scorecard.ts:74`, help `scorecard.finished`). `computeThroughput` (`:179-184`) re-runs computeRows per week with `to` = week end, so a mission that failed in week 3 and completed in week 6 is counted as finished in both weeks. The chart can sum to more than the scorecard's finished count over the same span, and to more than the distinct missions. The `scorecard.throughput` help text does not mention it, and there is no test.
  - Ruling: throughput should count finished missions once, by the mission's last terminal transition as of `to`, placed in the week of that transition. Then the last week equals the 7d scorecard exactly and the chart sum equals the distinct finished missions in the span. "Started" is already once per mission (first run), so no change there.
  - Cost: small (compute the last final per mission once, then bucket). Add a test for fail -> retry -> complete across weeks. If the owner wants the as-of view instead, the help text must say so.
  - The same as-of rule in the previous scorecard window is acceptable, because each window counts a mission once.

## 3. Honesty
- Arrows only when trend is non-null (`web/src/api/scorecard.ts` trendOf; `sc-prev.on` only then). The api-c12 check "fresh db: no arrows" is real. The mocked-response arrow check is labelled mocked in the script and the report. Accepted.
- Minor: `pages.css:21-22` colours "up" with the accent and "down" with the warn colour. For failure rate and waiting time, up is bad, so the colouring implies better/worse, which the report says the arrow does not claim. Use a neutral colour, or colour by polarity per row.
- The help text matches the rule (n < 3, 1 point). "Higher by more than 1 point" is accurate for rates only (times use 0.1 h, counts equality); minor wording.

## 4. ov-fit / demo
CompanyScorecard renders in api mode only, so demo is untouched. The ov-fit NO SCROLL result in demo and api comes from the report. I did not re-run it (read-only).

## 5. Tests
They assert real behaviour: RED run recorded, boundary, previous-window privacy, trend only at n >= 3 both sides. Gap: no test for a mission re-finishing in a later week (see item 2). The brief's "flat within ±1 point" has a test at exactly 1.

## Notes
- verify-all reds (fs-guard lane config, flows flake) are plausible lane artefacts. The controller should confirm on the integration tree.
- Report mentions a `git stash push/pop` by the implementer before the no-stash rule. Noted, no impact.
