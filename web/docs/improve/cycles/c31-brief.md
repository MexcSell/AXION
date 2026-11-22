# c31 brief: tamper-evident audit chain (Phase 2 · Wave 1 · P5)

**Lane:** w29 (ports 7990 / 7991 / 7992–7993, DB axion_e2e29). Migration **0026**.
**Sources:** spec §11 (`audit_events … chain_ref`, append-only, redacted, access controlled); §13.

## Hypothesis
`audit_events` (server/src/audit.ts, migration 0001) is a plain table: a row can be changed or deleted and nobody would know. A per-tenant hash chain (each row stores `prev_hash` and `row_hash = sha256(prev_hash ‖ canonical(row))`), plus triggers refusing UPDATE/DELETE, makes any tampering detectable by a verify pass.

## Build (test-first)
1. Migration 0026 (up + down):
   - add `seq bigint`, `prev_hash text`, `row_hash text` (= the spec's chain_ref) to `audit_events`; backfill existing rows per tenant in id order;
   - unique (tenant_id, seq);
   - append-only triggers on `audit_events` (refuse UPDATE and DELETE; follow the existing append-only trigger style and the transaction-local `axion.purge_demo` exception exactly as other tables do), and the same on decision tables that lack them (check `approval_requests` decisions, `org_proposals` decisions, version-proposal decisions; list what you found and what you added).
2. `audit()` computes the chain inside the caller's transaction. Concurrency: take a per-tenant advisory lock (`pg_advisory_xact_lock`) so two writers can't fork the chain. Canonical JSON: reuse `canonical()` from approvals/service.ts.
3. `verifyChain(tenantId)` returns `{ok, checked, firstBadSeq?, reason?}`; route `GET /audit/verify` (admin/owner only, rate-limited) and a CLI `npm run audit:verify` (read-only).
4. Never log or hash secrets: the redacted detail is what gets hashed.

## Pass threshold (fixed)
- Tests that edit a row's detail, delete a row, reorder two rows, or insert a forged row (via a superuser-style test connection with triggers disabled in the test DB only) are each detected by `verifyChain`, with the right `firstBadSeq`.
- UPDATE and DELETE on audit_events are refused by the trigger (test).
- 50 concurrent `audit()` calls on one tenant produce one unbroken chain (seq 1..n, verify ok).
- Migration up → down → up works on a scratch DB; the backfill verifies ok on a DB seeded with the demo data.
- server tsc clean; full vitest green; api-auth-flow and api-flows pass.

## Report
`cycles/c31-report.md`, same format as other cycles.
