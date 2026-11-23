# c76 brief: Stage 8 records, release/last-good and artifacts (R1, A1). PARKED, never merged without the owner.

**Lane:** w74 (`/home/luca/AXION-w74`, branch `c76-stage8-records`), from improve-30h at the commit that adds this brief. Ports 12490–12493. E2E DB **axion_e2e18** (reused). Migration **0056**.

**Gate (owner Q11).** The spec puts these in Stage 8, which ends with "ask owner approval". This lane is built and reviewed but **parked**:
- no QUEUE row;
- no live migration;
- the branch is left for the owner to take or drop.

Build it as a clean, self-contained branch.

**Definitions:** `phase2/gap-analysis.md` items 8 (release and last-good records with a guardrail-path denial) and 11 (artifacts and immutable versions). Read PHASE2.md, Wave 4 gated section.

## Items (each test-first, each its own commit)
1. **R1, release records.** Records only:
   - a release (what, version, by whom, from which approvals);
   - a last-good pointer;
   - a rollback-target record.

   **No route performs a release, deploy, restart or rollback.** The guardrail-path denial: a release record whose change touches guarded paths (policy, approvals, audit, locks, migrations) is refused unless an explicit R4 approval is bound to it. Test that denial.
2. **A1, artifact metadata.** Records only:
   - an artifact and its immutable versions (sha256, size, media type, producer);
   - append-only guards (all four, plus the purge_demo exception).

   **No file storage and no download route.** If the design needs signed download tickets, record only the data model and say why it is deferred.
3. **UI.** None, unless a tiny read-only panel is clearly useful. The Results tab stays unwired.
4. **Contracts.** Registry, DTO and validator entries for any route. No allowlist lines. c66 inventory: classify any new writes.

## Pass threshold
- Items RED → GREEN.
- Full vitest (serial fallback) and tsc.
- api-stage6 passes.
- Migrate down/up 0056 once on the e2e DB.

## Report
`cycles/c76-report.md`. Its first line: "PARKED for owner decision (Q11); do not merge without approval." Follow the LANES.md Finishing rule.
