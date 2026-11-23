# c85 brief: change plan records for org proposals (R5-1, first slice)

**Lane:** w83 (`/home/luca/AXION-w83`, branch `c85-change-plans`), from improve-30h at the commit that adds this brief. Ports 13390–13393. E2E DB **axion_e2e14** (reused; edit the lane `server/.env` after `new-lane.sh`). **Server and shared/contracts only: no file under `web/` may change.** **One migration allowed: 0058**, and only if needed.
**Sources:**
- `phase2/research-r5.md` §R5-1;
- `phase2/research-r5-verified.md`: its R5-1 section and closing recommendation. **Its required changes are binding.**
- c64's code: `server/src/organization/proposals.ts`, guardrails.ts, churn.ts, evidence.ts and history.ts, plus `cycles/c64-*.md`;
- the metric registry `shared/contracts/src/metric-registry.ts` and `metric-guard.ts` (c66);
- `server/src/company/clock.ts` (c54).

**HARD RULE:** never connect to, query or read the live `axion` database in any form. Never run migrate, demo:* or audit:* CLIs, because they read a live `.env`. Your tests migrate their own DBs.

## What this is, and what it is not
A record of **what was planned before an org change**, kept so that the metric can't be chosen after the data is seen. It is the researcher's construction on top of c64, which already hashes a stated baseline and an expected cost. **It is not pre-registration in the statistical sense, and this slice gives no statistical verdict.** Don't cite source A1 for pre-specification.

## Items (each RED first, then GREEN, each its own commit)
1. **Plan record.** An optional plan attached to an org change proposal (c64). The plan holds:
   - one primary metric, whose id must exist in the registry;
   - a direction (up or down);
   - a margin, in the metric's own unit;
   - a minimum n;
   - an observation window in days (7–90);
   - 0–3 guardrail metrics, each a registry id with a margin;
   - a free-text "why", 20–1000 chars.
   Validate every metric id against the registry. Refuse free-text metrics.
   - The plan can be set or replaced only while the proposal is pending.
   - At approval, the plan's canonical sha256 is fixed into the record and audited. Afterwards, the plan can't change.
   - Proposals without a plan keep working exactly as today. Don't break api-stage6 or the existing UI flows.
2. **Amendments.** After approval, a change is never an edit. It is an amendment row: the new values, a reason of at least 20 chars, the actor, and DB `now()`.
   - Amendment rows are append-only, with all four guards and the `axion.purge_demo` exception (c80's lint must pass for 0058 and its generated four-guards test must cover the table).
   - Each amendment is audited.
   - The readout flags "amended after the change" plainly.
3. **Readout, counts only.** `GET` on the proposal's plan returns:
   - the plan and its sha;
   - the amendments;
   - the change time (the org revision's `active_from`);
   - the pre-window and post-window bounds, computed in SQL from DB `now()` (c54 `dbWindow`);
   - for the primary metric and each guardrail, **the number of observations in each window**, plus whether minimum n is met.
   It gives no effect estimate and no "it worked". Until the post window is complete and minimum n is met in both windows, it says "not enough evidence yet". After that it says "ready for analysis (not computed in this version)".
   - Use the registry's loaders, or the same tables they read. Declare every read in the c66 registry, so the c66 and c83 guards stay green.
4. **Contracts and guards.** DTOs, validators and the c50 registry entries for every new route and field, with **no allowlist lines**.
   - The c79 sweep covers new routes automatically. If a route needs a query, add a `QUERY` entry, never an exception.
   - Writes are admin-only, like c64. Reads follow the c64 visibility.
   - Use `locks.ts` for any lock.
5. **Owner question.** Add Q17 to your report: "Which kinds of change should be allowed or required to carry a plan (org changes only, or also process toggles and version promotions)?" This slice covers org change proposals only.

## Pass threshold
- Items 1–4 RED → GREEN.
- The c80 migration lint passes on 0058, with no edit to the frozen baseline.
- The four-guards test covers the new table.
- c79 test/tenant is green with the new routes swept.
- c50, c66 and c78 guards are green.
- Full serial vitest with no failure, or every failure named and shown unrelated.
- tsc clean.
- Diff stat: no `web/` file; one migration (0058) at most.

## Report
`cycles/c85-report.md`. Follow the LANES.md Finishing rule. **Deadline:** hand back by about 13:00Z. If you are short of time, hand back what is committed and mark the rest NOT MET.
