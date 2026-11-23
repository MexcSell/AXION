# c77 brief: Stage 9 records (usage ledger with budget caps, and a model registry with routing policy) (M2, G1). PARKED, never merged without the owner.

**Lane:** w75 (`/home/luca/AXION-w75`, branch `c77-stage9-records`), from improve-30h at the commit that adds this brief. Ports 12590–12593. E2E DB **axion_e2e2** (reused). Migration **0057**.

**Gate (owner Q11).** The spec puts this in Stage 9, which ends with "ask owner approval". The lane is built and reviewed, then **parked**:
- no QUEUE row;
- no live migration;
- the branch is left for the owner.

**Definitions:** `phase2/gap-analysis.md` items 6 (usage ledger and budget caps) and 12 (model gateway registry and routing policy, fake adapter only). Read PHASE2.md (the Wave 4 gated section) and the safety boundary.

**Hard limits:**
- No model or provider call of any kind.
- No provider SDK import.
- No network.
- Fake adapters and fake meters live under `server/test/` only.
- **Nothing meters real usage.**
- c69's unmeasured cost cells stay as they are.
- Budget caps are a **pure check function wired to nothing**.
- The Models tab stays unwired.

## Items (each test-first, each its own commit)
1. **M2, usage ledger.** An append-only usage ledger (tenant, subject, unit, quantity, cost in fixed-point, recorded at, source) with correction rows rather than updates. Apply all four guards plus purge_demo.
   - Add a pure `checkBudget(caps, usage)` that returns allow, warn or deny with reasons, and has table-driven tests.
   - Add no route that writes usage. An admin read route is optional.
2. **G1, model registry.** Model entries (family from the c38 vendor table, version, capabilities, status) and a routing policy as data.
   - Add a pure `route(policy, request)` returning the chosen entry with a reason, and test it with a fake adapter under test/.
   - No route calls a model.
3. **Contracts.** Add entries for any route. No allowlist lines. Classify any new writes in the c66 inventory.

## Pass threshold
- Items RED → GREEN.
- Full vitest (serial fallback) and tsc pass.
- api-stage6 passes.
- Migrate down/up 0057 once on the e2e DB.
- A grep shows no provider SDK and no network call.

## Report
`cycles/c77-report.md`. Its first line must say: "PARKED for owner decision (Q11); do not merge without approval." Follow the LANES.md Finishing rule.
