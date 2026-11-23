# c83 report: metric guard follow-ups (M2b), lane w81, branch c83-metric-guard-2

Base 5891ad7. Server and shared/contracts only; no `web/` file, no migration. E2E DB axion_e2e15 (never the live `axion`). Final full run taken from the committed tree.

## Item 1: open-check (each of items 2-4 was open on the base)
- Item 2: migration 0050 only checks `length(sample_ref) between 1 and 120`; the route took any string. RED run of `c83-sample-ref.test.ts` on the base: free text such as `s0` and `some free text` was accepted (the "refuses free text" test failed), and after `seedDemo`, labelling demo rows and `clearDemo`, the labels `mission:M-118`, `approval:APR-M-126-1`, `task:T-12601` were still in `metric_audit_labels` (the purge test failed with exactly those three).
- Item 3: `loaderTables()` (server/test/contracts/writability.ts) read 4 files and matched only `from|join <table>`: table level.
- Item 4: computed from the declared columns, 16 registry rows had a counter-metric sharing an input column with the primary (the RED list is in the commit 33147ab run: finished, verified_success_rate, completed_unverified, median_cycle_time_h, failure_rate, task_recovery_rate, throughput, kpi.success.api, context_loss, playbook_items, first_pass, cross_family_reviews, lessons_proposed, lessons_accepted, process.first_pass_acceptance, process.handoff_wait_h).

## Item 2: `sample_ref` is typed, and the demo purge removes its labels (no migration)
- Contract (`shared/contracts/src/metric-registry.ts`): `SAMPLE_REF_KINDS` (mission, task, review, approval, failure_tag), `parseSampleRef`, `sampleRefOf`. Wire format stays a string, `<kind>:<id>`, id `[A-Za-z0-9][A-Za-z0-9._-]{0,99}`.
- Write path: `server/src/company/metric-audit-store.ts` is the only inserter (a test scans `server/src` and fails on a second one). It refuses anything that does not parse (400 from the route schema) and anything that names no record of the tenant (422), checked per kind with literal SQL.
- Purge: `clearDemo` (application code, `server/src/seed/demo.ts`) calls `purgeDemoAuditLabels` first, inside its transaction where `axion.purge_demo` is on. It deletes every label (whole history of the sample) whose reference resolves to a record of a demo mission. `axion.purge_demo` was not touched, so no migration text is needed. The audit event `demo.clear` now carries `auditLabels`.
- Test: seed demo, label a demo mission, task and approval (and a real mission), purge: no label references a purged row, every remaining label still resolves, the real one survives; UPDATE/DELETE stay refused outside the purge.
- Limits: the `review` and `failure_tag` kinds are exercised only through the purge SQL compiling and running (no demo row of those kinds exists to label). A person deleting a mission through `DELETE /missions/:id` is not a demo purge and leaves its labels (the table is append-only; the purge flag is set only by `clearDemo`). Reported, not changed.

## Item 3: column-level loader coverage
- `server/test/contracts/columns.ts` cuts the SQL out of the string literals of a source file, expands `${}` from the real fragment functions (`VISIBLE_SQL`, `STALE_*`, `SELECT_MISSION`, `sqlInWindow`) or a same-file `const`, builds the alias map from `from|join`, and finds `alias.column`, `alias.*`, bare `select *` and bare words that are columns of the statement's tables. Real columns come from `information_schema` on a migrated schema. An expression it cannot resolve is reported, never guessed.
- Registry rows now carry `loaders` and `reads` (`shared/contracts/src/metric-reads.ts`, merged into `METRICS`). Context columns (keys, tenant, mission link, visibility) are declared once with reasons; `LOADER_EXTRA` lists columns a loader fetches for another screen; `NON_METRIC_COMPANY_FILES` lists the two company files that are not metric loaders.
- Scope: every file under `server/src/company/` with SQL (a new one fails until a row names it or it is listed as non-metric), plus the loaders rows name outside it: `missions/service.ts#listVisible`, `instances/service.ts#listInstancesPage`, `approvals/routes.ts#GET /approvals`, `evolution/proposal-evidence.ts`. `stale.ts` and `clock.ts` are fragment files, expanded at their call sites (a test fails on a new exported fragment function that is not known).
- Two directions: every column a loader reads is declared by a row naming it; every declared column is read by one of the row's loaders; declared columns exist in the schema; a row's input fields tie to at least one column of their tables.
- RED: (a) with `METRIC_READS` emptied, 4 tests failed ("has inputs but declares no loader or no column", one line per row). (b) In-test proofs on injected source: an undeclared `tasks.title` read added to `company/routes.ts` is reported by name; a new company file with SQL no row names is reported; an unknown template expression is reported; a declared-but-unread column and a column not in the schema are reported.
- Found while building it: a regex bug of mine (a table without an alias swallowed the following `join`) was fixed before the declarations were frozen; the test now pins it.
- Limit stated in the test header: the unit is the loader, so when two rows share a loader, which of them uses a column is a reviewed declaration, not a machine proof. SQL built by concatenation or at run time is not seen.

## Item 4: weaker counter-metrics
- `sharedInputColumns` (contracts) intersects the declared reads of a row and its counter, minus context columns and scope-only columns (department cut, sample and DEMO flags). `registryProblems` fails a row whose counter shares a column unless `counter.weak` has a reason (40+ characters); it also fails `weak` on a row that shares nothing, so the list stays computed.
- Re-pointed to independent inputs (10): finished, median_cycle_time_h, failure_rate, throughput (now `tasks_verified_by_review`); cross_family_reviews, process.first_pass_acceptance, process.handoff_wait_h (now `failure_rate`); playbook_items, lessons_accepted (now `first_attempt_verified`); lessons_proposed (now `playbook_items`).
- Marked weak with a reason (6): context_loss (listed first; the review said its counter does not rise: the only stored signals of a failed task are status, attempts and tags, and the row reads all three), verified_success_rate, kpi.success.api, completed_unverified, task_recovery_rate, capability.first_pass.
- Scorecard state: shown through the existing `counter.why` field (prefix "weak counter-metric, it shares an input with this row so it may not show gaming (reason); meant to show: ..."). No DTO field, validator or web file changed; the c50 `metricGuard` validator test accepts it.
- Guard test (RED then GREEN): a new row with a shared-input counter fails; with a reason it passes; weak on an independent counter fails.

## Pass threshold
| Item | Result | Evidence |
|---|---|---|
| Item 2 RED to GREEN | PASS | 96500ac (RED, 3 failing tests) to cfe0c37 (GREEN, 6/6) |
| Item 3 RED to GREEN | PASS | RED with `METRIC_READS` emptied (4 failed), in-test injected-read RED proofs; GREEN 6c9f326 |
| Item 4 RED to GREEN | PASS | 33147ab (RED, 16 rows listed) to 5b0b181 (GREEN) |
| Full serial vitest, no failure | PASS | `heavy.sh npx vitest run` on the final tree: 155 files passed, 1 skipped; 3431 tests passed, 36 skipped; 0 failed (346 s, load average about 10; the parallel run had no connection errors, so no serial fallback was needed) |
| tsc clean | PASS | `tsc --noEmit -p server` |
| No `web/` file, no migration | PASS | `git diff 5891ad7..HEAD --stat` (below) |
c78's RATING_FIELDS and value-order scans, c50 allowlist sizes and c79 exceptions are untouched and green in the full run.

## Files changed
server/src/company/metric-audit-store.ts (new), metric-guard-routes.ts, server/src/seed/demo.ts; shared/contracts/src/metric-reads.ts (new), metric-registry.ts, index.ts; server/test/contracts/columns.ts (new), c83-sample-ref.test.ts, c83-registry-columns.test.ts, c83-weak-counters.test.ts, c83-refs.ts (new); c66-metric-audits.test.ts and contracts/coverage.test.ts (their sample references are now typed, naming real missions).

## Concerns
1. (Resolved on the controller's instruction.) `web/scripts/api-c66.mjs` posted free-text refs. It now collects typed refs from the missions, tasks and approvals the database holds, creates real missions if fewer than 100 exist, and adds a check that a free-text ref is refused (400). Run in api mode on 13192/13193 against axion_e2e15: `28/28 passed`, no page errors (before the fix it failed 3 of 28 with a 17-record database). A grep of `web/scripts` and `server/test` found no other free-text sample_ref caller.
2. The popover and help text in `web/` do not yet explain "weak"; the state reaches the screen only through the `counter.why` sentence.
3. The old table-level `loaderTables()` test remains (4 files); the new test supersedes it for columns.
4. The 10 re-pointed counters are judgement calls (the registry sentences say what each would show); the machine proves only that their input columns do not overlap, not that the signal is strong. This was run on a loaded machine; I took no timing measurements.
