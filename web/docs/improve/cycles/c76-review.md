# c76 independent review (branch c76-stage8-records, a1f6fbb, worktree /home/luca/AXION-w74)

Read-only. Never touched the live `axion` DB (server/.env DATABASE_URL is `axion_lane_disabled`; I overrode it to axion_e2e18 for migrate; tests use axion_test schemas). No background jobs left.

## Baseline checks
- `git status` clean. `git diff --stat 0759872..a1f6fbb`: 16 files, matches the report's 15 plus c76-report.md.
- c76 tests on the committed tip, via heavy.sh serial: `vitest run c76-release-records c76-artifact-records test/contracts c66-writability` gives 6 files, 61 tests, all pass.
- Migration on axion_e2e18: `migrate up` (56), `down 55` (lands at 53, because 0054/0055 do not exist in this branch), `up` (56); all four tables present afterwards.

## Findings

### F1 should-fix: the R4 approval can be decided by the person recording the release
- `server/src/releases/routes.ts` `approvalProblem` (about lines 60-70) checks state, tier, consumed, expiry and digest. It never looks at who decided. `approval_decisions.decided_by` exists (migration 0004), so the check is cheap.
- c35's decider != requester rule compares `requested_by` (an agent id) with the decider, so it is dormant here (c35-review section 3, LESSONS "Self rules need a real second person", Q9).
- For a release, the recorder is the real requester. One admin can decide the R4 and then record the release, so the guardrail-path denial is satisfied by a single person. c35 required a second person at R2+ and Rule of Two exists for this reason.
- Also, `decideRefusal` lets any admin decide R4, while the policy says the approver is the owner. This is the existing c35 behaviour, not new in c76.
- Fix: in `approvalProblem` (both the pre-check and the locked recheck), refuse `approval_decided_by_recorder` when `approval_decisions.decided_by = ctx.user.id`, plus a test. The cost is that a single-admin company can never record a guarded release. That is probably the right answer, but the owner should know. If the owner declines the fix, add a BACKLOG entry, as c35-review required.

### F2 minor: the guardrail denial binds only what the recorder declares
- Report concern 1 is confirmed. Omitting a guarded path, or listing only `README.md`, passes with no approval.
- This is inherent without VCS integration. The R1 claim of "a guardrail denial" is true for declared paths only. Say so in any release note.

### F3 minor: the regex is under-inclusive for real repo files
Test: I ran the regex over `git ls-files` and listed guard-flavoured names that do not match.
- Not guarded: `server/src/migrate.ts` and `server/src/migrate-cli.ts` (the migration runner), `server/src/organization/guardrails.ts`, `server/src/company/metric-audit.ts` (segment does not start with "audit"), and `grants/`, `auth/`.
- `policies/` does not match, because "policies" does not start with "policy".
- A name such as `baseline-policy.ts` does not match, because the segment must START with a keyword.
- The brief's five areas are matched, so this is a hardening suggestion. Consider also matching `migrat`, `polic`, `guardrail`.
- I could not mount a bypass through normalisation. Case, `./`, `a/../policy`, backslashes, full-width, trailing slash, `%` and zero-width characters are all handled. `normalisePath` runs before the check, and the stored path is the normalised one. The SQL trigger recomputes it.

### F4 minor: the binding is by digest, but the DB trigger is weaker than the service
- Binding is real in the service: `releaseDigest` = sha256 over tenant, version and sorted paths, compared against `payload.releaseDigest`. A different-release digest, a missing digest, wrong tier (R3), pending, denied, expired and consumed approvals are refused, tested at c76-release-records.test.ts lines 115-143.
- The digest does not cover `what` or `released_by`. This is acceptable.
- The 0056 trigger `releases_check` only requires an approved R4 of the same tenant. It does not check the digest, consumption or expiry. A raw DB insert could therefore reuse a spent or unbound R4. The report says "the database repeats the rule"; only the path half is repeated. Minor, since there is no raw-write path.
- The approval need not have been requested for a release: any R4 kind (the tests use `production_deploy`) with the digest in its payload is accepted. Recording burns it via `consumeApproval`. A future deploy executor's approval could be spent by a mere record. Decide whether the kind should be fixed (a `release_record` kind).
- A denial inside the transaction (the locked recheck, for example a race) is not audited. Only the pre-check denial is. Minor.

### F5 minor: no DB check that a `release_marks.tenant_id` matches its releases' tenant
- The routes check both release ids against `ctx.tenantId` (the `has()` helper). Cross-tenant release_id and target_release_id are refused with 404, and the pointer query filters by tenant.
- A DB-level trigger would match what `artifact_versions_check` does for artifacts.
- Denied releases create no row at all, so a pointer cannot reference a denied release. Marks are records only (no route moves or runs anything).

### F6 minor: migration numbering gap
- Migrations 0054 and 0055 are absent here. They are presumably taken by other lanes. If the owner merges 0056 first, the runner accepted the gap in my up run; check it again when merging after those lanes land.

## Checks that passed (evidence)
1. **No acting route.** The new routes are `GET /releases`, `POST /releases`, `POST /releases/:id/marks`, `GET /artifacts`, `GET /artifacts/:id`, `POST /artifacts`, `POST /artifacts/:id/versions`. All write only to their own tables plus audit. No fs, child_process, fetch or storage import; no bytea, path or URL column (`\d` of the tables, plus a test). The only helper with a side effect beyond the record is `consumeApproval`, which marks an approval spent (see F4). `normalisePath` and `isGuardedPath` are pure.
2. **Append-only.** On axion_e2e18, all four tables have `*_no_edit` (update or delete) and `*_no_truncate` triggers (pg_trigger rows listed). `update artifact_versions set sha256=...` gives "artifact_versions is append-only". `truncate artifact_versions` and `truncate artifacts, artifact_versions, releases, release_marks` are refused by the guard (the multi-table form hits the guard on the child table). The `releases`/`artifacts` TRUNCATE trigger is present and asserted. The purge_demo DELETE exception lives in `stage8_append_only` and is tested. A version cannot be edited and a sha cannot be rewritten; versions are gapless by trigger, and a same-hash repeat of the newest version is 409.
3. **Contracts and c66.** Registry, validators and DTO entries exist for all 7 routes (admin: true). The 3 POSTs are in `ROUTE_NO_INPUT` with reasons. No allowlist lines were added (`git diff` of metric-guard.ts shows one `HELPER_CALLERS.consumeApproval` change plus ROUTE_NO_INPUT entries). The `HELPER_CALLERS.consumeApproval: ['releases/routes.ts']` declaration is legitimate: it is the only importer and the c66 caller scan requires it. Tests green.
4. **Migration 0056.**
   - Round trip worked (above).
   - The down file drops tables, then the two check functions and the shared guard function, in a valid order.
   - Splitting is easy. R1 = the `stage8_append_only` function plus `releases`, `releases_check`, `release_marks` (about lines 1-54 of the up file). A1 = `artifacts`, `artifact_versions`, `artifact_versions_check` (about lines 55-105). The shared guard function must stay with whichever ships first.
   - The two halves do not reference each other. The code splits cleanly too: `releases/*`, `artifacts/*`, one contracts file each, and one test file each. The shared edits are app.ts (two lines), index.ts, registry, validators, coverage and metric-guard (separable by hunk).
   - Estimated 30-60 minutes of mechanical work, plus a rerun of the contract tests. The commits are already per item (440bea0 R1, a6fb3d0 A1), but the migration lives across both.

## Verdict: CLEAR AFTER FIXES
Required: F1, the decider != recorder check on the bound R4 approval, with a test (or an explicit owner acceptance recorded in BACKLOG). Recommended, not blocking: F3 (widen the regex to migrate/guardrail/policies, and mirror it in the SQL), F4 (a dedicated approval kind, and the DB trigger checking the digest). The rest is sound as a records-only branch, and A1 alone has no blocker.
