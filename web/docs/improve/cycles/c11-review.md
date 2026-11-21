# Cycle 11 review (lane w9): new real missions are staffed by the active org revision (theme A4)

Verdict: spec PASS (threshold items 1–4 met; items 3–4 rest on the report), quality GOOD. No Critical or Important
findings. Reviewer is read-only. I did not re-run the server suite, the api-mode browser checks or verify-all. The only
code I ran was a throwaway `tsx` probe of the pure rule (`orgStaffing`) on five edge-case charts, from the scratchpad.
File:line references are to worktree `/home/luca/AXION-w9` at `7021f5d`.

## 1. Spec compliance and thresholds
- **Executor = the head of the kind's department, else the fixture rule.** `departmentHead`
  (`web/src/features/mission/staffing-org.ts:53`) uses cycle 1's head definition: an active member reporting to the GM
  (`:41`, same as `DEPT_WITHOUT_HEAD`, `server/src/organization/validate.ts:109`). It falls back to the fixture executor
  when there is no head (`:93-94`, `executorFrom: 'fixture'`). OK.
- **Manager = the org supervisor when that supervisor is in the mission, otherwise the executor** (`:102`), with the GM
  excluded (D1, see §3). OK.
- **Running missions never change.** The plan is stored at creation (`server/src/missions/service.ts:27-38`) and
  instances are insert-only (§2). OK.
- **DEMO unchanged.** See §4. OK.
- **Threshold 1 (server tests):** all three required tests exist and assert concrete structure:
  `server/test/c11-staffing-org.test.ts:130` (a full parent map after a real A-proposes/B-approves flow, plus the
  delegated edge), `:130`/`:146` (the earlier mission's hierarchy compared byte for byte), and `:175` (DEMO golden).
  PASS.
- **Threshold 2 (one explicit table):** `KIND_DEPT` (`staffing-org.ts:14`). A test pins it to the fixture executors'
  departments (`test:29`). The help prose (`web/src/help/pages/missions.ts:4`) is a second hand-kept copy. See Minor m3.
  PASS.
- **Threshold 3 (browser check):** `web/scripts/api-c11.mjs` covers the brief's flow end to end: B approves in the UI
  (`:76`); the dialog previews the executor (`:87`, `:90`); the Hierarchy node selectors are
  `[data-agent][data-parent]` (`:100-110`); and the server hierarchy agrees (`:104`). 16/16 per the report. Not
  re-run.
- **Threshold 4 (suite, api checks, verify-all):** the report shows them green (server 342/342; api-c11, auth, flows,
  stage6, improve all EXIT=0; verify-all EXIT=0). The one `api-stage6` `page.reload` timeout at 34/35 matches the known
  load-related flake at the same step in c05 and c07 (`c05-review.md:84`, `c07-report.md:52`). Nothing in this diff
  touches that path. It passed 94/94 on the rerun. Not re-run by me.

## 2. Correctness

### Reading the active revision: no lock or snapshot needed
- `readOrgView` (`server/src/missions/staffing-org.ts:10`) runs inside POST /missions' transaction
  (`routes.ts:47`, via `idempotent` → `tx`). It reads in three steps: `activeRevision`, then `edgesOf(rev.id)`, then
  `agent_definitions`.
- A half-applied revision cannot be observed:
  - `createOrgRevision` inserts the revision row and all its edges in one transaction (`agents/org.ts:66-69`), so they
    commit together;
  - `org_revisions` and `org_edges` are append-only (triggers, `migrations/0006_agents.up.sql:63-66`);
  - edges are read by revision id, so the view is always one whole revision;
  - the PK `(revision_id, subordinate_id)` (0006:54) and the `edgeType: z.literal('reports_to')` input
    (`organization/proposals.ts:24`) mean the last-wins `supervisors()` Map can never pick between two supervisors.
- Using `activeRevision` here rather than `latestRevision` under `lockOrg` is correct (D5). Mission creation is a
  reader, not an org writer, and `activeRevision` is what `/organization/graph` and the catalog's `managerId` use
  (`agents/service.ts:41`), so the server and the dialog preview agree. Taking `lockOrg` would serialise every mission
  creation behind org writes for no gain.
- **Race with proposal approval:** the mission gets either revision N or N+1, both complete, and records which one in
  `staffing.org.revision`. That is the right semantics.
- Two residuals, both Minor (m1):
  - `activeRevision`'s `active_from <= now()` compares with this transaction's start time. A revision committed by an
    approval that started after this transaction began is skipped, and the mission uses N-1. That revision is
    consistent, just slightly older. `active_from` is never set in the future (the default is `now()`, 0006:46).
  - Agent `dept`/`status` are read live from `agent_definitions`, not versioned with the revision. A concurrent dept edit
    or retirement between the two statements could mix the views. This is negligible in practice.

### Instances pinned at staffing time
- `joinMission` → `insertInstance` (`instances/service.ts:27-37,45-54`) writes `manager_instance_id` once, with
  `on conflict (id) do nothing`.
- The only `update agent_instances` in `server/src` changes state, task and progress (`instances/service.ts:57`).
- No handler reacts to `org.revisionApplied` by re-parenting.
- Conclusion: once an instance exists, an org change cannot move it. OK.

### Created before, staffed after: frozen, not following
- The question as asked assumes these missions follow the new org. The code does the opposite (D2): the plan,
  including each `managerId`, is frozen in `presentation.staffing` at creation (`service.ts:38`). The sim only reads it
  (`staffing-sim.ts:56-57`). This is pinned by `test:191`: a mission created under rev 1 and staffed after rev 2 by a
  restarted app keeps writer-01 under researcher-01.
- **Ruling: right.** Three reasons:
  - The brief's threshold says "a mission created before the change keeps its old structure".
  - Staffing starts in the same transaction as creation (draft → submit → plan, `routes.ts:48-51`). The window between
    creation and the last join is about (N+2) × 1.5 s, or a restart.
  - Re-reading the org per join could build one team from two revisions, while a frozen plan names one revision in
    `staffing.org`.
- There is one creation path (`grep defaultPresentation`: only `routes.ts:47`), so there is no other route that staffs
  later.

### Executor fallback and edge cases
- No head → fixture executor (`staffing-org.ts:94`). Tested in pure form (`test:61`) and through the API (`test:163`),
  including a recruit whose supervisor is outside the mission going under the executor.
- The sim never orphans a recruit. It uses `planned` only when that manager already has an instance
  (`staffing-sim.ts:57`, `team` read at `:38`), and falls back to the executor otherwise. Examples: an agent without an
  active version (`insertInstance` skips it, `service.ts:32`), or the unreachable `waiting` leftovers
  (`staffing-org.ts:116`).
- My probe confirmed the following, which the tests do not all cover:
  - a two-level chain (writer→analyst→tester) joins in manager-first order;
  - the fixture executor moved under another department's agent (researcher→writer) gives analyst-01 by the id
    tie-break, and researcher-01 waits for writer-01;
  - the fixture executor moved under a same-department head (researcher→analyst) makes analyst-01 lead.

  All are coherent.
- The multiple-heads tie-break is the normal state in the seed: every member reports to the GM, so every member is a
  head. Rule 1 (the fixture executor, if it is a head) is what makes the seeded org staff exactly as before
  (`test:42`). Rules 3–4 are arbitrary but deterministic and documented. That is acceptable until the org stores an
  explicit head per department (the report's own concern).

## 3. D1: the GM is not an in-mission supervisor
- **Ruling: a sound reading of intent. It does not block, but should be queued as an owner question with D1 as the safe
  default.**
- The brief's literal wording ("its org-revision supervisor when that supervisor is in the mission") includes the GM,
  who is always in the mission. In the seed, all 17 top-level agents report to the GM. Under the literal reading, every
  recruit in every new mission would be a direct GM report and the executor would lead no one.
- That would contradict:
  - the owner's u1 staffing model ("The GM appoints a general executor; the executor brings the agents", help
    `missions.ts:4`);
  - the existing chain invariant pinned at `server/test/instances.test.ts:194-201` (gm → executor → others);
  - the brief's own "otherwise the executor" default, which treats the executor as the normal parent.
- D1 keeps the threshold behaviour intact (X under M when M is a non-GM agent in the mission).
- Because it departs from the literal text, PROCESS.md's mechanism applies: record it in LOG.md as a queued question,
  with the safe default being the current behaviour. The change is one condition (`sup !== GM`,
  `staffing-org.ts:102`). See m2.

## 4. DEMO path, tenant scoping, execution guard

### DEMO path
- DEMO missions are created only by `seedDemo`, with fixture presentations that carry no `managerId`/`org`, and
  backfilled (`seed/demo.ts:40`). Neither file is in the diff.
- The sim adds `!simulated` (`staffing-sim.ts:57`) as a second guard.
- Client demo mode (`store/data.ts:67`) still calls `staffingPlan`. The two log-text changes in `advance()`
  (`staffing-plan.ts:103,111`) apply only when `s.org` / `managerId` are set.
- The dialog uses `orgStaffing` only under `isApi()` (`mission-add.tsx:79`). OK.

### Golden test
- The golden is real data: 13 missions, 48 nodes, committed in `365b15c` before any server change.
- It passed after three applied proposals, so DEMO seeding is shown not to depend on the org.
- Honest caveat: no changed line is reachable from `seedDemo`/`backfill`/`hierarchy()`, so this golden cannot fail on
  this diff. It is a forward regression guard, not evidence that the new sim branch is DEMO-safe. The DEMO-specific
  branch (`!simulated` at `staffing-sim.ts:57`) and the client `advance()` text have no test (m4).
- No DEMO fixture is mid-staffing and nothing re-enters staffing for a DEMO row, so this is a missing guard test, not a
  live risk.

### Tenant scoping
`activeRevision(c, tenantId)`, edges by that tenant's revision id, and `agent_definitions where tenant_id=$1`
(`server/src/missions/staffing-org.ts:11-14`). `ctx.tenantId` comes from the authenticated context (`routes.ts:47`).
OK.

### Execution guard and untouchables
- No new process, model or browser call. `mission_runs` is still inserted with `execution='disabled'`
  (`staffing-sim.ts`, unchanged line).
- Auth, visibility, append-only tables, the audit log and migrations are untouched (empty `git diff --stat` for
  `server/src/{seed,instances,auth}` and `server/migrations`).
- The `api-improve.mjs` guard regex `/axion_e2e\d*/` is test-only and identical to `improve-30h:224`, so the merge is a
  no-op.

## 5. Tests
- The API tests assert real behaviour: full parent maps, the delegated edge, the stored `staffing.org` and the log text.
  The restart test exercises D2 on a second app instance.
- The report states that the restart test also passes on base (correct: base ignores the org). It is a regression guard
  for D2, not a RED test.
- The pure tests pin `KIND_DEPT`, the no-org byte-identity (`c11-fixture-plans.json`), the seed invariant, head
  semantics, tie-breaks and join order. The RED run caught a real join-order bug (fixed in `4e47135`), which is good
  evidence the tests discriminate.
- Process notes, disclosed honestly in the report:
  - the pure module was written before its tests first ran (test-after for that file);
  - the baseline count (331) is derived, not run;
  - RED ran on a snapshot that finished after the first GREEN run.

  None changes the verdict.

## Findings
- Critical: none.
- Important: none.
- Minor m1: the `activeRevision` transaction-start `now()` can pick N-1 during a concurrent approval, and agent
  dept/status are read live, not versioned. Both are benign; document them in the `readOrgView` comment.
- Minor m2: D1 is a sound reading but departs from the brief's literal text. Queue an owner question in LOG.md (safe
  default: D1 as built). The help sentence (`missions.ts:4`, "under its org manager when that manager is in the
  mission") omits the GM exception; add "other than the GM".
- Minor m3: the help prose repeats `KIND_DEPT` by hand, which is a drift risk. Generate the sentence from `KIND_DEPT`, or
  add a test that the help names each kind with its department. The `how` text roughly tripled in length and was not
  viewed rendered; check that the popover still fits.
- Minor m4: the DEMO golden cannot fail on this diff. Add a guard test: a `demo=true` mission mid-staffing whose plan
  carries a `managerId` still joins under the executor; and `advance()` on a staffing without `org`/`managerId` gives the
  base log text.
- Nit: the "most department members under them" and "first by id" tie-breaks are arbitrary. Revisit them if an explicit
  department head is ever stored.
