# Cycle 57 report: test hygiene (H12 live-region race, H13 anchors route)

Lane w56, branch `c57-test-hygiene`, from improve-30h at bfe891e. Ports 10690-10693, e2e DB axion_e2e15. No migration, no product change.

## H12: live-region race
**Finding.** The app shell always mounts a live region (`ToastStack` sr-only status, `ConnectionBadge`, `PageSkeleton`), so on a settled `/operations?tab=agents&sub=directory&view=cards` there is always one. `LIVE page has no live region` can therefore only come from a probe that evaluates on a document that is not a settled shell: the old probe was `goto(domcontentloaded)`, `settle()` (whose two 15 s waits swallow their own timeouts), a fixed 150 ms, then one `evaluate`. A document replaced under it (a dev-server full reload, a re-optimised dependency) or a still-booting one (module scripts run, React not yet rendered) has an empty `#root`. No product path lacks a region: loading (PageSkeleton, `role=status`), error (ErrorBoundary and banners sit inside the shell, which keeps ToastStack), empty and view switch all keep the shell. The only region-less app screen is the signed-out Connect card, which is not an audited route.
**Natural reproduction: NOT REPRODUCED.** Attempts: 30 consecutive loads of the route at 6x CPU throttle (0 failures, load avg 4-7); 40-iteration run at 20x throttle with the cache disabled was cut by my own 580 s timeout before finishing (no failure seen in the part that ran, count unknown); `main.tsx` delayed 17 s (0 failures, settle covers 30 s) and 33 s (goto times out first, so unreachable). Machine load average was 11-20 during later runs.
**RED (mechanism).** Knob `A11Y_INJECT_RELOAD=1` replaces the document (`location.reload()`, waiting for `framenavigated`) right before the audit, on a copy of the OLD probe order: 3 of 3 runs report `LIVE page has no live region`. (Replacing and waiting for DOMContentLoaded gave 0 of 3, and replacing without waiting gave `Execution context was destroyed`, so the window is: new document committed, React not rendered.)
**GREEN.** `auditStable()` in `web/scripts/a11y-check.mjs`: waits (20 s) for the shell (`.rail-nav`), settles, reads `performance.timeOrigin` before and after the audit, and repeats the audit on the new document if it changed (max 4 attempts, logs a `note:`). A shell that never mounts is reported as its own `SHELL ...` violation. The LIVE check itself is unchanged. With the same injection: 3 of 3 runs now log the note and pass (0 violations). Non-loosening proof: `A11Y_STRIP_LIVE=1` (removes every live region from a settled page) still gives `LIVE page has no live region`.
**Own regression, caught and fixed.** My first shell wait also required `.conn-badge`, which demo mode does not have: the demo run reported 51 `SHELL` violations (1207 s). Fixed in a4cd4d7 (rail only).
Knobs (all off by default): `A11Y_ROUTE`, `A11Y_REPEAT`, `A11Y_THROTTLE`, `A11Y_NOCACHE`, `A11Y_DELAY_MAIN`, `A11Y_INJECT_RELOAD`, `A11Y_STRIP_LIVE`. With `A11Y_ROUTE` the script stops after the repeated route (no dialogs or probes).

## H13: anchors route
**RED.** The new coverage test file with the allowlist line removed, run against the old test (no anchor configured): `test/contracts/coverage.test.ts` 1 failed, 5 passed. Failing test: `API coverage run > every object array was filled and every nullable field was non-null in some call, unless listed with a reason`; first error line `AssertionError: expected [ …(4) ] to deeply equal []` listing `GET /operations/anchors .lastAnchorAt | .restartedAt | .tenants[].anchoredSeq | .tenants[].anchoredAt never non-null`.
**GREEN.** `server/test/contracts/coverage.test.ts` builds the app with `auditAnchor` set to a hermetic setup: a key generated per run with `randomBytes(32)` (never printed; the test asserts no response contains it), the fixed domain `axion-contract-test`, and a file in a `mkdtemp` directory removed in `afterAll`. Nothing reads any `.env`. The flow calls the route three times: key and domain but no file (`configured:false`, nulls), after `writeAnchor` (ok, `anchoredSeq` and `lastAnchorAt` set), after a forced `rotateAnchor` (`restartedAt` set); each body is validated by the existing contract. The `GET /operations/anchors` line is deleted from `server/test/contracts/exercised.ts`. `vitest run test/contracts`: 3 files, 15 tests passed.

## Pass threshold
| Item | Result | Evidence |
|---|---|---|
| H12: failure reproduced, or NOT REPRODUCED with attempts | NOT REPRODUCED naturally; mechanism reproduced by injection (3/3 RED) | above |
| H12: 20 consecutive a11y api passes on the route under throttle | PASS | `A11Y_ROUTE=... A11Y_REPEAT=20 A11Y_THROTTLE=6`, api mode, 0 violations over 20 loads (load avg 14-19) |
| H13: allowlist line removed, contracts suite green | PASS | line deleted; contracts 3 files, 15 tests passed |
| tsc | PASS | `tsc --noEmit` clean in server and web |
| Full vitest | PASS | final run `--maxWorkers=2` via heavy.sh: 69 files, 2114 tests passed (load avg 10-14). See concerns for the earlier runs |
| a11y both modes clean | PASS | api: 41 views, 65 dialogs, 0 violations; demo: 51 views, 65 dialogs, 0 violations (dev server 10690) |

## Concerns
- **Shared DB role saturated.** Four earlier full vitest runs failed 138-156 tests each with `too many connections for role "axion"` (the role limit is 45 and 19-45 were in use by other lanes), also at `--maxWorkers=1`. Not code: the 22 files that failed in the 1-worker run all passed when rerun alone (22 files, 542 tests, 0 connection errors), and the last full run passed 69/69. Failing files in the run that I reran: approvals, audit-chain, auth, c09-minors, c48-can-decide, c51-review-hardening, contracts/coverage, conversations, delegation-brief, departments-route, dimensions-route, direct, eval-evidence-db, jobs, org-history, playbooks-migration, playbooks, policy-approvals, site-grants, staffing-stall, throughput, version-proposals (first line in every case a 500 INTERNAL or `too many connections`).
- The H12 root cause is inferred (an unsettled or replaced document), not observed in the wild. The fix is condition-based and covers both that window and a slow shell; if the failure recurs with a stable shell, the new `SHELL`/`LIVE` messages and the `note:` line will tell which.
- The probe loop (`LIVEPROBE`, held-request section) still evaluates the audit once after a fixed settle; it was not part of the finding and is unchanged.
- Two commits touch the a11y probe (8f80678, a4cd4d7) because of my demo-mode regression.

## Files changed
`web/scripts/a11y-check.mjs`, `server/test/contracts/coverage.test.ts`, `server/test/contracts/exercised.ts`, this report.
