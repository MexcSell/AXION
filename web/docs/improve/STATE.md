# Improvement loop state (resume from here)

Rewritten 2026-11-22T07:35Z by the controller. The old w2–w18 lane list is history; see LOG.md.

## Clocks
- **30 h loop:** 2026-11-21T11:36:18Z → 2026-11-22T17:36:18Z.
- **Phase 2 (owner 2026-11-22 ~00:50Z, 28 h, PHASE2.md):** the clock starts when the current integration queue (batches 7–9) is merged. Write the start and end times here at that moment. Phase 2 lanes were started early by controller decision, because integration is serial.

## Branch and live
- Integration tree `/home/luca/AXION`, branch `improve-30h`, local only. Never push or move the tag without the owner.
- Live: web dev 5190 serves the working tree. API 5191 runs the real `axion` DB, last restarted on a67d2dd with migrations 1–13 and 15. A live update is due after batches 7–9:
  1. stop 5191;
  2. back up and run the restore check;
  3. migrate (0026 backfill takes ACCESS EXCLUSIVE);
  4. `npm run audit:verify`;
  5. restart only from a clean tree.

## Process
- PROCESS.md, LANES.md and QUEUE.md. Every lane goes brief → implementer → independent reviewer → fix round → re-review → QUEUE batch → integrator (`--no-ff`).
- `/home/luca/AXION-lanes/new-lane.sh <L> <branch> [base]`. After it runs, edit the lane `.env` to a reused e2e DB (LANES.md).
- `heavy.sh` has 6 slots plus slot 0, reserved for the integrator (`HEAVY_PRIORITY=1`).
- Ports 8790 and 9090 belong to other apps.

## Integration queue (integrator #3 working through it)
- Merged up to c17 (batch 6, c068a6d).
- Next:
  - batch 7: c32 → c31 → c30;
  - batch 8: c36 → c37 → c33 → c35 (plus the required scale-bench digest_version=2 follow-up) → c34;
  - batch 9: c39 → c38 → c42 → c41 → c40, when cleared.
- c43 goes after c34 once it clears review. Required follow-ups: fold c34-archive-race into c29-archive-race, and run the batch 8–9 api scripts plus a 4× flows run on the merged tree, because its Modal focus change touches every dialog.

## Lanes in flight
| Lane | Cycle | Status |
|---|---|---|
| w38 | c40 mobile debt | implementer running |
| w42 | c43 flows hardening (H7) | reported at 281ccb1; reviewer running (writes cycles/c43-review.md) |
| w43 | c44 page/store perf (Wave 4) | implementer running; DB e2e16; ports 9390–93 |
| w44 | c45 job leases J1 (Wave 4, records only) | implementer running; DB e2e17; ports 9490–93; migration 0035 |
| (w45) | c46 six-dimension scorecard M1 | brief written; **start after batch 9 merges**; DB e2e18; ports 9590–93; migration 0036 if needed |

## Next after that
- H9 contract-test refresh, after batch 8.
- Backlog follow-ups on their merged bases: E1b, P3a, P3b, P4a, P4b, P5b, O2a, O3a, H8.
- Gated Wave 4 items (R1, A1, M2, G1) run last as their own droppable batch (Q11).

## Owner questions
Q1–Q11 are queued for the final report (PHASE2.md, LOG.md).

## Ids already taken
- **Dialog ids:** up to DL-95. DL-96–97 are reserved for c45 and DL-98–99 for c46.
- **Migrations:** up to 0034, with 0035 reserved for c45 and 0036 for c46.
