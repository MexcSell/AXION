# c80 brief: migration guard for append-only tables (R4-6)

**Lane:** w78 (`/home/luca/AXION-w78`, branch `c80-migration-guard`). It starts from improve-30h at the commit that adds this brief. Ports 12890–12893. E2E DB **axion_e2e5** (reused). No migration of its own.

**Docs:** read **read-only** from `/home/luca/AXION/web/docs/improve/`:
- `phase2/research-r4.md` §R4-6;
- `phase2/research-r4-verified.md`, for its required changes;
- LESSONS ("Append-only needs all four guards": three lanes missed one).

## Items (each test-first, each its own commit)
1. **A generated guard test.** Find every append-only table from the live schema of a migrated test DB, using the guard triggers and the table list in the existing tests. For each table, assert all four guards:
   - UPDATE refused;
   - DELETE refused;
   - TRUNCATE refused;
   - the `axion.purge_demo` exception for DELETE where the table holds demo data.

   It must fail if a future migration adds an append-only table missing one of them. Prove it with a fixture migration in the test that adds such a table.
2. **A migration lint.** It applies only to migrations from the **next number onward** (0058+), plus a frozen baseline list for the existing ones. It flags:
   - `DROP`/`ALTER ... DROP` on an append-only table;
   - disabling a guard trigger without re-enabling it in the same file;
   - an `UPDATE` or `DELETE` of append-only rows outside the `purge_demo` exception;
   - a missing down file.

   Run it as a vitest test. Test it with bad fixture migrations.
3. **Leave `migration.applied` audit rows out.** Migrations are cross-tenant and the chain is per tenant. Record that in the report as a design question; don't build it.

## Pass threshold
- Items 1 and 2 RED → GREEN with fixture proof, and nothing loosened.
- Full vitest serially (name every failure) and tsc.

## Report
`cycles/c80-report.md`. Follow the LANES.md Finishing rule, including the committed-diff check.
