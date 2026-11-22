# c48 report: approvals UI follows the policy tiers (lane w47, branch c48-approvals-ui, from 09dd6cb)

## What was built
- **Server (one policy path).** `decideRefusal(row, user, now)` in `server/src/approvals/service.ts` is the single function that says whether a user may decide a request, in the route's order: tier (R3/R4 need an administrator, `POLICY_DENIED` 403), self-approval (`SELF_APPROVAL` 403), already decided (409), expired (stale 409). The decision route now throws from it, and `approvalDto(row, now, viewer)` reports it as `canDecide` and `decideBlockedReason` (`tier_requires_admin | requester_cannot_decide | already_decided | expired | null`). Both the list and the decision response carry them. No client copy of any rule. No migration.
- **Web.** `features/approvals/ApprovalBinding.tsx`: `useGate(a)` reads only the server flag. A blocked control uses `aria-disabled` (focusable, so keyboard and screen-reader users reach it) plus `aria-describedby` pointing at the visible reason; its click is swallowed. `GateNote` shows the reason and a `?` (`approval.gate`). `ApprovalFacts` gets a `?` (`approval.tiers`) explaining R0 to R4. `apiDecide` also sends nothing when the flag is false.
- **Surfaces** (all follow the flag): Notifications Pending card, decision dialog, mission Approvals tab (`ApprovalMini`), and the Overview Approval Queue quick icons (these were ungated before this cycle: a member could click Approve on an R3 row and get a 403). The command palette, notification actions and top bar have no decision control (checked by grep for decide/approve).
- **DEMO.** Fixture approvals carry `canDecide: true` (labelled in `data/missions.ts`): the demo account is an administrator and no fixture is its own request. The same gate code runs if a fixture ever sets false. No blocked demo fixture was added, to keep the demo counts stable.

## RED / GREEN
- RED: `server/test/c48-can-decide.test.ts` before the implementation: 26 failed (26).
- GREEN: same file after: 26 passed (24 combinations of tier R2/R3/R4 x admin/member x requester agent/self x pending/decided, each posting the real decision and asserting `canDecide === (route did not refuse)` and the reason equals the refusal the route gave; plus the decision response, and an expired row).

## Pass threshold
| Item | Result | Evidence |
|---|---|---|
| Server test passes for all tier x role x requester combinations | PASS | 26/26 (above). Expired is tested on the DTO with an injected clock, because the list sweeps expired rows away |
| `api-c48.mjs`: member sees disabled buttons with the reason on R3/R4 | PASS | card, dialog, mission tab, overview queue: `aria-disabled`, `aria-describedby` text "Needs an administrator" |
| Clicking a disabled control does nothing and sends no request | PASS | 0 POST `/decision` requests recorded in the member browser on all four surfaces; dialog stays open |
| The `?` opens | PASS | gate `?` explains why; tiers `?` lists R0 to R4 |
| Admin can still decide | PASS | admin R3 approve decided on the server (3 -> 2 pending); admin sees no gate note |
| Every decision surface covered | PASS | 4 surfaces (palette, TopBar, notification actions have none) |
| 1366x768 fit | PASS | member card, mission tab, overview, light mode: scroll size <= viewport |
| No 403 POLICY_DENIED in the member network log | PASS | 0 responses with status 403 during the member flow |
| api-stage6, api-improve | PASS | 94/94; 107/107 |
| api-c35 (older UI check, unchanged) | PASS | 16/16 (needed the gate help to keep the words "live / who can do what / hard-to-undo"; the test was not edited) |
| verify-all 10/10 | PASS | ALL 10 STEPS PASSED |
| a11y 0 violations | PASS | demo: 50 views, 58 dialogs, 0 violations |
| tsc | PASS | server and web clean |
| Full server vitest | PASS with a note | 1458 passed, 4 failed in 3 agent-version files (`agents`, `instances`, `version-proposals`), unrelated to approvals; they ran while verify-all and other lanes loaded the machine. Rerun alone: 52/52 passed |

`api-c48.mjs`: 26 PASS, 0 FAIL. The one case it cannot create for real (`requester_cannot_decide`: no HTTP route makes a user-raised request yet) is checked by rewriting the `/approvals` response in the browser; the server side of that reason is in the unit matrix.

## Screenshots
`shots-c48/`: `member-card-dark.png`, `member-card-light.png`, `member-tiers-help-dark.png`, `member-tiers-help-light.png`, `member-dialog-dark.png`, `member-mission-dark.png`, `member-overview-dark.png`, `admin-dark.png`.

## Files changed
server: `src/approvals/service.ts`, `src/approvals/routes.ts`, `test/c48-can-decide.test.ts`.
web: `src/features/approvals/ApprovalBinding.tsx`, `src/features/mission/Shared.tsx`, `src/dialogs/defs/users-governance.tsx`, `src/pages/Notifications.tsx`, `src/pages/Overview.tsx`, `src/store/data.ts`, `src/data/types.ts`, `src/data/missions.ts`, `src/help/pages/users-governance-notifications.ts`, `src/theme/pages/users-governance-notifications.css`, `scripts/api-c48.mjs`.

## Concerns
1. The Overview Approval Queue panel is tight at 1366 wide (title truncation and a clipped "Open" header existed already next to neighbouring panels); the reason there is screen-reader text plus a `?`, not visible text.
2. Digest staleness (client saw an old digest) is not part of `canDecide`; it depends on the client and stays a 409 `APPROVAL_STALE`.
3. `canDecide` is a snapshot: another user deciding first turns it into `already_decided` only after the next refresh (SSE refreshes approvals on `approval.*` events).
4. DEMO has no blocked fixture (see above).
5. `aria-disabled` replaced `disabled` on these controls on purpose; the old CSS rule for `:disabled` was extended to `.is-gated`.

## Fix round (after review PASS-WITH-FIXES)
1. **`viewer` is required** on `approvalDto(r, now, viewer)`; the "no viewer means tier_requires_admin" branch is gone (tsc enforces it).
2. **Expired, route side.** New test backdates the request (inserted already past its expiry, because the bound expiry is immutable by trigger), posts the decision, and asserts 409 `APPROVAL_STALE`, state `expired`, 0 decisions, and that the DTO said `expired` for the same row. Expiry is now judged by DB `now()`: the list, the decision select and the response select add `(expires_at < now()) as db_expired`, and `decideRefusal` and the DTO `state` read it (the JS clock is only a fallback for test rows read without it).
   - RED/GREEN: on the previous code the new "expiry is the database clock" test failed (1 failed, 27 passed); now 28/28. The route-side expired test passes on the old code too (JS and DB clocks agree in a test); it is a regression guard, not a RED.
3. **Overview Approval Queue.** A gated icon's label (and its tooltip) is "Approve: title (Needs an administrator)", so sighted members see the reason on hover; the sr-only note stays. Header clipping fixed in `overview-fit.css`: sub text shrinks first, then the title (ellipsis); icon, `?`, DEMO tag and the button never shrink. Before, "Open" showed as "O" and the DEMO badge was cut (see `member-overview-dark.png` in the first report commit; the base has the same flex rules, so this was pre-existing). New api-c48 checks: no panel-head item crosses the panel's right edge, the label carries the reason, hover shows the tooltip.
4. **R4 help.** `approval.tiers` now says R4 needs the owner role and that an administrator decides as owner today because there is no separate owner role yet; the how-to line says the same.
5. **Fail closed.** In api mode `canDecide === undefined` is blocked with "Waiting for the server to say whether you may decide"; `apiDecide` sends only when `canDecide === true`. Demo fixtures keep `true`. api-c48 rewrites the response without the flag and checks: blocked, reason text, click sends nothing.

Results: server and web tsc clean; full server vitest 50 files, 1464 passed, 0 failed; api-c48 31 PASS 0 FAIL (one earlier run failed once on a timing wait in the new overview check; the wait was made explicit and it then passed twice); api-c35 16/16; api-stage6 94/94; `DATA_MODE=api` a11y 40 views, 58 dialogs, 0 violations; verify-all ALL 10 STEPS PASSED. New screenshots: `member-overview-dark.png` (no clipping), `member-overview-tooltip-dark.png`, `member-overview-light.png`.
