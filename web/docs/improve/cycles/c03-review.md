# Cycle 3 review: agent reliability measured from recorded task history (theme C)

Independent reviewer. Inputs: `c03-brief.md`, the safety rules in `PROCESS.md`, `c03-report.md`, and the diff
`b87e473..fad7ac3` (screenshots and loop docs excluded). This review is read-only: no servers and no database.

Evidence tags:
- **[ran]**: I ran it myself.
  - `cd server && npx tsc --noEmit -p .` exits 0.
  - `cd web && npx tsc --noEmit -p .` exits 0.
  - `npx vitest run test/reliability.test.ts` passes 19/19. These are pure tests with no database.
- **[read]**: verified by reading the code.
- **[claimed]**: taken from the implementer's report and not reproduced here. This covers:
  - the 12 route tests (they need a database);
  - the full 321-test suite;
  - `api-improve.mjs` 81/81;
  - `verify-all.sh`.

## Verdicts

- **Spec: compliant except pass-threshold item 3b.** That item is mislabelled: it is reported as "Met through the
  brief's fallback", but the brief has no fallback, and as written it is not met (I1). The other threshold items, the
  definition, the server, the web and the test lists match the brief. The deviations D1–D9 are reasonable and disclosed.
- **Quality: good.** The scoping is correct in every sub-query, nothing is loosened, there is no N+1, list and detail
  share one code path, and the tests assert real values.
  - One Important definition gap: a failure that happened under one agent is charged to the agent a person reassigns the
    failed task to (I2). It follows the brief literally, so it does not change the spec verdict. It does need an owner
    decision.
  - Several Minors.

## 1. Spec compliance

| Brief item | Result | Evidence |
|---|---|---|
| Pure `reliabilityOf(rows)` in `server/src/agents/reliability.ts`, with unit tests | ✓ [ran] | `reliability.ts:49-84`; `test/reliability.test.ts` 19 tests pass |
| One grouped query, no N+1 | ✓ [read] | `loadReliabilityRows` is a single statement with 4 CTEs (`reliability.ts:91-120`). `attachReliability` runs it once and maps every agent (`:123-126`). |
| No migration unless an index is needed | ✓ [read] | none added; the missing index is a Minor (m5) |
| DTO plus `shared/contracts` type | ✓ [read] [ran tsc] | `shared/contracts/src/agents.ts` adds `AgentReliability` and `AgentDto extends AgentStoredDto {reliability}`. `service.ts` returns `AgentBase`, so the compiler stops a route from returning an agent without reliability. |
| Shape `{value, n, window:'90d', evidence, includesSimulated:false}` on both GETs, real tasks by default | ✓ [read] [claimed tests] | `routes.ts:39-51`; `ReadIn` zod enum `'0'\|'1'`, default `'0'` (`routes.ts:30`) |
| Evidence = final owner, terminal, in window; canceled excluded; reliable / unreliable classes | ✓ literally [read] [ran] | `reliability.ts:53-64`, `vis` filter `status in ('passed','failed')` (`:97`). See I2 for the semantic gap. |
| `value` 0 decimals, null when n < 5 | ✓ [ran] | `:76-78`; tests at `reliability.test.ts:75-88` |
| Simulated excluded by default; `?includeSimulated=1` includes them and says so | ✓ [read] [ran] | SQL `:97` plus the pure filter `:54`; flag `:81`; test `:106-113` |
| Only visible missions (`VISIBLE_SQL`); the sentence says "from missions you can see" | ✓ [read] | `:96`, `:73` |
| Unit tests: every classification, n < 5, window, simulated | ✓ [ran] | all present |
| Route tests: member/private, other tenant, list ≡ detail | ✓ [read] [claimed run] | `agent-reliability.test.ts:135-139`, `:146-152`, `:175-184` |
| Web: profile stat with value, n, window or "not enough evidence (n of 5)", `?`, beside the DEMO metrics | ✓ [read] | `Reliability.tsx:20-48`, `AgentProfile.tsx:118` |
| Directory card and list chip with the n tooltip | ✓ [read] | `AgentCard.tsx:60`, `Agents.tsx:175`, `Reliability.tsx:51-62` |
| Live re-read on `task.stateChanged` and `task.delegated`, debounced | ✓ [read] | `events.ts:46-47`, `:79`, cancelled on sign-out `:130` |
| Help text carries the definition | ✓ [read] | `overview-org-agent.ts:82-86`. The two caveats in m3 are missing. |
| Demo mode unchanged | ✓ [read] [claimed verify-all] | Every new element returns `null`, or is gated, outside `isApi()` (`Reliability.tsx:21,52`, `AgentCard.tsx:60`) |

### Pass threshold

| # | Item | Verdict |
|---|---|---|
| 1 | server tests green | **[claimed]** 321/321. Unit file [ran] 19/19, `tsc` [ran] clean. |
| 2 | both GETs return the shape for every agent | **PASS** [read] + [claimed] route tests and browser line |
| 3a | a fresh agent shows "not enough evidence (n of 5)" | **PASS** [read] (`api-improve.mjs` c03 fresh-agent checks) + [claimed run] |
| 3b | 5+ tasks driven to terminal states **through the API** → the profile shows the server's value and n | **NOT MET AS WRITTEN; mislabelled.** See I1. |
| 3c | DEMO metrics keep their DEMO chip | **PASS** [read] (hero chip, radar chip) + [claimed run] |
| 4 | `verify-all.sh` green, demo unchanged | **[claimed]**. The gating is correct by reading. |

## 2. Privacy and integrity

Every sub-query is scoped [read]:

| Sub-query | Tenant | Visibility | Notes |
|---|---|---|---|
| `vis` (tasks ⋈ missions) `reliability.ts:93-98` | `m.tenant_id = $1` | `VISIBLE_SQL` always applied, `m.deleted_at is null` | `includeSimulated` only toggles `$4`, never the visibility predicate, so it can't reveal hidden missions. **Proven by reading only:** the route test's DEMO mission `D` is shared (`agent-reliability.test.ts:102`), so no test covers a *private* DEMO mission for a member (m7). |
| `ev` (events) `:99-102` | `e.tenant_id = $1` | `subject_id in vis` | type is fixed to `task.stateChanged` |
| `att` (task_attempts) `:103-106` | no tenant column | `task_id in vis` | `tasks.id` is a global primary key and `task_attempts.task_id` is a foreign key to it (`0007_instances.up.sql:47`), so this is bound to visible tasks |
| `moved` (audit_events) `:107-111` | `x.tenant_id = $1`; the `fi` join also matches the tenant | `subject in vis` | `result = 'ok'` only; a denied reassign is ignored (test `:119-120`) |
| owner instance join `i` `:95` | no tenant predicate | n/a | A nit: it is bound by the foreign key `tasks.owner_instance_id → agent_instances.id`. The `fi` join is stricter for the same reason. |

- **Audit log as a metrics source: acceptable.**
  - It is read-only, scoped by tenant, `result = 'ok'` and `subject ∈ visible tasks`.
  - Viewers receive only aggregate counts about tasks they can already see. The reassignment is also visible to them
    through the task's owner and the `task.delegated` event.
  - The only write change is one additive field, `fromAgent`, in the reassign audit detail (`server/src/tasks/routes.ts:54`).
    The append-only triggers, the audit path, auth and the execution guard are untouched. Nothing is loosened.
- **D1 holds.** The delegation row is written from the mission **lead** to the target (`tasks/routes.ts:52-53`), so it
  can't name the previous owner. Reading the audit row is the right source today.
- **Write routes:** `POST` and `PATCH /agents` attach the admin's view inside the transaction. Their idempotent replay
  stores a snapshot of the reliability. That is harmless.

## 3. Correctness

Classification [read] [ran]:
- first-time pass, retried pass and failed: `reliability.ts:60-63`;
- reassigned away, charged once per distinct agent through the `Set`: `:57-58`;
- A→B→A charges A only as reassigned away: `:59`;
- canceled and open tasks never enter: `:54` and `:97`;
- n < 5 gives null: `:76-78`;
- the window is inclusive at both ends: `:56`.

The tests cover each case: `reliability.test.ts:45-73`, `:95-103`.

- **No double counting for the same agent.** `taken` is a `Set` (`:57`), tested at `reliability.test.ts:57-59`.
  *One failure can still be charged to two different agents; see I2.*
- **List ≡ detail.** Both go through `attachReliability`, which classifies the viewer's rows once. The equality test
  checks every agent × 3 users × 2 modes with non-trivial values (`agent-reliability.test.ts:175-184`).
- **Finish time.** The rule is `coalesce(ev.at, greatest(att.at, created_at))` (`:113`).
  - All three are lower bounds of the real finish, and the real finish is ≤ now. So a task is never wrongly included,
    only possibly left out. That is conservative, as D3 says.
  - `greatest(ev.at, att.at, created_at)` would be tighter. Today the code prefers a stale event over a later attempt,
    which the P7 test locks in (m4).
- **Tests assert real behaviour.** The values are exact (67/9, 40/5, 50/12, 17/6) and the evidence sentences are exact.
  The reassignments run through the real API.
  - Weak spot: the cross-tenant test asserts `n ≤ 12` for all three users (`agent-reliability.test.ts:149`).
  - Kenji's exact value is 6, so a leak of t-2's 5 failures into his view (11) would still pass. A and M would catch a
    leak (17), so this is a Minor (m7).

## 4. Honesty

- No invented numbers on the server. A value appears only at n ≥ 5, always with n and the window, and the evidence
  sentence lists the parts.
- The DEMO fixture metrics keep their DEMO chips. The measured stat has its own `measured` chip and `?`.
- Demo mode is unchanged, by the gating above.
- 3b's label is not honest about the brief (I1). The mechanism itself is disclosed: D9, the script comment at
  `api-improve.mjs:345-348`, and the report's Concerns.

---

## Findings

### Critical
None.

### Important

**I1: Pass-threshold item 3b is reported as "Met through the brief's fallback" / "As the brief allows", but the brief has
no fallback. As written, 3b is not met.**
- Report text: `c03-report.md:181` and `:244`.
- What the brief allows (`c03-brief.md:21-25`): the script drives 5 or more tasks to terminal states "through the API
  (user actions: cancel, reassign, retry; plus the e2e seam cycle 2 documented, if one exists)".
  - Cycle 2 documented no seam (`c02-report.md:103`, "D8. Browser seam: none added").
  - The premise that 3b is unreachable is true [read]:
    - the only `insert into tasks` in `server/src` is the DEMO backfill, with `simulated = true` (`instances/backfill.ts:41-42`);
    - `pass` and `fail` are only in `SYSTEM_TASK_ACTIONS` (`shared/contracts/src/tasks.ts:6-8`).
- So 3b can't be met as written. The browser reaches n=5 only through a new test-side seam: direct `insert into tasks`
  and `task_attempts` into axion_e2e (`api-improve.mjs:422-430`), plus one user reassign.
  - The report also calls the route tests "the basis of the pass". But 3b is a browser item.
- This is not concealment: D9 and the script comments describe exactly what is done.
- It is still a pass claim on a fixed threshold, backed by an allowance that doesn't exist.
- **Fix (docs only):**
  - Relabel 3b as "PARTIAL / deviation".
  - Say plainly that it can't be met until system pass/fail exist: real missions have no tasks and pass/fail are
    system-only.
  - Name the fixture step as a test-only seam (like the c01 expiry step), and queue the question in `LOG.md`.
  - Also say in the screenshot caption that the "60% measured" comes from fixture rows (m8).

**I2: The final owner inherits an outcome produced under a previous owner, so one failure is charged to two agents. Any
user who can see a mission can add a failure to any agent staffed in it.**
- The cause:
  - The machine allows `failed → reassign` and keeps the task `failed` (`server/src/tasks/machine.ts:19`).
  - `reliabilityOf` charges the agent it left as "reassigned away" (`reliability.ts:58`).
  - It then charges the **new** owner as "failed" (`:59-61`), although that agent never attempted the task.
  - The same happens with attempts, which are counted per task: A fails, a person reassigns to B and retries, B passes,
    and B is charged "retried" (`:62`).
- The tests and the browser check lock this in:
  - `agent-reliability.test.ts:158-162`: the GM gets n=1 for S4, which failed at Coder-01.
  - `agent-reliability.test.ts:173`: Coder-01 is charged S6. Its comment says "S6 failed at Coder-01", but S6 was
    inserted as Tester-01's failed task (`:167`).
  - `api-improve.mjs:396` asserts the failure counts "against Coder-01 as failed".
  - The headline browser value depends on it: the executor's **60% (3 of 5)** includes R5, which failed under the GM
    (`api-improve.mjs:422`, `:436`). That is the value in the committed screenshot.
- It follows the brief literally ("final owner … terminal state"; `failed` is unreliable). So this is a gap in the
  definition, not a spec violation.
- It cuts against the brief's own hypothesis: "the share of the agent's finished tasks that passed on the first attempt
  without being taken away". It also cuts against "measured, never invented".
- There is no live impact today, because real tasks never reach `failed`.
- **Fix:** needs an owner decision or a brief amendment, not a silent change in the fix round.
  - Suggested rule: charge the final owner with `failed`, or with "retried", only when that outcome happened *after* the
    task's last reassign to it.
  - The data needed is already recorded: the reassign audit detail carries `from: 'failed'` and its time, and the
    attempt numbers and times.
  - Until the rule changes, the help text should state it (m3).

### Minor

- **m1. Brief says "cancel" among the user actions for 3b; the c03 browser section never uses a task cancel.** Canceled
  exclusion is covered in unit tests (`reliability.test.ts:67-71`) and by the `vis` filter, so coverage is fine; the browser
  just doesn't exercise it.
- **m2. D4: a `passed` task with 0 recorded attempts counts as a first-time pass.** The brief says "exactly one attempt".
  The rationale (a retry always records attempt 2) is sound and declared. The help text says "passed with one attempt"
  (`overview-org-agent.ts:85`), which is slightly imprecise.
- **m3. Help text gaps:**
  - It doesn't say that a reassigned task's failed status and earlier attempts follow it to the new owner (see I2).
  - It doesn't say that the finish time can be a lower bound (D3).
- **m4. The finish time prefers a stale `task.stateChanged` over a later attempt** (`reliability.ts:113`).
  `greatest(ev.at, att.at, created_at)` would be tighter and just as safe. Today this only ever drops evidence, so it is
  conservative.
- **m5. Performance (declared).**
  - `ev` reads the tenant's events through the `(tenant_id, id)` index (`0003_events.up.sql:21`), with no
    `(tenant_id, type)` index. `moved` uses the `(tenant_id, at)` audit index.
  - Every connected client re-reads `GET /agents` on each `task.stateChanged` or `task.delegated` (400 ms debounce,
    `events.ts:47,79`). The existing 200 ms `agents` debounce can add a second read on org events.
  - The cost grows as clients × tenant events. It is small today. Plan migration 0014 with `events(tenant_id, type)`, or
    a partial index on `task.stateChanged`, before Stage 7.
- **m6. Bias in the skipped audit rows, and clock skew.**
  - Older `task.reassign` rows with neither `fromInstanceId` nor `fromAgent` are skipped. That biases in the agent's
    favour, not conservatively. It is declared and tiny in practice.
  - The window's upper bound `t <= to` (`reliability.ts:56`) compares database timestamps with the app clock. A database
    clock ahead of the app would hide the freshest evidence for a moment. Both run on the same host today.
- **m7. Test gaps.**
  - No test covers a member with `?includeSimulated=1` and a **private** DEMO mission. It is correct by reading
    (`reliability.ts:96`).
  - The cross-tenant assertion `n ≤ 12` is loose for Kenji (`agent-reliability.test.ts:149`). Assert exact per-user
    values instead.
- **m8. The screenshot caption doesn't say where its number comes from.** The report's description of
  `improve-c03-reliability-dark.png` presents "Reliability 60%, n=5" without saying it comes from fixture rows. It also
  includes the inherited failure from I2.
- **m9. Two "Reliability" labels on a profile (declared).**
  - The DEMO fixture metric tile (`orgdemo.ts:117`, under the DEMO chip) sits beside the measured stat.
  - It is honest, since it is tagged, but confusing.
  - Queue an owner question: rename or hide the fixture tile in api mode.
- **m10. A missing field shows a made-up zero.** `Reliability.tsx:15` turns a missing `reliability` into "0 of 5", which
  claims n=0 when the value is really unknown. The server always sends the field, so this is a nit.

## What is good
- The type split (`AgentStoredDto`/`AgentDto`) makes an unmeasured agent DTO a compile error, not a runtime omission.
- Scoping is applied in every CTE. The tests cover:
  - another tenant's audit row that names our task;
  - an agent id shared across tenants;
  - deleted missions;
  - denied reassigns.
- The tests drive reassignments through the real API, and the list ≡ detail test is exhaustive.
- The deviations are written down with reasons (D1–D9). The script's fixture step is clearly commented as such.
