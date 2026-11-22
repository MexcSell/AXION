# Cycle 50 report: API contract tests that cannot fall behind (H9, replaces the held c15)

Lane w49, branch `c50-contract-coverage`, from improve-30h at bd64f37. Ports and database as in the brief (axion_e2e15). No migration, no server behaviour change.

## What was built
- `server/test/contracts/inventory.test.ts` (+ `inventory.ts`): the route list is read from the running Fastify route table (`app.routeTable`, 108 routes, HEAD twins excluded). Each route must have an entry in `registry.ts` (a response validator) or an explicit exclusion with a reason of at least 30 characters; each registry entry must be a registered route. The event list comes from the new runtime list `EVENT_TYPES` in `shared/contracts/src/events.ts` (45 types) and from the server source (every `type: 'a.b'` emit literal): types, validators and emitted types must be the same set in all directions.
- `server/test/contracts/registry.ts`: one entry per route: validator plus `admin: true` for the 30 administrator routes.
- `server/test/contracts/validators.ts`, `events.ts`, `validate.ts`: a small structural checker (strict on extra fields and on nullability, no new dependency), every validator phantom-typed against the shared DTO. `EVENT_VALIDATORS` is a mapped type over `EventType`/`EventPayloads`, so tsc fails when a type has no payload or a field differs.
- `shared/contracts/src/api.ts` (new) and `events.ts`: response DTOs that had no shared type (health, ops, audit, policy, mission, approval, notice, instance, task, hierarchy, message page, thread view) and one payload type per event.
- `server/test/contracts/coverage.test.ts` (+ `flow.ts`): one scripted run through the API (real sign-in, missions, uploads, tasks, reviews, briefs, ledgers, threads, channels, approvals, agents, versions, playbooks, skills, grants, failure tags, mentoring, organisation, company) seeded through the API except tasks, approvals and notifications (SQL/service helpers, as the older tests do). Every checked route gets a call whose 2xx body is validated; every administrator route is called as a member and its 403 checked against `{code, message, correlationId, retryable}` (generated from the registry, so a new admin route is covered the day it is added); every stored event of the run (`events` table via `eventDto`) and every event on the live SSE stream is validated; every event type must have been produced. A second app drives the stalled-staffing retry route and `staffing.stalled/resumed`. The last tests prove non-vacuity: every validator rejects its own sample with an extra field, and an object body with its first field removed.
- `server/test/contracts/guards.test.ts` (from c15): the validators detect drift, and every error code the server throws is in `ERROR_CODES`.
- On failure the drift list prints `path: expected X, got Y` / `missing` / `not in the contract` per field (the compact table is the `problems` array in the assertion diff).

## Pass threshold
| Item | Result | Evidence |
|---|---|---|
| Route inventory lists 100 % of routes as checked or excluded with a reason; a dummy route makes it fail | PASS | 108 registered = 108 registry entries (106 checked, 2 excluded). RED: a dummy `GET /api/v1/zz-dummy` added in `src/app.ts` failed the inventory with `GET /zz-dummy: registered but has neither a contract entry nor an explicit exclusion` (run captured, then reverted). The same check also runs permanently in-suite with a dummy route injected through `buildApp`'s `configure` hook |
| Every event type has a validator; a dummy event type makes it fail | PASS | 45 types, 45 validators, 45 emitted. RED: adding `'dummy.happened'` to `EVENT_TYPES` failed the inventory (`no payload validator`, `no server code emits it`) and `tsc` (`Property '"dummy.happened"' is missing`). Permanent in-suite meta test covers a dummy type, a dummy validator and a dummy emit |
| All contract checks pass on the merged tree; real drift fixed at its cause in a separate commit, or reported | PASS | coverage run: 106/106 checked routes got a contract-valid 2xx, 30/30 admin routes a validated 403, all stored and streamed events valid. Drift fixed in commit `80024c5` (below) |
| Full vitest passes through heavy.sh and tsc is clean | PASS | `heavy.sh npx vitest run`: 61 files, 1690 tests passed; `tsc --noEmit` clean in `server` and `web` |
| Report lists every exclusion and every drift | PASS | below |

## Exclusions (2, each with its reason; the test refuses a reason under 30 characters)
- `GET /events/stream`: server-sent events, not a JSON body. Every event it delivers is validated against its payload contract (the flow keeps a live stream open and checks each event, name and envelope).
- `GET /uploads/:id`: streams the stored file bytes with its own content type, not JSON. The flow downloads an upload and checks the bytes.
`GET /health`, `POST /uploads` (multipart) and the other routes are validated, not excluded.

## Drift found
1. **Fixed (commit 80024c5, contract side, no server change):** the server emits `approval.consumed` (`approvals/service.ts` `consumeApproval`, payload `approvalId, kind, tier, by`) but `EventType` never listed it and no payload contract existed. The server is right. Commit 1eac81b is RED on purpose and shows this: the event inventory reports `approval.consumed: emitted by the server but missing from EVENT_TYPES`, and the stream check reports it for both the stored row and the SSE copy.
2. **Contract gaps, not server bugs (no shared type existed, validators were written from the code and observed bodies):** `POST /agents/:id/rollback` returns `{agent, version}` (the new version it created); the first validator draft expected `{agent}` only and the strict check caught the extra `version` field. `GET /agent-instances` always sends `truncated`; `ApprovalDto` carries `digestVersion, taskId, origin, target, requestedBy, effect, effectWhy, approver, consumed, consumedAt`; notices carry `createdAt`; scorecard rows carry `previous` and `trend`. All of these are now in `shared/contracts/src/api.ts`.
3. Payloads richer than the contract had them: `approval.requested` (`policyVersion, reasons`), `agent.updated` (`versionId`), `agent.versionCreated` (`proposalId`, `rollbackOf`), `org.proposalCreated` (`rollbackTo`), `instance.created` (`managerInstanceId`) are declared now.
No drift needed a server change. Nothing found would change behaviour, so there are no behaviour findings.

## Files
`shared/contracts/src/api.ts` (new), `shared/contracts/src/events.ts`, `shared/contracts/src/index.ts`, `server/test/contracts/{validate,validators,events,registry,flow,inventory}.ts`, `server/test/contracts/{inventory,coverage,guards}.test.ts`, this report.

## Concerns
- The `admin: true` flag in the registry is the author's statement; the 403 loop proves a flagged route is gated, but nothing proves an unflagged route is not admin-only (the happy call runs as the right role either way). A static scan of `requireAdmin` per route would close it.
- The event-emit scan is a regex over `type: 'a.b'` literals. A future emit through a computed type would escape the "emitted but undeclared" check (the coverage run still validates it when produced, as an unknown type).
- Arrays that are empty in the flow cannot validate their elements; the flow re-reads lists after creating data for the routes that matter (tasks, mentoring, version proposals, site grants, failure tags).
- Tasks, approvals and notifications are seeded through SQL or service helpers (no public create routes); `instance.stateChanged` and `approval.consumed` have no HTTP producer, so they are driven through the service functions, as c15 and the approval tests do.
