# c59 report: origin-bound memory and skill records (Phase 2, Wave 6, R2-5)

Lane w58, branch `c59-origin-records` (from improve-30h at 5b3e32b). Migration 0044. Ports 10890-10893, e2e DB axion_e2e17.
Records only: nothing executes, no agent reads a playbook or a skill, and importing external skills stays out of scope. The "origin
never rises" rule is **our own design, tested by our own tests**; the single-author preprint behind it (C6) reported a 0% figure that is
not quoted here and not relied on.

## What was built (on c41's `trust`, `sources` and tables, no parallel structure)
1. **Origin class.** `lesson_candidates` and `skills` each record `origin_channel` (human_entry, agent_output, tool_output, derived) and
   `origin_class` (tool, agent, human).
   - Ruling, one total order: **tool < agent < human** (constants `ORIGIN_CLASSES`, `originRank` in `shared/contracts/src/playbooks.ts`).
   - The server sets the channel from the code path, never from a body (the `.strict()` schemas 400 any attempt; tested for lessons and skills).
     Person routes can only write human_entry, or derived when they cite records. The exported writers `proposeLesson` and `proposeSkill` are
     agent-side only: they refuse `kind: 'human'` with `ORIGIN_NOT_ALLOWED`, and the routes use internal writers (`insertLesson`, `insertSkill`).
   - New source kinds `lesson` and `skill` let a record cite other records. **Any record that cites a lesson or skill is derived**, whichever channel
     the writer named. Its class is the weakest cited record, capped by the writer's own class (an agent_output summary is never above agent, a tool_output
     one never above tool). Sources that are not records (mission, review, task, note) carry no class and are not counted. A person cannot cite a record
     they cannot open (404). Review (accept, approve, rollback) never changes the class.
   - The database holds the same rules: CHECK constraints (channel fixes class; agent-kind or filed-on-behalf rows are never human), an insert trigger
     (derived needs existing record sources and a class no higher than the weakest; a non-derived row with record sources is refused; defaults fill so
     raw inserts in older tests still work), and the replaced c41 guards cover the new columns (a raw UPDATE cannot raise a class, also on decided rows).
   - Playbook items are immutable, so their origin is read from the lesson row on every read (lowest class if the row is gone).
2. **Contribution log.** `record_contributions`, append-only (UPDATE, DELETE, TRUNCATE refused, `axion.purge_demo` exception for DELETE only,
   clearDemo tested), written in the same transaction as every change: propose (person or agent), accept, reject, system duplicate close, rollback
   (withdrawn and restored), skill propose, approve, replaced, retired, retirement_kept. Timestamps are DB `now()`. `GET /lessons/:lid/contributions` and
   `GET /skills/:sid/contributions` follow the record's visibility (404 otherwise; members get no notes and no source ids unless they proposed it).
3. **Active cap.** `ACTIVE_CAP_REACHED` (409) on accept, and on a rollback that would activate more items than the cap, inside the existing playbook lock
   and through `refuse()` (audited, no version, no log line). Operator setting `playbookActiveCap` (env `PLAYBOOK_ACTIVE_CAP`, default 25, whole number 1..200),
   never a route. The UI shows "active N of CAP" with a `?`, and disables Accept at the cap with the reason (the server still decides).
   - Ruling: playbooks are keyed by agent (c41) and one active agent holds a role, so the cap is **per playbook**. Skills have no role and are **not capped**
     (raised under concerns).
4. **Retirement proposals (fixture-only).** `skill_outcomes` is append-only and accepts only `source = 'fixture'`; only `recordFixtureOutcome` writes it (no
   route, no job). Proposals are **derived on read** (never stored): an approved skill whose latest score is below the floor 0.4 with n >= 5 and not
   dismissed for that score. A person retires through the existing retire route or keeps it through `POST /skills/:sid/retirement-dismiss` (logged). The strip
   always says "fixture only" and "no outcome data yet".
5. **Contracts.** Registry, DTO and validator entries for all four new routes and every new field; the coverage flow fills every new array and nullable
   field (tool-channel item, derived item, accept note, version, fixture score). `allowlists.ts` and `exercised.ts` are untouched: **no new allowlist lines**.
   The dismiss route answers `{ok:true}` precisely so it needs none. New write route is in `LIMITED_ROUTES` and the security test lists.

UI (Agents > Development > Playbooks and skills, existing four views): origin chip on items, candidates and skills; cap chip with `?`; Log per record with
`?`; retirement strip with `?`; lesson/skill source kinds in DL-92 and DL-95 with a "derived" note. No new dialog (no DL number used). Help page
`web/src/help/pages/c59-origin.ts`. Demo samples carry the new fields.

## RED / GREEN (one commit per item; loads are /proc/loadavg at the RED run)
Honest notes: the migration and server code for item 1 were drafted before its test file, so in item 1's RED run migration 0044 already existed (3 of 12
tests passed for that reason or because `.strict()` already refused body keys). Item 4's first RED is a missing module; a named RED was then made by
disabling `retirementRoutes` registration (as c41 did). Item 5's contract RED shows the 4 inventory failures; its coverage failure listed three 500s on
`/company/scorecard` and `/throughput`, which were database-connection exhaustion on the shared machine, not the change.

| Item | RED (test, first error line) | Load | GREEN |
|---|---|---|---|
| 1 origin | 9 of 12 failed in `c59-origin.test.ts`, first: "a person entering a lesson through the route is human_entry / human": `AssertionError: expected { …(25) } to match object { originChannel: 'human_entry', …(1) }` | 11.29 | 91 passed (c59-origin + playbooks + playbooks-migration), c35ee39 |
| 1 follow-up (review fix) | 3 failed: "an agent-side write that cites a lower record is derived and capped…": `expected { ch: 'agent_output', cl: 'agent' } to deeply equal { ch: 'derived', cl: 'tool' }`; "the database refuses a non-derived row that cites a lesson or skill": `promise resolved … instead of rejecting`; "the exported writers refuse kind human": `promise resolved … instead of rejecting` | 10.44 | 128 passed across the five c59/c41/contracts files, a6b1615 |
| 2 log | 7 of 7 failed in `c59-contributions.test.ts`, first: "propose, accept…, reject": `TypeError: Cannot read properties of undefined (reading 'map')` | 12.52 | 97 passed, ad7f7b3 |
| 3 cap | 5 of 5 failed in `c59-cap.test.ts`, first: "defaults to 25…": `TypeError: activeCapOf is not a function` | 15.83 | 102 passed, 9580d15 |
| 4 retirement | no tests: `Error: Cannot find module '../src/agents/retirement.ts'`; then with registration disabled 7 of 8 failed, first: "says so explicitly: dataState none…": `expected { code: 'NOT_FOUND', …(3) } to deeply equal { floor: 0.4, minN: 5, …(2) }` | 13.88 / 12.27 | 8 passed, a611143 |
| 5 contracts | 4 failed: `inventory.test.ts` "every registered route has a contract entry…": `"GET /lessons/:lid/contributions: registered but has neither a contract entry nor an explicit exclusion"` (4 routes), and its RED-proof twin; `coverage.test.ts` "nonvacuous…" and the infra 500s above | 20.38 | 23 passed (contracts + c59-retirement), 58c645b |

Between commits 2 and 5 the contract suite is red by design (new routes without entries); commit 5 closes it. Commit 1 compiles (validators for its fields).

## Pass threshold
| Item | Result | Evidence |
|---|---|---|
| Items 1-5 RED to GREEN | PASS | table above; every channel (human_entry, agent_output, tool_output, derived) and a 3-level chain (tool, agent-derived, person-derived with a human source, person-derived: stays tool; also a skill and a skill-of-skill) in `c59-origin.test.ts`; 100% of the tried attempts to make an agent-side write human are refused (service, 2 filer variants, 4 raw-SQL channel/class pairs, skills) |
| Every c41 test passes unchanged | PASS | `playbooks.test.ts`, `playbooks-migration.test.ts` and `api-c41.mjs` have no diff; all pass (api-c41 45 passed, 0 failed). No test was loosened or tightened |
| Full vitest and tsc | PASS | server and web `tsc --noEmit` clean. **Serial** (`heavy.sh npx vitest run --no-file-parallelism`, load 14.34): 73 files, **2152 passed**, 366 s. The plain command (parallel, load 12.30): 22 failed, 2126 passed, in files this lane does not touch (approval-binding 5, auth 1, c11-staffing-org 3, c48-can-decide 2, direct 18, instances 2, jobs 2, seed 2, counted per failure line), all with `error: too many connections for role "axion"` or `admin connect failed … INTERNAL`: connection exhaustion by other lanes. The same files passed in the serial run. An earlier plain run, taken while migration 0044 was being written, is invalid and not cited |
| api-c41, stage6, improve | PASS | `heavy.sh ./scripts/api-e2e.sh api-c41.mjs api-stage6.mjs api-improve.mjs` (ports 10892/10893, no cap env): 45/45, 94/94, 107/107; 3 m 52 s at load 14.8 |
| api-c59 (new) | PASS | 26 passed, 0 failed (`PLAYBOOK_ACTIVE_CAP=3`, 1366x768): origin chips, body-smuggling 400, derived record, member cannot cite an invisible lesson, cap chip and disabled Accept with `?`, 409 `ACTIVE_CAP_REACHED`, Log, retirement strip, Keep, re-proposal, Retire |
| verify-all 10/10 | PASS | own OUT `/tmp/axion-verify-w58`, dev server on 10890: "ALL 10 STEPS PASSED", 0 FAIL lines, 79 views crawled; 20 m 38 s at load about 15 |
| fit-check | PASS | "ALL FIT", 79 views at 1366x768 and at the default 1672x941, 0 BAD |
| a11y | PASS | demo: 51 views, 65 dialogs, 0 violations; api mode: 41 views, 65 dialogs, 0 violations |
| Migration on pre-existing decided rows, down restores guards | PASS | `c59-origin.test.ts` migration test: rejected, proposed and retired agent rows backfilled despite the c41 guard, guards live again, `down` restores both 0033 guard bodies (md5 of `pg_get_functiondef` equal), up again |
| No new allowlist lines | PASS | `allowlists.ts` and `exercised.ts` untouched |

## Files changed
- Migration: `server/migrations/0044_origin_records.{up,down}.sql`.
- Server: `server/src/agents/origin.ts`, `contributions.ts`, `retirement.ts` (new); `playbooks.ts`, `app.ts`, `config.ts`, `ratelimit.ts`, `cli/e2e-serve.ts` (reads `PLAYBOOK_ACTIVE_CAP`).
- Shared: `shared/contracts/src/playbooks.ts`, `errors.ts` (`ACTIVE_CAP_REACHED`, `ORIGIN_NOT_ALLOWED`).
- Tests: `c59-origin`, `c59-contributions`, `c59-cap`, `c59-retirement` (new); `contracts/{registry,validators,coverage.test}`, `security.test.ts` (route lists only).
- Web: `features/agents/OriginRecords.tsx` (new), `Playbooks.tsx`, `dialogs/defs/playbooks.tsx`, `api/playbooks.ts`, `data/playbooksDemo.ts`, `help/pages/c59-origin.ts`, `scripts/api-c59.mjs`.
- Screenshots (1366x768, api mode): `web/docs/screenshots/improve-c59-{candidates,cap,playbook,retirement}.png`.

## Concerns and open decisions for the controller
1. **Cap is per playbook, skills are uncapped.** The brief says per role; playbooks are keyed by agent. If you want a role-wide count across agents sharing a role string, or a cap on approved skills, say so.
2. **Cap value 25 is a choice**, an operator setting; no source gives the number.
3. **Origin order and non-record sources.** A person who types an agent's text by hand into a new lesson (human_entry, no record source) is undetectable; the rule governs recorded links only. Non-record sources (mission, review, note) carry no class.
4. **Migration number.** 0044 assumes 0040-0043 land first; the migration test uses `migrate(...,'up',43)` so it works either way. I edited 0044 in place after its first commit (not yet merged anywhere).
5. **Shared-machine flakiness.** Parallel vitest fails on connection exhaustion at the current load; the serial run is the authoritative one. LANES.md says nothing about `--no-file-parallelism`; you may want it for heavy lanes.
6. **No agent runtime exists**, so agent_output and tool_output records can only be created by service functions in tests and fixtures; the browser check seeds one with psql (like the skill outcome scores).
7. **Contract suite red between commits 2 and 5** (design of per-item commits); squash if you prefer.
