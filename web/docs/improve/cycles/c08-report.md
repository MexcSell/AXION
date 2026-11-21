# Cycle 8 report (lane w6): remove the flaky browser checks

## Root causes
1. **Agent Edit 409 flake (app bug, `web/src/api/agents.ts`).** `loadAgents()` returned early, applying nothing, when a newer
   load had started (`if (mine !== gen) return`). `updateAgent()` awaits `loadAgents()` after a 409 and the dialog then adopts
   `AGENT_BY_ID[id].rowVersion`. When another administrator's `agent.updated` event started a newer reload while the 409 reload
   was still in flight, the 409 reload resolved before anything was applied, the dialog adopted the stale rowVersion and the
   next Save answered 409 again. Fix: a superseded load now resolves only when the newest load has been applied
   (`return latest`, guarded for the sign-out `gen++` case). Three lines, no behaviour change otherwise.
2. **c01 proposal-expiry race (test, `api-improve.mjs`).** Any proposals-list read made by B's page after the DB expiry update
   expires P3 server-side and removes the card from the Pending filter before the Approve click. The old settle condition
   (no read in flight, twice, 300 ms apart) was a fixed sleep and could not see a read not yet issued. Now B's GETs of the list
   are held at the network (Playwright route gate) from before the expiry update until the Approve click is made, then released.
   Nothing can change B's DOM in between, so the check is deterministic. The assertion (server message stays on the card,
   card says Expired) is unchanged; one sleep was removed.
3. **flows.mjs "Hierarchy: click agent → conversation pane" (test).** Reproduced on the first run. The app does switch: polling
   showed the pane still on the previous agent at 1.1 s after the click and on Tester-01 at 1.5 s (AnimatePresence mode="wait":
   exit animation, then enter, on a loaded machine), while the check slept a fixed 500 ms and then counted immediately.
   Fixed in c25 (lane w23, 15f8d0b, same diagnosis and same kind of fix); I dropped my duplicate change to that step to avoid a merge conflict. My change keeps only the same condition wait for "Conversations: mission agents pane" (same fixed 500 ms sleep).
   The "v1 → v2 migration" step lives in `auth-flow.mjs`, not flows.mjs, and did not fail in my runs; not touched.
4. **Lane portability (test).** `api-improve.mjs` required the database name to be exactly `axion_e2e`; lane databases are
   `axion_e2eN`, so every lane run died at the expiry step. The pattern now accepts `axion_e2e\d*` (still never the real `axion`).

## Evidence
- RED: new `api-c08.mjs` (forces two overlapping catalog reloads with route interception, no timing luck) on the old
  `agents.ts`: 5/6, FAIL "the next Save succeeds with the newest version". GREEN on the fix: 6/6.
- `api-c08.mjs`: 20 consecutive runs, see the result line below.
- `api-improve.mjs`: before (old code, lane-db regex only) 0/10 failed unstressed (the race needs load); after the fix 0/20 failed.
- `flows.mjs`: first run of the day failed on the Hierarchy step (before); after the fix verify-all printed 46 PASS, 0 FAIL, plus
  10 further runs: 9 with 0 FAIL, but run 7 had 2 FAIL lines whose steps were not captured (the loop only counted them), so a flows flake remains unexplained. Raw: c08-evidence/w6-fl.txt (the 7th line is 2).
- `api-stage6.mjs`: NOT MEASURABLE here. On this base it fails every run at the known `page.reload` stall (line 235, 30 s
  timeout; lane w20 / c22), and the catch-all stops the script before the Edit/409 steps (lines 468-484). Baseline 0 of 3 runs
  reached those steps. They exercise the same code that `api-c08.mjs` now covers deterministically. Re-run stage6 after c22 merges.
- CPU-stress of the shared machine was not applied (a machine-wide load generator was refused); the new checks do not depend on load.

## Pass threshold
1. Reproduce before, 10 runs each: PARTIAL. api-improve 0/10 failed (the expiry race was never reproduced RED). api-stage6 could not be measured (every run stops at the reload stall). The 409 flake was reproduced only by the forced-order check api-c08.mjs (RED 5/6 on old code). flows.mjs Hierarchy failed on run 1.
2. 0 failures in 20 consecutive runs: api-improve PASS (20/20 rc=0, c08-evidence/w6-g-imp.summary); api-c08 PASS (20/20 rc=0, c08-evidence/w6-g-c08.summary); **api-stage6 NOT MET**: 0 runs reached the 409 steps because of the known page.reload stall (c22), so no stage6 runs count.
3. No assertion removed or loosened, no fixed sleeps added: PASS (one sleep removed from api-improve; in flows.mjs one 500 ms sleep replaced by a condition wait, the Conversations step; the Hierarchy step is left to c25).
4. verify-all green: PASS (46 PASS, 0 FAIL, before the revert of my Hierarchy change; not re-run on the final tree). Separate flows loop: 1 of 10 runs showed 2 FAILs, unidentified.

## Files
`web/src/api/agents.ts`, `web/scripts/api-improve.mjs`, `web/scripts/flows.mjs`, new `web/scripts/api-c08.mjs`.
`api-e2e.sh` runs Vite without the lane override config; I used an uncommitted local copy that adds it.

## Concerns
- stage6 Edit/409 steps remain unverified end to end until c22 fixes the reload stall.
- The `agents.ts` change touches the file lane w3 also edits (different function); merge should be trivial.
