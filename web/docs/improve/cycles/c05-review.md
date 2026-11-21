# Cycle 5 review: agent version proposals, promote and rollback under governance (theme C)

Independent reviewer, read-only. Branch `c05-version-proposals`, worktree `/home/luca/AXION-w3`, diff `f7c7bca..148e788`
(5 commits). Inputs: `c05-brief.md`, PROCESS.md "Safety rules", the implementer's `c05-report.md`, and the diff without
screenshots. Outside the diff I looked only at named risks: `service.ts` `addVersion`/`getAgent`, the PATCH route, `db.ts`
(`tx`), `idempotency.ts`, `migrate.ts`, `.gitignore`, the CSS for `.oa-line`, and the last browser run's artefacts in
`/tmp/axion-api-c05-5393/`.

**What I did not do.** I did not re-run vitest, the browser checks or `verify-all.sh`: vitest writes schemas to `axion_test`,
and the review is read-only with no servers. All test counts and the race test's RED run are therefore **the implementer's
claims**. I checked them against the test code, and the last `api-c05` result file (31/31 PASS) and its screenshots are on disk.

## Verdicts

- **Spec compliance: PASS.** Every server, web and test item in the brief is present, and the four pass-threshold items are
  met on the evidence I could check (item 4 depends on the implementer's verify-all run with a lane-only Vite config).
- **Quality: APPROVE WITH FIXES.** The server design is sound: one lock, lock-then-read, CAS, append-only. Two Important items must
  be fixed before the merge: a committed `server/node_modules` symlink, and help text that claims a two-person control the
  product does not enforce. Both are small.

## Pass threshold

| # | Item | Verdict | Evidence |
|---|---|---|---|
| 1 | Brief tests pass; suite green | **MET (claimed, code checked)** | `server/test/version-proposals.test.ts` has 24 tests covering every case the brief lists (map below). I did not reproduce the claimed 345/345. |
| 2 | Browser flow, api mode | **MET** | `web/scripts/api-c05.mjs:49-165`. Three contexts: A proposes and sees the `+ Svelte` diff (:97-105); B promotes from Development (:129); C, never reloaded after :83, sees v2.5.0 live while `M-126:coder-01` stays on v2.4.0 (:140-142). B rolls back → v2.6.0 has v2.4.0's config with parent v2.5.0, and v2.4.0's row is unchanged (:160-162); C sees it live (:163). `/tmp/axion-api-c05-5393/api-c05.txt` = 31/31 PASS. Caveat m3: the pinned instance is on a DEMO mission. |
| 3 | Author 403; base changed 409 | **MET** | Server `versions.ts:178`, tests :132-139 and :186-200. Browser: :117-118 (403 `SELF_APPROVAL`), :168-169 (409 at create), :171-178 (stale card, 409 shown inline, stays pending). |
| 4 | verify-all green; demo unchanged | **MET (claimed)** | Demo paths unchanged by construction: `Agents.tsx` uses `isApi() ? <ServerDevelopment/> : <Development/>`, and the demo sub-tab count and toolbar are untouched. `AgentProfile.tsx`'s demo `EvolutionTab` branch is untouched, and `useTickedRead` returns early when `!isApi()`. The 46/0 run used an uncommitted lane Vite config (environment issue, disclosed). |

## Findings

### Critical
None.

### Important

**I1. `server/node_modules` is committed as a symlink to `/home/luca/AXION/server/node_modules`, which blocks the merge.**
- It arrived in commit `7f5829a`: `git ls-tree HEAD server/node_modules` → `120000 blob 4690939…`.
- The lane base `f7c7bca` predates `33c1543` (the `.gitignore` change from `node_modules/` to `node_modules`), so the lane's ignore
  rule did not match a symlink.
- Merged into `improve-30h`, the tracked path collides with the main worktree's real, ignored `server/node_modules`
  directory. Git either refuses the merge, or replaces the directory with a link that points at its own path, which breaks the
  main server's dependencies. I have not tested which happens; neither is acceptable.
- Fix on the branch before merging: `git rm --cached server/node_modules`, then commit. Check that the `web/node_modules`
  symlink stays untracked (today it is `??`).

**I2. Two help entries claim that a second administrator must approve every configuration change. The product does not enforce
this.**
- `web/src/help/pages/c05-agent-versions.ts:7` (`agent.version.proposals`, why) says: "An agent's configuration changes only
  through a proposal that a second administrator promotes."
- `c05-agent-versions.ts:13` (`agent.version.decide`, why) says: "A second administrator checks every change to an agent."
- Both are false. The Stage 6 Edit dialog, whose button sits next to "Propose a change" in the same panel
  (`AgentProfile.tsx`, VersionsPanel actions), still changes model, skills and tools directly through `PATCH /agents/:id`, with
  one administrator (`routes.ts:89-121`). Rollback is single-administrator too (`versions.ts:235-255`).
- This follows the brief, which keeps PATCH as one of three writers. The help text, though, describes a governance control
  that does not exist, so the owner or an admin could reasonably believe two-person control is in force. The safety rules forbid
  that kind of overstatement for numbers, and it matters as much for permissions.
- Fix: reword both entries to say that a promotion needs a second administrator, and that direct edits in Edit and rollbacks are
  single-administrator and audited. The Versions footer (`AgentProfile.tsx`) is already honest about it.
- Owner question (already queued by the implementer): should direct edits of model, skills and tools require a proposal?

### Minor

- **m1. The SAME_CONFIG test asserts the status only.** `version-proposals.test.ts:293-294` checks `same.status === 422` but not
  `body.code === 'SAME_CONFIG'`, so it would also pass if the code were `ALREADY_ACTIVE` or a validation 422. Add the code
  assertion.
- **m2. The race tests prove queuing but not every ordering.**
  - Test 1 (`:321-345`) is good. The PATCH must appear as a second waiter in `pg_locks` (`:333`), so removing PATCH's
    `lockAgent` fails it, which matches the claimed RED run. It ends in 409 `CONFLICT` with the promoted version intact.
  - Test 2 (`:347-365`) asserts `parent_version_id = PATCHed version`. `addVersion` picks the parent as the highest `seq`
    (`service.ts:85`), so this passes even if rollback read the agent before taking the lock. The test proves rollback queues;
    it does not prove that it reads after the lock. The code does read after the lock (`versions.ts:240`).
  - Stronger: also assert that the `agent.rollback` audit row's `detail.fromVersionId` equals the PATCHed version id.
  - Not covered: a promote queued behind a PATCH (it should answer 409 `AGENT_CHANGED`), and a rollback racing a promote. These
    are low risk given the code.
- **m3. The pinned-instance evidence comes only from DEMO missions.** Both the server tests (`seedDemo`, `:41`, `:96`) and
  the browser check (`M-126:coder-01`) use them. This is disclosed. Promote and rollback never touch `agent_instances`, and Stage
  6's `instances.test.ts` covers real pinning, so the risk is low. Still, the browser item says "a running mission's instance",
  and today only DEMO missions run.
- **m4. `api-c05.mjs` has two fixed sleeps:** `waitForTimeout(900)` at :188 and `(600)` at :195. They come before the
  screenshot and the overflow checks. The brief says "condition waits only". Wait instead for the entrance animations to end, for
  example with `getAnimations().length === 0`.
- **m5. `api-stage6.mjs` is not green on HEAD, and `api-improve.mjs` cannot run in a lane.**
  - api-stage6 last passed 94/94 at `d9c6f14`. Later runs stopped at 34/35, a reload timeout on the 130-message thread, under
    load average 14-15. An A/B run attributes this to load, and `148e788`'s AgentProfile change is cosmetic (a tooltip and an
    ellipsis class).
  - api-improve fails on the c01 guard, which accepts only `axion_e2e`.
  - Merge gate: re-run both on a quiet machine against `axion_e2e` before the controller merges.
- **m6. Refused rollbacks are not audited.** A 422 on a rollback is thrown inside `idempotent`, which rolls the transaction
  back, so no `denied` row is written. Refused decisions and withdrawals are audited (`versions.ts:163-166`). The brief asks only
  for an audit row on every write, so this is not a breach. It is an inconsistency, and cycle 1's pattern would audit the
  refusal.
- **m7. The rollback reason is broadcast to everyone.** The `agent.rolledBack` payload carries `why` with audience `all`
  (`versions.ts:250`). Members can read the audit-quality reason through the event stream. This is probably intended, since
  everyone sees versions, but note it if reasons may become sensitive.
- **m8. "Last good" after a rollback marks the version just rolled away from.** That version also gets the emphasised
  (non-ghost) Roll back button (`AgentProfile.tsx`, `good` → `btn sm`). In the screenshot, v2.6.0 is "last good" right after it
  was promoted and then replaced. This follows the brief's definition, but a one-click button that undoes a rollback, styled as
  the recommended action, is misleading. It goes to the owner with the real last-good question once evaluations exist (the
  implementer has queued it).
- **m9. Fixture text in api mode now sits next to real version data.** This predates the cycle, but the cycle makes it
  confusing:
  - The Agent Profile header still reads "Evolving 68% … Candidate v2.5.0: test-first patch recipe". It is DEMO-tagged nearby,
    but v2.5.0 is now a real, promoted version label.
  - The Agents KPI "4 Evolving · candidates in the pipeline" (`COUNTS.evolving`, fixture) shows next to "Development (1)"
    pending proposals.
  - Suggest a follow-up that tags or hides these in api mode.
- **m10. Reads write.** Both GETs run `expireDue` (`versions.ts:116`, `:127`), an `UPDATE` plus audit and event rows, for any
  signed-in reader. That is acceptable as a "no timers" design. Two concurrent GETs that expire several rows could in theory
  deadlock and abort one read. This is unlikely, since the scan order is the same.
- **m11. Merge points (disclosed).**
  - The README test count (345).
  - The `events.ts` subscribe list.
  - Lane 0014's migration-number assertions. `migrate.ts` chooses pending migrations by applied set (`:23`, `:28`), not by a
    watermark, so 0014 arriving after 0015 is still applied.

## Detail checks

### 1. Spec compliance
- Migration `0015_agent_version_proposals.up.sql:5-28`:
  - It has every brief column.
  - `id` = `'VP-'` + 128 bits (`versions.ts:149`).
  - `expires_at` is +14 d.
  - The unique partial index on `(tenant_id, agent_id, candidate_sha) where status='pending'` is at :26.
  - Extra checks: `candidate` is an object, and `promoted ⇔ promoted_version_id`.
  - The down migration drops the table only.
- Routes (`versions.ts`):
  - GET per agent :122 (404 for an unknown agent or another tenant's).
  - GET all :113 (declared addition).
  - POST create :133 (admin, `idempotent`, 409 `AGENT_CHANGED` :140, 422 `CANDIDATE_UNCHANGED` :144, 409 `DUPLICATE_PROPOSAL`
    :146).
  - Decision :168. Withdraw :215 (author, pending). Rollback :235 (admin, `idempotent`, 422 `VERSION_NOT_OF_AGENT` :243 for an
    unknown or another agent's version, 422 `ALREADY_ACTIVE` :244, 422 `SAME_CONFIG` :246, reason required :32 and audited :249).
- Decision order, inside one `tx`, under the agent lock:
  - 404, then the author 403 (:178).
  - Pending (:180-181).
  - Base active, promote only (:184).
  - sha and stored-candidate integrity (:187-190).
  - Expiry (:192).
  - This matches the brief's 1-4 order. Refusals commit with a `denied` audit row, and the error is thrown after the commit
    (:211).
- Promote: `switchVersion` (`service.ts:77-81`) calls the existing `addVersion` (`:84-92`), which is reused, not forked, and
  then bumps `row_version`. The parent is the base: under the lock the base equals the active version, which is the highest seq.
  It is made active, and `promoted_version_id` is set by CAS on `status='pending'` (:202-205; a failure throws and rolls the
  version back).
- Events are in the `EventType` union (`events.ts` contract). Five error codes are in `ERROR_CODES`.
- Web:
  - Development in api mode: title, agent, hypothesis, base → candidate diff, status, author, age, and expiry and stale chips.
  - Promote and Reject for non-authors, Withdraw for authors, errors inline (`data-card-error`) plus a toast.
  - Versions panel: Active and Last good, "Propose a change" (DL-75), and a "Roll back to this version (vX)" accessible name on
    every non-active version (DL-76, reason required).
  - Running instances' pins are unchanged (Stage 6).

### 2. Governance and integrity
- **Self-approval.** `p.created_by === ctx.user.id` → 403 for promote and reject alike (`versions.ts:178`). It is tested
  (`:132-139`) and audited as denied.
- **Members can't write.** All four POSTs use `requireAdmin`. Tests cover a member proposing (:65), deciding (:141), withdrawing
  (:244) and rolling back (:307).
- **CAS, base check, sha and expiry in one transaction.** One `tx` covers :173-210. The sha binds agent, base id, base sha,
  candidate, title and hypothesis (:53-55). The stored candidate is re-validated strictly (:187), and a malformed row is 409, not
  500 (test :202-215).
- **One lock before the read, for all three writers.** `lockAgent` = `pg_advisory_xact_lock(hashtext('agent-ver:<tenant>:<agent>'))`
  (`service.ts:64`).
  - PATCH: lock at `routes.ts:96`, then `getAgent … for update` at :97.
  - Promote: the proposal `head` (agent id only, immutable) at :174, the lock at :176, the agent read at :183.
  - Rollback: `lockAndReadAgent` (:240).
  - Create: the same (:138).
  - The isolation level is the default READ COMMITTED (`db.ts:18` plain `begin`), so each statement after the lock sees the
    other writers' committed versions. The `idempotency_keys` insert before the lock in `idempotent` does not read agent state,
    so it is harmless.
  - grep shows `active_version_id` is written only in `addVersion` (`service.ts:91`). Its other callers are agent create (a new
    agent) and the seed.
  - The race tests really exercise the lock: a held lock, `pg_locks` waiter counts and FIFO grant. See m2 for what they don't
    cover.
- **Append-only.** No UPDATE or DELETE of `agent_versions` anywhere. Rollback inserts a new row (`:247`). The test checks that
  the old rows are byte-identical and that the trigger still rejects update and delete (`:273`, `:284-285`).
- **Pinned instances.** Nothing in the diff touches `agent_instances`. Tested through promote (:166) and rollback (:274), with
  the DEMO caveat (m3).
- **Tenant scoping.**
  - Every proposal query filters on `tenant_id`. The rollback target lookup is unscoped, but `agent_definitions.id` is a global
    PK (the FK in 0015 requires it), and a target is accepted only when `target.agent_id === id` of an agent in the caller's
    tenant.
  - An unknown version and another agent's version give the same 422, so there is no existence oracle.
  - Cross-tenant 404s are tested (:369-386).
- **Idempotency.** Create and rollback go through `idempotent`, and a rollback replay returns the same version (:310-316). The
  decision is protected by CAS instead: a second promote → 409 `PROPOSAL_NOT_PENDING`, and no second version is created
  (:176-182).
- **Audit.** propose, decide (ok or denied), withdraw (ok or denied), expire (system), rollback (with `why`), and `agent.version`
  on each new active version. See m6 for refused rollbacks.
- **Events.** Audience `all`, `subjectKind: 'agent'`, tested (:115, :168-173, :278-283). `agent.versionCreated` and
  `agent.updated` still fire on promote and rollback (`announceVersion` :102-107).

### 3. Correctness
- **Diff.** Skills and tools are compared as sets, and the model as a from → to pair (`configDiff` :41-47). The web
  `versionDiff` mirrors it. A pure test is at :46-51.
- **SAME_CONFIG.** It is checked after `ALREADY_ACTIVE`, against the active config (:245-246). See m1 for the test.
- **Duplicate pending prevention.**
  - An application check runs under the agent lock (:146), backed by the unique partial index.
  - Expiry on create frees the slot (:141). Tested at :230-238.
- **Expiry.**
  - The database clock decides (`expires_at <= now()`).
  - A pending-but-due proposal is expired and audited on read, on create and on decide or withdraw. The expiry commits even
    when the request is refused.
  - Tested at :219-238.

### 4. Tests
- They assert behaviour: database state, audit rows, event rows, version parents, prompt hashes and the trigger, not just status
  codes. Exceptions are m1 and m2.
- **Nothing weakened.** `proposals.test.ts:306` changed from `toBe(13)` to `toBe(max(listMigrations()))`. It still asserts that
  `up` reaches the newest migration, and it is the necessary change once a 15th migration exists.
- The migration test goes down to the highest version below 15 and back up on a populated schema (agents, versions, instances,
  missions, proposals), with row counts preserved (:390-411).

### 5. Web
- **Demo mode unchanged.** See pass-threshold item 4. The two new dialogs render in demo mode and cannot submit; the dialog smoke
  covers them (ledger DL-75 and DL-76).
- **No invented evaluation numbers.** The DTO has `evaluation: null`, and `NoEvaluation` shows the brief's exact sentence on
  every card and in the propose dialog. Fixture numbers elsewhere predate the cycle (m9).
- **Fit.**
  - Overflow checks pass at 1600 and 1366 (claimed for 1366; the file on disk has the 1600 run).
  - In the 1600×940 screenshots the Evolution tab and the Development panel scroll inside the page frame, so the second card's
    actions sit below the fold. That is consistent with other tabs.
  - The 1366 tab-bar scroll predates the cycle (disclosed).
  - The empty-looking diff row in `improve-c05-dialog-propose.png` is the `.oa-line` entrance animation caught mid-fade
    (`overview-org-agent.css:302`), not a bug.
- **Live refresh.**
  - `api/events.ts` subscribes to the four new types, and every `agent.*` event bumps the proposal lists and reloads the catalog.
  - A reconnect also bumps them.
  - Verified live in three browsers (api-c05 :121-165).
- **`?` help.**
  - Covers Propose, Promote and Reject, Withdraw, Roll back (footer), the diff, the evaluation, skills, tools and the panel.
  - All 9 keys are registered through the `pages/*.ts` glob.
  - See I2 for the text itself.

## Report accuracy
- The claims I checked match the code.
- The declared additions are accurate and reasonable:
  - `GET /version-proposals`;
  - `agent.versionProposalDecided`;
  - the five error codes;
  - `SAME_CONFIG`;
  - "last good" = the parent of the active version;
  - PATCH kept;
  - the DEMO-mission pin;
  - the api-stage6 load timeouts.
- The stash incident is disclosed honestly. The branch diff contains only c05 files, so no foreign files leaked into the branch.
- The lane-only `web/.lane-vite.config.ts` and `web/node_modules` remain untracked.

## Required before merge
1. I1: untrack `server/node_modules`.
2. I2: correct the two help sentences.
3. m5: re-run `api-stage6.mjs` and `api-improve.mjs` on a quiet machine against `axion_e2e`.
4. Recommended (cheap): m1 and the m2 audit assertion.
