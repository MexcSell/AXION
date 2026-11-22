# c30 report: deterministic policy service (lane w28, branch c30-policy-service)

## What was built
- `server/src/policy/` (new, pure, no I/O, `now` passed in): `types.ts`, `baseline.ts` (frozen `BASELINE_POLICY_V1`, registry `BASELINE_POLICIES`, 26 kinds across R0-R4, two prohibited), `evaluate.ts`, `routes.ts`, `index.ts`.
- `evaluate(action, grants, tenantPolicy, now)`: deny overrides; unknown kind denied (R4); tenant policy tightens only (looser override ignored with `override_loosening_ignored`); the caller's `effect` label can only raise a tier; R0 needs a covering grant; R1 for an agent needs one too (`out_of_scope`); R2 needs approval(user), R3 (admin), R4 (owner); prohibited R4 always denied (`autonomous_gate_change` for everyone, `security_policy_rewrite` for agents); allow is only possible at R0/R1.
- `requestApproval` (the approval producer; there is no `createApproval` in the code base) derives the tier from `evaluate()`. `risk` is gone from `ApprovalInput`; a stray runtime `risk` is never read. A deny throws `POLICY_DENIED` (403) and stores nothing. The requested event now records `policyVersion` and `reasons`. `TIER_OF` removed.
- `GET /policy/baseline` (admin only, read-only; no write route). New error code `POLICY_DENIED` appended to `shared/contracts/src/errors.ts`.
- No migration.

## RED / GREEN
- RED (src/policy moved away, new tests run): `test/policy.test.ts` failed at import (file-level, 0 tests ran); `test/policy-approvals.test.ts` 7 failed | 1 passed (8).
- GREEN: `test/policy.test.ts` 77 passed; full server vitest 39 files, 668 passed (668); server `tsc --noEmit` clean; web `tsc --noEmit` clean.

## Threshold
| Item | Result |
|---|---|
| >= 40 unit tests on evaluate(), all tiers, every reason code, deny-overrides, tighten-only, unknown kind, expired grant, agent ceiling, prohibited R4 | PASS: 77 tests in policy.test.ts (plus 8 in policy-approvals.test.ts); a test asserts the set of produced reason codes equals all 14 `REASON_CODES` |
| Property test, 500 seeded triples: deterministic, never below baseline tier | PASS: 500 iterations (seed 20261122), 400+ known kinds; also checks allow never above R1 |
| grep: no caller-supplied tier on any approval path | PASS (below) |
| server tsc clean, full vitest green | PASS (668/668) |
| api-flows.mjs and api-stage6.mjs pass | PASS: 23/23 and 94/94, 0 FAIL |

Grep: `grep -rnE "risk\s*:\s*'R[0-4]'|TIER_OF|risk: *(a|input|req|body)\.risk|a\.risk\b" server/src shared/contracts/src` produced no output (exit 1). The only remaining `risk` in `server/src` outside policy/ is the local `const risk = d.tier` in `approvals/service.ts` and the DB column read in `approvalDto`.

## E2E
api-flows.mjs 23/23 passed; api-stage6.mjs 94/94 passed; grep for FAIL: 0 lines (PASS). Ran against axion_e2e2 (axion_e2e28 could not be created; the controller redirected this lane).

## Files changed
New: `server/src/policy/{types,baseline,evaluate,routes,index}.ts`, `server/test/policy.test.ts`, `server/test/policy-approvals.test.ts`, this report.
Edited: `server/src/approvals/service.ts`, `server/src/seed/demo.ts`, `server/src/app.ts` (register route), `shared/contracts/src/errors.ts` (+`POLICY_DENIED`), and three existing tests (`approvals.test.ts`, `c09-minors.test.ts`, `review-fixes.test.ts`) where only the removed `risk: 'R#'` argument was deleted; no assertion changed.

## Concerns
- Demo seed: the second demo approval per mission was kind `release` with risk medium (R2); the policy now gives every `release` R3, so it shows "high". Fixture kinds map: release R3, origin-grant R3, browser-action R2. Approvals UI shape is unchanged.
- The app has roles admin/member only; "owner" (R4) is today held by an admin. The `approver` field says 'owner'; enforcing a distinct owner at decision time is not done (out of scope).
- `requestApproval` evaluates with no grants and an agent requester; fine for R2+ kinds. An R0/R1 kind passed to it would be denied (`no_grant`/`out_of_scope`), which is intended (those never need approval).
- The effect floor is an addition beyond the brief (stops a mislabelled effect from lowering a tier).
- Grants are in-memory types only; P4 backs them with a table.
