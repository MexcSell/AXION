# c48 brief: approvals UI follows the policy tiers (P3a)

**Lane:** w47, from improve-30h at 09dd6cb (c30 policy service and c35 approval binding v2 merged). Ports 9790 (dev), 9791 (preview) and 9792–9793 (e2e). E2E DB **axion_e2e3**. No migration.
**Source:** BACKLOG P3a. Since c30, the server refuses a member's decision on an R3/R4 request with 403 `POLICY_DENIED`, but the UI still offers Approve/Deny to members, and they only learn on click. The owner's rule: no dead buttons; every special control has a `?`.

## Hypothesis
If the client knows, per request, whether the current user may decide it, the buttons can be honest. The server computes this flag from the same policy evaluation it uses to refuse. It must never be a client-side copy of the rules.

## Build (test-first)
1. **Server.** The approvals list and detail DTOs gain `canDecide: boolean` and `decideBlockedReason: null | 'tier_requires_admin' | 'requester_cannot_decide' | 'already_decided' | 'expired'`. Compute them with the c30 `evaluate()` / approvals service path that the decision route uses.
   - A test asserts that, for every fixture combination, `canDecide === (decision route would not refuse)`.
2. **Web.** For members:
   - On R3/R4 (and when the requester is the decider at R2+), Approve/Deny are disabled, with an explanation such as "Needs an administrator" or "You requested this; someone else must decide".
   - A `?` popover explains the tiers R0–R4 in plain words.
   - Keyboard and screen-reader users get the reason through `aria-describedby`.
   - Admins see no change.
   - Look for every place a decision can be made: the approvals page, notification actions, the mission drawer and the command palette, if any. None may offer a decision the server will refuse.
3. DEMO mode mirrors this with labelled fixtures.

## Pass threshold (fixed)
- The server test above passes for all tier × role × requester combinations.
- In `web/scripts/api-c48.mjs` (admin and member sessions):
  - a member sees disabled buttons with the reason on R3/R4;
  - clicking a disabled control does nothing and sends no request;
  - the `?` opens;
  - an admin can still decide;
  - every decision surface is covered;
  - the 1366×768 fit holds.
- No 403 `POLICY_DENIED` appears in the browser network log during the member flow.
- api-stage6, api-improve, verify-all 10/10, a11y 0 violations and tsc must all pass.

## Report
`cycles/c48-report.md`, with screenshots in light and dark.
