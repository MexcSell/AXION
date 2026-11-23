# c88 report: member view of proposal evidence (T2) and column guard scope (M2d)

Lane w86, branch `c88-evidence-scope`, base 44db33b. Server, contracts and tests only. No `web/src` file, no migration.

## Item 1, T2: member view of evidence. PASS
- RED (commit "test(c88): RED"): `server/test/c88-evidence-redaction.test.ts`. A member's list showed `Agents with at least one open task` 2 for a proposal made before, and 3 for one made after, another member's private mission gained an open task (average 2 vs 1.7). The member's evidence was not identical across the two.
- GREEN: `redactEvidenceForMember` (`server/src/organization/evidence.ts`), applied in `dto()` in `proposals.ts` by `ctx.user.role`. This covers the list and every route that returns a proposal (create, decision and withdraw are admin-only and also go through it). No detail GET route exists; `history.ts`, the attention queue and `plan.ts` do not return `result.evidence`.
- What a member gets: for `load_imbalance`, `repeated_reassigns` and `failure_concentration`, `{ kind, scope, hidden: true, supported: null, facts: [], subjects: [] }`.
- Choice and reason: `supported` is a reading of the hidden counts (for example "busiest agent holds at least 3 and twice the average"), so it is hidden too. `coverage_gap` reads only the chart and the agent list, which every member can already read, so it is shown unchanged. Admins get the stored evidence unchanged; the stored row is not touched (asserted).
- Contract: `TriggerEvidence.supported: boolean | null` and `hidden?: boolean` (shared/contracts/src/agents.ts), validator updated (`nullable(bool)`, `opt(bool)`). No c50 allowlist line. Contract coverage tests pass.
- Test: member and admin over proposals made before and after the private task. Member evidence is deep-equal across both; admin's moves 2 -> 3; admin response equals the stored row; the member who owns the mission is redacted the same; list passes the validators for both roles.

### What the web shows a member now (not edited; the controller decides)
`EvidenceBlock` (`web/src/features/agents/OrgRestructure.tsx`) renders each trigger row with a `picked`/`not picked` chip, then a chip from `t.supported ? 'backed by the counts' : 'not backed by the counts'`, then `facts.map(label value).join(' · ')`, then the scope text. For a hidden trigger:
- the facts text is empty (no `null`, `undefined` or `NaN` anywhere; web tsc is clean);
- BUT the chip reads **"not backed by the counts"** (supported is null, which is falsy), and `data-supported="0"`. That is misleading: it says the data does not back the trigger, when the truth is "hidden from you". There is no "visible to administrators" text.
- A follow-up web change should render `t.hidden` as "visible to administrators" and skip the backed chip.

## Item 2, M2d: column guard scope. PASS
- `PLAN_UNIT_READS` (plan-metrics.ts, next to UNITS) declares the columns of each of the 20 units plus `changeBounds` and `countObservations`. `planUnitProblems` and a `unit:<id>` scope label in `enclosing` (test/contracts/columns.ts) put plan-metrics.ts in the c83 scan, with the test in `c83-registry-columns.test.ts`.
- Reported: an undeclared column, a declared column nothing reads, a declared table the unit does not name, SQL outside a unit, a unit with no SQL.
- RED: an injected `l.agent_id` read in the `lesson_proposed` unit gives exactly `unit:lesson_proposed reads lesson_candidates.agent_id, but PLAN_UNIT_READS does not declare it`. A new unit with no declaration, and a stale declaration, are also reported.
- `server/src/forecasts/` is an explicit exclusion (`SCAN_EXCLUSIONS` and the scan header): the forecast ledger is not a registry metric, and the test asserts no registry loader lives there.
- Limit: the table is declared against the unit, not each registry row; a metric that shares a unit (e.g. `review`) shares its columns.

## Item 3, sweep check. NOT APPLICABLE on this base
`server/test/tenant/vis*.ts` is not on this base, so c87 is not merged here. There is no FINDINGS entry to remove; the integrator removes the `/organization/proposals` entry at merge. `test/tenant` passes.

## Pass threshold
- Items 1-2 RED -> GREEN: PASS.
- test/tenant green: PASS (inside the full run).
- Full serial vitest (`--maxWorkers=1 --no-file-parallelism`, load average 4 at start, 10 at end, 657 s): 169 files passed, 1 skipped; 3551 tests passed, 36 skipped; no failure.
- tsc clean in server and web: PASS.
- Diff stat: no `web/src` file, no migration: PASS.

## Files
shared/contracts/src/agents.ts; server/src/organization/evidence.ts, proposals.ts, plan-metrics.ts; server/test/c88-evidence-redaction.test.ts, c83-registry-columns.test.ts, contracts/columns.ts, contracts/validators.ts; this report.

## Concerns
- Web chip wording (above).
- Evidence is frozen at creation, so the "before/after" test compares two proposals created before and after the private task.
