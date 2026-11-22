# Improvement loop state (resume from here)

Rewritten 2026-11-22T07:35Z by the controller and again at 17:50Z after the live update. The old w2–w18 lane list is history; see LOG.md.

## Clocks
- **30 h loop:** 2026-11-21T11:36:18Z → 2026-11-22T17:36:18Z. The last batch (13) was still being verified at 17:36Z; its log commit ed3ed73 landed at 17:43Z.
- **Phase 2 (owner 2026-11-22 ~00:50Z, 28 h, PHASE2.md): 2026-11-22T17:45Z → 2026-11-23T21:45Z.** Started when the integration queue (batches 7–13) was merged and the live update was done. Waves 1–4 (ungated) were built early, in lanes, during the 30 h loop. Phase 2 proper starts with Wave 5.

## Branch and live
- Integration tree `/home/luca/AXION`, branch `improve-30h`, local only. Never push or move the tag without the owner.
- **Web dev 5190** serves the working tree. Restarted 2026-11-22 at about 16:08Z after a stale watcher; PID in /tmp/axion-5190.pid.
- **API 5191** runs the real `axion` DB. **Restarted 2026-11-22T17:44Z on ed3ed73** from a clean tree; PID in /tmp/axion-5191.pid.
  - Schema version 39 (all 28 migration files applied).
  - Backup `backups/axion-20261122T174415Z.dump`; restore check PASS.
  - The live DB holds 1 tenant and 1 audit row.
- **Audit anchor (c49):** settings are in the live server/.env (mode 600; the key is never printed). The first anchor is written: t-1 through seq 1, in `server/data/audit-anchors.jsonl` (git-ignored). `audit:verify`: chain OK, anchor OK. **The owner should copy the anchor file off-host.**
- **Every later live update follows these steps:**
  1. Stop 5191 by port.
  2. `npm run db:backup`, then `npm run db:restore-check`.
  3. `npm run migrate`.
  4. Restart from a clean tree: `node --env-file=.env --import tsx src/main.ts >> data/api.log`.
  5. `npm run audit:anchor`.
  6. `npm run audit:verify`.

## Process
- PROCESS.md, LANES.md and QUEUE.md. Every lane goes brief → implementer → independent reviewer → fix round → re-review → QUEUE batch → integrator (`--no-ff`).
- `/home/luca/AXION-lanes/new-lane.sh <L> <branch> [base]`. After it runs, edit the lane `.env` to a reused e2e DB (LANES.md).
- `heavy.sh` has 6 slots plus slot 0, reserved for the integrator (`HEAVY_PRIORITY=1`).
- Ports 8790 and 9090 belong to other apps.

## Integration queue
- Everything is merged through batch 13 (HEAD ed3ed73):
  - c44, c45, c48, c47, c49, c40, c46, c50, c52, c51;
  - the c46 clock fix f5e2d01.
- Integrator #4 is finished. Full server suite 2114/2114, 3 of 3 runs. Merge details are in MERGES.md.

## Lanes (all merged; the table is history from here)
| Lane | Cycle | Status |
|---|---|---|
| w38 | c40 mobile debt | MERGED (6c5a922) |
| w42 | c43 flows hardening (H7) | MERGED (2aba0a0, 09dd6cb) |
| w43 | c44 page/store perf | MERGED (b80c2d1, partial) |
| w44 | c45 job leases J1 | MERGED (8798e82) |
| w45 | c46 six-dimension scorecard M1 | MERGED (feb5f96, clock fix f5e2d01) |
| w46 | c47 E1b eval evidence | MERGED (94806cf) |
| w47 | c48 P3a approvals UI | MERGED (8274a8d) |
| w48 | c49 P5b audit anchor | MERGED (af6bed5) |
| w49 | c50 H9 contract coverage | MERGED (5002d01, registry 1abeca3) |
| w50 | c51 O3a+O2a review hardening (migration 0039) | MERGED (86a634b) |
| w51 | c52 H10 merge minors | MERGED (a33ae82) |

## Wave 5 in flight (dispatched about 17:55Z from bfe891e; PHASE2.md, Wave 5)
| Lane | Cycle | Status |
|---|---|---|
| w52 | c53 eval-run integrity (E1c), e2e18, mig 0040 | fix round (review CLEAR AFTER FIXES) |
| w53 | c54 clock bounds + dimensions follow-ups (H11, M1b, M1c), e2e2, mig 0041 if needed | implementing |
| w54 | c55 thread follow-ups (P2b), e2e3 | implementing |
| w55 | c56 public suffix list (P4b), e2e4 (no migration) | CLEARED at 3480bff, batch 14 |
| w56 | c57 test hygiene (H12, H13), e2e15 | implementing |
| — | Research round 2: research-r2.md plus research-r2-verified.md (22 CONFIRMED, 4 CORRECTED; R2-4 dropped) | done |
| w57 | c58 Rule-of-Two profile + approval quality (R2-6, R2-9), e2e16, mig 0043, DL-100 | implementing (Wave 6) |
| w58 | c59 origin-bound memory and skill records (R2-5), e2e17, mig 0044 | implementing (Wave 6) |
| w59 | c60 failure attribution + OTel mapping (R2-10, R2-8), e2e14, mig 0045 | implementing (Wave 6) |
| — | Integrator #5: verification pass on the merged tree | running |

Waiting: c61 (R2-1, R2-2, R2-3) after c53 merges; c62 (R2-7) after owner Q12. No new lane starts after 2026-11-23T13:45Z. The gated Wave 4 items (R1, A1, M2, G1) still run last, as their own droppable batch (Q11).

## Owner questions
Q1–Q11 are queued for the final report (PHASE2.md, LOG.md).

## Ids already taken
- **Dialog ids:** up to DL-98 in use. DL-96, DL-97 and DL-99 were reserved but are unused.
- **Migrations:** files up to 0039. 0036 and 0038 are unused.
