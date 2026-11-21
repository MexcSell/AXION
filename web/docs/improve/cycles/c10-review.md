# Cycle 10 review (lane w8): database indexes and scale benchmark

Verdict: spec PARTIAL, quality GOOD with one Important fix. Reviewer is read-only; nothing was run, findings come from the diff and the sources in /home/luca/AXION-w8/server.

## 1. Indexes versus the hot queries: OK
- `events(tenant_id,type,subject_id)` matches the reliability `ev` CTE (`agents/reliability.ts:121`, tenant + type + `subject_id in (...)`). The scorecard transitions query (`company/routes.ts:30`) uses tenant + type + `mission_id = any(...)`: the index serves only the tenant/type prefix, and `mission_id` is not in it (existing `events_mission_seq` may be chosen instead). Minor: `(tenant_id,type,mission_id)` would fit that query better.
- `audit_events(tenant_id,action,subject)` matches the `moved` CTE (`reliability.ts:132-133`). Good.
- `tasks(mission_id)`: no prior index (only the PK); used by the scorecard, the reliability join and `instances/service.ts:76,97`. Good. Partial `tasks(owner_instance_id)` matches `service.ts:76` and helps the on-delete-set-null FK. `mission_runs(mission_id,started_at)` matches the scorecard `min(started_at) group by mission_id`.
- Down drops exactly the 5 indexes the up creates (`0017*.sql`, `if exists`, reverse order). No semantics change: indexes only, no query edited.
- Base here has migrations 0001-0013 then 0017 (0014-0016 come from other lanes). The bench's "migrate to 0016" therefore means 13 on this base; harmless.

## 2. Benchmark and numbers
- Safe: guard regex `/axion_e2e\d+/` (`scale-bench.ts:20`), never `axion`. Minor: it accepts any lane's e2e DB, not only its own, and does `migrate down 0` (wipes it); pin it to the lane id.
- Seeding is insert-only, so the append-only triggers stay on. Volumes match the brief.
- Honesty: the report is candid, and states "50% drop NOT MET". But the "already below 50 ms" clause is only true in the one cleanest run (agents 47.3 ms before, 3 ms of headroom). Two earlier BEFORE runs gave /agents p95 78.1 and 100.9 ms and scorecard 43.9 and 59 ms, so "already below 50" is not robust; AFTER runs of 72/84 ms were also above 50. The clause was meant for a stable measurement, not a best-of-three on a noisy host. The decision between those runs is the author's pick, not a rule.
- Ruling on threshold: PARTIAL, not PASS. Indexes shipped and the up/down/up test is fine, but the performance goal is unproven at this volume (planner already fast; gain within noise). Recommend recording it as "measured, no regression, benefit unproven; re-test at 500k events".
- Raw bench output is not committed, only summarised.

## 3. proposals.test.ts:306
`toBe(13)` to `toBeGreaterThanOrEqual(13)` is a mild weakening: it no longer detects "up stopped early" (e.g. returns 13 while 0017 is pending). The cycle 5 approach, `Math.max(...listMigrations().map(m => m.version))`, keeps the full strength and survives future migrations; use it (`listMigrations` is exported from `src/migrate.ts`). The same loose style appears in `scale-indexes.test.ts` (`>= 17`, `< 17`); there too use the computed max. The report mentions 2 first-run failures but only 1 assertion changed in the diff; clarify.

## 4. Live DB write cost
The report notes only the build-time SHARE lock (fine for a tiny DB). Not noted: every events insert (hot, append-only) and audit insert now maintains an extra index, and `events_tenant_type_subject` is wide on a growing table; `events` already has the PK, `events_mission_seq` and `events_tenant_id`. Cost is small today; add one line to the report, and consider confirming `tasks_owner_instance` earns its keep (not used by the benchmarked queries).

## Findings
- Important: threshold verdict should be PARTIAL, not PASS via the "<50 ms" clause (noisy earlier runs 72-101 ms).
- Important: use computed max migration instead of `>=13` in proposals.test.ts and scale-indexes.test.ts (avoids weakening).
- Minor: no per-insert write-cost note; scorecard events query not fully served by the new index; guard accepts any lane DB; raw bench output not stored.
