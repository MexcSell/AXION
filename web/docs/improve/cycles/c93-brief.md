# c93 brief: connection-cap resilience for the test suite (H14b)

**Lane:** w91 (`/home/luca/AXION-w91`, branch `c93-conn-cap`), from improve-30h at the commit that adds this brief. Ports 14190–14193. E2E DB **axion_e2e4** (reused; edit the lane `server/.env` after `new-lane.sh`). **Server only. No migration, no `web/` change.**

**Why:** The `axion` DB role is capped at 45 connections, shared by every lane and the integrator. On 2026-11-23 full serial runs failed 5 times on unrelated tests with `too many connections for role "axion"` (SQLSTATE 53300) or `admin connect failed {"code":"INTERNAL"…}`, in these files:
- auth.test;
- site-grants;
- c86-record;
- playbooks;
- jobs stress.
Each passed alone. Every such flake costs a re-run and a judgement call.

**Sources:**
- BACKLOG H14 (and c70's partial fix);
- LESSONS ("The connection cap is still the main source of flakes");
- `server/src/db.ts` `makePool` (max 10, connectionTimeoutMillis 5000);
- `server/test/helpers.ts` (`withAdmin`, the test app factory);
- `/home/luca/AXION-lanes/heavy.sh` (DB slots).

**HARD RULE:** never connect to, query or read the live `axion` database in any form. Never run migrate, demo:* or audit:* CLIs. **Never edit `/home/luca/AXION-lanes/heavy.sh`**; propose any change in the report instead.

## Items (each its own commit)
1. **Measure.** Count the connections one serial full run holds at peak, sampling `pg_stat_activity` for the **test DB only** (`datname` = your lane's test DB, `usename` = axion). Find which files open the most pools or connections and why: one app per file, `max` 10, and extra pools in fixtures. Report the peak and the top 5 files.
2. **Bound the test pools.** Make test apps and fixture pools use a small `max` (for example 3; justify the number by item 1) through one place, such as a test-only env var or a `makePool` argument from the test app factory.
   - Production defaults must stay unchanged.
   - Tests that genuinely need concurrency (jobs: 20 parallel claimers) declare their own higher max explicitly, with a comment.
   - Show the new peak.
3. **Retry only connection acquisition, only on 53300.**
   - In `makePool`, or a wrapper used by the app, retry acquiring a connection when the error is SQLSTATE 53300 (or the pg "too many connections" message): a few attempts with short backoff and jitter, total under about 3 s, then fail as before.
   - **Never retry a query, a transaction, or any other error code.**
   - This is product code, so it needs a unit test with a fake pool that throws 53300 twice then succeeds, and one that throws a different error, which is not retried.
   - Log each retry at warn.
   - State plainly in the report that production gets this too, and why that is safe: acquisition only, and bounded.
4. **Prove it.**
   - Run 3 consecutive full serial runs at the current machine load, with the load printed.
   - Then add an artificial squeeze: a small side script that holds N connections to **your own lane test DB** for the duration of one run, chosen so that before the change the run hits 53300.
   - Show that before (on the base) the squeezed run fails and after it passes.
   - Name every failure.

## Pass threshold
- Items 1–4.
- No assertion loosened, no test skipped.
- Full serial vitest green 3 times.
- tsc clean.
- Diff stat: server only, no migration.

## Report
`cycles/c93-report.md`. Follow the LANES.md Finishing rule. **Deadline:** hand back by about 13:30Z.
