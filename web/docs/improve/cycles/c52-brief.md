# c52 brief: merge minors (H10)

**Lane:** w51, from improve-30h at b06554e. Ports 10190 (dev), 10191 (preview) and 10192–10193 (e2e). E2E DB **axion_e2e17** (reused; c45 merged). No migration unless item 1 needs an index.
**Source:** BACKLOG H10, from integrator #3 and c50.

## Items (each test-first, each its own commit)
1. **Skill lock key.** c41's skill lock lower-cases the name in JS, but uniqueness uses SQL `lower()`. For non-ASCII names (for example "İ", "ß", Greek final sigma) the two can differ.
   - Compute the lock key from SQL `lower()`, inside the helper call, so the lock and the unique index always agree.
   - Test it with names where JS and PG lower-casing differ: two concurrent creates of names that SQL treats as equal must serialise. The second create returns the same conflict code as today, not a raw unique-violation 500.
2. **Task reviews.** Add `taskReviews.cancel()` on sign-out, like the other refreshers in `web/src/api/events.ts`. Test it the way the other refreshers are tested.
3. **The c04 History browser check** bans the word "coverage" anywhere on the page, which is over-broad now that coverage features exist.
   - Narrow it to what it meant: no coverage claim inside the history panel.
   - Read c04's report for the intent, and don't weaken it beyond that intent.
4. **Decider name.** `POST /approvals/:id/decision` returns `decidedByName: null` for a decided request, while `GET /approvals` returns the name. Re-read the row with the decider join.
   - Remove the FINDING entry from c50's `server/test/contracts/exercised.ts` allowlist (c50 is in batch 12; if it isn't merged in your base yet, note it for the integrator instead).
5. **Name the 3 vitest failures** seen after the c09 merge (b18c5a2).
   - Check out that commit into a scratch worktree you create and remove yourself, under `/tmp`, sharing node_modules like `new-lane.sh` does.
   - Run vitest there at 2 workers 3×, using your lane DB settings, and record which tests fail and why. Most likely it's the global lock-key class fixed in 4eca9db.
   - This is a diagnosis only; no fix is expected if it's that class.

## Pass threshold
- Each item has RED → GREEN, or for item 5 a recorded diagnosis.
- Full vitest, tsc and verify-all 10/10 pass. api-c41, api-c48, api-improve (with the c04 History step) and api-stage6 pass.

## Report
`cycles/c52-report.md`.
