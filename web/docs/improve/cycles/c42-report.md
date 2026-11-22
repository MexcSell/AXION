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
