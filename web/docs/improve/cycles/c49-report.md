# c49 report: an audit-chain anchor outside the database (P5b)

Branch c49-audit-anchor (lane w48). No migration was needed (0038 unused).

## What was built
- `server/src/audit-anchor.ts`: `writeAnchor` (one repeatable-read snapshot of every tenant head, HMAC-SHA256 signed JSON lines, fsync, mode 600, lock file against concurrent writers) and `verifyAnchors` (per tenant: ok, truncated, rewritten, bad_signature, anchor_missing, rolled_back). Key from `AUDIT_ANCHOR_KEY` (env only), fails closed under 32 bytes. File: `AUDIT_ANCHOR_FILE` or `server/data/audit-anchors.jsonl` (already git-ignored).
- Each line carries a file counter `n` and `batch/i/of`, so a removed first or middle line, a half-removed last checkpoint and a replayed older line are all visible.
- `writeAnchor` refuses (exit 1) to sign a tenant whose chain does not verify, and to extend an anchor file that does not verify.
- CLI: `npm run audit:anchor`; `npm run audit:verify` also verifies anchors and exits 1 on any non-ok result (no key or no file reports anchor_missing, exit 1). No timer in the API.
- Ops: `GET /operations/anchors` (admin, own tenant only, 12/min per session; no key, path or hash returned) and an "Audit anchor" tile with `?` help on System Operations > Services.
- Docs: `server/docs/audit-anchor.md` (runbook, statuses, limits, live setup). `.env.example` lists the two variables.

## Pass threshold
| item | result | evidence |
|---|---|---|
| delete newest N rows -> truncated | PASS | test "deleting the newest N rows is truncated" (trigger disabled in the scratch schema; also asserts plain verifyChain still says ok). The purge_demo path cannot delete audit rows (no exception on that trigger), a test proves the delete is refused and the anchor stays ok |
| full rehash with recomputed hashes -> rewritten | PASS | test "a full rehash ... is rewritten" (verifyChain ok, anchor rewritten); also rewrite of an older anchored row after a later anchor |
| edited anchor-file line -> bad_signature | PASS | three tests (seq edit, hash edit, flipped signature, garbage, wrong key) |
| delete file's last line after a later write -> rolled_back | PASS with a stated limit | caught when the last checkpoint is multi-tenant (batch has fewer lines than `of`), when a first/middle line is removed (counter gap) and when an old line is replayed. NOT detectable: deleting the whole final checkpoint of a single-tenant file (one line); a test pins that as `ok` with the older anchor, and the docs say so |
| no key -> anchor_missing, CLI non-zero | PASS | verify test plus CLI tests (`audit:verify` exit 1, `audit:anchor` exit 1 and writes nothing) |
| >= 25 tests | PASS | 49 in `server/test/audit-anchor.test.ts` |
| full vitest, tsc, verify-all 10/10 | PASS | vitest 50 files / 1485 tests pass (final run); tsc clean; verify-all "ALL 10 STEPS PASSED". An earlier full run had one failure (`instances.test.ts` skills PATCH returned 500 under machine load); it passed alone and in the final full run, and is unrelated to this change |
| grep test: key never in a log line or response | PASS | tests: only 4 src files mention the key; no console/log/reply line in the anchor files mentions it; the CLI output on success and refusal never contains it; the ops response contains no key, no path and no 64-hex string |
| `web/scripts/api-c49.mjs` admin sees status, member 403, 1366x768 fit | PASS | 14/14 checks: not verifiable before a checkpoint, `?` help opens, CLI writes, tile Matches, truncated after a tail delete, member 403, no key/path/hash in the response, audit:verify exit 0 then 1, anchor refuses to extend tampered state. Fit at 1366x768: document 768/768, no horizontal overflow, tile fully visible. The Services page below the tiles scrolls inside `main` (pre-existing: the systemd services panel is below the fold); the added tile does not push anything off a fixed viewport beyond that |

## RED / GREEN
The module and tests were written together, so there was no separate red-first run. RED is shown by mutation of `audit-anchor.ts`:
- hash comparison disabled: 2 tests FAIL (rehash -> rewritten, older-row rewrite);
- missing-row check disabled: 6 tests FAIL (all truncated cases, CLI, ops route).
Restored: 49/49 pass. One more RED/GREEN cycle happened in the harness: shared-schema tests initially failed because an earlier tampered tenant blocked anchoring (by design), so each test now gets its own scratch schema; and an ambient `AUDIT_ANCHOR_KEY` from `.env` made the no-key tests hermetic-unsafe, so they pass `key: ''`.

## P5c: events-lock hold measurement (one-off, no behaviour change)
`server/scripts/events-lock-hold.ts` (own lane DB only; times from lock granted to commit returned, per transaction, by wrapping the client). Load: 600 mission creations at concurrency 12 through the real app (4,658 events-lock transactions including staffing-simulation and audit writes), 65 writes/s, 0 failures, on a shared and busy machine.
- HOLD (granted -> commit): p50 2.11 ms, p95 3.82, p99 4.72, MAX 14.79 ms.
- WAIT (the lock query, i.e. queueing): p50 19.9 ms, p95 30.4, p99 34.9, MAX 49.8 ms.
Conclusion: holds are short (a few ms, max about 15 ms); queueing, not hold length, is what writers feel at 12-way concurrency, and it stays far under the 5 s lock_timeout. The DB was small (not the 50k-event scale-bench dataset, which does not write); the lock queries are index-bound, so hold should not grow with table size, but that is not measured here.

## Files changed
server/src/audit-anchor.ts, server/src/cli/audit-anchor.ts, server/src/cli/audit-verify.ts, server/src/config.ts, server/src/ops/routes.ts, server/package.json, server/.env.example, server/docs/audit-anchor.md, server/test/audit-anchor.test.ts, server/scripts/events-lock-hold.ts, web/src/features/ops/ServerHealth.tsx, web/src/help/pages/stage5.ts, web/scripts/api-c49.mjs, web/docs/screenshots/improve-c49-anchor-ok.png, web/docs/screenshots/improve-c49-anchor-truncated.png, this report.
The lane `server/.env` (git-ignored, mode 600) holds a generated test key and `AUDIT_ANCHOR_FILE=/tmp/axion-w48-anchors.jsonl`. `/home/luca/AXION/server/.env` was not touched.

## Concerns
- One broken tenant chain blocks `audit:anchor` for every tenant (intentional: never sign a broken state; the operator investigates first). After a restore from an older backup, verify reports truncated and anchoring stays refused until the operator archives the old file.
- The anchor file on the same host as the database is only as strong as the key's separation; copy it off-host (documented).
- scale-guard maps lane N to axion_e2eN, which does not fit reused lanes (w48 uses axion_e2e4), so the new probe has its own lane-worktree + axion_e2e<N> check instead of loosening the guard.
- The live update needs `AUDIT_ANCHOR_KEY` added to the live `server/.env` by the controller, then `npm run audit:anchor`.
