# c70 review (H11b, H14, E1d), branch c70-hardening 812c185..80238e1, migration 0052

Reviewer method: read the brief, report, diff and c53/c54/c61 context; ran the lane tests in the lane tree (5 c70/otel/c65 files, 48/48 pass) and a full parallel vitest in a scratch copy of 80238e1 (`.../scratchpad/rev`, node_modules and web/src symlinked, test DB axion_test, no real axion DB, no ports used, no background job left). Mutations and probes were made in the scratch copy only; the lane tree is untouched (git status clean).

Full parallel run in the scratch copy: 114 files, 3004 pass, 5 fail. All 5 are artefacts of my copy (no `web/docs` and no git history): 4 in `otel-mapping.test.ts` (stored spec pages) and `c65-contracts` "NO ALLOWLIST LINE" (needs git base). Both files pass in the real lane tree (48/48 above). No "too many connections" or "admin connect failed" in my run.

## Verdict: CLEAR AFTER FIXES

Fix list (1 should-fix, rest minor):
1. E1d-1 (should-fix): the content key is defeated by renaming case ids. Either hash (input, expected) without case_id for the holdout content key, or state it as still open in the report and BACKLOG (the report names only "lightly edited copy").
2. Report/doc corrections (minor): the "presentation only" list misses two stored app-clock writes (see H11b-2), and "peak connections <= 8" is a tautology (H14-2).

---

## 1. H11b

**Confirmed GOOD**
- `agents/reliability.ts:152-153`: window end is `dbWindow(c,'90d')` read after the rows. `reliabilityWindow(now)` has no default (`:54`). `WINDOW_DAYS` 90 equals `dbWindow '90d'`. The window is on the ms grid like c54, so no row from before the read can be later than the end.
- `grants/routes.ts`: `issued_at` is `now()` in the insert (`:86`). "Past" and "30-day cap" are judged in one SQL statement against `now()` (`:69`). State is from `g.expires_at <= now()` selected with the row (`db_expired`, `:32`). No `Date.now()` is left in the file (grep).
- `approvals/routes.ts`: `db_now_ms` selected in the same statement as the row at all 3 sites; `approvalDto(r, Number(r.db_now_ms))`. Expiry state was already `db_expired`; the lane's note that the brief was slightly wrong is correct (`approvals/service.ts:100,107`).
- RED tests are sound: `c70-clock.test.ts` skews only `Date` by one hour behind, rows are written with DB `now()`. Each assertion has a real-clock expectation that the old code gets wrong (past-by-30-min expiry accepted; edge-of-cap refused; issued_at 3600 s off; state active; expiresMin 120). I re-ran them green (c70-clock 6/6).
- Grep of `src` for `Date.now()|new Date()|getTime()|Date.parse`: no remaining app-clock SQL bound or comparison with a stored time in a route. Remaining uses are presentation, in-memory rate windows, seeds, injectable test clocks.

**Findings**
- H11b-1 (minor, latent): `grants/service.ts` `decideOnOrigin(..., now)` / `loadGrants(_now)` compare grant expiry in `evaluate()` against a caller-supplied `now` (the real expiry enforcement for an executor). No production caller exists (`grep decideOnOrigin src` returns only the definition), so nothing is wrong today. It is the one place a future executor could reintroduce the app clock. Suggest a one-line comment or `db_expired` in `loadGrants`.
- H11b-2 (minor, report honesty): the "presentation-only" list is nearly complete but omits stored app-clock writes: `auth/service.ts:44` (`approved_at = new Date()` for the first sign-up) and `missions/routes.ts:88,134` (`Date.now()` stored into presentation JSON as `lastEventAt`). Neither is compared or used as a window bound, so presentation/record-only is a fair label, but they are stored values, not just display. Also `conversations/service.ts:44` `messagesWhere` uses `Date.now()` for `ago` text (display).
- N+1 (verified by reading, not re-dumped): the batched `bases` query (`distinct on (u.pid)`, same order `started_at desc, id desc`, finished only), `runCounts`, `casesBy`, `plainRuns`, `datasetValidities` are semantically the old per-proposal queries. `runCount` now also joins datasets of the same split and content hash (intended). Output identity before/after was a one-off dump per the report; it is not a standing test. The 292 eval tests plus the c70 tests pass, which covers it adequately.
- N+1 test (minor): `c70-n1.test.ts` asserts `six.q === one.q`, so the query count is asserted. It does not exercise the paths the report says are still per-proposal (dev/holdout overlap query, re-grade link lookup), so a regression there would not show; it also does not pin the number (6), only equality.

## 2. H14

Mutations run in the scratch copy (each via heavy.sh):

| Mutation | Result |
|---|---|
| claimJob: remove `for update skip locked` (`jobs/store.ts:68`) | `20 parallel claimers` FAILS (1 failed) |
| claimJob: `for update` without `skip locked` | passes; behaviour is equivalent for correctness, so no test can catch it. The report's "claimers never wait" is not pinned by anything |
| consumeApproval: remove `for update` (CAS kept) | FAILS 3/3 on the new assertion `consumers blocked on the approval row lock ... expected 0 to be >= 1` |
| consumeApproval: remove `for update` and the CAS (`consumed_at is null and state='approved'`) | FAILS 3/3 on the lock-wait assertion; with that one assertion removed it still FAILS 3/3 on the original check (`approval_requests: already consumed` error not matching `APPROVAL_ALREADY_CONSUMED`) |

So with 8 connections the races are still real and the original "each job once / one consume wins" assertions are intact and effective. Baseline (unmutated) jobs + approval-binding: 104/104 pass.

- H14-1 (honest, minor): "mitigated, not solved" is the right label. The tests still need up to 8 + the harness pool (`makeSchema` pool max 4, `makeTestApp` pool 10 plus the lock observer on `t.pool`) so the true footprint of the consume test is above 8; only the 20-client fan-out is gone. The report says "at most 8 each", which counts only the test-owned pool. Suggest saying "the test-owned pool".
- H14-2 (minor): `expect(seen.peakClients).toBeLessThanOrEqual(8)` is vacuous, because the pool is built with `max: 8`. It cannot fail unless pg.Pool breaks its own cap. Only a guard against someone raising the constant. The `peakBusy >= 4` check on jobs is also near-guaranteed (20 claimers on 8 clients). The lock-wait assertion on consume and the mutation sensitivity above are what really prove the race.
- H14-3 (minor): `lockWaits` filters `datname = current_database()` only, not schema, so another test file's concurrent `approval_requests ... for update` waiter could satisfy `maxWaiting >= 1` in a full parallel run and mask a lost lock in this one. Narrowing by `search_path`/schema in the query text or by pid would harden it. Low probability; in my one parallel run it was clean.

## 3. E1d

**Probes run (scratch test, real migrated schema)**
- Same content under a new dataset id: refused (`holdout_rerun`). OK.
- Same cases inserted in reverse order: refused (hash sorts by case_id). OK.
- Same cases with JSON keys in another order: refused (canonical JSON). OK.
- **E1d-1 (should-fix) Same inputs and expected, only case ids renamed (`x-c1`..): ACCEPTED, a fresh slot.** `eval_dataset_sha` (0037:50-56) includes `case_id` in the hashed text, so renaming ids changes `content_sha256`. The dev/holdout overlap rule does not help (this is holdout vs holdout). The brief's own probe list ("content differing only in case ids or order") names this, and the report lists only "a lightly edited copy" as uncaught. Either add a second hash without case ids for `holdout_content_key`, or record it as open. Failing input: dataset H0 cases `c1..c10` with run R0, then dataset H4 with ids `x-c1..x-c10` and identical input/expected, `insert into eval_runs` succeeds.
- Lightly edited copy (one case changed): accepted, as the lane states. Honest.

**Base-run re-grade refusal (`eval_regrades_check`)**
- Correct and enforced in the DB (raw insert also refused; test covers it). Scope is "author of any proposal, in this tenant, whose base_version_id is the run's version", including decided or withdrawn proposals.
- E1d-2 (minor): that is the right minimum scope (a base run has no single proposal), and it blocks only users who wrote a proposal on exactly that version; authors of proposals on other versions or agents can still re-grade (control test passes). It can block a sole administrator who authored every proposal on the version, which is the single-admin dormancy already known (LESSONS). The report states it as deliberately strict. Fine.

**`eval_canon_config` (run on the migrated DB)**
- Plain configs keep the same key (output text format `{"model","tools","skills"}` unchanged). Tab/NBSP/ideographic/ZWSP/BOM collapse, empty and whitespace-only names dropped, NFC applied, null model gives `""`, numeric skills become strings. Test file bytes confirm the NFC/NFD test really uses `c3a9` vs `65 cc81`.
- Previously accepted configs only change key if they had internal multi-space/odd-space or empty skills; keys are stored, and the backfill rebuilds them, so no stored key is stale. Stricter only.
- E1d-3 (minor): not folded: ZWJ/ZWNJ U+200C/D, U+2060 word joiner, soft hyphen U+00AD (verified: `a‍b`, `a⁠b`, `a­b` each stay distinct from `ab`), and skill case (`Foo` vs `foo`; model is lowercased, skills never were, which is pre-existing). The brief asked for Unicode whitespace, which is done; these are cheap further re-spellings. Also JS-side trim differs from the SQL set, but the DB is the authority so this only matters for display.
- `normalize(..., NFC)` needs a UTF8 database; server_encoding is UTF8 here. If a deployment used another encoding the function would raise (fail closed). Fine.

**Migration 0052 (up/down, guards, backfill)**
- Up: new `holdout_content_key` plus partial unique index `eval_runs_holdout_content_once`; guard sets keys on insert and refuses a second run on same-content with `holdout_rerun`; immutability tuple includes the new column; guard switched off only around the backfill and re-enabled.
- Backfill: rebuilds `holdout_key` with the new canonical form; first run per (dataset-id key) and per (content key) keeps keys, later same-content legacy duplicates keep NULL on both keys. This cannot violate the new unique indexes, and a later insert on that duplicate's dataset is still refused through the first run's content key (fail closed for new writes; the NULLed legacy run stays counted by the loader's `runCount`). The lane's legacy-data test covers it (R-D1 keyed, R-D2 not). Down restores both keys (count 2 after down) and the 0040 canon; I re-ran the `migration 0052` tests: pass.
- Down order is sound (guard and check functions restored before the column and `eval_canon_name` are dropped).
- E1d-4 (minor, design note): a re-created base version or a re-frozen copy of the same holdout under a new id can never get a base run (`holdout_rerun` on the base), and the loader looks up the base run by exact dataset id, so a different-config candidate on that copy is inconclusive forever. That is the intended "freeze a holdout with new cases" behaviour, but the error text should say that a base run on the existing dataset is the one to use. Not a blocker.

**Repeat exemption (short inputs only)**
- SQL `(h.n=1 and d.n=1) or length(input::text) >= 20` (`proposal-evidence.ts`). Note the length is that of the jsonb text rendering (spaces after `:` and `,`), not the canonical JSON the report names, a harmless difference. c53's threshold is unchanged. The c70 review probe (12 long inputs twice, dev and holdout) is flagged; the short `"ok"` control stays exempt; disjoint long repeats are clean. The c47 tests in the full run (eval-integrity-db, proposal-evidence, eval-audit) pass.
- `grader: null` legacy test is kept (`c70-holdout.test.ts` section 5, `grader_unknown`, inconclusive). OK.

## 4. Changed existing tests

- `eval-audit.test.ts`: now expects `rejects.toThrow(/regrader_is_author/)` on the base run and still asserts nothing linked (`grader_mismatch`, `regrade` null). A real tightening.
- `eval-integrity-db.test.ts` `reuseScenario`: `expected` is now a per-scenario value. The reuse rule compares `input` only (case ids and `expected` are not compared), so every overlap/repeat scenario under test is unchanged. The change is required because identical content would otherwise host two base runs for v1, which the new rule correctly refuses. It does not hide a case. (It means those fixtures no longer exercise "same expected on every case"; irrelevant to reuse.)

## 5. OTel

`eval_runs.holdout_content_key` is mapped `none` with a reason (`otel/mapping.ts:102`), like `holdout_key`; `otel-mapping.md` regenerated (107 fields, 30 unmapped, counts consistent); `otel-mapping.test.ts` passes in the lane tree. Consistent with c60's rule (internal keys and content-derived identifiers are not exported; content is off by default). The key embeds the dataset content hash, so keeping it unexported is right. OK.

## 6. Reported numbers I could not independently reproduce
- api-c47/c05/c58/c36/stage6 browser runs were not repeated by me (no UI file changed; server full suite passes). The lane's c47 flake note (25/26 then 26/26) is plausible load; I have no evidence either way.
- The one-off before/after dump of `loadEvaluations` output: not repeated; relied on code reading plus the passing eval tests.

## Summary table

| id | severity | item |
|---|---|---|
| E1d-1 | should-fix | the content hash includes case ids, so renaming only the case ids buys a new holdout slot |
| H11b-1 | minor | `decideOnOrigin`/`loadGrants` take a caller `now` (no live caller) |
| H11b-2 | minor | presentation-only list omits stored app-clock writes (`auth/service.ts:44`, `missions/routes.ts:88,134`) |
| H14-1 | minor | "at most 8" counts only the test-owned pool; harness pools add more |
| H14-2 | minor | `peakClients <= 8` assertion is vacuous (pool max is 8) |
| H14-3 | minor | lock-wait observer is database-wide, not schema-scoped |
| N+1 | minor | count test does not cover still-per-proposal paths |
| E1d-2 | minor | base re-grade scope is strict (all authors on that version); matches the stated intent |
| E1d-3 | minor | ZWJ/ZWNJ/word joiner/soft hyphen and skill case not folded |
| E1d-4 | minor | same-content base slot: clearer error text |
