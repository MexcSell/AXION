# c60 review (branch c60-attribution-otel, 5b3e32b..a025aa5, migration 0045)

Verdict: **CLEAR AFTER FIXES** (one should-fix on export leaks, two small should-fixes, minors).

Verified by me: `vitest run --maxWorkers=1` on failure-attribution, otel-mapping, otel-export, failures = 4 files / 57 tests pass (via heavy.sh, load 13). No browser run by me.

## Findings

### S1 (should-fix) Default export leaks untrusted free text through attributes, span names and error.type
Brief item 3 and the report ("content off ... no text from untrusted fields") are not true for these fields. Probe: `/tmp/claude-0/-home-luca-AXION/110db678-84c0-496e-aaa7-b625859aebb5/scratchpad/probe.ts` calls `buildOtlp(rec)` with default options on a fixture. `validateOtlp(...,{includeContent:false})` returns `[]` (passes) and all of these strings appear in the output:
- `axion.failure.attributed_agent_id` / `attributed_step_ref` (export.ts, attribution event block): the attributor's free text (up to 120 chars) goes out in default mode. These two fields are not in CONTENT_ATTRIBUTES and have no `_ref` form.
- `axion.task.owner_agent` (tasks) and `axion.attempt.evidence_ref` (attempts): free text, exported raw.
- Tool name from a trace step: `execute_tool {name}` span name and `gen_ai.tool.name` come straight from stored step `name`, unbounded and unsanitized (fixture name `sk-live-ABCDEF123456 password=hunter2` appears). The spec requires the tool name, so it is not removable, but it needs a length cap and a character-class check (else `_OTHER`/placeholder), and the docs should say it is untrusted.
- `error.type` is set from the step's `error` text whenever it matches `^[A-Za-z0-9_.:-]{1,64}$` (export.ts, `ERROR_CLASS`). A short error string or token such as `sk_live_ABCDEF1234567890` is exported in default mode. Error text is content; only a fixed vocabulary should become error.type.
Fix: treat attributed_agent_id/step_ref/owner_agent/evidence_ref as content (ref pointer by default), map error.type to `_OTHER` unless the text is in a small allowlist, sanitize tool names, and add a sentinel test for each (the existing sentinel test misses them because its fixtures never put sentinels there).

### S2 (should-fix) No licence text or notice for the stored Apache-2.0 spec pages
Verified: tag `v0.1.0` exists in open-telemetry/semantic-conventions-genai (`git ls-remote` -> d0e74ba6c48bcc4ded473b1828a8212f06b23753, lightweight tag), repo LICENSE at that commit is Apache License 2.0, and the two raw pages at that commit hash to exactly 0d2db04d... and 7a72f0d6..., equal to the stored files and to `pinned.ts` (`sha256sum` run on both). SOURCE.md says "Apache-2.0" but ships no licence text. Apache-2.0 section 4 needs a copy of the licence (or a link plus the licence name is customary) and retention of any notices; the pages carry no copyright header and the repo has no NOTICE file I saw. Needed: an entry in THIRD_PARTY_NOTICES.md (c56 adds it at the repo root, so add the OpenTelemetry entry when merging, or put a LICENSE copy in `otel-spec-v0.1.0/`), stating "verbatim, unmodified, Apache-2.0, (c) The OpenTelemetry Authors, source URL and commit". The stored files are verbatim, so no "changes" statement is needed.

### S3 (should-fix) CLI default database is the live DB, with nothing to prevent writes or to show which DB
`package.json` `export:otlp` loads `.env`; `cli/otlp-export.ts` uses `configFromEnv().databaseUrl` (DATABASE_URL) and tenant `t-1`. So by default it reads the live DB, and it does not print which DB. The code only issues SELECTs, but nothing enforces read-only (no `default_transaction_read_only`, plain pool, no snapshot transaction; the six reads run in `Promise.all` on separate connections so they are not one consistent snapshot). The report's "read-only on the database" is true of the code today, not enforced. Fix: set `options: -c default_transaction_read_only=on` and run the loads in one REPEATABLE READ read-only transaction, print the DB host/name (no password) in the success line, optionally require `--db-url` or `--live` to use DATABASE_URL.

### M1 (minor) Eval results are linked to a mission only through the pinned agent version
`loadMissionRecords` pulls every eval run whose `subject_version_id` equals a version one of the mission's instances pinned. Those results belong to other missions' runs of the same version and appear in this mission's export (tenant-scoped, so no cross-tenant leak, and the report states the linking rule in concern 4). Under `--include-content` that includes other missions' trace text. State it in the usage text.

### M2 (minor) `--out`
Overwrite is guarded (`wx`, EEXIST -> message; `--force` -> `w`). `wx` does not follow a pre-existing symlink, but `--force` does. Path is `resolve`d with no traversal restriction, which is acceptable for a local operator CLI. The default name sanitizes the mission id. The file is created with the default umask (typically 0644) even with `--include-content`; use mode 0600 for content exports.

### M3 (minor) `--tenant`
Scoped correctly: every query filters tenant_id, and an other-tenant, deleted or unknown mission gives the same error. The CLI applies no per-person mission visibility (operator tool with DB credentials); say so in the docs.

### M4 (minor) Disagreement semantics
Sound as designed: distinct `(agent_id, step_ref)` targets minus one (service.ts `disagreementsOf`), entries ordered oldest first, no "current" field, no update path (trigger). Limits to document: (a) one person who changes their mind adds a second entry and so produces a "disagreement" with themselves, and cannot retract the first; (b) agent-only vs agent+step entries count as different views although compatible; (c) comparison is exact-string, so `Agent-1` vs `agent-1` count as different; (d) `fullTraceAvailable` is outside the unique index, so repeating the same target with a different flag returns 409 FAILURE_ATTRIBUTION_DUPLICATE (index `failure_attributions_once`). 409 for an exact repeat is right; the (d) case is a rough edge (a different flag is arguably a new view). Not blocking.

### M5 (minor) Report wording
"read-only on the database" (S3) and "no text from untrusted fields" (S1) overclaim; concern 3 and 4 and "traces are still rare" are honest.

## Checks that passed
1. **failure_attributions guards.** 0045 has UPDATE and DELETE (`before update or delete` row trigger), TRUNCATE (statement trigger), and the `axion.purge_demo` exception on DELETE. Mission FK has `on delete cascade`, so a purge removes entries with the mission. The no-FK trade-off is sound: tags are themselves append-only (0028 guard), so a tag cannot be deleted or purged apart from its mission, and the insert trigger `failure_attributions_check` rejects a missing tag, a different tenant, or a different mission. The cross-tenant and cross-mission cases are covered by that comparison (trigger is `before insert`, tag rows are immutable in those columns, unique index closes the same-person race). `FOR SHARE of f` in `createAttribution` is enough.
2. **"Attribution only for a recorded failure."** Holds for all four subject kinds: message and mission refused (409 ATTRIBUTION_NEEDS_FAILURE in the service and in the trigger, which only accepts task and task_attempt). A failed task cannot lose its failure: `task_attempts` is append-only (0007 triggers) and the retry path (`tasks/routes.ts` ~line 85) inserts an explicit failed attempt before leaving `failed`; only a task that is `failed` with no failed attempt and moved by another path could lose it, and none exists in the code I read.
3. **Authorization.** Any signed-in person (member or admin) may attribute, same rule as c33 tags. `createAttribution` joins `VISIBLE_SQL` and `missions.deleted_at is null`, so a mission the member cannot see is 404 (not 403, no existence leak); other tenant 404; response is the tag DTO already shown to those who can see the mission. Agents use the internal service with `viewer: null` (tenant only), as c33.
5. **Pinned spec.** Tag, commit, both page hashes and the Apache-2.0 licence verified against the public repo (see S2). Stored hashes equal the test constants.
6. **Mapping.** The mapping test compares the generated markdown byte for byte and the list of fields against real migrated columns (it passed here; it caught three eval_runs columns). Claim "every field mapped or no-equivalent" holds for the tables it names. The mapping table itself is honest about extensions.
7. **Contracts.** Registry entry for `POST /failure-tags/:id/attributions`, `failureAttribution` and `failureTag` validators (arrays and `int`), error codes in `shared/contracts`, rate-limit line, and a coverage call; no allowlist or `exercised.ts` lines changed (`git diff --stat` shows neither). Item 4 landing in item 1's commit is acceptable because coverage fails otherwise.
8. **Tests.** RED evidence is credible and specific (assertion messages and missing relation/module, not generic). `api-c60.mjs` uses a polling `until(...)` helper with a timeout, no fixed sleeps (its only `setTimeout` is the 150 ms poll step). The api-stage6 stop (`reading 'csrf'`, `/me` returned no `me`) is consistent with connection exhaustion: the report documents 33 "too many connections" errors in the same period, the pool has a 5 s connection timeout, and the rerun passed 94/94; nothing in the change touches `/me`. I did not rerun stage6 myself. The full-suite run in the report used `--maxWorkers=1` after a default run failed 173 tests on connection limits, which fits the shared 45-connection cap.

## Fixes required for CLEAR
1. S1: stop default-export leakage (attribution agent/step, owner_agent, evidence_ref, error.type from raw error text, tool-name sanitizing) and add sentinel tests for each.
2. S2: add the Apache-2.0 notice (THIRD_PARTY_NOTICES.md entry after c56 merges, or a LICENSE copy next to the pages).
3. S3: enforce read-only, print which DB, ideally require an explicit DB choice.
