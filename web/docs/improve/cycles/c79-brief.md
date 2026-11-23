# c79 brief: tenant-isolation metamorphic suite (R4-4)

**Lane:** w77 (`/home/luca/AXION-w77`, branch `c79-tenant-isolation`), from improve-30h at the commit that adds this brief. Ports 12790–12793. E2E DB **axion_e2e4** (reused). **Tests only. No product code change.** If a test finds a real leak, stop and report it with evidence. Don't fix product code in this lane.

**Docs:** read these **read-only** from `/home/luca/AXION/web/docs/improve/`:
- `phase2/research-r4.md` §R4-4;
- `phase2/research-r4-verified.md`, for its required changes.

Its relations MR1–MR4 are **the researcher's own construction**, so label them that way. Don't claim per-attacker/victim-pair measurement (B2 was OVERSTATED).

## Items (each test-first, each its own commit)
1. **Generated from the route inventory.** Reuse c50's route inventory (`app.routeTable`, `test/contracts/`). For every GET route reachable by tenant A, check two things:
   - **Invariance:** add, change or delete tenant B data, and tenant A's response is byte-identical, after normalising volatile fields such as timestamps and ids that are explicitly listed.
   - **Marker absence:** plant unique markers in every free-text field of tenant B's data. They never appear in any of tenant A's responses, exports (the OTLP export CLI, run on the e2e or test DB only), SSE streams or audit rows.

   **Count the global routes first** (health, public config, and so on) and list them as reasoned exceptions. If there are more than you expected, cut the invariance relation (MR3) to GET routes only and say so.
2. **Seeded-leak mutants.** Inject about 10 leaks through test seams or temporary patches applied in the test process only, never committed in src. Examples:
   - drop a `tenant_id` predicate;
   - use the wrong tenant in a join;
   - leak through a cache key or an SSE channel.

   Measure the kill rate. Report each mutant and whether it was killed. The target is to kill all 10; report anything less honestly.
3. **Write routes.** For POST, PUT and DELETE routes that take ids, tenant A acting on tenant B's ids must get 404 or 403. Generate this from the inventory.

## Pass threshold
- Items 1–3 green on the real code, the mutant kill rate reported, and the exceptions listed with reasons.
- Full vitest serially (name every failure) and tsc.
- The diff stat shows test files only.

## Report
`cycles/c79-report.md`. Follow the LANES.md Finishing rule, including the committed-diff check.
