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

## Fix round (after the c49 security review, PASS-WITH-FIXES)
Each item was written test-first. RED: with the pre-fix `src/audit-anchor.ts` and both CLIs restored from the previous commit, `audit-anchor.test.ts` failed 16 tests (P5, F1, F2 x2, F3 x3, P1 lock-first, P2 x3, rotate x2, stale-lock message, last-line output, CLI copy-off-host line). GREEN: the same file now passes 66/66. The P1 race test and the F8 guard test do not fail on the old code by construction (the race window is small; the guard is a new file), so those two are proven differently, see below.

| item | change | proof |
|---|---|---|
| F8 (medium) | `server/scripts/lane-db-guard.ts` `assertLaneWipe`: the target URL must equal, in full, `E2E_DATABASE_URL` in THIS worktree's `server/.env` (the file); host must be 127.0.0.1; the name must match `axion_e2e<N>` (so `axion`, `axion_test` and the like are refused); `CONFIRM_WIPE=<dbname>` is required before any `migrate down`. `events-lock-hold.ts` calls it before it connects. | test "F8: the lane guard refuses ..." (another lane's DB incl. a prefix-similar one, non-e2e names, remote host, a different password, missing/wrong confirmation, missing .env). Dry runs (no DB touched): other lane's DB with its own confirm -> "not this worktree's own E2E_DATABASE_URL"; own DB without confirm -> "set CONFIRM_WIPE=axion_e2e4"; the real `axion` -> "only axion_e2e<N> databases may be wiped" |
| F1 | `sameSig` requires `^[0-9a-f]{64}$` on both sides | test: sig + junk, upper case and truncated sig are all `bad_signature`; the original still `ok` |
| F2 | `verifyAnchors` inspects the path first and wraps the read; a directory or unreadable file gives `ok:false`, `configured:true`, a reason and per-tenant status `unreadable`. `audit:verify` now ends the pool and exits 1 in a try/finally | tests for verify, the route (200 ok:false, not 500) and the CLI (exit 1, no stack, `UNREADABLE`) |
| F3 | `lstat`: a symlink gives `insecure_file` (verify) and a refusal (write, rotate); a file writable by group or others gives `insecure_file` with "chmod 600" advice; the writer opens with `O_NOFOLLOW`, creates 0600 | tests: symlink (target untouched), dangling symlink (target not created), 0666 and 0620 refused, 0600 and 0644 fine |
| P1 | `writeAnchor` takes `<file>.lock` first; the existing-file verification, the chain verification and the head snapshot all happen inside it | test: with the lock held, a database whose every property access throws is never touched (the old code queried first); plus a six-writer race with growing chains yields non-decreasing seqs and `ok` |
| P2 | the MAC covers a deployment id: `AUDIT_ANCHOR_DOMAIN` if set, else `axion-audit-anchor-v1:<database>:<schema>`. Chosen so existing setups need no new variable; documented that production should set it explicitly so a restore into a differently named database still verifies | tests: other domain and other schema give `bad_signature` |
| P5 | keys with fewer than 8 distinct bytes are refused. NOT 16 as asked: a hex key (`openssl rand -hex 32`, the documented way) has only 16 symbols and a random one often has 14 or 15, so a 16 floor rejected valid keys (my first run did exactly that and failed 47 tests). 8 still refuses repeated characters and short patterns | test: 200 random hex keys accepted; `a`x32, `ab`x16, `0123`x16, 7-symbol pattern refused |
| Runbook | `server/docs/audit-anchor.md`: Stale lock (check no process, then remove), Recovery (copy evidence, investigate, then `npm run audit:anchor -- --rotate`, which renames to `<file>.<timestamp>.bad`, never deletes, and writes an `audit.anchor.rotated` event naming the archive into every tenant's chain), F6 wording fixed in the doc and the source header (a missing or empty file IS reported; what is undetectable is dropping the final checkpoint, or someone with the key recreating a full file), new statuses, domain and key notes. `audit:anchor` prints `copy off-host: line N sig <12 hex>` | tests for rotate (archive kept, event on the chain, chain still verifies, new file starts at n=1), the stale-lock message and the printed line |
| P6 | help text now says "Matches" is a hash comparison at the anchored positions, not a full content check | `check-help` passes |
| api-c49 | exits 2 with a clear message unless `BASE`, `E2E_API_PORT` and `E2E_WEB_PORT` are set; the 5193 default is gone | bare run printed the message, exit 2 |

Not done: P3 (cache by mtime / global limiter) and P4 (genericise reasons) were optional and are left as is.

Re-run after the fixes: server tsc and web tsc clean; full vitest 50 files, 1502 tests pass; `audit-anchor.test.ts` 66/66; `api-c49` via `api-e2e.sh` 14/14 with no page errors; verify-all result below.
verify-all after the fixes: ALL 10 STEPS PASSED.

### Re-review follow-ups (last round)
Test-first. RED: with the previous source restored, 10 of the new tests failed (required domain, every rotate rule, the CLI rotate, the guard's query-string rule); GREEN: `audit-anchor.test.ts` 76/76 (two more route tests added after the RED run), full vitest 50 files / 1514 tests expected from the final run below.

| item | change |
|---|---|
| R1 | `lane-db-guard` refuses any target URL with a query string or fragment (`?host=` is honoured by pg). Tested for `?host=`, `?sslmode=` and `#frag`, even when the same string is in the lane `.env`. |
| P2 | `AUDIT_ANCHOR_DOMAIN` is required, no default. Without it `verifyAnchors` returns `anchor_missing` with the reason "AUDIT_ANCHOR_DOMAIN is not set", `writeAnchor` and rotate refuse, the CLIs exit 1, and the ops route says not verifiable. Documented in `server/docs/audit-anchor.md` and `server/.env.example`. The lane `.env` has `AUDIT_ANCHOR_DOMAIN=axion-lane-w48`. Restore check: a test copies the audit rows into a second scratch schema (the test server cannot create a second database, so another schema stands in for another database name) and verifies `ok` there with the same domain, and `bad_signature` with a different one. |
| R3 | `--rotate` needs the key and domain, needs `--confirm <old last line n>` (the CLI first prints the old file's last line, signature prefix and per-tenant state), and refuses a file that still verifies ok unless `--force`. |
| R4 | Order: one transaction writes the `audit.anchor.rotated` events for all tenants, then the rename to `<file>.<timestamp>.bad`, then the new file whose line 1 signs `rotatedFrom = {sha256 of the archive bytes, archive name, time}`. A failure at the events step leaves the old file and no events (tested by injecting a failure); a failure after the rename puts the old file back and says to run it again (tested, and the retry works); if it cannot be put back the message gives the exact `mv`. `audit:verify` prints "audit anchor file restarted on <date> (previous file archived ...)", and the route returns `restartedAt` (no archive name or hash), which the Operations tile shows as "restarted on <date> (previous file archived)". The mark is signed: editing or removing it is `bad_signature`, and deleting the database events does not hide it (tested). |
| actor | The event's actor is `os.userInfo().username`, never the literal `operator`; an optional `--actor "<note>"` is stored as `detail.note`, with `osUser`, `archiveSha256`, `oldLastLine`, `stateBefore` and `forced`. |

Limits kept honest: a key holder can still re-anchor a tampered chain after a rotation; the signed restart mark and the off-host copy of the last line are what make that visible. The optional R2 (read through one `O_NOFOLLOW` fd) and P3/P4 are not done.
