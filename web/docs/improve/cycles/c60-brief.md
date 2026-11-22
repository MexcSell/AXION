# c60 brief: failure attribution and an OTel GenAI mapping (R2-10 attribution, R2-8)

**Lane:** w59 (`/home/luca/AXION-w59`, branch `c60-attribution-otel`), from improve-30h at the commit that adds this brief. Ports 10990–10993. E2E DB **axion_e2e14** (reused). Migration **0045** if needed.
**Sources (verified):** `phase2/research-r2.md` §R2-8 and §R2-10, with the required changes in `phase2/research-r2-verified.md`.
- R2-10 is **attribution only**. Drop the stratified org-change comparison. Record the one safe lesson in the report: the literature disagrees on hierarchy, so AXION holds no "hierarchy is better" belief.
- For R2-8, the OTel GenAI agent conventions are in "Development" status. **Pin** the exact spec version or commit and the SHA-256 of the page you used. B5 is not support for OTel.
**Read first:** `cycles/c33-*` and `c05-*` (failure tags, MAST), `cycles/c32-*` (traces schema, migration 0027), `server/src/failures/`.

## Items (each test-first, each its own commit)
1. **Attribution fields.** A failure tag can carry an optional attribution (agent id and step reference) and a "full trace available" flag. Attribution is stored only for tasks with a recorded failure.
   - When two people attribute the same failure differently, both entries are kept and a disagreement count is shown. The latest entry never silently wins.
   - Use the existing tagged-by kind.
2. **Mapping table.** Write `web/docs/improve/phase2/otel-mapping.md`. Every AXION trace or task field is either mapped to an OTel GenAI agent span name or attribute, or listed as "no equivalent". Name the pinned spec version and its hash.
3. **Export.** Add a CLI (not a route) that exports stored trace and task records for one mission to a local OTLP-JSON file.
   - Content attributes are off by default; `_ref` pointers replace inline text.
   - No network and no collector.
   - Tests: exported fixtures validate against the pinned attribute list, and the default export contains zero content attributes.
4. **Contracts.** Add registry, DTO and validator entries for any new field. No allowlist lines.

## Pass threshold
- Items 1–4 RED → GREEN. Full vitest and tsc.
- api-c33 (or the failure-tag checks), stage6 and improve pass. a11y clean if the UI changed.

## Report
`cycles/c60-report.md`.
