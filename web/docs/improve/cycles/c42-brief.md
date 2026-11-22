# c42 brief: typed delegation brief and scope contract (Phase 2 · Wave 3 · O2)

**Lane:** w41, branched from **c30-policy-service** (f483e2d), because it uses `evaluate()`. Ports 9190 / 9191 / 9192–9193. E2E DB **axion_e2e14**. Migration **0034**.
**Sources:**
- Intelligent AI Delegation, 2602.11865: a conceptual framework, with no experiments (say so in the help text);
- Magentic-One 2411.04468: the orchestrator gives explicit instructions;
- MAST 2503.13657: the specification and misalignment failure categories;
- spec invariant 4: no cross-mission access without an authorized bridge.

## Hypothesis
Today a delegation (task.delegated) carries free text. Many multi-agent failures start from an under-specified hand-off: MAST's specification and inter-agent misalignment categories. A typed brief (goal, inputs, acceptance criteria, allowed capabilities, budget and deadline), plus the rule that **a delegate's scope must be a subset of the delegator's**, makes hand-offs checkable and stops privilege growing along a delegation chain.

## Build (test-first)
1. Shared zod schema `DelegationBrief` (strict, bounded):
   - goal;
   - inputs[] (refs);
   - acceptance[] (testable criteria, at least 1);
   - capabilities[]: policy kinds from the c30 baseline, plus origins;
   - budget? (units);
   - deadline?;
   - escalation (when to ask a human).
2. Migration 0034:
   - `delegation_briefs`: id, tenant, mission, task, from (agent or user), to agent, brief jsonb, sha256, parent_brief_id (the chain), created_at;
   - append-only, with all guards.
3. Service rules:
   - The capabilities must be a **subset** of the delegator's effective capabilities: for an agent, those of its own brief, or of the mission's root grant set. For the root (a human), they are evaluated through `evaluate()` for each kind, and the brief may not include a kind the human couldn't approve.
   - The chain depth is capped by a frozen policy.
   - A brief with no acceptance criteria → 400.
   - A capability outside the parent's → 403, with a reason naming the offending items.
   - A child deadline after its parent's → 400.
   - The sha256 is over canonical JSON. Briefs are immutable, so a change means a new brief that supersedes the old one.
4. Wire-in: wherever the server records a delegation (grep `task.delegated` and the delegation tables), require or attach a brief for **new** delegations. Old delegations render as "no brief (legacy)". Keep the DEMO simulator working: give it simple valid briefs.
5. UI: in a delegation's view (task drawer or Conversations delegation card), show the brief: goal, acceptance checklist, capability chips with tier colours, deadline, and the chain breadcrumb. `?` help explains the subset rule and cites the paper as conceptual.

## Pass threshold (fixed)
- Tests:
  - the subset rule holds at depth 1, 2 and 3;
  - a superset → 403 naming the items;
  - depth over the cap → 400;
  - no acceptance → 400;
  - a child deadline after the parent's → 400;
  - sha256 is stable under key order;
  - append-only;
  - visibility.
- A property test with 300 random chains: no delegate ever holds a capability its ancestor lacked.
- The DEMO simulator's delegations still run (api-stage6 94/94, api-flows); the browser check `web/scripts/api-c42.mjs` shows the brief on a delegation.
- server tsc and vitest green; web tsc; a11y; fit-check ALL FIT.

## Report
`cycles/c42-report.md`.
