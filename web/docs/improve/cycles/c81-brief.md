# c81 brief: tenant isolation fixes and stronger relations (T1 items 2–4, MR2, MR4)

**Lane:** w79 (`/home/luca/AXION-w79`, branch `c81-tenant-fixes`), from improve-30h at the commit that adds this brief (batches through 37 merged). Ports 12990–12993. E2E DB **axion_e2e13** (reused; edit the lane `server/.env` after `new-lane.sh`). **Server only: no file under `web/` may change. No migration.**
**Sources:** BACKLOG row T1; `cycles/c79-report.md` and `cycles/c79-review.md`; `phase2/research-r4.md` §R4-4 and `phase2/research-r4-verified.md`. The c79 suite is in `server/test/tenant/` (fixture.ts, isolation.ts and their tests). MR2 and MR4 are the researcher's own construction, so label them that way.

**HARD RULE:** never connect to, query or read the live `axion` database in any form (no psql, no script, no `.env` of `/home/luca/AXION`). Use only your lane's `axion_e2e13` and the test DB the harness gives you.

## Items (each RED first, then GREEN, each its own commit)
1. **Open-check.** On your base, confirm that each of items 2–5 still reproduces, and show the failing test. If one is already fixed, say so with evidence and skip it.
2. **T1(2): health size.** `GET /operations/health` (`server/src/ops/routes.ts`) returns `db.sizeBytes = pg_database_size(...)` to any tenant's admin. That is a cross-tenant aggregate. Never return a figure that counts other tenants' data.
   - The field is already optional in the DTO. Omit it whenever more than one tenant exists, or replace it with a figure computed from the caller's own tenant rows. Pick one, give your reason, and keep the DTO, registry and validator consistent (c50).
   - Read how `web/` renders a missing `sizeBytes`. You must not change `web/`. If the UI would break or mislead without the field, stop and report instead.
   - Test with two tenants: tenant B's admin never sees a figure that changes when tenant A's data grows. Use the c79 marker style.
3. **T1(3): ack visibility.** `POST /notifications/:id/ack` and `POST /notifications/ack-all` (`server/src/notifications/routes.ts`) accept any well-formed id, foreign or nonexistent, and store an orphan read marker.
   - Return 404 for an id the caller can't see, and store nothing.
   - `ack-all` must only mark notifications visible to the caller.
   - Keep idempotency: acking your own notification twice is still fine.
   - Remove the matching reasoned exception from the c79 suite, so the generated sweep now covers these routes. Removing an exception is fine; adding one is not.
4. **T1(4): member order.** `GET /departments` `memberIds` (`server/src/company/departments.ts`) has no ORDER BY. Order by the agent id (name order is used elsewhere; pick the order the UI already shows and say which). Add a test that would fail with a reversed physical order (for example, insert in reverse order).
5. **Compare-route reverse case.** The c79 sweep (444edfc) sends a foreign `:id` with an own-tenant `?with=` to `GET /agents/:id/skills/compare`, but never an own `:id` with a foreign `?with=`. Add that case to the generated sweep, generically: for every route in the c79 `QUERY` map whose query value is an id placeholder, also test a foreign id in the query. Expect 404 or 403, with no marker leak.
6. **MR2: the tenant-id swap.** For every write route and a sample of at least 20 GET routes, send tenant B's `tenantId` in the body, the query and an `x-tenant-id` header. Do this as tenant A. The response must be identical to the same request without it, or a 400 for an unknown field. It must never act on B. Generate the cases from the route table, as c79 does.
7. **MR4: forged-scope corpus.** Use at least 40 forged inputs: ids with case, whitespace, URL encoding, `..`, unicode-confusable or prefix variants of tenant B's ids (including the `b-` agent prefix), arrays where a scalar id is expected, and JSON-path keys. Every one must be refused or answered without B's data. Generate the cases and keep them in a reviewed table, the way c79 keeps its mutants.
8. **Seeded mutants.** Add at least 4 new seeded mutants, one per item 3, 5, 6 and 7, and show the suite catches each.

## Standing rules
- PHASE2.md "Standing rules for every Wave 5+ brief" apply.
- No c50 allowlist lines, and no new c79 exception. A new route with a required query gets a c79 `QUERY` entry.
- The c66 registry and RATING_FIELDS apply.

## Pass threshold
- Items 2–8 RED → GREEN.
- `test/tenant` all green.
- Full serial vitest (`--maxWorkers=1 --no-file-parallelism`) with no failure, or every failure named and shown unrelated.
- tsc clean.
- `git diff base..HEAD --stat` shows no `web/` file and no migration.

## Report
`cycles/c81-report.md`. Follow the LANES.md Finishing rule, including the committed-diff check. **Deadline:** hand back by about 12:30Z. If you are short of time, hand back what is RED → GREEN and committed, and mark the rest NOT MET.
