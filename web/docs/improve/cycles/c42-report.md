# c42 report: typed delegation brief and scope contract (Phase 2 · Wave 3 · O2)

Lane w41, branch `c42-delegation-brief` (from c30-policy-service f483e2d). Migration 0034. E2E DB axion_e2e14, ports 9190-9193.

## What was built
- `server/src/delegation/brief.ts`: strict, bounded zod `DelegationBriefIn` (goal, inputs[], acceptance[] min 1, capabilities[] of `{kind, origin?}`, budget?, deadline?, escalation), `canonicalJson` (keys sorted at every level), `briefSha`, `scopeViolations` (pure subset rule), frozen `MAX_CHAIN_DEPTH = 3`.
- `server/migrations/0034_delegation_briefs.{up,down}.sql`: `delegation_briefs` (id, tenant, mission, task, from, to agent instance, brief jsonb, sha256, parent_brief_id, supersedes_id, depth 1..3, simulated). Append-only: BEFORE UPDATE/DELETE and BEFORE TRUNCATE triggers, with the `axion.purge_demo` exception for the demo-purge cascade only.
- `server/src/delegation/service.ts`: `createBrief` (one path for every writer), `attachSimBrief`, `listBriefs`, `delegableKinds`.
- Rules: capabilities must be a subset of the delegator's scope. Agent delegator: its own latest brief, else the mission's root brief, else 403. Human root: each kind through `evaluate()` (the human's own gate: deny, or an approver the role cannot hold, is refused; an origin additionally needs the ability to approve `origin-grant`), and again from the delegate's side (kinds prohibited for agents, e.g. `security_policy_rewrite`, are refused for everyone). Depth over 3 is 400. No acceptance is 400. A past deadline, a child deadline after the parent's, and a child budget above the parent's are 400 (compared in SQL with `now()`, lesson from Wave 1-2). A superset is 403 and the message plus `fieldErrors.capabilities` name the items. A change is a new brief with `supersedes`; the latest brief of an agent is its scope.
- Routes: `GET /missions/:id/delegation-briefs` (visibility-checked, 404 otherwise; returns briefs with tiers, `maxDepth`, delegable kinds), `POST /missions/:id/delegation-briefs` (idempotent, CSRF, `proposals` rate bucket; added to `LIMITED_ROUTES` and `SINCE_STAGE5_WRITES`). No update or delete route.
- Wire-in: `POST /tasks/:id/reassign` takes an optional `brief` (recorded in the same transaction; a refused brief refuses the reassignment). `joinMission` (the staffing simulator, DEMO and real) attaches a brief to every new delegation (a system root brief for the manager if it has none, then a child brief with a subset); a chain that would pass the cap skips the brief instead of failing the step. Backfilled and older delegations keep no brief and render "No brief (legacy)".
- Web: `DelegationBriefCard` in the task drawer (DL-13): chain breadcrumb, goal, acceptance checklist, capability chips coloured by tier, deadline, budget, escalation, sha prefix, `?` help `delegation.brief` (cites the paper as conceptual, no experiments). The Delegate / reassign dialog (DL-12, api mode) has a compact hand-off brief form (goal, acceptance lines, tier-coloured capability chips, deadline, escalation). Shared types in `shared/contracts/src/delegation.ts`.

## RED / GREEN
- RED: `server/test/delegation-brief.test.ts` written first; the first run failed to load (`src/delegation/brief.ts` did not exist): "Tests no tests", 1 file failed.
- GREEN: same file 13/13; then the full server suite.

## Pass threshold
| Item | Result | Evidence |
|---|---|---|
| Subset rule holds at depth 1, 2, 3 | PASS | test "subset rule holds at depth 1, 2 and 3" (201 at each depth, parent chain checked) |
| Superset is 403 naming the items | PASS | message and `fieldErrors.capabilities` contain `send_message` and not the allowed `fill_draft`; also in api-c42 (`release`) |
| Depth over the cap is 400 | PASS | depth 4 refused, no row written (3 rows remain) |
| No acceptance is 400 | PASS | server test and api-c42 |
| Child deadline after parent is 400 | PASS | plus past deadline and budget above parent |
| sha256 stable under key order | PASS | pure test (key order, capability order, duplicates, origin case) and API test (same sha from reversed key order) |
| Append-only | PASS | UPDATE, DELETE, TRUNCATE throw; demo-purge cascade still deletes briefs |
| Visibility | PASS | private mission 404 for another member on GET and POST |
| Property test, 300 random chains | PASS | 300 chains, no accepted delegate holds a capability an ancestor lacked (asserted against every ancestor); test requires >100 accepted and >20 refused levels |
| DEMO simulator still runs: api-stage6 94/94, api-flows | PASS | api-stage6 94/94, api-flows 23/23; server test shows simulator briefs with parent chain, depth <= 3, subsets |
| `web/scripts/api-c42.mjs` shows the brief on a delegation | PASS | 13/13 |
| server tsc, vitest | PASS | tsc clean; vitest 40 files, 692 tests passed (includes the c42 file and the security route-table test) |
| web tsc | PASS | clean |
| a11y | PASS | demo: `50 views, 56 dialogs, 0 violations`; api mode: `40 views, 56 dialogs, 0 violations` |
| fit-check ALL FIT | PASS | `ALL FIT`, 77 views ok, 0 failures |

E2E command: `E2E_API_PORT=9192 E2E_WEB_PORT=9193 heavy.sh ./scripts/api-e2e.sh api-flows.mjs api-stage6.mjs api-c42.mjs`: counted `FAIL` lines = 0, passes 23 + 94 + 13 = 130, "no page errors" for all three.

## Screenshots
- `web/docs/screenshots/improve-c42-brief-dark.png`: the brief in the task drawer.
- `web/docs/screenshots/improve-c42-handoff-dialog-dark.png`: the hand-off brief form in Delegate / reassign.

## Files changed
Server: `src/delegation/{brief,service,routes}.ts` (new), `migrations/0034_delegation_briefs.{up,down}.sql` (new), `src/app.ts`, `src/ratelimit.ts`, `src/tasks/routes.ts`, `src/instances/service.ts`, `test/delegation-brief.test.ts` (new), `test/security.test.ts`.
Shared: `shared/contracts/src/delegation.ts` (new), `index.ts`.
Web: `src/api/delegationBriefs.ts`, `src/features/mission/DelegationBriefCard.tsx`, `src/theme/pages/c42-delegation.css`, `src/help/pages/c42-delegation.ts` (new); `src/dialogs/defs/missions.tsx`, `src/api/missionControl.ts`; `scripts/api-c42.mjs` (new); the two screenshots; this report.

## Concerns
1. "Require or attach" is only partly met for people: the server and the simulator always attach, but a person's reassignment brief is optional (empty acceptance in the dialog sends no brief, the old behaviour). Requiring it would break the frozen `api-stage6` reassign step, which submits no brief. A controller decision: require the brief for people once that script is updated.
2. Human reassignments are root briefs (depth 1, from the user). The lead-to-target row in `mission_delegations` is not tied to the brief by id (match by mission, task and target). Chains deeper than 1 are created only through the POST route (`fromInstanceId`) or by the simulator.
3. The mission "root grant set" has no table (grants are still in memory until P4). It is modelled as the mission's latest root brief; an agent with no brief and no root brief gets 403. When P4 adds grants, the root should come from them.
4. Superseding a parent brief does not re-check or revoke its descendants; later children are checked against the new latest brief only.
5. Backfilled DEMO delegations and demo mode have no briefs ("No brief (legacy)"); only the staffing simulator attaches them.
6. No `task.delegated` event carries the brief; the audit row `delegation.brief` does. The drawer reads the brief when opened, it does not update live.
7. The simulator attaches briefs inside the staffing transaction: any brief error would retry the step forever, so the depth case is skipped explicitly and the test covers a full staffing run.
8. The paper (2602.11865) is a conceptual framework with no experiments; the help text says so and claims no measured gain. Nothing was measured on agent behaviour, because agents do not execute.

## Fix round (after the c42 review, NOT CLEAR)
Each attack was written as a failing test first. RED: 12 of 23 tests in `server/test/delegation-brief.test.ts` failed (the I1, I2, I3, I4, M1, M2, M5 tests plus the two pure tests updated for M2). GREEN: 23/23.

- **I1 effective scope.** `effectiveFrom` / `effectiveScope(c, briefId)`: a brief's own capabilities intersected with the newest brief of every ancestor up to the current root, recomputed on every use and never stored. A child is checked against its delegator's effective scope at creation; narrowing an ancestor narrows all descendants at once with no row rewritten. The attack (root narrowed, delegate re-delegates the lost kind) is 403. The list API returns `effective` with `narrowedBy`; the drawer shows "Effective now ... narrowed by X (not Y)".
- **I2 simulator.** `attachSimBrief` intersects its default capabilities with the manager's effective scope and runs inside a savepoint; an `ApiError` rolls back to the savepoint, writes an audit `delegation.brief_skipped` with the reason and staffing continues (database errors still propagate). Tests: a narrower root brief posted mid-staffing (staffing reaches `working`, children never exceed it), and a refused brief is skipped, audited, and the transaction stays usable. Staffing step now backs off (stepMs x 2^n, capped at 30 s) and gives up after 12 consecutive failures with an error log.
- **I3 inheritance.** A child that omits deadline or budget inherits the effective bound (the minimum along the chain, recomputed at read time); explicit values above it are 400. Tested through three levels, including narrowing the parent afterwards.
- **I4 who may act.** Speaking as an agent (`fromInstanceId`) and writing a root brief need an administrator or the mission owner; superseding needs the original author or an administrator; a superseded root is checked against the original author's authority as well as the caller's (the narrower wins). Members of a shared mission can read but not write. One test each.
- **M1** the "latest root brief of the mission" fallback was removed: an agent's scope is only its own brief, otherwise 403. **M2** a capability's origin is part of its identity: no origin is not a wildcard (`read` does not cover `read @ origin`), so the human origin-grant gate is consistent. **M5** the random model now drives the real service and database: 60 chains of posts, delegations, supersedes and narrowings (about 360 requests), checking after every step that every effective capability lies inside every ancestor's latest brief; the 300-chain pure test stays. **M7** the form has maxLength and a hint, inline errors from the 400 field paths, only loaded and allowed kinds are sent, and the checklist uses dots instead of checkbox squares.

Counts: server tsc clean; vitest 40 files, 702 tests passed; web tsc clean; api-flows 23/23, api-stage6 94/94, api-c42 14/14 (0 FAIL lines); fit-check ALL FIT; a11y demo 50 views, 56 dialogs, 0 violations; a11y api 40 views, 56 dialogs, 0 violations. Dev server on 9190 stopped.

Not changed: concern 1 (an optional person brief) goes to the backlog. Still open: the lead-to-target row has no brief id (needs a migration); brief changes do not push an event, so the drawer updates when reopened.

## Fix round 2 (after the c42 re-review, NOT CLEAR on one Important)
- **No silent stall (Important).** When the staffing simulator gives up (13th consecutive failure), one transaction now (a) writes `staffing.stalled` on the mission (`presentation.staffing.stalled = {code, reason, at, attempts}`; `stage` is untouched, so no consumer of the stage breaks), (b) writes the audit row `staffing.gave_up` with the last error code, attempts and message, and (c) emits a `staffing.stalled` event with audience `mission`. A stalled mission is skipped by the step and by the start-up resume query, so a restart does not retry. New `POST /missions/:id/staffing/retry` (administrator or mission owner, idempotent, in the `proposals` rate bucket and in the route-table security lists, audited as `staffing.retry`, event `staffing.resumed`) clears the state, resets the backoff and reschedules; 409 when not stalled. The mission overview shows "Staffing stopped: <reason>", a Retry button for admin or owner and a `?` help (`mission.staffing.stalled`).
- Test (RED first: it failed because nothing was recorded; GREEN after): `server/test/staffing-stall.test.ts` forces 13 failures with a database trigger, then checks the audit row, the mission event (audience `mission`), the state through the API, that a second server on the same database leaves it stalled, that a member gets 403, that Retry resumes to `working` and clears the state (audit `staffing.retry`, event `staffing.resumed`), and that a second Retry is 409.
- **M5 gate assertion.** Every accepted agent-delegated brief is now checked against the delegator's effective scope read just before the post (more than 30 such cases across the random chains), so a regression of the creation gate fails.
- **Cross-tenant.** An admin of another tenant gets 404 on the briefs route and on reassign-with-brief, and nothing is written. These two minors were regression guards for behaviour that was already correct, so they passed when written (no RED).
- Browser: api-c42 gained two checks (banner with reason, Retry and `?` help; Retry reaches the server and its 409 message shows). The banner check injects the stalled state into the browser's mission responses, because the e2e stack cannot be made to fail staffing; the real path is covered by the server test.

Counts: server tsc clean; vitest 41 files, 707 tests passed; web tsc clean; api-flows 23/23, api-stage6 94/94, api-c42 16/16 (0 FAIL lines); fit-check ALL FIT (demo mode, which has no stalled state); a11y demo 50 views, 56 dialogs, 0 violations; a11y api 40 views, 56 dialogs, 0 violations. Screenshot `web/docs/screenshots/improve-c42-staffing-stalled-dark.png`. Dev server 9190 stopped.

Notes: the banner title reads "Staffing stopped" only when the stage is short of `working`, which is always so for a real stall. A stalled state set by another path would need a Retry from the same route. Re-review finding 4 (an owner can re-widen a narrowed root by posting a new root) is as designed and stays on the backlog.
