# c87 review (in-tenant visibility sweep), dce8d78..c78f1bf: NOT CLEAR

Independent reviewer, 2026-11-23. This is the controller's copy of the hand-back.

**Checks run:** tsc is clean. vis, vis-mutants (9/9), c87-opennow and c65-privacy all pass.

## Findings

1. **MAJOR: the attempts family is never seeded, so the sweep is vacuous there.**
   - `vis-fixture.ts` writes no `task_attempts` rows.
   - `company/routes.ts:41`, `process-routes.ts:53` and `company/stale.ts` aggregate attempts of visible missions.
   - A c86-shaped leak in rework, retry or stale-review figures cannot show.
   - Fix: give `T-pv-*` two attempts in b1, flip them in b2, and assert that the admin's `/company/process` changes.

2. **MINOR: some aggregates are never reached (the admin's response is unchanged between states).**
   - `GET /organization/proposals` is `requireUser`. It returns stored evidence (`organization/evidence.ts:48-111`) that counts open tasks, failures and approvals over all non-demo missions, with no VISIBLE_SQL. Treat this as a probable finding.
   - Also unreached: `/lessons`, `/skills/:sid/contributions`, `/agents/:id/playbook` and `/mentoring`.
   - The lane's 4 vacuous routes are fine:
     - failure-patterns and operations/queues are admin-only;
     - metric-guard holds audit labels only;
     - policy/baseline is constant.

3. **MINOR: two fields the fix floors are invisible to the sweep.**
   - `isolation.ts:98` normalises `avgOpen` and `lambdaTimesW` (a c79 entry, not new).
   - So V1 is blind to the two fields c87 floors. Only `c87-opennow.test.ts` covers them, and only below the floor.
   - Fix: compare them rounded, or add a hidden-item case above the floor.

4. **MINOR: `littles.status`, `missingClose` and `missingOpen` still leak to a member.**
   - `MISSING_OPEN_SQL` counts tasks of hidden missions. Below the floor, a count of 1 isolates one hidden task's data fault.
   - Ruling: fix it. Null the counts below the floor, keep `status`, and adjust `ReviewCapacity.tsx:68`.
   - It stays minor because it needs corrupt data and n is already public.

5. **MINOR: the SSE check scans for markers only.**
   - A private event with no free text (`task.stateChanged`, ids, counts) would pass.
   - The positive control is real: admin and owner streams must carry markers, and the member's own control event must arrive.
   - Fix: also scan M's stream for the private ids.
   - Sequential states are sound: O is approved before state a, b1 contains every change from a, and the CONTROL pairs prove the normalisation is enough.

6. **MINOR: one BY-DESIGN citation is wrong.**
   - The review-capacity entry matches its sources (`c65-brief.md:32`, `c65-review.md:20`, `c65-privacy.test.ts:42`).
   - The approvals/quality entry does not. `c58-brief.md:25` says nothing about n, and `c58-review.md:83` is a "backlog only" residue, not a ruling. Reword it as an unruled residue and cite :83 only.
   - The fixedBy ack finding has no paths, so any IDW violation on that route is excused while fixedBy is set. Fix: pin it to status 200.

7. **NOTE: the mutants.**
   - All 8 are killed for the intended route: the applied count is asserted, and the tables must not excuse them.
   - None drops VISIBLE_SQL inside a CTE or a join, which is what c86 did. Add one on dimensions, process or departments.

8. **NOTE: the product fix is sound.**
   - The floor uses the same total row as toCell (arrivals ≥ 5 and people ≥ 3).
   - Admins are unchanged.
   - The contracts and validator are nullable, with no allowlist line and no migration.
   - Web wording: use "open count hidden below the floor".
   - The api-c65 interception is a fair render test; the server-side null is proven by vitest.
