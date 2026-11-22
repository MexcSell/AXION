# c58 brief: Rule-of-Two configuration profile and approval-quality records (R2-6, R2-9)

**Lane:** w57 (`/home/luca/AXION-w57`, branch `c58-rule-of-two`), from improve-30h at the commit that adds this brief. Ports 10790–10793. E2E DB **axion_e2e16** (reused). Migration **0043** if needed. Dialog id **DL-100** if you need a new dialog.
**Sources (verified):** `phase2/research-r2.md` §R2-6 and §R2-9, and the required changes in `phase2/research-r2-verified.md`. Read both. Cite only CONFIRMED or CORRECTED sources, and label the Rule of Two as **a heuristic from a vendor blog** (C1), written as a stopgap until prompt injection can be detected. Do not cite C9 for any category.
**Read the code first:** `server/src/policy/` (P1, c30 tier table), the delegation brief schema (c42), `server/src/grants/` (c36), `server/src/approvals/` and the approvals UI (c48).

## Items (each test-first, each its own commit)
1. **Derived flags.** Derive three flags on the server from what a configuration actually holds: (a) reads untrusted input, (b) reaches sensitive data or systems, (c) can change state or communicate externally. Derive them from capabilities, site grants, content origins and P1 action kinds. **They are never read from the brief or from requester text.** Write down the mapping (which capability or grant sets which flag) in code and in the report.
2. **Policy rule.** The P1 policy service returns at least "needs approval at tier ≥ R2", or "deny" where policy says so, when all three flags hold. Take the tier from the existing c30 tier table: it must not become a second source of tiers. A requester can't lower the result.
   - Table-driven tests over all 8 flag combinations; only the all-true case escalates.
   - At least 30 unit cases.
   - A test where the requester's text claims "no untrusted input" and the result is unchanged.
3. **Record the reason.** Store the three flags, and the rule that fired, with each approval request, so a reviewer can see why approval was asked. Show them in the approval dialog as plain words, with a `?`.
4. **Approval-quality records (R2-9).**
   - At decision time, record the decision latency, using DB `now()` against the request row (no new clock source), and the size of the pending queue.
   - Admins only: show per-approver approval rate and median latency, with n and window. Below 5 decisions, show "not enough evidence".
   - Everyone else sees aggregates only.
   - Flag, but never block, fast bulk approvals at R2 and above.
   - **No flag changes any decision**, with tests for that.
   - This is one approvals UI change together with item 3. P3b (second approver) is not in scope.
5. **Contracts.** Add registry, DTO and validator entries for every new field and route. No allowlist lines.

## Pass threshold
- Items 1–5 RED → GREEN. Full vitest and tsc.
- api-c48, api-c30 (or the policy checks), api-c42 and stage6 pass. Add a new api-c58 for the dialog and the admin-only view; prove a member can't see per-approver numbers.
- verify-all 10/10. fit-check and a11y clean in both modes. api-mobile has no new FAIL line.

## Report
`cycles/c58-report.md`, with screenshots of the approval dialog and the admin view.
