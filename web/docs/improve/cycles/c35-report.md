# c35 report: approval binding v2 (lane w33, branch c35-approval-binding, from c30-policy-service f483e2d)

## What was built
- **Migration 0029** `approval_binding_v2`: columns `digest_version` (default 1, so old rows stay v1), `task_id`, `origin`, `target`, `requested_by`, `consumed_at`, `consumed_by`; checks (consumed pair, consumed only when approved); trigger `approval_requests_guard`: the bound action (tenant, mission, agent, kind, tier, payload, digest, version, task, origin, target, requester, expiry) is immutable, a decided request never changes state, `consumed_at/by` is written once and only on an approved row. Down migration included (up/down/up test still green).
- **Digest v2** `sha256(canonical({v:2, tenantId, missionId, taskId, kind, origin, target, payload, tier, requestedBy, expiresAt}))`. Absent optional fields digest as null. The server always recomputes it (`rowDigest`) from the stored row; the client digest on `POST /approvals/:id/decision` is only compared with the stored one, and the stored one must also equal the recomputed one.
- **`consumeApproval(c, {approvalId, action, by, now?})`** (service function, no HTTP route): row locked `for update`, order of refusals: unknown 404, already consumed 409 `APPROVAL_ALREADY_CONSUMED`, not approved 409 `APPROVAL_NOT_APPROVED`, expired 409 `APPROVAL_EXPIRED`, digest mismatch 409 `APPROVAL_DIGEST_MISMATCH`; then guarded update (`consumed_at is null`) and an `approval.consumed` event. Nothing executes anything. `loadBoundAction` and `boundActionOf` build the action from the row for tests/display.
- **Self-approval:** decision route refuses (403 `SELF_APPROVAL`) when `requested_by` equals the decider at R2 and above.
- **Edit invalidates:** enforced by the trigger (pending and approved rows alike); a changed action must be a new request.
- **DTO** adds `digestVersion, taskId, origin, target, requestedBy, effect, effectWhy, approver, consumed, consumedAt`.
- **UI (P3a):** shared `features/approvals/ApprovalBinding.tsx` (`isGated`, `GateHelp` with `?`, `ApprovalFacts` chips for tier/effect, target, origin, "Administrator decides"). Used on the Notifications pending card, the mission approval card and the decision dialog. Members see Approve/Deny disabled on R3/R4 with the `?` (help key `approval.gate`: "Needs an administrator" and why). Four new error codes in the shared contract.

## RED / GREEN
- RED: `test/approval-binding.test.ts` before the implementation: 16 failed, 5 passed (21).
- GREEN: same file after: 21 passed (21).
- Full server suite: 40 files, 697 tests, all passed (0 failed). `tsc --noEmit` clean (server and web).

## Pass threshold
| Item | Result | Evidence |
|---|---|---|
| Replayed consume 409 | PASS | `APPROVAL_ALREADY_CONSUMED` status 409, row unchanged |
| Any one field changed -> mismatch (payload key, origin, target, kind, tier, task) | PASS | 13 variants tested (payload value/added/removed key, origin changed/removed, target, kind, tier, task changed/removed, mission, requester, expiry) all `APPROVAL_DIGEST_MISMATCH`; approval still usable afterwards |
| Consume after expiry refused | PASS | `APPROVAL_EXPIRED` (injected clock) |
| Consume pending / denied refused | PASS | `APPROVAL_NOT_APPROVED` both |
| Decider = requester -> 403 | PASS | 403 `SELF_APPROVAL`, state stays pending, 0 decisions; admin may decide a member's request, the member may not |
| 20 concurrent consumes -> exactly 1 | PASS | 1 fulfilled, 19 rejected `APPROVAL_ALREADY_CONSUMED`, 1 `approval.consumed` event |
| v1 rows still decide and display | PASS | v1 row: displays (`digestVersion 1`, `requestedBy null`), decides, consumes with the v1 digest, wrong payload mismatches |
| server tsc + vitest green | PASS | 697/697 |
| api-flows + api-stage6 pass | PASS | 117 PASS lines, 0 FAIL |
| UI covered by `web/scripts/api-c35.mjs` | PASS | 16 PASS, 0 FAIL: member sees disabled buttons + `?` text, member still decides R2, server 403 on R3, target/origin shown, dialog disabled, admin can decide an R3 |
| a11y no new violations | PASS | `a11y-check` demo mode: 50 views, 56 dialogs, 0 violations |
| fit-check ALL FIT | PASS | "ALL FIT", 77 routes/tabs ok at 1672x941 |

Combined e2e run (`api-flows api-stage6 api-c35`): 133 PASS lines, 0 FAIL lines (the grep for FAIL matches only the summary "16 PASS, 0 FAIL").

## Screenshots
`web/docs/improve/cycles/shots-c35/`: `member-gated.png` (disabled buttons, `?` popover), `member-facts.png` (tier/effect/target/origin chips, R2 enabled), `member-dialog.png`, `admin.png`.

## Files changed
server: `migrations/0029_approval_binding_v2.{up,down}.sql`, `src/approvals/service.ts`, `src/approvals/routes.ts`, `test/approval-binding.test.ts`; shared: `contracts/src/errors.ts`; web: `src/features/approvals/ApprovalBinding.tsx`, `src/pages/Notifications.tsx`, `src/features/mission/Shared.tsx`, `src/dialogs/defs/users-governance.tsx`, `src/data/types.ts`, `src/help/pages/users-governance-notifications.ts`, `src/theme/pages/users-governance-notifications.css`, `scripts/api-c35.mjs`.

## Concerns
1. **Mission-creator rule not implemented.** "A human who created the mission must not be the sole approver of an R3/R4 request their own agent raised" is not enforced. With the current data every agent request lives on a mission owned by an administrator and there is one owner role; enforcing it would leave single-administrator tenants unable to approve anything. Only "decider != requested_by" (R2+) is implemented. It needs a second-approver or owner role first. Today agent requesters are agent ids, so the self-approval check only fires for user-raised requests (none exist yet).
2. Demo-mode (no server) cards cannot show target/origin; the fixtures have none. The target/origin chips were checked in api mode by rewriting the `/approvals` response in the browser; the server side is covered by the DTO unit test.
3. v1 rows have no requester, tier or expiry in their digest, so they carry the old weaker binding by design; they are only displayed, decided and consumed against v1.
4. The decision route stores the (equal) client digest in `approval_decisions`; the append-only decision table is unchanged.
5. `consumeApproval` takes an injectable `now` for tests; no route exposes it.
6. The `approval.consumed` event type is not yet in the web SSE list (`web/src/api/events.ts`), so the UI does not react live to a consume; nothing in the UI consumes yet.

## Fix round (after review CLEAR)
1. **Demo-mode gate.** `isGated` now gates only in api mode with a signed-in non-administrator (`isApi() && me && !isAdmin(me)`). New check `web/scripts/demo-c35.mjs` (demo mode, dev server 8390): 4 PASS, 0 FAIL (R3 card Approve/Deny enabled, no gate help, clicking Approve decides it, 4 cards to 3, no page errors). Honest note: the demo signs in an administrator account, so this check also passes with the old code; the no-session path cannot be reached in the UI (the demo shows the sign-in gate), so the code change closes it by construction. `verify-all` (own OUT `/tmp/axion-verify-w33`): ALL 10 STEPS PASSED.
2. **Hash what is stored.** The payload is hashed as its JSON round-trip (`digestV2` and `requestApproval`); `''` origin/target/task become absent at request time. Tests: undefined/Date/NaN payload values are decided and consumed; empty-string fields too.
3. **Consume uses the DB clock** (`expires_at <= now()` in the locked select); `now` stays a test override. Test inserts an approved row already past `now()` and consume is refused without any test clock.
4. **0029 guards:** `expired` is terminal; INSERT with `digest_version` other than 2 is refused (trigger); DELETE and TRUNCATE are refused unless the transaction-local `axion.purge_demo = 'on'`. Tests: expired cannot go back, v1 insert refused (explicit and default), DELETE/TRUNCATE refused, `clearDemo` still purges a demo mission with a decided approval. The legacy-row tests lift the insert guard for one statement to create v1 fixtures; `test/company.test.ts` raw fixture insert now sets `digest_version` 2 (fixture only, no assertion changed). Down migration updated.
5. **Tests:** "target removed" added to the consume tampering list (now 14 variants); the no-route test asserts exactly 404; immutability test covers `agent_id`, `tenant_id` and `id`.

Results: server `tsc` clean, web `tsc` clean; full vitest 40 files, 704 tests, 0 failed (was 697). `api-e2e api-flows api-stage6 api-c35`: 132 PASS lines; `api-c35` 16 PASS 0 FAIL; one flaky FAIL in api-stage6 ("after the 409 the next Save succeeds", an agent-edit check unrelated to approvals) while verify-all ran in parallel; api-stage6 rerun alone: 94/94 passed, 0 FAIL.
