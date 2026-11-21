# Cycle 21 (lane w19): honest exit codes in the verification scripts

## Hypothesis
`web/scripts/verify-all.sh` is the gate for demo mode in every cycle. It returns exit code 0 even when a sub-script
prints FAIL: `flows.mjs`, and possibly others such as `u1-flows`, `auth-flow` and `crawl-deep`. These print failures but
exit 0, and the pipe through `tail` hides even that. Since then, "verify-all green" claims across the loop may have
hidden failures; lane w15 found failing demo-mode flows behind rc=0.

After this cycle every verification script exits non-zero on any failure, and `verify-all.sh` fails when any step fails.
A summary at the end lists each step with PASS/FAIL. The same applies to the api-mode scripts run through `api-e2e.sh`:
check that each exits non-zero on a FAIL line and that `api-e2e.sh` propagates it, which it seems to via `|| rc=1`.

## Measure and pass threshold (fixed now)
1. **Inventory:** for every script under `web/scripts/` that prints PASS/FAIL or similar, record whether it exits
   non-zero on failure **before** your change (prove it by forcing one failure, e.g. an env var or a deliberately wrong
   BASE, and record the exit code).
2. **After:**
   - every such script exits non-zero when any check fails;
   - `verify-all.sh` exits non-zero if any step fails, and prints a final per-step summary table;
   - `set -o pipefail` with `| tail` is fine as long as the script's own exit code is right.
   - Prove each with a forced failure, then restore.
3. **Then the real run:** run `verify-all.sh` honestly on your lane, current `improve-30h` code. **Report every step that
   now fails.** Don't fix app behaviour in this cycle; only list the failures, with their exact messages, so the
   controller can route them. Also run those failing steps on `74117b8` (before the loop's parallel lanes) in a scratch
   checkout under your lane, to show which failures pre-date the lanes.
4. **No assertion is loosened.** Only exit codes and reporting change.

## Lane
You are lane w19:
- worktree `/home/luca/AXION-w19`;
- port base 6900: dev 6990, e2e 6992/6993;
- database `axion_e2e19`;
- override config `/home/luca/AXION-lanes/vite-w19.config.ts`.

Follow `/home/luca/AXION/web/docs/improve/LANES.md` exactly:
- never git stash;
- route every heavy run through `heavy.sh`;
- set `OUT=/tmp/axion-verify-w19` for verify-all.

Safety rules: `/home/luca/AXION/web/docs/improve/PROCESS.md`.
