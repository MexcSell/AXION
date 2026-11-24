# Improvement loop state (resume from here)

Rewritten 2026-11-24 ~01:05Z by the controller. **Phase 2 is closed.** History is in LOG.md, MERGES.md and QUEUE.md.

## Clocks
- **30 h loop:** 2026-11-21T11:36Z → 2026-11-22T17:36Z (done).
- **Phase 2:** 2026-11-22T17:45Z → 2026-11-23T21:45Z (done).
  - The loop stalled after batch 55, at about 13:00Z on 2026-11-23.
  - The close-out ran on 2026-11-24, at the owner's request: the c99 review and merge, the final live update, the docs and the report page.
- **Report page:** https://claude.ai/artifact/UWyW4kzgxFwMWGmoyA5S9P (private). It was republished on 2026-11-24 with the final numbers. Its source is `axion-report/axion-phase2-report.html` in the close-out session's scratchpad.

## Branch and live
- **Integration tree:** `/home/luca/AXION`, branch `improve-30h`, local only. Never push, merge to `main` or move the tag without the owner.
- **Web dev 5190:** serves the working tree, with a polling watcher. PID 714937, in /tmp/axion-5190.pid.
- **API 5191:** runs the real `axion` DB.
  - Final live update 2026-11-24 ~01:02Z, to b598113 (batches through 56).
  - Schema 59, no new migration.
  - Backup `backups/axion-20261124T010230Z.dump`; restore check PASS.
  - PID 3577265, in /tmp/axion-5191.pid.
  - Health: `GET /api/v1/health`.
  - Audit anchor: **6 lines** in `server/data/audit-anchors.jsonl` (git-ignored). The owner must copy the file and `AUDIT_ANCHOR_KEY` off-host.
- **Live-update procedure:**
  1. Stop 5191 by PID.
  2. `npm run db:backup`, then `db:restore-check`.
  3. `migrate`.
  4. `audit:verify`.
  5. Restart from a clean tree, detached: `setsid nohup node --env-file=.env --import tsx src/main.ts >> data/api.log 2>&1 < /dev/null &`, and record the PID (from `ss -ltnpH "sport = :5191"`).
  6. `audit:anchor`, then `audit:verify`.
  7. Health direct and via 5190.

## Integration
- **Merged:** through batch 56 (c99). The final tree is b598113 plus docs.
- **Final checks:**
  - full serial vitest on b598113: 4489 passed, 36 skipped, 0 failed (196 files + 1 skipped);
  - server tsc and web tsc exit 0.
  - The browser checks are from the frozen web tree (verify-all 10/10, fit ALL FIT ×4, a11y 0, api-c14 31/31, api-mobile NO FAILURES). No `web/` source changed since then.

## Lanes
| Lane | Cycle | Status |
|---|---|---|
| w74 | c76 Stage 8 records (mig 0056) | CLEARED at dfd1bff, **PARKED (Q11)**: owner decision |
| w75 | c77 Stage 9 records (mig 0057) | CLEARED at da75e62, **PARKED (Q11)**: owner decision |

Every other lane, w19–w97 (c01–c99), is merged. Each cycle's brief, report and review is in cycles/. The stray branch `c99-backup` (an earlier c99 history with a report draft) is superseded and was not merged.

## Waiting for the owner
FINAL-REPORT-PHASE2.md §8–§9 and §12 list:
- Q1–Q18 and the approval points O1–O5;
- the parked branches c76 and c77 (Q11). Their migrations 0056/0057 sit below live schema 59, so taking them means a migration on the real DB;
- what to do with `improve-30h`: push it, merge it to `main`, tag it, or leave it;
- copying the audit anchor file and key off-host.

## Ids already taken
- **Dialog ids:** up to **DL-101**.
- **Migrations:** files up to **0059** on improve-30h. 0056 and 0057 exist only on the parked branches. The next free number is **0060**.
- **Lanes:** up to w97.
