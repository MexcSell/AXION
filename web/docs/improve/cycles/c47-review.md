# c47 review (E1b: evaluation evidence on agent version proposals)

Reviewer: independent. Lane `/home/luca/AXION-w46`, `09dd6cb..5f7e9a8`. Lane left at `5f7e9a8`, clean tree.

## Verdict: PASS-WITH-FIXES

No path found where a careless or dishonest actor, using only the application API, makes a candidate look better than its stored evidence or gets it past the gate. The verdict reads stored rows, the gate order is right, EVAL_WORSE cannot be overridden. Two claims in the report are wrong (freeze does not fail closed on hash mismatch), and promote should be bound to the evaluation the reviewer saw.

## Re-run (all in this lane, through heavy.sh)
- Server `tsc --noEmit`: clean.
- Full vitest: 51 files, 1502 tests, all pass. No advisory-lock 500s appeared this run.
- `api-c47` 24/24, `api-c05` 31/31, `api-stage6` 94/94 (ports 9692/9693). No page errors.

## Confirmed findings

### M1 (medium) Freeze does not fail closed when SQL and JS canonical forms differ
`server/migrations/0037_eval_evidence.up.sql:11-24` (`eval_canon`, key and case_id ordering) and `:34-44` (`eval_freeze_dataset`). The comment at line 9 and the report ("fails closed: ... makes a freeze refuse") are false. I wrote a throwaway property test (deleted afterwards) that freezes one case per shape and compares the stored hash with `hashDataset(stored rows)`:
- MATCH: nested objects with key order, arrays, null and booleans, small ints, floats (1.5, 0.1, -0.25, 1.10, 0.30000000000000004), -0 and -0.0, 1e5, 0.000001, unicode escapes, control characters, astral characters (escaped and raw), U+2028, empty key, duplicate keys, empty containers.
- MISMATCH and the freeze succeeds, storing a hash the loader will always flag:
  - integers above 2^53 (`9007199254740993`), 20-digit integers;
  - exponent forms `1e21`, `1e-7`; `1e400` (JS gives Infinity, null);
  - decimals with more digits than a double keeps (`0.3000000000000000444`);
  - object keys or case_ids where an astral character meets U+E000..U+FFFF: SQL `collate "C"` orders by code point, JS `sort()` by UTF-16 unit.
- `\u0000` is refused by jsonb itself, which is fine.
Scenario: a dataset containing one such value freezes without complaint, every run on it reads `hash_mismatch`, so the dataset is permanently inconclusive. This fails safe for the gate (it can only push toward the override path), but it is a silent dead dataset and contradicts the stated design. Fix: after computing `h` in `eval_freeze_dataset` and in the guard, also refuse when any stored number is not exactly representable as the JS double round-trip (e.g. `(x::double precision)::numeric <> x`, abs >= 1e21 or < 1e-6 non-zero), and when any key or case_id contains a code point >= U+10000 mixed with U+E000.. (or simply sort in SQL by UTF-16 units: `convert_to(k,'UTF16BE')`). Add each shape above to the DB test; the current test covers only six friendly shapes.

### M2 (medium) "Worse" only means sign-test worse; a mean-worse candidate can be promoted with a 10-character reason
`server/src/evolution/proposal-evidence.ts:84-85`. `worse` requires `not_better` and `losses > wins`. A candidate that wins many cases by tiny margins (> 0.5 pt tie band) and loses a few cases badly has wins > losses, p < 0.05 and a negative mean delta below the margin; `verdictV2` gives `not_better` ("mean gain below margin"), the loader shows `inconclusive`, and EVAL_WORSE is not raised. The admin can promote with any 10-character reason. The chip says "Inconclusive" with the negative mean in small text. Confirmed by reading the branch order in `verdict-v2.ts:176-195`. Fix: treat `ci.high < 0` or `delta < 0` with a significant result as `worse`, or show the delta sign in the chip when `delta < 0`.

### M3 (medium, design) Promote is not bound to the evaluation the reviewer saw
`server/src/agents/versions.ts:206-218`. See "evaluationSha: recommendation" below.

### L1 (low) `dev_holdout_reuse` can never fire
`proposal-evidence.ts:53-56`. `cand` prefers a holdout run, while `tuned` only holds dataset ids of the proposal's own dev runs. A holdout dataset is never in `tuned`. When `cand` is a dev run, `not_holdout` already fires. The test at `eval-evidence.test.ts:216` passes through `not_holdout`, not through the reuse rule. So the check that a candidate was tuned on its judge dataset has no real signal.

### L2 (low) Run choice is selection-prone
`proposal-evidence.ts:50-52`. The latest finished holdout run of any holdout dataset counts. Someone who can write runs can run again (or add a second, easier holdout dataset) until the latest run reads well; earlier bad runs vanish from the verdict. Base run is likewise the latest on that dataset. Fix: surface "N runs on this proposal" in the card, or evaluate the first finished run per dataset.

### L3 (low) Base run is not checked for honesty
`proposal-evidence.ts:58-60`. Only the candidate run's evaluator and judge are checked. A base run produced by the proposal's author, or by a different judge family, is accepted, so the author could weaken the baseline. The tenant and `base_version_id` binding are correct (an older base version cannot be mixed in; checked).

### L4 (low) Judge family and self-judging are label-based
`proposal-evidence.ts:24-28`. `modelFamily` takes the leading letters; judge `sonnet` against candidate `claude-sonnet` passes as a different family. The label is written by whoever records the run (no write route yet, so E1c must validate it).

### L5 (low, tests) Smaller points
- `version-proposals.test.ts` now always sends an override on promote, so no promote-without-override 409 remains in that file. The gate is covered in `eval-evidence.test.ts:263-310` (409 without override, short override, EVAL_WORSE with an override). No assertion was loosened.
- `eval-model.test.ts:81`: `.catch(() => undefined)` on `eval_freeze_dataset` in `beforeAll` swallows any freeze error (not only "already frozen"). Later assertions would still fail, but narrow it to the already-frozen message.
- Audit row on a successful promote records `outcome, n, datasetId, datasetSha` but not `baseRunId` / `candidateRunId`; add them (runs are immutable, so they fully identify the evidence).

### UI notes
- Screenshots `c47-screens/c47-development-1366x768.png` and `c47-decided-1366x768.png`: the page does not scroll, chip, n, numbers, refusal list and `?` are present and match the house style. But with an evaluation on the card the override field and Promote/Reject sit below the fold of the panel (the list scrolls inside its panel), so the main action is not visible at 1366x768.
- `c47-decided-1366x768.png` is mislabelled: it shows the "All" tab with two pending cards, not a decided card with the shown override reason (`VersionProposals.tsx:149`). The reason display is not evidenced by an image.
- DEMO mode: the sample evaluation carries a "Sample" chip with a title "Demo data: nothing was measured" (`VersionProposals.tsx:74`, `Agents.tsx:210-216, 266`). Good.

## Checked and fine
- Hash: SQL objects are sorted bytewise, arrays kept in order, `trim_scale` handles `1.0` and `-0`; `\u0000` refused. `eval_freeze_dataset` is SECURITY INVOKER (default), no search_path override, locks the dataset row `FOR UPDATE` and hashes in the same statement. Residual (low, not exploitable through the app, which has no ad-hoc SQL): unqualified table names resolve through `pg_temp` first, so a session could shadow `eval_cases` with a temp table and freeze a hash of fake cases; the loader would still flag the real content, so it fails closed at read time.
- Serialisation: `eval_cases_guard` takes the dataset row `FOR SHARE`, freeze takes `FOR UPDATE`; the two-connection tests at `eval-evidence-db.test.ts:101,120` exercise it. Zero-case freeze refused by both the function and the trigger. Insert of an already frozen dataset refused. The eval_results trigger from 0027 requires every result's case to be in the run's dataset, so padding with extra case ids is not possible (I checked this because `gaps()` only checks dataset ids).
- Loader: dataset bound by id from the run row; `observedSha256` recomputed from stored cases; judge/evaluator from the run row, author from the proposal row; requests are `.strict()`. Pairing is by case id with unequal attempts and unpaired cases refused; `partial_coverage` compares each run's own `k`. Runs of another tenant or proposal cannot attach: CHECK `(subject_version_id is null) <> (subject_proposal_id is null)` plus tenant checks in `eval_runs_guard` for both subject kinds; the proposal runs are read by `subject_proposal_id = p.id`, the base runs by the proposal's `base_version_id`.
- Gate order: SELF_APPROVAL, not-pending, AGENT_CHANGED, PROPOSAL_CHANGED, EXPIRED, then EVAL_WORSE, then EVAL_OVERRIDE_REQUIRED (`versions.ts:182-218`). EVAL_WORSE is checked before the override is read, so no override passes it. Override is trimmed, minimum 10, DB CHECK repeats it, reason is audited on promote (and stored on the proposal); override sent with reject is dropped. Refusals are audited as denied with the evaluation seen.

## evaluationSha: recommendation YES
Reasons: (1) the reviewer's decision (and any override text) is made against what the card showed; between review and click a new finished run (honest or not) can flip the outcome, either granting a promote without an override or newly demanding one, and the existing `PROPOSAL_CHANGED` precedent already says the decision must be bound to what was reviewed. (2) Combined with L2, a late run is the cheapest way to change what the gate sees. (3) Runs are append-only and finished, so the fingerprint is cheap and stable: hash of `{candidateRunId, baseRunId, datasetId, datasetSha, outcome, refusals codes}`; use a fixed sentinel when there is no evaluation. Implement as `evaluationSha` in the decision body (required for promote), computed server-side by the same loader, checked after the expiry check and before the gate: 409 `EVALUATION_CHANGED` ("The evidence changed since you looked. Reload and review again."), audited like the others. Also store the run ids in the audit row (L5). Cost: one field in the DTO and the web call; the tests that send an override gain the field.

## Fix list before merge
1. M1: make freeze refuse non-matching shapes (or match JS), and extend the DB test with the failing shapes; correct the migration comment and report.
2. M3: add `evaluationSha` / `EVALUATION_CHANGED` (recommended in this cycle, acceptable as an immediate follow-up).
3. M2: surface or refuse a negative-mean significant result.
4. Optional: L1 to L5 and the screenshot relabel.

## Known flake note
No advisory-lock 5 s 500s occurred in the full vitest run here.
