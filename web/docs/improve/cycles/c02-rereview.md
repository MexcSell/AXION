# Cycle 2 re-review (fix round c615458..b87e473)

Read-only, scoped to the fix diff. Nothing was run; the test and e2e results are the implementer's claims [claimed].

## Verdicts
- **I1: ADDRESSED.**
  - `web/src/components/layout/CommandCenter.tsx` (api branch, new `agentsTile` after the `success` tile) counts distinct `agentId`
    over `GET /agent-instances` rows with `!simulated && !endedAt` whose mission is visible, non-DEMO and planning, running,
    verifying or waiting.
  - The demo branch is untouched; `useAgentInstances` is a no-op outside api mode (`web/src/api/agents.ts:97`).
  - The route is guarded: `listInstances` (`server/src/instances/service.ts:104`) joins `missions` with tenant, not-deleted and
    `VISIBLE_SQL`, so there is no privacy leak.
  - The e2e check compares the tile to a server-side recount: 0 on a fresh database, live after a mission is created, back to 0
    after the cancel (`web/scripts/api-improve.mjs`, c02 fix I1 checks).
  - The tile re-reads on instance, task and mission events through the existing tick.
- **m1: ADDRESSED.**
  - New `ApiDemo` tags (`web/src/pages/Overview.tsx:35`) sit on Active Agents (105), Recent Verified Outcomes (186-187),
    Events by type (414), Most active agents (419), Event Freshness (485), Queue Depth (497) and Connectivity Checks (501).
  - DEMO missions' Portfolio rows are tagged (292).
  - Mission Pipeline (121), Verified Completions, Live Activity (380) and System Health (461) already carried a tag.
  - Nothing was removed. The e2e check walks the Pulse, Activity and Health tabs.
- **m2: ADDRESSED.**
  - `web/src/api/scorecardCache.ts:211-236`: a `gen` counter bumped in `clear()`, a `put()` that ignores a response from an old
    generation, `inflight` cleared, and the `once` key includes `gen`.
  - A response with an older tick never overwrites a newer entry, on success or on failure.
  - `clearScorecard` (`web/src/api/scorecard.ts:178`) bumps the tick.
  - `server/test/scorecard-cache.test.ts` has 4 tests covering these cases.
- **m3: ADDRESSED.**
  - The 1.5 s sleep in `web/scripts/api-improve.mjs` is replaced by a settle condition, checked twice 300 ms apart: A and B show
    P3 as pending, and no browser has a proposals read in flight.
  - It is its own check. A read that starts after the condition holds can still race. The report states this honestly (Concerns).
- **m4: ADDRESSED.** `server/test/scorecard.test.ts` (+2) tests an event exactly at `to` (counts) and a final state or first run
  1 ms after `to` (excluded). Its own report line says it passed first time, so it adds coverage of existing behaviour.
- **m6: ADDRESSED.**
  - `server/src/company/routes.ts` selects `tasks.simulated`.
  - `server/src/company/scorecard.ts` (`verified`) requires `!t.simulated` on every task.
  - `server/test/scorecard.test.ts` has a test with a recorded RED run; `server/test/company.test.ts` flips `T-209` to simulated
    and expects 40% to drop to 20%.
- **m7: ADDRESSED.** The report marks threshold item 2 as PASS only after the fix round, names the cycle 1 expiry-step change in
  "Files changed", and states the corrected Concerns. The counts match the diff (290 server tests, 55 checks). m5 is listed as
  left open and is accurate.

## New breakage in the fix diff
No Critical or Important issues found.

Minor:
- n1. `listInstances` has `limit 500`, newest first. Once ended instances pile up, the Staffed Agents count can undercount
  live ones. It is fine at current sizes.
- n2. The `kpi.staffedAgents` hint ("of 25 · on real active missions") is hidden on short screens. The aria-label and the
  `data-kpi-staffed` attribute still carry the number.
- n3. The staffed-tile e2e uses a server recount and `>= 2`, so it does not pin the exact staffing size. This is acceptable.
- ov-fit: the `.ov-tagged` CSS is only title ellipsis and `flex: none`, so there is no new height. The api-mode ov-fit run (NO SCROLL) is [claimed].

## Pending Approvals tile counting DEMO missions' approval rows
Acceptable, with a caveat.
- The tile, the Approval Queue panel and the notifications Pending tab all count the same real, decidable `approval_requests`
  rows, so the numbers are consistent and measured. It is not a fixture constant.
- The caveat is that the "Active Missions" tile has the same DEMO inclusion. Neither tile says so. A one-line hint such as
  "includes DEMO" would make it fully honest.
- Not blocking.
