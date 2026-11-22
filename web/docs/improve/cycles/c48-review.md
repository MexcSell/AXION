# c48 independent review (approvals UI follows the policy tiers)

Reviewed lane w47 at 0a808da (base 09dd6cb). Lane left at 0a808da, clean tree.

## Verdict: PASS-WITH-FIXES
No security or honesty defect found. The fixes are small polish and test-coverage items; none blocks a merge.

## Re-run results
- server tsc and web tsc: clean.
- Full server vitest, twice: 50 files / 1462 tests passed both times, 0 failures. The implementer's 4 failures (agents, instances, version-proposals) did not reproduce, consistent with the load / advisory-lock-key explanation, but this review cannot prove the cause.
- api-c48 26/26, api-c35 16/16, api-stage6 94/94.
- `DATA_MODE=api` a11y-check: 40 views, 58 dialogs, 0 violations (api mode has fewer views than the 50 in demo mode; the report's "50 views" was the demo run).
- Own keyboard probe (member Mina, R3 requests; script outside the repo): Enter and Space on every gated Approve/Deny on the Notifications card, the Overview Approval Queue icons and the decision dialog, plus a bare Enter inside the dialog: 0 POST /decision requests, no dialog opened from the card, dialog stayed open. The mission-tab surface was not re-probed by key (same `useGate` code, covered by api-c48 for click).

## Checks against the brief
1. Single source of truth: confirmed. `decideRefusal` (service.ts) replaces the inline checks in the route one for one, in the same order (tier, self-approval, already decided, expired). Messages and codes are identical to the base route. The route still has two refusals outside it, both intentionally: not-found/visibility (before it) and digest mismatch (after it). `canDecide` is computed only in the list and decision-response DTOs, both per request from `ctx.user`, no cache. The list is already visibility-filtered in SQL, so `canDecide` leaks nothing about invisible requests. policy `evaluate()` is not on the decision path (only on request creation), so nothing is ignored. No rate-limit or consume-once logic sits in this route.
2. No loosening: confirmed. The diff touches no existing test or script (only adds c48 test and api-c48.mjs). api-c35.mjs is byte-identical to base; the wording fix was to the help text (`approval.gate`), which now contains "live", "who can do what", "hard-to-undo". `aria-disabled` buttons use `type="button"`, swallow click with preventDefault/stopPropagation, and `apiDecide` also returns early on `canDecide === false`. Enter/Space/dialog default verified above.
3. Matrix test: honest for its 24 combinations. Each case creates the row, fetches the DTO as that user, then posts the real decision and asserts `canDecide === !refused` and that the reason maps to the actual error code. The expired case is DTO-only with an injected clock (`approvalDto(row, later, viewer)`); the production route never passes a clock (both callers use `Date.now()`), so no caller-clock trust path exists.

## Confirmed findings
(none above Low)

- LOW, `server/src/approvals/service.ts:~89-103` (`approvalDto`): with no `viewer` argument it returns `canDecide:false, decideBlockedReason:'tier_requires_admin'`. No caller omits the viewer today, but a future caller would show a false, misleading reason for e.g. an admin. Scenario: a new list endpoint forgets the 3rd argument and every admin sees "Needs an administrator". Fix: make `viewer` required, or return `null` reason with `canDecide: undefined`.
- LOW, `server/test/c48-can-decide.test.ts:44-52`: the expired reason is never exercised through the HTTP route; only the DTO is. The route's expired branch (state flip to expired plus settleMission, `reason !== 'expired'` special case in routes.ts:~39-45) has no assertion that it agrees with the flag. Scenario: a later edit changes the expired comparison in one place only and the matrix stays green. Fix: add a case that backdates `expires_at` in SQL and posts the decision, expecting 409 `APPROVAL_STALE` and a DTO of `expired` computed with the same clock.
- LOW, UI, Overview Approval Queue (`web/src/pages/Overview.tsx` `QueueDecide`, screenshot `shots-c48/member-overview-dark.png`): the reason is `sr-only` there, so a sighted member sees only dimmed icons and a `?`. At 1366x768 the panel is cramped: the "Open" header is clipped to "O" and the "DEMO" badge is clipped in the neighbouring Verified Completions panel (the report calls this pre-existing; not verified against the base). The brief's "explanation such as Needs an administrator" is met for the other three surfaces but only via `?`/tooltip here. Fix: a Tip on the gated icons with the reason text.
- LOW, `web/src/help/pages/users-governance-notifications.ts` (`approval.tiers`): says R4 "an administrator decides", while `approverFor('R4')` is `'owner'` and the route lets an admin act as owner only because no owner role exists yet. Accurate today; will need to change when an owner role exists.

## Plausible, not confirmed
- The route compares expiry with the JS clock (`new Date(a.expires_at) < Date.now()`, as before this cycle), while the list excludes expired rows with DB `now()`. The brief's rule says time compares in SQL; this cycle did not change that, but `canDecide` inherits the JS comparison. App/DB clock skew could show a row as decidable for a moment and the route would agree, so no dishonest button, just a stale row.
- `canDecide` is a snapshot: after another user decides, a member's button stays enabled until the next refresh and the server answers 409. Documented in the report; SSE refresh narrows the window.
- Client fails open when `canDecide` is undefined (demo fixtures, older server). Server still refuses, so safe, but a demo-mode member would see enabled buttons; the demo account is an admin so this is not reachable today.
- Digest staleness is excluded from `canDecide` by design (depends on client).
