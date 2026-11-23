# Improvement loop state (resume from here)

Rewritten 2026-11-23 ~12:50Z by the controller. History is in LOG.md, MERGES.md and QUEUE.md.

## Clocks
- **30 h loop:** 2026-11-21T11:36Z → 2026-11-22T17:36Z (done).
- **Phase 2:** 2026-11-22T17:45Z → **2026-11-23T21:45Z**.
- **Report page:** https://claude.ai/artifact/UWyW4kzgxFwMWGmoyA5S9P (private; republish the same file path after the final update; source scratchpad/axion-report/axion-phase2-report.html).
- **Remaining schedule:**
  - **13:45Z:** no new lane starts.
  - **About 18:30Z:** the last merge. Everything still open is server-only; the web tree has been frozen since batch 50.
  - **About 19:30Z:** the final live update, then republish the report page before 21:45Z.

## Branch and live
- **Integration tree:** `/home/luca/AXION`, branch `improve-30h`, local only. Never push or move the tag without the owner.
- **Web dev 5190:** serves the working tree. It uses a polling watcher (c74). PID 714937 is in /tmp/axion-5190.pid.
- **API 5191:** runs the real `axion` DB.
  - Live update 2026-11-23T12:22Z, to 98fecbf (batches through 54).
  - Schema 59, with no new migration since 07:34Z.
  - Backup `backups/axion-20261123T122135Z.dump`; restore check PASS.
  - PID 2550058 is in /tmp/axion-5191.pid.
  - Audit anchor: **5 lines** in `server/data/audit-anchors.jsonl` (git-ignored). The owner must copy the file and `AUDIT_ANCHOR_KEY` off-host.
- **Live-update procedure:**
  1. Stop 5191 by PID.
  2. `npm run db:backup`, then `db:restore-check`.
  3. `migrate`.
  4. `audit:verify`.
  5. Restart from a clean tree: `node --env-file=.env --import tsx src/main.ts >> data/api.log`, and record the PID.
  6. `audit:anchor`, then `audit:verify`.
  7. Health direct and via 5190.

## Integration
- **Merged:** through batch 54. The final tree is 98fecbf plus docs.
- **Final checks on the frozen web tree:**
  - full serial vitest: 4409 passed, 0 failed;
  - verify-all: 10/10;
  - fit: ALL FIT ×4;
  - a11y: 0 violations;
  - api-c14 under strict CSP: 31/31;
  - api-mobile: NO FAILURES.
- **Open at 12:50Z:** web tsc fails on HEAD, because `shared/contracts/src/exec-profile.ts` imports node:crypto (c94). Integrator #6 is fixing it as `fix(c94 merge)`. The build and CSP checks pass meanwhile.
- **Integrator #6** is active. MERGES.md and QUEUE.md are the hand-off.

## Lanes now
| Lane | Cycle | Status |
|---|---|---|
| w74 | c76 Stage 8 records (mig 0056) | CLEARED at dfd1bff, **PARKED (Q11)**: never queue |
| w75 | c77 Stage 9 records (mig 0057) | CLEARED at da75e62, **PARKED (Q11)**: never queue |
| w96 | c98 test-infra follow-ups (H14c, M2c) | CLEARED at 19e0592, batch 55 |
| w97 | c99 execution-module hardening (X1, c97 detector gaps) | planned ~12:55Z |

Every other lane, w19–w95 (c01–c97), is merged. Each cycle's brief, report and review is in cycles/.

## Owner questions
Q1–Q18 are listed in FINAL-REPORT-PHASE2.md §9:
- Q17: the scope of change plans;
- Q18: phone tab strips, scroll or icon-collapse.
Round 6's approval points O1–O5 are in §12.

## Ids already taken
- **Dialog ids:** up to **DL-101** (c89 forecasts dialog).
- **Migrations:** files up to **0059** on improve-30h. 0056 and 0057 exist only on the parked branches. The next free number is **0060**. The last wave adds none.
- **Lanes:** w97 is the last. The e2e DBs are reused, per LANES.md.
