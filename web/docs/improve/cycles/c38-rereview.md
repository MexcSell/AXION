# c38 re-review (after the fix round)

Branch c38-task-reviews, fix tip e54baec (first review at 7da99ba), worktree /home/luca/AXION-w36. Read only.
Ran `vitest run task-review-rules task-reviews scorecard-reviews`: 3 files, 81 tests, all pass. modelFamily probed with `npx tsx` (about 85 names).

**Verdict: CLEAR.** 0 Important, 4 Minor. Nothing was loosened.

## 1. modelFamily probe
All the first review's cases now give one family per vendor: gpt-4o, openai/gpt-4o, chatgpt-4o, o1-mini, o3, o4-mini, text-davinci, whisper, azure/gpt-4o and GPT-4o are all openai. gemini-2, gemma-3, palm, text-bison, models/gemini-pro and vertex/gemini-pro are google. mistral, mixtral, codestral and mistralai/Mixtral-8x7B are mistral. claude-3-5, anthropic.claude-3, us.anthropic.claude-3-5-sonnet, openrouter/anthropic/claude-3 and ` claude-opus-5-5 ` (trimmed) are anthropic. meta-llama/Llama-3-70b and ollama/llama3 are meta. `claude` and `claude-` are anthropic. text-davinci (openai) and text-bison (google) differ.
Unknown gives null: `my-claude-proxy`, `ft:gpt-4o:org:custom`, `gptx`, `o`, empty, `5-turbo`, `o3mini`, `global.anthropic.claude-3`, `commander-x`, `phish`, `titanic`, `ayahuasca`, `novaplex`, 10 kB of `x`, and `claude` followed by 10 kB of `x`.
No same-vendor split and no cross-vendor merge among known names. The null cases are fail-closed, so two agents on `ft:gpt-4o...` or `global.anthropic...` simply cannot review each other. 10 kB input and 100k-segment input run in 0 ms (no backtracking).

## 2. Can "the lineage must start the name" be bypassed?
Embedding does not work: `my-claude-proxy` is null, and `gpt-proxy/my-claude` is null (the part after the last `/` is what is tested).
What does match is anything that starts with a lineage token, whatever follows, because the lookahead only rejects a following LETTER:
- **Minor** `server/src/tasks/review-rules.ts:30` (the `(?![a-z])` lookahead). `o3-something-else-vendor`, `o3-claude`, `gpt-llama` give openai; `o10`, `o1.5`, `o19` give openai (the digit after `o1` passes the lookahead), while `o2` is null. Harmless for independence, since the name's start is the declared lineage and the match is deterministic, but the `o` rule is looser than the table suggests. Tighten with `(?![a-z0-9])` for the o-series, or list `o1`, `o3`, `o4` as exact or `-`-terminated tokens.
- **Minor** `review-rules.ts:29`. Router prefixes are dropped, not checked: `anthropic/gpt-4` is openai and `a/a/gpt-4` is openai. The lineage follows the model name and not the router, which is a defensible choice. The trust is in whoever sets `agent_versions.model` (any 1-120 char string); that is the same boundary as before.

## 3. I2 (reviewable statuses and the race)
- Matrix (`reviews.ts:28-36`, `reviewable()`): `passed` takes all verdicts; `failed` takes rejected and changes_requested only; created, ready, running, waiting_agent, waiting_user, verifying, retry_ready and canceled are 409 TASK_NOT_REVIEWABLE for every verdict. The test (`task-reviews.test.ts`, "which tasks can be reviewed") runs all 10 statuses x 3 verdicts over HTTP and checks that no row is written on refusal. GET returns `taskStatus`, `canAccept` and a refused `canReview`; also tested. The status names match `machine.ts`.
- Race: handled. `recordReview` reads `t.status` from the same `visibleTaskRow(..., lock=true)` (`for update of t`) that precedes the insert, in one transaction, and the check is made on that locked row. `tasks/routes.ts:65,73` change status or owner with `update ... where status=$from` (a compare-and-set), which waits for the row lock; so a status change either commits before the review (the review then sees the new status, READ COMMITTED re-reads the locked row) or after it (the review stands, and the scorecard handles the later change). There is no race test (a concurrent test would need two transactions); the argument rests on the lock and is sound.
- Scorecard (`scorecard.ts` ~101-105): latest review per task as of `to`, placed in the window by that review's time, counted only if verdict is accepted, evidence >= 1, reviewer is not the producer, reviewer is not the stored `principalId`, and the task's CURRENT status is `passed`. The task-status map is built from `loadInput`'s tasks query, which has no status filter (`company/routes.ts:29`), so a missing task is just undefined and is not counted (fail closed). `n` still counts every task reviewed in the window, so n >= value; this is what the 10-status fixture asserts (value 1, n 10). A retry after acceptance un-verifies the task (tested with `retry_ready`). A task that is retried and then passes again is verified again by the OLD accepted review, because the latest review still wins. Minor, see below.
- **Minor** `scorecard.ts` (nTaskVerified). A task accepted, then failed, retried and passed again with no new review counts as verified again from the old review, which saw the earlier attempt's work. Either require `review.at` to be after the task's latest attempt start (tasks/attempts are in the input), or document that a re-passed task needs a fresh review. Low impact, the review window is also the date used.

## 4. M1 (earlier-attempt actors) is fail-open when audit rows are missing
`reviews.ts:50-57` (`priorActors`) takes agents from (a) `mission_delegations.to_instance` for the task, and (b) `task.reassign` audit rows: `fromAgent` and the agent of `fromInstanceId`. It is fail-open in these cases:
- `task_attempts` has no actor column (`0007_instances.up.sql:45`), so attempts cannot be used as a source.
- The original owner, if set at creation or by seed/fixture and then changed by anything other than the `reassign` route (raw SQL, a migration, a future route), leaves no row. Reassign always writes the audit row in the same transaction (`routes.ts:69,~80`), so through the product the coverage is good; delegations only name the TARGET of a hand-over (the code comment at `routes.ts:69` says the delegation row names the lead, not the previous owner), which is why (b) is needed.
- Audit retention or purge would silently drop prior actors (demo clear does not delete audit rows).
- Not covered at all: an agent that acted on a task without owning it (no source records that).
Judgement: **acceptable for this cycle**. It is an extra rule layered on the current-owner and model-family rules, the two agent-review paths are not reachable from HTTP, and the failure mode is "an earlier owner of a different model family can review", not a wider hole. It is not a guarantee, and the help text and report should not call it one.
- **Minor** `reviews.ts:50`. To make it fail-closed: (1) record owner history in the same place the owner changes, an append-only `task_owners(task_id, agent_id, instance_id, from_at, to_at)` written by a trigger on `tasks` when `owner_agent` or `owner_instance_id` changes (so a raw UPDATE also records), and read it instead of audit; or (2) cheaper, refuse an AGENT reviewer whenever the task has more than one attempt or any `task.reassign` audit row and the prior owner cannot be resolved to an agent id (count of reassign rows > count of resolved ids), and allow only a human reviewer in that case. Either way the ownership history should be a data row with a constraint, not a log read.

## 5. Nothing loosened; tests assert what the report claims
- M2: loader now selects `principal_id`; scorecard compares the stored principal; the test changes the mission owner and shows P1 (principal = reviewer) excluded and P2 (another principal) counted.
- M3: `security.test.ts:45` adds `POST /api/v1/tasks/:id/reviews` to `SINCE_STAGE5_WRITES`; it is in the file and the suite passes.
- M4: `roles.ts` chip is now "Passed" (one label); the dialog refuses accepting a non-passed task with the status named.
- M5: DEMO test seeds demo, reviews a demo task, checks includeDemo=0 unchanged and includeDemo=1 gives +1 value and +1 n. It has a stray unused-looking `dm` variable (harmless).
- M1 test covers both paths (delegation and reassign audit) with controls (unrelated agent and a human can review). It inserts the audit row by hand, so it proves the rule, not that the route writes the row the rule reads; the route code at `routes.ts:69` does write `fromAgent`/`fromInstanceId`.
- Rules tests were widened (52 cases, the frozen/versioned table checked), not weakened. The old `claude`/`gpt` family names changed to vendor names, with every dependent assertion updated (anthropic/openai); no assertion was deleted. The first review's two scorecard assertion changes stand.
- Report counts: 39 -> 667 full suite is as stated by the report; I re-ran only the three files (81 pass). Not re-run: demo suite, fit-check, a11y (stated in the report).

## Findings list
- Minor `server/src/tasks/review-rules.ts:30`: lookahead allows a digit after `o1`/`o3`/`o4` (`o10`, `o1.5` are openai).
- Minor `server/src/tasks/review-rules.ts:29`: router prefix is discarded, not validated (`anthropic/gpt-4` is openai).
- Minor `server/src/company/scorecard.ts` (nTaskVerified): an old accepted review re-verifies a task that failed, was retried and passed again.
- Minor `server/src/tasks/reviews.ts:50-57`: prior-actor exclusion is fail-open without audit rows; make it fail-closed with an owner-history table or by refusing agent reviewers when the history is unresolved.
