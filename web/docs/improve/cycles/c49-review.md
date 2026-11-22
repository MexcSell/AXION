# c49 independent security review (audit-chain anchor, P5b + P5c numbers)

Reviewed: lane w48, branch c49-audit-anchor, tip 8e5589a (base 09dd6cb). Lane left at 8e5589a, tree clean (a temporary attack test file was created, run and deleted).

## Verdict: PASS-WITH-FIXES

No finding breaks the stated guarantee: no state reachable by an attacker without the key (DB write, file write, or both) reports `ok` unless the tampering falls inside the documented limit. Fixes below are hardening, none blocking. The key does not leak anywhere I could find.

## Re-run results (confirmed)
- `tsc --noEmit` (server): clean.
- Full server vitest: 51 files, 1492 tests, all pass (1485 + my 7 temporary attack tests). The `instances.test` skills PATCH 500 did NOT reproduce in this run. Report it separately as flaky/known, not a c49 issue.
- `audit-anchor.test.ts` included in the above, all pass.
- `api-c49` via `api-e2e.sh` with E2E_API_PORT=9892 E2E_WEB_PORT=9893: 14/14 PASS, no page errors. (Run bare as `node scripts/api-c49.mjs` it defaults to port 5193 and fails with connection refused; it must go through `api-e2e.sh api-c49.mjs`. Minor: the default BASE of 5193 is a port the lane rules forbid-adjacent, consider removing the default.)

## Findings

### Confirmed by running

**F1 (Low) Signature comparison accepts non-canonical hex.** `server/src/audit-anchor.ts:47` `sameSig` uses `Buffer.from(a,'hex')`, which stops decoding at the first non-hex character. A line whose `sig` is the correct 64 hex digits followed by junk (`"...abcd" + "zzzz"`) verifies as `ok` (confirmed: both tenants `ok`). Not a forgery (the attacker still needs the valid MAC), but the file is malleable: an attacker can append junk to signatures undetected, and a line is not byte-for-byte what was signed. Fix: `if (!/^[0-9a-f]{64}$/.test(a)) return false;` before the compare.

**F2 (Low) Unreadable or non-regular anchor file throws instead of reporting.** `readLines` (line 53) is called without a try. A directory in place of the file gives `EISDIR` thrown out of `verifyAnchors`. Effects: `GET /operations/anchors` returns 500, `audit:verify` dies with an unhandled rejection stack and the pool never ends. It does fail closed (never ok, no key in the message) but should report `{configured:true, ok:false, reason:'anchor file unreadable'}` in the ops route and exit 1 cleanly in the CLI. Same for EACCES.

**F3 (Low) No file-mode or file-type check.** The docs and report say mode 600, but verify never checks it. A 0666 file verifies `ok` (confirmed), and a symlinked anchor path is followed for both read and append (confirmed: `writeAnchor` appends through the symlink to the target). Integrity is protected by the HMAC so this is not an integrity hole; the exposure is only that an attacker with write access to the directory can redirect where the operator's append goes. Optional: `lstat` and refuse a symlink or a group/world-writable file in `writeAnchor`, warn in verify.

**F4 (Info) Stale lock blocks until removed.** `withLock` (line 137) uses `wx`; a crash between open and unlink leaves `<file>.lock`; every later `writeAnchor` throws with a message that says to remove it (confirmed). Safe (fail closed, message is actionable) but the runbook does not mention it. Add one line.

**F5 (Info) Operator recovery for a non-verifying file is thin.** `writeAnchor` refuses to extend a file that fails verification (good, confirmed by api-c49). The doc only says "archive the old file and start a new one" in the key-rotation bullet. It does not say that doing so discards the detected evidence and resets `n` to 1, so the tampering is forgiven on the next write. The runbook should say: copy the file off, investigate, only then move it aside; and a half-written last line (crash during append, no trailing newline) also lands in `bad_signature` and needs the same path. A cheap improvement: make `writeAnchor` write the full batch with one `writeSync` (it does) and `fsync`, so a torn line is unlikely, and offer `--rotate` that renames the file to `.<timestamp>.bad` rather than leaving the operator to `rm`.

**F6 (Info) Whole-file deletion is reported, contrary to the doc.** The doc and the header comment (line 18) say deleting the whole file "cannot be told from never anchored". In fact a missing file reports `anchor_missing` and `ok:false`, and an empty file likewise (confirmed). That is the safer behaviour; fix the wording so operators do not think this is undetectable. What really is undetectable is recreating a file by someone holding the key.

**F7 (Info) Behaviours confirmed good.**
- Delete a tenant's rows entirely: that tenant reports `truncated` (confirmed, also when the route is scoped to that tenant).
- Empty file, non-JSON lines, arrays, `null`, numbers, `__proto__` objects, and an 80 MB single line: none crash and none pass; all `bad_signature`, the 80 MB case took 152 ms.
- Three concurrent `writeAnchor` calls: all succeed, file verifies `ok`, no lock left behind.
- Replaying an old line, reordering, duplicating, deleting a first or middle line: counter `n` breaks, reported `rolled_back` (by code reading and the 49 tests). Re-tagging a line as another tenant changes the signed `tenant` field, so the MAC fails.
- `canonical()` is JSON-key-sorted with JSON-encoded values: unambiguous, no concatenation shifting. Every field (`v,n,batch,i,of,tenant,seq,rowHash,at,anchoredAt`) is inside the MAC; extra fields are signed too. Compare is `timingSafeEqual` after a length check.
- Fake tenant inserted in DB: reported `anchor_missing`, overall `ok:false`.

### Plausible, not demonstrated

**P1 (Low) Stale heads can be written after fresher ones.** `writeAnchor` reads heads (line 162) and verifies chains before taking the lock (line 171), so with two writers the one that read heads earlier could take the lock second and append an older `seq` for a tenant. `verifyAnchors` would then flag `rolled_back` (backward check, line 105) forever, a false positive that blocks all further anchoring until the file is archived. My three-way race and a staged race did not hit it (the window is small), but it is real by construction. Fix: take the lock first, then verify and read heads inside it.

**P2 (Low) Same key across deployments has no domain separation.** There is no deployment id in the MAC. A signed line from another deployment sharing the key can only be spliced where its `n`, `batch/of` and row hash also match, which in practice means it shows as `rewritten`, so exploitation is unlikely. Cheap hardening: include a constant context string (`"axion-audit-anchor-v1"` plus the DB name or a stored instance id) in the signed data.

**P3 (Low) Cost of a status call.** `verifyAnchors` does a synchronous `readFileSync` and an HMAC per line on the event loop, plus a full `group by` on `audit_events`, and is rate-limited 12/min per session (key `ctx.tokenHash`, so per admin session, not global). The file grows without bound (one line per tenant per checkpoint). Many admin sessions could multiply it. Not exploitable by members (403). Consider a global limiter or caching the parsed file by mtime.

**P4 (Info) Ops route leaks the size of the file's batches.** For the caller's tenant it can return reasons such as "the last checkpoint has 1 of 3 lines" and "line 7", disclosing how many tenants exist and file layout. No path, no key, no hashes (confirmed by api-c49 and the tests). Acceptable; could be genericised for the route.

**P5 (Info) Weak-but-accepted key.** `requireKey` only checks length (32 bytes), so `'a'.repeat(32)` passes. Docs recommend `openssl rand -hex 32`; fine.

**P6 (Info) `anchors` status alone does not check row content.** The ops tile and `verifyAnchors` compare only `row_hash` at anchored seqs; editing a row's `detail` without touching `row_hash` shows anchor `ok`. The chain verification (`/audit/verify`, `audit:verify` does both) catches that. The tile label "Matches" should not be read as full integrity; the help text could say so.

## Brief item by item

1. Signature and format: see F1, F7, P2. Canonical encoding is sound; constant-time compare yes (with the F1 hex caveat); tenant replay impossible; reorder/duplicate/splice caught by `n` and `batch`.
2. Verify logic: the DB-write-only attacker cases (truncate, rehash anchored rows, fake tenant, delete a whole tenant) all report non-ok. DB plus file writer: delete the final checkpoint and the DB rows after the previous checkpoint is undetectable, and that is the stated limit (confirmed: deleting the whole final batch of a two-tenant file leaves `ok`).
   Is the limit avoidable? Not within these two stores. Any extra state (a global counter, the anchor time folded into the next write, an "anchor written" audit event in the DB) lives either in the file, which that attacker truncates, or in the DB, which that attacker also rewrites. A DB audit event "anchor n=k written" would catch a file-only truncation, but a file-only truncation gains the attacker nothing. The only real closure is an external copy (off-host file, syslog or a ticket with the last `n` and sig), which the runbook already recommends. I would additionally have the CLI print the last line's `n` and the first 12 hex of its `sig` so the operator can paste it elsewhere (cheap and useful). Judgement: unavoidable, adequately documented.
3. Fail closed: missing key, short key, no file, empty file, junk file, stale lock and non-verifying file all refuse or report non-ok. Gaps: F2 (throws instead of reports), F3 (no mode/symlink check), F4 and F5 (docs), P1 (race).
4. Key hygiene: grep of `AUDIT_ANCHOR_KEY` finds it only in `audit-anchor.ts`, `config.ts` (comment and type), the CLI header comment, docs, the test, `api-c49.mjs` and the report. No `process.env` dump anywhere in `src`; `app.cfg` is never serialised by a route; the logger redacts only cookies but no code logs cfg. `requireKey` messages do not echo the key (tested). The lane `.env` is mode 600 and git-ignored; `server/data/` is git-ignored. The test-injected `cfg.auditAnchor.key` is kept on `app.cfg` in memory only: it must stay that way (never add `app.cfg` to a status response). No leak found.
5. Ops route: `requireAdmin`, then the session limiter (12/min, 429 with retry-after), then `verifyAnchors(..., {tenant: ctx.tenantId})` and a mapped response that omits key, path and hashes. Member gets 403 (confirmed by api-c49). Scoping verified: another tenant's rows and lines are filtered; the file-wide checks (`bad_signature`, gap, partial) intentionally taint the caller's tenant (P4 note).
6. No timer: `setInterval` / `setTimeout` do not appear in `audit-anchor.ts` or `ops/routes.ts`; the anchor is only written from the CLI.
7. Re-run: see above.
8. P5c: see below.

## P5c numbers and `server/scripts/events-lock-hold.ts`

Method is sound for an upper-bound estimate: it wraps `pg.Client.prototype.query`, so pool and transaction clients are both covered; it takes the grant time from the resolution of the schema-qualified lock query (`EVENTS_LOCK` includes `current_schema() || ':axion-events'`, so the string match is right) and ends at `commit`/`rollback` return, and it separates wait from hold. Caveats that make the figures conservative rather than wrong: the load generator and the server share one Node event loop, so both ends of each span include event-loop delay, inflating hold; a path that issues `commit` with other text (`COMMIT;`) would be missed (`db.ts:21` uses the plain `commit`); 4,658 observed transactions for 600 writes is plausible. Not measured (the report says so): large tables, and the effect of the new anchor (it takes no events lock). The numbers (p99 4.7 ms, max 14.8 ms) are credible.

Safety of the script (**F8, Medium for a destructive tool**): the guard (line 20) only requires the worktree directory name to match `AXION-w<digits>` and the URL to end in `/axion_e2e<digits>`. It does not tie the lane to its database (w48 owns `axion_e2e4`; the script would equally run, and wipe, `axion_e2e1` from lane w48 or any other lane's DB) and it does not check the host. It then runs `migrate(pool,'down',0)`, which drops all data in that DB. The brief asked it to refuse any DB but this lane's. Fix: read the expected DB name from the lane's own `server/.env` `E2E_DATABASE_URL` (the file in the worktree, not the process env) and require equality, plus host 127.0.0.1/localhost; or require an explicit `CONFIRM_WIPE=<dbname>` env that must equal the db name. Today it is safe only because the lane `.env` supplies the right URL.

## Suggested fix list (in order)
1. F8: bind the P5c script to the lane's own DB name and host, and require a confirm variable before the wipe.
2. P1: take the lock before reading heads and verifying.
3. F1: strict `/^[0-9a-f]{64}$/` signature check.
4. F2: catch read errors in `verifyAnchors`, report `configured:true, ok:false`, and make `audit:verify` end the pool and exit 1.
5. Docs: F4, F5, F6 wording; CLI prints last `n` and a sig prefix for off-host copy.
6. Optional: F3 lstat/mode check, P2 domain separation, P3 caching.

---

# Re-review of the fix round (tip 66e3f45)

Lane left at 66e3f45, clean tree. Re-run, all confirmed: server tsc clean; full vitest 50 files / 1502 tests pass (includes `audit-anchor.test.ts`, 66 tests); `api-c49` via `api-e2e.sh` 14/14, no page errors.

## Verdict: CLEARED, with four small follow-ups (none blocking; R1 and R2 are the ones I would do before the live setup)

## 1. F8 `server/scripts/lane-db-guard.ts` (fixed, one gap)
The guard compares the target URL as a plain string with the `E2E_DATABASE_URL=` line of this worktree's `server/.env`, so every normalisation trick (case, trailing slash, `localhost`, percent-encoding, a process-env override) either leaves the string unequal (refused) or has to be written into the lane's own `.env`. Missing `.env`, missing line, `export` prefix, a quoted value, a trailing comment and a duplicated line all end in a refusal, never a pass. Name regex `^axion_e2e\d+$` is end-anchored (JS `$` does not match before a trailing newline). `localhost` and `::1` are refused; `CONFIRM_WIPE` must equal the name. The worktree root comes from `import.meta.dirname` (real path), so a symlinked worktree cannot make it read another `.env`.
- **R1 (Low, confirmed by running `pg-connection-string`).** The guard validates `u.hostname` but not the query string, and pg honours `?host=` (`...@127.0.0.1/axion_e2e4?host=db.example.com` parses to host `db.example.com`). It only matters if such a URL is in the lane's own `.env` (the string must match), so it needs a poisoned `.env`, but the fix is one line: refuse when `u.search !== ''`.
- Note (Info): the guard proves "the DB named in my own `.env`", not "the DB mapped to my lane number", so a `.env` copied from another lane passes. Acceptable; lane `.env` is the trust anchor.

## 2. F3 symlinks, O_NOFOLLOW, TOCTOU (fixed, acceptable)
- Write: `lstat` check, then inside the lock a second `lstat`, then `open(O_WRONLY|O_APPEND|O_CREAT|O_NOFOLLOW, 0600)`. The final open is atomic for the last path component, so a symlink swapped in after the checks is refused (not followed). Create mode is 0600 (the umask can only tighten). Existing files with group/other write bits (`& 0o022`) are refused; 0644 is allowed (an integrity-only file, HMAC protected).
- **R2 (Low).** Residual windows, all needing directory-write access, which already lets the attacker replace the file: (a) verify does `lstat` then `readFileSync` (follows), so a swap between them reads a different file; (b) a swap to a different regular file between the verify and the open makes `writeAnchor` append to a file it did not verify; (c) `O_NOFOLLOW` and `lstat` cover only the last component: a symlinked parent directory is followed (and `mkdirSync recursive` too). None gives forgery (no key) and none hides tampering from the next verify. Optional hardening: open the fd once with `O_NOFOLLOW`, `fstat` it, and read through that fd; document that the anchor directory must be owned by the server user and not writable by others.
- The lock file is `wx` (O_EXCL), which also refuses a symlink.

## 3. P1 lock first (fixed)
The lock is taken before the existing-file verification, chain verification and head snapshot, so two writers can no longer append an older head after a newer one. Stale lock: still fail-closed, the error points to the runbook's "Stale lock" section (check no writer is running with `pgrep`, then remove the `.lock`). A crashed writer (SIGKILL) leaves the lock; SIGINT does not trigger the `finally` either. Safe, documented. One note: the lock is now held across DB work (chain verification of every tenant), so a slow DB makes the window in which a second run reports "another write is running" longer; acceptable for an operator command.

## 4. P2 domain default: recommend making `AUDIT_ANCHOR_DOMAIN` REQUIRED
Judgement: require it (fail closed in `writeAnchor` and report `not verifiable: AUDIT_ANCHOR_DOMAIN is not set` in `verifyAnchors`). Reasons:
- The default `axion-audit-anchor-v1:<database>:<schema>` makes the restore check (`axion_restore_check`) report `bad_signature` for every tenant, which is the same status an attacker's edit produces. Operators will learn to ignore `bad_signature` on restore checks, which is the worst possible training for a tamper alarm. The same happens on any rename of the database or schema.
- Security is equal either way (an explicit domain gives the same cross-deployment separation; the default adds nothing an explicit domain does not).
- The feature is not live yet (no `AUDIT_ANCHOR_KEY` in the live `.env`), so requiring a new variable costs one line in the live setup and breaks nobody.
- If you prefer to keep the default for tests/dev, require the variable only when `NODE_ENV=production` is not enough here (the live process is not marked that way); simplest is required everywhere and tests pass it.
Also separate the status: a line that verifies under the right key but a different domain should say "wrong domain" rather than `bad_signature` (try-verify once with the default domain to tell them apart is not needed; just include "key or AUDIT_ANCHOR_DOMAIN wrong" in the reason, which the runbook already says).

## 5. P5 distinct-byte floor: the implementer is right, and your premise differs from the code
`requireKey` does `Buffer.from(key, 'utf8')`: the key is used as RAW TEXT bytes, it is NOT hex-decoded. So `openssl rand -hex 32` is a 64-character key whose bytes come from only 16 ASCII symbols. For 64 random hex draws, the chance that all 16 symbols appear is about 74% (expected distinct about 15.7), so a floor of 16 would reject roughly a quarter of valid keys. A floor of 8 essentially never rejects a random hex key (chance of fewer than 8 distinct is negligible) while still refusing `a`x32, `ab`x16 and short patterns. 8 is the correct choice for text-decoded keys. If the key were hex-decoded, 16 distinct bytes of 32 would indeed almost always pass, but that is not what the code does. Optional: say in the runbook that the key is used as the literal string. No change needed.

## 6. `--rotate`: can it launder tampering?
Findings:
- **R3 (Medium).** `rotateAnchor` needs no key and does not require the file to be failing. Anyone who can run the CLI (it needs only `DATABASE_URL` and write access to the directory) can rotate a perfectly healthy file, and it also runs on a file that verified `ok`. The evidence moves to `<file>.<ts>.bad`, which `verify` never reads. Laundering sequence: DB-write attacker deletes recent rows (status `truncated`), a person with CLI access rotates, and then whoever holds the key runs `audit:anchor`: the new baseline signs the tampered chain and the file reports `ok`. Without the key the attacker can rotate but cannot re-anchor, so the state stays `anchor_missing` (not ok), so the laundering step needs the key holder; that is inside the stated trust boundary, but the key holder is often the same operator account as the rotator.
- **R4 (Medium).** Nothing in `verify` or the ops tile shows that a rotation happened. The `audit.anchor.rotated` event is written (before it is, the file is already renamed; if the audit insert fails midway the rotation is half done and some tenants have no event) but nothing reads it, and a DB-write attacker can delete it. After rotate plus re-anchor the tile says `ok` with no trace.
- `actor` is the literal `operator`, so the event does not say who.
- Rotation is not destructive: it renames, never deletes, refuses symlinks.
Recommendations (in order):
  1. Require `--confirm <n>` where n is the old file's last line counter, and refuse to rotate a file whose status is `ok` unless `--force`; before renaming, print the old file's last verified state per tenant (status, last `n`, `sig` prefix, `anchoredAt`) so the operator records it.
  2. Write the audit events inside one transaction before the rename (or rename last), so it is all or nothing; include the old file's last `n`, a SHA-256 of the whole archive, and the verification status at the time in the event `detail`.
  3. Put the rotation into the new file: the first line after a rotation signs `rotatedFrom = sha256(archive)` (one extra signed field in line 1), and have `verifyAnchors` surface `rotatedAt`/`rotatedFrom` in its report and the ops tile ("anchor file restarted on <date>"). That survives a DB-write attacker (it is in the signed file) and makes laundering visible to every later reader.
  4. Record the real actor (`process.env.USER`/`SUDO_USER`) in `detail`.

## 7. Other checks on the new code
- F1 strict hex now on both sides; F2 unreadable/dir paths return `ok:false` with a reason (tests pass; route 200). New statuses `insecure_file` and `unreadable` rank highest, so they cannot be masked.
- Domain is included in the MAC through `canonical({domain, line})` (unambiguous). `domainOf` runs a query before the file checks: harmless.
- `rotateAnchor` on an `insecure_file` that is not a symlink is allowed (intended: that is the recovery path).
- Not done (optional, still fine): P3 caching and P4 reason genericising.

## Summary of follow-ups
R1 reject a URL query string in the guard; R2 optional fd-based read; R3/R4 rotate confirm plus visible, signed rotation record (the substantive ones); and require `AUDIT_ANCHOR_DOMAIN` (section 4).
