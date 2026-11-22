# c65 brief: review-capacity view (R3-10)

**Lane:** w63 (`/home/luca/AXION-w63`, branch `c65-review-capacity`). **Branched from `c58-rule-of-two` at 7f31c94.** c58 is cleared and queued as batch 17, and you build on its stored decision latency and queue size. Ports 11390–11393. E2E DB **axion_e2e10** (reused). Migration **0049** only if needed.

**Docs.** Read these **read-only** from `/home/luca/AXION/web/docs/improve/`:
- this brief;
- `PHASE2.md`: the Wave 5 standing rules and Wave 7;
- `phase2/research-r3.md` §R3-10;
- `phase2/research-r3-verified.md`: its required changes.

Read LANES.md and the c58 and c48 cycle files from your worktree.

**Evidence honesty.**
- No source gives a safe span of control, so claim none.
- Cite B7 only as a precedent for tail-based sizing, or not at all.
- State that the utilisation-to-wait relationship and Little's law are standard queueing mathematics, not taken from the papers.

## Items (each test-first, each its own commit)
1. **Read model.** For items that need a human (approvals, task reviews and delegations awaiting a decision, as they exist), compute per department and in total, over a window:
   - arrival rate;
   - time to decision, as median and 95th percentile;
   - open backlog.

   **Reuse c58's stored decision latency and queue size; don't recompute them.** Compute all durations from DB `now()` and timestamps in SQL.

   Percentiles are null below 20 items, and every cell shows n.

   **Approval → department mapping:** define one documented rule, for example the department of the agent that raised it, or of the mission's owning department, and test it.
2. **Little's-law check.** As a data-quality test, open items should approximately equal arrival rate × mean time in system over the window. Finite windows have boundary effects, so state the tolerance in code and in the report. The check must fail loudly on a fixture with a missing close event.
3. **Utilisation.** This needs an operator-set "review hours per week" value per operator, which is a new **operator setting**: neither a route nor a model call. Either define it with a sensible "not set → utilisation null" default, or drop utilisation from v1 and say so.
4. **Observed span.** Show agents per supervisor and open items per supervisor **as a measure only, with no recommended number**.
5. **Privacy.** Per-person rows are **admins only**. Everyone else sees aggregates with c58's floor: at least 5 items and at least 3 distinct people, with fixed windows of 7, 30 and 90 days. Add a contract test that no per-person route exists for non-admins.
6. **UI.** Add a compact panel in System Operations: plain words, a `?` on every number, and it must fit one screen at 1366×768. It must not be usable to rank people, so there is no sort-by-person for non-admins.
7. **Contracts.** Add registry, DTO and validator entries for every new field and route. No allowlist lines.

## Pass threshold
- Items 1–7 RED → GREEN.
- A seeded arrival simulation matches a reference calculation within the stated tolerance.
- Full vitest (serial fallback; name every failure) and tsc pass.
- api-c58, api-c48 and api-stage6 pass, plus a new api-c65 that includes the member privacy checks.
- verify-all 10/10. fit-check and a11y clean in both modes.

## Report
`cycles/c65-report.md`. Follow the LANES.md Finishing rule.
