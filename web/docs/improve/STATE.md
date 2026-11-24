# Improvement loop state (resume from here)

Rewritten 2026-11-24 ~01:05Z by the controller. **Phase 2 is closed.** History is in LOG.md, MERGES.md and QUEUE.md.

## Clocks
- **30 h loop:** 2026-11-21T11:36Z → 2026-11-22T17:36Z (done).
- **Phase 2:** 2026-11-22T17:45Z → 2026-11-23T21:45Z (done).
  - The loop stalled after batch 55, at about 13:00Z on 2026-11-23.
  - The close-out ran on 2026-11-24, at the owner's request: the c99 review and merge, the final live update, the docs and the report page.
- **Report page:** https://claude.ai/artifact/UWyW4kzgxFwMWGmoyA5S9P (private). It was republished on 2026-11-24 with the final numbers. Its source is `axion-report/axion-phase2-report.html` in the close-out session's scratchpad.

## Branch and live
- **Integration tree:** `/home/luca/AXION`, branch `improve-30h`. On 2026-11-24 the owner approved: `main` was fast-forwarded to it, pushed to `origin`, and tagged `release_1.1.0`. Any further push or tag still needs the owner.
- **Web dev 5190:** serves the working tree, with a polling watcher. PID 714937, in /tmp/axion-5190.pid.
- **API 5191:** runs the real `axion` DB.
  - Final live update 2026-11-24 ~04:49Z, batches through 58 (c76 and c77 taken by the owner).
  - Schema 59, with 0056 and 0057 now applied too (the migrator applies any missing version).
  - Backup `backups/axion-20261124T044814Z.dump`; restore check PASS.
  - PID 3818198 (own session, started with setsid), in /tmp/axion-5191.pid.
  - Health: `GET /api/v1/health`.
  - Audit anchor: **7 lines** in `server/data/audit-anchors.jsonl` (git-ignored). The owner must copy the file and `AUDIT_ANCHOR_KEY` off-host.
- **Live-update procedure:**
  1. Stop 5191 by PID.
  2. `npm run db:backup`, then `db:restore-check`.
  3. `migrate`.
  4. `audit:verify`.
  5. Restart from a clean tree, detached: `setsid nohup node --env-file=.env --import tsx src/main.ts >> data/api.log 2>&1 < /dev/null &`, and record the PID (from `ss -ltnpH "sport = :5191"`).
  6. `audit:anchor`, then `audit:verify`.
  7. Health direct and via 5190.

## Integration
- **Merged:** through batch 58 (c76, c77 after c99).
- **Final checks:**
  - full serial vitest with batches 1–58: 4587 passed, 36 skipped, 0 failed (201 files + 1 skipped);
  - server tsc and web tsc exit 0.
  - The browser checks are from the frozen web tree (verify-all 10/10, fit ALL FIT ×4, a11y 0, api-c14 31/31, api-mobile NO FAILURES). No `web/` source changed since then.

## Lanes
| Lane | Cycle | Status |
|---|---|---|
None open. Every lane, w19–w97 (c01–c99), is merged; c76 and c77 (w74, w75) were taken by the owner on 2026-11-24 as batches 57 and 58. Each cycle's brief, report and review is in cycles/. The stray branch `c99-backup` (an earlier c99 history with a report draft) is superseded and was not merged.

## Waiting for the owner
Answered on 2026-11-24 (FINAL-REPORT §9, "Your answers"): Q1–Q18 defaults confirmed, Q11 taken, O1–O5 approved as the plan (each concrete item still comes to the owner; Phase A not started). Still open:
- Q8, the hand check with a screen reader;
- copying `/root/axion-offhost-20261124.tar.gz` (anchor file, 7 lines, plus key) off-host, then deleting it from the server.

## Ids already taken
- **Dialog ids:** up to **DL-101**.
- **Migrations:** files up to **0059**, all applied live. The next free number is **0060**.
- **Lanes:** up to w97.
