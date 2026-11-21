# Cycle 21 (lane w19) report: honest exit codes in the verification scripts

## Inventory: exit code before vs after a forced failure
A failure was injected into a temporary copy of each script (a pushed `FAIL`/problem/`bad++`, or a bogus served path),
then the exit code was recorded. "Before" = scripts at 74117b8 (scratch worktree, own dev server); "after" = this branch.

| Script | Before | After |
|---|---|---|
| crawl.mjs | 0 (prints FORCED) | 1 |
| crawl-deep.mjs | 0 | 1 |
| flows.mjs | 0 | 1 |
| u1-flows.mjs | 0 | 1 |
| auth-flow.mjs | 0 | 1 |
| fit-check.mjs | 0 | 1 |
| ov-fit.mjs | 0 | 1 |
| dialog-smoke.mjs | 0 | 1 |
| check-dialogs.mjs | 0 | 1 |
| check-help.mjs | 0 | 1 |
| perf-nav.mjs (route that never mounts, TIMEOUT) | 0 | 1 |
| fs-guard.mjs | 1 (already) | 1 (already; injection did not re-fail on the lane's server, see concerns) |
| api-auth-flow, api-flows, api-improve, api-c05, api-offline, api-stage6 | already `process.exit(FAIL||errors ? 1 : 0)` | unchanged |
| api-e2e.sh | propagates via `|| rc=1`, exit $rc | unchanged |

Screenshot-only tools (api-narrow, api-shots, first-load, gallery, shot*, u1-shots) assert nothing and were left alone.
Not run in api mode (static review only): the api-* scripts and api-e2e.sh.

## verify-all.sh
Now runs each step with its own exit code and log in `$OUT/NN-name.log`, shows the last lines, prints the
FAIL/ERROR lines of a failed step, and ends with a PASS/FAIL table; exits 1 if any step failed.
Proof of failure: `BASE=http://127.0.0.1:6999` (nothing listening) gave rc=1 and "9 of 10 STEPS FAILED".
No assertion was loosened; only exit codes and reporting changed.

## Honest run on improve-30h code (lane w19, base 6990)
RC=0, all 10 steps PASS (build, crawl 77 views, deep crawl, flows 21 PASS, auth flow 17 PASS, u1 flows 8 PASS,
dialog smoke 55 dialogs 0 failures, dialog ids, help keys, fs guard). No step honestly fails, so nothing was routed
and the 74117b8 comparison of failing steps was not needed.

## Files
web/scripts: auth-flow, check-dialogs, check-help, crawl, crawl-deep, dialog-smoke, fit-check, flows, ov-fit, perf-nav,
u1-flows (.mjs), verify-all.sh.

## Concerns
- The "w15 found failing demo flows behind rc=0" claim is not reproduced on this lane: all green now.
- crawl-deep takes about 10 minutes; a 300 s timeout in the harness killed it (exit 124), so it was re-proved alone.
- fs-guard injection (`/src/no-such-file-xyz.tsx`) failed at 74117b8 but returned 200 on this lane's vite; not a
  regression of the guard (its 404 checks passed), only a poor injection.
- dialog-smoke rewrites the tracked docs/dialog-ledger.txt on every run; restored each time, not committed.
- perf-nav sets process.exitCode only on a TIMEOUT; it has no FPS thresholds.
