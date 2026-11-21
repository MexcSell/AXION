# Cycle 1 report: organisation change proposals, from simulated to real (theme A)

Implementer report for `c01-brief.md`. Branch `improve-30h`, base `c5f49ff`.

## What was built

### Server
- **Migration `0013_org_proposals`** (up/down). Table `org_proposals` with every column the brief lists, plus two checks:
  `edges` must be a JSON array, and `status='applied'` exactly when `applied_revision` is set. A unique partial index on
  `(tenant_id, payload_sha) where status='pending'`. `expires_at` defaults to `now() + 7 days`. Down drops only this table.
  `org_revisions`/`org_edges` and their append-only triggers are untouched.
- **`validateOrg(edges, agents, current)`** (`server/src/organization/validate.ts`), a pure function. It returns
  `{ok, errors[], warnings[], added[], removed[]}`. Each issue is `{code, message, agentId?|dept?}`.
  - Errors: `UNKNOWN_AGENT`, `SELF_MANAGED`, `CYCLE` (seen-set walk, limit 64, the same walk as `assertAcyclic`; a chain
    deeper than 64 is reported as `CYCLE` with its own message), `MULTIPLE_MANAGERS`, `NO_MANAGER` (an active agent other
    than `gm`; retired agents are exempt). "Active" is `agent_definitions.status`, not the display status.
  - Warnings (they never block):
    - `MANAGER_WITHOUT_REPORTS`: an active agent that manages someone in the active revision (or whose role is `manager`)
      and would manage nobody.
    - `DEPT_WITHOUT_HEAD`: a department of active agents, excluding the GM's own department, where no member reports to
      the GM. ("Head" = reports to the GM. The other reading, "someone reports from outside the department", can never fail
      on an error-free tree, so a warning built on it could never fire.)
  - `added`/`removed` compare against the active revision's lines. A moved line is one removed plus one added.
- **Routes** (`server/src/organization/proposals.ts`, registered in `app.ts`):
  - `GET /organization/proposals` (any signed-in user) → `{proposals, activeRevision}`, newest first, at most 200.
    Author and decider names are joined from `users`.
  - `POST /organization/proposals {title, why, baseRevision, edges}`: admin only, Idempotency-Key, 201 `{proposal}`.
    409 `DUPLICATE_PROPOSAL` when the same payload is already pending. 409 `ORG_CHANGED` when `baseRevision` is not
    the latest revision (see decision D2).
  - `POST /organization/proposals?dryRun=1`: admin only, no key, stores and audits nothing → `{result, baseRevision}`.
  - `POST /organization/proposals/:id/decision {decision, note?, sha}`: admin only. The checks run in this order:
    1. 404;
    2. 403 `SELF_APPROVAL` (also for reject: the author has Withdraw);
    3. 409 `PROPOSAL_EXPIRED`;
    4. 409 `PROPOSAL_NOT_PENDING`;
    5. 409 `PROPOSAL_CHANGED` (the given sha ≠ stored, or the stored content no longer hashes to its stored sha);
    6. approve only: 409 `ORG_CHANGED`, then re-validation against the current agents (422 `ORG_INVALID`).

    Approve calls the existing `createOrgRevision` with exactly the stored edges, then
    `UPDATE … SET status='applied', applied_revision=<seq> WHERE id=… AND status='pending' RETURNING`, all in one
    transaction. If the compare-and-set misses, the transaction throws and the revision rolls back. Reject sets `rejected`.
  - `POST /organization/proposals/:id/withdraw`: admin and author only, while pending.
  - Expiry runs on every read, create, decision and withdraw (`expireDue`). There are no timers.
- **Audit**: `org.proposal.create`, `org.proposal.decide` (ok and **denied**), `org.revision.apply`,
  `org.proposal.withdraw` (ok and denied), `org.proposal.expire` (actor `system`). A refusal is audited in a transaction
  that commits (the approvals route's "return, then throw after commit" pattern), so an expiry and a denied-audit row both
  survive the error response.
- **Events**: `org.proposalCreated`, `org.proposalDecided` (payload `status`: applied, rejected, withdrawn or expired) and
  `org.revisionApplied` (subject = the new revision's seq, payload `{proposalId, revision, previous}`). All are audience
  `all` with `subjectKind: 'org'`. They are added to the `EventType` union, and seven error codes are added to
  `ERROR_CODES` (the six in the brief plus `PROPOSAL_NOT_PENDING`).
- Running missions: nothing touches `agent_instances`. Only `/organization/graph` (and the catalog's `managerId`, which is
  derived from it) changes.

### Web (api mode only)
- `web/src/api/orgProposals.ts`:
  - `useOrgProposals()` re-reads on a tick;
  - `dryRunProposal`, `createProposal` (one Idempotency-Key per dialog, renewed after a failure), `decideProposal` (sends
    the sha it displayed), `withdrawProposal`.
- `web/src/api/events.ts`:
  - the three `org.*` names are added to the SSE listener list (without this nothing arrives);
  - `org.*` refreshes the proposals list;
  - `org.revisionApplied` reloads the agent catalog. That bumps the catalog version, and `useOrgGraph` depends on it, so
    the Hierarchy refetches the graph;
  - a reconnect refreshes the proposals list too.
- `web/src/features/agents/ServerProposals.tsx`, **Agents › Proposals** in api mode:
  - the panel header has a Pending, Decided and All filter, an "active rev N" chip, and for admins "New proposal" (members
    get a "Read only" chip instead);
  - each card shows the title, why, id, author, age, a status chip (pending pulses), `base rev N`, `stale: rev M is active`
    when the base is old, `applied as rev N`, and "expires in";
  - the card's dry run shows errors in red, warnings in amber, and lines added and removed as "A → B" pills;
  - a decided card shows who decided, when, and the note;
  - admins who are not the author get a note field plus Approve and Reject. Approve is disabled when the dry run has
    errors or the proposal is stale; the server enforces both anyway. The author gets Withdraw. Members see no buttons;
  - server errors show inline on the card (`role="alert"`) and as a toast. A card that holds an error stays listed
    even if its new status (for example expired) leaves the current filter.
- `web/src/dialogs/defs/org-proposals.tsx`, the **New proposal** dialog (`org-proposal-new`, DL-66):
  - it starts from the active graph and shows "from org revision N";
  - each row is an agent picker, its current manager, and a new-manager picker; rows can be added and removed; title and
    why are optional (the title defaults to "Move X under Y");
  - the server dry run re-runs 300 ms after each change and is shown on the right before submit;
  - in demo mode the dialog renders with a note and cannot submit, so `dialog-smoke` stays clean.
- `OrgSections.tsx`: `Proposals()` is now `isApi() ? <ServerProposals/> : <DemoProposals/>`. The demo component is the
  previous function renamed, and its JSX is untouched. In api mode the sub-tab note in `Agents.tsx` describes the real
  flow instead of "simulate, evaluate… rollback".
- Help: `org.proposals.server`, `org.proposal.new`, `org.proposal.changes`, `org.proposal.dryRun`,
  `org.proposal.decide`, `org.proposal.withdraw`. Styles are added to `overview-org-agent.css` using the existing panel
  and card classes.
- `web/scripts/api-improve.mjs`: the browser flow for threshold item 2 (A, B and C in three browsers, 29 checks). It
  writes the committed screenshot only when `DOC_SHOT` is set, so a normal run leaves the tree clean. To regenerate it:
  `DOC_SHOT=$PWD/docs/screenshots/improve-c01-proposals-dark.png ./scripts/api-e2e.sh api-improve.mjs`. To move one
  proposal's expiry into the past, it touches only `axion_e2e`: it reads `E2E_DATABASE_URL` from `server/.env` and
  refuses any URL that is not `axion_e2e`.

## Decisions where the brief left a choice
- **D1, dry run before submit:** `?dryRun=1` on POST. It stores nothing, writes no audit row and needs no key. The dialog
  calls it debounced on every change. The stored `result` on the card is computed again at creation, and approval
  re-validates against the current agents.
- **D2, `baseRevision` comes from the client (stricter than the brief):** POST takes `baseRevision` and refuses a mismatch
  with 409 `ORG_CHANGED`. Otherwise, a dialog opened on revision N and submitted after N+1 would be stamped N+1, and its
  full edge set would silently undo N+1.
- **D3, stale and latest:** the stale checks compare against `max(seq)`, not `activeRevision()`. `activeRevision()`
  filters `active_from <= now()`, and `now()` is the transaction start, so it could miss a revision committed meanwhile. The
  decision transaction takes the `org-rev:<tenant>` advisory lock (the one `createOrgRevision` and `POST /agents` use)
  before it reads anything, then locks the proposal row.
- **D4, `seq` against `id`:** `base_revision` and `applied_revision` hold `org_revisions.seq`, the number the UI shows.
  `id` is used only to read edges.
- **D5, edge format:** stored in `edges jsonb` as the brief's `{supervisor, subordinate, edge_type}`, sorted. The API
  uses the existing `OrgEdgeDto` (`supervisorId`, `subordinateId`, `edgeType`), like `/organization/graph`. The sha is
  sha256 of `JSON.stringify([title, why, baseRevision, sortedEdges])`.
- **D6, a stale or invalid proposal stays `pending`:** it can still be rejected, withdrawn or left to expire. `failed` and
  `approved` are allowed by the status check but never written. Approve goes straight to `applied`, and a failed apply
  rolls back completely, so nothing is left to mark as failed.
- **D7, SELF_APPROVAL covers reject too:** "Admins who are not the author: Approve and Reject". The author's way out is
  Withdraw.
- **D8, withdraw needs admin *and* author:** the stricter choice. Authors are admins anyway.
- **D9, a separate script `api-improve.mjs`:** a fresh stack and an untouched `api-stage6.mjs`. The second admin is
  promoted with `PATCH /users/:id {role:'admin'}`.

## RED / GREEN evidence
- Baseline: `cd server && npx tsc --noEmit -p . && npx vitest run` gave **17 files, 219 tests passed**.
- RED: the tests were written first, against a stub `validateOrg` that throws and with no routes.
  `npx vitest run test/org-validate.test.ts test/proposals.test.ts` gave
  `Test Files 2 failed (2) · Tests 28 failed | 1 passed (29)`. The one passing test is the append-only integrity check,
  which already held.
- GREEN: the same command gave `Tests 29 passed (29)`. The full suite gave **19 files, 248 tests passed**
  (219 → 248, +29, 0 failures).
- Mutation check: with the stale-base and self-approval guards disabled, `proposals.test.ts` gave 4 failed and 15 passed,
  which shows those tests bite. The code was then restored.
- Browser (api mode): `cd web && npx tsc --noEmit -p . && ./scripts/api-e2e.sh api-auth-flow.mjs api-flows.mjs api-stage6.mjs api-improve.mjs`
  gave `TSC-OK`, then `api-auth-flow 15/15`, `api-flows 23/23`, `api-stage6 94/94` and `api-improve 28/28`, with no
  page errors in any of them, and `EXIT 0`. After the review fixes (commit 3), the server suite was re-run (248/248, with
  the expiry test strengthened) and `api-improve.mjs` was re-run alone: **29/29**, no page errors, and 5192/5193 free
  afterwards. The fixes touch only the api-mode card and the script, so the other three scripts were not re-run. While the script was being written, its first runs failed only on its own locators (the help
  `?` buttons share names with the action buttons, and one `<label>` was not linked to its field, which is now fixed in the
  dialog), never on a product check.
- Demo suite: `./scripts/verify-all.sh` (dev server on 5190, not restarted) gave:
  - build ✓;
  - crawl: 77 views, NO PROBLEMS;
  - deep crawl: NO PROBLEMS;
  - flows: 21 PASS;
  - auth flow: 17 PASS;
  - u1 flows: 8 PASS;
  - dialog smoke: 53 dialogs × 2 = 106 checks, 0 failures (the new `org-proposal-new`, DL-66, is in `docs/dialog-ledger.txt`);
  - dialog ids: all defined;
  - help keys: all defined;
  - fs guard: OK;
  - `EXIT 0`.

  It was re-run on the final code after commit 3, again `EXIT 0`: 46 PASS lines, 0 FAIL, 106 dialog checks with 0
  failures, and help keys and dialog ids all defined.

## Pass threshold
1. **Server tests: PASS.** Every case under the brief's "Tests" has a test:
   - `org-validate.test.ts`: 10 tests, covering each error and each warning, the chain limit and the added/removed lines;
   - `proposals.test.ts`: 19 tests:
     - admin A proposes, admin B approves, and the result is a new revision whose edge set *equals* the proposed set;
     - self-approval is 403 and audited as denied;
     - a member posting or deciding is 403;
     - an invalid proposal is stored but approval is 422;
     - the same sha pending twice is 409;
     - stale P1/P2 gives `ORG_CHANGED`;
     - a tampered sha is 409, and so is tampered stored content;
     - an expired proposal is 409, and the refused decision itself commits `expired`, the expire audit row and a denied
       decide row (asserted in the database before any read); it also expires on read;
     - withdraw works for the author only;
     - instances keep `manager_instance_id`, checked against a non-empty set;
     - `org_edges` UPDATE and DELETE still throw;
     - 0013 goes down to 12 and up again on a schema with seeded agents, demo missions with instances and proposals, and
       the row counts are unchanged.

   The suite went from 219 to 248 tests with 0 failures, and `tsc` is clean.
2. **Browser check: PASS** (`api-improve.mjs`, 29/29):
   - A creates a proposal in Agents › Proposals and sees the server dry run in the dialog before submit (checks passed,
     `+ Ops-01 → Coder-01`, `− GM → Coder-01`; a loop shows a red `CYCLE`);
   - B (a second administrator) approves it;
   - C (a member) keeps Agents › Directory › Hierarchy open. C's `data-org-revision` changes from 1 to 2 and
     `[data-agent=coder-01]` changes its `data-manager` from `gm` to `ops-01`, with 0 main-frame navigations and a
     `window` marker that survives (no reload);
   - C saw the proposals read-only: no New proposal, a "Read only" chip, no buttons on the card, which arrived live;
   - `PROPOSAL_CHANGED` shows the server message inline;
   - the stale P2 shows "stale: rev 2 is active" and its Approve is disabled; through the API it is `ORG_CHANGED`, and
     `SELF_APPROVAL` through the API is 403;
   - `PROPOSAL_EXPIRED`: a proposal B has on screen is expired in `axion_e2e`; B's Approve gets the server message, and
     it stays on the card although the card left the Pending filter and now says Expired.
3. **Demo mode unchanged: PASS.** `verify-all.sh` is green (above). The demo `Proposals` JSX is byte-for-byte the old
   function, renamed `DemoProposals`.
4. **Nothing invented: PASS.** The api-mode cards show only the stored title, why, author, age, status, base revision,
   applied revision, expiry, the dry run's errors and warnings, the lines added and removed, and the decider and note. The
   browser check asserts that the panel text has no `\d+%` and none of the words coverage, latency or tokens, and that the
   panel has no DEMO tag and no stage stepper.

## Files changed
Commit 1 (server, `67496df`):
- `server/migrations/0013_org_proposals.{up,down}.sql` (new)
- `server/src/organization/validate.ts`, `server/src/organization/proposals.ts` (new)
- `server/src/app.ts` (registers the routes)
- `server/test/org-validate.test.ts`, `server/test/proposals.test.ts` (new)
- `server/README.md` (API and rollback lines)
- `shared/contracts/src/{agents,errors,events}.ts`

Commit 2 (web and report, `a8007d8`), then commit 3 (review fixes: the error stays on the card, a stronger expiry test,
`DOC_SHOT` opt-in, the e2e expiry check):
- `web/src/api/orgProposals.ts`, `web/src/features/agents/ServerProposals.tsx`, `web/src/dialogs/defs/org-proposals.tsx` (new)
- `web/src/api/events.ts`, `web/src/features/agents/OrgSections.tsx`, `web/src/pages/Agents.tsx`,
  `web/src/help/pages/overview-org-agent.ts`, `web/src/theme/pages/overview-org-agent.css`
- `web/scripts/api-improve.mjs` (new)
- `web/docs/dialog-ledger.txt` (regenerated by dialog-smoke: +DL-66)
- `web/docs/screenshots/improve-c01-proposals-dark.png`, `web/docs/improve/cycles/c01-report.md`

Not touched: `api-stage6.mjs`, migrations 0001–0012, the append-only triggers, and auth/visibility code.
`web/docs/improve/LOG.md` and `STATE.md` had changes from the controller and are left uncommitted.

## Screenshot
`web/docs/screenshots/improve-c01-proposals-dark.png`: the api-mode Proposals tab with the filter on All, after an
applied proposal, a rejected stale one and an expired one. A third browser's hierarchy after the live update is in
`/tmp/axion-api-e2e/improve-c01-hierarchy-C.png` (not committed).

## Concerns
- **The live site will show an error on this tab until the API is restarted.** The dev server on 5190 serves the
  working tree, so in api mode its Proposals tab now calls `/organization/proposals`. The live API on 5191 runs the old
  code and has no such route, so the tab shows "Proposals not loaded: Not found." (honestly, with Retry) until 5191 is
  restarted, which also applies migration 0013 on start. I did not restart it (the rules forbid it). The owner or
  controller should restart it, or accept that.
- **A stale or invalid proposal stays `pending`** until someone rejects it, its author withdraws it, or it expires. The
  card says so: a "stale" chip and Approve disabled. `failed` and `approved` are allowed by the status check but are never
  written (D6).
- **`DEPT_WITHOUT_HEAD` means "no member reports to the GM"** (see the definition above). If the owner means something
  else by a department head (for example a head stored per department), the warning should follow that definition once
  such data exists.
- **The tab's other DEMO sections are unchanged.** Departments' "Assign manager" and the Assignments "Rebalance" still
  open the DEMO reorganisation dialog (DL-39) in api mode, as before. They now sit next to a real proposal flow, and a
  later cycle could route them to the new dialog.
- **A pre-existing race, not fixed this cycle:** `POST /agents` reads the active edges *before* `createOrgRevision`
  takes the `org-rev` lock. If an agent is created at the same moment a proposal is approved, its revision can be built
  from the pre-approval edges plus the new agent, which silently undoes the applied proposal. The proposals path itself
  takes the lock first. The fix is a one-liner in `agents/routes.ts` (take `org-rev:<tenant>` before reading the edges),
  but that file is outside this brief, so it should be a backlog item.
- Migration 0013 down drops `org_proposals`, and the proposals with it. The applied revisions survive in the append-only
  `org_revisions`/`org_edges`, whose notes name the proposal id.

## Fix round (review `c01-review.md`)

### Changes
- **I-1, POST /agents could silently undo an applied proposal.** Fixed at the root, in `server/src/agents/org.ts`:
  - **`createOrgRevision` is now the single lock-then-read path for every org-revision writer.** In order, it:
    1. takes `lockOrg` (`org-rev:<tenant>`);
    2. reads the newest revision with `latestRevision()`, which uses `max(seq)` and not `activeRevision()` with its
       `active_from <= now()` filter;
    3. builds the edges;
    4. validates them;
    5. inserts `seq + 1`.
  - `edges` may be a function of the latest revision's edges. `POST /agents` now passes
    `(latest) => [...latest, newLine]`, so it no longer reads the organisation before the lock.
  - The proposal apply path passes its stored edges with `expectSeq: base_revision`, so a stale base is refused inside the
    lock too (409 `ORG_CHANGED`).
  - The seed is unchanged; it also goes through `createOrgRevision`.
  - `proposals.ts` uses the same `latestRevision` and `lockOrg`; its private `latest()` is gone.
  - `POST /agents` now also emits `org.revisionApplied` (subjectKind `org`, payload `{revision, previous, agentId}`), and
    its audit detail carries the revision.
- **I-2, the chart is one tree under the GM.** `validateOrg` has new errors:
  - `RETIRED_MANAGER`: a retired agent as a manager;
  - `GM_HAS_MANAGER`: the GM as a subordinate;
  - `NOT_UNDER_GM`: an active chain that does not end at the GM, reported once per detached top and naming the agents
    under it;
  - `DUPLICATE_LINE`: the same line listed twice, which used to be reported misleadingly as `MULTIPLE_MANAGERS`.

  An unknown manager stays `UNKNOWN_AGENT`, and now also produces `NOT_UNDER_GM` for the active agents under it. Each
  loop is reported once, with its members ("a → b → c → a"). The depth limit is unchanged: 64 levels below the GM is fine
  and 65 is `CYCLE`. **`createOrgRevision` runs the full `validateOrg`** after the existing `assertAcyclic` (kept, so a
  loop is still `ORG_CYCLE`). Any other error is 422 `ORG_INVALID`, so no API path can apply an invalid chart.
- **Live stale chip:** `web/src/api/events.ts` refreshes the Proposals list on every `org.*` event and on `agent.created`.
  Together with the new `org.revisionApplied` from `POST /agents`, a pending proposal shows "stale: rev N is active" and
  disables Approve live when someone creates an agent.
- **Proposal ids are 128-bit:** `OP-` + 16 random bytes in hex. The card shows the first 11 characters, with the full id
  on hover.
- Review minors, done while I was there:
  - the decision, reject and withdraw compare-and-set updates and `one()` filter by `tenant_id` too;
  - the canonical sort for the sha uses a plain `<` comparison, not `localeCompare`;
  - `edgeType` is restricted to `reports_to`, the only type that exists.

### Covering tests (written first)
RED: `npx vitest run test/org-validate.test.ts test/proposals.test.ts` gave `Tests 9 failed | 30 passed (39)`. The race
test failed exactly on the silent undo: `AssertionError: expected 'gm' to be 'ops-01'`. The boundary test passed in RED;
it pins down behaviour that already held.

- `org-validate.test.ts` (+7 tests):
  - a retired manager (`RETIRED_MANAGER` and `NOT_UNDER_GM` naming the top and its member);
  - an unknown manager of an active agent;
  - the GM as a subordinate;
  - an active chain not ending at the GM;
  - a 3-agent cycle reported once, naming all three;
  - the 64/65 depth boundary;
  - `DUPLICATE_LINE`.
- `proposals.test.ts` (+3 tests):
  - `createOrgRevision` refuses an invalid chart (an agent without a manager → `ORG_INVALID` 422; the GM under an agent
    → 422) and no revision is written;
  - a retired manager is a dry-run error, and approving it is 422 `ORG_INVALID`;
  - **the deterministic race:**
    1. a separate connection X holds `pg_advisory_xact_lock(hashtext('org-rev:t-1'))`;
    2. `POST /agents` is fired, and the test polls `pg_locks` until it waits on that key;
    3. a second connection Y, whose transaction starts after POST's (so its `active_from` lies in POST's future, which
       also exercises the `active_from` gap), commits a revision that moves writer-01 under ops-01;
    4. X commits;
    5. the test asserts POST is 201, its revision is the moved one's seq + 1, writer-01 still reports to ops-01, the new
       agent reports to gm, and exactly one `org.revisionApplied` event (subjectKind `org`) exists for that revision.
- `api-improve.mjs` (+2 checks, 31 in total): a fresh pending proposal is not stale. Then an agent is created through the
  API, and B's open card turns "stale: rev N is active" with Approve disabled, live.

### Commands and output
- `cd server && npx tsc --noEmit -p . && npx vitest run` gave `TSC-OK`, `Test Files 19 passed (19)`,
  `Tests 258 passed (258)` (248 → 258).
- `cd web && npx tsc --noEmit -p . && DOC_SHOT=… ./scripts/api-e2e.sh api-auth-flow.mjs api-flows.mjs api-stage6.mjs api-improve.mjs && ./scripts/verify-all.sh`:
  - `TSC-OK`;
  - `api-auth-flow 15/15`, `api-flows 23/23`, `api-stage6 94/94`, `api-improve 31/31`, no page errors;
  - verify-all: build ✓; crawl 77 views NO PROBLEMS; deep crawl NO PROBLEMS; flows, auth flow and u1 flows all PASS with no
    console or page errors; dialog smoke 106 checks with 0 failures; dialog ids and help keys all defined; fs guard OK;
    `EXIT 0`.
- **A flaky check, recorded honestly.** The first run of that command had `api-stage6` at 92/94. Two checks failed: "the
  server created the next version" and "Versions lists v(n+1)…", both in the designer-01 Edit dialog. That step patches
  skills and never touches org code. `api-stage6` alone then gave 94/94, and the full command above was re-run from the
  start and gave 94/94. I could not reproduce it. My guess is a timing flake in that pre-existing step (the dialog's save
  against the catalog load), not this change, but it was seen once, so it is listed here.

### Commits
- `a55c14a`: server fix round (I-1, I-2, ids, minors, tests)
- the web and report commit that follows it (events refresh on `agent.created`, short id display, `api-improve` checks,
  the screenshot regenerated with four proposals, this section)
