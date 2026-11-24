Was PARKED for owner decision Q11. **Taken by the owner on 2026-11-24 and merged as batch 58**; the migration was applied live at about 04:49Z.

# c77 report: Stage 9 records (M2 usage ledger, G1 model registry), lane w75

Branch `c77-stage9-records`, from improve-30h at 0759872. Migration 0057. E2E DB axion_e2e2. Ports 12590-12593 (only 12592/12593 used; both free again). No QUEUE row, no live migration, nothing pushed.

## What was built (records only)
- **Item 1, M2** (commit 85463b4): `usage_ledger` (tenant, subject, unit, quantity, cost in fixed-point `cost_micros`, `recorded_at` from DB `now()`, source, `correction_of`). Append-only with all four guards (UPDATE, DELETE, TRUNCATE, `axion.purge_demo` exception). A correction is a new signed row that must point at an ORIGINAL row of the same tenant, subject and unit (trigger); originals cannot be negative. `src/usage/ledger.ts` (recordUsage, recordCorrection, netUsage; nothing in src calls them) and the pure `checkBudget(caps, usage)` in `src/usage/budget.ts` (allow/warn/deny with reasons, integer maths, fail closed on malformed input; wired to nothing).
- **Item 2, G1** (second commit): `model_entries` (versioned rows, latest per model counts; family must equal the c38 `modelFamily()` vendor-table family, unknown names fail closed) and `routing_policies` (versioned rows, rules as JSON data). Both append-only with the four guards. Pure `route(policy, request, entries)` in `src/models/route.ts` (3 arguments, takes no adapter). `src/models/registry.ts` holds the store functions (not called from src).
- **Fakes** live only under `server/test/fakes/` (`fake-meter.ts`, `fake-adapter.ts`). Tests assert no src file imports them or calls the ledger/registry functions.
- **Item 3, contracts:** no route was added, so there are no contract entries, no allowlist lines and no c66 inventory changes. The c66 inventory scans only scorecard input tables; `usage_ledger`, `model_entries` and `routing_policies` are not inputs, and the full suite (contracts guards included) is green. The Models tab stays unwired; c69's unmeasured cost cells are untouched (no file under web/ or the process module changed).

## RED / GREEN
- Item 1 RED (unchanged code, before any src/migration file existed):
  - `test/c77-budget.test.ts`: `Error: Cannot find module '../src/usage/budget.ts' imported from .../c77-budget.test.ts`
  - `test/c77-usage-ledger.test.ts`: `Error: Cannot find module '../src/usage/ledger.ts' ...`
  - GREEN: 2 files, 29 tests pass.
- Item 2 RED: `test/c77-registry-route.test.ts`: `Error: Cannot find module '../src/models/route.ts' ...`.
  - First GREEN attempt had 2 failures, both mine, neither a loosened test:
    1. my table row expected `['long','code']` with opus excluded to route to gpt-5, but route() requires the entry to hold every requested capability and gpt-5 has no `long`. The expectation was wrong; it now asserts `no_eligible_model`, and a separate row covers the later-rule fallback with `['text']`.
    2. a comment in `src/usage/ledger.ts` contained the text "test/fakes", which tripped my own "src names no fake" scan. The comment was reworded.
  - GREEN: 3 c77 files, 48 tests pass.

## Final runs (from the committed tree)
- `tsc --noEmit -p .`: clean.
- Full vitest through heavy.sh: the first parallel run hit the known connection cap (H14: `too many connections for role "axion"`, 45 failed, in audit-chain, dimensions-route, approval-binding, auth and others; none related to c77). Serial fallback (`--maxWorkers=1 --no-file-parallelism`): **3218 passed, 44 skipped, 1 file failed**. The one failure was `test/c71-equivalence.test.ts` (a file failure in `beforeAll` -> `seedScale` at `test/c71-scale-fixtures.ts:101`, first line `error: relation with OID 105591731 does not exist`). It is a catalog race with another lane's schema drop in the shared axion_test DB; re-run alone it passes (8/8). I did not edit it. With it, the effective result is every test passing.
- api-stage6 (`E2E_API_PORT=12592 E2E_WEB_PORT=12593 heavy.sh ./scripts/api-e2e.sh api-stage6.mjs`): **94/94 passed**, no page errors.
- Migrate down/up 0057 on axion_e2e2 (one-off script that refuses any DB not named axion_e2e2; the live DB was never touched): start at 57 with the three tables present; `down` to 53 -> all three tables gone; `up` -> 57, all three back.
- Grep: no provider SDK, no network module and no `fetch(`/XMLHttpRequest/WebSocket in `server/src/usage`, `server/src/models`, `server/test/fakes` or the c77 tests (the only hits for "openai" are the family string in test data). No package.json change. The c77 tests also enforce this by scanning all of src (SDK, `http(s)/net/tls/dns`, undici, axios, node-fetch) and confirming no src file outside src/models imports the registry or route.

## Diff stat (`git diff 0759872..HEAD --stat`, before this report)
11 files, 500 insertions: `server/migrations/0057_stage9_records.{up,down}.sql`, `server/src/models/{registry,route}.ts`, `server/src/usage/{budget,ledger}.ts`, `server/test/c77-budget.test.ts`, `server/test/c77-registry-route.test.ts`, `server/test/c77-usage-ledger.test.ts`, `server/test/fakes/{fake-adapter,fake-meter}.ts`. Plus this report.

## Threshold
| Item | Result | Evidence |
|---|---|---|
| Items RED -> GREEN | PASS | module-missing RED for each item, then 29 and 48 tests green |
| Full vitest (serial fallback) | PASS with one transient | 3218 passed; c71-equivalence beforeAll OID error, passes alone 8/8 |
| tsc | PASS | clean |
| api-stage6 | PASS | 94/94 |
| Migrate down/up 0057 once on e2e DB | PASS | tables absent after down, present after up |
| Grep: no provider SDK, no network call | PASS | see above |
| No route writes usage / calls a model; fakes only under test/; cost cells unmeasured | PASS | no route added; source scans in tests; no web/ change |

## Concerns
1. `route()` re-checks `modelFamily(entry.model) === entry.family` on every call; if the c38 table later changes, an old entry whose family no longer matches becomes unroutable (fails closed, by design). Owner may prefer snapshotting the table version in the entry.
2. `netUsage` converts SQL bigint sums to JS numbers and throws above 2^53; fine for records, not for real metering at scale.
3. The unit list in `usage_ledger` (tokens_in, tokens_out, requests, seconds) is a CHECK constraint; a new unit needs a migration. Cost has its own column and is checked by budgets under the pseudo-unit `cost_micros` only by convention.
4. The budget rule denies at `used >= limit` (a hard cap reached), not only above it; owner may want "over" semantics.
5. No admin read route was added (optional in the brief), so none of this is visible in the UI or API.
6. Shared migration file: 0057 holds all three tables in one down/up pair, so the owner cannot drop only one half without editing it.
