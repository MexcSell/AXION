# Cycle 4 (theme A, company structure): org history, before/after diff, and rollback through governance

## Hypothesis
Cycle 1 made organisation changes real, but an applied change can't be inspected or undone. The only record is a row
count. After this cycle an administrator sees the org chart's history as a timeline of revisions, can compare any
revision with the one before it as a before/after diff, and can see which missions would be affected. They can start a
**rollback** to an earlier revision. The rollback is never a direct write: it creates an ordinary cycle 1 proposal whose
lines are those of the earlier revision, so the dry run, the two-admin approval, the stale check and the audit trail all
apply. Spec §10.9 ("Rollback: keep immutable previous revision … record new auditable decision"); Stage 11 ("visual
before/after organization graph … impact analysis for active missions"). Pattern: subnet-scout keeps line history and
reverses changes by a new request (`og_lines`, `og_requests`).

## Measure and pass threshold (fixed now; never lowered)
1. Server: the tests below pass; the whole suite stays green.
2. A browser check in api mode:
   - admin A applies proposal P1, which moves one line (cycle 1 flow);
   - the history shows revisions 1 and 2, and the diff for revision 2 shows exactly that moved line;
   - A clicks "Propose rollback to revision 1", which creates a pending proposal whose dry run shows the reverse move;
   - admin B approves it;
   - revision 3 has the same lines as revision 1, and the Hierarchy shows the old line again, live in a third browser.
3. Impact: for a revision diff, the server lists active missions with an instance whose agent's manager changed. It
   **never** changes those instances. A test proves that the instances' `manager_instance_id` stays the same after a
   rollback.
4. `verify-all.sh` stays green, and demo mode is unchanged.

## Server
- **`GET /organization/revisions/:seq`**: that revision's lines plus metadata: who created it, when, and from which proposal
  (`applied_from_proposal` if known; join through `org_proposals.applied_revision`) or "agent created" or "seed".
- **`GET /organization/revisions/:seq/diff?against=:seq2`**: the default `against` is seq−1.
  - Returns `{added[], removed[], moved[{subordinate, from, to}], impact: [{missionId, title, agentId, instanceId}]}`.
  - `impact` contains only missions the caller can see (`VISIBLE_SQL`) that are not terminal or archived.
  - It is pure computation with no writes; reuse `validateOrg`'s added/removed helpers if they exist.
- **`POST /organization/revisions/:seq/rollback-proposal {why?}`**: admin only, Idempotency-Key.
  - Creates an ordinary org proposal through the same code path as `POST /organization/proposals`, with edges = revision
    `seq`'s lines, `baseRevision` = the latest, and the title "Roll back to revision N".
  - A duplicate pending proposal → 409 `DUPLICATE_PROPOSAL`, as in cycle 1.
  - A rollback to the latest revision → 422 `NOTHING_TO_ROLL_BACK`.
  - The proposal still needs a *different* admin to approve it.
- **No new tables.** Only if a column is truly needed, add migration 0014 (0001–0013 are frozen).
- **Events:** reuse `org.proposalCreated`, `org.revisionApplied`.

## Web (api mode; demo mode unchanged)
- **Agents › Proposals gets a "History" view** (a Segmented switch "Proposals | History", or a sub-tab; keep the shared
  frame).
  - **Timeline:** one card per revision, newest first: number, when, by whom, the source (proposal title, "agent created"
    or "seed"), and a "N lines changed" chip.
  - **Selecting a revision** shows its diff against the previous one: moved lines as "Agent: old manager → new manager",
    added and removed lines, and the list of affected active missions with links.
  - **Admins** get "Propose rollback to this revision" on any non-latest revision. It shows the server message on 409
    and 422, and on success switches to the Proposals view with the new proposal highlighted.
  - **Members** see everything read-only.
- **`?` help** explains that a rollback is a new proposal, which needs a second admin and never changes running missions.
- **Live:** refresh on `org.*` events.

## Tests (write first)
- **Revisions and diff:**
  - revision detail and diff for added, removed and moved lines;
  - `impact` lists only visible, active missions, so a member doesn't see a private one, and terminal missions are
    excluded.
- **Rollback proposals:**
  - a rollback proposal's edges equal revision N exactly;
  - approval by a second admin yields a new revision equal to revision N;
  - the author can't self-approve (cycle 1 rule);
  - a stale base → 409 `ORG_CHANGED`;
  - rolling back to the latest → 422;
  - a member → 403;
  - another tenant's revisions → 404.
- **Running missions:** instances' managers are unchanged after the rollback is applied.
- **Browser:** the flow in "Measure and pass threshold" item 2 (extend `web/scripts/api-improve.mjs`). Use condition
  waits, never fixed sleeps.

## Constraints
- **Never touch the live system:**
  - don't run anything against the real `axion` database or 127.0.0.1:5191;
  - never restart 5190;
  - no `npm run dev`, `migrate` or `demo:*`.
- **Keep the safeguards:** don't loosen auth, visibility, append-only, the execution guard or any test. `org_edges` and
  `org_revisions` stay append-only.
- **Owner UI rules:**
  - icon-first, animated, `?` help;
  - the shared frame;
  - fits one screen (`fit-check`).
- **Verify:**
  - `cd server && npx tsc --noEmit -p . && npx vitest run`
  - `cd web && npx tsc --noEmit -p . && ./scripts/api-e2e.sh api-auth-flow.mjs api-flows.mjs api-stage6.mjs api-improve.mjs && ./scripts/verify-all.sh`
- **Commit** on `improve-30h`, only your files. End the message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
