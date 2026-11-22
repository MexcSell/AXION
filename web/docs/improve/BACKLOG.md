# Improvement backlog

Scores are 1–5: V = value to the owner, E = effort (5 = small), R = safety (5 = low risk). Sum = priority.
Sources:
- the spec: §4.11 Evolution Lab, §10.9 self-evolution, §16.1 six dimensions, Stages 9–11;
- subnet-scout (read only): `organization.py`, `evolution.py`, `analytics.py`, `experience.py`, `company_decisions.py`, `team_eval.py`.

Tags:
- **REC**: works on data the app really records today.
- **EXEC**: only meaningful once agents execute; build the scaffold with "not enough evidence".

Placement: Evolution Lab and Governance pages were removed in u1, so features live in the existing tabs:
- Agents › Proposals, Development, Lineage and Departments;
- Missions KPI tiles;
- Overview, which is hidden but reachable;
- System Operations.

## A. Company structure

| # | Idea | Tag | V | E | R | Σ | Status |
|---|---|---|---|---|---|---|---|
| A1 | Org change proposals: each proposal holds a full proposed set of reporting lines. Checks: a dry run (no cycles, one manager per agent, every role covered); a SHA of the payload; pinned to the base org revision, so approval fails with 409 if the org changed; expires after 7 days; an admin approves and the proposal is applied once into a new org revision, or rejected; everything is audited. Agents › Proposals becomes real in api mode. | REC | 5 | 3 | 4 | 12 | cycle 1 |
| A2 | Before/after org diff and impact: changed lines, plus missions whose staffing would differ. Running instances keep their pinned state. | REC | 4 | 3 | 5 | 12 | |
| A3 | Org history and rollback: a revision timeline. Rollback means proposing the previous revision as a new proposal, which goes through approval again. | REC | 4 | 4 | 5 | 13 | |
| A4 | New missions are staffed from the active org revision, so the executor chain follows the reporting lines. Running missions are unaffected. | REC | 3 | 3 | 3 | 9 | |
| A5 | Capability coverage check: every role and duty is covered, with no orphan agents and no manager without reports. Shown on Departments and used by A1's dry run. | REC | 3 | 4 | 5 | 12 | |

## B. Company performance

| # | Idea | Tag | V | E | R | Σ | Status |
|---|---|---|---|---|---|---|---|
| B1 | Company scorecard from recorded events. Rows: missions finished, verified versus "finished, unverified", median cycle time, failure and recovery rate. Each row has n, a window and an evidence sentence, and is null when n=0. Served by `GET /company/scorecard` and shown in the Missions KPI tiles and on Overview. | REC | 5 | 3 | 5 | 13 | |
| B2 | Throughput trend against the previous equal-length period. The trend is null when either period is empty. | REC | 3 | 4 | 5 | 12 | |
| B3 | Department KPIs from recorded data (instances, tasks, delegations per department), replacing the DEMO capacity and coverage numbers. | REC | 4 | 3 | 5 | 12 | |
| B4 | The six dimensions of §16.1 at company and department level, with sample sizes. Most cells read "not enough evidence" until execution exists. | EXEC | 3 | 3 | 5 | 11 | |
| B5 | Cost per verified outcome. A null scaffold until usage is recorded (Stage 9). | EXEC | 2 | 4 | 5 | 11 | |

## C. Agent performance

| # | Idea | Tag | V | E | R | Σ | Status |
|---|---|---|---|---|---|---|---|
| C1 | Agent reliability from delegations and task attempts. Delegated tasks done without failure or retry count as reliable. Below 5 pieces of evidence the score is null, with the count always shown. Uses provenance `measured`, on the Agent Profile and Directory. | REC | 4 | 3 | 5 | 12 | |
| C2 | Agent version proposals: candidate config with its SHA and `base_sha`, a status, a manual promote that checks the SHA (409 when stale), and one-click rollback creating a new version. Running instances stay pinned, and the author can't promote their own proposal. Agents › Development becomes real. | REC | 5 | 2 | 4 | 11 | |
| C3 | Experiment verdict as a pure function: paired cases, `min_cases`, margin, losses ≤ wins, zero failures, with the "why not verified" reasons. The evaluator must not be the author and the dataset SHA must match. Built as a scaffold and tested on fixtures. | EXEC | 3 | 4 | 5 | 12 | |
| C4 | Mentoring plans: mentor, target skill, milestones and a re-evaluation date. Recorded, and shown in Development. | REC | 3 | 3 | 5 | 11 | |
| C5 | Post-promotion watch: an opened, baseline, expires row showing "waiting for N measured runs". Records only and never rolls back automatically. | EXEC | 2 | 4 | 5 | 11 | |
| C6 | Recommendations as proposals only: promote or review-role, only above the evidence threshold, and never applied automatically. | EXEC | 2 | 4 | 5 | 11 | |

## Code health (between themes when a cycle finds a need)

| # | Idea | V | E | R | Σ |
|---|---|---|---|---|---|
| H1 | Fix the deferred minors from the Stage 6 ledger, in batches. | 3 | 4 | 5 | 12 |
| H2 | Split the main bundle (motion, radix, help registry) to cut initial load. | 2 | 3 | 4 | 9 |

## Planned order

A1 → B1 → C1 → A3 → B3 → C2 → A2 → B2 → C3 → A5 → B4 → C4 → A4 → C5 → H1. The order is adjusted by lessons.

**Revised after cycle 3** (see LESSONS: measurement can't be exercised before execution): A1 ✔, B1 ✔, C1 ✔ → A2+A3 (c04: history, diff, rollback) → C2 (c05: agent version proposals, promote and rollback) → H4 (c06: flaky browser checks) → A5 (c07: coverage check) → B3 (c08: department staffing facts) → C4 (c09: mentoring plans) → A4 (c10: staffing follows the org) → H1/H2 (code health) → C3/C5 scaffolds last.

| H3 | Race: POST /agents reads the org edges before taking the org-revision lock, so an agent created while a proposal is approved can silently revert it (found in cycle 1). One-line fix in agents/routes.ts. | 5 | 5 | 4 | 14 |

| H4 | Flaky browser checks: api-stage6 Edit-dialog save (I2) failed once in c01 and c02 combined runs; c01 proposal-expiry step races with another browser re-read (c02 papered over it with a 1.5 s wait). Replace fixed waits with condition waits and remove the races. | 4 | 4 | 5 | 13 |

| H5 | Agent Profile tabs overflow by 13 px at 1366×768 (the fit-check fails; pre-existing, found in c05 and c06). Make the tab bar fit (icon-first when narrow), per the owner's one-screen rule. | 4 | 4 | 5 | 13 |

| H6 | Loading and busy texts in api mode ("Loading instances…" and similar in Agents, AgentProfile, ServerProposals, JobSearch) sit in plain divs with no role=status/aria-live; also check Tab wrap-around in the a11y script (from the c16 review). | 3 | 4 | 5 | 12 |

| P2 | Virtualise long conversation threads (c22: a live 1,000-message burst still keeps the page busy; api-stage6 counts one DOM row per message, so coordinate the check). | 3 | 2 | 4 | 9 |

| H7 | flows.mjs steps flake under load (Hierarchy even at 1x; Conversations, palette, theme, help popover, u1 News / Chat dock under load), found in c29. Make every step condition-based and check it under FLOWS_CPU_THROTTLE=4. After c28 and c29 merge. **Measured on the merged tree (batch 5f, f85f310, 4× throttle): 19/21, the archive step PASS, `Command palette navigates (Ctrl+K)` and `Theme toggle` FAIL (waitForURL / click timeouts), so the palette still fails under throttle after c28.** | 4 | 3 | 5 | 12 |

| H8 | useStaffingDriver (web/src/features/mission/staffing.ts:12-21) ticks over a `missions` array captured at render time, so between a store update and the React commit a tick can advance a just-archived mission (staffing-plan.ts:97 checks the stale copy). Read fresh state from the store inside the tick, and prove c29-archive-race.mjs fails on a known-bad mutation. From the c29 review. | 3 | 5 | 5 | 13 |

| E1b | Wire verdictV2 into version proposals: bind runs to the holdout dataset id, compute the observed hash from the stored cases (not from the caller), check content_sha256 against the cases, and refuse an INSERT of an already-frozen dataset with no cases (the c32 guard covers only UPDATE). From the c32 review and fix round. | 4 | 3 | 5 | 12 |

| P5b | Audit chain anchor: keep the latest hash outside the DB, or use an HMAC key held outside agent-editable storage, so truncation of the newest rows or a full rehash is detected (c31 limit). | 4 | 3 | 4 | 11 |

| P3a | Approvals UI: hide or disable Approve/Deny for members on R3/R4 requests, with a `?` explaining "needs an administrator" (the server now refuses with 403 POLICY_DENIED, c30). Fold into P3. | 3 | 4 | 5 | 12 |

| P3b | Second-approver rule. Agent requests carry agent ids in requested_by, so "decider ≠ requester" never fires for them: a human who created a mission can approve their own agent's R3/R4 request alone. Needs either a distinct owner role (Q9) or a two-person rule for R3/R4, with a fallback for single-admin tenants (for example a time delay plus a notification). Found in the c35 review. | 4 | 3 | 4 | 11 |

| P4a | IDN site grants. c36 refuses every internationalised hostname (fail closed after the review found Armenian, Hebrew, Han/Kana and combining-mark look-alikes). Add an explicit path: the admin types the Unicode name, the UI shows the punycode plus a script-mixing / confusable report (UTS #39 skeletons), and a second confirmation is required. | 2 | 2 | 4 | 8 |

| P4b | Full public-suffix check: c36 embeds a partial list of multi-tenant suffixes. Vendor a pinned Public Suffix List snapshot (with a hash) and refuse grants on any public suffix. | 3 | 3 | 5 | 11 |

| H9 | Refresh c15 contract tests against the full API after batch 8 (held at batch 5: written before cycles 4–20, with 53 drift fields, 19 uncovered routes and 7 events). Generate the coverage list from the route table so new routes can't go uncovered. | 4 | 3 | 5 | 12 |

| O3a | Task-review hardening (from the c38 re-review). (1) An append-only owner-history table written by a trigger on `tasks`, so prior-actor exclusion is fail-closed and doesn't depend on audit rows. (2) A review only verifies if it is newer than the task's latest attempt (today an old accepted review re-verifies a fail → retry → pass). (3) The o-series match is `o[1-9]` exact plus a separator, and router prefixes that name a different vendor (`anthropic/gpt-4`) → null. | 3 | 4 | 5 | 12 |

| O2a | Require a delegation brief on every human reassignment (c42 leaves it optional because the frozen api-stage6 reassign step sends none). Update that script step first, then make the brief required server-side. | 3 | 4 | 5 | 12 |

| P5c | Events-lock exposure after c31. `audit()` now takes the database-wide events advisory lock (schema-scoped since 9e958f3) before the tenant chain lock, and pool audits such as sign-in run with `lock_timeout = 5s`. So any transaction that appends an event early and then waits (row lock, slow query) can turn unrelated sign-ins into 500s. Measure the longest events-lock hold in the scale bench. Then either order event and audit writes last in every transaction, move to a per-tenant events lock (if SSE ordering allows: streams are tenant-scoped), or let the sign-in audit retry once. From the batch 7 integration. **Measured (c49, small DB, busy machine):** hold p50 2.1 ms / p99 4.7 ms / max 14.8 ms over 4,658 transactions at concurrency 12, so the risk is pathological transactions only; priority lowered. | 4 | 3 | 4 | 11 |

| P2b | Thread follow-ups from c44. (1) The older-page restore anchor holds for 1 s; a row measured later than that (heavy load) falls back to the c26 race. Replace the timer with "until every row above the anchor is measured". (2) The rest of the full-burst cost is thread-level: a forced layout from `ChatView.hold`'s `scrollTop` read (about 150–175 ms), plus React dev-mode cost. Measure a production build too, as a secondary number. (3) api-c44's latency bar (200 ms absolute) discriminates thinly; make it relative to the quiet control. (4) One unexplained api-c22 N=1000 reload that was not interactive within 180 s at load 9–15, not reproduced in 3 later runs. | 3 | 3 | 5 | 11 |

| E1c | Before any eval-run write route exists: (1) count candidate runs per (tenant, agent, candidate config sha, holdout dataset) **across proposals**, so withdrawing and re-proposing can't shop for a better re-run on the same holdout; apply the same count to base runs; (2) let a crashed or unfinished run be resumed or finished instead of failing with `holdout_rerun`; (3) validate judge model-family labels against the c38 vendor alias table on write; (4) accept 16–17-digit floats by proving JS and SQL number rendering agree, or by storing scores as fixed-point; (5) `dev_holdout_reuse` false positives on generic shared inputs (match on case id plus input, or a minimum overlap). From the c47 re-review. | 4 | 3 | 5 | 12 |

| H10 | Merge minors from integrator #3: (1) c41's skill lock lower-cases the name in JS but the uniqueness uses SQL `lower()`, so they differ for non-ASCII names; compute the lock key from SQL `lower()`. (2) c38: `taskReviews.cancel()` on sign-out (like the other refreshers). (3) The c04 History check bans the word "coverage" (over-broad). (4) Name the 3 vitest failures seen after c09 (probably the lock class fixed in 4eca9db) by re-running that merge commit. (5) `POST /approvals/:id/decision` returns `decidedByName: null` for a decided request while `GET /approvals` returns the name (the handler re-reads the bare row without the decider join); found by c50, on its exercised.ts allowlist as FINDING. | 3 | 4 | 5 | 12 |

| M1b | Six dimensions follow-ups (c46 review): (1) c46b: source `verdict_outcomes` by recomputing verdictV2 over c47's stored proposal runs; (2) move the Six dimensions dialog (DL-98) to a tab inside the shared PageFrame (owner rule: shared PageFrame on every page). | 3 | 4 | 5 | 12 |
