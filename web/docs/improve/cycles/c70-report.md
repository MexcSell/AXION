# c70 report: server hardening bundle (H11b, H14, E1d)

Lane w68, branch `c70-hardening`, from improve-30h at 812c185. Ports 11890-11893, e2e DB axion_e2e5. Migration 0052 used (E1d needs it). Three items, one commit each, each test-first.

## Item 1: H11b, remaining app-clock bounds (commit "fix(c70 H11b)")

New test `server/test/c70-clock.test.ts` uses the c54 method: the app `Date` is skewed one hour into the past for the request; rows are written with DB `now()`.

RED on the unchanged code (first error line of each):
- `GET /agents counts a task that finished a moment ago although the app clock is an hour behind`: `expected +0 to be 1`
- `an expiry that is already past by the database clock is refused ...`: `expected 201 to be 422` (an already-expired grant was issued)
- `the 30-day cap is measured from the database clock`: `expected 422 to be 201`
- `issued_at is written by the database clock`: `expected 3600.00561 to be less than 60` (issued_at off by one hour)
- `the listed state is judged by the database clock ...`: `expected 'active' to be 'expired'`
- `GET /approvals reports minutes to expiry by the database clock (60 min, not 120)`: `expected 120 to be less than or equal to 60`

GREEN: 6/6, plus agent-reliability, reliability, site-grants, grants-deny, approvals, c48-can-decide (142 tests) unchanged and passing.

What changed:
- `agents/reliability.ts`: `attachReliability` now uses c54's `dbWindow(c, '90d')`, read after the rows, so no loaded row is later than the window end. `reliabilityWindow` stays as a pure function but its `new Date()` default is gone (a required argument), so nobody can reach for the app clock by accident.
- `grants/routes.ts`: `issued_at` is written by SQL `now()`; "expiry in the future" and the 30-day cap are judged in one SQL statement against `now()`; the listed `state` comes from `g.expires_at <= now()` selected with the row (`db_expired`), not `Date.now()`.
- `approvals/routes.ts`: the approval DTO already judged expired/canDecide by `db_expired`; its minute figures (`expiresMin`, `agoMin`) used `Date.now()`. They now use the DB clock (`db_now_ms` selected in the same statement as the row), so the figures and the state can no longer disagree under skew. Honest note: the brief said the expiry state was on the app clock; in the code it was already DB-judged where `db_expired` is selected (every route path selects it). The RED is therefore on the minute figures, not the state.

Presentation-only app-clock sites left alone (no window bound, no comparison with stored times, no stored value): `notifications/routes.ts` `agoMin`; `missions/service.ts` `defaultPresentation` and `missionDto` (`now` default) and the `Date.now()` values passed from `missions/routes.ts` into presentation text; `conversations/service.ts` `messageDto`; `missions/staffing-sim.ts` simulation timestamps; `events/stream.ts` heartbeat; `ops/routes.ts` uptime and `checkedAt`; `ratelimit.ts` and `auth/service.ts` in-memory rate windows; `audit-anchor.ts` `anchoredAt` label (injectable); `decideRefusal(..., now = Date.now())` is only a fallback for rows read without `db_expired` (kept as a test override; no route uses it).

### loadEvaluations N+1
Test `server/test/c70-n1.test.ts` (6 proposals, each with its own holdout, base and candidate run).
- Before: 1 proposal = 7 queries, 6 proposals = 37 queries (6 per proposal + 1). RED: `expected 37 to be 7`.
- After: 1 proposal = 6, 6 proposals = 6. The runs query, run counts, base runs, cases, dataset validities and plain results are each one batched query for all proposals (`datasetValidities`, `caseRunsMany` are new batch helpers; `datasetValidity` now delegates to the batch one).
- Output is identical: the full `loadEvaluations` result for the 6 proposals was dumped before and after the refactor and compared byte for byte (identical); the 292 eval tests pass.
- Still per-proposal, only when needed: the dev/holdout overlap query (only when the candidate has dev runs) and a re-grade link lookup (only when graders differ).

## Item 2: H14, connection footprint (commit "test(c70 H14)")

`server/test/pool-probe.ts` (new): `watch(pool)` records the peak clients and peak busy clients; `lockWaits(observer, like)` polls `pg_stat_activity` from a separate connection for backends blocked on a lock.
- jobs.test.ts "20 parallel claimers over 50 jobs": 20 claimers, but the pool is `MAX_TEST_CONNECTIONS = 8`. New assertions: peak clients <= 8 and peak busy >= 4 (claimers really overlapped). Every original assertion is kept (50 claimed, each once, table agrees, both generations, more than one owner).
- approval-binding "20 concurrent consumes": the 20 consumes now go through their own pool of 8 (before: the app pool, 10). New assertions: peak clients <= 8, and at least one consumer was observed blocked on the `approval_requests ... for update` row lock at the same moment. All original assertions are kept (exactly one succeeds, 19 `APPROVAL_ALREADY_CONSUMED`, one event, `consumed_by`).
- RED (assertions added before the pool change): `connections this test opened: expected 20 to be less than or equal to 8` (jobs) and `expected 10 to be less than or equal to 8` (approval-binding). GREEN after the change; 6 repeat runs of both files: 5 clean, 1 failure `too many connections for role "axion"` (see concerns: the role cap is shared with every lane and a bounded test cannot make that impossible).
- Race proof note: claimJob uses `for update skip locked`, so claimers never wait on each other; the proof for it is the overlap count (peak busy), not lock waits. The consume path does wait on the row lock, so there the lock-wait count is the proof.

## Item 3: E1d, holdout shopping gaps (commit "feat(c70 E1d)", migration 0052)

New test `server/test/c70-holdout.test.ts` (28 tests). RED on the unchanged code (18 failed, 9 passed; the 9 are controls). Named probes and first error lines:
- Same content, new dataset id: `the same candidate config cannot run again on the same content under another dataset id`, `promise resolved ... instead of rejecting`; the base version variant likewise; the loader count: `expected 1 to be 2` (runCount); the race code: `expected { code: '23505' ...} to match { code: 'holdout_rerun' }`.
- Base re-grade by the author: `the author of a proposal whose base version this is cannot re-grade the base run`: `promise resolved "undefined" instead of rejecting`.
- Canonical config (8 probes, tab, NBSP, ideographic space, double space, tab inside, zero-width space, empty skill, whitespace-only skill, plus NFC vs NFD and an end-to-end re-proposal): each `expected '{"model": "\tclaude...` to be `'{"model": "claude...`.
- Repeat exemption: the review probe (12 long inputs, each twice, in dev and in the holdout) and the holdout-only variant: `expected [] to include 'dev_holdout_reuse'`.
- Migration: `expected [ Array(35) ] to include 52`.
- Kept and added: an explicit `grader: null` legacy run on both sides is unknown, `grader_unknown`, inconclusive.
GREEN: 28/28.

Migration 0052 (`0052_holdout_hardening.up/down.sql`):
- `eval_canon_name(text)`: NFC, every Unicode space (ASCII whitespace, NBSP, U+1680, U+2000-200B, U+2028/9, U+202F, U+205F, U+3000, U+FEFF, U+0085) collapsed to one space, ends trimmed. `eval_canon_config` uses it for the model (lower-cased), skills and tools, and drops empty names. Stricter only: configs that were the same stay the same.
- `eval_runs.holdout_content_key` plus unique index `eval_runs_holdout_content_once`, keyed on (tenant, agent and canonical config or base version, dataset `content_sha256`). The run guard fills it, refuses a second run with `holdout_rerun: ... has the same content as dataset X`, and treats it as immutable. Dev datasets are not limited.
- `eval_regrades_check`: a re-grade of a BASE run by anyone who authored a proposal on that base version is refused (`regrader_is_author`). Wider than "the proposal under test", because a base run has no single proposal.
- Backfill rebuilds `holdout_key` with the new canonical form and fills the content key; legacy duplicates (same content, same subject) keep NULL on the later run, as in 0040. Tested on legacy data. Down/up/down tested (`migration 0052` tests: the old canon returns on down, the new one on up).
- Loader (`proposal-evidence.ts`): `runCount` counts runs on datasets of the same content, and the dev/holdout repeat exemption now applies to short inputs only (canonical JSON text under `REPEAT_EXEMPT_MAX_LEN = 20`; a long input repeated on either side counts as a shared input; c53's threshold max(2, min(5, ceil(10%))) is unchanged). `existingRun` and `mapRunInsertError` follow the content key.
- OTel: the new column is mapped as `none` in `otel/mapping.ts` and `otel-mapping.md` was regenerated (a full-suite run caught it).

Existing tests changed (tightening, not loosening):
- `eval-audit.test.ts`: the base-run re-grade by the proposal author used to be accepted and merely not linked; it now must be refused (`regrader_is_author`). The test still asserts nothing is linked.
- `eval-integrity-db.test.ts` `reuseScenario`: each scenario's cases now carry a distinct `expected` value. The inputs under test are unchanged; without this the same holdout content hosted two base runs for the same version, which the new rule correctly refuses.

Still open (explicitly out of scope per the brief): variant B of a candidate evaluated on a holdout after A's result was seen; a re-created identical base version (new version id) gets a fresh base slot; dev runs by a withdrawn sibling proposal; a lightly edited copy of the holdout (different content hash) is not caught by the exact-hash key, only by the dev/holdout overlap rule.

## Threshold

| Item | Result | Evidence |
|---|---|---|
| 1 H11b RED then GREEN, no test loosened | PASS | 6 RED named above, GREEN 6/6 plus 142 related tests; N+1 7/37 queries to 6/6 with identical output |
| 2 H14 RED then GREEN, race still proved | PASS | footprint 20 and 10 to 8, overlap and lock-wait assertions added, all original assertions kept; see concern 1 about the shared cap |
| 3 E1d RED then GREEN, no test loosened | PASS | 18 RED, 28/28 GREEN, migration up/down on legacy data; two existing tests tightened or re-fixtured as listed |
| Full vitest, one parallel run | PASS | 114 files, 3009 tests, 0 failures (221 s). An earlier parallel run found 1 failure (`otel-mapping.test.ts > lists every column of every trace and task table`, the new column unmapped); fixed and committed |
| Full vitest, serial run (--maxWorkers=1 --no-file-parallelism) | PASS | 114 files, 3009 tests (514 s), 0 failures |
| tsc | PASS | `npx tsc --noEmit -p .` clean |
| api-c47, api-c05, api-c58, api-c36, api-stage6 | PASS | all five exit 0 on the final tree (ports 11892/11893): c47 26/26, c05 31/31, c58 exit 0 (no summary line printed), c36 35/35, stage6 94/94 (see concern 2 for the earlier c47 flake) |
| Migration down/up | PASS | `c70-holdout.test.ts > migration 0052` (two tests) |

## Files changed
Server source: `agents/reliability.ts`, `approvals/routes.ts`, `grants/routes.ts`, `evolution/proposal-evidence.ts`, `evolution/attestation.ts`, `evolution/eval-runs.ts`, `otel/mapping.ts`. Migration: `0052_holdout_hardening.up.sql`, `.down.sql`. Tests: new `c70-clock.test.ts`, `c70-n1.test.ts`, `c70-holdout.test.ts`, `pool-probe.ts`; edited `jobs.test.ts`, `approval-binding.test.ts`, `eval-audit.test.ts`, `eval-integrity-db.test.ts`. Docs: `phase2/otel-mapping.md` (regenerated), this report. No UI change, so no screenshots.

## Concerns
1. H14 is mitigated, not solved: a bounded test still needs connections from the shared 45-connection role. One of six repeat runs of the two files failed with `too many connections for role "axion"` while other lanes were running. The gate (heavy.sh) is still what keeps this rare. The footprint of these two tests dropped from 20 and 10 to at most 8 each.
2. The first api-c47 run (concurrent with the full vitest run) failed one layout check, `with an evaluation on the card, its override field and Promote are visible without scrolling the panel`, 25/26; a rerun alone passed 26/26. No UI file changed; I count it as load, but the controller may want to look if it recurs.
3. Content-hash keying is exact-hash only: change one character of one case and the hash differs. The dev/holdout overlap rule, not this key, is the defence against edited copies.
4. The base-run re-grade rule refuses any author of any proposal on that base version, including proposals long since decided. That is deliberately strict.
5. The new canonical form could in principle merge two legacy keys that were distinct; the backfill keeps the first and leaves the later run's key NULL (loader still counts it). The loader's `runCount` is what flags such legacy duplicates.
6. E1d items left open: variant B shopping, re-created identical base version, dev runs by a withdrawn sibling proposal (see above).
7. Approvals: the brief expected an app-clock expiry state in `approvalDto`; it was already DB-judged. Only the minute figures were fixed.
