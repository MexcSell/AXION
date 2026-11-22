# c39 review (mission ledgers), independent

Reviewed tip cb1db55 on c39-mission-ledgers. Read-only. I ran `c39-ledgers.test.ts` once: 24 of 24 passed. I did not re-run the browser scripts, and I did not fetch the paper (no fetch tool was available to me).

Verdict: **CLEAR**, with Important findings I1 and I2 to fix or log before merge. Neither blocks the brief's pass threshold.

## Findings

**I1 (Important) Legal bodies can exceed the DB size check (500 instead of 400).**
- `server/migrations/0032_mission_ledgers.up.sql:11` checks `pg_column_size(body) < 65536`.
- The zod bounds in `shared/contracts/src/ledgers.ts` allow 4 groups x 30 facts x (400 + 200) chars = 72,000 chars of facts, plus 30 steps. Multi-byte text makes it larger.
- A schema-valid body can therefore pass zod and then fail the CHECK. That surfaces as an unmapped 500, and the whole transaction rolls back.
- The cap should be enforced in zod (a total-size refine) so the user gets a 400 with a path. Alternatively, lower the per-item limits so the worst case fits under 64 kB. No test covers a maximal body.

**I2 (Important) The version list reads every body, with no cap on versions per mission.**
- `server/src/missions/ledger-routes.ts:23` selects `l.*` including `body`.
- `ledger-routes.ts:41` fetches up to 1000 rows (up to ~64 kB each) on every `GET /missions/:id/ledgers`, and then discards the bodies.
- Writes have no per-mission version cap. The only brake is 30 per minute, so storage can grow by about 2 MB per minute per session, and the history read grows with it.
- Fix: select only the metadata columns for the version list, and consider a cap on versions per mission and kind.

**M1 (Minor) "Save mine as the next version" does not show what is dropped.**
- `web/src/dialogs/defs/ledger-edit.tsx:75,93-95` (`keepMine`, the rebased banner).
- It is not silent: the banner says their version "stays in History, but its changes are not in yours".
- The user still never sees the diff between their version and the other session's. The data is available, since `diffLedgers` already exists and `conflict` holds their body.
- Showing a diff or a changed-lines list in the conflict banner would make the override informed.
- The 409 itself is correct (compare-and-set), and the dialog does not overwrite anything without a click.

**M2 (Minor) The row lock is taken before the visibility check.**
- `server/src/missions/service.ts:100` runs `select ... for update` before the VISIBLE_SQL check, and `ledger-routes.ts:57` calls it this way.
- Any user in the tenant can therefore briefly lock a mission row they cannot see, or one they only read (the 403 case), by POSTing.
- The lock is held only for the length of the transaction, and a body that fails validation still holds it for that long.
- The effect is limited (same tenant, short transaction), but a visibility check first, or a lock taken only after the permission check, is cleaner.

**M3 (Minor) Body validation and the 400 are produced under the lock.**
- `ledger-routes.ts:58-66`.
- Cheap (it throws before any write), but envelope and body parsing could happen before `tx`, so a malformed request takes no lock.

**M4 (Minor) Failed ledger writes count against the proposals bucket.**
- `server/src/ratelimit.ts:37` shares the proposals bucket (30 per minute per session), and every attempt counts, including 409, 400 and 403.
- A person editing by hand will not reach 30 per minute.
- A script, or a conflict-retry loop like the concurrency test, can exhaust that session's proposal budget. The 10-writer test needed a raised budget for this reason.
- The limit is per session, so it cannot starve another user.
- It is acceptable now (humans only), as the report's concern 4 says.
- When agents or system actors can write, a separate `ledgers` bucket would be better.
- `security.test.ts` is extended, not loosened: the `LIMITED_KIND` regex gains `\/ledgers\/` and the expected list gains the new route.

**M5 (Minor) The seeded demo ledgers only reach newly created demo missions.**
- `server/src/seed/demo.ts:32`; the report already records this as concern 7.
- It is worth a note in the demo docs: existing DEMO rows need `demo:clear` then `demo:seed`.

## Checks, with evidence

**1. Concurrency and versions: sound.**
- `getVisibleRow(c, ctx, id, true)` takes `for update` on the mission row, and the next version is `max(version)+1` inside the same transaction (`ledger-routes.ts:57,70-71`).
- The compare-and-set `cur !== env.baseVersion` gives 409 `LEDGER_CONFLICT` for both stale and future bases.
- `unique(mission_id, kind, version)` is the backstop.
- Tests: 10 retrying writers get exactly 1..10 in the DB, and 10 writers on one base give one 201 and nine 409s.
- Silent loss: the server never merges or drops anything. The only loss path is the UI's explicit "Save mine" (M1), after a visible conflict banner. The other session's version stays in history.

**2. Authorization and visibility: correct.**
- Writes: `canManage` is admin or owner (`visibility.ts`), checked after the mission is found and visible. A non-manager gets 403.
- Reads and writes both go through `getVisibleRow`, which applies tenant, `deleted_at` and VISIBLE_SQL. An invisible, foreign-tenant or malformed id gets 404 (and `/^M-\d+$/` is checked first).
- 404 vs 403: a 403 only reveals existence of a mission the caller can already see (visible but not manageable), so it leaks nothing.
- Archived mission gives 409 `ILLEGAL_TRANSITION`, and writes are human only (`author_kind` is hard-coded to 'human').
- The tests cover a private mission of another user, an unknown id, a malformed id, and a member on a shared mission (403).
- The tenant filter comes from `ctx.tenantId`, and the insert uses `ctx.tenantId`.

**3. Schema: strict and server-computed stall, with the exceptions I1 and I2.**
- `.strict()` everywhere; text trimmed, min 1, max N; arrays max 30; step id regex and uniqueness; `baseVersion` int 0..1e6.
- `stall` is not in `ProgressInSchema`, so a client-sent `stall` is rejected with 400 (tested). The server computes it from the last 50 entries plus the new one.
- DB checks: kind, version >= 1, body is an object, author_kind, size (see I1).
- `tenant_id` and `mission_id` are foreign keys.

**4. Append-only: holds.**
- The row trigger covers UPDATE and DELETE, and the statement trigger covers TRUNCATE.
- The `axion.purge_demo` exception applies to DELETE only (`up.sql:21`). UPDATE and TRUNCATE are still refused while it is set.
- It is set with `set local` inside `clearDemo`'s transaction, so it cannot leak to other connections.
- Real ledgers on non-demo missions stay (test: 1 row left after `clearDemo`).
- Mission soft-deletes (`deleted_at`) do not cascade.
- A real ledger on a demo mission would cascade away, which is acceptable.
- The down migration drops the table, which takes its triggers with it, then the function, in a safe order.
- No existing test or script truncates missions: `grep` of server/test, server/scripts and web/scripts finds only the other append-only tests (c09-minors, conversations, instances).
- `scripts/scale-bench.ts` inserts into `missions` without ledgers and is unaffected.

**5. Paper attribution: acceptable.**
- The field names are AXION's own (`given / to_look_up / to_derive / guesses`, `satisfied / looping / progressing / next_speaker / next_instruction`).
- The help texts, the code comments and the tab link all attribute and link to arXiv 2411.04468.
- I found no copied sentences in help or comments. The wording is paraphrased, and "educated guesses" is a plain-language term.
- Limit: I did not compare against the paper's text, since I could not fetch it.
- A caution: the report says "the paper's counter above 2" and "2 in the paper's runs". I could not verify that figure, so the owner should confirm it.

**6. UI: partly evidenced.**
- The report claims fit-check ALL FIT with 78 views (not re-run here).
- The diff logic (`diffLedgers`) is pure and unit-tested for added, removed and changed entries, flags and the progress stall counter. Fact diffing is text-based, so a reordered fact shows as no change (acceptable).
- Edit dialog: `Modal onClose={close}` plus a Cancel button. `api-c39.mjs:84-88` tests Escape and Cancel, and the report states 31 of 31 passed.
- The conflict UI is present (`role="alert"`, `data-ledger-conflict`), the Save button is gated while a conflict is open, and the screenshot exists (`improve-c39-conflict-dark.png`).
- `?` help is on every block (`help/pages/c39-ledgers.ts`). DEMO labelling is present: `DemoTag`, the author name "DEMO sample", the `demo` flag in the DTO, and the text itself says DEMO.
- Small point: the dialog id DL-78 collision is already known.

**7. Rate limit:** see M4. `security.test.ts` is extended only.

**8. Tests match the claims.**
- The 24 tests in c39-ledgers.test.ts pass. The report's two RED-to-GREEN notes are consistent with what is there.
- Nothing is weakened: the test change was the security route-table pattern and list (widened), and the 10-writer test gets a larger rate-limit budget through the `writeLimits` option on `makeTestApp`, with a separate test that the limit does apply (3 then 429).
- Gap: no test for a maximal legal body (I1), and none for the history read cost (I2).
