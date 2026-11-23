# c92 brief: scripts must not default to live ports, and the scanner's sub-select gap (H23, M2c-1)

**Lane:** w90 (`/home/luca/AXION-w90`, branch `c92-script-guards`), from improve-30h at the commit that adds this brief. Ports 14090–14093. E2E DB **axion_e2e3** (reused; edit the lane `server/.env` after `new-lane.sh`). **`web/scripts/**` and `server/test/**` only. No product code, no migration.** **This lane touches `web/scripts`, so it must be done by about 12:00Z** to merge before the 16:00Z freeze.

**Sources:** BACKLOG H23 and M2c (item 1); LESSONS "Script defaults can point at live ports"; the c83 scanner `server/test/contracts/columns.ts` and its tests.

**HARD RULE:** never connect to, query or read the live `axion` database in any form, and **never use ports 5190 or 5191**, not even for a read-only page load.

## Items (each RED first, then GREEN, each its own commit)
1. **H23.** Many `web/scripts/*.mjs` default `BASE` (or similar) to `http://127.0.0.1:5190`, and some may default an API URL to 5191.
   - Add one small shared helper, for example `web/scripts/_base.mjs`, that resolves BASE. When the script's cwd is not under `/home/luca/AXION/` (the integration tree) and no explicit BASE/port is given, it exits with a clear message instead of defaulting to 5190/5191. When run from the integration tree, the default stays 5190, so verify-all and the integrator are unchanged.
   - Make every script that defaults to 5190/5191 use it. Find them with grep and list them all in the report.
   - `api-e2e.sh` already sets its own ports: make sure nothing changes for scripts run through it.
   - RED: from your worktree, running one such script with no BASE would hit 5190. **Don't run that against 5190.** Show it by printing the resolved BASE in a dry-run mode, or with a unit test of the helper. Then show GREEN: it refuses.
2. **M2c-1.** The c83 column scanner stops a FROM list at a sub-select, so `from (select …) x, tasks t` drops the `tasks t` reads. Also, `extract(epoch from t.col)` will be flagged as unresolved (a fail-closed false positive).
   - Fix both in `columns.ts`, with RED tests for each probe.
   - The existing real-loader tests must still pass. **Never loosen fail-closed:** an unresolved real table must still fail.

## Checks
- verify-all on your own dev server (own OUT dir, BASE set to your port);
- two or three of the changed scripts run through `api-e2e.sh` on your lane ports;
- the c83 column tests;
- full serial vitest;
- tsc.

## Report
`cycles/c92-report.md`. Follow the LANES.md Finishing rule. **Deadline:** done by about 12:00Z.
