# c34 brief: staffing driver reads fresh state (code health · H8)

**Lane:** w32 (ports 8290 / 8291 / 8292–8293; e2e DB **axion_e2e6**). No migration.
**Source:** the c29 review. `useStaffingDriver` (web/src/features/mission/staffing.ts:12-21) iterates a `missions` array captured at render time. Between a store update and the React commit, a tick can advance a just-archived (or paused) mission, because `advance()`'s guard at staffing-plan.ts:97 checks the stale copy.

## Build (test-first)
1. First prove the risk. Make scripts/c29-archive-race.mjs (from c29; if it isn't on improve-30h yet, copy it from branch `c29-archive-flake`, with `git show c29-archive-flake:web/scripts/c29-archive-race.mjs`) **fail** against a deliberately bad build. For example, temporarily remove the archived guard, then confirm the script catches it; record that, then restore. If the script can't catch even that, strengthen it: assert, from a store subscription, that no mission ever changes after reaching archived, rather than only checking the final state.
2. Then try to make the real stale-closure window observable (CPU throttle 8×, archive at staggered phases of the tick, many runs). Record honestly whether it ever fires.
3. Fix: inside the tick, read the current missions from the store (`useStore.getState()` or equivalent) and re-check the status right before each advance. The same applies to pause/resume, and to any other status that should stop staffing.
4. Keep the diff minimal. Don't touch flows.mjs; H7 will.

## Pass threshold (fixed)
- The strengthened race check catches the known-bad mutation (RED), and passes on the fix: 20/20 at 8× throttle.
- Any unit test that exists for staffing-plan stays green; add one for "a tick never advances an archived or paused mission given a fresh store".
- web tsc; verify-all demo suite with no new FAIL (use your own OUT dir); api-flows passes.

## Report
`cycles/c34-report.md`.
