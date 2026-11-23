# c78 brief: test hygiene II (H21, H20, O1c)

**Lane:** w76 (`/home/luca/AXION-w76`, branch `c78-test-hygiene-2`), from improve-30h at the commit that adds this brief (batches through 30 merged). Ports 12690–12693. E2E DB **axion_e2e3** (reused). No migration. **Server tests only. No product code change, unless a test exposes a real bug; then stop and report it.**
**Sources:** BACKLOG rows H21, H20 and O1c. Read the c71, c72 and c64 reviews.

## Items (each test-first, each its own commit)
1. **H21: the c71-equivalence seed race.**
   - `test/c71-equivalence.test.ts` intermittently fails in `beforeAll` at `seedScale` (`c71-scale-fixtures.ts:101`) with `relation with OID … does not exist`. It shows up in serial full runs and passes alone.
   - Find the real cause (likely a catalog lookup racing a concurrent `DROP SCHEMA` from another file in the shared `axion_test` DB) and fix it in the fixture or the test harness. Options: run the seed in a single transaction in its own schema, take a schema-scoped advisory lock through `locks.ts`, or retry once on that exact SQLSTATE.
   - **Never loosen the equivalence assertions.**
   - Show the failure reproduced (by repeated serial runs or by an injected concurrent drop), then show it gone: 5 serial full runs clean, or an injected-race test.
2. **H20: no-leaderboard guard gaps.** The coverage run already checks response keys. Add a **value-based** check: for every response array whose elements carry the skill rating (or any field the c72 module marks as a rating), the array order must not correlate with the rating values. Use the metamorphic reversal c72 uses, applied to every coverage response, not only the 10 sweep routes.
   - This closes the renamed-field (`pct`) gap and the unrelated-function-comparator gap.
   - Show that the reviewer's probes now fail the guard.
3. **O1c: org guardrail corpus at route level.** c64's bad-proposal corpus mostly tests the pure function. Add route-level tests: POST a sample of the corpus through the real proposal routes, including the dry run and approval, and assert the same refusals. Also add 5 or more new distinct proposal shapes. c64's review counted about 12 distinct shapes among 33.

## Pass threshold
- Items 1–3 RED → GREEN.
- 5 consecutive serial full vitest runs with no failure, or every failure named and shown unrelated.
- tsc clean.
- No product file changed (diff stat), unless reported.

## Report
`cycles/c78-report.md`. Follow the LANES.md Finishing rule, including the committed-diff check.
