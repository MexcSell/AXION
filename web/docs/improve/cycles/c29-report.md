# Cycle 29 (lane w27): the "Delete (archive)" flows failure

## Root cause (test, not app)
`flows.mjs` went to `/missions?filter=archived` with `waitUntil: 'networkidle'` and then read `locator.count()` at once.
`networkidle` only means no requests for 500 ms. On a CPU-starved page React has not painted the list yet, so
`count()` returns 0 and the step reports "not in Archived" although the store holds the archived mission.
The earlier `waitForTimeout(600)` before the All-tab check had the same weakness (exit animation lags too).

## App race ruled out
Hypothesis was a staffing-driver tick (stale `missions` closure, final step sets `status: 'running'`) or a cross-tab
`storage` rehydrate undoing the archive. Checked: `advance()` returns null for archived missions; `storage` events never
fire in the page that wrote; `scripts/c29-archive-race.mjs` (14 missions archived at every phase of the 1.5 s staffing
tick, CPU throttle 8x) stays 14/14 archived on 3 runs, with no app change. Nothing to fix in `data.ts`.

## RED (deterministic)
Added `FLOWS_CPU_THROTTLE=N` to `flows.mjs` (CDP CPU throttle). Old step, `FLOWS_CPU_THROTTLE=4`:
`FAIL  Delete (archive) ...: not in Archived` (Add mission passed, so the mission existed). Also reproduced at 12x.
Direct probe: archived M-126, reload `/missions?filter=archived` at 20x throttle: 10/10 reloads had 0 rows right after
`networkidle` while the store status was `archived`.
Unthrottled load (48 busy loops, 4 parallel flows, 20 runs) did not trip this step (0/20); the throttle is the repro.

## Fix
`flows.mjs` archive step: `waitForFunction` (row gone or pinned, 15 s) instead of the fixed sleep, and
`locator.waitFor` for the archived row instead of an immediate `count()`. The check is not weakened: same two assertions,
same messages, now with a condition wait.

## Pass threshold
- Failures before: deterministic RED (throttle 4x and 12x). After: PASS.
- 20 runs after, 4 in parallel at `FLOWS_CPU_THROTTLE=4`: archive step 20/20 PASS. Two further unthrottled runs: PASS.
- verify-all: first run 9/10, `flows` failed on `u1 · News` and `u1 · Chat dock` (4 s / 30 s timeouts, load on a shared
  machine, not the archive step). Two re-runs of `flows.mjs` alone: archive PASS (see concerns). NOT MET as a clean
  10/10 verify-all; see concerns.
- api-e2e: not run (no server or api code changed; only `flows.mjs`).

## Files
- `web/scripts/flows.mjs` (throttle hook, archive step waits)
- `web/scripts/c29-archive-race.mjs` (new, app race check, passes)

## Concerns
- Under heavy load other `flows.mjs` steps also flake (Hierarchy "conversation pane did not switch" failed even at 1x
  throttle in my runs, Conversations, Command palette, Theme toggle, u1 News/Chat dock, Help popover). Same class (short
  fixed waits / immediate counts); not touched, since w26 edits `flows.mjs` too. Worth a follow-up cycle.
- verify-all clean 10/10 was not obtained in this lane because of those unrelated flakes.
