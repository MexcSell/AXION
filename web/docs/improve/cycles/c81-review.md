# c81 review: CLEAR (no blockers, no majors; 5 minors)
Ran: tsc clean; test/tenant + approvals + departments-order: 7 files, 49 tests pass (lane .env only).
Verified from the diff: no web/, migration, contracts or c50 change; c79 only lost exceptions (VOLATILE sizeBytes, UNORDERED memberIds/gmReports, SELF_SCOPED_OK emptied); none added.

1. minor - health (ops/routes.ts:38). "More than one tenant => omit" is fail-closed and the count is never returned. The omission itself tells an admin that a second tenant exists (1 bit). Web renders undefined as a dash (ServerHealth.tsx:51). Fix: note it in the report as an accepted residual, or compute per-tenant size.
2. minor - ack (notifications/routes.ts). VISIBLE is the one predicate shared with the list (private missions, member vs admin, deleted missions); idempotent (on conflict do nothing, second ack still 200). Select-then-insert is not in a transaction; the worst race is an own marker for a notice just hidden, which is harmless. No fix needed. ack-all drops hidden ids silently (200), documented.
3. minor - app.ts:88. 22021/22P05 mapping is narrow (exact codes, 400 generic body, no DB text leaked). It returns before req.log.error, so a server-built NUL value now yields an unlogged 400. Fix: add req.log.warn({err}) before the reply.
4. minor - MR2/MR4 at-rest (swap.ts ~L140, forged.ts L115). Sorted-lines compare is a multiset (duplicates counted, one row_to_json per line), so it cannot hide an insert, delete or update in B. The gap is coverage: atRestText covers only tables with tenant_id. About 16 tables have none (messages, message_receipts, message_attachments, thread_reads, task_attempts, task_dependencies, mission_runs, mission_revisions, org_edges, eval_cases, etc.), and `sessions` is volatile-excluded. A write that touched only those on B would be seen only if a B GET snapshot reaches it. Fix: join those child tables to their parent's tenant in atRestText, and compare sessions by count and user_id.
5. minor - MR2 shape compare (30 of 55 writes). Alone it is weak, but acting on B must change a B row, and B's tenant_id tables and 76 GET snapshots are compared before and after, so the relation is meaningful except for finding 4's tables. The 42 plain 2xx results show it is not vacuous.

Other checks
- Departments: sort(cmp) by agent id is deterministic; the test reverses insert order.
- approvals.test.ts: fair. Mina/Kenji visibility assertions are kept; it now acks real ids plus N-1 and N-2 and asserts the made-up ones are not stored. Nothing loosened.
- Item 5: reverseQueryCases is generic over QUERY (placeholder regex, QUERY_ID_PLACEHOLDERS inventory test). M19 is meaningful: it faults only the second-agent lookup (p[1]==='b-tester-01'), and it survived the c79 sweep before the case was added.
- M18-M21: each is killed with its intended relation (WRITE, FOREIGN-GET, MR2, MR4), enforced by mutants.test.ts.
- MR4 corpus: 75 rows, all brief classes present (case, whitespace, percent/double encoding, .., Cyrillic/fullwidth/zero-width, truncation and b- prefix, arrays, __proto__/$.path). Gap: few forged body-field ids and no header forgeries (minor).
- The "caller sent it" echo exemption in forged.ts is acceptable.
