# c33 report: failure-mode tagging with the MAST taxonomy (Phase 2 · Wave 2 · E3)

Lane w31, branch `c33-failure-tags` (from `improve-30h`), migration 0028. Ports 8190/8191/8192/8193, e2e DB `axion_e2e5`.

## What was built
- **Taxonomy** (`shared/contracts/src/failures.ts`, re-exported frozen by `server/src/failures/taxonomy.ts`): 3 categories, 14 modes, version `mast-arxiv-2503.13657v3`. One literal copy; the server, the dialog and the help entries all read it.
- **Migration 0028** `failure_tags`: columns as briefed plus `mission_id` (FK, `on delete cascade`). Reason: `subject_id` is polymorphic and cannot cascade, and every subject resolves to one mission, which carries visibility, the DEMO flag, the event audience and the demo purge. Trigger `failure_tags_guard`: TRUNCATE refused; DELETE refused except under `axion.purge_demo` (the clearDemo cascade); the only UPDATE allowed is `proposed -> confirmed|rejected` once, filling `decided_by`/`decided_at`, every other column immutable (`is distinct from`). Partial unique index: the same mode cannot be proposed/confirmed twice on one subject (a rejected tag may be made again).
- **Server** (`server/src/failures/{service,routes}.ts`): `POST /failure-tags` (Idempotency-Key), `POST /failure-tags/:id/decision`, `GET /failure-tags?subjectKind&subjectId` (tags + `subject {missionId, demo, failed, retried}`), `GET /company/failure-modes?window=7d|30d|90d&includeDemo=0|1`. Both POSTs are in `LIMITED_ROUTES` (proposals bucket); the c14 route-table test pattern was widened to `failure-tags` (it fails without the map entries). Events `failure.tagged` / `failure.decided` carry `missionId`, so the audience is `mission` (visibility-filtered); both audited (refused decisions too).
- **Web**: "Tag failure" button in the task dialog (DL-13) for failed tasks and for retried ones (the server says `retried`: `retry_ready` or more than one attempt, because the web maps `retry_ready` to "queued"). New dialog DL-78 (`web/src/dialogs/defs/failure-tags.tsx`): category list, mode list with a `?` per mode (the paper's definition, quoted), optional note, the existing tags with status and Confirm/Reject, and a counts row (n, per category, per chosen mode). Demo mode shows two labelled DEMO samples and a banner; nothing can be tagged. Live refresh through `failure.*` in `api/events.ts`.

### Reading of the lifecycle (decision for the controller)
Every tag, human or agent, starts `proposed`. A person confirms or rejects it once; only `confirmed` tags are counted (proposed ones are reported beside n, not in it). This is what makes "tag one, confirm it, count goes to 1" and "double decision -> 409" both true. Any signed-in person who can see the mission may decide, including the tagger; there is no self-approval block (unlike version proposals) because the person is the human check on an agent's label, and a one-person e2e must work. The route cannot create an agent tag (no agent API exists); agent tags go through `createTag(... taggedByKind:'agent')`, tested.
The window places a tag by its creation time (not decision time).

## Taxonomy source (fetched, not from memory)
Source: Cemri, Pan, Yang, Agrawal et al., "Why Do Multi-Agent LLM Systems Fail?", **arXiv:2503.13657v3** (26 Oct 2025), https://arxiv.org/abs/2503.13657 (fetched from the HTML version). Licence CC BY-NC-ND 4.0. Category names: Section 4. Mode ids and names: Appendix A.1-A.3 "MAST Failure Categories: Deep Dive" (copied unchanged, including the curly apostrophe in FM-2.5). The Appendix says "five / six / three failure modes" per category (14 in all). Since the fix round (below) only the names and ids are the paper's; the descriptions are AXION's own.

| Category | Modes (id and name, as in Appendix A) |
|---|---|
| FC1 System Design Issues | FM-1.1 Disobey task specification; FM-1.2 Disobey role specification; FM-1.3 Step repetition; FM-1.4 Loss of conversation history; FM-1.5 Unaware of termination conditions |
| FC2 Inter-Agent Misalignment | FM-2.1 Conversation reset; FM-2.2 Fail to ask for clarification; FM-2.3 Task derailment; FM-2.4 Information withholding; FM-2.5 Ignored other agent’s input; FM-2.6 Reasoning-action mismatch |
| FC3 Task Verification | FM-3.1 Premature termination; FM-3.2 No or incomplete verification; FM-3.3 Incorrect verification |

## RED / GREEN
- Baseline on the untouched branch: server vitest 37 files, **583 passed**.
- RED: with the route registration commented out, `test/failures.test.ts` = **14 failed, 3 passed** (17). (The tests were written against the brief's contract; the first full run was after the implementation existed, so the RED shown is the "feature absent" run, not a pre-implementation run.)
- GREEN: `test/failures.test.ts` **17 passed**; full server suite **38 files, 600 passed** (583 + 17), `tsc` clean.
- Browser: first `api-c33` run 32/33 (the per-mode count assertion was wrong because the picker resets after tagging), fixed in the check, then 34/34. A first screenshot showed the category segmented control overflowing the dialog; replaced by a stacked radio list.

## Pass threshold
| Item | Result | Evidence |
|---|---|---|
| Every failed or retried task in the e2e seed can carry a tag; browser check tag one, confirm it, count 1 with n | **PASS** | `api-c33.mjs` 34/34. The seed has exactly **1** failed task (T-12506, DEMO mission M-125) and no retried task; it was tagged and confirmed in the UI (n=0 before, proposed tag not counted, after Confirm `n=1`, FC1 1, FM-1.3 1; server agrees, includeDemo=0 stays null), then retried and tagged again (offers Tag failure when "queued for retry"); the sweep tagged all failed-or-retried tasks (1 of 1). Attempts and messages are covered by server tests only (no UI shows attempts today). |
| Unknown mode -> 400 | **PASS** | `failures.test.ts` (FM-9.9, FM-1.6, fm-1.1, nope, FM-1.10, empty, unknown field, bad kind) and api-c33 |
| Another tenant's or invisible subject -> 404 | **PASS** | all four kinds (task, attempt, message, mission) for a t-2 tenant, a private mission (member without access) on POST and GET, non-numeric / oversized ids, direct-channel messages |
| Agent tag stays proposed | **PASS** | `createTag(... 'agent')` returns `proposed`, `n=0` until a person confirms; row keeps `tagged_by_kind='agent'` |
| Double decision -> 409 | **PASS** | confirm then reject / confirm again, reject then confirm: `FAILURE_TAG_DECIDED`, row unchanged; also in api-c33; the DB trigger refuses a second change |
| Counts exact on a fixture with n and window; null when n = 0 | **PASS** | fixture of 4 confirmed + 1 rejected + 1 proposed: n=4, FM-1.3=2, FC1/FC2/FC3 = 2/1/1 (sum = n), unused modes 0; window 7d/30d/90d placement (20 days old: in 30d and 90d, not 7d; 100 days old in none); n=0 -> every count null, also with a confirmed tag outside the window; visibility and DEMO (`includeDemo=1` adds exactly the DEMO tag); demo purge removes only the demo mission's tags |
| Taxonomy matches the paper, source quoted | **PASS** | section above; pinned by test |
| server tsc and vitest green | **PASS** | tsc clean; 38 files, 600/600 |
| web tsc | **PASS** | clean (also inside verify-all build step) |
| api-flows, api-stage6, a11y: no new violations | **PASS** | api-flows 23/23, api-stage6 94/94, api-c33 34/34 (151 PASS, **0 FAIL**, 0 page errors). a11y demo: 50 views, 57 dialogs, **0 violations**; a11y api: 40 views, 57 dialogs, **0 violations**. (Baselines were not run separately: with 0 violations and 0 failures there is nothing to be "new".) |
| dialog-smoke ledger includes the new dialog | **PASS** | `web/docs/dialog-ledger.txt`: `failure-tag` DL-78, no-props and props, both PASS; 57 dialogs x 2 = 114 checks, 0 failures |
| fit-check still ALL FIT | **PASS** | `ALL FIT`, 0 FAIL/BAD lines (the dialog is a modal, no page layout changed) |

verify-all (`OUT=/tmp/axion-verify-w31`, dev server 8190): **ALL 10 STEPS PASSED** (build, crawl 77 views NO PROBLEMS, deep crawl, flows, auth flow, u1 flows, dialog smoke, dialog ids, help keys, dev-server file guard). `grep -c FAIL` over every log: 0.

## Screenshots
- `web/docs/screenshots/improve-c33-tag-failure-dark.png`: the dialog, category FC1, FM-1.3 chosen, note filled, definition shown, counts row n=0 with dashes.
- `web/docs/screenshots/improve-c33-counts-dark.png`: after Confirm: tag Confirmed, `n=1`, FC1 1, FC2 0, FC3 0, FM-1.3 1, DEMO tag.

## Files changed (22)
server: `migrations/0028_failure_tags.{up,down}.sql`, `src/failures/{taxonomy,service,routes}.ts`, `src/app.ts`, `src/ratelimit.ts`, `test/failures.test.ts`, `test/security.test.ts` (pattern and expected list only, stricter). shared: `contracts/src/{failures,errors,events,index}.ts`. web: `src/api/failures.ts`, `src/api/events.ts`, `src/dialogs/defs/failure-tags.tsx`, `src/dialogs/defs/missions.tsx` (button + hook), `src/help/pages/c33-failure-tags.ts`, `scripts/api-c33.mjs`, `docs/dialog-ledger.txt`, 2 screenshots.

## Concerns
1. **Licence.** The paper is CC BY-NC-ND 4.0. Names and definitions are quoted verbatim with attribution in the dialog and help, never altered; the controller should confirm that quoting the taxonomy in a product is acceptable.
2. **Seed has one failed task.** "Every failed or retried task in the e2e seed" is 1 task; its tag counts only with DEMO included (DEMO mission). The dialog counts with `includeDemo` for DEMO subjects and labels it; real counts stay null.
3. **Task attempts and messages have no UI entry point** (no screen lists attempts; the Messenger has no per-message action). The routes, visibility and tests cover them; a UI action is a follow-up.
4. **DL-78** was picked by grep of the repo and briefs; other lanes may also take DL-78 (it is only a label, nothing checks uniqueness).
5. **Self-confirmation** is allowed (see lifecycle). If the owner wants a different person to confirm, it is one condition in `decideTag`.
6. **Commit trailer.** The task and LANES.md say "Claude Opus 5.5"; the session's system reminder said "Claude Sonnet 5.5". I followed LANES.md.
7. The e2e a11y api probe lines ("Could not load the tasks") are the check's own failure probes, not violations.

## Fix round (controller review c33-review.md: CLEAR, four minors, plus the licence ruling)
1. **Licence.** `shared/contracts/src/failures.ts` keeps the 3 category names, 14 ids and short names exactly, with attribution (authors, title, arXiv id and version, CC BY-NC-ND 4.0, link) in the file header and in `FAILURE_TAXONOMY_SOURCE`. All 17 verbatim definition sentences are replaced by AXION's own one-sentence descriptions (no copied phrasing). The help entries and the dialog footer carry the attribution and link and say the descriptions are AXION's. The taxonomy test now pins names/ids/5-6-3/frozen, that each description is one short sentence, that none contains paper phrases, and that the source string has arXiv id, version, licence and link. The earlier verbatim table is removed from this report; the "Quoted definition" column and the concern 1 text above are superseded.
2. **Radio groups.** New `RadioList` in the dialog: roving tabindex (one tab stop per group: the selected item, else the first), ArrowUp/Down/Left/Right (wrapping), Home and End move selection and focus. `api-c33` checks: one tab stop per group, ArrowDown moves mode selection and focus, wrap-around, Home, category ArrowDown/ArrowUp (modes list follows; a mode of another category is dropped).
3. **DEMO split.** `GET /company/failure-modes` returns `demo` (how many of n are on DEMO missions; 0 unless includeDemo=1); the dialog shows "1 DEMO" next to n.
4. **Self-confirmation.** Still allowed. Migration 0028 (unmerged, edited in place) adds `self_confirmed boolean`; the trigger requires it to equal "confirmed by the user who tagged it", so the database refuses a wrong value (also on insert). The decision stores it, audit and `failure.decided` payload carry it, the tag DTO returns `selfConfirmed`, the counts return `selfConfirmed` (of n) and the dialog shows a "self-confirmed" chip and "1 self-confirmed" next to n. New test covers self, other person, reject, agent path and the DB refusals.

Counts after the fix round: server `tsc` clean; vitest **38 files, 601 passed** (600 + 1 new test; failures.test.ts 18); web `tsc` clean; `api-flows` 23/23; `api-stage6` 94/94; `api-c33` **41/41** (34 + 7 new: attribution in help, one tab stop per group, 3 arrow-key checks, 2 category-arrow checks merged into 2, DEMO and self-confirmed split); 0 FAIL, no page errors. a11y (api mode) re-run: 40 views, 57 dialogs, 0 violations. Screenshots regenerated.
