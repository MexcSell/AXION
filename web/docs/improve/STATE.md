# Improvement loop state (resume from here)

Rewritten 2026-11-22T07:35Z, 17:50Z, and 2026-11-23T03:40Z by the controller; updated 06:05Z. Older lane lists are history in LOG.md.

## Clocks
- **30 h loop:** 2026-11-21T11:36:18Z → 2026-11-22T17:36:18Z (done).
- **Phase 2:** 2026-11-22T17:45Z → **2026-11-23T21:45Z**. Waves 5–7 are built. Schedule to the end:
  - **13:45Z:** no new lane starts.
  - **About 16:00Z:** last merge that touches `web/`. Then the final api-mobile, verify-all and fit (demo and api) on the frozen web tree.
  - **About 18:30Z:** last merge of any kind (server-only after 16:00Z).
  - **About 19:30Z:** final live update.
  - **Then:** final report (FINAL-REPORT-PHASE2.md, plus a published page) before 21:45Z.

## Branch and live
- Integration tree `/home/luca/AXION`, branch `improve-30h`, local only. Never push or move the tag without the owner.
- **Web dev 5190** serves the working tree. Restarted 2026-11-23T05:52Z with c74's polling watcher (`server.watch.usePolling`, 300 ms; H19); PID 714937 in /tmp/axion-5190.pid (the vite PID, not the setsid wrapper). After any merge touching `shared/`, curl a served contracts file.
- **API 5191** runs the real `axion` DB. Restarted 2026-11-23T02:22Z on 229536a (batches 14–30), from a clean tree; PID in /tmp/axion-5191.pid. **Skew:** the tree is at ebea695 (batches 31–37, no migration), so 5190 serves c72's skill UI against a 5191 without its routes until the next live update.
  - Schema version 53: 38 migration files, with 0036, 0038, 0041, 0042, 0049 and 0051 unused.
  - Backup `backups/axion-20261123T012236Z.dump`, restore check PASS. Previous backups: 20261122T174415Z (v39).
  - Audit anchor: 2 lines in `server/data/audit-anchors.jsonl` (git-ignored); chain and anchor OK. **The owner should copy the file off-host.**
- **Every live update:**
  1. Stop 5191 by its recorded PID or port.
  2. `npm run db:backup`, then `npm run db:restore-check`.
  3. `npm run migrate`.
  4. `npm run audit:verify`.
  5. Restart from a clean tree: `node --env-file=.env --import tsx src/main.ts >> data/api.log`, and record the PID.
  6. `npm run audit:anchor`, then `npm run audit:verify`.
  7. Check health directly and through 5190.

## Process
- PROCESS.md, LANES.md and QUEUE.md. Every lane goes brief → implementer → independent reviewer → fix round → re-review → QUEUE batch → integrator (`--no-ff`).
- `/home/luca/AXION-lanes/new-lane.sh <L> <branch> [base]`. After it runs, edit the lane `.env` to a reused e2e DB (LANES.md).
- `heavy.sh` has 6 slots plus slot 0, reserved for the integrator (`HEAVY_PRIORITY=1`).
- Ports 8790 and 9090 belong to other apps.

## Integration
- Merged through **batch 37** at ebea695 (2026-11-23 ~05:45Z), integrator #5 (stopped 05:51Z). Its three merge-time fixes were diff-checked by the controller: e206210 (c69 registry fixture lists task_owner_history.owner), 62d4d81 (c72's `classes[].adjusted.value` in RATING_FIELDS plus a RATED_LIST_ALLOWED entry for one agent's own cells, as c78 designed), 444edfc (c79 sweep sends `?with=` to the compare route). Gap: the sweep never sends an own `:id` with a foreign `?with=`; until a lane adds it, the report must not claim the compare route is isolation-tested on both ids.
- Verification on 229536a: verify-all 10/10, api-mobile 862 states 0 FAIL, stage6 ×20 20/20. On ebea695: full serial vitest 3414 passed / 36 skipped / 0 failed; fit and a11y both modes pass. **Not yet on ebea695:** full api-mobile, verify-all after the 5190 restart (running 05:52Z).
- Wave 8 is being planned (lanes w79+). Spawn integrator #6 when the first Wave 8 lane clears.

## Lanes now
| Lane | Cycle | Status |
|---|---|---|
| w70 | c72 difficulty-adjusted skill ratings (R3-7 + R3-1) | MERGED at ebea695 (batch 31, tip 6511c04) |
| w71 | c73 polish bundle (P2c, H18, P4c, H15) | MERGED at ebea695 (batch 32, tip 59b78cf) |
| w72 | c74 dev server watches shared (H19), e2e15 | MERGED at ebea695 (batch 33, tip 8d9a9c3) |
| w73 | c75 approval evidence tamper-evident (P3c), e2e17, no migration | MERGED at ebea695 (batch 34, tip af54328) |
| w74 | c76 Stage 8 records (R1, A1), e2e18, mig 0056 | CLEARED at dfd1bff, **PARKED (Q11): never queue** |
| w75 | c77 Stage 9 records (M2, G1), e2e2, mig 0057 | CLEARED at da75e62, **PARKED (Q11): never queue** |
| w76 | c78 test hygiene II (H21, H20, O1c), e2e3, tests only | MERGED at ebea695 (batch 35, tip 96ed66e) |
| w77 | c79 tenant-isolation suite (R4-4), e2e4, tests only | MERGED at ebea695 (batch 37, tip 6ee88cf) |
| w78 | c80 migration guard (R4-6), e2e5 | MERGED at ebea695 (batch 36, tip 909577e) |
| — | Final report draft (FINAL-REPORT-PHASE2.md) | draft committed; finalise at the end |

Every other Wave 5–7 lane (c53–c71) is MERGED and live (2026-11-23T02:22Z). Details are in QUEUE.md, MERGES.md and LOG.md.

**Parked, by design:**
- c62 (R2-7 signed receipts) waits for owner Q12.
- R3-3 (earned autonomy) waits for Q13.
- The gated Stage 8/9 items (R1, A1, M2, G1) wait for Q11. They are to be built as **unmerged branches** (CLEARED, with no QUEUE row and no live migration) for the owner to take or drop.

## Owner questions (for the final report)
- **Q1–Q12:** see LOG.md and PHASE2.md. Q11 covers the gated Stage 8/9 items; Q12 covers signing-key custody.
- **Q13:** may an autonomy level ever be a policy input?
- **Q14:** should there be a "read private company data" capability (Rule of Two flag b)?
- **Q15:** values for c64's cooldown and churn budget (off by default).
- **Q16:** keep the Needs-you tab's hidden header aside, or fold the header?

## Ids already taken
- **Dialog ids:** up to DL-100 in use. DL-96, 97, 98 (retired) and 99 are not in use.
- **Migrations:** files up to 0053 on improve-30h. 0054 (c72) and 0055 (c75) were reserved and are unused; 0056 and 0057 are used on the parked c76/c77 branches. c80's lint covers 0058+. The next free number is **0058**; Wave 8 lanes should add none.
