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

---

# Re-review (fix round, a025aa5..df8c17e)

Run: vitest (otel-export, otel-mapping, failure-attribution, contracts) 6 files / 66 tests pass with --maxWorkers=1 via heavy.sh; `tsc --noEmit` clean. Probes: scratchpad `probe2.ts`, `w.mts`.

## S1 default-export leak: FIXED for the named fields; residual remains (minor)
- Original probe (owner_agent, evidence_ref, attribution agent/step, tool name, error.type): all gone. Fixture with `SECRET` in task title/criteria/label/owner_agent/evidence_ref/note/attribution/step input/output: `SECRET present false`; span names are only `axion.mission`, `invoke_agent Researcher`, `execute_tool t`.
- Tried 12 hostile values (`sk-live-..`, `ghp_..`, `AKIA..`, `eyJ..`, newline, RLO unicode, 16-digit number, 60 x's, `a@b.com`, `ab/cd`, spaces) as tool name, agent name, case id, dataset id, judge family and step error. Unicode, newline, `@`, spaces in tool names and the secret prefixes are all mapped to `_OTHER`; error.type only takes the fixed 8-word vocabulary. Resource attributes, event names and keys are constant or system ids. No link attributes exist.
- Residual (minor, by design): anything shaped like a plain identifier still leaves. Observed leaking in default mode: a 16-digit string as case/dataset id/judge family/agent name, 60-char `xxxx...` as the same, `hunter2 pw` as an agent name (the agent-name regex allows spaces), `web-search`/`ab/cd` as case id. The tool-name rule (<=48, no hyphen) is stricter. Secret-shaped tokens without a known prefix and <=64 chars pass in these fields. Acceptable if the docs say "identifier-shaped names and ids are exported"; the usage/mapping text should say so (not yet claimed as zero text). Consider capping agent names/case ids and rejecting all-digit strings of 13+ chars.
- Tool-name rule `^[A-Za-z][A-Za-z0-9_.]{0,47}$`: safe but too strict in practice. `web-search` becomes `_OTHER` (verified: not exported, raw name only in `axion.step.tool_name` with --include-content). Allowing `-` is safe: the charset adds no new leak channel beyond what `ident` already permits for case ids and agent names, `SECRET_SHAPE` still rejects `sk-`, `pk-`, `rk-`. Recommend allowing hyphens (MCP/tool names usually have them); also all tools sharing `_OTHER` collapse in the trace. Not blocking.
- Changed assertions: legitimate. The removed lines asserted raw `attributed_agent_id`/`step_ref` values in default export (now contradicts S1); the replacement asserts pointers (and content under --include-content). The removed `parseExportArgs(['M-1'])` expectations are replaced because the flag is now required.

## S2 licence: FIXED
- `LICENSE` sha256 c71d239d... equals the raw LICENSE at commit d0e74ba6 (fetched and hashed myself). Repo has no NOTICE at that commit (404), as SOURCE.md states. SOURCE.md now states verbatim and unmodified, "The OpenTelemetry Authors", Apache-2.0, LICENSE hash, repo, tag, commit, and that no copyright header or NOTICE exists. A test checks these strings. Still worth a one-line entry in c56's THIRD_PARTY_NOTICES.md on merge (nice-to-have, not blocking).

## S3 database and read-only: FIXED
- `npm run export:otlp -- M-1` (no flag) prints `--database-url-env is required: there is no default database...` plus usage and exits 1; the URL is never printed anywhere (only `current_database()` name appears in `describeExport`).
- Loads run in `withReadOnlySnapshot`: `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY` plus `SET LOCAL`; ROLLBACK on error. Test at otel-export.test.ts:290 checks a write fails ("read-only transaction") and that the shared pool shows `default_transaction_read_only = off` afterwards.
- Nit: the CLI script also sets session-level read-only with a fire-and-forget `pool.on('connect', ...)` (no await, errors unhandled). It is queued ahead on the same connection so ordering holds, and the pool is the CLI's own; harmless.

## Minors
- Output file: mode 0600 on new file (new), on `--force` replacing a pre-existing 0644 file (`old forced mode 600`, via `fchmod`). Verified with `w.mts`.
- Symlink at `--out`: refused with and without `--force` (both lines error "is a symlink; refusing..."); target file unchanged (`real untouched: hi`). Mechanism: `lstat` check then `open` with `O_NOFOLLOW` (ELOOP mapped to the same message), `O_EXCL` without force, so a swap between lstat and open is also caught. Only the final path component is protected (directory symlinks are followed) and a hard link would be truncated under `--force`; both acceptable for a local operator CLI.
- `axion.export.linked_by = agent_version` is set on every eval-result span; usage text states the cross-mission linking, operator/no-visibility scope, 0600 and symlink rule.
- `ATTRIBUTION_HELP` (shared/contracts/src/failures.ts) states all four rough edges (no retraction, agent-only vs agent+step, exact-string, 409 on flag change), accurate against `disagreementsOf` and the unique index; the dialog chip uses it as its title.

## Verdict: CLEAR
Remaining (none blocking): allow hyphens in tool names; document that identifier-shaped ids and names are exported by default (consider tightening the digit-only/long-token case); add the Apache-2.0 line to THIRD_PARTY_NOTICES.md at merge with c56.
