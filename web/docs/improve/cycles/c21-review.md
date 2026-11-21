# Cycle 21 review (honest exit codes), branch c21-honest-exit-codes

Spec verdict: PASS. Quality verdict: PASS (approve; 3 minor notes, no Critical or Important).

## 1. Per-script failure paths (web/scripts)
- crawl.mjs:42, crawl-deep.mjs:36: exit 1 on `problems.length`; problems cover pageerror, console error, EMPTY, PLACEHOLDER. Exit is after `b.close()`.
- flows.mjs, u1-flows.mjs, auth-flow.mjs (last lines): exit 1 on any `FAIL` result or any collected page/console error; step() catches turn into FAIL rows, so no swallowed error. Exit is after `b.close()`.
- dialog-smoke.mjs:47 (`fails`, which includes console errors, no modal, Escape not closing), fit-check.mjs:84 and ov-fit.mjs:41 (`bad`), check-dialogs.mjs:17 and check-help.mjs:21 (`missing`): exit 1 correctly, after cleanup.
- perf-nav.mjs:46: `process.exitCode = 1` on TIMEOUT; the script still closes the browser and the process exits naturally. It has no FPS thresholds, so nothing else to fail (the implementer notes this).
- Uncaught exceptions (goto failure, evaluate throw) already end node with exit 1; no new swallowing.
- fs-guard.mjs already exits 1 on `fail`.

## 2. verify-all.sh
- `set -uo pipefail` (no -e); `step()` runs the command redirected to a log and reads `$?` immediately, so there is no `| tail` masking. The `tail` runs on the log afterwards.
- All 10 steps run regardless of earlier failures; the summary table lists all and exits 1 if any failed. Proof in the report (BASE pointing at a dead port gives 9 of 10 failed; the build step is independent of BASE).
- Minor: the build step writes to build.log and only prints its last line to the step log, so the "failing lines" grep for a failed build sees at most that one line (not the `error TS` lines). Failure is still reported and exits 1.

## 3. Assertions
Diff touches only exit lines, the perf-nav exit code and verify-all reporting. No assertion, threshold or selector loosened. Mild tightening: console/page errors now fail flows, u1-flows and auth-flow (they were already reported; the report states all green on this branch).

## 4. fs-guard concern
- web/vite.config.ts fs.allow (`.`, `../shared`) and fs.deny (`.env`, `*.dump`, `**/backups/**`, `**/server/**`) are identical at 74117b8 and on the branch. The only diff in that file is `build.chunkSizeWarningLimit` 1500 to 400, a build-warning threshold unrelated to serving.
- fs-guard.mjs requests the /@fs URLs for backups dumps, server/README.md, server/.env, server/src/app.ts, update/*.md (must 403/404), and shared contracts plus /src/main.tsx (must 200). All pass on the lane per the report.
- The injection `/src/no-such-file-xyz.tsx` is a nonexistent path under the allowed root; the lane's Vite config allows the worktree so the request is answered by the dev server's SPA fallback or lane config rather than a guard decision. It is an injection artefact, not a guard regression. Conclusion: not a regression. Minor: the proof injection for fs-guard was not a faithful one (a real forbidden path should have been tried); acceptable.

## 5. dialog-smoke ledger rewrite
Pre-existing: dialog-smoke.mjs writes tracked docs/dialog-ledger.txt on every run, so every verify-all run dirties the tree. Minor hygiene; suggest a follow-up (write only with a flag or compare) but not in scope here.

## 6. api scripts and api-e2e.sh (read only)
api-auth-flow, api-flows, api-improve, api-c05, api-offline, api-stage6 end with `process.exit(results.some(FAIL) || errors.length ? 1 : 0)`. api-e2e.sh uses `|| rc=1` per script and `exit $rc`; a missing script sets rc=1; the EXIT trap does cleanup. Claims confirmed. Minor: api-offline.sh just runs the node script last, so its exit propagates implicitly (fine).

## Other
crawl-deep runs about 10 minutes; any harness timeout above it is an operational note, not a defect.
