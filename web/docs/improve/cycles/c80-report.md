# c80 report: migration guard for append-only tables (R4-6)

Lane w78, branch `c80-migration-guard`, base `ee6d6ea`. No migration added. The live `axion` DB was never touched (tests use axion_e2e5 schemas).

## Files
- `server/test/append-only-guards.ts`: catalog discovery and the four-guards check.
- `server/test/c80-guards.test.ts`: item 1 tests (5 fixture migrations, one passing fixture, floor list, clearDemo end to end).
- `server/test/migration-lint.ts`: the lint (pure text, no DB). It lives under `test/` on purpose: my first version sat in `server/src/` and the c66 writability scan and the c69 registry test (which scan `server/src` text for write statements) flagged its SQL regexes. I moved it rather than touch those tests.
- `server/test/c80-migration-lint.test.ts`: item 2 tests (20 bad, 12 good fixtures, frozen baseline, real-migration check).
- `server/test/fixtures/c80-migration-baseline.json`: name plus sha256 of the up and down file for the 38 existing migrations.
- `web/docs/improve/cycles/c80-report.md`.

## Append-only tables found (36, from the catalog of a migrated schema)
agent_versions, approval_decisions, approval_requests, audit_events, delegation_briefs, eval_attestations, eval_calibration_labels, eval_cases, eval_datasets, eval_regrade_cases, eval_regrades, eval_results, eval_runs, events, failure_attributions, failure_pattern_candidates, failure_tags, lesson_candidates, mentoring_milestones, mentoring_plans, message_receipts, messages, metric_audit_labels, mission_delegations, mission_ledgers, org_edges, org_revisions, playbooks, record_contributions, site_grants, skill_outcomes, skills, system_jobs, task_attempts, task_owner_history, task_reviews.

Discovery rule: a table is append-only when a BEFORE trigger on it (enabled or not) that raises covers TRUNCATE, or covers UPDATE/DELETE and says "append-only" in its function. `agent_version_proposals` (identity guard only) and `tasks` (AFTER history triggers) are therefore not counted. Some of the 36 are append-only with conditions (eval_cases, eval_datasets, eval_runs are editable until frozen; approval_requests is updatable through its own guard); they still must carry the UPDATE, DELETE and TRUNCATE guard triggers.

## Item 1: generated four-guards test
For each discovered table: an enabled BEFORE UPDATE trigger that raises, the same for DELETE and TRUNCATE; where the table is reachable from demo data (a boolean `demo` column, then every ON DELETE CASCADE child), each DELETE guard must honour `axion.purge_demo`; plus a behavioural TRUNCATE inside a rolled-back transaction (must fail with P0001, or 0A000 when a foreign key stops it earlier). A seeded demo is cleared end to end through `clearDemo`.

RED (checker stubbed to find nothing): `Tests 7 failed | 2 passed (9)`. Failures: floor check (`expected 0 to be >= 36`), the five fixture migrations (`expected [] to include 'fx_log'`), the fully guarded fixture.
GREEN: `Tests 9 passed (9)`. Fixtures each miss exactly one guard and are caught with the right guard name: no TRUNCATE, no DELETE, no UPDATE, no purge_demo exception on a table cascading from missions, trigger present but disabled. The real schema yields zero violations.

Finding while building it: `approval_decisions` (0004) does not use `axion.purge_demo`. Its delete guard allows a DELETE when the parent `approval_requests` row is already gone (a cascade from a purged mission). That is a valid, narrower exception, so the check accepts exactly that pattern (`tg_op = 'DELETE' and not exists (select ... old.`) as well as the flag. Fixture "no purge_demo exception" still fails. Nothing in the schema was changed or loosened.

## Item 2: migration lint
Rules (up file): `drop-append-only` (DROP TABLE; ALTER TABLE ... DROP; DROP TRIGGER not recreated in the file), `guard-disabled` (DISABLE TRIGGER with no matching ENABLE of the same trigger, ALL or USER later in the file; `session_replication_role = replica` with no reset), `rewrite-rows` (UPDATE always; DELETE or TRUNCATE outside the `axion.purge_demo = on` exception set earlier in the same file, including inside DO blocks), `chain-column` (ALTER or RENAME COLUMN on the audit_events columns in canonical(row) plus prev_hash and row_hash: tenant_id, at, actor, action, subject, result, correlation_id, detail, seq, prev_hash, row_hash), `missing-down` (no file, or comments only). Comments and string contents are ignored; CREATE FUNCTION bodies are skipped; DO bodies are scanned.

Frozen baseline: the 38 migrations present at `ee6d6ea` (0001 to 0053 with gaps), pinned by name and sha256 of up and down. Editing one fails the test. Every migration NOT in the baseline is linted, so this covers 0058 onward and also a reserved number below 58 that lands later (for example the parked 0056 and 0057). Currently 0 migrations are outside the baseline, all clean.

False positives against the baseline (informational, they are excluded by the baseline): the lint reports 14 findings on 5 existing migrations: 0009 (task_attempts), 0010 (events), 0037 (eval_runs) `drop-append-only` (drop of a constraint or column), 0026 (the one-time chain backfill: 1 `rewrite-rows` plus 3 `chain-column` for SET NOT NULL) and 0044 and 0052 (backfills and drops on lesson_candidates, skills, eval_runs). Each of those is a real rewrite or drop of a guarded table, found by hand to be intentional. Note 0026 disables and re-enables its trigger in one file and is correctly not flagged as `guard-disabled`.

RED (lint stubbed to return nothing): `Tests 21 failed | 15 passed (36)`: all 20 bad fixtures not flagged, plus one baseline-count assertion of mine that was too strict (fixed later to > 30, not a loosened guard).
GREEN: `Tests 36 passed (36)`. Bad fixtures include: drop table (plain, quoted and schema-qualified), drop column, drop constraint in a multi-clause alter, drop guard trigger, disable trigger never re-enabled, disable ALL, re-enable of a different trigger, session_replication_role, UPDATE (plain, in DO, with the purge flag), DELETE (plain, before the flag is set, flag set to off), TRUNCATE, chain column type change and rename, missing down, empty down. Good fixtures (no finding): additive column, new table with guard function whose body mentions update/delete, DELETE under the flag (plain and via set_config in a DO block), disable-then-enable (trigger name, ALL), replica set then reset, drop and recreate the same guard trigger, operations on non-append-only tables, comments and strings mentioning forbidden statements, ON CONFLICT DO UPDATE, a non-chain alter.

## Item 3: `migration.applied` audit row (design question, not built)
Migrations run once for the whole database and touch every tenant, while the audit chain is per tenant (`tenant_id`, `seq`, `prev_hash` under a per-tenant lock). A single `migration.applied` row has no natural tenant. Options for the owner: (a) one row per existing tenant, written in the migration itself, which makes the row count depend on tenants and puts audit writes inside DDL transactions; (b) a reserved system tenant with its own chain, which `/audit/verify`, the anchor (c49) and the OTLP export would need to know about; (c) write the before/after evidence (chain head per tenant, row counts, immutable-column hash) to a file or the existing `schema_migrations` table and leave the audit chain alone. I lean to (c) for the first version (no chain changes, works on a fresh DB with no tenants) and to revisit (b) when R4-2 needs its single guarded migration. Not built, per the brief.

## Pass threshold
| Item | Result | Evidence |
|---|---|---|
| 1. Four-guards test RED to GREEN with fixture proof, nothing loosened | PASS | 7 of 9 RED with stub, 9 of 9 GREEN; 5 fixtures caught with the right guard; real schema 0 violations; no migration or guard edited |
| 2. Lint RED to GREEN with bad fixtures, baseline, nothing loosened | PASS | 21 of 36 RED with stub (all 20 bad fixtures), 36 of 36 GREEN; baseline frozen by hash |
| 3. `migration.applied` left out and recorded as a design question | PASS | section above |
| Full vitest serially, every failure named | PASS | tip of the committed tree before the report commit: `Test Files 137 passed | 1 skipped (138); Tests 3223 passed | 36 skipped`, 0 failures. First full run (before the lint moved to test/) had 2 failures, both mine: `c66-writability.test.ts > every insert/update/delete on an input table ... is a declared site` and `c69-registry.test.ts > task_owner_history is written only by a database trigger ...`, because the lint was in server/src and the scans read its SQL regexes. Fixed by moving the file, not by editing either test. |
| tsc | PASS | `npx tsc --noEmit -p .` clean at the tip |

## Diff stat
server/test/append-only-guards.ts                |  68 ++++++++++
 server/test/c80-guards.test.ts                   |  81 ++++++++++++
 server/test/c80-migration-lint.test.ts           | 101 +++++++++++++++
 server/test/fixtures/c80-migration-baseline.json | 154 +++++++++++++++++++++++
 server/test/migration-lint.ts                    | 126 +++++++++++++++++++
 5 files changed, 530 insertions(+)

(Plus this report, `web/docs/improve/cycles/c80-report.md`.)

## Concerns
- Discovery cannot see a new table that has no guard trigger at all (nothing in the catalog marks it append-only). The pinned floor list catches a table losing all guards, but a brand new unguarded table is only caught if its migration says "append-only" in a trigger function or declares a truncate trigger. A weaker backstop: the lint could require a migration that creates a table whose comments say "append-only" to also create guard triggers; not built.
- The lint is text based. It does not catch `CREATE OR REPLACE FUNCTION` that weakens a guard function body, dynamic SQL in strings, or a rename of an append-only table. It has no waiver mechanism, so R4-2's single legitimate migration will need a deliberate lint change.
- UPDATE of an append-only table is always flagged, including the "mutable until frozen" tables (eval_cases, eval_datasets, eval_runs) and approval_requests, where a backfill might be legitimate. 0052 is the existing example. A future backfill there will need a reviewed lint exception.
- The purge_demo check accepts the 0004 "parent already gone" pattern by regex. A differently worded cascade guard would be reported as a violation (safe direction).
- The TRUNCATE behavioural probe falls back to the catalog check when a foreign key stops TRUNCATE first (0A000).
- The lint lives in `server/test/`, not `server/src/`, because the c66/c69 write scans read `server/src` as text. It is test-only; there is no CLI or CI wiring beyond vitest.
