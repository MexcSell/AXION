# c98 brief: test-infrastructure follow-ups (H14c, M2c)

**Lane:** w96 (`/home/luca/AXION-w96`, branch `c98-test-infra`), from improve-30h at the commit that adds this brief. Ports 14690–14693. E2E DB **axion_e2e17** (reused). **Server only (src/db.ts and tests). No migration, no `web/` change.** **Deadline: hand back by about 16:30Z**, so review and merge fit before 18:30Z. If you're short of time, hand back what is done and mark the rest NOT MET.

**Sources:** BACKLOG rows H14c and M2c; `cycles/c93-review.md`; `cycles/c83-review.md`; `cycles/c92-review.md`; the c83 scanner `server/test/contracts/columns.ts`.

**HARD RULE:** never connect to, query or read the live `axion` database in any form. Never hold extra real DB connections to create pressure. Run every vitest through heavy.sh.

## Items (each RED first, then GREEN, each its own commit)
1. **H14c-1: fault hook out of src.** Move c93's test-only fault-injection hook out of `server/src/db.ts`, behind a `makePool` option (e.g. `acquireHook`) that the test helpers set. Production code must keep no VITEST check and no fault branch. The c93 fault-injection tests must still reproduce the five flakes with the retry off, and pass with it on.
2. **H14c-2: callback rethrow.** In the wrapped `pool.connect` callback form, a throwing callback must not become an unhandled rejection: catch it and rethrow on `process.nextTick`, so the behaviour matches pg-pool. Add a test.
3. **M2c remaining scanner items**, if any are still open after c92 (check first and say which):
   - a sub-select followed by a comma join;
   - `extract(epoch from t.col)`;
   - anything else listed in M2c item 1.
   Never loosen fail-closed.

## Pass threshold
- Items 1–3 RED → GREEN, or item 3 "already done", with evidence.
- Full serial vitest with no failure, or every failure named.
- tsc clean.
- Diff stat: server only.

## Report
`cycles/c98-report.md`. Follow the LANES.md Finishing rule.
