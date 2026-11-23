# c71 report: scorecard at scale (P6)

Lane w69, branch `c71-scorecard-scale`, base `c83f33e`. One migration (0053). Nothing pushed.
Code commit `c4d95c0`; the report is committed on top.

## Summary
- **Cause 1 (the big one, dimensions): a missing index.** `approval_decisions` had no index on `approval_id`, and `GET /company/dimensions` reads `(select min(decided_at) from approval_decisions where approval_id = r.id)` once per approval. That is a sequential scan of the table per approval, so quadratic. `EXPLAIN (ANALYZE, BUFFERS)` before: `Seq Scan on approval_decisions d ... loops=8000`, `Buffers: shared hit=760000`, **2827 ms**. After migration 0053 (`approval_id, decided_at`): `Index Only Scan using approval_decisions_approval ... loops=8000`, `shared hit=16001`, **57 ms**.
- **Cause 2 (scorecard, throughput): JS-side recomputation.** Per window the old code rebuilt every map, re-sorted every transition and scanned every decision for every completed mission (mission × decision), and the throughput evaluated the full ten-row scorecard nine times only to read the `started` count, after loading tasks, attempts, decisions, delegations and reviews it never uses. Fix: `prepare()` once per input; `throughput` loads only missions, first runs and transitions.
- **Cause 3 (scorecard, dimensions): a correlated freshness sub-select per review.** `STALE_BEFORE_SQL` is about 9 index probes per review (139k buffers vs 16k for 15,300 reviews, 144 ms vs 32 ms). Replaced by one lateral join (`server/src/company/stale.ts`), compared with `STALE_BEFORE_SQL` review by review in a standing test.
- **Cause 4 (scorecard): attempts of every task were loaded** (31,700 rows) though only tasks with more than one attempt are ever read (recovery). The load now keeps only those (`count(*) over (partition by task_id) > 1`).

**Honest note on the brief's 4 s.** I could not reproduce "scorecard about 4 s at 25k" on the base: on my seed it was 0.42 to 0.83 s (load 9 to 12), and dimensions was the route that reached 2.8 to 3.0 s (the c69 reviewer's "dimensions 720-760 ms" was on another data shape). Their data had other shape and load. The route names also differ: there is no `/company/process` route in this branch (c69 is not merged), so it is not measured here; the routes measured are scorecard, throughput, dimensions, departments and failure-modes.

## Seeded data (`server/test/c71-scale-fixtures.ts`)
Insert-only (append-only triggers stay on), deterministic. 25,000 tasks: 2,500 missions (10 per mission) or 8,333 missions (3 per mission, the shape that exposes the quadratic parts), 32k attempts, 16k reviews (some stale), 25k to 43k events, 25k delegation briefs, one approval and decision per mission, verifies and delegated edges, progress ledgers, confirmed failure tags; two users (admin and member), 1 in 3 missions private, 1 in 25 DEMO, mission ages 1 to 110 days (so 7d/30d/90d differ), fail then retry then complete sequences, archive and restore.

## Interleaved before and after (same data, one call each in turn, load average of the interval)
`C71_REF=1 ... scripts/c71-scale.ts`: scorecard and throughput compare the frozen pre-c71 read (`test/c71-reference/`) with the live route; dimensions toggles migration 0053's index (dropped for the BEFORE call, created for the AFTER call). 12 runs each, p50 / p95 in ms.

| Data | Route | BEFORE p50 / p95 (load) | AFTER p50 / p95 (load) |
|---|---|---|---|
| 5k, 10/mission | scorecard 30d | 69 / 93 (9.4) | 44 / 61 (9.4) |
| 5k, 10/mission | throughput 8w | 106 / 128 (9.4) | 11 / 14 (9.4) |
| 5k, 10/mission | dimensions 30d | 120 / 144 (9.5) | 104 / 149 (9.5) |
| 25k, 10/mission | scorecard 30d | 422 / 592 (12.4) | 269 / 299 (12.4) |
| 25k, 10/mission | throughput 8w | 593 / 732 (11.6) | 43 / 59 (11.6) |
| 25k, 10/mission | dimensions 30d | 819 / 851 (11.4) | 601 / 665 (11.4) |
| 25k, 3/mission | scorecard 30d | 830 / 1027 (9.0) | 440 / 519 (9.1) |
| 25k, 3/mission | throughput 8w | 1090 / 1214 (9.9) | 139 / 164 (9.9) |
| 25k, 3/mission | dimensions 30d | 2879 / 3000 (9.4) | 746 / 826 (9.4) |

The first uninterleaved RED run (admin, 25k, 3/mission, before any change, load 10 to 17): scorecard 783 / 881, throughput 1020 / 1208, dimensions 3131 / 3336 (`/tmp/w69/red25k-t3.txt`). Scaling 5k to 25k after the fix is about 5x for scorecard and 6x for dimensions (linear); before, dimensions went 120 to 2879 ms (24x for 5x the data).

## Budget test (on demand)
```
cd server && C71_BUDGET=1 C71_BUDGET_OUT=/tmp/c71-budget.txt /home/luca/AXION-lanes/heavy.sh npx vitest run test/c71-budget.test.ts --maxWorkers=1 --no-file-parallelism
```
Seeds 25,000 tasks twice (10 and 3 per mission), times 8 routes (scorecard 7/30/90d, throughput, dimensions 30/90d, departments, failure-modes) for the admin and a member, and fails if any p95 is over `C71_BUDGET_MS` (default 1000). Skipped (32 skipped tests) unless `C71_BUDGET=1`. Result at load 9 to 10, 32 of 32 pass. Slowest p95 values: dimensions 90d admin 3/mission **916 ms** (30d 952 ms in the same run), member 814 ms; scorecard 509 ms; departments 373 ms; everything else under 320 ms. The dimensions margin at 3 tasks per mission is thin (about 5%): see concerns.

## Output identical: standing test
`server/test/c71-equivalence.test.ts` (8 tests), against the pre-c71 implementation frozen in `server/test/c71-reference/` (`scorecard-v0.ts` verbatim, `load-v0.ts` the old loader renamed):
1. 400 random inputs x 7d/30d/90d plus throughput at 1, 8, 26 weeks, full JSON compared byte for byte (ties on exact timestamps, restores from archive, simulated rows, rows of missions not in the list, equal review seq). It asserts at least 300 cases reach measured rows and trends. Mutation check: changing one `<=` to `<` in the approval rule fails it (seed 17); it also did not fail at first with continuous times, which is why times sit on 40 shared slots.
2. Seeded company, admin and member, with and without demo: old loader + old function vs new loader + new function in one snapshot (same clock), JSON equal; asserts more than 12 measured non-zero rows.
3. HTTP routes equal the old read (rows; clock stamps excluded).
4. Review freshness: new join vs `STALE_BEFORE_SQL`, review by review (over 20 stale and over 20 fresh).
5. Dimensions: the new reviews query returns the same rows as the pre-c71 query; the dimensions answer is the same with the new index dropped.
`server/test/c71-migration.test.ts`: down to 52, up, down, up on a populated schema; index present and absent; the down file runs twice.

## Threshold
| Item | Result | Evidence |
|---|---|---|
| RED measured, cause named, GREEN measured, interleaved with load | PASS | tables above; EXPLAIN 2827 ms to 57 ms for the approvals subquery |
| Output identical, standing test | PASS | `c71-equivalence.test.ts`, 8/8 |
| Budget: p95 of each company route under 1 s at 25k | PASS, thin on dimensions | `c71-budget.test.ts` 32/32 at load 9 to 10; dimensions 3/mission p95 up to 952 ms |
| Clock convention and snapshotTx kept; c66 registry and writability green | PASS | no change to window code or inputs; c66 tests in the full run; api-c66 26/26 |
| Full vitest | PASS | serial (`--maxWorkers=1 --no-file-parallelism`): 122 files passed, 3060 tests passed, 32 skipped (the budget test), 0 failures, 450 s |
| tsc | PASS | clean |
| api-c46 | PASS | 36/36 |
| api-c66 | PASS | 26/26 |
| api-stage6 | PASS | 94/94 |
| api-c69 | NOT MET (n/a) | c69 is not merged on this base; no script exists |
| verify-all | PASS | ALL 10 STEPS PASSED |
| Migration down and up once | PASS | `c71-migration.test.ts`; the bench also runs `down 0` then `up` on axion_e2e14 every start |

verify-all (own OUT dir, dev server 11990): ALL 10 STEPS PASSED (80 route/tab views, no problems).

## Files changed
`server/migrations/0053_approval_decisions_index.{up,down}.sql`; `server/src/company/scorecard.ts` (prepare once; same rules), `routes.ts` (lighter loads, `loadInput` exported with a `need` argument), `dimensions-routes.ts` (reviews SQL exported, lateral freshness), new `stale.ts`; tests `c71-equivalence`, `c71-migration`, `c71-budget`, fixtures `c71-scale-fixtures.ts`, frozen `c71-reference/`; scripts `scripts/c71-scale.ts` (bench, only axion_e2e14), `scripts/c71-profile.ts`.

## Concerns
- Dimensions at 25k tasks in 8k small missions is 0.75 to 0.95 s p95 at load 9 to 10. It is under 1 s but would not survive a load of 15+. What remains is linear: `loadDeptRows` about 255 ms (one CTE query, 16k index probes into events, plus sorts) and 13 loaders about 330 ms (mostly row transfer and timestamp parsing of about 100k rows), compute 50 ms. Further cuts need time-bounded loads or SQL aggregation, which would change which rows reach the pure functions: left for a later cycle. `/departments` shares `loadDeptRows` (0.23 to 0.37 s).
- `stale.ts` duplicates the c51 freshness rule in join form. The standing test compares it with `STALE_BEFORE_SQL` row by row, but a future change to the rule must touch both.
- The bench is lane-bound: it refuses any database but `axion_e2e14` (scale-guard derives `axion_e2e69` from the worktree name, which is not this lane's assigned DB). `scale-guard.ts` is not changed.
- Seeded shape is mine, not the c69 reviewer's; I could not reproduce the 4 s scorecard figure (see summary).
- The e2e DB axion_e2e14 is left holding the last 25k seed; the next harness start empties it.

## Fix round (review: cycles/c71-review.md, verdict CLEAR AFTER FIXES)
- **F1, truth table.** `server/test/c71-stale-truth.test.ts`: 0 to 3 attempts, each `started_at` null, before, equal or after the review, review `attempt_id` null, dangling or each attempt (more than 300 cases); the expected value is computed from the rule written out in JS, and both `STALE_BEFORE_SQL` and `STALE_JOINS`/`STALE_FLAG` are checked against it, plus the named branches (review before the latest start, null attempt_id, reviews without attempts, null `started_at`, equal timestamps). Mutations fail it: join form `<` to `<=` (T10, equal timestamps), join form `<` to `>` (T7, review before start), old form `<` to `<=` (T10).
- **F4, one source.** `STALE_BEFORE_SQL` moved into `server/src/company/stale.ts` next to `STALE_JOINS`/`STALE_FLAG`, with a header saying both forms must change together and naming the truth-table test; `tasks/reviews.ts` imports and re-exports it, so no caller changed.
- **F6, scale script guard.** `server/scripts/c71-guard.ts` (`assertC71Wipe`) uses `isE2eDatabaseUrl` (`axion_e2e` and `axion_e2e<digits>`), requires `CONFIRM_WIPE=1`, refuses any query string or fragment and non-local hosts. `server/test/c71-guard.test.ts` covers `axion_e2e14`, the integrator's `axion_e2e` (accepted), `axion` (refused) and `?host=` (refused). The bench is now run as `CONFIRM_WIPE=1 heavy.sh npx tsx --env-file=.env scripts/c71-scale.ts ...`.
- **F7, how to read the budget.** Observed load: 9 to 10 in this lane's runs, 12.0 to 21.3 in the review's (slowest p95 977 ms, all 32 passed). Dimensions at 25k tasks in small missions has under 5% headroom (916 to 977 ms against 1000). A failure at high load means re-run first. The p95 of 12 runs is the maximum sample. Stated in the budget test header too.
- **F3, retirement.** Header notes in `c71-equivalence.test.ts` and both files of `c71-reference/`: retired at the next intentional scorecard change; the reference imports the live `STALE_BEFORE_SQL` and `VISIBLE_SQL`, so it is not fully frozen.
- F5 (add `/company/process` to the budget) is the integrator's at merge.
- F4 follow-up: the full serial run had one failure, `c51-review-hardening > the stale flag is computed from the database clock, not the client`, a source-grep test on `tasks/reviews.ts`. The rule moved, so it now reads `company/stale.ts` (same two assertions, no-`Date.now` on both files). Not loosened. Re-run: full serial 124 files passed (3065 tests), 0 failures.
