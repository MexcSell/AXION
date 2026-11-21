# Cycle 3 report: agent reliability measured from recorded task history (theme C)

Implementer report for `c03-brief.md`. Branch `improve-30h`, base `e18e84d`.

## What was built

### Server
- **No migration.** Reliability reads only existing tables: `tasks`, `task_attempts`, `events` (`task.stateChanged`),
  `audit_events` (`task.reassign`), `agent_instances` and `missions`.
- **Contracts** (`shared/contracts/src/agents.ts`):
  - `AgentReliability {value: number|null, n, window: '90d', evidence, includesSimulated}`.
  - `AgentDto` now extends `AgentStoredDto` (the stored agent) with a required `reliability`. The stored shape stays
    separate so the service can't hand out an agent without it by accident.
- **Pure function** `reliabilityOf(rows, {from, to, includeSimulated})` (`server/src/agents/reliability.ts`).
  - It classifies every row once and returns `agentId → AgentReliability`. Agents without evidence get the empty value.
  - It comes with `reliabilityWindow(now)`, which is 90 days, inclusive at both ends.
- **One query for all agents** (`loadReliabilityRows`), with no N+1:
  - The task set is every `passed`/`failed` task of the caller's visible missions: tenant, not deleted, `VISIBLE_SQL`, and
    DEMO only on request.
  - Three grouped CTEs supply the per-task fields:
    - attempt count and latest attempt time;
    - latest `task.stateChanged` into the current status;
    - the agents the task was reassigned away from, read from the `task.reassign` audit rows of the same tenant with
      `result = 'ok'`.
  - `attachReliability(db, viewer, agents, includeSimulated)` runs the query once and maps every agent. `GET /agents`,
    `GET /agents/:id`, `POST /agents` and `PATCH /agents/:id` all use it, so the list and the detail can't diverge.
- **Routes** (`server/src/agents/routes.ts`):
  - `?includeSimulated=0|1` is checked with zod, so any other value is 400. With `1`, `includesSimulated` is `true`.
  - POST and PATCH responses carry the admin's reliability as well, so a new agent comes back with
    `{value: null, n: 0, …}`.
- **Reassign audit detail** (`server/src/tasks/routes.ts`): adds `fromAgent: t.owner_agent` next to the existing
  `fromInstanceId`. This lets a task owned only by an agent id (no instance) be charged when it is reassigned away. The
  change only adds a field: nothing is removed and nothing is loosened.
- `server/README.md`: reliability is documented, and the test count is updated to 321.

### Web
- **`web/src/components/agents/Reliability.tsx`** (new; api mode only, returns `null` in demo mode):
  - **`ReliabilityStat`** (Agent Profile hero, above the DEMO key-value tiles):
    - a shield icon, the label "Reliability", a `measured` chip and its own `?` (`agent.reliability`);
    - the value with `n=… · last 90 days`, or "–" with "not enough evidence (n of 5)";
    - an animated value swap, an evidence bar (filled to n/5 while empty), the evidence sentence in a tooltip, and a soft
      pulse when measured (off under reduced motion);
    - data attributes `data-reliability`, `-n` and `-value` for the checks.
  - **`ReliabilityChip`**: the value or "—", with the tooltip `Reliability … · n=… of 5 needed · <evidence>`.
    - On the Directory card it sits on the top edge of the stats row, opposite the DEMO chip.
    - In the list it sits beside the agent's name.
    - A first version used a separator inside the card's stats row and an extra list column. Screenshots showed it pushed
      "Success" out of the card and the list wider than the screen at 1366, so both moved and no width is added now.
- **Help** (`web/src/help/pages/overview-org-agent.ts`): `agent.reliability` gives the full definition. It covers the
  reliable and unreliable cases, canceled tasks (not counted and not part of n), open tasks, DEMO tasks, why a member's n
  can be smaller, and the brief's example.
- **Live** (`web/src/api/events.ts`):
  - `task.stateChanged`, `task.delegated`, `mission.shared` and `mission.deleted` trigger a debounced (400 ms) re-read of
    the agent catalog, which carries `reliability`.
  - The debounce is cancelled on sign-out. A stream reconnect already re-reads the catalog.
- **Agent type** (`web/src/data/types.ts`): `reliability?: AgentReliability`. `toAgent` passes it through unchanged.
- **Demo mode:** unchanged. Every new element is gated on `isApi()`.
- **Unchanged and still DEMO-tagged:** the DEMO fixture numbers (hero metrics, Verified success, Tasks evaluated, grade,
  OVR, radar) keep their existing DEMO chip. The browser check asserts the hero chip and the radar chip.

## Choices where the brief left one

- **D1. Where "reassigned away" comes from.**
  - The brief says "tasks, attempts and delegations". The `delegated` row that the reassign writes goes from the mission
    **lead** to the target, so it does not name the previous owner. When the target is the lead, no row is written at all.
  - The previous owner is recorded only in the `task.reassign` audit row (`detail.fromInstanceId`, plus the new
    `fromAgent`). Reliability reads that row: same tenant, `result = 'ok'`, and only for tasks of visible missions.
  - Older audit rows with neither field can't be attributed and are skipped. Every reassign made through the API since
    Stage 6 has `fromInstanceId`; the field is null only for tasks without an owner instance.
  - **This is a deviation from the brief's wording**, made because the delegation rows can't answer "away from whom".
- **D2. One timing rule.**
  - A task is evidence when it is `passed` or `failed` now and its finish time is in the window.
  - It is charged to its final owner, and once (as unreliable) to every agent it was taken from.
  - Open tasks count for nobody yet. That includes one reassigned away that is still open, and one that a retry put back
    in the queue.
  - Canceled tasks count for nobody, including the agents they were taken from. So "n finished tasks" is always literally
    true.
  - A→B→A charges A once (reassigned away), not also as reliable.
- **D3. Finish time.** Tasks have no finish column, and `passed`/`failed` emit no event today. The rule, in order:
  1. the latest `task.stateChanged` into the current status;
  2. otherwise, the latest attempt time or the creation time, whichever is later.
  - Rule 2 is a lower bound: if it is inside the window, the real finish is too, because both are in the past. If it is
    older than the window, the task is left out (conservative).
- **D4. Attempts.** A passed task with 0 or 1 recorded attempts is a first-time pass. A retry always records attempt 2; the
  retry route first writes attempt 1 for tasks that have no history. So a task with fewer than two attempts was never
  retried.
- **D5. Owner.** The final owner is the agent of `owner_instance_id`. Without an instance it is `owner_agent`, the same rule
  as the task list.
- **D6. Simulated.** A task counts as simulated when `tasks.simulated` is set or its mission is DEMO.
- **D7. Evidence sentence.** It is always "… · last 90 days · from missions you can see", for administrators too (it is
  true for them as well).
  - It names only the non-zero parts (retried, failed, reassigned away).
  - Below 5 it starts with "not enough evidence (n of 5)". With DEMO included it ends with "DEMO tasks included".
- **D8. Value** is `Math.round(reliable / n × 100)`, so it has 0 decimals and can be 0.
- **D9. Browser check (labelled fixture step).** The check uses API user actions wherever they can act, and writes fixture
  rows only for the part they can't reach:
  - Real missions get no task rows (the only `insert into tasks` is the DEMO backfill, always `simulated = true`).
    `passed`/`failed` are system-only, so user actions alone can never give a real agent evidence.
  - So the check proves the empty state, DEMO exclusion and the live re-read with **user actions only**: reassign and retry
    on a DEMO task.
  - Then, labelled in the script and here, it writes 5 real finished task rows into **axion_e2e only**, the same way the c01
    expiry step does. Four belong to the executor of a real mission and one failed task to its GM. The 5th task reaches the
    executor through a **user reassign via the API**, which takes the agent from n=4 to n=5 live.
  - No seam was added to the production app, and `e2e-serve.ts` is unchanged.
  - The n ≥ 5 value is also proven in the server route tests with direct SQL fixtures (see the pass-threshold table).

## TDD evidence

RED, with the tests written first and before any implementation
(`cd server && npx vitest run test/reliability.test.ts test/agent-reliability.test.ts`):
```
     × every agent carries reliability; a fresh database has no evidence
     × an unknown includeSimulated value is 400; anonymous is 401
     × a newly created agent comes back with an empty reliability
     × an admin counts every visible real task of the tenant: 6 of 9 → 67
     × the reassignment counts against the agent it left (Tester-01), from the API's recorded reassign
     × the owner of the private mission sees the same as the admin
     × a member does not count a private mission's tasks or its reassignments
     × simulated (DEMO) tasks only with includeSimulated=1, which the result says
     × another tenant never counts (its tasks, nor its audit rows naming our task)
     × a reassignment made later through the API moves the count (live source, no cache)
 FAIL  test/reliability.test.ts [ test/reliability.test.ts ]
Error: Cannot find module '../src/agents/reliability.ts' imported from /home/luca/AXION/server/test/reliability.test.ts
 FAIL  test/agent-reliability.test.ts > shape and parameters > every agent carries reliability; a fresh database has no evidence
AssertionError: expected undefined to deeply equal { value: null, n: +0, …(3) }
 FAIL  … > an unknown includeSimulated value is 400; anonymous is 401
AssertionError: expected 200 to be 400 // Object.is equality
      Tests  10 failed | 1 passed (11)
```
- Of the 11 route tests in the first RED run, only the list/detail equality test passed, and only vacuously
  (`undefined === undefined`). It is a real check after GREEN: 24+ agents × 3 users × 2 modes, with non-trivial values.
- After the core was GREEN, a 12th route test was added for the `fromAgent` audit field. I checked it RED by reverting
  only that line in `tasks/routes.ts`: `AssertionError: expected { value: null, n: +0, …(3) } to match object { n: 1 }`.
  It is GREEN with the line.

GREEN:
```
$ cd server && npx tsc --noEmit -p . && npx vitest run test/reliability.test.ts test/agent-reliability.test.ts
      Tests  31 passed (31)
$ cd server && npx tsc --noEmit -p . && npx vitest run
 Test Files  24 passed (24)
      Tests  321 passed (321)
```
- **Unit tests** (`server/test/reliability.test.ts`, 19):
  - window and shape;
  - first-time pass, including 0 attempts;
  - retried pass, failed, reassigned away (charged to the agent it left, credited to the finisher);
  - A→B→A, taken away twice from the same agent, reassigned away while still open (every open status);
  - canceled (excluded for the owner and for the agent it was taken from), a task with no final owner;
  - rounding;
  - n<5 → null, n=5 → 0;
  - the brief's example sentence;
  - the window boundary at both ends (±1 ms), including for a reassigned-away task;
  - simulated tasks excluded, then included.
- **Route tests** (`server/test/agent-reliability.test.ts`, 12):
  - shape and an empty state for every agent;
  - 400 and 401;
  - a POST response;
  - admin 6 of 9 → 67, with the exact sentence;
  - a reassign through the API charged to Tester-01;
  - the owner equals the admin;
  - **a member doesn't count a private mission's tasks or its reassign**;
  - DEMO only with `includeSimulated=1`, per user;
  - **other tenants never count**: their tasks, an instance of the same agent id, and an audit row in t-2 naming a t-1
    task;
  - a deleted mission never counts;
  - a refused (`denied`) reassign is not counted;
  - the finish-time precedence (an event 100 days old wins over a recent attempt; created 120 days ago with no record →
    out);
  - a later API reassign moves the counts (n 4 → 5, value 40);
  - `fromAgent`;
  - **`GET /agents` ≡ `GET /agents/:id`** for every agent, user (admin, owner, member) and mode.

## Pass threshold

| # | Item | Result | Evidence |
|---|---|---|---|
| 1 | Server tests pass; whole suite green | **PASS** | 321/321, `tsc` clean (above) |
| 2 | `GET /agents` and `GET /agents/:id` return `reliability {value, n, window '90d', evidence, includesSimulated false}` for every agent, real tasks by default | **PASS** | route tests "every agent carries reliability…", "identical between…"; browser "c03 server: every agent carries reliability…" |
| 3a | Browser: a fresh agent shows "not enough evidence (n of 5)" | **PASS** | "c03 a fresh agent shows "not enough evidence (0 of 5)" with no value" (Archivist-01, created through the API) |
| 3b | Browser: after 5+ tasks of one agent's instance reach terminal states, the profile shows the server's value and n | **Met through the brief's fallback** | User actions alone can't reach it: real missions have no tasks and `passed`/`failed` are system-only (D9). As the brief allows, the browser proves the n<5 empty state and the live re-read with user actions only. The n ≥ 5 value is proven in the server route tests with direct SQL fixtures: 67 with n=9, 40 with n=5, 50 and 17 with DEMO. **Extra coverage, not the basis of the pass:** a labelled fixture step writes 4 rows into axion_e2e and then a user reassign through the API brings the agent to 5. The profile switches live, without a reload, from "not enough evidence (4 of 5)" to **60%, n=5 · last 90 days** (the server's value), and the list chip, card chip and tooltip match. |
| 3c | Browser: DEMO metrics still carry their DEMO chip | **PASS** | "c03 the DEMO metrics still carry their DEMO chip beside it (hero)…", "c03 the radar stays DEMO-tagged", and the same on the measured agent's profile |
| 4 | `verify-all.sh` green; demo mode unchanged | **PASS** | exit 0, 46 PASS / 0 FAIL, no console or page errors (below); every new element is gated on `isApi()` |

Browser check (`cd web && ./scripts/api-e2e.sh api-auth-flow.mjs api-flows.mjs api-stage6.mjs api-improve.mjs`):
```
== api-auth-flow.mjs   15/15 passed, no page errors
== api-flows.mjs       23/23 passed, no page errors
== api-stage6.mjs      94/94 passed, no page errors
== api-improve.mjs     81/81 passed, no page errors   (c01 + c02 unchanged; 26 new c03 lines)
```

The c03 lines of `api-improve.mjs` cover:
- the fresh agent's empty state, the `?` definition and the `measured` chip;
- Coder-01 with simulated DEMO evidence (n>0 only with `includeSimulated=1`) still showing "0 of 5";
- a **user reassign** of DEMO task T-12506 away from Optimizer-01: the open profile re-reads `/agents` with no reload. On the
  server, with DEMO included, the failure moves from "1 failed" to "1 reassigned away" and Coder-01 gains one. The default
  stays n=0;
- a **user retry** of the same task: the profile re-reads, and the task leaves both agents' DEMO evidence because it is open
  again;
- the fixture step: 4 of 5, then a user reassign, then 60% n=5 live;
- the GM charged one "reassigned away";
- member C sees n=0 for the same agent, on the server and on her profile, because the mission is the admin's private one;
- a chip on every list row beside the name, its tooltip, and the card chip;
- at 1366×768 the profile still fits (no page scroll; the stat and the tab bar on screen).

Demo suite (`./scripts/verify-all.sh`):
Run twice: once after the main change and once after the chip placement fix. Both exited 0. The second run:
```
== typecheck + build      ✓ built in 1.05s
== route×tab crawl        visited 77 route/tab views · NO PROBLEMS
== deep crawl             missions: 15, agents: 24 · NO PROBLEMS
== flows / auth flow / u1 flows   46 PASS, 0 FAIL, no console errors, NO PAGE ERRORS
== dialog smoke           53 dialogs × 2 = 106 checks, 0 failures
== dialog ids             All opened dialog ids are defined.
== help keys              All referenced help keys are defined.   (agent.reliability included)
== dev-server file guard  fs guard OK
```
After the chip placement fix, `api-improve.mjs` was rerun on its own: 81/81 passed, no page errors.

Screenshot: `web/docs/screenshots/improve-c03-reliability-dark.png`.
- It shows the api-mode Agent Profile of the real mission's executor at 1600×940, dark.
- The measured **Reliability 60%, n=5 · last 90 days** with its `measured` chip and `?` sits above the DEMO-tagged fixture
  numbers.
- Regenerate it with `DOC_SHOT_C03=docs/screenshots/improve-c03-reliability-dark.png ./scripts/api-e2e.sh api-improve.mjs`.

## Files changed
- Server:
  - `server/src/agents/reliability.ts` (new);
  - `server/src/agents/routes.ts`, `server/src/agents/service.ts`, `server/src/tasks/routes.ts` (`fromAgent` in the audit
    detail);
  - `server/test/reliability.test.ts` (new), `server/test/agent-reliability.test.ts` (new);
  - `server/README.md`.
- Contracts: `shared/contracts/src/agents.ts`.
- Web:
  - `web/src/components/agents/Reliability.tsx` (new);
  - `web/src/pages/AgentProfile.tsx`, `web/src/pages/Agents.tsx`, `web/src/components/agents/AgentCard.tsx`;
  - `web/src/api/events.ts`, `web/src/data/types.ts`, `web/src/help/pages/overview-org-agent.ts`;
  - `web/src/theme/pages/overview-org-agent.css`, `web/src/theme/pages.css`;
  - `web/scripts/api-improve.mjs`.
- Docs: this report, and `web/docs/screenshots/improve-c03-reliability-dark.png`.

## Concerns
- **3b can't be reached by user actions, so it is met through the brief's fallback.**
  - No code path creates real tasks or moves them to `passed`/`failed`, so every real agent will show "not enough evidence
    (0 of 5)" until Stage 7 executes work.
  - The n ≥ 5 value is proven in the server route tests.
  - In the browser, n=5 is reached only with fixture rows written into axion_e2e plus a user reassign (D9). That step is
    extra rendering and live-update coverage. It is test-side only and follows the c01 expiry-step precedent.
- **Reassigned-away comes from the audit log, not from delegations** (D1). If the owner prefers delegation rows as the
  single source, a later migration could add a `from_owner_instance` column to `mission_delegations` for new rows. Today's
  rows can't answer the question.
- **Finish time is a lower bound when no `task.stateChanged` exists** (D3).
  - That is conservative at the window start (a task can be left out, never wrongly included).
  - When Stage 7 adds system `pass`/`fail`, those transitions should emit `task.stateChanged` (or set `finished_at` on the
    attempt), so the time is exact.
- **Two "Reliability" labels on a profile.** The DEMO fixture metric tiles include one labelled "Reliability" (from the
  prototype's eight capability scores, under the DEMO chip). The measured stat is labelled the same, with its own
  `measured` chip and `?`. Renaming the fixture tile was out of scope; the owner may want it renamed or hidden in api mode.
- **Performance.**
  - Every `GET /agents` scans the tenant's `task.stateChanged` events and `task.reassign` audit rows; events have no
    `(tenant_id, type)` index. Small today. The browser re-reads at most once per 400 ms of task events.
  - At scale, migration 0014 with an index on `events(tenant_id, type)`, or an incremental table, would be the next step.
- **`POST`/`PATCH /agents` responses** now carry the admin's reliability too (one extra query per write).
