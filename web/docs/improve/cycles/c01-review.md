# Cycle 1 review: organisation change proposals (theme A)

An independent review of commits `c5f49ff..ded4043` (branch `improve-30h`) against `c01-brief.md` and the "Safety rules"
in `PROCESS.md`. It is read-only: I ran no tests, servers or database queries. The vitest suite writes to the test
database, and the e2e and demo suites start servers. The only thing I executed was the pure `validateOrg` function, in
memory with `npx tsx`, for the edge cases in section 3. File:line references point at the files as of `ded4043`.

## Verdicts

- **Spec compliance: PASS, with one condition.** Every server, web and test item in the brief is implemented. The
  deviations (below) are declared and are stricter than the brief. The condition is the `POST /agents` race (I-1). It is
  outside the diff, but this cycle makes it reachable, and it breaks the brief's promise that an approval is "applied
  exactly once as a new org revision" and can't be overridden from a stale org.
- **Quality: PASS after the fix round.** There are no Critical findings and two Important ones (I-1, I-2). Both are small,
  local fixes.
- **Pass threshold:** items 1–3 look consistent on reading, but I did not reproduce them; the controller's verify step
  (PROCESS step 7) must confirm them. Item 4 is verified by reading.

## Findings

### Critical
None.

### Important

**I-1. `POST /agents` can silently undo an applied proposal. The race is confirmed, and the implementer's proposed
one-line fix is not enough.**
- **Evidence.**
  - `server/src/agents/routes.ts:66-69`. `POST /agents` reads `activeRevision()` and `edgesOf()`. Only after that does it
    call `createOrgRevision`, which takes the `org-rev:<tenant>` advisory lock (`server/src/agents/org.ts:39`) and computes
    `max(seq)+1` (`org.ts:40`).
  - Until the lock, this transaction holds only `agent-create:<tenant>` (`routes.ts:49`), which the proposal path never
    takes.
- **Interleaving.**
  1. T_agent reads the rev-1 edges and then blocks on `org-rev`.
  2. The approval (`proposals.ts:124` lock, then `:146` `createOrgRevision`) commits rev 2.
  3. T_agent gets the lock and writes rev 3 = the rev-1 edges plus the new agent.

  The proposal row still says `applied as rev 2`, but the active chart no longer contains its lines. Nothing reports it:
  no error, no event, no audit row.
- **Why the one-liner is not enough.** The report suggests taking the lock before the read. `activeRevision()` filters
  `active_from <= now()` (`org.ts:51`), and `active_from` defaults to `now()`, the inserting transaction's start
  (`migrations/0006_agents.up.sql:46`). If the approval's transaction started after T_agent's, rev 2 has
  `active_from > T_agent.now()`. So T_agent still reads rev 1 even after it waits on the lock and rev 2 has committed. The
  implementer named exactly this hazard in D3 (`proposals.ts:38`) but did not apply it to `POST /agents`.
- **Required fix.**
  - In `POST /agents`, take `org-rev:<tenant>` before reading the org.
  - Read the newest revision by `max(seq)` (reuse `latest()` from `proposals.ts`, or move it into `agents/org.ts`) instead
    of `activeRevision()`.
  - Better still, have `createOrgRevision` accept a "build edges from the latest" callback, so that no caller can read
    outside the lock.
- **Regression test (deterministic).** Hold `pg_advisory_xact_lock(hashtext('org-rev:t-1'))` in an open transaction on a
  separate pool client. Fire `POST /agents` and wait (poll `pg_stat_activity.wait_event_type='Lock'`) until it blocks.
  From the held transaction, append a revision that moves a line (or approve through `createOrgRevision`), then commit.
  Then assert that the agent's new revision contains the moved line. The test fails today and passes once the fix is in.
- **Same root cause, already present.** Two concurrent `POST /agents` calls can lose an edge through the same
  `active_from` visibility gap when the later-locking transaction started first. The same fix closes it.

**I-2. `validateOrg` passes ("Checks passed") charts that are not rooted at the GM.**

I confirmed this by running the function:
- `[gm→a, old→b]`, where `old` is retired and has no manager, gives `{ok:true, errors:[], warnings:[]}`. Active agent `b`
  is detached from the GM under a retired agent.
- `[old→gm, gm→a, gm→b]` gives `{ok:true}`. The GM now reports to a retired agent.

Why it passes:
- `NO_MANAGER` only checks that an active agent has *some* manager (`validate.ts:62`).
- Nothing checks that a supervisor is active, that the GM has no manager, or that every active chain ends at `gm`.
- `createOrgRevision` doesn't check either (`org.ts:32-38`), so two admins can apply such a chart.

The dialog's pickers exclude retired agents and never offer the GM as a subordinate (`org-proposals.tsx` `staff` and
`active()`), so this is reachable through the API only. The brief's error list is implemented to the letter. But the
brief's intent, and the "orphans" check, is a single tree under the GM, and the card tells the reviewer "Checks passed".

Fix: add errors for:
- a retired agent used as a supervisor or subordinate in a new line (or at least as a supervisor);
- `gm` as a subordinate;
- an active agent whose chain does not end at `gm`.

Add a unit test for each.

### Minor
1. **Repeated `CYCLE` errors for one loop.** One loop with several tails produces several `CYCLE` errors (`p>q>r>p` with
   tails `s`, `t` gives `CYCLE:p CYCLE:s CYCLE:t`), because `looped` only skips *starts* already seen
   (`validate.ts:44-58`). That is noise, not a wrong verdict.
2. **Missing unit tests.**
   - The unit tests cover only a 2-agent cycle and the depth limit. Add a ≥3-agent cycle and an exact-boundary test.
   - I ran the boundary: 64 agents below the GM is ok and 65 is `CYCLE`, which matches `assertAcyclic`.
3. **Edge types and duplicate lines.**
   - `edgeType` accepts any `[a-z_]{1,40}` (`proposals.ts:24`), and `validateOrg` treats every edge as a reporting line.
     Restrict it to `reports_to` unless other types are planned.
   - A duplicated identical line is reported as `MULTIPLE_MANAGERS`, which is a misleading message.
4. **Lookups by id alone.** `one()` (`proposals.ts:57`) and the CAS updates (`:136`, `:147-149`, `:172`) filter by `id`
   only. Each runs after a tenant-scoped `select … for update`, so nothing leaks, but adding `tenant_id` costs nothing.
5. **Proposal ids.** `'OP-' + randomBytes(4)` (`proposals.ts:99`) is 32 bits against a *global* primary key. A collision
   gives a 500. Use 8 bytes or retry on conflict.
6. **Locale-dependent sha.** The canonical sort for the sha uses `localeCompare` (`proposals.ts:30`), which depends on the
   locale. It is consistent within one process, but a plain `<` comparison is safer for a hash.
7. **Audit subject from the URL.** A 404 decision or withdraw writes a denied audit row whose `subject` is the
   caller-supplied URL id (`proposals.ts:127`, `:168`), with no length cap beyond the URL limit. That is harmless but
   unbounded. Refused creates (`ORG_CHANGED`, `DUPLICATE_PROPOSAL`) are not audited. They are not writes, so this is
   consistent with the brief.
8. **Retried approvals.** The decision route has no Idempotency-Key. A retried approve after a lost response gets
   `PROPOSAL_NOT_PENDING` instead of the stored result. The UI recovers because it re-reads the list
   (`orgProposals.ts` `decideProposal` catch → `bumpProposals`). Acceptable; note it.
9. **Missing "stale" chip after agent creation.**
   - `POST /agents` creates a revision but emits only `agent.created`. `events.ts:68` reloads the catalog (and so the
     graph) but not the proposals list.
   - The list's `activeRevision` stays old, so the "stale" chip is missing and Approve stays enabled until the next
     `org.*` event. The server still refuses with `ORG_CHANGED`, shown inline.
   - Fix: also call `proposals('o')` on `agent.created`.
10. **Silent rebase in the dialog.** When `useOrgGraph` refetches (`org-proposals.tsx:31`), the dialog moves to the new
    revision: the edges are recomputed and the "from org revision N" chip updates. That is correct (D2's danger cannot
    happen through the UI), but the user isn't told. A one-line notice would help.
11. **Live refresh depends on the catalog load.** The live graph refresh depends on `loadAgents()` succeeding
    (`events.ts:71` → `agents.ts:43` bumps `v` only on success → `useOrgGraph` deps `agents.ts:118-120`). If the catalog
    call fails, the Hierarchy stays on the old revision until the next event.
12. **No concurrent double-approve test.** The CAS miss path (`proposals.ts:150`) is unreachable in practice, because of
    the `org-rev` lock plus `FOR UPDATE`, and it is untested. Two parallel approves asserting a single revision would
    document it.
13. **Owner rules not verified.** "Fits one screen" and the animation and icon rules for the new panel and dialog were
    not verified by me (no browser). The screenshot is committed (`web/docs/screenshots/improve-c01-proposals-dark.png`).
14. **Out of scope, for the record.** One admin can mint the "second admin" (`PATCH /users/:id {role:'admin'}`), so the
    two-person rule is only as strong as admin promotion. That belongs to auth, not this cycle.
15. **Process.** The implementer wrote and committed its own "review fixes" (`ded4043`). This review covers the whole
    range including that commit, so nothing is unreviewed, but the step-6 "one round of fixes" should be counted from
    this review.

## 1. Spec compliance

| Brief item | Status | Evidence |
|---|---|---|
| Migration 0013, every column, partial unique index | OK | `migrations/0013_org_proposals.up.sql:4-25` (adds `jsonb_typeof` and `applied⇔applied_revision` checks); down drops only the table |
| `validateOrg` pure, `{ok, errors, warnings, added, removed}` | OK | `server/src/organization/validate.ts:23-85` |
| Errors: unknown, self, cycle (seen-set, 64), multi-manager, active non-GM without manager | OK as written (see I-2) | `validate.ts:29-63` |
| Warnings: manager without reports, dept without head | OK (head = reports to GM, documented) | `validate.ts:65-76` |
| Invalid proposal stored, never approvable | OK | stored with `result` `proposals.ts:98-102`; re-validated at approval `:144-145` (422) |
| `GET /organization/proposals` every signed-in user | OK | `proposals.ts:71-78` `requireUser` |
| `POST` admin, Idempotency-Key, 409 `DUPLICATE_PROPOSAL` | OK | `:81`, `:89` `idempotent`, `:96-97` plus the unique index |
| Decision admin-only, `SELF_APPROVAL` 403, `PROPOSAL_CHANGED`, `ORG_CHANGED`, `PROPOSAL_EXPIRED`, `ORG_INVALID` | OK | `:118`, `:128`, `:132-133`, `:143`, `:129`, `:145` |
| Approve applies in the same tx with `UPDATE … WHERE status='pending' RETURNING` | OK | `:146-150` (throws on a miss → the revision rolls back) |
| Withdraw by author while pending | OK | `:161-180` |
| Expiry on read and decision, no timers | OK | `expireDue` `:60-68`, called at `:74`, `:91`, `:125`, `:166` |
| Audit every write | OK | create `:104`, decide ok/denied `:138`, `:151`, `:113`, revision apply `:152`, withdraw `:174`, expire `:64` |
| 3 events, audience all, subjectKind `org`, in the `EventType` union | OK | `:65`, `:105`, `:139`, `:153-154`; `emit` defaults audience to `all` (`events/hooks.ts:9`); `shared/contracts/src/events.ts` |
| Running missions untouched | OK | no `agent_instances` write; test compares `manager_instance_id` before and after |
| Web list fields, dry run colours, "A → B" | OK | `ServerProposals.tsx` `ProposalCard`, `DryRunView` |
| New-proposal dialog from the active graph, pickers, title and why, dry run before submit | OK | `org-proposals.tsx` (`?dryRun=1`, debounced, `:54` sig) |
| Approve/Reject for non-author admins, Withdraw for the author, members read-only | OK | `ServerProposals.tsx:105-120`, `:129`, `:143` |
| Errors inline | OK | card `role="alert"` `:104`; dialog `org-proposals.tsx:130` |
| Live: `org.*` refreshes the list, `org.revisionApplied` refreshes the graph | OK | `events.ts:70-71`, `:101` listener list, `:97` reconnect |
| `?` help entries | OK | 6 keys in `help/pages/overview-org-agent.ts` |
| Tests listed in the brief | OK | see section 3 |

**Declared deviations, accepted.** They are stricter than or compatible with the brief:
- `baseRevision` is required on POST (409 `ORG_CHANGED`);
- `?dryRun=1` stores nothing;
- stale or invalid proposals stay `pending`, and `failed`/`approved` are never written;
- `SELF_APPROVAL` also applies to reject;
- withdraw needs admin *and* author;
- `PROPOSAL_NOT_PENDING` is added;
- a separate `api-improve.mjs`.

**Missing:** nothing from the brief. **Extra:** nothing outside the brief's scope besides the above.

### Pass threshold
1. **Server tests.** Every brief test case has a matching test: `org-validate.test.ts` has 10 tests and
   `proposals.test.ts` has 19, which matches the claimed 219 → 248. **I did not run them.**
2. **Browser check.** `web/scripts/api-improve.mjs` covers every step: A creates, B (second admin) approves, C (member)
   gets the Hierarchy update live with a no-reload marker plus a framenavigated count of 0, and C sees the list
   read-only. The hooks it relies on (`data-org-revision`, `data-manager`, `path[data-from][data-to]`) already exist in
   `features/agents/AgentHierarchy.tsx`. **I did not run it.**
3. **Demo mode.**
   - `Proposals()` switches on `isApi()` (`OrgSections.tsx:188`), and `DemoProposals` is the old body, renamed only.
   - `Agents.tsx` changes the toolbar text only in api mode.
   - The new dialog calls `useOrgGraph`, whose `useRead` is guarded by `isApi()` (`api/agents.ts:97`).
   - **I did not run `verify-all.sh`.**
4. **Nothing invented: verified.** Cards render only stored fields and counts derived from them (`ServerProposals.tsx`).
   There are no percentages or estimates, and the e2e asserts there is no `\d+%` and no coverage, latency or tokens.

## 2. Security and integrity

- **Admin-only writes:** `requireAdmin` on create, dry run, decision and withdraw (`proposals.ts:81`, `:118`, `:162`).
  The GET uses `requireUser`. OK.
- **Self-approval:** `p.created_by === ctx.user.id` → 403, audited as denied (`:128`). Tested. OK.
- **TOCTOU:** the decision takes the `org-rev` advisory lock first (`:124`), then `expireDue`, then the row
  `FOR UPDATE` (`:126`). The sha check (given and recomputed, `:132`), the base check against `max(seq)` (`:142-143`),
  re-validation, `createOrgRevision` and the CAS update all run in the same transaction. On the proposal side this is
  correct. The hole is on the other writer, `POST /agents` (I-1).
- **Apply-once:** the row lock plus the CAS on `status='pending'` plus the check
  `(status='applied') = (applied_revision is not null)`. A second decision is 409 (tested). OK.
- **`org_edges` append-only:** untouched. The only writes go through `createOrgRevision` (insert). The triggers are
  re-asserted by a test. OK.
- **Tenant scoping:**
  - Every read and select is scoped (`:40`, `:44`, `:61`, `:75`, `:96`, `:126`, `:167`).
  - `createOrgRevision`'s agent check is scoped (`org.ts:35`).
  - The id-only follow-up statements are Minor 4.
- **Idempotency:** create runs inside `idempotent` (key, work and response in one transaction). The dry run needs no key
  and writes nothing. The decision is naturally guarded by the CAS (Minor 8). OK.
- **Audit:** every state change and every refused decision or withdraw. Refusals commit before the error is thrown
  (`:157`, `:178`). Expiry is audited as `system`. OK.
- **Events:** audience `all` (the default in `emit`), `subjectKind: 'org'`. The test asserts `audience='all'` and
  `subject_kind='org'`. OK.
- **Nothing loosened:**
  - no auth, visibility, append-only or execution-guard code changed;
  - no existing test was edited;
  - migrations 0001–0012 untouched;
  - `api-stage6.mjs` untouched.

  The e2e script's DB write is limited to `axion_e2e` and refuses any other URL. OK.

## 3. `validateOrg` correctness and tests

Correct for:
- unknown agents (either end);
- self-lines;
- multiple managers;
- loops of any length (every node on a loop is a start in `up`, so each loop is found);
- chains deeper than 64 (65 levels is `CYCLE`, 64 is ok, the same as `assertAcyclic`);
- active non-GM agents without a manager (retired agents exempt);
- added/removed as a set difference.

Gaps: I-2 (charts not rooted at the GM, retired managers) and Minor 1 and 3.

The tests assert real behaviour:
- exact `toEqual` on `errors`, `warnings` and `added`/`removed`;
- database state after refusals (expiry committed, denied audit rows);
- the edge-set equality of the new revision;
- a non-empty `manager_instance_id` set before and after;
- tampered stored content (`edges - 0`).

The reported mutation check, with the stale and self guards removed (4 failures), is plausible from the tests.

Missing tests:
- a ≥3-agent cycle;
- I-2's cases;
- the I-1 regression;
- concurrent approves (Minor 12).

## 4. Web
- **Demo mode unchanged:** yes (see threshold item 3).
- **Api mode shows only stored facts:** yes.
- **Live:** `org.*` re-reads the list, and `org.revisionApplied` reloads the catalog, so `useOrgGraph` refetches (see
  Minor 9 and 11).
- **Members:** no New proposal button, a "Read only" chip, no card buttons. The server enforces this anyway.
- **Errors:** inline per card (kept even when the card leaves the filter) and in the dialog.

## 5. Ruling on the `POST /agents` race
**Confirmed** from `agents/routes.ts:66-69` together with `agents/org.ts:39-40, 51`. It is worse than reported: taking the
lock earlier is not enough while the read still uses `activeRevision()`, because of the `active_from = transaction start`
visibility gap.

**Fix it in this cycle's fix round, with the deterministic regression test from I-1.** Reasons:
- Before this cycle, the only revision writers were the seed and `POST /agents` itself, serialised by `agent-create`.
  This cycle adds a second writer, and that is what makes the race reachable.
- The race directly breaks the feature's guarantee: an "applied" proposal can be undone without any error, event or
  audit trace.
- The change makes the system stricter, so it is allowed by the safety rules, and it stays local to `agents/routes.ts`
  (plus a shared `latest()` helper).
