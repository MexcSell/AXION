# c35 brief: approval binding v2 (Phase 2 · Wave 2 · P3)

**Lane:** w33, branched from **c30-policy-service** (f483e2d), because it builds on the policy service. Ports 8390 / 8391 / 8392–8393. E2E DB **axion_e2e7**. Migration **0029**.
**Sources:** spec invariant 7 ("Approval is bound to exact payload hash, origin, target, user, task, expiry and risk; changing the action invalidates approval"); spec §11 rows approval_requests and approval_decisions ("exact one-action binding", "append-only decisions"); CaMeL 2503.18813; Design Patterns for Securing LLM Agents 2506.08837 (both verified).

## Hypothesis
Today `action_digest = sha256(canonical({missionId, kind, payload}))` (approvals/service.ts:15). It doesn't cover origin, target, requester, tier, expiry or task. Nothing ever *consumes* an approval, so one approval could authorise the same action twice. The policy also allows a requester to approve their own R2+ request. Binding v2 makes an approval authorise exactly one execution of exactly one action.

## Build (test-first)
1. **Digest v2.** `digestV2 = sha256(canonical({v:2, tenantId, missionId, taskId?, kind, origin?, target?, payload, tier, requestedBy, expiresAt}))`. Store the digest version. Old rows stay v1 and are verified with v1. It is always recomputed on the server; a client-supplied digest is never trusted.
2. **Consume.** Add `consumeApproval(c, {approvalId, action})`. It runs inside a transaction with the row locked. It recomputes the digest from the presented action and refuses on any mismatch (`APPROVAL_DIGEST_MISMATCH`), when not approved, when expired, or when already consumed (`APPROVAL_ALREADY_CONSUMED`). It records `consumed_at` and `consumed_by` exactly once, enforced by a trigger, and emits `approval.consumed`. There is no HTTP route that executes anything. Consume is a service function that future executors will call. Tests call it directly.
3. **No self-approval at R2+.** The decider must not be the requester. Also, a human who *created* the mission run must not be the sole approver of an R3/R4 request that their own agent raised. If a clear rule can't be expressed with the current data, implement "decider ≠ requested_by" and document the rest.
4. **Edit invalidates.** If a pending request's payload changes, it must be a new request; an approved one can't be edited (trigger).
5. **UI (P3a).** On approval cards, members see Approve/Deny disabled on R3/R4, with a `?` saying "needs an administrator" and why. The card shows the tier, the exact target/origin and the effect (spec §13.2 last paragraph). Keep the existing look.

## Pass threshold (fixed)
- Tests for each of these: a replayed consume → 409; a presented action with any one field changed (payload key, origin, target, kind, tier, task) → mismatch; consume after expiry → refused; consume of a pending or denied request → refused; a decider equal to the requester → 403; 20 concurrent consumes of one approval → exactly 1 succeeds.
- v1 rows still decide and display correctly (test).
- server tsc and vitest green; api-flows and api-stage6 pass; the UI change is covered by a browser check `web/scripts/api-c35.mjs` (a member sees the disabled button and its help; an admin can decide); a11y shows no new violations; fit-check is ALL FIT.

## Report
`cycles/c35-report.md`.
