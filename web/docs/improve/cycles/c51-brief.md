# c51 brief: task-review hardening and required delegation briefs (O3a + O2a)

**Lane:** w50, from improve-30h at b06554e (c38 task reviews, c42 delegation briefs, c47–c49 merged). Ports 10090 (dev), 10091 (preview) and 10092–10093 (e2e). E2E DB **axion_e2e16** (reused; c44 merged). Migration **0039**.
**Source:** BACKLOG O3a (from the c38 re-review) and O2a (from c42).

## Hypothesis
Three gaps let a weak review count as independent verification:
1. Prior-actor exclusion depends on audit rows, which are fail-open if the audit is missing.
2. An old accepted review re-verifies a task after fail → retry → pass.
3. The vendor and model-family match for o-series models and router prefixes is loose.

Closing them makes "verified" mean "a different, eligible reviewer accepted the latest attempt". Separately, a human reassignment without a brief loses the scope contract that c42 introduced. Making the brief required everywhere closes that, once the frozen api-stage6 step sends one.

## Build (test-first)
1. **Owner history (migration 0039).**
   - Add an append-only `task_owner_history` table, written by a trigger on `tasks` whenever the owner or assignee changes.
   - Guard it with the same pattern as the other append-only tables (UPDATE/DELETE/TRUNCATE refused, with the purge_demo exception).
   - Backfill it from the current tasks plus any audit history available.
   - The prior-actor exclusion in the review rules reads this table, fail-closed: if a task has no history row, the review is refused with a clear reason.
2. **Review freshness.** A review verifies only if it was created after the task's latest attempt started (DB time). Reviews older than that are shown as "stale (before attempt N)" and don't count.
3. **Vendor matching.**
   - The o-series match is exactly `o[1-9]` followed by a separator or the end.
   - A router prefix that names a different vendor (for example `anthropic/gpt-4`) resolves to null (unknown), which means not eligible as "different family".
   - Extend the vendor alias table tests.
4. **O2a.**
   - First, update the api-stage6 reassign step to send a valid brief, using the same helper as c42's UI. Don't change any of its assertions.
   - Then make the brief required server-side on `POST /tasks/:id/reassign`. Without one, the route returns 400 `BRIEF_REQUIRED`.
   - The UI reassign dialog always collects one.
   - Check every caller with grep: scripts, tests and the UI.
5. **Locks** go only through `server/src/locks.ts`. Event types must be in the contracts `EventType` list, and c50 will enforce this at merge.

## Pass threshold (fixed)
- **Owner-history tests:**
  - the trigger records every owner change, including raw SQL updates;
  - UPDATE, DELETE and TRUNCATE are refused;
  - a task with no history row refuses a review;
  - a prior owner can never verify, even after their audit rows are purged through the demo path.
- **Freshness tests:** fail → retry → pass with the old accepted review leaves the task not verified, and a fresh review verifies it.
- **Vendor tests:** `o1-mini` and `o3` match o-series; `o10x` and `bo1` don't; `anthropic/gpt-4` resolves to null.
- **O2a:** reassign without a brief returns 400. api-stage6 passes 94/94 with only the brief added to its reassign step (show the diff). api-c42 passes.
- ≥ 30 new server tests. Full vitest, tsc and verify-all 10/10 pass. api-c38 and api-c42 pass.

## Report
`cycles/c51-report.md`.
