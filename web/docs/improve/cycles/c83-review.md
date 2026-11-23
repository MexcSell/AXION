# c83 review (M2b), branch c83-metric-guard-2 5891ad7..de3f5ff

Independent reviewer, 2026-11-23. **CLEAR**: 0 blockers, 1 major, 5 minors. tsc is clean, and 9 files with 58 tests pass (c83 ×3, plus c66 including audits). The reviewer's file in the scratchpad was a stub; this is the controller's copy of the hand-back text.

## Verified
- **Item 2:**
  - `metric-audit-store.ts` is the only SQL inserter or deleter (grep of src, tests, scripts and migrations; a test scans src).
  - The existence check is tenant-scoped (`tenant_id=$1`), and a missing id and another tenant's id give the same 422 text, so there is no existence oracle.
  - The purge runs inside clearDemo's transaction after purge_demo is set, before the missions delete, for all 5 kinds.
  - The c50 DTO, validator and registry are unchanged, with no allowlist lines.
- **Item 4:** no registry change alters a metric value. Only counter text and refs changed, plus the `counter.why` prefix "weak counter-metric...", which the report states.
- **Item 5:** no test is loosened. The c50, c72/c78 and c79 files are untouched. c66-metric-audits and coverage.test were only adapted to typed refs (they create real missions).
- The report matches the commits, and the RED/GREEN evidence is plausible.

## Findings
1. **MAJOR.** The scanner (`server/test/contracts/columns.ts` `reads`, the `from|join` regex) misses comma joins and schema-qualified tables:
   - `from tasks t, task_reviews r where r.verdict=1` reads only `tasks.id`, and the `r.*` reads are dropped;
   - `from public.tasks t` reads nothing at all.
   Fix: match `,\s*table [alias]` in from-lists and `(public\.)?`, or fail any statement with a table-like word that does not resolve.
2. **MINOR.** The row-level claim is a reviewed declaration only, as the header admits. The DIM rows share two loader files, so the union is checked rather than each row. State this next to the weak guard.
3. **MINOR.** The CONTEXT_READS wildcards (`*.mission_id`, `*.task_id`, `*.id`) let a new read of those columns slip past. This is acceptable, but say so.
4. **MINOR.** Pre-existing free-text rows are still counted by auditStates (metric-guard-routes.ts:26-28) and cannot be purged. Note this, or ignore non-parsing refs on read.
5. **MINOR.** The existence check is read-committed and unlocked, so it races a concurrent clearDemo, and it ignores `missions.deleted_at`. Both are acceptable (no FK), but note them. There is no cross-tenant test: add one asserting the 422 for another tenant's id.
6. **MINOR.** Counter quality:
   - several re-points (finished, cycle_time, failure_rate and throughput, all to tasks_verified_by_review) say "stays flat", not "moves the opposite way";
   - cross_family_reviews, first_pass_acceptance and handoff_wait_h now use the lagging failure_rate;
   - the 6 weak markings are honest, and the guard fails a new shared-input row.
   This is a judgement call, admitted in the report's concern 4.

Also minor: the c66 leak regex changed from /x\d/ to /mission:M-x/. It is narrower, but equivalent for the leak check.
