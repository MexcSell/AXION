# c30 brief: deterministic policy service (Phase 2 · Wave 1 · P1)

**Lane:** w28 (ports 7890 dev / 7891 preview / 7892–7893 e2e, DB axion_e2e28). No migration expected; if one is unavoidable, use 0025.
**Sources:** spec §13.2 (risk tiers R0–R4), invariants 7 and 10; Cedar 2403.04651 (deny-overrides, analysable policy); CaMeL 2503.18813 (capability policy outside the model). Verified in phase2/research-eval-safety-verified.md.

## Hypothesis
Today the approval's risk tier is supplied by the caller (`ApprovalInput.risk` in server/src/approvals/service.ts). If one pure, deterministic `evaluate()` decides allow / needs-approval(tier) / deny from the action, the grants and the policy (all in code), then no caller and no agent can pick its own tier. That closes the gap the spec's invariant 10 describes ("global policy ... outside agent-editable storage").

## Build (test-first)
1. `server/src/policy/` (new module, pure: no I/O, no clock reads; pass `now` in):
   - `types.ts`: `Action { kind; target?; origin?; missionId?; requester: {id, kind:'user'|'agent', role} ; effect: 'read'|'prepare'|'external'|'infra'|'critical' ; payload }`, `Grant`, `Decision = {outcome:'allow'|'needs_approval'|'deny', tier: 'R0'..'R4', reasons: ReasonCode[], policyVersion}`.
   - `baseline.ts`: the frozen baseline policy (versioned like `EVALUATION_POLICIES`) that maps action kinds → tier per §13.2, and a **prohibited** list of R4 actions that are always denied (e.g. autonomous gate change, security-policy rewrite by an agent).
   - `evaluate.ts`: `evaluate(action, grants, tenantPolicy, now)`. Rules: deny overrides everything; unknown action kind → deny (`unknown_action`); a tenant/owner policy may only **tighten** (raise a tier, add a deny); a looser override is ignored and reported as reason `override_loosening_ignored`; R0 needs a covering grant, else deny `no_grant`; R1 allowed for agents within scope, audited; R2 → needs_approval(user); R3 → needs_approval(admin|owner); R4 → needs_approval(owner) or deny if prohibited; an agent requester can never reach `allow` above R1.
2. Wire approvals: `createApproval` derives `risk` from `evaluate()` for the request's kind; the caller-supplied `risk` is removed from `ApprovalInput` (or rejected when it differs). Add a route-level test that a request asking for a lower tier than policy gets the policy tier.
3. Expose read-only `GET /policy/baseline` (admin/owner) listing kinds → tier → reasons, for the UI `?` help later. No write route (invariant 10).

## Pass threshold (fixed)
- ≥ 40 unit tests on `evaluate()`, covering every tier R0–R4, every reason code, deny-overrides, tighten-only, unknown kind, expired grant, agent ceiling at R1, and prohibited R4.
- A property-style test: for 500 seeded random (action, grants, override) triples, `evaluate` is deterministic (same input → same output) and never returns a tier lower than the baseline's.
- `grep` shows no remaining caller-supplied tier on any approval path (record the command and output).
- server tsc clean; full server vitest green; api-flows.mjs and api-stage6.mjs still pass (approvals UI unchanged).

## Out of scope
Browser actions (P2), approval digest v2 (P3), site-grant tables (P4). Use an in-memory `Grant` type now; P4 will back it with a table.

## Report
`web/docs/improve/cycles/c30-report.md`: RED/GREEN evidence, each threshold item PASS/FAIL/NOT MET with numbers, files changed, concerns.
