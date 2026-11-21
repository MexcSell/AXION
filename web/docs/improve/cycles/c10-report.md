# Cycle 10 report (lane w8): performance P1, indexes and a scale test

## What was built
- `server/scripts/scale-bench.ts`: empties the lane database `axion_e2e8` (guarded: the URL must match `axion_e2e<N>`), migrates to 0016,
  seeds one tenant by insert-only SQL (300 missions, 3,000 tasks, 6,000 attempts, 50,000 events, 20,000 audit rows, plus
  1,200 instances, delegations, approvals), times 4 endpoints (3 warm-ups + 20 runs, p50/p95), applies migration 0017, times again
  (AFTER, AFTER2) and prints EXPLAIN ANALYZE of the hot queries both times. `GET /departments` does not exist on this base: skipped.
- Migration `0017_scale_indexes` (up/down): `events(tenant_id,type,subject_id)`, `audit_events(tenant_id,action,subject)`,
  `tasks(mission_id)`, partial `tasks(owner_instance_id)`, `mission_runs(mission_id,started_at)`.
  Plain `create index` (inside the migration transaction): takes a SHARE lock blocking writes to that table while it builds; milliseconds on today's live database.
- `server/test/scale-indexes.test.ts`: down/up/down/up on a populated schema; rows survive, indexes appear and disappear.
- `server/test/proposals.test.ts` line 306: `toBe(13)` became `toBeGreaterThanOrEqual(13)` (it asserted "latest migration = 13", which any newer migration breaks; not a weakening of what the test proves).
- No query was rewritten; semantics and privacy filters are unchanged.

## Numbers (ms, 20 runs, shared busy machine, same seeded data, admin viewer)
Run 3 (cleanest, final script):

| endpoint | BEFORE p50/p95 | AFTER p50/p95 | AFTER2 p50/p95 |
|---|---|---|---|
| /company/scorecard | 29.1 / 36.5 | 23.4 / 27.4 | 22.7 / 25.8 |
| /agents | 45.9 / 47.3 | 38.3 / 42.7 | 39.8 / 41.2 |
| /missions | 9.9 / 13.2 | 9.1 / 12.1 | 8.6 / 8.9 |
| /agent-instances | 5.1 / 5.6 | 4.8 / 6.5 | 4.6 / 5.1 |

Earlier runs on a busier machine were much noisier: BEFORE /agents p95 78.1 and 100.9, /scorecard 43.9 and 59; AFTER /agents 72.2 and 84.1.
Run-to-run noise (other lanes share the CPU and PostgreSQL) is larger than the index effect in those runs.

EXPLAIN: `events` filtered by tenant+type moves from Seq Scan to Index Scan (reliability_ev 7.5 ms to 4.4 ms); the audit query uses the new index in some runs.
The full reliability query (about 15 ms of SQL) reads about 2,100 of 3,000 tasks and all their events by design, so an index cannot remove that work.
Where the time goes: `loadReliabilityRows` about 38 ms of the 40 ms for `/agents` in a loaded run; listing agents 1 ms; classification 0.6 ms.

## Threshold
- p95 of /company/scorecard and /agents drops 50% OR is already below 50 ms at this volume: **PARTIAL**. The 50% drop is NOT MET.
  The "already below 50 ms" clause held only in the cleanest run (scorecard 36.5, agents 47.3 before); the other BEFORE runs were above 50 ms
  (/agents 78.1 and 100.9, /scorecard 59), and the AFTER runs of those were too (/agents 72 to 84). At this volume the index benefit is NOT proven.
  The indexes are kept because they match the hot predicates and cost little. Raw output: `c10-bench-raw.txt`.
- No other endpoint slower: PASS (all within noise or faster; /agent-instances p95 5.6 to 6.5 in run 3 is noise, 5.1 in AFTER2).
- Migration 0017 up/down/up on a populated schema: PASS (`scale-indexes.test.ts`).
- Whole suite green: PASS (25 files, 332 tests; the first run had 2 failures, both brittle "latest migration number" asserts, fixed as described).

## Concerns
- Index benefit is not proven at this volume; larger seeds (500k events) would be needed. Next cycle idea: rewrite `loadReliabilityRows` to run the CTEs per page or cache it.
- The per-lane suite assumed "latest migration = 13" in `proposals.test.ts`; other lanes may touch the same line (merge conflict is trivial).
- `scale-bench.ts` resets `axion_e2e8` (migrate down to 0). Lane database only.

## Fix round
- Verdict relabelled PARTIAL (above). Raw benchmark output committed in `c10-bench-raw.txt` (run 3 verbatim; runs 1 and 2 only as the console summary lines that were kept, marked as transcribed; run 1 predates the migration, so its before/after is the same schema and shows pure noise of about 15 ms).
- Migration assertions are exact: `proposals.test.ts` and `scale-indexes.test.ts` compare against `Math.max(...listMigrations().map(m => m.version))` (and the highest version below 17 after `down 16`), so "up stopped early" is caught again.
- The two first-run failures: (1) `proposals.test.ts` expected the latest migration to be 13 (brittle once 0017 exists); (2) my own new test expected `down 16` to return 16, but `down` returns the highest remaining version, 13 on this base (0014 to 0016 belong to other lanes). Both were assertions about the migration number, not product bugs.
- Bench guard: `scripts/scale-guard.ts` derives the allowed database from the worktree directory (`AXION-w<N>` gives `axion_e2e<N>`) and `scale-bench.ts` refuses anything else, including other lanes' databases and non-lane worktrees; tested in `scale-indexes.test.ts` (axion_e2e9, axion_e2e, axion, axion_test, axion_e2e88, no URL, non-lane worktree).
- Events index: the scorecard transitions query filters tenant, type and `mission_id = any(...)`; EXPLAIN shows it already uses `events_mission_seq` (index scan, about 1 ms), so no `mission_id` column was added to `events_tenant_type_subject` (it would not help the reliability query, which filters `subject_id`, and a second index would add write cost).
- Verification: tsc clean, 25 files 333 tests green (one earlier run failed on "too many clients" from the shared PostgreSQL, rerun green).
- Write cost: every insert into `events` (now 4 indexes: PK, events_mission_seq, events_tenant_id, events_tenant_type_subject) and `audit_events` (3 indexes) maintains one more index entry. Not measured here; small at today's volume. `tasks_owner_instance` is not used by the benchmarked queries (it serves instances/service and the on-delete-set-null FK); it is a candidate to drop if write cost ever matters.
