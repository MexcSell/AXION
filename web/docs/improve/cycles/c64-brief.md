# c64 brief: restructure guardrails for org change proposals (R3-6)

**Lane:** w62 (`/home/luca/AXION-w62`, branch `c64-restructure-guardrails`), from improve-30h at the commit that adds this brief. Ports 11290–11293. E2E DB **axion_e2e11** (reused). Migration **0048**.
**Docs:** `phase2/research-r3.md` §R3-6 and `phase2/research-r3-verified.md` (its required changes).
- Cite **A6 only**, as support for "gate a restructure on contracts", and say it has no numbers.
- **Never cite A8**: it has a date flag and is low trust.
- The literature gives no rule for when to restructure (see the Gaps section), so the design is: stated evidence, preserved contracts, limited churn, and **no belief that more hierarchy helps**.
**Read first:** `cycles/c01-*` (A1 org change proposals), `c04-*` (history and rollback) and `c07-*` (coverage, A5), plus `server/src/organization/`.

## Items (each test-first, each its own commit)
1. **Evidence block, computed by the server and never typed.**
   - A proposal carries the trigger or triggers that motivated it, each with counts taken from recorded data: load imbalance (instances or tasks per agent), a coverage gap (from A5), repeated reassigns of the affected roles, and failures concentrated in one role (failure tags).
   - The proposer picks which triggers apply; the counts are computed. The UI shows "no recorded trigger" honestly when none applies.
2. **New contract checks only.** Orphan duty and manager-without-reports already exist (A1/A5); don't count them as new.
   - **Add:** every team keeps a possible reviewer other than the producer (at least 2 members able to review, consistent with c38/O3).
   - **Define or drop**, and say which in the report:
     - "Escalation path exists" means every agent's reporting chain reaches a top-level manager within N levels, with no dangling chains. Keep it only if the org model supports it.
     - "Role output contract unchanged" needs a field that doesn't exist: **drop it** and record why.
   - Build a corpus of at least 30 hand-made bad proposals that break the **new** rules only. The dry run must reject 100% of them and accept 100% of a good corpus.
3. **Churn budget and cooldown.** After an approved org revision, a further proposal inside the cooldown is refused, and so is one changing more than the churn budget (reporting lines changed per window). Both are operator settings, never routes. All time comparisons use DB `now()` in SQL. Named refusal codes, with tests.
4. **Baseline and cost statement.** A proposal must state its expected added cost (coordination, extra hops) and a baseline ("no change" or a simple rule-based assignment) before it can be submitted. These are text fields with a minimum length, shown in the approval view.
5. **UI.** The proposal view shows the evidence block, the contract checks (pass or fail, with reasons), the churn status and the baseline. Plain words, `?` help, and it fits one screen at 1366×768.
6. **Contracts.** Registry, DTO and validator entries for every new field and route. No allowlist lines.

## Pass threshold
- Items 1–6 RED → GREEN. Every A1–A5 org test passes unchanged, or is tightened with a reason.
- Full vitest (serial fallback; name every failure) and tsc. The org api checks (api-c01/c04/c07 or the current equivalents), stage6 and improve pass.
- verify-all 10/10, and fit-check and a11y clean in both modes.

## Report
`cycles/c64-report.md`. Follow the LANES.md Finishing rule.
