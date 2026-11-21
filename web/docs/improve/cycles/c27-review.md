# Cycle 27 review (independent)

Spec: PASS. Quality: PASS with minors. No Critical or Important findings.

## Checks
1. Fixes and RED tests
   - m7: `server/src/agents/versions.ts:252` drops `why` from the `agent.rolledBack` payload. The new test (`version-proposals.test.ts`, "m7") asserts no `why` property and no "Priya"; it fails on the old payload.
   - m6: `versions.ts` `.catch` writes `agent.rollback` / `denied` with `{code}` for VERSION_NOT_OF_AGENT, ALREADY_ACTIVE, SAME_CONFIG only. The test asserts +1 row, exact detail, and none for a missing Idempotency-Key. It fails without the fix (0 rows).
   - c11 m3: `kindDeptText()` (`staffing-org.ts`) is used in the help template. The test pins the generated string and the template call; it fails without the fix (import missing, no `${kindDeptText()}`).
   - c06 DEMO tags (`Operations.tsx`): only on keys work/learn/evo, only in api mode on the Agents tab. api-c27 checks the three tags and that Agents stays untagged.
   - `?chat=admin` (`AppShell.tsx`): only `chat` is deleted; search and hash are kept. api-c27 checks the full URL.
2. m7: no other event carries `why`. `announceVersion` emits only `rollbackOf`, seq and label. The reason survives in the `agent.rollback` audit row. Minor: no route or admin UI reads `audit_events.detail` for it (grep shows only reliability, departments and history reads, none of them the reason), so "administrators keep it" means DB-level only. The web never read `why` from the event, so nothing regresses. The 1000-char reason is still stored in the audit row, as before.
3. m6: `requireAdmin` runs first, so only admins can write denial rows. Code comes from a fixed three-item set and the subject is an existing agent (not-found is excluded), so nothing is spoofable and no free text is stored. A retry audits again because the idempotency row rolls back with the transaction. That is acceptable: each refused attempt is a real attempt, and keying by Idempotency-Key would have to survive the rollback, which needs a second write. An admin can still add rows by repeating refused calls. That is bounded by admin auth and is the same as every other denied audit.
   - Minor: if the denial audit insert itself fails, the original 422 is replaced by the DB error. Wrapping it in try/catch would be safer.
4. c11 text test: reads the file, finds the line containing `'mission.create'`, requires the literal `${kindDeptText()}`, rejects the old hand-copied fragments, and checks every KIND and department appears in the output. This is not trivially passing. It would break if the help key were renamed (the `!` assertion on `find` throws), which is a loud failure, not a false pass.
5. Scope: touched files are 7 source/test files plus the new script and the report. None are changed by c08, c09, c10, c12, c14, c15, c17, c19, c20, c24, c25 or c26 relative to a67d2dd. `git merge-tree HEAD improve-30h` is clean. No likely conflicts. Listed-not-fixed items (c05 m8, c04 m6, c22 M2) were correctly deferred.
6. Nothing loosened: the audit gets stricter, the public event leaks less, and no test was relaxed. The one new audit row type is additive.

## Minor
- Guard the denial audit (try/catch) so audit failure cannot mask the 422.
- Optionally record in the audit-row docs that the reason lives only there.
