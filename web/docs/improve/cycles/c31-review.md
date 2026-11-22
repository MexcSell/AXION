# c31 review: tamper-evident audit chain (branch c31-audit-chain, tip b83498a)

Verdict: NOT CLEAR until I1 is fixed (one script breaks). Everything else holds.
Ran: `vitest run test/audit-chain.test.ts test/migrate.test.ts` through the gate: 21/21 pass.

## Findings
- **Important I1** server/scripts/scale-bench.ts:76,80: two raw `insert into audit_events (...)` without seq/prev_hash/row_hash. After 0026 these violate NOT NULL, so `scale-bench` fails at seed. The report says every raw insert was checked, but only the three test fixtures were fixed. Fix: seed through audit() (or a SQL insert that fills seq/prev_hash/row_hash), or have the script produce chained rows some other way. (grep of src/, scripts/, test/ shows no other raw insert; test inserts in audit-chain.test.ts:91,100,133 are intentional and column-complete or pre-0026.)
- **Minor M1** server/src/audit.ts:20-34: a Pool caller now runs a transaction with an events lock plus `lock_timeout 5s`. auth.connect denied (auth/routes.ts:80), auth.logout (:174), upload.create (uploads.ts:92) can now throw a lock timeout under events-lock contention. For the denied login that turns a 401 into a 500 (the audit write was previously a single non-locking insert). Normal behaviour is unchanged (the audit row is still written independently of the failing request; the throw only arises on timeout). Consider catching and logging for the denied-login case, or accept.
- **Minor M2** audit.ts:52: `at` is now `clock_timestamp()` instead of the column default `now()` (transaction start). Rows are stamped slightly later than before. reliability.ts:132 orders handovers by `x.at`; the change is harmless (more accurate) but is a behaviour change not mentioned in the report.
- **Minor M3** migration 0026 SQL canon: numbers are emitted as jsonb text (`1.0`, `1.50`, `1e3` print differently from JS `JSON.stringify`). Rows written by the app never contain such forms (JS wrote them), so the backfill and verify agree on real data; a hand-inserted row with `1.0` in detail would backfill to a hash that verify then rejects. Astral-plane key ordering differs too (already noted by the implementer). Acceptable.
- **Minor M4** perf: every audit() now holds the process-wide events lock to commit (already acknowledged). Fine at current volume; every request that audits serialises with all event writers.
- **Note** tail truncation and a full recompute are not detectable (acknowledged in the report; out of brief scope).

## 1. Deadlock and lock order: OK
- Events lock (`EVENTS_LOCK` 0x41584556) is taken by appendEvent (events/log.ts:22; emit calls it) and now by audit() first (audit.ts:47), then the tenant lock keyed `hashtextextended(schema || ':audit-chain:' || tenant, 0)` (:48). Tenant lock is taken only here, and always second, so no cycle on these two.
- Emit-before-audit (auth/routes.ts:207-208 password) and audit-before-emit (:~72, 175 etc.) both work: the events lock is already held (re-entrant in one session).
- Other advisory locks (grep pg_advisory): lock(1) (auth/routes.ts:65,275), agent-create, agent-ver (lockAgent), org-rev (lockOrg), org-prop (lockProposals), instance-backfill, agent-seed, migrate's session lock. I traced the writers (POST /agents, PATCH /agents/:id, version decision, org proposal create/decision/rollback, agents/seed, demo seed): each takes its lock before its first audit/emit, so the order is X then events then tenant everywhere I found. Demo seed's backfill lock comes after requestApproval (pre-existing, not changed by this branch). I could not prove absence of an audit-before-row-lock path in every route; none found.
- Key collisions: int4 hashtext keys, the constant 1, the 0x41584556 constant and the 64-bit tenant key share one bigint key space; a collision is only extra serialisation and astronomically unlikely.
- Nested tx: audit(Tx) never opens a transaction; only a Pool does (`instanceof pg.Pool`; Db = pg.Pool). Rollback leaves no gap (tested).

## 2. Chain soundness: OK
- Hashed == stored: detail is redacted once, the same string is inserted and `JSON.parse`d for the hash; verify hashes the jsonb as read. `at` is generated in SQL as UTC microsecond text, inserted via `::timestamptz` (exact microseconds, no JS Date), and verify re-renders it with the same to_char. No JS Date round trip. tenant and seq are in the hash.
- All columns hashed are NOT NULL in 0001 (correlation_id, actor, detail ...), so the SQL concat cannot become NULL.
- JS canonical vs SQL twin agree on strings (control chars, unicode, escapes), nested objects, arrays, null, booleans, ints and plain decimals; tested with unicode, nested, 1.5.

## 3. Verify route: OK
- audit-routes.ts: `requireAdmin` (role === 'admin'), tenant taken from the session ctx, never from input, so another tenant's admin cannot verify this tenant. Limiter after auth: 6/min keyed on tokenHash, 429 with retry-after. Not in LIMITED_ROUTES (read, and the route-table test is for writes). Response contains only ok, checked, firstBadSeq, reason (seq numbers and fixed strings); no hashes, details or secrets. Tests cover 403, 401, tamper, 429.

## 4. Migration: OK except I1
- up: add columns, backfill in `order by tenant_id collate "C", id`, which is the seq order verify uses (live rows: id is assigned under the tenant lock, so id order = seq order). Update trigger disabled only inside the migration transaction (migrate() wraps each file in begin/commit) and re-enabled; the delete/truncate triggers are untouched. NOT NULL and unique added after the backfill.
- down: drops trigger, constraint, columns, then function in a safe order; append-only still holds after down (tested); up-down-up tested, also on a demo-seeded DB.
- Only `audit()` inserts audit rows in src/; `scripts/scale-bench.ts` is the exception (I1).

## 5. Tests: OK
- agent-reliability, migrate, scale-indexes: diffs only replace the raw insert with audit() (plus the import); every expect line is untouched. In scale-indexes, 200 sequential audits replace the generate_series insert; same row count.
- Tamper helper (audit-chain.test.ts:9-16) disables `trigger user` on the scratch-schema table in the test, re-enables in finally. The route test tampers t-1 in its own makeTestApp schema. Nothing is global.

## 6. Live-migration risk (for the controller)
ALTER TABLE takes ACCESS EXCLUSIVE on audit_events for the whole one-transaction migration; the backfill rewrites every row once (about 4 s per 100k rows measured by the implementer; table bloat until vacuum). Run with the server stopped, after a backup. Down loses the chain (hashes are dropped). Also fix I1 first if scale-bench is used against that DB.
