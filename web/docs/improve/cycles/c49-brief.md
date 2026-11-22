# c49 brief: an audit-chain anchor outside the database (P5b)

**Lane:** w48, from improve-30h at 09dd6cb (c31 audit chain merged, events lock schema-scoped). Ports 9890 (dev), 9891 (preview) and 9892–9893 (e2e). E2E DB **axion_e2e4**. Migration **0038**, only if needed.
**Source:** BACKLOG P5b, a known limit of c31. Someone who can write the DB can delete the newest audit rows (truncating the tail) or rehash the whole chain, and `GET /audit/verify` still says OK, because the chain only proves internal consistency.

## Hypothesis
A signed checkpoint held **outside** the database makes both attacks detectable:
- the checkpoint covers each tenant's head `(tenant, seq, row_hash, at)`;
- it is signed with HMAC-SHA256 using a key from the server environment (`AUDIT_ANCHOR_KEY`, never in the DB, never logged);
- it is appended to an append-only file (default `server/data/audit-anchors.jsonl`, mode 600).

Verify then checks that the chain still contains every anchored head with the same hash. It never touches the live DB in tests.

## Build (test-first)
1. **Anchor module** `server/src/audit-anchor.ts`:
   - `writeAnchor(pool, file, key)` reads every tenant head in one snapshot, signs each line with HMAC, and appends it with fsync.
   - `verifyAnchors(pool, file, key)` gives, per tenant:
     - `ok`;
     - `truncated` (an anchored seq is missing);
     - `rewritten` (the row_hash differs at an anchored seq);
     - `bad_signature`;
     - `anchor_missing` (no key or no file, reported as not verifiable, never as ok);
     - `rolled_back` (the file's last line is older than a previous line's seq).
   - The key is read from the environment, and the function fails closed if the key is shorter than 32 bytes.
2. **CLI.** `npm run audit:anchor` writes a checkpoint. `npm run audit:verify` also verifies the anchors and exits non-zero on any non-ok result.
   - **No timer in the API.** Anchoring is an operator command. Document it in the runbook section of the c31 docs, or a new `server/docs/audit-anchor.md`.
3. **Ops view (admin).** Show the last anchor time and the per-tenant anchor status read-only on System Operations, with `?` help. Don't expose the key or the file path to the browser.
4. **Secrets.**
   - In the lane, generate a test key in the lane `.env` only. **Do not touch `server/.env` in `/home/luca/AXION`.** The controller adds the live key at the live update.
   - Tests use a temp dir for the file.

## Pass threshold (fixed)
Tests on a scratch schema must show:
- deleting the newest N audit rows (with the guard bypassed via the c31 purge path, or by disabling the trigger in the test) → `truncated`;
- a full rehash of the chain with recomputed hashes → `rewritten`;
- editing a line of the anchor file → `bad_signature`;
- deleting the file's last line after a later write → `rolled_back` (when it is detectable from the remaining lines; state the limit honestly);
- no key → `anchor_missing`, and the CLI exits non-zero.

Also required:
- ≥ 25 tests;
- the full vitest, tsc and verify-all 10/10 pass;
- a grep test that proves the key never reaches a log line or a response;
- `web/scripts/api-c49.mjs` for the ops view (admin sees status, member gets 403), with the 1366×768 fit.

Also measure and report, as a one-off, for BACKLOG P5c: the longest events-lock hold in the scale bench (`pg_locks` sampling or timing around `appendEvent`). Record it; don't change lock behaviour.

## Report
`cycles/c49-report.md`.
