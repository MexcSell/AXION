# Audit anchor (c49)

The audit log is a hash chain (c31, `GET /audit/verify`, `npm run audit:verify`). A chain proves only that it agrees with
itself: someone who can write the database can delete the newest rows or rehash everything, and the chain still verifies.
The anchor is a signed checkpoint kept outside the database.

## What it is
- `npm run audit:anchor` appends one line per tenant to `server/data/audit-anchors.jsonl` (override with `AUDIT_ANCHOR_FILE`;
  created with mode 600, fsynced). Each line holds the tenant's head `(seq, row_hash, at)`, the time of the checkpoint, a line
  counter `n`, and `sig = HMAC-SHA256(AUDIT_ANCHOR_KEY, the other fields)`.
- `npm run audit:verify [tenant]` checks the chain and then every anchored head against it. Exit 0 only when both pass.
- System Operations > Services shows the status of your tenant's anchor (administrators only). It never shows the key, the file
  path or a hash. There is no timer in the API: **anchoring is an operator command.** Run it from cron or by hand, as often as
  you want the "everything before this moment is fixed" point to move (for example after each backup).

## Key
- `AUDIT_ANCHOR_KEY` lives only in the server environment (`server/.env`, mode 600). At least 32 bytes: `openssl rand -hex 32`.
  A missing or short key fails closed: nothing is written, and verify says `anchor_missing` (not verifiable), never ok.
- Never put it in the database, a log or a response. Do not reuse another secret. Rotating it invalidates the old file:
  archive it and start a new one.

## Statuses (per tenant)
| status | meaning |
|---|---|
| `ok` | every anchored head is still in the chain with the same hash |
| `truncated` | an anchored seq is missing (newest rows were deleted) |
| `rewritten` | the row at an anchored seq has a different hash (chain recomputed) |
| `bad_signature` | a line of the anchor file was edited, or the key is wrong |
| `rolled_back` | the file's line counter has a gap, the last checkpoint is incomplete, or an older line was replayed |
| `anchor_missing` | no key, no file, or this tenant has no line yet: not verifiable |

`audit:anchor` refuses to write (exit 1) when a tenant's chain does not verify, or when the existing anchor file does not
verify, so a tampered state is never signed and a tampered file is never extended.

## Limits, stated honestly
- Rows written after the last checkpoint are covered only by the plain chain, until the next checkpoint.
- Deleting the **whole final checkpoint** (or the whole file) cannot be told from "never anchored later". A multi-tenant
  checkpoint with only its last line removed, a line removed from the middle or start, and a replayed older line are all caught.
- Anyone holding the key can forge a file. Keep the key off the database host's reach, and copy the file off-host
  (append-only storage, another machine, a ticket) to close the delete-the-file gap.
- After a database restore, `audit:verify`
  reports `truncated` when the restore is older than the last checkpoint. That is correct; investigate before anchoring again.

## Live setup (controller)
Add `AUDIT_ANCHOR_KEY=$(openssl rand -hex 32)` to the live `server/.env` (mode 600), restart, run `npm run audit:anchor`, then
`npm run audit:verify`. Optionally schedule `npm run audit:anchor` after the nightly backup.
