# c46 brief: six-dimension scorecard (Wave 3 · M1)

**Lane:** w45, branched from improve-30h at 7a139d8 (batch 9 merged except c40, which is UI only; schema-scoped advisory-lock helper in: use it for any lock). It needs the data from c32 eval, c33 failure tags, c38 task reviews, c39 ledgers, c41 playbooks and c42 delegation briefs. Ports are 9590–9593. E2E DB **axion_e2e18**. Migration **0036**, only if needed; prefer none, since this is a read model.
**Source:** spec §16.1: six dimensions (Cognitive, Capability, Environmental, Collective, Knowledge, Evolutionary) "at company and department levels with sample sizes, evidence and trend, not one unexplained intelligence number". Also spec §11 invariant 9 (every metric shows its window and n; unknown stays unknown) and PHASE2 M1.

## Hypothesis
Every dimension can be given a small set of honest indicators from rows AXION already records. Each indicator carries n, a window, an evidence sentence and a trend against the previous equal window. Most Environmental cells will truthfully say "not enough evidence" until Stage 7, and that is a correct result.

## Indicators (a starting set; you may refine with a reason, but don't add any you can't source)
| Dimension | Indicator (source) |
|---|---|
| Cognitive | the share of tasks verified by a non-producer review on first attempt (c38 reviews + attempts); the share of missions whose progress ledger had a stall flagged (c39) |
| Capability | active playbook skills per role (c41); agent reliability where n ≥ 5 (C1); site grants active vs expired (c36), shown as a count, not a score |
| Environmental | the share of failed or retried tasks tagged with environment-type MAST failure tags (c33). The tag-to-dimension map is a reviewed constant. Browser-era indicators are listed as "not measured until Stage 7" |
| Collective | the share of delegations carrying a valid brief (c42); review independence (the share of reviews where reviewer ≠ producer family, c38); median approval decision time |
| Knowledge | lessons proposed → accepted → rolled back (c41), with the rollback rate |
| Evolutionary | version proposals promoted vs rolled back, and verdictV2 outcomes counted as win, inconclusive or loss (c32); org revisions applied (A1) |

## Rules
- **No composite score of any kind:** no per-dimension total and no overall number. Each cell is one indicator: value, n, window, evidence and trend.
- **n < MIN_N** (reuse the scorecard's MIN_N, 3) means value null, state `none` and the text "not enough evidence (n = k)". The trend is null when either window is empty.
- **Simulated / DEMO rows are excluded** (the same `simulated` rule as `company/scorecard.ts`). DEMO mode may show labelled sample data only.
- **Visibility:** a caller sees only indicators computed from missions they can see, the same scoping as `GET /company/scorecard`. Department level uses the department facts from c06.
- **Pure functions:** a new `server/src/company/dimensions.ts` (pure, tested on fixtures). Don't edit `scorecard.ts` beyond importing shared helpers. The route is `GET /company/dimensions?window=7d|30d|90d&department=` and the contract goes in shared/contracts.
- **UI:** a six-row panel ("Six dimensions") reachable from Missions KPI / Overview / Agents › Departments. Pick the place that fits one screen at 1366×768. Each row has a `?` explaining its indicators, its source and why it may be empty. A department selector, and no gauges or one big number.
- **Dialog ids:** DL-98..DL-99 if needed.

## Pass threshold (fixed)
- Every cell shows a value with n and window, or "not enough evidence (n = k)". A test asserts this for every cell, for empty, small and large fixtures.
- A test proves no field in the response is an aggregate across indicators (schema-level: the response has no score/total field).
- Simulated rows change no value (a fixture test).
- A member doesn't see indicators from missions outside their visibility (a test).
- The trend is null when the previous window is empty (a test).
- ≥ 30 server tests. A new `web/scripts/api-c46.mjs` (admin, member, department switch, `?` popovers, 1366×768 fit) passes. verify-all 10/10. tsc clean. a11y 0 violations.

## Report
`cycles/c46-report.md`, with screenshots in light and dark.
