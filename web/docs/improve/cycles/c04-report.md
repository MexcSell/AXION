# Cycle 4 report: organisation history, before/after diff, rollback through governance (theme A)

Implementer report for `c04-brief.md`. Lane worktree `/home/luca/AXION-w2`, branch `c04-org-history`, base `f7c7bca`.

## What was built

### Server (no migration, no new table)
- **`server/src/organization/history.ts`** (new), registered in `app.ts`:
  - `GET /organization/revisions` (moved here from `agents/routes.ts`, same path and order, oldest first). Each revision now
    also carries `createdByName`, `source`, `appliedFromProposal` and `changed` (lines changed against the revision before
    it). The fields are additive: the existing `agents.test.ts` check (length = active seq) still passes.
  - `GET /organization/revisions/:seq` → `{revision: {...summary, edges}}`.
  - `GET /organization/revisions/:seq/diff?against=` → `{seq, against, added, removed, moved[{subordinate, from, to}], impact}`.
    `against` defaults to the revision before (`max(seq) < seq`, 0 for the first). `against=0` means "before any revision"
    (every line is added). An unknown `seq` or `against` (also another tenant's) is 404; a non-number is 400.
  - `POST /organization/revisions/:seq/rollback-proposal {why?}`: admin only, Idempotency-Key. Checks in order: 403
    (member), 400 (no key), 404 (no such revision in this tenant), 422 `NOTHING_TO_ROLL_BACK` (the latest revision, **or** a
    revision whose lines equal the latest's), 409 `DUPLICATE_PROPOSAL` (a pending proposal whose stored lines equal revision
    N's, whatever its title or why), then the shared create path.
- **One create path.** The body of `POST /organization/proposals` was extracted into `createProposal(c, ctx, body, {rollbackTo?})`
  in `proposals.ts` (lock, expire, stale-base check, sha duplicate check, dry run, insert, audit, event). Both routes call it
  inside `idempotent()`. The rollback passes `title "Roll back to revision N"`, `why` (default "Restores the reporting lines of
  revision N."), `baseRevision` = the latest seq read under the same `org-prop` lock, and revision N's edges. `rollbackTo: N` is
  added to the `org.proposal.create` audit detail and the `org.proposalCreated` payload; nothing else differs. Approval,
  self-approval, stale (`ORG_CHANGED`), sha, expiry and re-validation are the untouched cycle 1 decision route.
- **Source of a revision** (stored facts, no new column): `proposal` when `org_proposals.applied_revision = seq` (same tenant);
  `agent` when an `agent.create` audit row of the tenant has `detail.revision = seq` (`POST /agents` already writes it);
  `seed` when `created_by = 'system'`; otherwise `other` (the note is shown). This is preferred over parsing `note`.
- **Diff:** `diffLines(before, after)` (pure, exported from `validate.ts`; `validateOrg` is unchanged). Lines are keyed by
  subordinate (`org_edges` has one line per subordinate per revision): moved = both sides, other manager; added = only after;
  removed = only before. Sorted by subordinate.
- **Impact** (read only): instances whose `agent_id` is a subordinate of a moved, added or removed line, in missions with
  `m.tenant_id` = the caller's, `deleted_at is null`, `archived_at is null`, status not in completed, failed, canceled,
  archived, and `VISIBLE_SQL` (admins see all, members their own and shared). Title from `mission_revisions` at
  `current_revision`; `demo` is included so the UI tags DEMO missions. Nothing writes to `agent_instances`.
- The GETs write nothing: they do not call `expireDue`, audit or emit (asserted by a test).
- Contracts: `OrgRevisionSource`, `OrgRevisionSummaryDto`, `OrgRevisionDetailDto`, `OrgMoveDto`, `OrgImpactDto`, `OrgDiffDto`;
  error code `NOTHING_TO_ROLL_BACK`. Events reused: `org.proposalCreated`, `org.proposalDecided`, `org.revisionApplied`.
- `server/README.md`: API lines for the four routes.

### Web (api mode only; demo mode untouched)
- `web/src/api/orgProposals.ts`: `useOrgRevisions()`, `useRevisionDiff(seq)` and `proposeRollback(seq, why, key)`. The reads
  use the same tick as the proposals list, which `events.ts` already bumps on every `org.*` event, `agent.created` and a stream
  reconnect, so no change to `events.ts` was needed.
- `web/src/features/agents/ServerProposals.tsx`: `ServerProposals` is now a "Proposals | History" `Segmented` switch (in the
  panel head of both views, shared frame kept) over the old panel (`ProposalsPanel`, unchanged apart from the switch and an
  optional highlighted card) and the new `OrgHistory`. Filter state is lifted so a rollback can open "Pending". A view change
  keeps the switch on screen. `DemoProposals` in `OrgSections.tsx` is not touched.
- `web/src/features/agents/OrgHistory.tsx` (new), **Organization History** panel:
  - timeline, newest first: one animated card per revision with a source icon (proposal, agent created, seed), the
    number, an "active" chip on the latest, the source text (proposal title, "agent created: Name" or "seed"), "by Name ·
    age" and an "N lines changed" chip;
  - the selected revision (default: the active one) shows its diff against the revision before it: moved lines as
    "Agent: old manager → new manager", added and removed lines as the cycle 1 "A → B" pills, and "Active missions affected
    (n)" with a link per mission (DEMO missions carry a DEMO tag) and the note "Listed only: running missions keep their teams
    and managers";
  - admins get an optional "Why" field and **Propose rollback to this revision** on every non-latest revision. 409 and 422
    show the server message inline (`role="alert"`) and as a toast; on success a toast says another administrator decides it,
    and the view switches to Proposals › Pending with the new card highlighted (`data-highlight`, a glow animation, scrolled
    into view). One Idempotency-Key per revision, renewed after a failure;
  - members get a "Read only" chip and no rollback control.
- Help (`overview-org-agent.ts`): `org.history`, `org.history.diff`, `org.history.impact`, `org.history.rollback`. The rollback
  entry says it is a new proposal, needs a second administrator and never changes running missions.
- Styles appended to `overview-org-agent.css` (`.oa-hist`, `.oa-timeline`, `.oa-rev`, `.oa-hmove`, `.oa-impact`, `.oa-hl`).
- `web/scripts/api-improve.mjs`: the c04 flow (below), placed after cycle 1's "B rejects the stale proposal", the only
  point where exactly revisions 1 and 2 exist and nothing is pending. It must run before cycle 1's "Archivist-01" agent is
  created: a rollback past an agent created later fails the dry run (`NO_MANAGER`), see Concerns.

## Decisions where the brief left a choice
- **D1, duplicate rollback = same lines pending**, not only the same sha. The cycle 1 sha includes `why`, so the same rollback
  with another reason would otherwise be a second pending proposal with identical lines. The cycle 1 sha check still runs too.
- **D2, "nothing to roll back" includes a revision with the same lines as the latest** (e.g. revision 1 after it was restored
  as revision 3). A proposal that changes nothing would only add an identical revision.
- **D3, no `baseRevision` in the rollback body.** The brief fixes base = latest, read under the proposal lock in the same
  transaction. Staleness is then caught at decision time by the cycle 1 check (`ORG_CHANGED`), which the tests exercise.
- **D4, impact keys on subordinates whose line changed** (moved, added or removed), i.e. "agents whose manager changed". It
  lists every instance of such an agent in an active visible mission; it does not filter on the instance's own state.
- **D5, the list route stayed oldest first** (as before); the UI reverses it.
- **D6, inline rollback control instead of a dialog**, so no dialog id, ledger entry or dialog-smoke change is needed.
- **D7, lane guard in `api-improve.mjs`:** its e2e-database guard accepted only `axion_e2e`; the lane uses `axion_e2e2`. It now
  accepts `axion_e2e\d*`, the same rule as `server/src/cli/e2e-serve.ts` (still refusing any other database). The guard is now
  read once in the c04 step and reused by the cycle 1 expiry and cycle 3 fixture steps.

## RED / GREEN evidence
- **Baseline** (branch base `f7c7bca`): the server suite was 24 files, 321 tests (343 − the 22 new ones; no existing test
  was changed or removed).
- **RED:** `server/test/org-history.test.ts` (22 tests) was written first, with the contracts and a `diffLines` stub that throws,
  and no routes. `cd server && npx vitest run test/org-history.test.ts` gave
  `Test Files 1 failed (1) · Tests 20 failed | 2 passed (22)`. The two that passed: the append-only integrity check (already
  true) and "an unknown revision is 404" (vacuously true while the route did not exist; it bites now through the 404 path).
  Every other route test failed (404 instead of the expected answer) and the pure test with "not implemented".
- **GREEN:** the same command gave `Tests 22 passed (22)`. One expectation of mine was wrong on the first green run, not the
  code: I had expected an administrator not to see a member's private mission in the impact list, but administrators see every
  mission (`VISIBLE_SQL`); the test now expects H1, H2, H7 for the admin and H2, H7 for the member.
- **Full server suite:** `cd server && npx tsc --noEmit -p . && npx vitest run` → tsc clean, `Test Files 25 passed (25) ·
  Tests 343 passed (343)` (321 → 343, 0 failures). Re-run on the final code: same.
- **Mutation check:** with the impact query's final-status filter and `VISIBLE_SQL` replaced by always-true conditions, and the
  "latest revision" 422 disabled, `org-history.test.ts` gave 2 failed (the two impact tests). The "latest" 422 is still
  caught by the second guard (same lines as the latest), so that mutation alone is invisible by design. Code restored.
- **Browser (api mode)**, lane ports: `cd web && npx tsc --noEmit -p . && E2E_API_PORT=5292 E2E_WEB_PORT=5293
  ./scripts/api-e2e.sh api-auth-flow.mjs api-flows.mjs api-stage6.mjs api-improve.mjs` → TSC-OK, `api-auth-flow 15/15`,
  `api-flows 23/23`, `api-stage6 93/94`, `api-improve 104/104`, no page errors in any.
  - The one failure was api-stage6 "after the 409 the next Save succeeds (the new version was adopted)", an agent edit
    dialog check that does not touch the organisation or the proposals. `api-stage6.mjs` alone right after: **94/94**, no page
    errors. The same kind of one-off stage6 failure in the combined run was recorded in cycle 2 (`c02-report.md`).
  - `api-improve.mjs` passed on its first run with the c04 section (103/103), and 104/104 on the two runs after the
    screenshot and the "panel head on screen" check were added.
- **Demo suite:** own dev server on 5290, `BASE=http://127.0.0.1:5290 ./scripts/verify-all.sh` → `EXIT 0`: build ✓, crawl 77
  views NO PROBLEMS, deep crawl NO PROBLEMS, flows / auth flow / u1 flows no errors (46 PASS lines), dialog smoke 106 checks 0
  failures, dialog ids all defined, help keys all defined, fs guard OK.
  - The first run in the lane was red (fonts 403, one dialog-smoke failure, `check-help` crashed). Cause: the worktree's
    `web/node_modules` is a symlink to `/home/luca/AXION/web/node_modules`, outside Vite's `fs.allow`, so the font files
    were refused. A lane-only Vite config in my scratchpad (the project config plus that real path in `fs.allow`, nothing
    committed) fixed it; the rerun above is on that server. `fs-guard` still passes on it (server files, `.env`, backups
    blocked).

## Pass threshold
1. **Server tests: PASS.** Every case in the brief's "Tests" has a test in `org-history.test.ts` (22 tests), and the whole
   suite is green (343/343, `tsc` clean):
   - revision detail (seed, proposal with author and `appliedFromProposal`, agent created) and the list's metadata;
   - diff for moved (rev 2, rev 3), added (rev 4: a new agent; rev 1 against 0) and removed (rev 3 against 4) lines, a
     pure `diffLines` test, `?against` (any revision, 0, unknown → 404, non-number → 400);
   - `impact` lists only visible, active missions: completed, archived and deleted missions, a mission without the agent
     and another tenant's mission are excluded; the member does not see the admin's private mission but sees her own;
   - reads write nothing (audit, events and revisions counted before and after) and need a session (401);
   - a rollback proposal's edges equal revision N exactly, title "Roll back to revision N", base = latest, dry run shows the
     reverse move, audited (`rollbackTo`) and announced;
   - approval by a second admin yields revision 3 whose lines equal revision 1;
   - the author can't self-approve (403 `SELF_APPROVAL`, audited denied);
   - stale base → 409 `ORG_CHANGED` (a new agent lands between creation and decision), the proposal stays pending;
   - rolling back to the latest → 422 `NOTHING_TO_ROLL_BACK` (also a revision with the latest's lines);
   - duplicate pending → 409 `DUPLICATE_PROPOSAL` (same why and another why); the same key replays the stored 201;
   - member → 403, anonymous → 401, no key → 400;
   - another tenant's revisions → 404 for read, diff, `against` and rollback; a seq number both tenants have shows this
     tenant's own lines;
   - a rollback past an agent created since is stored with `NO_MANAGER` and approval is 422 `ORG_INVALID` (no revision).
2. **Browser check: PASS** (`api-improve.mjs`, c04 section, 23 checks inside 104/104):
   - A applies P1 via the cycle 1 flow (B approves), which moves Coder-01 from the GM to Ops-01;
   - A's History shows revisions 2 and 1 newest first (2 names P1, "1 line changed", by Bea; 1 says seed); the diff of
     revision 2 shows exactly one moved line `Coder-01: GM → Ops-01`, no added or removed line, and the server's affected
     missions (4 DEMO missions, M-126, M-128, M-129, M-132) as links;
   - the active revision has no rollback button; 422 (request pointed at revision 2) shows "nothing to roll back" inline;
   - A clicks "Propose rollback to this revision" on revision 1: the server stores a pending "Roll back to revision 1" on
     base 2 with revision 1's lines; A lands on Proposals › Pending with the card highlighted; its dry run shows
     `+ GM → Coder-01` and `− Ops-01 → Coder-01`, and A has no Approve; a second click is 409, the message shown inline;
   - B approves it ("applied as rev 3"); the server's revision 3 has the same lines as revision 1 and came from that proposal;
   - C (member, a third browser) keeps the Hierarchy open: revision 2 → 3 and Coder-01's manager ops-01 → gm, the line
     GM → Coder-01 is drawn again, live, with no reload or navigation;
   - A's History shows revision 3 live, with the reverse move and the same affected missions; at 1366×768 the view fits
     (no page or sideways scroll) and the panel head is on screen; C's History is read only (no rollback control).
3. **Impact, never changed: PASS.** The diff lists active visible missions with an instance whose agent's manager changed
   (server test and browser). No code path writes `agent_instances`. The server test "B approves …" checks that every
   instance's `manager_instance_id` (including the ones the impact list named, all non-null) is identical after the rollback
   is applied; the browser check reads all 48 instances from the lane e2e database (SELECT only) before the rollback and
   after it is applied: identical.
4. **verify-all green, demo mode unchanged: PASS.** `verify-all.sh` `EXIT 0` (above). Demo `Proposals` is
   `DemoProposals`, untouched; the History is only inside the api-mode `ServerProposals`.

## Files changed
- `server/src/organization/history.ts` (new), `server/src/organization/proposals.ts` (shared `createProposal`,
  `lockProposals`, `pendingWithEdges`), `server/src/organization/validate.ts` (`diffLines`), `server/src/agents/routes.ts`
  (the revisions list moved out), `server/src/app.ts`, `server/README.md`
- `server/test/org-history.test.ts` (new, 22 tests)
- `shared/contracts/src/agents.ts`, `shared/contracts/src/errors.ts`
- `web/src/api/orgProposals.ts`, `web/src/features/agents/ServerProposals.tsx`, `web/src/features/agents/OrgHistory.tsx` (new),
  `web/src/help/pages/overview-org-agent.ts`, `web/src/theme/pages/overview-org-agent.css`
- `web/scripts/api-improve.mjs`
- `web/docs/screenshots/improve-c04-history-dark.png` (regenerate:
  `DOC_SHOT_C04=$PWD/docs/screenshots/improve-c04-history-dark.png ./scripts/api-e2e.sh api-improve.mjs`)
- this report

## Concerns
- **Rollback past a newer agent cannot be approved.** Revision N's lines lack any agent created after N, so the dry run
  reports `NO_MANAGER` and approval is 422. This is honest (the proposal is stored with the reason) but a real
  "undo this one move" needs a different tool: a proposal that reverses only the selected revision's diff on top of the
  latest lines. I did not build it (the brief asks for "the lines of the earlier revision"). Candidate for the backlog.
- **Placement of the browser flow.** The c04 section sits inside cycle 1's flow (after "B rejects the stale proposal"),
  because only there do exactly revisions 1 and 2 exist with nothing pending, and it must precede the Archivist-01 agent.
  One cycle 1 count changed accordingly: member C now reads five proposals, not four. No cycle 1 check was weakened.
  Another lane editing `api-improve.mjs` may conflict textually at the merge.
- **The e2e database guard** in `api-improve.mjs` now accepts `axion_e2e<N>` (needed in this lane); it still refuses any
  other database and only ever touches the e2e database.
- **Lane Vite / `node_modules` symlink:** verify-all is red in a worktree whose `node_modules` is a symlink, until Vite may
  serve the real path. I used a scratchpad-only config; nothing in the repo changed. The controller's lane setup may want
  this (or real `node_modules`) for other lanes.
- **Impact counts DEMO missions** (tagged DEMO in the UI), because they are real rows the caller can see; there is no
  `includeDemo` switch here. Instances are listed whatever their own state (D4).
- **api-stage6 one-off failure** in the combined run (agent edit dialog, unrelated to this cycle); 94/94 alone. Same pattern as
  cycle 2.
- `GET /organization/revisions` reads all edges of the tenant to count changes: fine at today's size (a few revisions of
  ~25 lines); it would want a limit or a stored count if revisions grow into the thousands.
- Not done here (steps for the controller): independent review, LOG/LESSONS entries, merge, live-server restart (the
  routes changed; no migration).
