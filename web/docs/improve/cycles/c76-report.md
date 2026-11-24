PARKED for owner decision (Q11); do not merge without approval.

# c76 report: Stage 8 records, release/last-good (R1) and artifact metadata (A1) (lane w74, branch c76-stage8-records, from improve-30h 0759872)

Records only. No route releases, deploys, restarts, rolls back, stores a file or serves one. No UI (the Results tab stays unwired). No QUEUE row, no live migration, no event types added. Never touched the live `axion` DB; all runs used axion_test schemas and axion_e2e18.

## What was built
- **Migration 0056** `stage8_records` (up and down; one file, built over two commits): shared `stage8_append_only()` guard (UPDATE, DELETE, TRUNCATE refused; DELETE allowed only inside `axion.purge_demo = 'on'`) on `releases`, `release_marks`, `artifacts`, `artifact_versions`.
- **R1 (commit 440bea0).** `releases` (id REL-, version, what, change_paths, guarded_paths, from_approvals, guardrail_approval_id, released_by) and `release_marks` (append-only log; kind `last_good` or `rollback_target`; the last-good pointer is the newest `last_good` mark; a rollback target must be a release once marked last good and not itself). Routes (admin only): `GET /releases`, `POST /releases`, `POST /releases/:id/marks`.
  - **Guardrail-path denial** (`src/releases/guard.ts`): paths are normalised (NFKC, backslashes, `.`/`..`; absolute, climbing, control, `%`, `:` and format characters refused). A path with a segment starting with policy, approval(s), audit..., lock(s) or migration(s) is guarded (case-insensitive, fold-width safe). A guarded release is refused (403 POLICY_DENIED, audited as `release.record` denied) unless it names an approved, unexpired, unconsumed **R4** approval whose payload `releaseDigest` = sha256(tenant, version, sorted paths). That approval is spent (`consumeApproval`) in the same transaction as the record. A release with no guarded path must not carry one. The database repeats the rule in a trigger (recomputes guarded paths from change_paths, requires an approved R4 of the same tenant), and a test checks that the TypeScript and SQL regexes agree.
- **A1 (commit a6fb3d0).** `artifacts` (id ART-, name unique per tenant) and `artifact_versions` (version, sha256, size_bytes, media_type, producer, producer_kind, recorded_by). Versions are server-numbered, gapless (trigger enforces it for raw inserts and tenant match), and a repeat of the newest hash is 409. Routes (admin only): `GET /artifacts`, `GET /artifacts/:id`, `POST /artifacts` (with its first version), `POST /artifacts/:id/versions`. No bytea, path or URL column (tested).
  - **Signed download tickets: deferred.** A ticket opens nothing without stored bytes, and a ticket route is a download route, so none is built. The model (append-only `artifact_tickets`: artifact, version, issued_to, DB-clock expiry, single-use consumed_at, server-held signing key) is written in the 0056 comment, to be decided together with a storage backend (owner approval).
- **Contracts (both commits).** `shared/contracts/src/releases.ts`, `artifacts.ts`; validators and registry entries for all 7 routes (all `admin: true`); the 3 POST routes classified in `ROUTE_NO_INPUT` (c66 writability: no row reads them); coverage-run calls for every route; DTO fields chosen so no nullable is unexercised (the pointer has its own `LastGoodDto` with no target field). **No allowlist lines were added.** One declaration line changed: `HELPER_CALLERS.consumeApproval` now lists `releases/routes.ts` (the c66 caller scan requires every importer of an exported write helper to be declared).

## RED / GREEN
- **R1 RED** (`test/c76-release-records.test.ts`, before any implementation): suite failed to load, 0 tests: `Error: Cannot find module '../src/releases/guard.ts' imported from .../c76-release-records.test.ts`. **GREEN:** 19/19.
- **A1 RED** (`test/c76-artifact-records.test.ts`, before any implementation): 13 failed, 1 passed (14); first error `AssertionError: expected 404 to be 201` ("records an artifact with its first immutable version"). (The 1 pass is the column check on tables that did not exist yet, vacuous at RED.) **GREEN:** 14/14.
- Mid-run failures fixed during GREEN, none by loosening a test: whitespace-only path accepted (fixed in `normalisePath`), stored paths lower-cased (now NFKC, case kept), unknown-field and bad-version bodies answer 400 from the schema (test now says 400 for schema failures and 422 for path failures), a TRUNCATE of `releases`/`artifacts` is refused by PostgreSQL's foreign-key rule before the trigger (test accepts either message and separately asserts the TRUNCATE trigger exists), HEAD routes and existing agent/organisation rollback routes appeared in the "no acting route" scan (test now scopes to `/releases` and bans deploy/restart/execute/run anywhere).
- Contract/c66 follow-ups: `c66-writability` and `contracts/coverage` first failed on the new routes (consumeApproval caller, 3 never-non-null fields), then passed after the classification and DTO changes above.

## Pass threshold
| Item | Result | Evidence |
|---|---|---|
| R1 and A1 items RED, then GREEN | PASS | see above; 19/19 and 14/14 |
| Guardrail-path denial tested | PASS | unguarded approval absent, wrong tier (R3), pending, denied, bound to other paths, no digest, unknown id, spent approval, five areas each, obfuscated spellings, DB-level bypass |
| Append-only, all four guards, on all four tables | PASS | UPDATE, DELETE, TRUNCATE (trigger present; for the two parent tables PostgreSQL's FK rule refuses first), purge_demo exception, `clearDemo` still resolves |
| No acting or file route | PASS | route-table tests for `/releases` and `/artifacts`; no download, ticket, deploy, restart or execute route exists anywhere |
| tsc (server and web) | PASS | both clean |
| Full vitest (serial fallback `--maxWorkers=1 --no-file-parallelism`, via heavy.sh) | PASS | 137 files passed, 1 skipped; 3211 tests passed, 36 skipped, 0 failed (the skips pre-date this lane; no test added a skip). Serial because the `axion` role had 41 of 45 connections in use by other lanes (BACKLOG H14). Load average 11 to 17 during the run. |
| api-stage6 (E2E_API_PORT=12492, E2E_WEB_PORT=12493, via heavy.sh) | PASS | `api-stage6.mjs`: 94/94 passed, no page errors, rc 0. (The brief's name `api-stage6` is the script `api-stage6.mjs`.) It does not touch the new routes (no UI); they are covered by the coverage run. |
| Migrate down/up 0056 once on the e2e DB | PASS | axion_e2e18: up to 56, `down 55` to 53, up to 56, four tables present |
| Contracts: registry, DTO, validator, c66 classification, no allowlist lines | PASS | inventory, coverage and writability tests green |

## Diff stat (`git diff 0759872..HEAD --stat`, committed tree, `git status` clean)
```
 server/migrations/0056_stage8_records.down.sql |   7 +
 server/migrations/0056_stage8_records.up.sql   | 105 ++++++++++++
 server/src/app.ts                              |   4 +
 server/src/artifacts/routes.ts                 |  97 +++++++++++
 server/src/releases/guard.ts                   |  41 +++++
 server/src/releases/routes.ts                  | 142 ++++++++++++++++
 server/test/c76-artifact-records.test.ts       | 115 +++++++++++++
 server/test/c76-release-records.test.ts        | 218 +++++++++++++++++++++++++
 server/test/contracts/coverage.test.ts         |  17 ++
 server/test/contracts/registry.ts              |   7 +
 server/test/contracts/validators.ts            |  18 ++
 shared/contracts/src/artifacts.ts              |  33 ++++
 shared/contracts/src/index.ts                  |   2 +
 shared/contracts/src/metric-guard.ts           |   5 +-
 shared/contracts/src/releases.ts               |  55 +++++++
 15 files changed, 865 insertions(+), 1 deletion(-)
```
(plus this report.)

## Concerns
1. **A release record is a claim.** The caller lists the change paths; nothing compares them with a real diff. A dishonest or careless recorder can omit a guarded path. The denial binds what is declared. Closing it needs a VCS integration (owner decision, later stage).
2. **Who decides the R4.** The policy names the owner for R4, but the decision route lets any administrator decide it (existing behaviour, c35). With one administrator the person recording the release can also approve its R4 request (the requester is an agent id, so the self-approval rule is dormant; Q9).
3. **Over-inclusive guard.** `audit-*`, `policy-*`, `lockstep` is not but `auditors.txt` is. Fail closed by design; tests, docs and web files with those names need an R4 too.
4. **Release approval kind.** The R4 approval used is any R4 request carrying the digest (the tests use `production_deploy`). The `release` kind is R3 in the baseline policy and is not evaluated for a record.
5. **Rollback target** needs a prior last_good mark for the target, and is not itself guardrail-checked. Recording a target moves nothing.
6. **TRUNCATE** on `releases` and `artifacts` is refused first by PostgreSQL's foreign-key rule; the guard trigger exists and is asserted, and `release_marks`/`artifact_versions` are refused by the guard itself.
7. **Artifact hash and size are unverifiable** by design (the server never sees the bytes).
8. Two tests hit "too many connections for role axion" on the first runs, from other lanes, not from this code; rerun serial (see above).
9. 0056 is one file written across two commits; if the owner takes only one item, the other half of the migration must be cut by hand.
10. Nothing was run against the live DB; the migration has not been applied anywhere but axion_e2e18 and the test schemas.

## Fix round (review c76-review.md: CLEAR AFTER FIXES; branch stays PARKED)
Migration 0056 was extended in place. One commit per item.

| Item | Commit | What changed | RED then GREEN |
|---|---|---|---|
| F1 decider is not the recorder | 70c3928 | `approval_decided_by_recorder` refused with the existing named code `SELF_APPROVAL` (403, audited) in the pre-check and the locked recheck; the `releases_check` trigger refuses it too. | RED: `expected 201 to be 403` and the raw insert resolved (2 failed of 22). GREEN 22/22. |
| F3 wider guard | 72f7edb | Pattern now also matches `migrate` (so `migrate.ts`, `migrate-cli.ts`), `guardrail(s)`, `metric-audit(s)` and `policies`. Same expression in TypeScript and the trigger. One test per path, each checked in TypeScript, in SQL and through the route (403). Near misses (`migrated-users.ts`, `Policing.tsx`, `metric-auditing.md`) stay unguarded. | RED: 6 failed, first `server/src/migrate.ts: expected false to be true`. GREEN 29/29. |
| F4 dedicated kind, DB parity, audit | 53db091 | New baseline-policy kind `release-record` (R4, critical); only its approval is accepted (`approval_wrong_kind`), so recording a release can no longer burn a `production_deploy` approval. The trigger now repeats everything: kind, digest binding (SQL `release_digest()` twin of the TypeScript digest, compared on mixed-case, accented and astral paths), decider not the recorder, spent by the recorder, not expired, and a unique index (one approval, one release). The recheck now runs before the duplicate-version check and its denials are audited (a concurrent identical release: one 201, one 403 `approval_already_used`, one denied audit row). Path lists are sorted by UTF-8 byte order in TypeScript and `collate "C"` in SQL (a latent mismatch for mixed-case paths, found while writing the digest twin). | RED: 9 failed, first `Policy denies this action (unknown_action)`. GREEN 33/33. |
| F5 mark tenant | c5dac89 | `release_marks_check` trigger: the mark's tenant must equal its release's and its target release's tenant. | RED: raw cross-tenant insert resolved. GREEN 34/34. |
| Pin | 727c01d | `c58-sensitive` pins the kinds that set flag (b); the new critical kind `release-record` is added to the pinned list (that test exists to force this decision; it sets sensitive access, which is right for a critical kind). | The full run at c5dac89 failed only this test: `expected [ 'add_integration', …(11) ] to deeply equal [ 'add_integration', …(10) ]`. GREEN 3/3. |

F2 (declared paths are claims) and F6 (migration numbering gap) stay as documented in Concerns.

**Operational consequence of F1 (by design, fail closed):** with a single administrator, no guarded release can be recorded, because the R4 approval must be decided by a different administrator than the one recording it. A company needs two administrators to record a release that touches policy, approvals, audit, locks, migrations, the migration runner, guardrails, metric audits or policies. (There is no UI, so there is no `?` help to write; the 403 message says "A guarded release needs a second administrator", and this paragraph is the record. If a Results panel is ever built it must show the same sentence behind its `?`.) The coverage run and the tests now promote a second user to administrator to decide the R4.

Test edits to existing c76 tests were additions or tightenings (guarded fixtures use the `release-record` kind and a second-administrator decider); none was loosened. The DB-bypass test for F1 now builds an otherwise bound approval, so the decider rule is the one that refuses.

### Fix-round results
- tsc server and web: clean.
- Migrate down/up 0056 once on axion_e2e18: up to 56, `down 55` to 53, up to 56.
- api-stage6 (12492/12493, via heavy.sh): 94/94 passed, no page errors.
- Full vitest serial (heavy.sh): see the final line below.
- Full vitest serial at 727c01d (before the report commit): 137 files passed, 1 skipped; 3228 tests passed, 36 skipped (same pre-existing skips), 0 failed. The earlier run at c5dac89 had the one c58-sensitive failure named above.
