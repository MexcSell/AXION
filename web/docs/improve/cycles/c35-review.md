# c35 review: approval binding v2 (branch c35-approval-binding, tip b022636)

Verdict: **CLEAR** (no blocker). Nothing was run beyond reading the diff and a node one-liner on `canonical`.
All server-side numbers below come from reading the code, not from re-running the suite.

## 1. Binding soundness
Digest v2 (`server/src/approvals/service.ts:23-26`) covers v, tenant, mission, task, kind, origin, target, payload, tier, requester and expiry. That is every field of invariant 7 (the "user" is `requestedBy`; the decider is not bound, which is right). The row is recomputed by `rowDigest` (`:36`, `:134`) and a client digest is only compared (`routes.ts:51`). The fixed wrapper object plus `JSON.stringify` of strings gives an unambiguous encoding, and keys are sorted at every level. Optional fields are `?? null`, so absent and null are the same action (acceptable, and consistent between request and consume).

- **Minor** `service.ts:17` `canonical` is lossy for a few JS values, checked in node: `{a: undefined}` and `{a: null}` give the same string; a `Date` gives `{}`; `NaN` and `Infinity` give `null`. Two payloads that differ only in those values collide. They cannot arrive via JSON, so this is not exploitable today. It also has a failure side. `requestApproval` hashes the raw `a.payload` (`:56`) but stores `JSON.stringify(payload)`, so a payload holding `undefined` or a `Date` is hashed differently from the stored row. `rowDigest` then disagrees, and the approval can never be decided (the stale branch) or consumed. It fails closed but is a latent bug for future agent producers. Fix: hash `JSON.parse(JSON.stringify(payload))`, or reject non-JSON values.
- **Minor** `service.ts:31` `boundActionOf` uses truthiness (`r.origin ? ... : {}`) and the insert stores `a.origin ?? null`. An empty-string origin, target or task is hashed as `""` at request time but as null on recompute, so the row is stuck as stale. This is the same class of bug as above. Normalise `''` to undefined on request.
- **Minor** `service.ts:25` the doc comment says "absent and present digest differently". It is only true for non-null values. The test (`approval-binding.test.ts:33`) never asserts absent vs null.
- **Downgrade to v1.** UPDATE is blocked by the trigger (`0029...up.sql:21`, `digest_version` is in the list). The only code insert path is `requestApproval`, which hard-codes `2` (`service.ts:59`). The demo seed goes through it. There is no DB-level guard on INSERT (default is 1; a direct INSERT can be state 'approved', v1). This is **Minor**: it needs DB access, and the trigger on UPDATE is correct. A CHECK or insert trigger that makes new rows v2 would close it, after which legacy rows would be exempted by id or date.
- v1 rows carry no requester, tier or expiry in the digest, so they keep the weaker binding. This is documented in report concern 3.

## 2. Consume
`consumeApproval` (`service.ts:123-137`) runs `select ... for update` filtered by tenant, so another tenant's approval is a 404 (tested, `test:107`). The consumed, state and expiry checks come first, then the digest. The update is guarded (`consumed_at is null and state='approved'`) and the trigger backs it. All refusals throw before any write, and `tx` rolls back on throw (`db.ts:15-27`); if `emit` throws after the update, the update rolls back too. The 20-concurrent test is sound: row lock plus guarded update.

- **Minor** `service.ts:131` expiry is compared against the app clock (`Date.now()`), while `sweepExpired` and the pending-count queries use the DB `now()`, and `consumed_at` is DB `now()`. A skewed app host could consume a few seconds past expiry, or refuse early. Use `now() >= expires_at` in SQL (keep `i.now` only as a test override).
- The trigger prevents resetting `consumed_at` (`0029...up.sql:27-29`) and consuming a non-approved row. There is no UPDATE path to reset it. DELETE is not guarded (see 4).
- **Minor** the executor identity `by` is free text and is not checked against `agent_id`. Acceptable until executors exist, but worth a note in the backlog.

## 3. Self-approval
The rule `requested_by === ctx.user.id` at R2 and above (`routes.ts:45`) is correct for what it claims, and it runs before the state check, so a 403 leaks no state. It also skips silently when `isTier` fails; the policy check above it already fails closed for that, so this is fine. Agent-raised requests carry agent ids, so **no human-raised request exists, and a human who created a mission can approve their own agent's R2+ request.** For example, a single admin creates a mission and approves its R3 request. The mission-creator rule was reasonably deferred (it would deadlock single-admin tenants), and the implementer is honest about it, but:

- **Important** the gap is visible only in `c35-report.md` concern 1. It is not in `BACKLOG.md`, `PHASE2.md` (P3 row at `:53` still says "no self-approval at R2+") or a README. Add a BACKLOG entry (needs a second-approver or owner role) and correct the P3 wording so nobody reads it as closed. Also state in the report's pass table that the "decider = requester" threshold is met only for user-raised requests, which the product cannot yet create.

## 4. Triggers
`approvals/service.ts:107` `sweepExpired` only does pending to expired. The guard allows it: it changes only `state`, and only approved/denied are frozen. The decide route's expiry write (`routes.ts:48`) is the same. Demo purge: the guard is BEFORE UPDATE only, so DELETE is untouched, and the existing `approval_decisions` cascade rule is unchanged.

- **Minor** `0029...up.sql:23` the guard freezes approved and denied but not expired. SQL could move expired to pending or approved (`expires_at` is immutable, so consume still refuses; the route's compare-and-set needs pending). Freeze `expired` as terminal too (`old.state in ('approved','denied','expired')`), keeping pending to expired.
- **Minor** no guard on DELETE or TRUNCATE: a consumed row could be deleted and re-inserted under the same id (needs DB access). This is the same trust boundary as the existing tables.
- Tests cover 11 immutable columns on pending, payload and state on approved, and the consumed_at single-set rules (`test:128-145`). `agent_id`, `tenant_id` and `id` are in the trigger but untested (Minor).

## 5. UI
Buttons use the real `disabled` attribute (`Notifications.tsx`, `Shared.tsx`, `users-governance.tsx`), not only styling. The `?` is a real `<button>` (`HelpTrigger.tsx`) outside the disabled buttons, so it is focusable and opens with Enter or Space. The gate follows the server (admin and approved), and the server remains the authority (403, tested live). `api-c35.mjs` checks disabled state, help text and the R2 path.

- **Important** `ApprovalBinding.tsx:8` `isGated` uses `useMe()`, which is `undefined` when there is no session. In pure demo mode (no API, no account) every R3/R4 card is therefore disabled with "needs an administrator", and the Notifications Approve-to-dialog path for critical cards can no longer be reached. The a11y and fit checks do not click it, so this is not covered. Confirm demo-mode intent, or gate only when `isApi()` and a non-admin session exist. I did not run the app, so treat this as "needs a quick check", not a proven regression.
- **Minor** the target and origin chips are checked only by rewriting the `/approvals` response (`api-c35.mjs`, route handler). It is legitimate for the render path, and the DTO is covered server-side (`test:41`), but it does hide a real data gap: the demo seed (`server/src/seed/demo.ts:33`) passes no origin or target, so no real card ever shows them. The report states this in concern 2. Fine for now; the check proves the component, not an end-to-end flow.
- **Minor** `appr-fact` chips are plain text. `title={effectWhy}` is hover-only, so the "why" is not keyboard reachable.

## 6. Tests
- The 13 tampering variants are real (`test:79-84`: payload value, key added, key removed, origin changed, origin removed, target, kind, tier, task, task removed, mission, requester, expiry = 13). Each asserts `APPROVAL_DIGEST_MISMATCH` with 409, and the approval is still consumable afterwards. Note that "target removed" is not among them (the digest test covers `target: undefined`, but the consume path does not).
- The report's claims match the tests: replay 409, expiry with injected clock, pending and denied refused, 20 concurrent consumes with 1 success and 19 `APPROVAL_ALREADY_CONSUMED`, v1 decide and consume, client digest ignored (stale).
- **Minor** the "no HTTP route" test asserts only `>= 404`; a 405 or 500 would pass.
- **Minor** the self-approval test for an R2 request by a member relies on `submit_form` being R2 in the baseline; if the baseline changes it fails for the wrong reason.
- No existing test was changed: the diff adds one test file only, so nothing was weakened. I did not re-run the suite; the report says 697 passed.

## Findings summary
| # | Sev | Where | Item |
|---|---|---|---|
| 1 | Important | `PHASE2.md:53`, BACKLOG, report | Mission-creator and agent-request self-approval gap is not in BACKLOG, and the P3 row still reads as complete |
| 2 | Important | `ApprovalBinding.tsx:8` | No-session demo mode disables every R3/R4 button; confirm intent |
| 3 | Minor | `service.ts:17,31,56` | `canonical` and `boundActionOf` are lossy for undefined/Date/NaN/'' and can make an approval undecidable |
| 4 | Minor | `service.ts:131` | Expiry uses the app clock, the sweep uses the DB clock |
| 5 | Minor | `0029...up.sql:23` | The `expired` state is not frozen |
| 6 | Minor | `0029...up.sql` | No insert guard against `digest_version = 1`; no DELETE guard |
| 7 | Minor | `api-c35.mjs`, `demo.ts:33` | Target and origin chips are verified only through a rewritten response |
| 8 | Minor | tests | The route test uses `>= 404`; "target removed" is not covered in the consume tampering list |
