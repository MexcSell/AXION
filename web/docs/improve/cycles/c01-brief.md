# Cycle 1 (theme A, company structure): organisation change proposals, from simulated to real

## Hypothesis
Today, changing the company structure in api mode is only possible as a side effect of creating an agent. The Proposals
tab is a DEMO that changes nothing. After this cycle an administrator can propose a new set of reporting lines. The
server validates it before anyone can approve it, and approval applies it exactly once as a new org revision. Every
step is audited and can't be applied against a stale org. That makes the company's structure changeable under
governance (spec §10.9 "company improvement", §4.11 L4, Stage 11 "versioned organizational chart/revision").

## Measure and pass threshold (fixed now; never lowered)
1. Server tests: every case under **Tests** passes; the whole server suite stays green (219 → 219+N, 0 failures).
2. Browser check (api mode): an admin creates a proposal in Agents › Proposals and sees its dry-run result. A second
   admin approves it, and the org chart (Agents › Directory › Hierarchy) shows the new reporting line live in a third
   browser **without reload**. A member sees proposals read-only. Pass = all steps green.
3. Demo mode unchanged: `verify-all.sh` green.
4. Nothing invented: the cards show only stored facts (lines added/removed, coverage check, base revision, status).
   No coverage/latency/token percentages in api mode.

## Server
- **Migration `0013_org_proposals`.** Migrations 0001–0012 are frozen.
  - Table `org_proposals`:
    - `id` text pk, `tenant_id`, `title`, `why`;
    - `base_revision` int (the active revision when proposed);
    - `edges jsonb`: the full proposed set of `{supervisor, subordinate, edge_type}`;
    - `payload_sha` text: sha256 of the canonical title + why + base_revision + sorted edges;
    - `status` (`pending|approved|rejected|applied|failed|expired|withdrawn`);
    - `created_by`, `created_at`, `expires_at` (created + 7 days);
    - `decided_by`, `decided_at`, `decision_note`;
    - `applied_revision` int;
    - `result jsonb` (the dry-run report).
  - A unique partial index on (tenant_id, payload_sha) where status='pending': no duplicate pending proposals.
- **Dry run `validateOrg(edges, agents)`**, a pure function with unit tests. It returns
  `{ok, errors[], warnings[], added[], removed[]}`.
  - Errors:
    - an unknown agent;
    - self-management;
    - a reporting cycle (walk the chain with a seen-set, limit 64);
    - more than one manager for an agent;
    - an active agent other than `gm` with no manager.
  - Warnings: a manager with no reports; a department without a head.
  - A proposal with errors can be stored (so the admin sees why) but can never be approved.
- **Routes (prefix `/api/v1`):**
  - `GET /organization/proposals`: every signed-in user can read them.
  - `POST /organization/proposals {title, why, edges}`: admin only. Needs an Idempotency-Key. 409 `DUPLICATE_PROPOSAL`.
  - `POST /organization/proposals/:id/decision {decision:'approve'|'reject', note?, sha}`: admin only.
    - The approver must not be the author: 403 `SELF_APPROVAL`, the subnet-scout rule "never grants itself authority".
    - A `sha` that doesn't match → 409 `PROPOSAL_CHANGED`.
    - When the active revision ≠ `base_revision` → 409 `ORG_CHANGED` (stale).
    - An expired proposal → 409 `PROPOSAL_EXPIRED`.
    - A proposal with dry-run errors → 422 `ORG_INVALID`.
    - Approve → apply in the same transaction, using `UPDATE … WHERE status='pending' RETURNING`: insert a new
      `org_revisions` row plus its `org_edges`, set `applied_revision` and status `applied`. Reject → `rejected`.
  - `POST /organization/proposals/:id/withdraw`: the author only, while pending.
  - Expiry: on read and on decision, a pending proposal past `expires_at` becomes `expired`. There are no timers.
- **Audit and events:**
  - Every write gets an audit row.
  - Events `org.proposalCreated`, `org.proposalDecided` and `org.revisionApplied`, audience all, subjectKind `'org'`.
    Add them to the `EventType` union in `shared/contracts`.
  - Running missions are untouched: instances keep their managers. Only `/organization/graph` changes.

## Web (api mode only; demo mode keeps today's DEMO Proposals exactly)
- **Agents › Proposals** lists server proposals with: title, why, author, age, status chip, base revision, and the dry-run
  result (errors in red, warnings in amber, lines added and removed as "A → B").
- **Admins:** a "New proposal" dialog.
  - Start from the active graph; change a subordinate's manager with pickers (agent → new manager); add an optional
    title and why.
  - The server's dry run is shown before submit: call POST and show the stored result, or add a `?dryRun=1` mode on POST
    that stores nothing. Your choice; document it.
- **Admins who are not the author:** Approve and Reject, with an optional note. Authors get Withdraw.
- **Members:** read-only.
- **Errors:** `ORG_CHANGED`, `PROPOSAL_CHANGED`, `SELF_APPROVAL` and the other codes show the server message inline.
- **Live:** org events refresh the proposals list and the org graph live; `useOrgGraph`, or whatever Task 7 uses, must
  refetch on `org.revisionApplied`.
- **Help:** add `?` entries for the new controls. `check-help` must stay green.

## Tests (write first)
- **validateOrg unit tests** for each error and warning above.
- **Proposals and permissions:**
  - a proposal by admin A, approved by admin B, becomes a new revision with exactly the proposed edges;
  - A approving their own proposal → 403;
  - a member posting → 403;
  - an invalid proposal → 422 on approval;
  - two pending proposals with the same sha → 409.
- **Base and payload checks:**
  - stale base → 409. Approve P1, then P2, which shares the same base, → `ORG_CHANGED`;
  - a tampered sha → 409.
- **Lifecycle:**
  - expired → 409, and the status shows `expired`;
  - withdraw works only for the author.
- **Running missions:** a mission's instances keep their `manager_instance_id` after a revision is applied.
- **Integrity:** UPDATE/DELETE on `org_edges` still throws; the append-only rule is untouched.
- **Migration:** 0013 up/down/up on a populated schema (seeded agents plus a demo mission).
- **api-stage6.mjs** gets the browser flow from "Measure and pass threshold", item 2. A separate script
  `api-improve.mjs` is fine too.

## Constraints
- **Never touch the live system:** don't run anything against the real `axion` database or the API on 127.0.0.1:5191,
  and never restart 5190.
- **Keep the safeguards:** don't loosen any auth, visibility, append-only or execution-guard rule, and don't weaken any
  existing test.
- **Owner UI rules:** icon-first, animated, `?` help, the shared page frame, fits one screen. Use the Agents page's
  existing panel style.
- **Verify:**
  - `cd server && npx tsc --noEmit -p . && npx vitest run`
  - `cd web && npx tsc --noEmit -p . && ./scripts/api-e2e.sh api-auth-flow.mjs api-flows.mjs api-stage6.mjs [api-improve.mjs] && ./scripts/verify-all.sh`
- **Commit** on branch `improve-30h`, only the files you changed. End the message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
