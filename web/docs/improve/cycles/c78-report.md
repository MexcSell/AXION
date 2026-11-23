# c78 report: test hygiene II (H21, H20, O1c)

Lane w76, branch `c78-test-hygiene-2`, from improve-30h at 299b534. Server tests and test fixtures only. No product file changed. The live `axion` DB was never touched (the lane's `.env` points at `axion_lane_disabled`; the tests use `axion_test` and the e2e DB was not needed).

## Base note
The c72 skill-rating module (`server/src/agents/skills.ts`, `test/contracts/no-ranking.ts`) is **not in this base**: it exists only on branch c72-skill-ratings. H20 is therefore built generically (see below). Nothing here imports c72; the rating registry in `test/contracts/value-order.ts` starts empty and c72 adds its field when it merges.

## H21: the c71-equivalence seed race
**Root cause.** `seedScale` (`test/c71-scale-fixtures.ts:101`) ended with a bare `analyze`. Without a table name, ANALYZE is **database-wide**: in the shared `axion_test` database it walks the tables of every other test file's schema. When another file's `drop schema ... cascade` ran meanwhile, a table vanished between the catalog lookup and the analyze and Postgres raised `relation with OID n does not exist`. It only shows in serial full runs because that is when the c71 seed (about 2000 tasks, a long analyze) overlaps another file's teardown; alone, nothing drops schemas next to it.

**RED** (unchanged fixture), new `test/c78-seed-race.test.ts`: two connections migrate and drop real schemas in a loop while `seedScale` runs 12 times in another schema of the same DB.
```
FAIL c78-seed-race.test.ts > seeds 12 times while a second connection churns schemas ... no catalog error
- Expected []   + Received [ "seed 1: relation with OID 111788199 does not exist", "seed 11: relation with OID 112225668 does not exist" ]
```
The same message as the c75 and c77 serial-run failures. (Two earlier churn shapes, plain tables and tables with indexes, did not reproduce it; only real migrated schemas did.)

**Fix** (fixture only): replace the bare `analyze` by `analyze <table>` for each table of `current_schema()`. The equivalence assertions are untouched.

**GREEN:** the churn test passes (3 more runs together with `c71-equivalence.test.ts`, 9/9 each), and 5 serial full runs below have no failure. The race is probabilistic (2 of 12 seeds failed in the RED run), so the churn test is a strong repro but not a proof by itself; the cause is the whole-database ANALYZE, which no longer runs.

## H20: value-based no-leaderboard check
New `test/contracts/value-order.ts` (pure), self-tests in `test/c78-value-order.test.ts`, and a new test in `test/contracts/coverage.test.ts` that runs the check on **every recorded 2xx body of every route** in the coverage run (not only 10 sweep routes).
- A response array of 3 or more entries that each carry a known agent id (a string directly in the entry or one object down, from the run's own `GET /agents` and `GET /agent-instances`, whatever the key is called) and that is monotone over 3 or more distinct values of any numeric field, however nested, is flagged. The field name never matters, so a rating renamed `pct` and a comparator that calls an unrelated function are both caught.
- `RATING_FIELDS` (route to marked rating paths): an array in which 2 or more entries carry a marked field is flagged in any order, which covers the two-entry case. Empty here; c72 registers `classes[].adjusted.value`.
- `ORDER_ALLOWED` holds four reviewed entries (lessons by version, missions by update time and sync counter, staffing log by time), each with a reason.

**RED:** with the guard replaced by a stand-in that sees no values, all 5 tests in `c78-value-order.test.ts` fail, including the live one (`TypeError: .toMatch() expects to receive a string, but got undefined`; the probe route's `leaders` sorted by a renamed `pct` through an unrelated `score()` function returned no problem).
**GREEN:** the same 5 pass. The live test registers a real route through `configure`, returns real agents ordered by a renamed field and asserts the guard flags it. The coverage sweep first reported 15 real hits on the unrestricted version (time-ordered logs and lists); restricting to agent entries and reviewing the 4 remaining sorted-by-time lists left it quiet (checked in 2 runs).

## O1c: org guardrail corpus at route level
- The corpus moved unchanged to `test/org-corpus.ts` and `org-guardrails.test.ts` imports it (pure tests unchanged apart from reading the new optional `also` and `max` fields).
- New `test/c78-org-corpus-routes.test.ts`: the 27 corpus agents are inserted into a company with the seeded chart. Each case sets the agents' models and states, then every bad case is posted as a **dry run** (it must raise the rule the pure function names, nothing else, and a failing contract with reasons); every c78 bad case and every third older one is **stored** (201, failed check) and **refused at approval** by a second administrator (422 `ORG_INVALID`, revision unchanged); every good case is a clean dry run; one good case is stored and approved (applied, new lines in the graph). A second app with an operator limit of 3 levels runs the setting-dependent shape.
- **Five new bad shapes** (none a permutation of the old ones): merge of two weak teams under a third person; family drift (two members' models change to an unknown family, then one leaves); a whole team moved under the end of a 5-deep chain (subtree depth); two rules in one proposal (both codes); operator limit tightened to 3. Three new good ones: promote an agent above its lead; exactly 6 levels with a whole team; a retired member leaves. The corpus is now 38 bad (33 + 5) and 19 good.
- The pure test also checks that the limit-dependent case passes at the default limit of 6.

**RED:** by mutation, since the route tests have no "unchanged code" to fail. With the `TEAM_REVIEWERS` push in `server/src/organization/guardrails.ts` temporarily disabled (restored with `git checkout`, diff stat below shows no product change), the pure and route tests fail (first: `dry run refuses: b2 leaves team B: only lead-b is able (b1 is unknown)`, and every TEAM_REVIEWERS case after it).
**GREEN:** 142/142 in `c78-org-corpus-routes.test.ts` plus `org-guardrails.test.ts` (76 route + 66 pure).

## Pass threshold
| Item | Result | Evidence |
|---|---|---|
| H21 RED to GREEN | PASS | churn repro fails 2 of 12 seeds with the exact error on the old fixture; passes after scoping ANALYZE; 5 serial full runs clean |
| H20 RED to GREEN | PASS | 5 of 5 new tests fail with a blind guard, pass with the check; reviewer probes (renamed `pct`, unrelated comparator) flagged on a live route. Limits below |
| O1c RED to GREEN | PASS | mutation RED, 142 passing; 5 new bad shapes, route-level dry run, create, approval |
| 5 consecutive serial full runs, no failure | PASS | `npx vitest run --maxWorkers=1 --no-file-parallelism` via heavy.sh, from the committed tree (tip f01901a): 5 of 5 runs 138 files passed, 1 skipped; 3269 tests passed, 36 skipped, 0 failed (390 s, 407 s, 392 s, run 4 and 5 identical counts, 443 s). No failure to name. |
| tsc clean | PASS | `npx tsc --noEmit -p .` printed nothing (also run on the final tree) |
| No product file changed | PASS | stat below: only `server/test/**` and this report |

## Diff stat (base 299b534 to tip, before this report)
```
 server/test/c71-scale-fixtures.ts         |   5 +-
 server/test/c78-org-corpus-routes.test.ts | 150 ++++++
 server/test/c78-seed-race.test.ts         |  36 +++
 server/test/c78-value-order.test.ts       |  66 +++
 server/test/contracts/coverage.test.ts    |  12 +
 server/test/contracts/value-order.ts      | 108 +++
 server/test/org-corpus.ts                 | 101 +++
 server/test/org-guardrails.test.ts        | 101 +-----
 8 files changed, 493 insertions(+), 86 deletions(-)
```
`git status` clean at the committed tip when the full runs started.

## Concerns
1. **H20 limits.** Two-entry lists are caught only through `RATING_FIELDS` (empty until c72 registers its field); the generic order scan needs 3 entries with 3 distinct values, because two entries are monotone by chance. A route returning two agents with a renamed rating and nothing registered would pass. The true metamorphic reversal (reverse the underlying data, check the order does not follow) needs the c72 fixtures and was not built here; c72 should register its field and add its reversal over the coverage bodies when it merges.
2. **Agent-entry scope.** The scan only looks at arrays whose entries hold an agent id one level deep. A list of agents nested deeper, or identified by something other than a known id, is out of scope. This was needed to keep the check deterministic (an unrestricted version flagged 15 chance and time-ordered lists).
3. **Chance flake risk.** Three entries are monotone in a random numeric field one time in three. The four reviewed allowances are for deliberate time or counter orderings, so they are stable, but a future route whose list happens to arrive in order would fail the coverage test and need a reasoned entry. That is the intended behaviour, but expect one-off review work.
4. **H21 is probabilistic.** The churn test failed 2 of 12 seeds on the old code; a green single run proves little, which is why the fix targets the cause (whole-database ANALYZE) and the full serial runs confirm it. Other fixtures or scripts that run a bare `analyze` in the shared DB would have the same race; `grep analyze server/test server/scripts` shows no other bare `analyze` in tests; `server/scripts/scale-bench.ts` (lines 107 and 149) has two, but it is a benchmark script that runs on its own database, not in the shared `axion_test`, so it was left alone.
5. **O1c route tests share one company and each case rewrites agent state.** They are order-independent except the last test in the default group (an approval that moves the revision), which is kept last on purpose.
6. The ADMIN-only dry run and create cover contracts, not the cooldown and churn-budget rules; those are covered by `org-churn.test.ts` and were not extended here.
