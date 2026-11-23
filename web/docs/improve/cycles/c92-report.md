# c92 report: script port guards (H23) and the scanner's sub-select gap (M2c-1)

Lane w90, branch `c92-script-guards`, from improve-30h 17c5ee8. Only `web/scripts/**`, `server/test/**` and this report changed.

## Item 1, H23: scripts no longer default to the live ports
- New `web/scripts/_base.mjs`: `pickBase({env, cwd, arg})` (pure) and `resolveBase(arg)`. An explicit BASE (or a base argument) is always used. With none, the default `http://127.0.0.1:5190` applies only when cwd is `/home/luca/AXION` or below it (the integration tree). Anywhere else it prints a message and exits 2. A sibling such as `/home/luca/AXION-w90` or `/home/luca/AXIONx` does not count as the integration tree.
- Scripts changed (every script that defaulted to 5190; none defaulted to 5191): `_session.mjs`, `a11y-check`, `auth-flow`, `c28-palette-fast`, `c28-palette-pending`, `c28-palette`, `c28-signout-refresh`, `c29-archive-race`, `c40-fixround`, `c43-modal-focus`, `c43-palette-hover`, `c52-taskreviews-signout`, `c67-shots`, `check-dialogs`, `check-help`, `crawl-deep`, `crawl`, `demo-c35`, `dialog-smoke`, `fit-check`, `flows`, `fs-guard` (argv base kept), `gallery`, `ov-fit`, `perf-nav` (argv base kept), `shot`, `u1-flows`, `u1-shots` (all `.mjs`), plus a header comment in `verify-all.sh`. `_session.mjs` carries the default for the `api-*.mjs` scripts that import it.
- Untouched on purpose: the `api-*.mjs` scripts default to 5193, the api-e2e.sh web port, which is not a live port; `api-e2e.sh` exports its own BASE, so scripts run through it are unchanged.
- RED: `server/test/c92-script-base.test.ts` failed 6/6 before the helper existed (the 1 live-default scan listed 28 scripts). No real script was run to show it; the test calls only the helper. GREEN: 6/6 pass. A real script from the worktree with BASE unset: `env -u BASE node scripts/fit-check.mjs` prints the refusal, exit 2, before any request.

## Item 2, M2c-1: scanner (`server/test/contracts/columns.ts`)
- A derived table or function call in a FROM list (`from (select ...) x, tasks t`, `lateral (...)`, `unnest($1) u(v), tasks t`) is stepped over with its alias, so the entries after it are resolved. A `from` that sits inside `extract(`, `substring(`, `trim(`, `overlay(` or `position(` is not a FROM list.
- RED: the new test in `c83-registry-columns.test.ts` failed on the old scanner (`tasks` dropped: `['task_reviews']` instead of `['task_reviews','tasks']`). GREEN with the fix: 12/12.
- Fail-closed kept: tests assert that an unknown table after a sub-select, inside an extract's sub-select, and beside an extract is still reported. The existing real-loader tests pass unchanged.

## Checks
- verify-all on my own dev server (port 14090, OUT=/tmp/axion-verify-w90, BASE set): ALL 10 STEPS PASSED (scripts identical to the final tree).
- `api-e2e.sh` on lane ports 14092/14093 (axion_e2e3): `api-auth-flow.mjs` 15/15, `api-c09.mjs` 6/6. `api-c14.mjs` is 22/31 with the same 9 CSP-enforcement FAILs on the base 17c5ee8 scripts (re-run with `git checkout 17c5ee8 -- web/scripts`, then restored): unrelated to this cycle, not caused by it.
- c83 column tests plus c92 tests: 20/20 (RED shown for each of the three M2c-1 probes against the 17c5ee8 scanner; all three fail there, all pass now).
- Full serial vitest (`--maxWorkers=1 --no-file-parallelism`): 173 files passed, 1 skipped; 3582 tests passed, 36 skipped. (Run before the last test-only commit, which split one test into three and made the spawn test use a temp cwd; both files re-run green.)
- `tsc --noEmit` in server: clean.

## Concerns
- `api-*.mjs` still default to port 5193 (the e2e web port, not a live one); left as is.
- The helper's integration-tree test uses the pure function with a fake cwd, so nothing in the suite depends on where the tree lives.
