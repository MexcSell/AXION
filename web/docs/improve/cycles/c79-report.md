# Cycle 79 report: tenant-isolation metamorphic suite (R4-4)

Lane w77, branch `c79-tenant-isolation`, from improve-30h at ee6d6ea. Ports 12790-12793 not needed (all tests use `app.inject` and ephemeral listen ports on 127.0.0.1). Database: the shared test database `axion_test` (one fresh schema per world); the e2e DB `axion_e2e4` was not used. The live `axion` DB was never touched. **Tests only: no file under `server/src` changed. No leak was found.**

## What was built (all under `server/test/tenant/`)
- `fixture.ts`, `seedmock.ts`: two tenants in ONE schema. One app serves one tenant (a session only works for `cfg.tenantId`), so A = `t-1` and B = `t-b` are two `buildApp()` calls on the same schema. Both tenants use the same features through the API (SQL or service helpers only where no create route exists: tasks, approvals, notifications) and every free-text field carries a unique marker (`ZQALPHA012Q`, letters and digits only). A has 87 markers and B 79 after the extra rounds (missions, titles, criteria, upload names and contents, thread, channel and admin-channel messages, briefs, ledgers, task titles, review notes, approvals, notices, agent names and descriptions, version proposals, org proposals, mentoring, lessons, skills, grants, failure tags, device and user names, waiting user).
- `isolation.ts`: the detector. Relations, all this cycle's own construction (not from a paper; B2 was OVERSTATED and no per-attacker-victim-pair measurement is claimed):
  - **MR1 invariance:** a GET response for the viewer is unchanged after the other tenant adds a mission, renames a mission, soft-deletes a mission, adds channel messages, a lesson, a skill, a notification and a joining person. A control pass first (nothing changed) must already be identical, which proves the explicit normalisation list is sufficient.
  - **MR3 marker absence:** no marker of the other tenant in (a) every GET response, as admin and as member, before and after (b) the viewer's SSE streams (admin and member), with a positive control: the viewer's own later event must arrive, so the stream was really read (c) every row of every table that has a `tenant_id` column, read at rest (39 tables, audit rows and events included) (d) the OTLP export (c60 `exportMissionToFile`, in process, content included, on the test schema) of each of the viewer's missions (e) the viewer's requests using the other tenant's ids.
  - **Foreign ids:** every GET with the other tenant's id gets 404 or 403 (46 per direction); the other tenant's cookie on this app gets 401; exporting a foreign mission is refused.
  - Viewer activity: the viewer's own audited writes (a person asks to join, approval) keep working and its audit chain still verifies.
- `writes.ts`, `real.test.ts` (item 3): for every POST, PUT, PATCH and DELETE route with an id, the viewer acts on the other tenant's id, as administrator and, where the route is not administrator-only, as member. 404 or 403 required; the owner's GET responses and all its stored rows must be byte-identical afterwards.
- `seam.ts`, `mutants.ts`, `mutants.test.ts` (item 2): 17 seeded leaks through test-process seams (below).
- Timing: `real.test.ts` about 16 s, `mutants.test.ts` about 90 s (a fresh two-tenant world per mutant, serial), load shown by `uptime` at the end of the full run (below).

## Route inventory (from `app.routeTable`)
GET routes: 70. 69 are covered by generated cases (75 cases with query variants), each run as admin and as member, 3 snapshots each (450 responses per viewer per run). The test fails when a GET route has no id source, is neither covered nor excepted, or an exception names a route that does not exist. A status-policy test fails when a case answers other than 200 (administrator-only routes may refuse the member with 403 only when the c50 registry flags them `admin`), so a bad URL cannot make a relation vacuous.

### Global-route exceptions (count: 3, fewer than the 5 the research guessed, so MR3 stays on all GETs; the cut to GET-only was not needed because the writes are covered separately)
| Route | Treatment | Reason |
|---|---|---|
| `GET /events/stream` | excluded from the byte comparison only | A live stream has no stable body. It has its own relation: both viewers' streams stay open while the other tenant writes, no marker may appear, and the viewer's own later event must arrive. |
| `GET /health` | global, still run through every relation | Only whether the database answers and the build version. No tenant data. |
| `GET /auth/hello` | global, still run through every relation | Public: one boolean (does the app's tenant still have no user). |

Write routes: 55 registered with POST, PUT, PATCH or DELETE; 41 take an id: 40 have a generated foreign-id case, 1 is excepted. 14 take no id (nothing foreign to send): `POST /auth/connect, /auth/cancel, /auth/logout, PATCH /me, POST /me/password, /missions, /uploads, /notifications/ack-all, /agents, /organization/proposals, /skills, /company/metric-audits, /site-grants, /failure-tags`. Per direction 57-59 attempts ran (admin plus member where allowed).
| Write exception | Reason |
|---|---|
| `POST /organization/revisions/:seq/rollback-proposal` | The id is a per-tenant revision counter (1, 2, ...): the same number names a different record in each tenant, so there is no foreign id to send. |
| `POST /notifications/:id/ack` (answers 200, not 404) | Not a leak, but it is a deviation from "404 or 403", so it is a checked exception, not a silent one. The route stores `(caller tenant, caller user, notice id)` in `notification_reads` without looking the notice up. Checked on every run: each read row for that id carries the caller's own tenant, none the owner's, the owner's notification list and all its stored rows are unchanged. See concern 3. |
| org proposal decide and withdraw, direction A to B | Tenant B has no organisation chart (see concern 1), so B has no org proposal to target. Skipped and counted; the direction B to A ran them. |

## Seeded-leak mutants (item 2): kill rate 17/17 = 100 %
Each is applied in the test process only (a SQL rewrite on one app's pool, or a hook), switched on after the test sessions are signed in, and each run asserts the fault was really applied (`applied > 0`) so a "kill" cannot be vacuous. A fresh two-tenant world per mutant, so a write that gets through cannot damage the next one. "By intended" means the check named in advance caught it.
| Id | Seeded leak | Killed | By intended check | First finding |
|---|---|---|---|---|
| M01 | mission list loses its `tenant_id` predicate | yes | yes | MR1 `GET /missions` |
| M02 | people and user lists lose it on `users` | yes | yes | MR1 `GET /people` |
| M03 | notification list loses it | yes | yes | MR1 `GET /notifications` |
| M04 | approval list loses it | yes | yes | CONTROL `GET /attention` (visible with no change at all) |
| M05 | lesson list loses it | yes | yes | MR1 `GET /lessons` |
| M06 | skill list loses it | yes | yes | MR1 `GET /skills` |
| M07 | aggregate (operations health mission count) loses it: a number, no text | yes | yes | MR1 `GET /operations/health` (the only check that can see it; MR3 cannot) |
| M08 | wrong tenant (t-b) in every `agent_definitions` read | yes | yes | MR3 marker in `GET /agents` |
| M09 | SSE: the event stream reads `events` without the predicate | yes | yes | sse stream marker |
| M10 | response cache keyed by URL only, shared by both tenants | yes | yes | MR3 marker in `GET /agents` (466 findings) |
| M11 | tenant B's event writes stored under t-1 (wrong tenant on write) | yes | yes | marker in A's stream and `events` rows |
| M12 | OTLP export reads missions, instances, tasks, tags without the predicate | yes | yes | FOREIGN-GET export of a foreign mission |
| M13 | site-grant revoke looks the grant up without the predicate | yes | yes | WRITE: foreign revoke accepted |
| M14 | mission lookup by id loses it (GET, PATCH, DELETE of a foreign mission) | yes | yes | FOREIGN-GET `GET /missions/:id` |
| M15 | session lookup loses its tenant predicate (the other tenant's cookie works) | yes | yes | FOREIGN-GET session of the other tenant |
| M16 | tenant B's audit chain head read without the predicate | yes | yes | `GET /audit/verify` fails |
| M17 | tenant A's audit chain head read with tenant t-b | yes | yes | the viewer's own audited write fails |

Honest notes on the mutant work:
- **M16 first survived.** On tenant A the dropped-predicate fault is an equivalent mutant: A has the longer audit chain, so "the row with the highest seq of any tenant" is A's own head and nothing changes. The first run printed `M16 SURVIVED`. It is now carried by tenant B (the shorter chain), where it changes behaviour, and M17 is the same fault written as a wrong tenant on A. The survival is reported here, not hidden.
- Three other first runs were detector faults, not product facts, and were fixed in the detector, never by loosening an assertion: a per-session rate limit on `GET /audit/verify` (6 a minute) made later mutants "die" on a 429 (now fresh sessions per run, and any 429 or 5xx in a snapshot throws `DetectorInvalid` so it can never count as a kill); a mutant write that got through damaged the shared world (now one world per mutant); the cache mutant broke CSRF through `/me` (the cache now skips `/me` and `/auth`, as a real read cache would).
- M17 and M16 are caught by the viewer's audited-write check and the chain verification rather than by marker text; their `expect` pattern names that.
- The mutants cover missing predicate (7), aggregate (1), wrong tenant (3), cache (1), SSE (1), export (1), write by foreign id (2), session (1). They are a hand-picked set, so the 100 % rate says the suite catches these shapes, not that it catches every leak.

## Pass threshold
| Item | Result | Evidence |
|---|---|---|
| Item 1: MR1 and MR3 generated from the route inventory, global routes listed with reasons | PASS | 69 of 70 GET routes covered, 1 stream excepted with its own relation, 2 global routes listed; green in both directions on the real code; control pass proves the normalisation list is sufficient. |
| Item 2: about 10 seeded-leak mutants, kill rate reported | PASS | 17 mutants, 17 killed, 17 by the intended check; M16 survival and fix reported above. |
| Item 3: write routes with ids, A on B's ids gets 404 or 403, generated from the inventory | PASS with one checked exception | 40 of 41 id-bearing write routes generated, 1 excepted; 404 on all but the two `ack` calls per direction, which answer 200 with a verified caller-scoped effect (concern 3). Owner unchanged after all attempts. |
| Items 1 to 3 green on the real code | PASS | `real.test.ts` 9 tests passed twice in a row. |
| Full vitest serially, every failure named; tsc | PASS | `heavy.sh npx vitest run --maxWorkers=1 --no-file-parallelism` on the committed tree (tip before this report): 137 files passed, 1 skipped (pre-existing); 3205 tests passed, 36 skipped, **0 failed**; 511 s, load average 4.67 at the end. `tsc --noEmit` clean in `server` and `web`. |
| Diff stat shows test files only | DIFFSTAT_RESULT |

## Concerns
1. **The product is not multi-tenant below the table columns.** `agent_definitions.id` is a primary key on its own and the org-chart validator needs the literal root id `gm`, so the standard company seed cannot be stored for a second tenant in one schema (duplicate key on the second `buildApp`). Tenant B therefore gets the same company under prefixed ids (`b-coder-01`) through a `vi.mock` of `seedCompany` in the test files, and no organisation chart, no `POST /agents` (a new agent needs a manager in the chart) and no org proposals. The suite is real for everything else, and A-to-B plus B-to-A both run, so each org route is exercised on A's data from B's side. A real second tenant would first need those two things changed. This is a design observation, not a leak.
2. **Aggregate side channel, normalised.** `GET /operations/health` (admin) returns `sizeBytes`, the size of the WHOLE database, so one tenant's administrator sees the combined size of all tenants. It is on the explicit normalisation list with that reason. Harmless with one tenant.
3. **`POST /notifications/:id/ack` accepts any well-formed id** (foreign or non-existent) with 200 and stores an orphan read marker under the caller's own tenant and user. No cross-tenant read or write results (checked), but it does not verify the notice exists; the same holds for `ack-all`. A 404 would be the stricter contract.
4. **Unordered query.** `GET /departments` builds `memberIds` from `select id, dept, status from agent_definitions where tenant_id = $1` with no ORDER BY; the order flipped between two identical requests on an unchanged tenant (probably a re-plan). `memberIds` and `gmReports` are compared as sets (listed in `UNORDERED_KEYS`); `headAgentId` is derived from `gmReports[0]` and is compared as is. Adding an ORDER BY would remove the exception.
5. **Coverage limits.** (a) The at-rest sweep covers the 39 tables with a `tenant_id` column; 18 tables without one are not swept: `agent_versions, approval_decisions, eval_cases, eval_regrade_cases, eval_results, mentoring_milestones, message_attachments, message_receipts, messages, mission_delegations, mission_revisions, mission_runs, org_edges, schema_migrations, task_attempts, task_dependencies, tenants, thread_reads`. Their text still gets covered through the GET responses and the export. (b) 9 of B's 79 markers are stored but no GET route shows them (task and review fields of the member's mission, an attachment's content, `approval.payload`, a message to an agent channel, and similar); they are covered only by the at-rest sweep and the export. (c) Eval datasets, runs and re-grades were not seeded with markers. (d) Only the OTLP export is a non-HTTP output; backups and the audit-anchor file were not swept. (e) The research file's MR2 (swap tenant ids) and MR4 (forged scope fields, a corpus of at least 40 shapes) were not part of this cycle's items and are NOT done; only a replayed foreign session cookie is checked. (f) Two tenants and two roles per tenant, not three tenants.
6. **The mutants are test seams, not source edits**, which keeps "tests only" true but means a mutant can only fault SQL text, a pool parameter or an HTTP hook, not in-memory logic such as a per-process Map in a route.
7. Run time: the two new files take about 16 s and 90 s (load about 5); the research sketch's run-time budget was not one of this cycle's pass items.
