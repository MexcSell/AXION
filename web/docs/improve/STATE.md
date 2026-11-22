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
  - batches 7, 8 and 8b (c43) MERGED (tip 09dd6cb; events lock schema-scoped 9e958f3; live 5190 Vite restarted ~09:16Z after a stale watcher);
  - batch 9: c39, c38, locks fix 4eca9db, c42, c41 MERGED (7a139d8); c40 after its fix round;
  - batch 11: c48 → c47 → c49 (all CLEARED);
  - batch 12: c50 (CLEARED; registry follow-up for batch 10–11 routes);
  - batch 10: c44 → c45.

## Lanes in flight
| Lane | Cycle | Status |
|---|---|---|
| w38 | c40 mobile debt | CLEARED at db34c42, batch 11b |
| w42 | c43 flows hardening (H7) | MERGED (2aba0a0, 09dd6cb) |
| w43 | c44 page/store perf | CLEARED-AS-PARTIAL at 0abda0c, queued batch 10 |
| w44 | c45 job leases J1 | CLEARED at 17b6390, queued batch 10 |
| w45 | c46 six-dimension scorecard M1 | implementer running from 7a139d8; e2e18; 9590–93 |
| w46 | c47 E1b eval evidence | CLEARED at 15b1bd2, batch 11 |
| w47 | c48 P3a approvals UI | CLEARED at d29339a, batch 11 |
| w48 | c49 P5b audit anchor | CLEARED at 7b17bf6, batch 11 |

## Next after that
- H9 contract-test refresh, after batch 8.
- Backlog follow-ups: E1b, P3a, P5b running (c47–c49). Still open: P2b, P3b (needs Q9), P4a, P4b, P5c, O2a, O3a (after c38).
- Gated Wave 4 items (R1, A1, M2, G1) run last as their own droppable batch (Q11).

## Owner questions
Q1–Q11 are queued for the final report (PHASE2.md, LOG.md).

## Ids already taken
- **Dialog ids:** up to DL-95. DL-96–97 are reserved for c45 and DL-98–99 for c46.
- **Migrations:** up to 0034, with 0035 reserved for c45 and 0036 for c46.
