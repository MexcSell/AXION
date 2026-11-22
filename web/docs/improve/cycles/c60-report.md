# c60 report: failure attribution fields and an OpenTelemetry GenAI mapping with local export (lane w59, migration 0045)

Branch `c60-attribution-otel` (from improve-30h 5b3e32b). Records, a pure export function and a CLI only: no new route besides one attribution write, no network, nothing executes.
Load average is printed next to every timing below (the machine was busy: 9 to 22 during the runs).

## Pinned specification (R2-8)
- The OpenTelemetry GenAI conventions **moved** to `open-telemetry/semantic-conventions-genai`. The old `docs/gen-ai/*.md` pages in `semantic-conventions` v1.45.0 (commit fb30ca17) are now a "Moved" stub, so they are not the pin.
- **Pin: `semantic-conventions-genai` tag `v0.1.0`, commit `d0e74ba6c48bcc4ded473b1828a8212f06b23753`** (published 2026-11-21), status of every page **Development**. Fetched 2026-11-22 with a generic client from public pages only (GitHub API for the tag and tree, raw.githubusercontent.com for the pages); nothing about the project was sent.
- Pages used and their SHA-256 (verbatim copies are in `web/docs/improve/phase2/otel-spec-v0.1.0/`, with `SOURCE.md`):
  - `docs/gen-ai/gen-ai-agent-spans.md` `0d2db04dd642e52c73eadf7b05b3ae1586d6ab99462c94a9c31e5cebff0e01ff`
  - `docs/gen-ai/execute-tool.md` `7a72f0d602c6d023944d1e43f54caba53b4eeb2987ac46f6c272746d526d15f3`
- `server/test/otel-mapping.test.ts` re-hashes the stored pages and re-parses their attribute tables against `server/src/otel/pinned.ts`, so an edit fails the suite.
- B5 is cited only as support for "record full traces", not for OpenTelemetry. A2A task states are not used.

## What was built
1. **Attribution (item 1).** Migration 0045 `failure_attributions` (append-only: update, delete and truncate refused, the one delete is the `axion.purge_demo` cascade; an insert trigger refuses a tag whose subject is not a task or task attempt with a recorded failure). `POST /failure-tags` takes an optional `attribution {agentId?, stepRef?, fullTraceAvailable?}`; new `POST /failure-tags/:id/attributions` adds another entry. A tag DTO carries `attributions[]` (oldest first) and `attributionDisagreements` = distinct (agent, step) targets minus one. A later entry never replaces an earlier one and there is no "current" field. Same person repeating the same entry is 409; a different entry is kept. Attribution by an agent uses the existing tagged-by kind (`attributed_by_kind` user or agent, `createAttribution` with `viewer: null`). Audited as `failure.attribute`, rate-limited in the proposals bucket, idempotent.
   - "Recorded failure" means: a task with status `failed` or any attempt with result `failed`, or an attempt whose result is `failed`. Missions and messages are refused (409 `ATTRIBUTION_NEEDS_FAILURE`), and a refused tag-with-attribution stores no tag.
   - UI: the Tag a failure dialog shows each entry (who, agent, step, "says the full trace is available") and "N different views". Display only; the writes are API-only (concern 2).
2. **Mapping table (item 2).** `web/docs/improve/phase2/otel-mapping.md`, generated from `server/src/otel/mapping.ts` and checked byte for byte by the test. 96 fields (every column of tasks, task_attempts, task_dependencies, agent_instances, mission_runs, eval_runs, eval_results, failure_tags, failure_attributions, plus the 7 trace step fields): 7 map to a pinned GenAI attribute, 25 are "no equivalent", the rest to a span property or an `axion.*` extension. The test compares the list with the real columns of the migrated schema (it caught three `eval_runs` columns added by c47 that I had missed).
3. **Export (item 3).** `npm run export:otlp -- <missionId> [--out FILE] [--tenant ID] [--include-content] [--force]` (CLI, no route). Spans are all INTERNAL: `axion.mission` root, `invoke_agent {agent}` per instance, task and attempt, `plan` and `execute_tool {tool}` per trace step of evaluation results linked to the mission through the agent version its instances pinned. Failure tags and attributions are span events. Content is off: `axion.*_ref` pointers (`axion://table/id#field`) replace titles, criteria, labels, notes and step text; `--include-content` writes text into the Opt-In attributes (or `axion.*`). `validateOtlp` checks every export against the pinned tables (the CLI refuses to write a file that fails it); an existing file is never overwritten without `--force`. People's ids are never exported.
4. **Contracts (item 4).** DTO (`FailureAttributionDto`, two fields on `FailureTagDto`), two error codes, registry entry, validator entries and a coverage-run call for the new route. No allowlist line (the first attempt needed two `never non-null` lines; instead the coverage run was changed to attribute at tag time and to attribute again after the decision, so the arrays are filled and the decided fields are non-null). These entries had to land with item 1 because the coverage run fails without them, so there is no separate item-4 commit (concern 1).

## RED / GREEN
Item 1 (RED, `npx vitest run test/failure-attribution.test.ts`, 11 of 11 failed on the unchanged code; load 22.4):
- `attribution on a tag > a tag made with an attribution stores one entry by the tagger; a tag without one has none`: `AssertionError: expected 400 to be 201` (unknown field `attribution`)
- `... > only the agent or only the step is enough; neither, ...`: `error: relation "failure_attributions" does not exist`
- `... > attribution is refused for a subject with no recorded failure, ...`: `AssertionError: task T-OK: expected 400 to be 409`
- `... > a failed attempt, or a task that failed once and then passed, counts as a recorded failure`: `expected 400 to be 201`
- `... > two people who attribute differently both stay on record, ...` and `... > the same target from a second person is an agreement ...`: `TypeError: Cannot read properties of undefined (reading 'id')`
- `... > visibility: ...`: `expected 404 to be 401`; `... > is audited, and an idempotent repeat stores one entry`: `expected 404 to be 201`
- `... > an agent may attribute through the internal path ...`: `TypeError: createAttribution is not a function`
- `the table is append-only and fail-closed > no update, delete or truncate; ...` and `... > a demo purge still removes them`: `error: relation "failure_attributions" does not exist`
- GREEN: 11/11. Also `failures.test.ts` 18/18 (its truncate test forced me to drop the foreign key from `failure_attributions.tag_id`, because a referenced table cannot be truncate-refused by its own guard; the insert trigger checks the tag instead) and `test/contracts` 15/15.

Item 2 (RED, `test/otel-mapping.test.ts`): `Error: Cannot find module '../src/otel/pinned.ts' imported from .../otel-mapping.test.ts` (whole file). GREEN: 8/8 (after the table-versus-columns test named the 3 missing `eval_runs` columns: `eval_runs.evaluator_id`, `eval_runs.judge_model_family`, `eval_runs.subject_proposal_id`).

Item 3 (RED, `test/otel-export.test.ts`): `Error: Cannot find module '../src/otel/export.ts' imported from .../otel-export.test.ts`. GREEN: 20/20, run twice. It covers: the default export validates against the pinned list and has **zero content attributes and none of the sentinel strings** (corrected in the Fix round: this held only for the fields the first sentinel test planted; the Fix round extends it to every free-text source field); pointers present; content mode carries the text and validates as a content export but fails as a default export; the validator is not vacuous (an unpinned `gen_ai.*` attribute, a wrong-span attribute, a missing Required attribute, a wrong span name, a foreign namespace, a dangling parent, end before start, a duplicate key and an Opt-In attribute in a default export are each rejected); every attribute that can be written is pinned or documented; no network module or fetch in `src/otel` or the CLI; no route mentions OTLP or export; database loading is one mission only and refuses unknown, other-tenant and deleted missions; the file is written, not overwritten without `--force`.

UI (RED, `api-c60.mjs` against the unchanged dialog): 8 of 10 checks passed (the API rules) and `FAIL the dialog shows both attribution entries and the count of different views`, then `TimeoutError: locator.innerText`; load 16. GREEN: 10/10.

Smoke of the real CLI: `npm run export:otlp` on the e2e database after the browser run wrote 12 spans for the seeded mission M-118, content off, and refused a second write without `--force`.

## Pass threshold
| Item | Result | Evidence |
|---|---|---|
| Item 1 attribution RED to GREEN | PASS | above; 11/11 |
| Item 2 mapping table RED to GREEN, pinned version and hash | PASS | above; v0.1.0, commit d0e74ba6..., two page hashes |
| Item 3 export RED to GREEN, no network, zero content by default, fixtures validate | PASS | 20/20 |
| Item 4 contracts, no allowlist lines | PASS (not its own commit) | registry, DTO, validators, error codes; `test/contracts` 15/15; `git diff` of `exercised.ts` and `allowlists.ts` is empty |
| Full server vitest | PASS | 72 files, 2153 tests passed with `--maxWorkers=1` (load 14.7). The first full run with the default 2 workers failed 173 tests, all from `too many connections for role "axion"` (33 errors, other lanes and my browser run were using the shared 45-connection role); nothing in them was related to this work |
| tsc (server and web) | PASS | both clean |
| Failure-tag api check (`api-c33.mjs`) | PASS | 41/41 |
| `api-stage6.mjs` | PASS | 94/94 on its own run. In the combined run it stopped at 40/41 with `TypeError: Cannot read properties of undefined (reading 'csrf')` (`/me` returned no `me` while the machine was short of connections); the immediate rerun alone passed 94/94, so I record it as a load flake, not a fix |
| `api-improve.mjs` | PASS | 107/107 |
| `api-c60.mjs` (new) | PASS | 10/10 |
| a11y (the UI changed) | PASS | `a11y-check.mjs` in api mode: 41 views, 65 dialogs, 0 violations (209 s, load about 10). Its `probe ... fail []` lines (pages of a mission id the api seed does not have) did not fail the run (exit 0); I did not check whether they pre-date this work. The new markup only exists when an attribution exists, which that script never creates; `api-c60.mjs` checks it in the browser (icons `aria-hidden`, text content) |

## Files changed
- new: `server/migrations/0045_failure_attributions.{up,down}.sql`, `server/src/otel/{pinned,mapping,export,cli,write-mapping-doc}.ts`, `server/src/cli/otlp-export.ts`, `server/test/{failure-attribution,otel-mapping,otel-export}.test.ts`, `web/scripts/api-c60.mjs`, `web/docs/improve/phase2/otel-mapping.md`, `web/docs/improve/phase2/otel-spec-v0.1.0/{SOURCE.md,gen-ai-agent-spans.md,execute-tool.md}`, this report.
- edited: `server/src/failures/{service,routes,taxonomy}.ts`, `server/src/ratelimit.ts`, `server/package.json` (script), `shared/contracts/src/{failures,errors}.ts`, `server/test/contracts/{registry,validators,coverage.test}.ts`, `web/src/dialogs/defs/failure-tags.tsx`.

## Lesson recorded (R2-10)
The literature on whether hierarchy helps multi-agent systems disagrees (it depends on the task and on model capability). AXION therefore records attribution evidence and holds no "hierarchy is better" belief. The stratified org-change comparison was dropped, as the verifier required.

## Concerns
1. Item 4 has no commit of its own: its entries are required by the coverage run the moment item 1 adds a DTO field and a route, so they landed in the item 1 commit (`9559b04`). The later commit `web: show failure attribution` carries the dialog, the browser check and the coverage-call tweak.
2. People cannot yet write an attribution from the UI (the dialog shows entries only). Writes are through the API or, for agents, the internal service function. A form is a small follow-up if wanted.
3. `agent_id` and `step_ref` are free text claims, not checked against stored agents or traces (a trace may name something no longer stored). "Full trace available" is the attributor's claim, not a verified fact; the UI words it as "says the full trace is available".
4. Stored traces are only the `steps` array of evaluation results, and the database requires nothing about a step. The exporter reads `kind` ("tool" or "plan"), `name`, `input`, `output`, `error`, `startMs`, `endMs`, and counts every step it cannot read in `axion.export.unmapped_steps` instead of dropping it silently. Evaluation results are not stored per mission: the export links them through the agent version pinned by the mission's instances, and results of version-proposal runs (no pinned version) are not exported. Per R2-8, "export only after traces exist in volume": traces are still rare, so this is a mapping and a tested exporter, not a claim of use.
5. The spec is in Development status and has already moved repository once. The pin and the generated table are the defence; moving to a newer version means updating `pinned.ts`, the stored pages and rerunning the tests.
6. The `agent_instances.agent_id` and `agent_version_id` use `axion.*` attributes because the pinned internal invoke_agent span has no `gen_ai.agent.id` or `gen_ai.agent.version` (they belong to create_agent and client invoke_agent spans); `gen_ai.provider.name`, `gen_ai.request.*` and `gen_ai.usage.*` are deliberately not used because no model call is recorded.
7. `failure_attributions.tag_id` has no foreign key (see RED/GREEN); the insert trigger checks that the tag exists and matches tenant and mission, and tags are append-only.
8. The e2e database axion_e2e14 holds the browser runs' data (the harness empties it on each start). No server of mine is running; ports 10990 to 10993 are free.

## Fix round (review S1, S2, S3, minors)

Corrections to two overclaims above: "no text from untrusted fields" in the default export was not true (attribution agent/step, task owner agent, attempt evidence ref, tool names and step errors leaked), and "read-only on the database" was true of the code only, not enforced, with the live database as the default. Both are now enforced and tested.

| Ruling | RED (on a025aa5 plus the new tests) | GREEN | Commit |
|---|---|---|---|
| S1 no free text in default export | 5 of 5 new S1 tests failed (e.g. `expected 'sk-TESTSENTINEL-owner' to be undefined`; `axion.task.owner_agent: expected false to be true`) | otel-export + otel-mapping 33/33 (S1 adds 5 tests; two older assertions changed to the new pointer behaviour, none loosened) | b6033cd |
| S2 licence | `ENOENT ... otel-spec-v0.1.0/LICENSE` | otel-mapping 9/9; Apache-2.0 LICENSE (sha256 c71d239d...) next to the pages, SOURCE.md states verbatim, The OpenTelemetry Authors, Apache-2.0, URL, commit; no THIRD_PARTY_NOTICES.md created | 7d271e0 |
| S3 database and read-only, plus minors | 7 failed (`Unknown option --database-url-env`, `withReadOnlySnapshot is not a function`, mode `420 vs 384`, missing `linked_by`) | otel-export, otel-mapping, failure-attribution, contracts: 66/66 | 64147e6 (S3 and the minors share one commit because they touch the same functions) |

What changed:
- S1: content fields (`attributed_agent_id`, `attributed_step_ref`, `task.owner_agent`, `attempt.evidence_ref`) give `_ref` pointers by default and the text only with `--include-content`. `error.type` is a fixed vocabulary (timeout, rate_limit, not_found, permission_denied, invalid_input, unavailable, cancelled, internal_error, plus task_failed/attempt_failed), else `_OTHER`. Tool names must match `^[A-Za-z][A-Za-z0-9_.]{0,47}$` and not look like a key (sk-, ghp, AKIA...), else `_OTHER` in span name and `gen_ai.tool.name`; the raw name is `axion.step.tool_name` only with content. Also sanitised the same way, as found: agent name (raw in `axion.agent.name_raw` with content), eval case id, dataset id, judge model family. Note: tool names with a hyphen become `_OTHER` by design. `validateOtlp` rejects the new content keys in a default export (tested per key).
- S3: `--database-url-env VAR` is required (refusal tested in-process and by spawning the CLI); reads run in one `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY` with `SET LOCAL default_transaction_read_only = on` (the CLI pool also sets it per connection); a write inside fails (tested); output says `from database "<name>"` only.
- Minors: file mode 0600 (also forced on an existing file with `--force`); symlink at `--out` refused with and without `--force` (lstat plus O_NOFOLLOW; victim file unchanged); `axion.export.linked_by = "agent_version"` on eval result spans; usage text says operator tool, tenant scope, no per-person visibility, and explains the agent-version linking; `ATTRIBUTION_HELP` (shared contracts, shown as the title of the "different views" chip) states no retraction, agent-only vs agent+step, exact-string comparison, and the 409 on a changed "full trace available" flag.

Verification after the fixes:
- server `tsc` and web `tsc`: clean.
- Full vitest through heavy.sh, default workers: 72 files, 2165 tests passed (the earlier run had 2153); no "too many connections" this time, so no `--maxWorkers=1` re-run was needed. Load average 16.7 to 17.4 throughout.
- Browser checks (`heavy.sh ./scripts/api-e2e.sh api-c33.mjs api-c60.mjs api-stage6.mjs`, ports 10992/10993): api-c33 41/41, api-c60 10/10, api-stage6 94/94 (all in one run). Load about 17.5. Ports 10990 to 10993 are free; no job of mine is running.
- Not re-run: a11y (the only UI change is the chip's hover title text).
