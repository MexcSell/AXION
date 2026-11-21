# Cycle 10 — Lane w8 · performance P1: database indexes and a scale test

## Hypothesis
Cycles 2 and 3 compute the company scorecard and agent reliability by scanning `events` (by tenant and type) and
`audit_events` on every request. No index supports this. Today the database is tiny. After months of real use, these
pages and `GET /agents` will slow down linearly. Measure it with realistic volume, then add the indexes the queries
need.

## Measure and pass threshold (fixed now)
1. Write `server/test/scale.bench.ts`, or a script under `server/scripts/` that runs against your lane's e2e database
   `axion_e2eL` only. It seeds a realistic volume into one tenant:
   - 300 missions, 3,000 tasks, 6,000 attempts, 50,000 events and 20,000 audit rows;
   - via SQL, honouring the append-only triggers by inserting only.
2. Record p50/p95 latency (20 runs each) of `GET /company/scorecard`, `GET /agents`, `GET /departments` (if it exists
   on your base; otherwise skip it), `GET /missions` and `GET /agent-instances`, plus `EXPLAIN ANALYZE` of the hot
   queries. **Before** numbers first.
3. **Threshold:** p95 of `GET /company/scorecard` and `GET /agents` drops by at least 50%, or is already below 50 ms at
   this volume (say which). No other endpoint gets slower.
4. Add the indexes in migration **0017** (`create index concurrently` is not possible inside a transaction; use plain
   `create index`, and note the lock impact for the live database: tiny today). The migration has to pass
   up/down/up on a populated schema. The whole suite stays green.

## Notes
Don't change query semantics: privacy filters stay identical. If a query rewrite helps more than an index, it is
allowed only with tests proving identical results on the seeded data.

## Lane
You are lane w8: worktree `/home/luca/AXION-w8`. Follow `/home/luca/AXION/web/docs/improve/LANES.md` exactly (ports, the `heavy.sh` gate, the dev-server override config `/home/luca/AXION-lanes/vite-w8.config.ts`, migrations, commits, report). Safety rules: `/home/luca/AXION/web/docs/improve/PROCESS.md`.
