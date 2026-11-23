# c83 brief: metric guard follow-ups (M2b)

**Lane:** w81 (`/home/luca/AXION-w81`, branch `c83-metric-guard-2`), from improve-30h at the commit that adds this brief (batches through 37 merged). Ports 13190–13193. E2E DB **axion_e2e15** (reused; edit the lane `server/.env` after `new-lane.sh`). **Server and shared/contracts only: no file under `web/` may change. No migration.** If an item truly needs one, stop and report instead.
**Sources:**
- BACKLOG row M2b;
- `cycles/c66-brief.md`, `c66-report.md` and `c66-review.md`;
- `phase2/research-r3.md` §R3-4 and its verified file;
- the registry in `shared/contracts/src/metric-guard.ts`;
- the c66 tests.

**HARD RULE:** never connect to, query or read the live `axion` database in any form. Use only `axion_e2e15` and the test DB the harness gives you.

## Items (each RED first, then GREEN, each its own commit)
1. **Open-check.** Confirm that each of items 2–4 is still open on your base, with evidence.
2. **`sample_ref` must not outlive the demo.** `metric_audit_labels.sample_ref` is free text. It can name demo data and survive the demo purge.
   - Without a migration, make every write path accept only a typed reference (a closed set of kinds plus an id, validated by the contract) and refuse free text.
   - Then make the demo purge path in application code (not the `axion.purge_demo` SQL function) leave no label that points at purged demo data. If the only clean fix is in `axion.purge_demo` (a migration), stop and report that with a proposed migration text. Don't write it.
   - Test: seed demo, label it, purge, then show no label still references a purged row.
3. **Registry loader coverage.** The registry loader test is table-level and covers 3 loader files. Extend it to the column level and to **every** company loader: every file under `server/src/company/`, plus every loader a registry entry names. Each column a metric reads must be declared in its registry entry, and each declared column must really be read.
   - Generate the list from the source, as c66's scans do, so a new loader can't go uncovered.
   - Show RED on an injected undeclared column read.
4. **Weaker counter-metrics.** Find every registry row whose counter-metric shares an input column with its primary (computed from item 3's column data, not hand-listed), and every counter-metric the c66 review called weak, `context_loss` first.
   - For each, either give a counter-metric with independent inputs from data the app really records, or mark it `counter: weak` with a stated reason, and have the scorecard show that state.
   - A UI change is out of scope here. Expose the state in the existing DTO field if one exists; otherwise only in the registry and the report.
   - Add a guard test: a new registry row with a shared-input counter-metric fails unless it is marked weak with a reason.

## Standing rules
- PHASE2.md "Standing rules for every Wave 5+ brief" apply.
- No c50 allowlist lines and no c79 exceptions.
- c78's RATING_FIELDS and value-order scans must still pass.

## Pass threshold
- Items 2–4 RED → GREEN.
- Full serial vitest with no failure, or every failure named and shown unrelated.
- tsc clean.
- Diff stat: no `web/` file and no migration.

## Report
`cycles/c83-report.md`. Follow the LANES.md Finishing rule. **Deadline:** hand back by about 12:30Z. If you are short of time, hand back what is committed and mark the rest NOT MET.
