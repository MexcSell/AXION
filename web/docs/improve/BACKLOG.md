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
