# c34 report (lane w32): the staffing driver reads fresh state (code health H8)

## What changed
`useStaffingDriver` iterated the render-time `missions` array, so `advance()`'s archived/paused guard looked at a copy that can be one commit behind the store. The tick now re-reads each mission from the store right before its step.

- `web/src/features/mission/staffing-plan.ts`: new pure `tickStaffing(captured, fresh, update, now)`; for each captured mission it calls `fresh(id)`, then `advance(fresh)`. `advance()` is unchanged, so the guard covers archived, paused and every other stop status.
- `web/src/features/mission/staffing.ts`: the hook takes a third argument `fresh` and calls `tickStaffing`. (Importing the store here pulled `store/data` into the server's typecheck through a `data/types` cycle, so the store is passed in instead.)
- `web/src/components/layout/AppShell.tsx`: passes `freshMission` (`useData.getState().missions.find`).
- `web/scripts/c34-archive-race.mjs` (new, strengthened c29 check): a store subscription records EVERY change to a mission after it reached the stop status (`STOP=archived|paused`), plus a final-state check. Missions are stopped at i*450 ms phases, CPU throttled 8x, 14 missions per run.
- `server/test/c34-staffing-tick.test.ts` (new, 5 cases): fresh planning mission advances; archived and paused in the store never advance even with a stale captured copy; a missing mission is skipped; a later mission archived by an earlier update is skipped.
- `web/scripts/flows.mjs` untouched. No migration.

## RED / GREEN
- RED (known-bad mutation): removed the `paused`/`archived` guard in `advance()`. Race check: archived run reported 14/14 missions violating ("changed after archived"), paused run the same ("changed after paused"). Both exit 1. Guard restored afterwards. (The old c29 final-state check could not tell these apart reliably; the subscription check does.)
- RED (unit): the new test file failed 5/5 before `tickStaffing` existed.
- Real stale-closure window, on the unfixed code (guard intact): 1 archived run and 1 paused run at 8x, both 14/14 clean. I did not catch it firing; I could not make it observable, and I did not run a large batch on the unfixed code. The window is real in the code (the effect re-arms only after a commit) but React commits fast enough here that the tick has not landed in it. Treat the fix as a code-correctness hardening, not a reproduced bug.
- GREEN: archived 20/20 clean at 8x throttle (14 missions each); paused 5/5 clean. Unit: `staffing.test.ts` + new test 9/9.

## Pass threshold
- Strengthened check catches the bad mutation (RED) and passes on the fix, 20/20 at 8x: PASS.
- Existing staffing-plan unit tests green; new test for archived/paused given a fresh store: PASS.
- web tsc clean; server tsc clean: PASS.
- verify-all (own OUT /tmp/axion-verify-w32): ALL 10 STEPS PASSED, 0 FAIL lines. api-flows: 23/23 passed, no page errors: PASS.

## Concerns
- The real window was never observed firing, so GREEN shows no regression, not a cured live bug.
- Demo mode only: in api mode the server runs staffing and this driver is not the writer.
- Hook signature gained a parameter; AppShell is its only caller.
