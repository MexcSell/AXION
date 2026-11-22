# c64 review (R3-6 restructure guardrails), lane w62, 07831cd..9c70ba8

Verdict: CLEAR AFTER FIXES (no blocker). One should-fix with a reproduced bypass (rollback exemption), plus smaller fixes below.

## What I ran (scratch worktrees under /tmp, removed afterwards; lane tree untouched; ports 11292/11293 only; all through heavy.sh)
- 11 server test files (org-guardrails, org-churn, org-baseline, org-restructure-evidence, proposals, org-history, org-coverage, c11-staffing-org, contracts/*): 166 passed, no connection errors. tsc clean.
- api-c64: ALL PASS (24 checks). api-improve 108/108, api-c11 16/16, api-c20 ALL PASS.
- api-c64 copied onto base 07831cd (old UI): FAIL at once, "waiting for locator [data-trigger-pick=load_imbalance]". So it is not vacuous; it does depend on the new UI.
- Scratch test on c64 head for the rollback exemption (see S1).
- Full vitest not re-run (lane reports 2405 passed serially; the 11 relevant files pass here). The lane did not record the 8 failing test names from its parallel run (H14). Minor, noted.

## Findings

### S1 (should-fix) A "rollback" can restructure without limit: exempt from cooldown and budget, any earlier revision, roll-forward allowed
Evidence: history.ts:128-145 accepts any earlier `seq` (only refuses the active one or identical lines); proposals.ts createProposal `gate = opts.rollbackTo === undefined`.
Repro (scratch test, cooldownHours 24, churnBudget 2): a normal move is approved (rev 2); a new proposal is refused 409 ORG_COOLDOWN. Then four rollback proposals in a row, flip-flopping rev 2 -> 1 -> 2 -> 1 -> 2 (target = previous current), each created 201 and approved 200. Afterwards the dry-run churn shows `usedInWindow: 5` against `budget: 2`, cooldownEndsInMinutes 1440. Only previously approved charts can be reached, and a second administrator must approve, so this is not free-form restructuring. But the budget and cooldown mean nothing against flip-flopping, which is exactly the churn they exist to stop.
Fix: exempt only a rollback to the revision just before the latest applied proposal (undo the last change); a rollback to any other revision, or a roll-forward (target newer than an already rolled-back one), goes through cooldown and budget. Or at least: rollbacks count and are refused when window usage is already over budget. Add a test with the flip-flop above.
Also (minor, same area): the stored churn on a rollback card shows "cooldown: 24 h left" although rollbacks are exempt; confusing.

### S2 (should-fix) failure_concentration "supported" does not match its stated rule
evidence.ts: `supported = total >= 3 && top.n / max(1, attributed) >= 0.5`. `total` counts all confirmed tags (messages, attempts, missions, simulated tasks), but the share uses only the tags attributed to a role. Help text and report say "at least 3 confirmed tags with half on one role". With 10 tags of which 1 sits on a task, the trigger reads "backed by the counts" (1/1). Informational only, never affects approval, but the label is wrong. Fix: require `top.n >= FAILURE_MIN_TAGS` (or share of `total`), and add a test.

### S3 (should-fix, small) Evidence header says "last 30 days" for all triggers
load_imbalance (open tasks now) and coverage_gap (today's chart) are point-in-time, only reassigns and tags use the 30-day window (evidence.ts, OrgRestructure.tsx line "last {windowDays} days, real work only"). Also repeated_reassigns does not exclude demo or simulated missions (audit rows), unlike the other counts, while the help says demo and simulated work is excluded. Fix: label per trigger, and either filter reassigns by mission or say so in the help.

### S4 (minor) Cherry-picking triggers
The server computes only the picked triggers, and the UI shows only those. A proposer can pick the one trigger that is "backed" and hide the others. Counts themselves cannot be typed (CreateBase and DryRunIn are `.strict()`, tested; I found no route for typed counts). Also coverage_gap is computed on today's chart whatever the proposal changes, and repeated_reassigns depends on which agents the proposer moves (affected roles). Suggest: always compute and show all four triggers as a small row, mark the picked ones. Not a blocker: the brief says the proposer picks.

### S5 (minor) Evidence and churn on the approval card are a snapshot from creation
The card shows the stored `result` (evidence, churn) with no "as of" time. Approval re-runs the dry run but does not refresh what the approver sees. Add "computed when proposed" to the label or recompute for pending proposals.

### S6 (minor) "Not enforced" wording and partial settings
- Churn chip when both are off says "no budget or cooldown set" (OrgRestructure.tsx ChurnStatus). Honest, but not the word "not enforced". If only one of the two is set, nothing is said about the other.
- ORG_MAX_ESCALATION_LEVELS=0 does not mean "not enforced": guardrails.ts falls back to 6, while config.ts and .env.example say "0 or unset = not enforced" for the group. The level check is always on. State that in config.ts/.env.example.
- A deep chain that already exists blocks every unrelated proposal and every rollback (the level check covers all active agents, not only those the proposal touches). Probably intended, but say so in the help text.

### S7 (minor) Corpus is real but narrower than 33 suggests
org-guardrails.test.ts: each bad case asserts the OLD validateOrg returns `errors == []` and a new code is raised, so the "old dry run passes first" claim is verified, and I ran it (all pass). Variety: 23 TEAM_REVIEWERS cases built from one 27-agent chart with 4 teams, many are permutations of "move one member out / unknown family manager in / retire two" (e.g. three cases a1/a2/a3 leave with the other two retired; "d1 reports to s3" appears three times in different words; "chain of 7/8/9/10 levels" are the same pattern over t1..t10). I count about 12 distinct shapes. Still above the 30 asked, and boundaries are in the good corpus (exactly 2 able, exactly 6 levels, 5 vs 6 setting). It tests the pure function plus two route tests; the corpus does not run through the route. Acceptable.

### Checks that passed (no finding)
1. Tenant and window scoping: every evidence query filters tenant_id (missions m.tenant_id, failure_tags, audit_events, agent_definitions) and uses SQL `now() - make_interval(days => $2)`; no app-side time. Demo, deleted missions, simulated tasks and unconfirmed tags are excluded for load and failure counts.
2. Reviewer rule: "changed team" = member list differs from the current chart (a team is manager plus reports). Two-step slip fails: moving a member out of a team re-checks that team, moving one in re-checks the destination, so no sequence of single moves leaves a changed team below two able members. Dissolved teams are covered by the A5 warning, their members land in checked teams. Re-run at approval (dryRun without gate still includes contract errors) so a retired agent between proposal and approval is caught. Known limit, disclosed: able = active + c38-nameable family, not "different family from the producer".
3. Escalation bound: `n <= max` with GM = 0; loops and dangling chains return null and are left to CYCLE/NO_MANAGER/NOT_UNDER_GM (consistent, tested not to hang). Reports only the first over-limit agent per chain.
4. Cooldown/budget: all comparisons are SQL `now()` (churn.ts); anchor is decided_at of applied proposals (hires excluded, intended). Concurrency: creation takes `lockProposals` (advisoryXactLock in locks.ts, per tenant); approval takes `lockOrg` and requires base_revision == current. Two proposals made on the same base cannot both apply (the second gets ORG_CHANGED), so they cannot both slip past cooldown or budget. Limit: cooldown and budget are not re-checked at approval, so lowering the budget while a proposal is pending does not stop it (minor, operator can reject). Settings come from env/config only; no route.
5. Baseline and cost: Statement = trim, min 20, max 1000 (zod) plus a DB length check; required on create, optional on dryRun. Bound into payload_sha only when any extra is present, so a pre-c64 row keeps the old formula and verifies (org-baseline.test.ts:70 test passes). Rollbacks supply fixed texts. The only insert path is createProposal, so an empty baseline cannot be approved through the API; the DB itself has no minimum (default ''), fine for old rows. Content is not judged (20 times "a" passes), acceptable.
6. No loosening: git diff of proposals.test.ts, org-history.test.ts, org-coverage.test.ts, c11-staffing-org.test.ts, contracts/coverage.test.ts, api-c11, api-c20, api-improve shows only additions of `...ST` / the two fields on POST bodies, plus additive trigger/config lines in the contracts coverage test (it sets app.cfg.orgGuardrails so every new field is filled). No assertion removed or weakened. api-improve 108 = 107 + the new "Submit is disabled until both statements are written" check. Validators: evidence/contracts/churn are `opt` in the dry-run validator because pre-c64 stored results lack them; baseline, expectedCost, triggers, linesChanged are required on the proposal DTO.
7. UI: plain words, ? help on trigger picker, evidence, contracts, churn, baseline, cost (6 help keys), says nothing claims more hierarchy helps, "No recorded trigger" and the pre-c64 "no baseline stated" notes are shown. api-c64 confirms the dialog and Proposals fit 1366x768 (dialog over 0). Worst cases (4 triggers, failing contracts with long reasons, several cards) were not checked; the one-line facts use ellipsis, probably fine.
8. Rollback still passes contracts (dryRun contract errors apply without gate) and counts toward the window; see S1 for the exemption problem.

### Pre-existing api-mode fit failure (item 7): confirmed on base 07831cd
Scratch worktree of 07831cd, `api-e2e.sh "DATA_MODE=api ONLY=agentProfile node scripts/fit-check.mjs 1366 768"` printed the same 10 BAD lines: `/agents/coder-01?tab=profile|capabilities|tools|instances|conversations|memory|performance|mentoring|evolution|audit`, each `mainOver 48`, fit-scroll region 300 px min height (profile 292 etc. shown as [300, N]).
Cause (measured on base): at 1366x768 `main` is 688 px tall with 736 px of content. Inside: the hero panel `.oa-hero` is 360 px (top 82 to 442), the tabbar panel 54 px (454 to 508), then `.fit-scroll` starts at 516 with a 300 px minimum height, ending at 816 versus a page bottom of 750. Overflow = 48 px. Fix for the backlog: shorten the hero by about 50 px at heights under 800 px, or lower the fit-scroll minimum (300 to about 250) on the agent profile. Not caused by c64. Backlog item, should be tied to the agent profile route in api mode (the demo-mode fit check is clean).

## Fixes needed before merge
1. S1: restrict the rollback exemption (or count rollbacks against the budget/cooldown beyond the first undo) and add the flip-flop test.
2. S2: fix the failure_concentration supported rule or change the text, with a test.
3. S3: per-trigger time labels and the reassign/demo statement.
Minor (can go to backlog): S4, S5, S6, S7, the 48 px agent-profile overflow, and the unrecorded names of the 8 parallel-run failures.
