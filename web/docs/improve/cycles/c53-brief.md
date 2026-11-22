# c53 brief: eval-run integrity (E1c)

**Lane:** w52 (`/home/luca/AXION-w52`, branch `c53-eval-integrity`), from improve-30h at the commit that adds this brief. Ports 10290 (dev), 10291 (preview), 10292–10293 (e2e). E2E DB **axion_e2e18** (reused). Migration **0040** if needed.
**Source:** BACKLOG E1c, from the c47 re-review. Read `cycles/c47-brief.md`, `c47-report.md`, `c47-review*.md` first. Code: `server/src/evolution/` (verdict-v2.ts, proposal-evidence.ts, stats.ts) and the version-proposal routes.
**Boundary:** validation and records only. **No eval-run write route, no execution, no model calls.** Where an item needs a writer, put the check in the service/SQL layer that any future writer must call, and test it directly.

## Items (each test-first, each its own commit)
1. **No re-run shopping across proposals.** Count candidate runs per (tenant, agent, candidate config sha, holdout dataset) across **all** proposals, so withdrawing and re-proposing the same config can't buy a fresh holdout run. Apply the same count to base runs. Enforced in SQL (constraint or trigger), so it holds for any future writer; refusal is a named code.
2. **Resumable runs.** A crashed or unfinished run can be resumed or finished, instead of the next attempt failing with `holdout_rerun`. Define the run states explicitly; a finished run stays immutable (append-only guards).
3. **Judge labels.** Validate judge model-family labels against the c38 vendor alias table on write. Unknown or ambiguous → refuse, never default.
4. **Number rendering.** Accept 16–17-digit floats only if JS and SQL render them identically (prove it with a property-style test over edge values), or store scores as fixed-point. Whichever you pick, the c47 evaluation hash must stay stable and fail closed on ambiguity.
5. **`dev_holdout_reuse` false positives** on generic shared inputs: match on case id plus input, or require a minimum overlap. Keep every true positive in c47's tests.

## Pass threshold
- Items 1–5 RED → GREEN. c47's tests all pass unchanged (or a test is tightened, never loosened, and the report says why).
- Full vitest and tsc; api-c47, api-c05 and api-stage6 pass. Contract registry entries for any new field.

## Report
`cycles/c53-report.md`.
