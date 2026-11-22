# c71 brief: scorecard at scale (P6)

**Lane:** w69 (`/home/luca/AXION-w69`, branch `c71-scorecard-scale`). It starts from improve-30h at the commit that adds this brief; every Wave 5–7 batch through batch 27 is merged there. Ports 11990–11993. E2E DB **axion_e2e14** (reused). Migration **0053** only if an index needs one.
**Source:** BACKLOG P6. The c69 reviewer measured `GET /company/scorecard` at about 4 s for 25,000 tasks, against about 125 ms at 5,000. `/company/process` is 0.5–0.9 s at 25,000. Read the c69 review's performance section.

## Items
1. **Measure first (RED).** Write a seeded scale test or bench at 5k and 25k tasks, realistically distributed across missions, departments, reviews, delegations and attempts. Measure p50 and p95 for `/company/scorecard`. Measure `/company/dimensions`, `/company/process`, `/company/departments` and the failure-modes counts too, so other slow routes surface. Print the load average next to every timing, and measure base and candidate interleaved at the same load (LESSONS).
2. **Profile.** Use `EXPLAIN (ANALYZE, BUFFERS)` on each slow query, and name the cause: N+1, a missing index, an unbounded window, or a JS-side aggregation of large row sets.
3. **Fix.** Batch queries, push aggregation into SQL, and add indexes through migration 0053 if needed. Keep every result byte-identical: a standing test compares the old and new outputs on the seeded data.
   - Keep c54's clock convention and snapshotTx.
   - Keep c66's registry and writability inventory green; adding an index changes no input.
4. **Budget.** At 25k tasks, the p95 of each company route stays under 1 s on this machine at the measured load. Make it a test that can be run on demand. It doesn't have to run in the default suite if it is slow, but document the command.

## Pass threshold
- RED measured, cause named, GREEN measured, with interleaved before/after numbers and load averages.
- Output identical before and after: a standing test.
- Full vitest (serial fallback; name every failure), tsc, api-c46, api-c66, api-c69 (if merged), api-stage6, verify-all.
- If you add a migration, migrate down and up once.

## Report
`cycles/c71-report.md`. Follow the LANES.md Finishing rule.
