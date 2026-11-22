# c58 report: Rule-of-Two configuration profile and approval-quality records (lane w57, branch c58-rule-of-two, from 5b3e32b)

Sources: the Rule of Two is **a heuristic from a vendor blog (C1), written as a stopgap until prompt injection can be detected**. It is not proof of safety. C9 is not cited. The widely quoted approval rates are not used. The approval-quality evidence is a survey and a blog caveat (C2, C1).

## What was built
1. **Derived flags** (`server/src/policy/rule-of-two.ts`). `deriveFlags(profile)` is pure; `loadConfigProfile()` builds the profile from trusted tables (delegation briefs, live site grants, mission uploads) in SQL with DB `now()`. The profile has no text field, so a brief's goal, a payload or a title cannot move a flag.
2. **Policy rule** (`evaluate(action, grants, tenant, now, flags?)`). All three flags exactly `true` gives `tier = max(tier, EFFECT_FLOOR.external)` (R2, read from the existing c30 table, not a new literal), reason `rule_of_two`, outcome needs_approval (a deny stays a deny). The grant check still uses the tier from before the rule, so the rule never removes a grant requirement. A tenant policy `ruleOfTwo: 'deny'` makes it a refusal (only that exact value; anything else changes nothing). `decideOnOrigin` (agent requesters) and `requestApproval` derive and pass the flags.
3. **Record the reason.** Migration 0043 `approval_requests.rule_of_two` (jsonb: flags, sources per flag, fired, rule, policyVersion), immutable through the replaced `approval_requests_guard`. DTO `ruleOfTwo`. The approval dialog (DL-48) shows "Why approval was asked" with three plain-words chips (tick or dash), the sources on hover and a `?` (`approval.ruleOfTwo`, which says "heuristic" and "stopgap").
4. **Approval-quality records.** `approval_decisions.latency_ms`, `queue_size`, `fast_bulk` (append-only table, columns cannot be edited). Latency is computed in SQL from the request row with DB `now()`; the queue is counted in the same transaction before the write; a body field cannot supply either. Fast-bulk is advisory: this is the 3rd or later decision at R2+ (tiers taken from the existing table) by one approver within 60 s. `GET /approvals/quality` (everyone, aggregates, no names) and `GET /approvals/quality/approvers` (admin only, 403 FORBIDDEN otherwise). Below 5 recorded decisions every cell is null and the UI says "not enough evidence (n = k)". Admin-only `decisionRecord` on decided requests. UI: DL-100 "Approval quality" (button on Notifications, Pending tab, with `?`), a decision-record line on the Resolved tab for administrators.
5. **Contracts.** `RuleOfTwoDto`, `DecisionRecordDto`, `ApprovalQualityDto`, `ApproverQualityDto/Body` in `shared/contracts`; validators; registry entries for both routes (the approvers one `admin: true`); the coverage run calls both. No allowlist lines. (Items 3 and 4 each carry the contract entries for their own fields; item 5 is not a separate commit.)

## The flag-derivation mapping (also in `FLAG_SOURCES` and the `approval.ruleOfTwo` help)
| Flag | Set by |
|---|---|
| (a) reads untrusted input | a capability or the action with an origin; any live site grant on the mission for the agent; uploaded files on the mission |
| (b) reaches sensitive data or systems | a capability or action kind whose baseline effect is `infra` or `critical`; a kind the baseline does not know (fails closed) |
| (c) can change state or communicate externally | a capability or action kind whose baseline effect is `external`, `infra` or `critical`; an unknown kind (fails closed) |

Effects come from the c30 baseline. Capabilities are the union over the agent's live instances of each newest brief intersected with its ancestors (c42 `effectiveFrom`). Judgement calls the owner may want to change: uploads count as untrusted; site grants contribute only to (a); `send_message` and `change_external_setting` are (c) but not (b).

## RED / GREEN
| Item | RED (before the code) | GREEN |
|---|---|---|
| 1 `c58-flags.test.ts` (63 cases) + `c58-profile.test.ts` (5) | `Error: Cannot find module '../src/policy/rule-of-two.ts'` (suite failed to load) | 63/63 and 5/5 |
| 2 `c58-rule.test.ts` (53 cases: 8 combinations x 5 tiers, grant not loosened, deny kept, tenant deny, requester-text tests) | 10 failed, 43 passed. First: `rule_of_two is a declared reason code`: `expected [...] to include 'rule_of_two'`; the five all-true cases (read, fill_draft, submit_form, release, production_deploy) `expected 0 to be greater than or equal to 2`; tenant deny, non-"deny" tenant value, padded flags | 53/53; `policy.test.ts` 142 pass (its reason-code completeness test was extended with the two new codes, a coverage addition) |
| 3 `c58-record.test.ts` (6) | 6 failed (all): stored record missing (`expected undefined to match object { fired: false, rule: null, ... }`), `column "rule_of_two" does not exist` | 6/6 |
| 4 `c58-quality.test.ts` (15) | 15 failed (all): `column "latency_ms" of relation "approval_decisions" does not exist`, `expected NaN to be greater than or equal to 299000`, `expected undefined to be true`. One test then changed: it expected 400 for a body carrying `latencyMs`; the schema strips unknown fields and answers 200, so the test now asserts the stored values are DB-computed and not the client's | 15/15 |

## Threshold
| Item | Result | Evidence |
|---|---|---|
| Items 1-5 RED then GREEN | PASS | table above; one commit per item (items 4 and 5 share a commit, items 3 and 5 contracts are in their item commits) |
| Table-driven over all 8 combinations, only all-true escalates; at least 30 unit cases; requester text claiming "no untrusted input" leaves the result unchanged | PASS | 40 combination cases, 53 rule cases, 63 flag cases (about 120 unit cases) plus the DB-backed tests where payload and brief text carry the claim |
| Tier from the c30 table, not a second source | PASS | `EFFECT_FLOOR.external`; a test asserts it equals the table's R2; `BULK_TIERS` is also read from `TIERS` |
| tsc | PASS | server and web clean |
| Full vitest | PASS with a note | run 1: 8 failures in files that all passed alone; run 2: 2248 passed, 8 failed in `c39-ledgers.test.ts` (reran alone 27/27). Both runs logged `too many connections for role "axion"` (role cap 45, other lanes use about 29). Run 1 failures: `c58-record > the approval.requested event names the rule among its reasons`, `c58-record > decideOnOrigin: ...` (admin connect INTERNAL), `playbooks > 10 concurrent accepts: exactly one wins...`, `playbooks > 10 concurrent accepts that retry on 409...`, `playbooks > the skill lock key folds case...`, `staffing > moves reading -> appointing -> ...`, and the `playbooks` and `task-reviews` suites failing to start. Rerun alone: `c58-record`, `playbooks`, `task-reviews`, `staffing` 109/109. Load average 8 to 18 |
| api-c48, api-c42, stage6, policy checks (no api-c30 exists: used api-c36 grants, api-flows, api-stage6, which are what c30 cited) | PASS | 31/31, 16/16, 94/94, 35/35, 23/23, 0 FAIL |
| New api-c58: dialog, admin-only view, member cannot see per-approver numbers | PASS | 34/34. Member `GET /approvals/quality/approvers` is 403; the member's browser never requested that route; the member aggregate contains no name or id; member `decisionRecord` is null; admin table lists the approver; decisions made quickly were flagged (6 of 8) and every one came out as chosen |
| No flag changes any decision | PASS | `c58-quality` (flagged decision stays approved, a flagged denial stays denied, the flagged approval can still be consumed) and api-c58 (8/8 as chosen, 6 flagged) |
| verify-all 10/10 | PASS | `ALL 10 STEPS PASSED` (own OUT `/tmp/axion-verify-w57`, dev server 10790; dialog smoke and ledger include DL-100) |
| fit-check | PASS | `ALL FIT` demo, dark, 1366x768. Light mode: no fit-check run (the script hardcodes dark); api-c58 checks the dialogs and the Resolved tab fit at 1366x768 in dark and light |
| a11y, both modes | PASS | demo 51 views, 66 dialogs, 0 violations; api 41 views, 66 dialogs, 0 violations |
| api-mobile no new FAIL | PASS | `NO FAILURES`; the run does not reach the Pending tab, so api-c58 checks DL-100 at 390x844 instead (fits, no sideways scroll) |
| No allowlist lines, contracts for every field and route | PASS | registry, validators, coverage calls only |
| Servers stopped | PASS | 10790, 10792, 10793 no longer listening |

## Screenshots
`web/docs/improve/cycles/shots-c58/`: `dialog-flags-fired-dark.png`, `dialog-flags-help-dark.png`, `dialog-flags-notfired-dark.png`, `quality-empty-admin-dark.png`, `quality-admin-dark.png`, `quality-admin-light.png`, `quality-member-dark.png`, `quality-member-phone-dark.png`, `resolved-record-light.png`. The fired and not-fired dialog states use a rewritten `/approvals` response in the browser (no HTTP route creates a request with a chosen configuration); the server-side derivation is tested in vitest.

## Files changed
server: `src/policy/rule-of-two.ts` (new), `src/policy/evaluate.ts`, `types.ts`, `index.ts`, `src/approvals/service.ts`, `routes.ts`, `quality.ts` (new), `src/grants/service.ts`, `src/cli/e2e-extra-approvals.ts` (harness, e2e DB only), `migrations/0043_rule_of_two.{up,down}.sql`; tests `c58-flags`, `c58-profile`, `c58-rule`, `c58-record`, `c58-quality`, `policy.test.ts` (two cases added), `contracts/{registry,validators,coverage}`.
shared: `contracts/src/api.ts`. web: `ApprovalBinding.tsx` (RuleOfTwoNote), `features/approvals/quality.ts`, `dialogs/defs/approval-quality.tsx` (DL-100), `users-governance.tsx`, `pages/Notifications.tsx`, `api/approvalQuality.ts`, `data/approvalQualityDemo.ts`, `data/missions.ts`, `data/types.ts`, `help/pages/users-governance-notifications.ts`, `theme/pages/c58-approval-quality.css`, `users-governance-notifications.css`, `scripts/api-c58.mjs`, `docs/dialog-ledger.txt` (generated by the dialog smoke).

## Concerns
1. **The tier escalation is not yet visible in the approval-request path.** `requestApproval` evaluates with no grants, so an R0/R1 kind is already denied there; every request it stores is R2 or above, and the rule cannot raise one. The escalation is real in `evaluate` and in `decideOnOrigin`, which still has no route caller (only tests). Flags and the fired rule are recorded either way.
2. The fast-bulk thresholds (3 decisions, 60 s) and the mapping choices above are mine, not from a source; they are named constants. Decisions made before migration 0043 have null latency and are excluded from the statistics.
3. Requests created in demo mode use invented fixtures for the flags and quality numbers (labelled DEMO).
4. Machine load: `too many connections for role "axion"` caused intermittent unrelated vitest failures; see the threshold row.
5. Item 5 is not a separate commit.
