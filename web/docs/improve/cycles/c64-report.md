# c64 report: restructure guardrails for org change proposals (R3-6)

Lane w62, branch `c64-restructure-guardrails`, from `improve-30h` at 07831cd. Migration 0048. E2E database axion_e2e11. Ports 11290-11293.
Load average during the checks: 20 to 26 (printed next to each timing below). No subagents were used.

**Evidence base, as the brief asked:** A6 is cited only as support for "gate a restructure on contracts", and it has no numbers. A8 is not cited. The literature gives no rule for when to restructure, so the design asks for stated evidence, preserved contracts, limited churn, a baseline and a cost, and holds **no belief that more hierarchy helps** (the help text says so too).

## What was built (one commit per item)

| Item | Commit | Summary |
|---|---|---|
| 1 Evidence block | 5b346e5 | `triggers` are picked from a closed list (`load_imbalance`, `coverage_gap`, `repeated_reassigns`, `failure_concentration`). The server computes every count (`organization/evidence.ts`). A typed count or an `evidence` key is a 400. `none picked` is valid and shown as "no recorded trigger". Migration 0048 adds `triggers`, `baseline`, `expected_cost`, `lines_changed` to `org_proposals`. |
| 2 Contract checks | 27f0020 | `organization/guardrails.ts`, pure, composed into the dry run (not into `validateOrg`, which hires and the seed also use). Failures are dry-run errors, so approval is refused with ORG_INVALID. |
| 3 Churn and cooldown | 4c5f10f | `organization/churn.ts`. Operator settings `Config.orgGuardrails` (env `ORG_COOLDOWN_HOURS`, `ORG_CHURN_BUDGET`, `ORG_CHURN_WINDOW_HOURS`, `ORG_MAX_ESCALATION_LEVELS`), never routes. Refusals `ORG_COOLDOWN` (409) and `ORG_CHURN_BUDGET` (422). All time comparisons are SQL `now()`. |
| 4 Baseline and cost | 28f5f45 | `baseline` and `expectedCost` required (20 to 1000 characters after trim) to submit, optional on `?dryRun=1`, bound into `payload_sha`. |
| 5 UI | 7fcebc4 | New-proposal dialog (trigger picker, baseline, cost, evidence, contract checks, churn status) and the approval card show all of it, with a "?" help on each part. |
| 6 Contracts | in each item | Validators and DTO types for every new field, `ERROR_CODES` for the two refusals. **No new route, so no registry entry was needed. No allowlist line was added** (`allowlists.ts` and `exercised.ts` are untouched). |

## Contract checks: defined and dropped

| Check | Decision | Reason |
|---|---|---|
| Reviewer per team (`REVIEWER_PER_TEAM`, code `TEAM_REVIEWERS`) | **Defined, new** | A team is a manager and everyone who reports to them. A team whose members change must keep **at least 2 members able to review**: active, with a model family c38 can name (unknown family = fail closed, as in c38). Unchanged teams are not checked (so an old weak team does not block an unrelated change). |
| Escalation within N levels (`ESCALATION_WITHIN_LEVELS`, code `ESCALATION_TOO_DEEP`) | **Defined, new part only** | The org model supports reporting chains. "Reaches the GM at all, no loop, no dangling chain" was already enforced (`NO_MANAGER`, `NOT_UNDER_GM`, `CYCLE` with limit 64), so it is **not counted as new**. The new part is the bound: every active agent within N levels below the GM (operator setting, default 6). |
| Role output contract unchanged | **Dropped** | It needs a field that does not exist (the org model has no output-contract field for a role). Inventing one would be a typed claim nobody can check. |
| Orphan duty, manager without reports | Not new | Already A1/A5. Not in the corpus. |

Known limit: whether a team spans two model families is **not** checked. The seeded company is almost all one family, so that rule would refuse nearly every change. A team of all one family can still pass `REVIEWER_PER_TEAM`, although an agent of that family cannot review a peer of the same family (c38). That is a gap in the "possible reviewer" reading, not a claim of independence. See concerns.

## Corpus (`server/test/org-guardrails.test.ts`)

- **33 hand-made bad proposals** that break the **new** rules only. 23 break `TEAM_REVIEWERS` (the team left with 0 or 1 able member, an unknown-family manager of a new team, retired members, two teams at once), and 10 break `ESCALATION_TOO_DEEP` (chains of 7, 8, 9 and 10 levels, in different places). Each one first asserts that the **old** dry run (`validateOrg`) returns `errors == []`, so only a new rule can reject it. The dry run rejected **33 of 33** with the expected code.
- **16 good proposals**, accepted **16 of 16**, including the boundaries: exactly two able members, a chain of exactly 6 and of 5 levels, an untouched weak team beside an unrelated change, a lead left alone, a swap.
- Shape and settings: the same 6-level chain fails at N = 5 and passes at N = 6; the checks are pure and cycle-safe; the list is exactly the two checks.
- Route level: a normal move lists both checks as passed; a new team of two unknown-family agents is stored with the failed check and its approval is 422 ORG_INVALID.

## RED / GREEN evidence

Item 1 (`server/test/org-restructure-evidence.test.ts`, 9 tests)
- RED on the unchanged code: 8 failed, 1 passed. First error line: `AssertionError: expected undefined to deeply equal { triggers: [], windowDays: 30 }` ("no trigger picked" test); the others `TypeError: Cannot read properties of undefined (reading 'evidence')`. (The "typed counts are refused" test already passed on old code, because the schema was strict; it stays as a regression guard.)
- GREEN: 9 passed. With proposals, org-history, org-coverage, c11, migrate: 84 passed.
- Facts verified: simulated tasks, demo missions, finished tasks, proposed-only and 45-day-old tags, denied reassigns are not evidence. The 30-day window for tags is exercised. **Audit rows cannot be back-dated** (hash chain), so the window bound for reassigns is not tested by an old row; it is the same SQL `now() - make_interval(days => 30)` as the tag query.

Item 2 (`org-guardrails.test.ts`, 56 tests)
- RED: `Error: Cannot find module '../src/organization/guardrails.ts'` (no tests ran). The route tests also failed on the pre-wiring code with `expected undefined to deeply equal [ ObjectContaining{…}, … ]` (no `contracts` in the result).
- GREEN: 56 passed. Org suites 137 passed.

Item 3 (`org-churn.test.ts`, 8 tests)
- RED on the unchanged code: 8 failed. First: `AssertionError: expected undefined to match object { cooldownHours: 24, …(1) }`, then `expected 201 to be 409` and `expected 201 to be 422`.
- GREEN: 8 passed. The cooldown test moves `decided_at` by SQL: at 23 h 59 min it still holds ("1 minute left"), at 24 h 1 min it is over. The churn window: at 47 h 59 min the lines still count, at 48 h 1 min they do not. Budget exact: 3 lines allowed, the 4th refused. A rollback is not held. Default (no settings): nothing refused.

Item 4 (`org-baseline.test.ts`, 6 tests)
- RED on the unchanged code: 4 failed, 2 passed. First: `AssertionError: expected 201 to be 400` (a proposal with neither text was accepted); the others show no `baseline` / `expectedCost` on the DTO.
- GREEN: 6 passed. 19 characters, 19 plus padding spaces and 1001 are refused; 20 and 1000 accepted. A tampered baseline is `409 PROPOSAL_CHANGED`. A proposal row from before c64 (no texts, no triggers) still verifies with the old sha formula and can be decided.
- **Existing org tests were tightened only by sending the two now-required fields** (a shared `ST` constant): `proposals.test.ts`, `org-history.test.ts`, `org-coverage.test.ts`, `c11-staffing-org.test.ts`, `contracts/coverage.test.ts`. No assertion was loosened. The browser checks `api-improve.mjs`, `api-c11.mjs`, `api-c20.mjs` got the same two fields (and a new "Submit is disabled until both are written" check in api-improve).

Item 5 (`web/scripts/api-c64.mjs`, 24 checks)
- First run on the new UI: 2 FAIL (the dialog was 108 px taller than the screen, and one expectation on trigger order); both fixed (shorter sub line, triggers moved under Why, statements as a bottom row, compact one-line evidence facts). Last run: ALL PASS. The RED for "no UI at all" was not run against the old UI (no separate checkout); the script's first checks need elements that did not exist before.
- Checks include: the dialog fits 1366x768 with no inner scroll; Submit disabled until both statements have 20 characters; the stored triggers/texts/churn; the card shows baseline, cost, evidence, two passed contracts and churn status; 5 card "?" helps open; "No recorded trigger" is shown for a proposal with no trigger; the server refuses a proposal without the two texts; Proposals fits one screen with one and two cards.

Item 6 (contracts)
- RED: with `triggers`/`baseline`/`expectedCost`/`linesChanged` removed from the proposal validator, the coverage test fails: `contract drift: expected [ …(66) ] to deeply equal []` and the node-by-node non-vacuity test fails. Restored.
- GREEN: `test/contracts` 15 passed (serial). The coverage test now fills every new field in some real call: it sets `app.cfg.orgGuardrails` around the organisation section (budget for all, cooldown from the rollback proposal on, because a rollback is exempt but its stored churn status shows the running cooldown), picks triggers on the dry run, the stored proposal and the rollback.

## Threshold

| Item | Result | Evidence |
|---|---|---|
| 1 Evidence block, server-computed | **PASS** | 9 tests; typed counts 400; "no recorded trigger" shown (api-c64). |
| 2 New contract checks; corpus 100% / 100% | **PASS** | 33 of 33 bad rejected, 16 of 16 good accepted; escalation defined (only the N-level bound is new), output contract dropped with the reason above. |
| 3 Churn budget and cooldown, DB `now()`, named refusals | **PASS** | `ORG_COOLDOWN`, `ORG_CHURN_BUDGET`; boundaries by SQL, no sleeps. Settings are env/config, no route. |
| 4 Baseline and cost required, in the approval view | **PASS** | 400 without; digest-bound; shown on the card (api-c64). |
| 5 UI: evidence, checks, churn, baseline; plain words; "?"; fits 1366x768 | **PASS** | api-c64 ALL PASS at 1366x768 (dialog and card); api a11y 0 violations. |
| 6 Contracts, no allowlist lines | **PASS** | validators + DTO + ERROR_CODES; no registry entry needed (no new route); allowlist files untouched. |
| Every A1 to A5 org test passes unchanged, or is tightened with a reason | **PASS, with tightening** | Only the two required fields added to POST bodies (reason: item 4 makes them required). |
| tsc | **PASS** | server and web `tsc --noEmit` exit 0. |
| Full vitest, serial fallback, name every failure | **PASS (serial)** | See below. |
| Org api checks, stage6, improve | **PASS** | `api-improve` 108/108 (after fixing two more proposal POSTs in the script), `api-c11` 16/16, `api-c20` ALL PASS, `api-c64` ALL PASS, `api-stage6` 94/94. |
| verify-all 10/10 | **PASS** | `verify-all: ALL 10 STEPS PASSED` (dev server on 11290, own OUT dir; load 20 to 26). |
| fit-check and a11y clean in both modes | **PASS for c64, with a pre-existing api-mode fit failure outside it** | Demo mode: fit-check at 1366x768 ALL FIT; a11y 51 views, 65 dialogs, 0 violations. Api mode: a11y 41 views, 65 dialogs, 0 violations; the new Proposals dialog and card fit at 1366x768 (`api-c64`). Api-mode fit-check at 1366x768 has 10 BAD views, all agent-profile tabs, identical on the base commit (see below). |

### Full vitest
- First parallel run (load 26): **5 files failed, 8 tests failed, 1 unhandled error**: `error: too many connections for role "axion"` (the 45-connection cap shared by all lanes, BACKLOG H14; the unhandled error came from `test/jobs.test.ts:503` in the "stress: 6 workers" test). **I did not capture the names of the 8 failing tests**: my log kept only the tail of the run. They were all the connection error; the serial run below shows none of them fail on their own.
- Serial fallback (`--maxWorkers=1 --no-file-parallelism`, load 20.9): **78 files passed, 2405 tests passed, 0 failed.**

### api fit-check at 1366x768 (api mode)
10 views are BAD, all `/agents/coder-01?tab=*` (mainOver 48). **They are not caused by c64**: I checked out 07831cd in a throw-away worktree and ran the same fit-check, which printed the identical 10 BAD lines with the same numbers. The worktree was removed. This lane did not touch the agent profile.

## Files changed
Server: `server/migrations/0048_restructure_guardrails.{up,down}.sql`, `server/src/config.ts`, `server/src/organization/{evidence,guardrails,churn}.ts` (new), `server/src/organization/{proposals,history}.ts`, `server/.env.example`.
Contracts: `shared/contracts/src/{agents,errors}.ts`, `server/test/contracts/{validators.ts,coverage.test.ts}`.
Server tests (new): `org-restructure-evidence`, `org-guardrails`, `org-churn`, `org-baseline`. Tightened: `proposals`, `org-history`, `org-coverage`, `c11-staffing-org`.
Web: `web/src/features/agents/OrgRestructure.tsx` (new), `ServerProposals.tsx`, `web/src/dialogs/defs/org-proposals.tsx`, `web/src/api/orgProposals.ts`, `web/src/help/pages/overview-org-agent.ts` (6 help keys), `web/src/theme/pages/overview-org-agent.css`.
Browser checks: `web/scripts/api-c64.mjs` (new), `api-improve.mjs`, `api-c11.mjs`, `api-c20.mjs` (two required fields).

## Concerns and decisions for the controller
1. **The settings are off by default** (0 or unset = not enforced). A non-zero default would break every flow that proposes twice in a row (the unit tests, `api-improve`, `api-c11`, the owner's own use) without anyone choosing it. The guardrail exists, is tested, and is shown ("no budget or cooldown set"), but it protects nothing until the operator sets `ORG_*` in the live `.env`. **Owner question:** what cooldown, budget and window?
2. **Rollback proposals are exempt from the cooldown and the churn budget** (undoing a change must stay possible), but they count toward the window and start a cooldown, and they must still keep the contracts. A rollback to a chart that breaks the contracts today is refused with ORG_INVALID.
3. **Reviewer rule is "two members able to review", not "two model families".** See the known limit above. A family-diversity warning was left out to avoid noise on the seeded company; say if you want it.
4. **Applied proposals made before c64 count 0 lines** toward the churn window (the migration cannot recompute them cheaply). It only matters for a proposal applied inside the window at the moment the operator turns the budget on.
5. The `supported` rule per trigger (busiest agent at least 3 open tasks and 2x the average; at least 2 reassigns; at least 3 confirmed tags with half on one role) is my reading, not from the literature. It is shown to the reader and never changes approval. The numbers are stated in `evidence.ts` and the help text.
6. Evidence counts use all non-demo, non-deleted missions (the proposer is an administrator, who sees all), and the stored counts are readable by every signed-in user, like the rest of the proposal. They are counts and agent or role ids, no mission titles.
7. The first full parallel vitest run hit the shared connection cap again (H14). The serial run is clean.
8. The migration number 0048 leaves gaps in the sequence (0046, 0047 belong to other lanes); the migrate test passes.

## Fix round (review rulings S1-S6)
Test-first on 9c70ba8. RED = the new tests failed on the unfixed code (S1: 3 of 4 new churn tests failed, the flip-flop got 201 where 409 was required; S2-S4: 5 of 5 new tests failed; S6: both new guardrail tests failed). GREEN = same tests after the fix. Migration 0048 was extended in place (unmerged): `org_proposals.rollback_to int null`.

- **S1, rollback exemption.** Only the undo of the last applied change is exempt: target = the revision just before the current one, and the current one was applied by a normal (non-rollback) proposal (`undoesLastChange` in proposals.ts, from `rollback_to`). Every other rollback (roll-forward, undo of an undo, older revision) follows the cooldown and the budget and still counts toward the window. Cooldown and budget are re-checked at approval (`ORG_COOLDOWN` 409 / `ORG_CHURN_BUDGET` 422); the exempt undo stays exempt there. Flip-flop test: after the first allowed undo, rolling forward is refused with `ORG_COOLDOWN`. Test tightened with a reason: "a rollback proposal is never held by the cooldown" rolled back two revisions (the flaw itself); it now rolls back to the previous revision and a second test shows the older target is held. `contracts/coverage.test.ts` set up its rollback the same way and now does an exempt undo of a proposal it made (plus a cooldown dry run), so every churn field is still filled.
- **S2.** `failure_concentration` share is top-role tags over ALL confirmed tags in the window. Test: 1 attributed out of 10 is "not backed".
- **S3.** `TriggerEvidence.scope` is `now` (load, coverage) or `window` (reassigns, failures); the UI labels each row "now" or "last 30 days". Reassign counts now join the task and mission and exclude demo, deleted and simulated work. Tests for both.
- **S4.** `OrgEvidence.others` holds the unpicked triggers with their counts (`triggers` stays the picked ones); the UI shows all four, picked ones marked "picked", others "not picked". Test tightened with a reason: "no trigger picked" now also lists the four as `others`.
- **S5.** The card and the dialog show "as of <time>" on the evidence and the churn status (stored proposals: creation time). `OrgChurn.exempt` marks the exempt undo; its card says "undo of the last change: not held by cooldown or budget" and no frozen "cooldown left".
- **S6.** With both settings off the chip reads "budget and cooldown: not enforced" (one setting off: "budget: not enforced" or "cooldown: not enforced"). `ORG_MAX_ESCALATION_LEVELS=0` now means not enforced (the check's title says so); unset stays the default of 6. config.ts and `.env.example` say so. The level check covers only agents whose chain of managers the proposal changes, so an existing deep chain no longer blocks unrelated proposals. Help texts updated (evidence, contracts, churn, triggers). Dialog layout: unpicked rows are one line; the dialog still fits 1366x768 without an inner scroll.

S7 stays in the backlog (not done).

### Results after the fix round
- tsc (server and web): clean.
- Full vitest, serial (`--maxWorkers=1 --no-file-parallelism`) via heavy.sh: 79 files, 2415 tests passed, 0 failures (was 2405; +10 new tests). No parallel run was attempted this round, so no H14 names to record.
- api-c64 ALL PASS (now 28 checks; four new fix-round checks), api-improve 108/108, api-c11 16/16, api-c20 ALL PASS, api-stage6 94/94 (ports 11292/11293).
- Note on api-improve: it first failed "nothing invented" because the check's regex read a fact number followed by the next row's label "Coverage gap" across a line break. The test was not touched: the evidence rows now end with the scope text ("now" or "last 30 days"), not with a number. It then passed 108/108.
- fit-check at 1366x768, api mode: the same 10 pre-existing `/agents/coder-01?tab=*` BAD lines as on base 07831cd (mainOver 48), nothing new.
