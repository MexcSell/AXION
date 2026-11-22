# c33 review: failure-mode tagging (MAST)

Reviewer: independent. Worktree /home/luca/AXION-w31, branch c33-failure-tags (tip c77b5b8). Read only; ran `test/failures.test.ts` once (17 passed).

**Verdict: CLEAR.** No Important findings. Four Minor ones.

## 1. Taxonomy fidelity
Fetched https://arxiv.org/html/2503.13657. The 3 category names and 14 mode ids and names in `shared/contracts/src/failures.ts:15-50` match the paper exactly:
- FC1 System Design Issues: FM-1.1 Disobey task specification, FM-1.2 Disobey role specification, FM-1.3 Step repetition, FM-1.4 Loss of conversation history, FM-1.5 Unaware of termination conditions.
- FC2 Inter-Agent Misalignment: FM-2.1 Conversation reset, FM-2.2 Fail to ask for clarification, FM-2.3 Task derailment, FM-2.4 Information withholding, FM-2.5 Ignored other agent's input (curly apostrophe in the code, straight in the fetch tool's output, which normalises text; not a mismatch), FM-2.6 Reasoning-action mismatch.
- FC3 Task Verification: FM-3.1 Premature termination, FM-3.2 No or incomplete verification, FM-3.3 Incorrect verification.

No mismatch. I did not re-verify the definition sentences word for word (the fetch covered the first 100k of 160k characters and was summarised); the names and ids are verified. The code's definitions are consistent with the paper's wording as quoted in the report.

## 2. Visibility and tenancy
All four subject kinds go through the one `resolveSubject` (`server/src/failures/service.ts:19-40`). Each query requires `m.tenant_id=$2`, `m.deleted_at is null` and `VISIBLE_SQL`. Task and attempt also require `t.tenant_id=m.tenant_id`. Messages are limited to `scope='mission'` threads, so direct channels are never taggable. Non-numeric ids are a 404, not a cast error. A missing, invisible and other-tenant subject give the same 404.
- `GET /failure-tags` calls `resolveSubject` before reading rows (service.ts:66-69), so there is no list leak.
- `POST /failure-tags/:id/decision` joins the mission and applies `VISIBLE_SQL`; an invisible tag is a 404 (service.ts:97).
- `GET /company/failure-modes` applies tenant, `deleted_at` and `VISIBLE_SQL` to both confirmed and proposed rows, so `n` and `proposed` do not leak invisible missions (service.ts:114-119).
- Events carry `missionId`, so `emit` gives audience `mission` (hooks.ts), visibility-filtered. The payload has no note text. Test `failures.test.ts:174` checks the audience.

## 3. Lifecycle
- The guard trigger (migration 0028 up.sql:32-51) allows only proposed to confirmed or rejected, once, with `decided_by` and `decided_at` filled, and every other column immutable. TRUNCATE has its own statement trigger. DELETE is refused except under `axion.purge_demo`, which `clearDemo` sets (`server/src/seed/demo.ts:49`). Test `failures.test.ts:184` covers edit, delete, truncate and a second change; `:278` covers the demo purge via `clearDemo`.
- The unique index is partial on `status <> 'rejected'` (up.sql:26), so a rejected tag does not block a correct re-tag. Test `:167` covers it.
- Decisions lock the row (`for update of f`). A refused decision is audited and the transaction still commits (service.ts:96-100), so the audit row survives.
- A duplicate insert maps to 409 (23505) and the transaction is thrown away cleanly.

## 4. Counts
- Only `confirmed` rows are counted. `proposed` is reported separately and is not in `n` (service.ts:121-125).
- The window is by `created_at` (`> from and <= to`), documented in the report and the help text. `n` is the sum of confirmed rows. Every count is null when `n = 0`, including when a confirmed tag exists outside the window (test `:223`).
- Category counts sum to `n`. Exact-fixture and window tests are at `:233` and `:249`.
- DEMO missions are excluded unless `includeDemo=1`. The dialog only requests them for a DEMO subject and shows a DEMO tag (failure-tags.tsx). In web demo mode it shows two labelled samples and no counts. No invented numbers.

## 5. Security
Both POSTs are in `LIMITED_ROUTES` (`ratelimit.ts`, bucket proposals). `security.test.ts` is extended and is stricter: the `LIMITED_KIND` regex gained `failure-tags` and the expected list gained both routes; nothing was removed except the old regex line itself. Bodies use `.strict()` with length limits (routes.ts:17-18). Idempotency is applied to the create.

## 6. UI
- The dialog has a Close button and the Modal X. DL-78 is in the ledger (no-props and props PASS). The error banner has `role=alert`.
- Help entries: `failure.tag`, `.category`, `.status`, `.counts`, per-category and per-mode keys, all generated from the taxonomy (verify-all help-keys step passed per the report).
- The screenshot `improve-c33-counts-dark.png` shows the dialog fitting in one screen, with n, the DEMO label and the definition visible.
- Both radiogroups use buttons with `role="radio"` and `aria-checked`.

## 7. Tests
The 17 tests match the report's claims. The only existing test touched is `security.test.ts`, widened and not weakened. The report is honest about RED (written after the implementation) and about the single failed task in the seed.

## Findings
- **Minor** `web/src/dialogs/defs/failure-tags.tsx:84-100`: the radiogroups have no arrow-key navigation and each radio is a separate tab stop, which is not the standard radiogroup keyboard pattern. The a11y check passes; it is a polish item.
- **Minor** `server/src/failures/service.ts:96-100`: any visible person may decide, including the tagger. This is a documented decision in the report (concern 5). An agent's proposal still needs a person, so the brief is met, but a self-confirmed human tag has no second check.
- **Minor** `server/src/failures/service.ts:111`: DEMO counting is per-request `includeDemo`; the response does not say how many of `n` are DEMO. The label is honest at the dialog level, but the API consumer cannot split them.
- **Minor** `web/src/dialogs/defs/failure-tags.tsx:29`: DL-78 may collide with another lane's id (report concern 4); check at merge.
