# c53 report: eval-run integrity (E1c)

Lane w52, branch `c53-eval-integrity`, from improve-30h at bfe891e. Records and validation only: no eval-run write route, no execution, no model or provider calls. Migration **0040**. No advisory locks added (row locks and a unique index only). No new contract field or route (refusal codes are plain strings in `EvalRefusalDto`).

## What was built (one commit per item)
1. **No re-run shopping across proposals** (`44c4058`). `eval_runs.holdout_key` is derived by the guard trigger (never taken from the caller) as `(tenant, agent, candidate_sha, dataset)` for a candidate run and `(tenant, base version, dataset)` for a base run, holdout datasets only. A second run is refused with `holdout_rerun: ... (run R, unfinished|finished); resume or finish that run, or freeze a fresh holdout dataset`. A partial unique index backs it for races. Migration backfills the first run per key and leaves legacy duplicates NULL. The loader's `runCount` now counts runs of any proposal with the same agent and config.
2. **Resumable runs** (`240a642`). States `open` (a result is missing, e.g. crash), `complete` (every case x attempt recorded; a failed attempt is a NULL score) and `finished` (immutable). SQL `eval_run_state`, `eval_run_missing` (the resume plan), `eval_finish_run` (locks the run, refuses unknown, finished and incomplete = `run_incomplete`). Wrappers in `server/src/evolution/eval-runs.ts` (`runState`, `missingResults`, `finishRun`, `existingRun`). The `holdout_rerun` message names the run to resume.
3. **Judge labels** (`6f23230`). `judgeFamily()` resolves through the c38 table (`tasks/review-rules.ts`) and throws `judge_label_missing | judge_label_unknown | judge_label_ambiguous`; `startRun()` calls it (and requires an evaluator) before the INSERT. The loader fails closed on rows written by anyone else: refusals `judge_label_unknown` and `candidate_family_unknown`; families compared are c38 vendors, so `us.anthropic.claude-3` judging a `claude-sonnet` candidate is now self-judging (L4 from the c47 review). The old exported `modelFamily` is unchanged.
4. **Number rendering** (`35fd5c0`). Chosen: accept a non-integer when `(n::float8)::text::numeric = n` (jsonb keeps exact decimal text, JS prints the shortest round-trip text, PG 12+ prints float8 the same way; `extra_float_digits=1` pinned on the function). Still refused: outside [1e-6, 1e21), integers above 2^53-1, non-shortest 17-digit decimals. Canonical text and hashes of everything already accepted are unchanged (fixed-vector test).
5. **`dev_holdout_reuse`** (`fef79fc`). A holdout case counts as shared only if its input is in a dev dataset the candidate ran on and is not generic (canonical text under 20 chars: `1`, `{}`, `null`, `"ok"`). Linked when shared >= max(2, 10% of holdout), capped at the holdout size. Case ids are not compared, so a renumbered copy is still caught.

## Evidence
Load average was 14-19 during every run below (heavy.sh gate, other lanes busy).
- **Item 1 RED** (`eval-integrity-db.test.ts`, unchanged code, migration missing): 8 failed, first error `AssertionError: expected [ Array(28) ] to include 40` (migration 0040 exists), then `promise resolved "Result{ command: 'INSERT'..." instead of rejecting` for "withdrawing and re-proposing the same config cannot buy a second run on the same holdout", "the refusal names the run to resume", "a second run by the same proposal is refused too", "base runs: one per base version and holdout dataset", "two writers racing...", "the key cannot be set or changed by a caller", "a finished run still counts". Loader test RED: `expected [] to include 'holdout_rerun'`. GREEN: 13/13.
- **Item 2 RED**: `Error: Cannot find module '../src/evolution/eval-runs.ts'` (whole file). GREEN: 20/20 (7 tests in the item).
- **Item 3 RED**: `judgeFamily is not a function` style failures, first `claude-sonnet-4 resolves to anthropic`, 16+ tests. GREEN: all.
- **Item 4 RED**: 9 failed, first `eval dataset N-1 has a value whose canonical form could differ ...` for `0.30000000000000004`, `0.8571428571428571`, `123456789012345.5`, `0.14285714285714285`, `[0.1,0.2,0.30000000000000004]`, `{"score":0.6666666666666666}`, `-0.30000000000000004`, `999999999999999.9` and the 2000-double property test. GREEN: all, including 10 refused shapes, a 300-value 15-18 digit property test (both sides exercised) and the session-setting test.
- **Item 5 RED**: 7 failed, first `expected [ 'dev_holdout_reuse' ] to not include 'dev_holdout_reuse'` (generic inputs `1`, `{}`, `"ok"`, `null`, `{"q":1}`, `"What is 2+2?"`, and one shared long input of twelve). GREEN: 11/11. The renumbered-ids true positive was RED only because of a fixture bug (fixed in the test).
- New tests: `eval-integrity-db.test.ts` 81. Server tsc clean.
- Full vitest (heavy.sh): 70 files, **2191 passed, 1 failed, 2 skipped**. Failures, none touching eval code:
  - `test/jobs.test.ts > concurrency > 20 parallel claimers over 50 jobs: each job is claimed exactly once, and the table agrees` failed in the full run and in a two-file rerun (load 19); it **passes alone** (`-t "20 parallel"`, 1 passed). No file I changed is involved.
  - `test/audit-chain.test.ts > GET /audit/verify`: `Error: admin connect failed {"code":"INTERNAL"...}` in the full run only; passes on rerun.
- Browser (heavy.sh, ports 10292/10293): `api-c05` 31/31, `api-stage6` 94/94, `api-c47` 26/26 on the second run. First run was 25/26: `FAIL with an evaluation on the card, its override field and Promote are visible without scrolling the panel` (layout check at load 17; passed on rerun, no UI code changed).

## Pass threshold
| Item | Status | Evidence |
|---|---|---|
| Items 1-5 RED then GREEN | PASS | see above, one commit each |
| c47 tests pass unchanged or are only tightened | PASS with changes, see Concerns | every assertion kept; fixtures and four tests adjusted for the new DB rule; one NASTY shape moved to accepted as item 4 requires |
| Full vitest and tsc | NOT MET strictly | tsc clean; vitest 2191/2192 run: `jobs.test.ts` 20-claimer test fails under load, passes alone; unrelated to this lane |
| api-c47, api-c05, api-stage6 | PASS | 26/26 (after one load flake), 31/31, 94/94 |
| Contract registry entries for any new field | PASS (none needed) | no route, DTO field or validator change |

## Files changed
- `server/migrations/0040_eval_integrity.{up,down}.sql`
- `server/src/evolution/eval-runs.ts` (new), `server/src/evolution/proposal-evidence.ts`
- `server/test/eval-integrity-db.test.ts` (new); edited `eval-evidence.test.ts`, `eval-evidence-db.test.ts`
- `web/scripts/api-c47.mjs`; `web/docs/improve/cycles/c53-report.md`

## Concerns
- **Edits to c47 tests** (all required by the new rules, assertions kept): `eval-evidence.test.ts` `evidence()` reuses an existing base run on a holdout and creates missing datasets; five tests moved to their own datasets (`HO-K2`, `HO-K2B`, `HO-MID`, `HO-LOSS`) because a base version now gets one run per holdout; the two holdout_rerun tests first assert the DB refuses the second run, then disable the run guard (as a superuser could) to keep exercising the loader refusal. `eval-evidence-db.test.ts`: SR-8 moved to its own dataset; `0.30000000000000004` removed from the "risky, refused" list since item 4 makes it a valid shape (it is now asserted as accepted). `api-c47.mjs`: judge `zzjudge-1` is not in the c38 table and candidate model `d.model` (a demo agent model) is not either, so it now uses `gpt-4o-judge` and `claude-sonnet-4`.
- **Behaviour change to flag:** a candidate or judge whose model name is not in the c38 vendor table can no longer reach `verified_better` (refusals `candidate_family_unknown` / `judge_label_unknown`). This is the "never default" rule, but demo agents' own models are unknown to the table, so real proposals with such models need the override path until the table is extended.
- Base cap is one base run per (base version, holdout dataset), shared by every proposal on that base. A holdout can still be reused for a differently-configured variant B after A's result is seen (brief scoped the count to the same config); "one use per agent" is not done.
- Judge validation is in the service (`startRun`) and in the loader, not a DB trigger (the table lives in TS). A raw INSERT with an unknown label is stored but read as refused.
- `dev_holdout_reuse` heuristics (20-char generic cutoff, 10% / 2 cases) are judgement calls; a short real prompt shared across both sets is treated as generic and not flagged.
- Migration backfill leaves legacy duplicate holdout runs (none expected, no writer existed) without a key; the loader still flags them via `runCount`.
