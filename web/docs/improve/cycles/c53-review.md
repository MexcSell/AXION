# c53 review: eval-run integrity (E1c), branch c53-eval-integrity, bfe891e..fbbebce

Reviewer method: read brief/report/c47+c38 files/diff; probed the migrated schema with throw-away vitest files in scratch worktrees of fbbebce and bfe891e (both removed afterwards; the lane worktree was not edited); ran heavy runs through heavy.sh. All probe output below was observed, not inferred, unless marked "by reading".

## Verdict: CLEAR AFTER FIXES

No blocker. Items 3, 4 and 8 hold. Item 1 closes the exact bypass in the brief (withdraw and re-propose the same sha) but has real gaps; item 5's heuristic misses a true positive that matters; item 2 has a direct-UPDATE hole. Fixes F1 to F3 below are required, F4 to F6 recommended.

## Findings

### F1 (should-fix) Item 1: the key is built from a non-canonical sha, so a trivially different re-proposal buys a fresh holdout run
`proposal-evidence.ts`/`versions.ts:43,157`: `normalizeConfig` only trims and de-dups, keeping order; `promptHash` hashes `JSON.stringify({model, skills, tools})`. `configDiff` treats skills/tools as sets ("a different order is no change") and `DUPLICATE_PROPOSAL` only matches the same sha. So the same effective config in another skills order, or with a differently-cased model, gets a different `candidate_sha` and a different holdout_key.
Evidence (probe on migrated schema, same holdout H1, P1 already has run R1 with sha `shaX`):
- proposal P3 `skills ["b","a"]` (same set as `["a","b"]`), sha `shaY`: `insert into eval_runs ... 'H1','P3'` succeeded (no holdout_rerun).
- proposal P4 model `Claude-Sonnet-4` vs `claude-sonnet-4`: succeeded.
- sha case variant `SHAX` vs `shaX`: succeeded (only reachable by a raw writer, since the server writes lowercase hex).
Fix: derive the key from a canonical config computed in the trigger from the stored `candidate` jsonb (lower-cased trimmed model, sorted distinct skills, sorted distinct tools), not from `candidate_sha`; or canonicalise in `normalizeConfig` before hashing (this also fixes the pre-existing DUPLICATE_PROPOSAL gap). Add the reorder and case cases to the item-1 tests.

### F2 (should-fix) Item 1: proposal key columns are mutable after a run
`agent_version_proposals` has no immutability trigger. Probe: after R1 on H1 for P1, `update agent_version_proposals set candidate_sha='fresh' where id='P1'` succeeded, and a new run `insert ... 'H1','P1'` then succeeded (second run on the same holdout for the same proposal). Same for `agent_id`/`candidate` by reading. The eval_runs side is solid (holdout_key spoof on INSERT is overwritten; `update eval_runs set holdout_key=null, finished_at=now()` is refused). Fix: a BEFORE UPDATE trigger on agent_version_proposals refusing changes to tenant_id, agent_id, candidate, candidate_sha, base_version_id once an eval_run references the proposal (or always; no code updates them).

### F3 (should-fix) Item 2: a run can be finished incomplete by a direct UPDATE; `eval_finish_run` is advisory
`eval_runs_guard` (0040 up, UPDATE branch) allows `finished_at` to be set by anyone without checking completeness. Probe: run R1 with zero results, `update eval_runs set finished_at=now() where id='R1'` succeeded, `eval_run_state('R1')` returned `finished`. `eval_finish_run` itself is correct (refuses unknown, finished, and incomplete with `run_incomplete`; two racing finishers: one wins; verified 2 missing -> refused, then complete -> finished, then missing-of-finished raises). Immutability is correct: finished_at cannot be changed or cleared, results cannot be added to a finished run, DELETE and TRUNCATE refused. The report/migration comment call `eval_finish_run` "the one way to finish"; the DB does not enforce that. The loader still fails closed through `partial_coverage`, so this is not exploitable for a verdict, but a "SQL-enforced, any writer" claim is not met. Fix: in the guard's UPDATE branch require no missing (case, attempt) (will need the c47 partial-coverage fixtures to use the existing `alter table ... disable trigger` helper, as the lane already did for holdout_rerun), or change the comment/report to say finishing is not exclusive and the loader is the backstop. The state machine is otherwise closed: open -> complete -> finished, no reopen.

### F4 (should-fix) Item 5: `dev_holdout_reuse` misses a wholesale copy when inputs are short
`proposal-evidence.ts` query counts only holdout cases whose `input::text` length is >= 20 and counts cases, not distinct inputs. Probe of the exact SQL and rule:
- 30 distinct short arithmetic prompts (`"11*7"` ...), holdout identical to dev: shared 0 of 30, not flagged.
- 8 identical short sentiment inputs (`"great product"` ...): shared 0 of 8, not flagged.
- 9 of 100 long holdout inputs copied into dev: shared 9, needs max(2, 10) = 10, not flagged. 1 of 12 copied: not flagged (the lane's own test treats that as intended).
True positives now missed: any dataset of short prompts (classification, arithmetic, short Q&A, single-word translation) copied from dev to holdout; and any leak under 10% of a large holdout. The 20-char cut is also applied to jsonb text (with spaces, so `{"a":1,"b":[2,3]}` is 21, not 17), not to the canonical text the comments describe.
Fix: do not exempt short inputs by length alone; count DISTINCT shared inputs and exempt only inputs that repeat across cases (a generic value like `1` repeated 12 times is one distinct input), or flag when a high share (for example >= 50% of the holdout, at least 5 distinct) is shared regardless of length. Consider an absolute floor for large holdouts (for example 5 distinct long inputs). Keep the existing tests; add the three probes above as tests. The constants are defensible only as "judgement calls", the report says so; the 100% short-copy case is the one that must be fixed.
All c47 true-positive tests are intact: `eval-evidence.test.ts:223` (not_holdout + dev_holdout_reuse) and `:268` (shared inputTag) are unchanged; verdict-v2 tests untouched; 56/56 in eval-evidence.test.ts passed on the head.

### F5 (minor) Item 1: race loser gets an unnamed constraint error
Two transactions inserting the same key: the second waits on the unique index and fails with `23505 duplicate key value violates unique constraint "eval_runs_holdout_once"`, not `holdout_rerun` (probe with two connections, begin/insert/insert/commit). The lane's race test only counts winners (`eval-integrity-db.test.ts:77-81`), and its Promise.allSettled calls mostly serialise. One writer still wins, so integrity holds; the brief asked for a named refusal. A future writer should map 23505 on that index to `holdout_rerun`, or the trigger should take a lock on the key (scope the key by `current_schema()` per LESSONS).

### F6 (minor) Item 1: scope gaps to record (not defects of the lane)
- Same content under a different dataset id: `H1` and `H1copy` (same cases) have equal `content_sha256`; a run on the copy by the same proposal succeeded. Keying on `content_sha256` would close it; the brief scoped it to dataset id.
- Variant B of a candidate can use a holdout after A's result (report says so; brief scope).
- Base key is per version id: a re-created identical version gets a fresh base slot. After promotion, the promoted version can be run as a base on the holdout the candidate already used (separate key; not a candidate shopping route).
- `devIds` in the loader still come from the proposal's own runs while `runCount` is now cross-proposal; dev tuning done under a withdrawn sibling proposal is not seen by the reuse check.
- Legacy duplicate holdout runs get a NULL key (backfill); the loader's runCount still flags them. `axion.purge_demo` still permits delete and re-insert, as for every append-only table (demo cleanup, unchanged); TRUNCATE is refused (`eval_runs is append-only`, probe).

### Item 1 other checks (pass)
- Different tenant: key contains `new.tenant_id`, and tenant must equal the proposal's/dataset's, so no cross-tenant collision or bypass. NULLs: `candidate_sha` is NOT NULL; a NULL inside `jsonb_build_array` still yields a key, so NULLs collide (stricter, not looser). Both subjects set: refused by `eval_runs_one_subject`. Same proposal twice: `holdout_rerun ... (run R1, unfinished)`. Spoofed `holdout_key` on insert: overwritten by the trigger (the trigger set it to null then to the derived key; the second insert was refused with holdout_rerun naming R2). Dev datasets: two runs allowed, as intended. DELETE refused; TRUNCATE refused; guards intact.

### Item 3 (pass) Judge labels
Only one reader of `judge_model_family` exists in `server/src`: `loadEvaluations` (grep: proposal-evidence.ts lines 36, 62, 88-89, 96, 104, 118, 123). It fails closed: unknown candidate judge -> `judge_label_unknown`, unknown candidate model -> `candidate_family_unknown`, unknown or missing base judge -> `base_self_judging`; refusals force inconclusive. Probes of `judgeFamily`: `anthropic/gpt-4` ambiguous, `sonnet`, `my-claude`, `o3mini` unknown, `us.anthropic.claude-3` and `openrouter/gpt-4` resolve, empty missing. Raw INSERT with an unknown label is stored and read as refused, as the report says; a DB trigger is not possible because the table is in TS. Note: the loader reports ambiguous labels as `judge_label_unknown` (vendorOf returns null for both); fine, same fail-closed effect.
Consistency: c38 `modelFamily` is the trust boundary (unknown family cannot review, `reviews.ts:103`); c47 L4 asked for exactly this. Behaviour change is real and consistent: models outside the table (for example kimi, glm, falcon, granite, yi) can never reach `verified_better`, only the override path. Minor note: verdicts are computed on read, so extending the table later silently changes old evaluations' refusals and evaluationSha; acceptable but worth one line in the docs.

### Item 4 (pass) Number rendering
Condition `(n::float8)::text::numeric = n` (non-integer, abs in [1e-6, 1e21)) is exactly "the decimal equals the shortest round-trip text of its double", which is what JS prints. Evidence, with the pinned function, 100k generated values per `extra_float_digits` setting (1, 0, 3, -4), mixing random bit-pattern doubles, random 1-19 digit decimals, exponent-scale doubles and float32-derived values: 0 cases where SQL accepted a value whose `eval_canon` differs from `JSON.stringify(JSON.parse(text))` (about 63k accepted per setting). Edge values (observed): `-0.0` accepted, SQL "0" = JS "0"; `0.000001`/`1e-6` accepted; `0.0000009999999999999999` refused; `5e-324`, `2.2250738585072014e-308`, `1.7976931348623157e308` refused (outside range); `1e21`, `999999999999999999999.9` refused; `0.30000000000000004` accepted; `0.30000000000000003`, `0.3000000000000000444`, `0.1000000000000000055511151231257827`, `1.00000000000000011`, `0.99999999999999989` refused; `4503599627370495.5` accepted (JS prints same), `4503599627370496.5` and `9007199254740991.5` refused; `0.1e1`, `1E+2` canonical equal. `extra_float_digits` is pinned by `set extra_float_digits = 1` on the function, so session values cannot change the result (settings 0, 3, -4 gave identical outcomes). Regression check: against the 0037 definition on 150k generated decimals, old-accepted-now-refused = 0 (newly accepted about 50k), so the evaluation hash of every previously accepted dataset is unchanged (eval_canon is untouched). Dependency note (minor): the shortest-digit output needs PG 12 or later (16.15 here); on an older server the equality would fail, i.e. refuse, so it still fails closed.

### Item 6: test edits (all legitimate adaptations; no assertion loosened; two minor notes)
- `eval-evidence.test.ts` `evidence()`: reuses an existing base run on a holdout. I instrumented it: 13 reuses in the file. In 12 the reused base had the same scores as requested (`[40]*12`) and the last matched (`[70,71,72...]`), so no test silently got a different baseline. Minor: the helper ignores `b` and `o.base` on reuse; in the judge/evaluator tests (`'Qwen-max'`, `null`, evaluator=author) the base run now keeps the default honest judge/evaluator, so those tests no longer also trigger base-side refusals. They assert candidate-side codes with `toContain`, so coverage of what they name is unchanged. Suggest an assertion in the helper that a reused base has the requested scores.
- Five tests moved to their own datasets (HO-K2, HO-K2B, HO-MID, HO-LOSS, SR-8 to R-DS8): required by one-base-run-per-holdout; assertions identical.
- The two `holdout_rerun` loader tests now first assert the DB refuses the second run, then disable `eval_runs_guard` to keep exercising the loader: a tightening (more assertions), same loader assertions.
- `eval-evidence-db.test.ts`: `0.30000000000000004` moved from "refused" to accepted (item 4 requires it; asserted accepted in the new file). Every other refused shape stays.
- `api-c47.mjs`: judge `zzjudge-1` to `gpt-4o-judge`, candidate model from `d.model` to `claude-sonnet-4`. Needed so the vendor table resolves; no browser assertion depends on the model or judge text (grep). I did not rerun the browser suite; the lane reports 26/26 on the second run.
- Test run on the head commit: eval-evidence 56/56, eval-evidence-db and verdict-v2 pass, eval-integrity-db 81/81 (one attempt hit `too many connections for role "axion"`, see F7). `tsc --noEmit` in the lane worktree is clean.

### F7 (not caused by c53) The two full-suite failures are environmental
Cause is connection exhaustion on the shared role. In the failing runs: `error: too many connections for role "axion"` (at `claimJob`, `jobs.test.ts:561`, and as the whole-suite failure `jobs.test.ts [ ... ]`); `admin connect failed` is the same cause surfacing as a 500 in `helpers.ts:73`.
Paired runs through heavy.sh, base bfe891e vs head fbbebce, alternating, no other work of mine running (load average printed):
- jobs.test.ts only: run1 head load 18.1 fail 20-claimers (1 failed); base load 22.4 fail 20-claimers (1 failed); run2 head load 20.3 whole suite failed (too many connections), base load 20.3 17 failed; run3 head load 20.7 2 failed (20-claimers + stress), base load 20.4 3 failed.
- jobs.test.ts + audit-chain.test.ts, five rounds at load 13.7 to 15.8: base failed 20-claimers in 4 of 5 rounds (plus stress, M1/M2 audit tests, `GET /audit/verify` admin connect failed in rounds 3 and 5); head failed the same set in 4 of 5 rounds (rounds 1 and 2 of the head were worse while I was running my own probes at the same time, which I count against my interference, not the code).
c53 cannot cause either: migration 0040 only touches `eval_runs`, `eval_json_bad` and new eval_* functions; no shared trigger, no advisory lock (the lane added none), no new pool use. Both tests fail on the unmodified base under the same load. Recommend recording them in MERGES.md by name, as LESSONS asks, and a retry or a lower claimer count is a separate hygiene cycle.

### Item 8 (pass) Contracts
No change in `shared/` or `web/src` (diff --stat empty). `EvalRefusalDto` is `{ code: string; detail: string }` (`shared/contracts/src/agents.ts:105`), so the new codes (`holdout_rerun` message text, `judge_label_unknown`, `candidate_family_unknown`, `run_incomplete`) need no registry entry; no route, DTO field or validator added, and `eval-runs.ts` is not wired to any route (`startRun` has no caller).

## Required fixes before merge
1. F1: canonical config key (or canonical sha) so reordering skills or changing model case cannot buy a fresh run; add tests.
2. F2: make the proposal's key columns immutable (trigger) with a test.
3. F3: enforce completeness on finishing in the guard, or state in the report/comment that finishing is not exclusive. (Either is acceptable; the claim must match the code.)
4. F4: fix `dev_holdout_reuse` so a full copy of short inputs is flagged (count distinct shared inputs; exempt only repeated generic values); add the three probe cases as tests.
Recommended: F5 (named code on the race loser), the evidence() reuse assertion, F6 notes into BACKLOG (content-hash key, one use per agent).

---

# Re-review (fix round), fbbebce..2d23cca

Method: scratch worktree of 2d23cca (removed), my earlier probes re-run plus new ones, heavy.sh. Touched suites on the tip: eval-integrity-db, eval-evidence, eval-evidence-db, eval-model, version-proposals, verdict-v2: 7 files, 263 tests, all passed (including my probe file).

## Verdict: CLEAR
All four required fixes (F1 to F4) and F5 are closed. Remaining items are minor and recorded below.

## F1 (closed) canonical key
Both earlier probes now refuse with `holdout_rerun` naming R1: skills reordered, model `Claude-Sonnet-4`, a sha spelt `SHAX`. Further attempts to break `eval_canon_config`, all refused as the same config: model with surrounding spaces, duplicate skills, candidate key order, extra unknown key, `tools` missing, `tools: null`, skills with surrounding spaces. `skills: null`, missing and `[null]` canonicalise identically. A genuinely different skill set gets its own slot (OK).
Not collapsed (minor, raw-writer only): model with a leading tab or NBSP, an empty-string skill, `skills` given as a string, and NFC vs NFD spellings of a skill. The API path cannot produce these (`normalizeConfig` uses JS `trim()` and drops empties before the row is written), but SQL `btrim` trims only spaces, so the SQL canonical form is narrower than the application's. Suggest `regexp_replace(x, '^\s+|\s+$', '', 'g')` and dropping empty skills. Skill case is kept distinct (matches the app, which does not lower-case skills). Dataset copy under another id is still the known F6 gap.

## F2 (closed) proposal immutability
`candidate_sha` and `candidate` updates are refused (`immutable`). Status change and a no-op `candidate = candidate` update work. Updating `id` and deleting a proposal that has a run are blocked by the FK. TRUNCATE of the proposals table fails (`cannot truncate a table referenced in a foreign key constraint`, FK from eval_runs), and a proposal without runs can still be deleted, as before. So skipping a DELETE/TRUNCATE guard is acceptable: nothing keyed to a run can disappear, and the key is built from the run's proposal row, which is now immutable. (A proposal with no runs holds no slot.) The `purge_demo` order (runs first, then proposals) is unchanged.

## F3 (closed)
Plain `UPDATE eval_runs SET finished_at` on a run with 2 missing results: refused `run_incomplete`; `eval_finish_run` also refused; after both results are recorded (one a NULL-score failed attempt) the plain UPDATE succeeds; re-finishing and finishing together with `k = 2` are refused as append-only. api-c47 still finishes runs with an UPDATE (`api-c47.mjs:60`); the lane reports it 26/26, so its runs are complete (not rerun by me).

## F4 (closed, one minor)
My probes through the lane's exact SQL and threshold:
- 30 short arithmetic prompts copied: shared 30/30, flagged. 8 short sentiment inputs: flagged. 9 of 100 long: flagged.
- 1 of 12: not flagged; 2 of 12: flagged. 4 of 100: not flagged; 5 of 100 would be.
- `"What is 2+2?"` x12 in both, and `1`/`{}` repeated: not flagged.
All c47 true-positive tests unchanged and passing (eval-evidence 56, verdict-v2).
Threshold max(2, min(5, ceil(10%))): sound as a rule of thumb. It is a count rule, so a large holdout needs only 5 distinct shared inputs; 5 of 1000 flagged in my probe. That is strict (a chance overlap of five common short prompts makes a candidate permanently inconclusive, with the override path as the remedy), but fails safe, and the lane documents it as a judgement call.
Minor: the repeat exemption can be used to hide a leak. A holdout with each of 12 long inputs twice (24 cases), with dev the same: shared 0, not flagged; likewise dev with each input twice. Exact-match detection is already evaded by any trivial edit, so this is not a regression of the guarantee, but consider exempting a repeated input only when it is short (for example canonical length < 20), or counting repeated long inputs as shared.

## F5 (closed)
Two transactions through `startRun` on the same canonical config (the loser a reordered/duplicated variant, different proposal): the loser got `HoldoutRerunError`, `code = 'holdout_rerun'`. The mapping lives in `startRun`/`mapRunInsertError`; a raw INSERT still raises `23505` on `eval_runs_holdout_once` (any future writer must use the helper). Fine.

## Test edits forced by the fixes
- `version-proposals.test.ts` tampers a stored candidate with the identity trigger disabled: legitimate, and tighter. It first asserts the trigger refuses the edit, then disables the trigger inside try/finally (re-enabled) so `PROPOSAL_CHANGED` (409) is still tested with identical assertions for both tampers.
- `eval-model.test.ts` "a run can be finished once": legitimate, a tightening. Same assertions kept, plus a `run_incomplete` refusal, and the missing results are filled from `eval_run_missing` before the finish.
- `eval-fixtures.ts` `partialFinish`: legitimate. Opt-in, used only by the cherry-picked-cases loader test (`HO-PC`), switches the guard off for one UPDATE inside a transaction and re-enables it before commit, rolled back on error. No default behaviour changed.
- `eval-evidence.test.ts` helper: tighter, not looser; it now throws when a reused base run has different scores, judge or evaluator, and five tests got their own datasets (HO-J1, HO-J2, HO-EA, HO-PC, HO-FK) with unchanged assertions. This resolves my earlier minor note.

## Down migration (safe)
`down 39, up, down 39, down 39` ran without error on a populated schema (second down is a no-op thanks to `drop ... if exists`); after down, `eval_canon_config` is gone and no `agent_version_proposals_identity` trigger remains in the schema; up again works. Order is right: the guard is restored to the 0037 version before the helper functions are dropped. Note for the controller: 0040 was edited in place after being applied to axion_e2e18, which is fine only because 0040 is unmerged; any database that applied the earlier 0040 would need a down/up.

## Remaining (all minor, no blockers)
1. SQL `btrim` vs JS `trim`, empty skills in `eval_canon_config` (raw writers only).
2. Repeat exemption in F4 can hide a duplicated-input leak.
3. Same dataset content under another id (F6, unchanged), variant B on a used holdout, `startRun` is the only path that names the race refusal.
