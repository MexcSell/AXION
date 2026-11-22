# c39 report: mission ledgers (Phase 2 · Wave 3 · O1)

Lane w37, worktree `/home/luca/AXION-w37`, branch `c39-mission-ledgers` (from `improve-30h`). Brief: `c39-brief.md`. Migration 0032.

## Source check
Magentic-One, Fourney et al., arXiv 2411.04468 (https://arxiv.org/abs/2411.04468, HTML version read). Confirmed from the paper:
the Orchestrator's **task ledger** holds given or verified facts, facts to look up, facts to derive, educated guesses, and a plan;
its **progress ledger** answers five questions each step (request satisfied? looping? forward progress? who speaks next? what
instruction?); a **stall counter** rises on a loop or no progress, and once it passes a threshold (2 in the paper's runs) the
Orchestrator reflects, updates the task ledger and re-plans. AXION uses that structure with its own field names and wording
(`given / to_look_up / to_derive / guesses`, `steps`, `satisfied / looping / progressing / next_speaker / next_instruction / notes / stall`),
attributed in the help texts, the code comments and a link on the tab ("after Magentic-One").

Frozen policy (`STALL_POLICY`, `Object.freeze`): stalled after **3** consecutive non-progressing check-ins (the paper's "counter above 2")
or **2** looping check-ins in a row. A satisfied latest entry ends a stall. In AXION a stall only flags the mission; a person decides.

## What was built
- Migration `0032_mission_ledgers`: `mission_ledgers(id, tenant_id, mission_id FK on delete cascade, kind, version, body jsonb, author_id, author_kind, created_at, demo)`,
  `unique (mission_id, kind, version)`, checks on kind, version >= 1, body is an object under 64 kB, author_kind.
  Append-only: UPDATE and DELETE row guard plus a TRUNCATE statement guard; the only allowed delete is the `axion.purge_demo` cascade (clearDemo).
- `shared/contracts/src/ledgers.ts`: types, limits, frozen policy, pure `stallCheck` and `diffLedgers`; `ledger-demo.ts`: the DEMO sample builder (used by the server seed and demo mode).
- `server/src/missions/ledger-schema.ts` (strict zod, bounded) and `ledger-routes.ts`:
  `GET /missions/:id/ledgers`, `GET /missions/:id/ledgers/:kind/:version`, `POST /missions/:id/ledgers/:kind` (`{baseVersion, body}`).
  Writes: humans only (mission owner or administrator, 403 otherwise), 404 for invisible missions, 400 with `body.<path>` field errors, 409 `LEDGER_CONFLICT`
  on a stale or future `baseVersion`, 409 on an archived mission. The next version is assigned while the mission row is locked
  (`getVisibleRow(..., lock=true)`), so versions are gap-free; the unique key is the backstop. The server computes the progress ledger's `stall`
  (a client sending `stall` gets 400). Audited (`mission.ledger`), emits `ledger.updated` to the mission audience, rate-limited in the proposals bucket
  (`LIMITED_ROUTES`, and the route-table test now also matches `/ledgers/`).
- DEMO: `seedDemo` adds sample ledgers (`demo=true`, author `system`, "DEMO sample" text) to demo missions only; stuck demo missions get a 3-entry stalled history.
- UI: new **Ledger** tab on the mission workspace (icon ScrollText): facts in four groups, plan steps with status chips, progress strip (three flags, stall badge, next speaker, instruction, notes),
  History with kind switch, From/To selectors, version list and a diff; DEMO tag; `?` help on every block; Edit and Check in buttons (disabled for people who cannot edit, with a tooltip).
  Edit dialog `ledger-edit` (DL-91): facts one per line (` | source`), step rows, flags and notes; Save is off until something changes; **409 handling**:
  "Load their version (drop my edit)" or "Save mine as the next version" (it replaces their changes in the new version; theirs stays in History; it is not a merge, and the dialog says so).
  Escape and Cancel close it. Demo mode shows the sample read only. Live: `ledger.updated` re-reads (api/events.ts).

## RED / GREEN
- RED: `server/test/c39-ledgers.test.ts` written first; first run failed at import (`shared/contracts/src/ledgers.ts` did not exist): "Test Files 1 failed, no tests".
  After the implementation it failed once on my own wrong expectation (`[LOOP, NOPE, LOOP]` is stalled by the 3-entry rule), fixed in the test, not the policy;
  and once on the shared rate limit (the 10-writer retry test exceeded 30 writes per minute), fixed by giving the test app a bigger budget plus a separate test that the limit applies.
- GREEN: server `npx tsc --noEmit` clean; `heavy.sh npx vitest run`: **38 files, 607 tests passed** (24 of them in c39-ledgers.test.ts). Web `tsc --noEmit` clean.

## Pass threshold
| Item | Result | Evidence |
|---|---|---|
| Version numbers gap-free under 10 concurrent writers | PASS | test: 10 writers retrying on 409 get exactly 1..10, db rows 1..10; second test: 10 writers on one baseVersion = 1x201 + 9x409, one row |
| Stale baseVersion gets 409 | PASS | stale and future base both 409 `LEDGER_CONFLICT`, row count unchanged |
| Invalid body gets 400 with paths | PASS | `body.facts.given.0.text`, `body.steps.0.id`, `body.steps.0.status`, unknown keys, duplicate step ids, over-long text, 31 facts, client-set `stall`, missing baseVersion |
| Invisible mission gets 404 | PASS | read, version read and write 404 for a private mission of another user, unknown id, malformed id; member on a visible shared mission gets 403 on write |
| Append-only holds | PASS | UPDATE, DELETE, TRUNCATE refused; duplicate version, bad kind, non-object body, version 0 refused; clearDemo removes only demo ledgers and keeps a real mission's ledger |
| stallCheck known-answer fixtures | PASS | 7 fixture tests (empty, healthy, reset, exactly N, looping x2, loop+progress contradiction, satisfied) plus diffLedgers fixtures |
| Browser check `web/scripts/api-c39.mjs` | PASS | **31/31**, no page errors: open ledger, edit (Escape and Cancel exits tested), v1, v2, diff, second session saves v3 so A's save shows the conflict UI, both resolutions, stall badge after 3 check-ins, member read only, DEMO label. Re-run after the last CSS tweak: 31/31 |
| Server tsc and vitest green; web tsc | PASS | 607 tests; both tsc clean |
| api-flows and api-stage6 | PASS | api-flows 23/23, api-stage6 94/94 (same run as api-c39), no page errors |
| a11y clean | PASS | demo: 51 views, 57 dialogs, 0 violations; api: 41 views, 57 dialogs, 0 violations |
| Dialog ledger | PASS | dialog smoke 57 dialogs x 2 = 114 checks, 0 failures (`ledger-edit` DL-91 added to `web/docs/dialog-ledger.txt`); dialog ids and help keys all defined |
| fit-check ALL FIT | PASS | 78 views `ok`, `ALL FIT` (Ledger tab: mainOver 0, one screen) at 1672x941 |
| verify-all | 9 of 10 steps PASS; `flows` FAILED once | see concerns: 2 timeouts under machine load (load average about 11), passed 21/21 with 0 FAIL when rerun alone; crawl 78 views and deep crawl NO PROBLEMS, auth flow, u1 flows, dialog smoke, dialog ids, help keys, fs-guard PASS |

NOT MET: none of the fixed threshold items. The single non-green line is the first `verify-all` `flows` step (below).

Counts of the word FAIL: api e2e log 0; a11y demo 0; a11y api 0; fit-check 0; verify-all log: 2 `FAIL` lines (both in the first `flows` run: "u1 · News: post news, it appears for everyone: waitForSelector Timeout 4000ms" and "u1 · Chat dock: GM answers: click Timeout 30000ms"); rerun of `flows.mjs` alone: 21 PASS, 0 FAIL.

## Screenshots
`web/docs/screenshots/improve-c39-ledger-dark.png` (api mode, real mission: v5 task ledger, stalled badge, history), `improve-c39-conflict-dark.png` (conflict UI in the Edit dialog),
`improve-c39-demo-sample-dark.png` (demo mode sample with DEMO tag and stalled progress).

## Files changed
- New: `server/migrations/0032_mission_ledgers.{up,down}.sql`, `server/src/missions/ledger-routes.ts`, `server/src/missions/ledger-schema.ts`, `server/test/c39-ledgers.test.ts`,
  `shared/contracts/src/ledgers.ts`, `shared/contracts/src/ledger-demo.ts`, `web/src/api/ledgers.ts`, `web/src/features/mission/LedgerTab.tsx`, `web/src/dialogs/defs/ledger-edit.tsx`,
  `web/src/help/pages/c39-ledgers.ts`, `web/src/theme/pages/c39-ledgers.css`, `web/scripts/api-c39.mjs`, 3 screenshots.
- Edited: `server/src/app.ts` (register), `server/src/ratelimit.ts` (+1 route), `server/src/seed/demo.ts` (sample ledgers), `server/test/security.test.ts` (route-table pattern and expected list extended),
  `shared/contracts/src/{index,errors,events}.ts` (`LEDGER_CONFLICT`, `ledger.updated`), `web/src/api/events.ts`, `web/src/config/nav.ts` (+Ledger tab), `web/src/pages/Missions.tsx`,
  `web/scripts/a11y-check.mjs` (tab list), `web/docs/dialog-ledger.txt` (regenerated by dialog smoke).

## Concerns
1. **Port 8790 was not free**: an unrelated process (`video_chat_extension/server/.venv python server.py`, pid 47920) listens on 8790. I did not touch it; my dev server ran on **8794** instead (stopped by port afterwards). Lane ports for w37 should be re-checked.
2. **verify-all `flows` flake under load**: two timeouts while the machine was at load about 11 (other lanes); clean on rerun. Not caused by this change (it does not touch News or the chat dock), but it is a flaky pair worth a hardening pass (fixed 4 s waitForSelector in a News flow).
3. **"Save mine as the next version" is not a merge**: it replaces the other session's changes in the new version (theirs stays in History). The dialog says so. A field-level three-way merge is a possible follow-up.
4. **Writes use the shared `proposals` rate bucket** (30 per minute per session), as other governance writes do. Fine for people; an agent writer later may need its own bucket.
5. **Agents cannot write ledgers yet** (humans only, as briefed); `author_kind` already allows `agent` and `system`.
6. **Stall counter window**: the server counts over the last 50 progress entries (counter caps at 50).
7. **demo missions seeded in an existing database** get no ledger until `seedDemo` creates new missions (idempotent seed skips existing missions); the e2e and fresh demo seeds are fine. Existing DEMO rows would need `demo:clear` then `demo:seed`.
8. The final CSS tweak (3 px padding on the step list so the first row is not clipped) came after the a11y and fit runs; api-c39 was re-run afterwards (31/31). It is padding inside a dialog scroll box only.

## Fix round (review c39-review.md: I1, I2, M1 to M4, dialog id)
Test-first: the new tests (size, pagination and cap, lock order, own bucket) failed before the changes (4 of 27 red), then went green.
- **I1**: both body schemas refine the total serialized size in UTF-8 bytes (`LEDGER_LIMITS.bodyBytes` = 49,152, below the 64 kB database CHECK). Over the limit: 400 with `fieldErrors.body` ("Ledger is too large ..."). Test: a maximal body of 3-byte characters (120 facts) gets 400; a 45,000-byte multi-byte body is saved and its `pg_column_size` is under 65,536.
- **I2**: the version lists select metadata only (no `body`) and are keyset pages, newest first, at most 100. `GET /missions/:id/ledgers` returns the first page plus `moreVersions` cursors; new `GET /missions/:id/ledgers/:kind/versions?before=&limit=` returns `{versions, next}` (limit clamped to 100, bad `before` is 400, invisible mission 404). The History panel has "Load older versions". Cap of 500 versions per kind: 409 `LEDGER_VERSION_CAP` with a clear message; the cap is per kind. Test: 500 rows, pages of 100 walked to exactly 500..1 without gaps or duplicates, then the 501st write is refused.
- **M1**: the conflict banner lists what the other session changed (diff of the version I started from against theirs, first 8 lines) before the buttons. api-c39 checks it.
- **M2/M3**: envelope and body are validated before the transaction; inside it visibility is checked first, then permission, and only then the mission row lock (status re-read under the lock). Test: a malformed body (400), a non-manager (403) and an invisible mission (404) never take the lock, and a writer still succeeds.
- **M4**: ledger writes have their own `ledgers` bucket (30 per minute, same as proposals); the route-table test still requires the route in `LIMITED_ROUTES`. Test: after the ledger budget is exhausted (429) a version-proposal write is not 429.
- **Dialog id**: renumbered DL-78 to **DL-91** (DL-78 is c33's, DL-90 is c36's; no DL-91 in w31, w34 or this tree). `web/docs/dialog-ledger.txt` regenerated by the dialog smoke.

Counts: server tsc clean; web tsc clean; full vitest **38 files, 610 tests passed** (27 in c39-ledgers.test.ts); api-c39 **32/32** and api-flows **23/23**, no page errors, 0 FAIL; dialog smoke 57 dialogs x 2 = 114 checks, 0 failures (`ledger-edit` DL-91). Dev server (port 8794) stopped by port.
