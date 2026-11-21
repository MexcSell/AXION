# Cycle 4 review: org history, before/after diff, rollback through governance (theme A)

Independent review of branch `c04-org-history` (worktree `/home/luca/AXION-w2`, `f7c7bca..5180d91`, 5 commits) against
`c04-brief.md` and the PROCESS.md safety rules. The review was read-only: I ran no tests, servers or database commands. Run
results (server 343/343, api e2e 104/104, verify-all EXIT 0) come from the implementer report. I checked that the code
and tests could produce them; I did not reproduce them. Paths below are relative to `/home/luca/AXION-w2`.

## Verdicts

- **Spec compliance: PASS on thresholds 1–3; threshold 4 ("demo mode unchanged") NOT MET until I1 is fixed.** Every server
  route, error code, test case and web element in the brief has code and a test or browser check behind it. The
  deviations (D1, D2, the extra `demo` field) are all stricter than the brief or only add information. I1 is a literal
  breach of a fixed threshold, so threshold 4 is not counted as met even though the fix is one line.
- **Quality: APPROVE WITH ONE FIX (Important I1).** The governance path is sound. A rollback cannot write the chart
  directly, the cycle 1 decision route is byte-for-byte untouched, and the tests assert real behaviour. One CSS rule leaks
  into an existing panel, including in demo mode, which breaks the literal "demo mode unchanged" (threshold 4). The fix is
  one line.

## Critical

None.

## Important

**I1. `.oa-timeline` is redefined globally, so the existing "Revision History" panel on Agents › Policies changes in
demo mode (and in api mode).**
- Evidence:
  - `web/src/theme/pages/overview-org-agent.css:315-316` adds a second, unscoped `.oa-timeline` rule
    (`max-height: min(60vh,520px); overflow-y: auto; padding: 2px 4px 2px 0`) and a `.oa-timeline::before` 2px accent
    gradient line at `left: 17px`.
  - The class already exists at `:162` and is used by `Policies()` → "Revision History" in
    `web/src/features/agents/OrgSections.tsx:166`, which renders in both modes.
- Effect: with `box-sizing: border-box` (`theme/base.css:1`), the `.oa-tl` dots sit at x 4–15px and the text starts at
  25px. The new pseudo-element therefore draws a stray vertical line between the dots and the text of the demo policy
  history. The panel also gains a max-height/overflow and changed padding. `POLICY_HISTORY` (`data/orgdemo.ts:79`) has
  4 entries, so the max-height does not clip today.
- Basis: static reading of the CSS (no other `.oa-timeline::before` rule exists). It was not rendered, because no servers
  were allowed, so the controller should eyeball the Policies panel.
- Why nothing caught it: verify-all's crawl detects errors and overflow, not visual changes, so it passed.
- Brief impact: it breaks "Web (api mode; demo mode unchanged)" and threshold 4 literally. It is cosmetic, but it is
  exactly the regression that rule exists to prevent.
- Fix: scope the new rules (`.oa-hist .oa-timeline { … }` and `.oa-hist .oa-timeline::before { … }`) or rename the class
  to `oa-htimeline`. Then confirm that the Policies panel looks as it does on `f7c7bca`.

## Minor

- **m1. Seed revision impact.** The diff of revision 1 (against 0) lists every instance of every agent in every active
  visible mission as "affected", because every line counts as "added" (`history.ts:115`).
  - This is technically consistent with D4, but it does not mean "manager changed" for the seed.
  - Suggestion: for `against = 0`, either skip the impact or label it "all lines new".
- **m2. Terminal statuses only partly tested.** `failed` and `canceled` are excluded by `FINAL` (`history.ts:26`), but
  only `completed`, `archived` and deleted have fixtures (`org-history.test.ts:52-54`). The implementer's mutation check
  replaced the whole filter, so a dropped single status would go unnoticed. Add one `canceled` fixture.
- **m3. Source lookup cost.** The `agent.create` source lookup is a lateral subquery per revision over `audit_events`,
  filtered by action and a `detail` cast (`history.ts:34-35`). The only index is `(tenant_id, at)` (`0001_core.up.sql:63`),
  so `GET /organization/revisions` costs O(revisions × tenant audit rows).
  - Every client re-reads it on every `org.*` / `agent.created` event (`events.ts:75`).
  - It is fine today. It needs a bound (or a stored source) before the audit log grows; the report already flags the
    edges half of this.
  - Separately, the `(x.detail->>'revision')::int` cast relies on `jsonb_typeof(...) = 'number'` being evaluated first,
    which Postgres does not guarantee. It is harmless while only `POST /agents` writes integer `revision`.
- **m4. The 422 browser check is not natural.** The browser 422 check rewrites the request URL from revision 1 to
  revision 2 (`api-improve.mjs`, c04 "422" step). A natural 422 is available later in the same flow: revision 1 after
  revision 3 has the same lines. That would exercise the real UI path without route interception. This is not a weakening,
  since the server test covers both 422s (`org-history.test.ts:162-166, 230-234`).
- **m5. Circular import.** `OrgHistory.tsx:18` imports `Line` from `ServerProposals.tsx`, which imports `OrgHistory`.
  It works (render-time use only) but is fragile. Move `Line` to a small shared module.
- **m6. Pointless rollback button.** The rollback button is offered on a non-latest revision whose lines equal the active
  revision's (e.g. revision 1 after revision 3). The click always yields 422. The `changed` counts already in the list
  can't tell when lines are identical, so either hide the button using the diff against the latest, or accept the 422 as
  designed (D2).
- **m7. Rollback past a newer agent.** Such a rollback (the declared NO_MANAGER → 422) is stored as a pending proposal
  that can never be approved. This is consistent with cycle 1, which also stores invalid proposals with their errors, and
  it is tested (`org-history.test.ts:260-272`). But after any agent creation, most rollbacks become dead proposals.
  - The report's backlog idea, "reverse only this revision's diff on the latest lines", is the right follow-up.
  - Until then, the help text could say that a rollback past a newer agent cannot be approved.

## Checks with evidence

### 1. Spec compliance and pass threshold

| Brief item | Status | Evidence |
|---|---|---|
| `GET /organization/revisions/:seq`: lines, who, when, source (proposal via `applied_revision` / agent created / seed) | Met | `history.ts:30-44, 94-103`. Source is a join on `org_proposals.applied_revision = r.seq` within the tenant, then the `agent.create` audit row with `detail.revision` (written at `agents/routes.ts:80`), then `created_by='system'`. Tests at `org-history.test.ts:79-99, 244`. |
| `GET …/diff?against=`: default seq−1 (the previous existing revision); `{added, removed, moved, impact}` | Met | `history.ts:57-59, 105-118`; `diffLines` at `validate.ts:126-137` (pure; `validateOrg` unchanged). Tests at `:63-74, 109-136, 255-258`. |
| `impact`: visible (`VISIBLE_SQL`), not terminal or archived; pure, no writes | Met | `history.ts:65-77`: tenant on both `m` and `i`, `deleted_at`/`archived_at` null, status not in `FINAL`, `VISIBLE_SQL('$2','$3')` with the same signature as `approvals/routes.ts:21`. The GETs call no `expireDue`, audit or emit. Test at `:138-143` counts audit, events and revisions before and after. |
| `POST …/rollback-proposal`: admin only, Idempotency-Key, same code path, latest base, title | Met | `history.ts:124-142` → `createProposal` (`proposals.ts:76-96`). `POST /organization/proposals` now calls the same function (`proposals.ts:121`). |
| Duplicate → 409; latest → 422; different admin approves | Met | `history.ts:134-138`; decision route unchanged (`proposals.ts:131-174`, no diff hunk). Tests at `:162-166, 189-207`. |
| No new tables or migration; events reused | Met | No `server/migrations` change in the diff; `org.proposalCreated` gets an additive `rollbackTo` (`proposals.ts:93`). |
| Web: Segmented "Proposals \| History", timeline newest first with number, when, who, source and "N lines changed" | Met | `ServerProposals.tsx` (switcher in both panel heads); `OrgHistory.tsx:36-55, 138-189`. |
| Diff view: "Agent: old → new", added and removed lines, affected missions with links | Met | `OrgHistory.tsx:68-108`. |
| Admin rollback on non-latest revisions; 409/422 message; switch to Proposals with highlight | Met | `OrgHistory.tsx:110-136, 180`; `ServerProposals.tsx` `onRolledBack` → Pending + `data-highlight`. |
| Members read-only | Met | `OrgHistory.tsx:154, 180` (admin-gated); browser check (member C, last c04 check). |
| `?` help (new proposal, second admin, never changes running missions) | Met | `overview-org-agent.ts`, `org.history.rollback`. |
| Live refresh on `org.*` | Met | `orgProposals.ts` `useRead` keyed on the proposals tick; `events.ts:75` bumps it on `org.*` and `agent.created`. |

Pass threshold:

1. **Server tests: met.** All 12 brief test bullets map to tests in `server/test/org-history.test.ts` (22 tests). The
   suite figure of 343/343 is from the report.
2. **Browser flow: met.** `web/scripts/api-improve.mjs` c04 section:
   - P1 moves Coder-01;
   - History shows revisions [2, 1];
   - the diff shows exactly one move (`data-moved="coder-01"` from gm to ops-01, `data-line` count 0);
   - A clicks rollback, which stores a pending "Roll back to revision 1" on base 2 with revision 1's lines and a reverse
     dry run;
   - B approves ("applied as rev 3");
   - the server's revision 3 has revision 1's lines;
   - C's Hierarchy goes to revision 3 with `path[data-from=gm][data-to=coder-01]`, with no reload and no navigation.

   The c04 checks use condition waits only. The older `waitForTimeout` calls belong to cycles 1 and 3.
3. **Impact, never changed: met.**
   - Server: every `agent_instances.manager_instance_id` is identical after the applied rollback, with a non-vacuous
     guard that impacted instances have non-null managers (`org-history.test.ts:209-228`).
   - Browser: a SELECT-only before/after comparison on the e2e database.
   - No code path in the diff writes `agent_instances`.
4. **verify-all green, demo unchanged: NOT MET (until I1 is fixed).** verify-all EXIT 0 per the report, and
   `DemoProposals` is untouched, but I1 changes a panel that demo mode renders.

### 2. Security and integrity

- **Rollback is never a direct write.** The rollback route only calls `createProposal`, which inserts an `org_proposals`
  row. The only writer of `org_revisions` / `org_edges` remains `createOrgRevision`, called from the cycle 1 decision
  route. The decision route still applies every cycle 1 safeguard (`proposals.ts:131-174`):
  - the `lockOrg` lock;
  - `expireDue`;
  - `SELF_APPROVAL`;
  - the sha re-check (`PROPOSAL_CHANGED`);
  - the stale base check (`ORG_CHANGED`);
  - the dry-run re-validation (`ORG_INVALID`);
  - compare-and-set on `status='pending'`.

  Tests cover self-approval (`:202-207`), the stale base (`:236-253`) and the invalid dry run (`:260-272`).
- **One lock-then-read path.**
  - The rollback takes the same `org-prop:` advisory lock (`lockProposals`, `proposals.ts:69`) before reading the latest
    revision and the pending set.
  - `createProposal` re-takes it (re-entrant within the transaction) and re-reads latest. A revision committed
    concurrently by `POST /agents`, which uses another lock, makes the second read fail closed with `ORG_CHANGED` 409.
  - The extraction of `createProposal` is a pure move. Same statements, same order, same messages: compare the removed
    block of `POST /organization/proposals` with `proposals.ts:76-96`.
- **Admin-only creation and read-only members.**
  - `requireAdmin` runs first (`history.ts:125`), so a member gets 403 before the key or the 404 is checked (test
    `:150-154`).
  - The GETs need `requireUser` (401 test `:142`).
- **Tenant scoping.**
  - Every revision lookup is by `(tenant_id, seq)` (`history.ts:48, 53, 58`).
  - Edges are fetched by the revision id from those lookups.
  - The list's edges query joins `org_revisions` on the tenant (`:84-85`).
  - The user and proposal joins are tenant-bound (`:32-33`).
  - Tests cover cross-tenant 404s for read, diff, `against` and rollback, and the same seq number showing the caller's
    own lines (`:275-286`).
- **Impact visibility.**
  - Tenant on both missions and instances, plus `VISIBLE_SQL`.
  - The member does not see the admin's private H1 but does see her own H7 and the shared H2. Another tenant's O1 is
    excluded (`:109-123`).
- **Append-only tables untouched.** No UPDATE or DELETE on them in the diff, and the integrity test is at `:289-293`.
- **Idempotency.**
  - `idempotent()` hashes `method + url + body` (`idempotency.ts:18`), so reusing a key for another revision is 422, not
    a wrong replay.
  - Replay of the same key returns the stored 201 (`:189-192`).
  - Refusals throw inside the transaction, so they consume no key and leave no partial rows.
- **Audit.**
  - `org.proposal.create` carries `rollbackTo` (test `:183`).
  - Approval and apply are audited by the unchanged cycle 1 route.
  - Refused creations (409/422) are not audited. That matches cycle 1's create route, so it is not a regression.

### 3. Diff correctness, provenance, and the "stale pending doesn't block" change

- **`diffLines`.** It keys lines by subordinate, which is correct because `org_edges` has one line per subordinate per
  revision:
  - moved = present in both with a different supervisor;
  - added = only in after;
  - removed = only in before.

  Output is sorted with a locale-independent comparator. Covered by a pure test plus the API cases for moved (rev 2,
  rev 3), added (rev 4, rev 1 against 0) and removed (rev 3 against 4).
- **`changed` count.** The list route computes it with the same function against the previous revision in seq order
  (`history.ts:88-90`).
- **Provenance.** "Proposal" is a stored fact (`applied_revision`, set only by the decision route). So is "agent", from
  the `agent.create` audit `detail.revision`. "Seed" is `created_by='system'`, and the fallback is `other` plus the note.
  Nothing is inferred from free text.
- **Stale pending rollback no longer blocks.** This cannot create duplicate pending proposals that cycle 1 forbids:
  - Cycle 1's rule is "same `payload_sha` pending". It is enforced in code (`proposals.ts:83-84`, still run for rollbacks)
    and by the unique index `org_proposals_pending_sha` on `(tenant_id, payload_sha) where status='pending'`
    (`0013_org_proposals.up.sql:24`).
  - The sha includes `baseRevision`, so a proposal on base 3 and one on base 4 were never duplicates under cycle 1.
  - The rollback-specific check (`pendingWithEdges`, `proposals.ts:99-102`) is an *additional* rule: same lines on the
    latest base, whatever the title or why. Restricting it to the latest base relaxes nothing that cycle 1 enforced.
  - Two pending proposals with identical lines can only coexist when one is stale. A stale proposal can only be rejected
    or withdrawn (`ORG_CHANGED` at decision).
  - The test at `:260-264` asserts the stale one stays pending while the new one is 201.
  - jsonb equality there is order-sensitive, but both sides go through the sorted `toStored`, so the comparison is
    sound.
- **Caveat (cycle 1 behaviour, not new).** A plain `POST /organization/proposals` with the same lines but another title
  is still allowed. The stricter lines rule applies only to rollbacks.

### 4. Tests assert real behaviour; nothing weakened

- **New server tests.** Written first, per the RED evidence in the report. They use exact `toEqual` on moved lines,
  impact instance lists, dry-run added/removed and the whole `agent_instances` table. Before/after row counts prove
  "reads write nothing". There are no vacuous checks except the one the report calls out (404 before the route existed).
- **Diff stat.** The only test file touched in `server/test` is the new one.
- **Member count 4 → 5 (`api-improve.mjs`): justified, not a weakening.**
  - The c04 flow is inserted into the cycle 1 flow and adds exactly one proposal (the rollback).
  - The check is still an exact count, now 5 = cycle 1's four plus the rollback.
  - No other cycle 1 check was removed or relaxed: the only other removed lines are the moved e2e guard.
  - Later cycle 1 steps read `/organization/graph` fresh (`g2`, `g3`), so they do not depend on the revision number.
  - The cost is coupling. The cycle 1 flow now depends on the c04 insertion point, and merges with other lanes may
    conflict (the report says so).
- **E2E guard `axion_e2e\d*`.** It is the same rule as `server/src/cli/e2e-serve.ts:18`. It still refuses any non-e2e
  database and is read before the SELECT-only `managers()` helper, so it is not a loosened safeguard.

### 5. Web

- **Demo mode.** `DemoProposals` is untouched, and History exists only inside `ServerProposals`, which runs only when
  `isApi()` is true (`OrgSections.tsx:188`). The exception is the CSS leak (I1).
- **Api mode shows stored facts only.**
  - Revision cards show seq, source, author, `activeFrom` and the server's `changed`.
  - The diff and impact come from the server.
  - DEMO missions carry the `DemoTag` and are named honestly.
  - A browser check asserts no percentages or estimates.
  - The screenshot (`web/docs/screenshots/improve-c04-history-dark.png`) matches.
- **Fit.**
  - A 1366×768 condition-waited check reports no page or sideways scroll.
  - The timeline (`max-height`) and the impact list (180px) scroll internally.
  - The 1600×940 screenshot shows the whole view with room to spare.
- **Live.** The revisions list and the open diff re-read on the shared tick. The browser check shows A's History going to
  revision 3 and C's Hierarchy updating with no reload.
- **Keys.** One Idempotency-Key per revision selection, renewed after any failure. A lost success response followed by a
  retry hits the lines-duplicate 409, never a second proposal.

## Recommendation

Fix I1 (scope the CSS, and confirm that Agents › Policies "Revision History" looks as it does on the base in demo mode),
re-run `verify-all.sh`, then merge. m1–m7 can go to the backlog. m7, the "reverse only this revision's diff" rollback, is
the one with real user value.
