# Cycle 5 report: agent version proposals, with promote and rollback under governance (theme C)

Lane w3: worktree `/home/luca/AXION-w3`, branch `c05-version-proposals`. Base commit `f7c7bca`. Brief: `c05-brief.md`, which
sits untracked in the main worktree and was not copied here.

## What I built

**Server**
- **Migration 0015 `agent_version_proposals`**, with exactly the brief's columns:
  - `id` is `VP-` plus 128 random bits; `expires_at` is 14 days after creation.
  - Two checks: `candidate` is an object, and `status='promoted'` holds exactly when `promoted_version_id` is set.
  - A unique partial index allows one pending proposal per `(tenant, agent, candidate_sha)`.
  - The down migration drops only that table.
- **Routes**, in `server/src/agents/versions.ts`:
  - `GET /agents/:id/version-proposals`.
  - `GET /version-proposals`, which lists every agent's proposals. This route is an **addition** to the brief; the Development tab needs it.
  - `POST /agents/:id/version-proposals`: admin, Idempotency-Key.
  - `POST /version-proposals/:pid/decision`.
  - `POST /version-proposals/:pid/withdraw`.
  - `POST /agents/:id/rollback`: admin, Idempotency-Key.
- **What a proposal carries**: base and candidate configs, a server-computed diff, `stale` (base ≠ active), and `evaluation: null`.
- **The decision sha** is sha256 over agent, base version id, base config sha, candidate, title and hypothesis.
  - `base_sha` is the base version's `prompt_hash`.
  - `candidate_sha` is `promptHash(candidate)`, so it equals the promoted version's `prompt_hash`. A test asserts this.
- **Decision order** inside one transaction, under the agent lock:
  1. 404 for a missing proposal or another tenant's.
  2. 403 `SELF_APPROVAL` for the author.
  3. Still pending (409 `PROPOSAL_NOT_PENDING` or `PROPOSAL_EXPIRED`).
  4. Base still active (promote only; 409 `AGENT_CHANGED`).
  5. The sha matches and the stored candidate is intact (409 `PROPOSAL_CHANGED`).
  6. Not expired (409 `PROPOSAL_EXPIRED`; the expiry is committed and audited).

  Refused decisions and withdrawals are audited as `denied` and commit, using the same pattern as cycle 1.
- **Promote** reuses the Stage 6 path. `switchVersion` calls the existing `addVersion` and then moves `row_version` on. The new
  version's parent is the base, and `promoted_version_id` is set by compare-and-set on `status='pending'`.
- **Rollback** creates a **new** version with the target's configuration, whose parent is the version that was active. It never
  deletes a version or reuses an id.
  - It returns 422 `ALREADY_ACTIVE`, 422 `VERSION_NOT_OF_AGENT` (another agent's version, or an unknown one), and 422
    `SAME_CONFIG` when the active version already has that configuration.
  - The reason (`why`) is required and audited.
- **Lock path**: `lockAgent` = `pg_advisory_xact_lock(hashtext('agent-ver:<tenant>:<agent>'))`. It is taken first, as its own
  statement, by all three writers of the active version (`PATCH /agents/:id`, promote, rollback) and by proposal creation, before
  they read the agent. `lockAndReadAgent` bundles the two steps.
  - Promote and rollback move `row_version` on. A PATCH that queued behind a promote therefore answers 409 through If-Match and
    never silently overwrites it.
  - No other code writes `active_version_id` (checked with grep).
- **Audit and events**:
  - Audit actions: `agent.version.propose|decide|withdraw|expire`, `agent.rollback`, and `agent.version` on each new active version.
  - Events, all with audience all and `subjectKind: 'agent'`: `agent.versionProposed`, `agent.versionPromoted`, `agent.rolledBack`
    and `agent.versionProposalDecided`. The last one covers reject, withdraw and expire; it is my addition so that other viewers'
    lists refresh.
  - Promote and rollback also emit `agent.versionCreated` and `agent.updated`.
  - All four new types are in the `EventType` union. Five error codes were added to `ERROR_CODES`.
- **Docs**: `server/README.md` gains the API, the test count (345) and the rollback line (`migrate -- down 14`). That command is correct both before and after lane 0014 merges.

**Web (api mode; demo mode unchanged)**
- **Agents › Development** (`ServerDevelopment` in `features/agents/VersionProposals.tsx`):
  - Each card shows title, agent avatar and name, hypothesis, base label → candidate, the diff chips (+/− skill or tool, model
    from → to), status, author, age, and an expiry or stale chip.
  - Admins who are not the author get Promote and Reject with a note; the author gets Withdraw. Server errors stay inline on the
    card and also show a toast.
  - Each card says "No evaluation yet. Evaluations run once agents execute." where a comparison would go.
  - The sub-tab badge counts the server's pending proposals in api mode. Before, it counted fixture learning + evolving agents.
  - Demo mode still renders the old `<Development />` unchanged (`isApi() ? <ServerDevelopment/> : <Development/>`).
- **Agent Profile › Evolution** (api mode):
  - The Versions panel marks **active** and **last good**. Last good is the active version's parent, which is the version before
    it, as the brief defines it.
  - Admins get "Propose a change" (DL-75), and a "Roll back" button (DL-76, reason required) on every non-active version. The
    button's accessible name and tooltip are "Roll back to this version (vX)". The visible text was shortened after the 1366 check.
  - The old "Candidate Experiment" empty state is replaced by this agent's proposal list.
  - The `active` and `earlier` chips are kept, because `api-stage6.mjs` checks for them.
- **DL-75 Propose dialog**:
  - Starts from the active version, read from `GET /agents/:id`.
  - Has a model select and skill and tool chip editors (add or remove).
  - Shows the before → after diff live, a required hypothesis, and an optional title with an automatic default.
  - Warns when the agent changed while the dialog was open, and shows server errors inline.
  - In demo mode it renders the editor but cannot submit.
- **DL-76 Rollback dialog**: shows active → configuration of the target → a new version, the diff, and a required reason.
- **Live updates**: `api/events.ts` subscribes to the four new types, and every `agent.*` event re-reads the proposal lists and the
  agent detail.
- **Help**: `?` entries for every new control, in `help/pages/c05-agent-versions.ts` (9 keys).

## Choices
- **Reject is allowed on a stale proposal**: the base check applies to promote only, as in cycle 1. Otherwise stale proposals
  would block the unique index until they expire.
- **Skills and tools are compared as sets**: a candidate that only reorders or repeats them is 422 `CANDIDATE_UNCHANGED`.
- **Expiry** happens on read (both GETs), on create (so an expired pending row frees the unique index), and per proposal on
  decision and withdraw. There are no timers.
- **The Promote button stays enabled on a stale card** (with a tooltip), so the server's 409 shows inline. The browser check uses
  this to prove that item 3 is visible to users.
- **Migration tests are not hard-wired to version numbers**: lane 0014 arrives at merge.
  - The 0015 test goes down to "the highest migration below 15" and back up to `max(listMigrations())`.
  - `proposals.test.ts:306` changed from `toBe(13)` to `toBe(max(listMigrations()))`. It still asserts that `up` reaches the
    newest migration, so this is not a weakening.

## RED → GREEN evidence

1. RED, whole file: the new test file run against a stub module with no routes. All 24 tests failed.

   ```
   $ cd server && npx vitest run test/version-proposals.test.ts
        × normalizeConfig trims and de-duplicates; configDiff lists …
        × every signed-in user can read proposals (all, and per agent); anonymous cannot
        … (all 24 ×) …
        × down to the previous migration and up again on a populated schema …
    Test Files  1 failed (1)
         Tests  24 failed (24)
   ```

2. RED, race tests only: with the implementation in place, I temporarily removed the PATCH `lockAgent` line, then restored it.

   ```
   $ npx vitest run test/version-proposals.test.ts -t "lock"
        × a PATCH waiting on the agent lock while a promote commits answers 409 (If-Match) and never overwrites it
        × a rollback waiting on the lock while a PATCH commits builds on the PATCHed version (parent = it)
   AssertionError: expected false to be true      (the PATCH never queued on the lock)
         Tests  2 failed | 22 skipped (24)
   ```

3. GREEN.

   ```
   $ cd server && npx tsc --noEmit -p . && npx vitest run
    Test Files  25 passed (25)
         Tests  345 passed (345)      (baseline before the cycle: 24 files, 321 tests)
   ```

   After the first GREEN I found that a malformed stored candidate made the decision route return 500 and broke the read DTOs.
   I added a test for it (409 `PROPOSAL_CHANGED`, reads keep working), fixed it, and the suite is again 345/345.

4. Race test design (deterministic). A test connection holds the agent's advisory lock. The promote is fired and the test waits
   until `pg_locks` shows one waiter; the PATCH (same If-Match) is fired and the test waits for two waiters. The lock is released.
   Promote → 200 and PATCH → 409 `CONFLICT`; the active version is the promoted one and the PATCH's skill is absent. The mirror
   test (PATCH first, then rollback) shows the rollback's parent is the PATCHed version.

5. Browser check, api mode, lane ports.

   ```
   $ cd web && E2E_API_PORT=5392 E2E_WEB_PORT=5393 DOC_SHOT_C05=docs/screenshots/improve-c05-versions-dark.png ./scripts/api-e2e.sh api-c05.mjs api-stage6.mjs api-improve.mjs
   == api-c05.mjs     29/29 passed, no page errors   (later 31/31 with the overflow checks, at 1600 and 1366)
   == api-stage6.mjs  94/94 passed, no page errors
   == api-improve.mjs 32/33 — FAIL "E2E_DATABASE_URL must point at axion_e2e" (see Concerns: the c01 guard rejects the lane's axion_e2e3)
   ```

   To show there is no regression in the rest of `api-improve.mjs`, I ran a temporary copy, deleted afterwards and never committed,
   whose only change is the guard pointing at `axion_e2e3`: **81/81 passed, no page errors**.

6. Demo mode.

   ```
   $ cd web && BASE=http://127.0.0.1:5390 OUT=/tmp/axion-verify-w3 ./scripts/verify-all.sh
   typecheck + build ✓ · crawl 77 views NO PROBLEMS · deep crawl NO PROBLEMS · flows (21) all PASS, no console errors ·
   auth flow 17 PASS, NO PAGE ERRORS · u1 flows 8 PASS · dialog smoke 55 dialogs × 2 = 110 checks, 0 failures ·
   dialog ids all defined · help keys all defined · fs guard OK        (46 PASS, 0 FAIL)
   ```

   This run used a lane-only, uncommitted Vite config (`web/.lane-w3-vite.config.mjs`) that adds the real node_modules path to
   `server.fs.allow`. An earlier run with the repo config got 403 on fonts, because the worktree's node_modules is a symlink outside
   the allow list; that is an environment issue, not a code one.

## Pass threshold

| # | Item | Result | Evidence |
|---|---|---|---|
| 1 | Server tests in the brief pass; the whole suite stays green | **PASS** | 24 new tests in `test/version-proposals.test.ts`, covering every listed case: promote by another admin (new version, candidate config, parent = base, active); author 403; member 403; stale base 409; tampered sha 409; expired 409; duplicate 409; withdraw by the author only; rollback is a new version with old rows unchanged and the append-only trigger still blocking; rollback to the active version 422; another agent's version 422; running instance keeps its version through promote and rollback; two race tests; other tenant 404; 0015 down/up on a populated schema. Full suite 345/345. |
| 2 | Browser check in api mode | **PASS** | `api-c05.mjs` 31/31 at 1600×940 and 31/31 at 1366×768 (`VW`/`VH`), including no horizontal overflow on Evolution or Development, three browsers: A proposes (+ Svelte) and sees the diff; B promotes from Development; C sees v2.4.0 → v2.5.0 live while `M-126:coder-01` still shows v2.4.0. **This instance is a simulated one on a DEMO mission**, because real missions' instances are idle and the e2e database has only DEMO running missions; the server tests also pin through `seedDemo` instances, while Stage 6's `instances.test.ts` covers real staffed instances. The server agrees on the pin. B rolls back → v2.6.0 has v2.4.0's configuration, parent v2.5.0, and v2.4.0's row is unchanged; C sees v2.6.0 live, the instance still on v2.4.0. Condition waits only. |
| 3 | Author can't promote (403); a proposal whose base changed gets 409 | **PASS** | Server tests, and in the browser run: `SELF_APPROVAL` 403; `AGENT_CHANGED` 409 at creation from an old base; a PATCH after proposing leaves the card stale, and Promote shows the 409 message inline while the proposal stays pending. |
| 4 | `verify-all.sh` green; demo mode unchanged | **PASS** | 46 PASS, 0 FAIL (lane Vite config described above). Demo still renders the old `Development()`, which was not touched; the dialog smoke opens the two new dialogs in demo mode without errors. |

## Files changed

- **Server**:
  - `migrations/0015_agent_version_proposals.{up,down}.sql`
  - `src/agents/versions.ts` (new)
  - `src/agents/service.ts` (`lockAgent`, `lockAndReadAgent`, `switchVersion`)
  - `src/agents/routes.ts` (PATCH takes `lockAgent` first)
  - `src/app.ts`
  - `test/version-proposals.test.ts` (new)
  - `test/proposals.test.ts` (migration version expectation)
  - `README.md`
- **Shared**: `shared/contracts/src/{agents,events,errors}.ts`.
- **Web**:
  - `src/api/versionProposals.ts` (new)
  - `src/api/events.ts`
  - `src/features/agents/VersionProposals.tsx` (new)
  - `src/dialogs/defs/agent-versions.tsx` (new; DL-75, DL-76)
  - `src/help/pages/c05-agent-versions.ts` (new)
  - `src/pages/Agents.tsx`
  - `src/pages/AgentProfile.tsx`
  - `scripts/api-c05.mjs` (new)
  - `docs/dialog-ledger.txt` (regenerated by the dialog smoke)
  - `docs/screenshots/improve-c05-versions-dark.png`

## Screenshot
`web/docs/screenshots/improve-c05-versions-dark.png`: Agent Profile › Evolution in api mode, dark theme. It shows Versions with
active v2.7.0, last good v2.6.0 and the "Roll back to this version" buttons, next to this agent's proposals (a stale pending one
with its diff and "No evaluation yet").

## Concerns
- **api-stage6.mjs under load.** It passed 94/94 at commit d9c6f14. Later re-runs, with 15 lanes on the machine and load
  average 14–15, stopped at 34/35: `page.reload` timed out at line 235, the 130-message conversation thread, before any agent
  step. The same failure occurred with my last AgentProfile change stashed (an A/B run), so it does not come from this cycle.
  Re-run it on a quiet machine.
- **Stash incident.** `git stash` is shared across worktrees. During that A/B run another lane (c07, w5) pushed a stash
  between my push and my pop, so my `git stash pop` applied their stash to w3.
  - I reverted their files in w3 and popped my own entry.
  - I put their stash back with `git stash store`, using the identical commit `e10a7c8` and its original message.
  - Nothing reached any other worktree; I checked every worktree's AgentProfile.tsx (read only).
  - Lesson for the process: lanes should not use `git stash`.
- **Merge note: migration numbers.** Any test in lane 0014 that asserts `migrate up` returns 14 will see 15 after the merge.
- **Pre-existing at 1366:** the Agent Profile tab bar scrolls sideways, so "Evolution" is half hidden. This is not changed here.
- **The Stage 6 Edit dialog still changes model and skills directly** through PATCH, bypassing the proposal and second-person flow.
  The brief kept PATCH as one of three writers, so I left it. Whether direct edits should require a proposal is a question for the
  owner.
- **"Last good" follows the brief's definition** (the version before the active one). Right after a rollback, that is the version
  just rolled away from, which is not necessarily "good". A later cycle could track a real last-good once evaluations exist.
- **The `api-improve.mjs` c01 safety guard** accepts only a database named exactly `axion_e2e`, so it fails in parallel lanes that
  use `axion_e2e3`. I did not change the guard. It could accept `axion_e2e\d*`; that is the controller's call.
- **Lane environment**: Vite refuses fonts in worktrees because node_modules is a symlink outside `server.fs.allow`. I used an
  uncommitted `web/.lane-w3-vite.config.mjs`.
  - A file `web/.lane-vite.config.ts` that points at **AXION-w2** appeared in this worktree at 17:43; I did not write it. My server
    briefly started with it, which explains a bad interim verify run, since discarded. I left that file untouched and uncommitted.
- **Merge points with other lanes**:
  - Lane 0014 must not use `agent_version_proposals` or ERROR_CODES entries with the same names.
  - DL-75 and DL-76 were picked high to avoid collisions.
  - `proposals.test.ts:306` and `events.ts`'s subscribe list may conflict textually.
- **New events and errors**: `agent.versionProposalDecided` and five error codes are additions beyond the brief's list.
- **Per-agent proposal list**: on the profile it defaults to "All", while Development defaults to "Pending".
