# c41 report: reviewed playbooks and a skill library (Phase 2, Wave 3, E4)

Lane w39, branch `c41-playbooks` (from improve-30h). Migration 0033. Ports 8990/8991/8992/8993, e2e DB axion_e2e13.
Records only: nothing executes, and no agent reads a playbook yet.

## What was built
- Migration `0033_playbooks` (up and down): `lesson_candidates`, `playbooks`, `skills`, each with its own guard trigger:
  - `playbooks` never changes; `lesson_candidates` is decided once (proposed to accepted, rejected or superseded); a `skills` row is approved once and retired once.
  - UPDATE, DELETE and TRUNCATE are guarded, with the `axion.purge_demo` exception for DELETE only.
  - Table checks:
    - `version = base_version + 1` (gap-free);
    - at least one source;
    - decider differs from proposer and submitter;
    - one approved skill per name.
- Server `server/src/agents/playbooks.ts` (routes `GET /agents/:id/playbook[/versions/:v|/diff]`, `GET /lessons[/:lid]`, `POST /agents/:id/lessons`, `POST /lessons/:lid/decision`, `POST /agents/:id/playbook/rollback`, `GET /skills[/:sid]`, `POST /skills`, `POST /skills/:sid/approve|retire`):
  - Propose and decide: any signed-in user proposes; administrators decide; the decider is never the proposer (403 `SELF_APPROVAL`).
  - Compare-and-set: accept and rollback take a per-agent advisory lock as their own statement, then compare `baseVersion` (409 `CONFLICT`).
  - Rollback adds a new version whose items are the target's stored items verbatim.
  - Contradictions: a deterministic check (`conflicts()`: same content keywords, exactly one text negated). Accepting a flagged lesson needs an `overrideNote` (409 with `fieldErrors.overrideNote`); the item is stored with `contradiction: true`, `contradicts: [ids]` and the note.
  - Expiry: `needsReReview` is computed in SQL against `current_date` (database clock); a past `reviewBy` at proposal is 422.
  - Skills: code-like text is 400 (`function`, `=>`, `eval`, `<script`, `${`, code fences, `exec(`, `require(`, `import x`).
  - Every write and every refusal on an existing record is audited; events carry ids only (lesson text and override notes stay in audit).
  - Rate limits and CSRF coverage: all six write routes are in `LIMITED_ROUTES` (proposals bucket) and in `SINCE_STAGE5_WRITES`. The security test's `LIMITED_KIND` regex and its expected list were extended, and a new test checks the 429.
- `proposeLesson()` is exported: an agent proposal (`kind: 'agent'`, `submittedBy` = the person who filed it). Neither can decide it, in the route or in the database. There is deliberately no agent route, because agents have no session.
- Web:
  - A "Playbooks and skills" panel (`features/agents/Playbooks.tsx`) in Agents › Development, in api mode and in demo mode (DEMO sample data, read only, DEMO tag). One panel with four views: Playbook, Candidates, History (diff and rollback), Skills.
  - Dialogs DL-92 lesson-propose, DL-93 lesson-decide, DL-94 playbook-rollback, DL-95 skill-propose.
  - Help entries (`help/pages/c41-playbooks.ts`) and `api/playbooks.ts`.
  - New events wired into `api/events.ts`.
  - Accept and Reject are disabled when the viewer is the proposer, with the reason and a `?` (`playbook.decider`).

## Rulings and visibility (fail closed)
- Administrators see every candidate and draft. Everyone else sees accepted lessons, approved or retired skills and their own proposals. Anything else is 404, both on reads and in lists.
- A `mission` source must be a mission the proposer can see (reuses `getVisibleRow`; otherwise 404). Only `mission` sources are existence-checked. `failure_tag` (c33), `review`, `task` and `note` are typed `{kind,id}` strings with no FK, because the c33 tables are not in this tree.
- `superseded` is set by the system (`decided_by = 'system'`) on other proposed candidates with identical normalised text when their twin is accepted.
- A duplicate of an item already in the playbook is 409 `DUPLICATE_PROPOSAL` on accept.

## RED / GREEN
- RED: with the playbook route registration disabled, `playbooks.test.ts` gave 27 failed and 3 passed (the pure helpers). Honest note: the server code was written before the test file in this lane, and the RED run was done by disabling the registration, not before writing the code.
- GREEN server: baseline before the change 37 files / 586 tests; after 39 files / 636 tests, all passed (`heavy.sh npx vitest run`). New: `playbooks.test.ts` 30 tests, `playbooks-migration.test.ts` 1, `security.test.ts` +1 and +6 routes × 3 CSRF/Origin checks. Server `tsc` clean. Web `tsc` clean.

## Pass threshold
| Item | Result | Evidence |
|---|---|---|
| candidate without sources is 400 | PASS | `playbooks.test.ts` "propose": missing, empty list, unknown kind, blank text, 601 characters, each 400 `VALIDATION`; nothing stored |
| proposer deciding is 403 | PASS | 403 `SELF_APPROVAL` for accept and for reject (audited as denied); the agent-proposal case (agent, filer) is also refused in the route and by the database; a member is 403 |
| accept gives a new playbook version, gap-free under 10 concurrent accepts (CAS) | PASS | test A: 10 concurrent accepts on one base: exactly 1 returns 200, 9 return 409, versions `[1]`, 9 candidates still proposed. Test B: 10 concurrent accepts that retry on 409: all 10 succeed, versions 1..10 with `base_version` 0..9, the tip holds all 10 lessons once |
| rollback creates a new version equal to the target's items | PASS | v4 `items` deep-equals v1 `items`; versions 1..3 unchanged; refusals: stale base 409, current 422, unknown 404, same items 422, none yet 422, member 403 |
| contradiction detected on fixtures, needs an override | PASS | 4 positive and 4 negative fixture pairs; accept without a note 409 and still proposed; with a note the item has `contradiction: true`, `contradicts`, `overrideNote` |
| code-like skill steps are 400 | PASS | `function`, `=>`, `eval` (description), `<script` (name), `eval` in a precondition: each 400 with a field error, nothing stored |
| append-only holds | PASS | update, delete and truncate refused on all three tables; decided, retired and approved-by-proposer updates refused; a hand-inserted gap version refused; purge flag allows DELETE only (rolled back in the test); `clearDemo` still works and leaves the tables alone |
| another tenant's or an invisible record is 404 | PASS | t-2 lesson, skill and agent: 404 for administrators and a member on reads, decisions, rollback and propose; another member's proposed lesson 404; a draft skill 404; a private mission source 404 |
| `api-c41.mjs`: propose as B, accept as A, new version and diff, roll back, version after that | PASS | 43/43: B proposes through DL-92; B's Accept is disabled with the reason and `?`; A accepts through DL-93 (v1), a second lesson gives v2, History plus Diff, A rolls back to v1 through DL-94 and History shows v3 "rollback to v1"; also the contradiction override, skill propose and approve, member read-only |
| server tsc and vitest green | PASS | 39 files, 636 tests passed |
| web tsc | PASS | clean |
| api-flows and api-stage6 | PASS | api-flows 23/23, api-stage6 94/94 (same run as api-c41) |
| a11y | PASS | demo: 50 views, 60 dialogs, 0 violations; api mode: 40 views, 60 dialogs, 0 violations |
| dialog ledger | PASS | DL-92..95 added to `docs/dialog-ledger.txt`; dialog smoke 60 dialogs × 2, 0 failures; DL-92 and above were free in all AXION-w* trees at the time of writing |
| fit-check ALL FIT | PASS | `fit-check.mjs`: 77 views ok, 0 BAD, "ALL FIT" |

`verify-all` on the dev server (port 8990): ALL 10 STEPS PASSED; grep for FAIL in the log is 0 (crawl: 77 views, NO PROBLEMS). No threshold item is NOT MET.

## Screenshots
`web/docs/screenshots/improve-c41-playbook-dark.png`, `improve-c41-history-dark.png` (api mode, committed). Run-time shots, not committed: `/tmp/axion-api-c41-8993/` (dialog propose, override dialog, history diff, skills), `/tmp/w39-shots/` (demo mode panel, Candidates, History, Skills).

## Files changed
- Server: `server/migrations/0033_playbooks.{up,down}.sql`, `server/src/agents/playbooks.ts`, `server/src/app.ts` (register), `server/src/ratelimit.ts` (six routes), tests `playbooks.test.ts`, `playbooks-migration.test.ts`, `security.test.ts`.
- Shared: `shared/contracts/src/playbooks.ts` (new), `index.ts` (export), `events.ts` (five event types).
- Web:
  - `src/api/playbooks.ts`, `src/data/playbooksDemo.ts`, `src/features/agents/Playbooks.tsx`, `src/dialogs/defs/playbooks.tsx`, `src/help/pages/c41-playbooks.ts`;
  - `src/api/events.ts` (+6 lines, all new lines), `src/features/agents/VersionProposals.tsx` (+2) and `src/pages/Agents.tsx` (+2) to mount the panel;
  - `scripts/api-c41.mjs`, `docs/dialog-ledger.txt`, screenshots.
- No raw inserts into the new tables exist in `server/scripts` or fixtures; `scale-bench.ts` is unaffected.

## Concerns
1. **Single-administrator case is dormant, as in earlier waves.** With one administrator who proposes, nobody can decide. The UI shows the disabled buttons and the reason, and the help says so, but the rule only bites with a second human admin. The e2e check and tests create one.
2. **Agents cannot propose through any route**: there is no agent identity or session yet. `proposeLesson(kind: 'agent')` is a service function used by tests and by a future runtime. Its `submittedBy` person is also barred from deciding.
3. **Contradiction check is simple by design**: it can miss paraphrases and can flag sentences that share keywords but differ in scope. The reviewer still decides, and the override note records the reasoning. Stopwords, negations and stemming are fixed lists in `playbooks.ts`.
4. **Code-like check also refuses the plain word "function"** in any skill text (for example "check the function of the toggle"), as the brief specifies. The error message explains it.
5. **Merge hot spots**: `shared/contracts/src/events.ts`, `server/src/app.ts`, `server/src/ratelimit.ts`, `web/src/api/events.ts`, `web/src/pages/Agents.tsx`, `docs/dialog-ledger.txt` (regenerated by dialog smoke) and `security.test.ts` (shared lists). My edits are additive, new lines only where possible. Re-check DL-92..95 at merge (w41 is also running).
6. The migration number 0033 leaves a gap in this tree (0024–0032 live in other lanes); `migrate` sorts by version, and `playbooks-migration.test.ts` goes up to 32, inserts data and applies 0033 then down.
7. The harness reminder asked for a different `Co-Authored-By` model name than LANES.md and the task. I used the task and LANES.md line (`Claude Opus 5.5`), as the task instructed.
8. The 10-concurrent test needs the pool not to starve: handlers never query `app.db` inside a transaction. The test lifts the proposals rate limit, as `version-proposals.test.ts` does.
9. Not checked: preview build (port 8991) was not run; `verify-all` runs a production build step and passed.
