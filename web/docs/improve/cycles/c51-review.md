# c51 review: task-review hardening and required delegation briefs (O3a + O2a)

Reviewer: independent. Lane `/home/luca/AXION-w50`, branch `c51-review-hardening`, `b06554e..03489f7`. The lane was left at `03489f7` with a clean tree. Ports 10092/10093 are free again. The only files I created were scratch scripts and a temporary probe test (deleted).

## Verdict: PASS-WITH-FIXES

The server work is sound and I could not break the history, freshness or vendor logic. One behaviour change needs a UI fix before merge (F1): members who do not own the mission now always get a 403 from the Reassign dialog, and the UI still offers it.

## Re-run results

| Check | Result |
|---|---|
| Server `tsc --noEmit` | clean |
| Web `tsc --noEmit` | clean |
| Full vitest (through `heavy.sh`) | 64 files, 2040/2040 pass |
| api-stage6 (10092/10093) | 94/94 |
| api-c42 | 16/16 |
| api-c38 | 23/23 |
| api-c06 | 25/25 |
| api-improve (not run by the implementer) | 107/107 |

Migration test: I used a throw-away schema `c51rev` inside `axion_e2e16` (dropped afterwards, so the e2e DB's own tables were untouched).
- Migrated to 0038, seeded a tenant, 3 instances, 4 tasks, 2 delegations and 4 `task.reassign` audit rows (agent only, instance only, unresolvable instance), then ran 0039 up.
- Up twice (no-op), then down/up/down/up: all clean. After the first down the table is gone and the second up succeeds, so no leftover functions or triggers. Row counts are identical (10 and 10) across down/up.

## 1. Owner history (migration 0039): confirmed good

Verified against a real database, not only by reading the SQL.
- Owner-like columns on `tasks` are only `owner_agent` and `owner_instance_id`. The trigger fires on INSERT with an owner and on `UPDATE OF owner_agent, owner_instance_id`.
- Covered and recorded in my runs: a bulk multi-row UPDATE (two rows, two history rows), `INSERT ... ON CONFLICT DO UPDATE` (recorded), update of an unrelated column or a no-op same-owner (nothing recorded), update to null (one row with null agent).
- UPDATE, DELETE and TRUNCATE on the history are refused. `truncate tasks cascade` and a task or mission delete outside the demo purge are refused too (by the history guard or an older append-only table).
- The `axion.purge_demo` exception is `set local` and applies to DELETE only. Inside a transaction with `set local ... 'on'`: delete allowed (2 rows), update still refused. After COMMIT the setting reads empty, so it does not leak. The only non-test setter in `src` is `seed/demo.ts:56`, as `set local`. Same pattern as 0007/0031/0034.
- Backfill: audit `fromAgent`, audit `fromInstanceId` resolved to an agent, delegations, then the current owner of every task (including an agent-only owner and an instance-only owner). It is idempotent by construction (down drops the table; a second `up` is a no-op). The only imperfection is duplicate rows for the same prior actor from the three sources, which is harmless to a set-based rule.
- Fail-closed: `independence()` returns `REVIEW_NOT_INDEPENDENT` when `history.rows === 0`. It is used by the `recordReview` POST (`reviews.ts:150`) and by `listReviews` for the GET `canReview` (`reviews.ts:176`). The review row is locked first (`for update`), so a retry cannot slip in between.

### Plausible, low (F4)
`rows > 0` only proves some history exists. If the trigger is ever disabled for one UPDATE (DDL by the table owner), a prior owner is silently missing and the rule still passes. A cheap extra fail-closed check would be that the latest history row equals the task's current owner (`agent_id`/`owner_instance_id`), otherwise refuse. Not needed to merge.

## 2. Freshness: confirmed good

- Staleness is computed in SQL (`STALE_BEFORE_SQL`, `reviews.ts:69`), comparing `r.created_at` with `la.started_at`, both DB `timestamptz`. No JS clock is involved. The scorecard uses the same fragment through `company/routes.ts:38`.
- The retry attempt has `started_at null` (migration 0009 dropped the default; `tasks/routes.ts:90` inserts null). The attempt-number leg handles it: the review's own `attempt_id` is the latest attempt at the time of writing (`reviews.ts:154`), so a review made before the retry points at attempt N and the latest is N+1, which is stale. A review made after the retry points at N+1 and is fresh, even though `started_at` is null. A task with zero attempts (a fixture) is never stale. The fallback is sound. The fixture-retry path (`routes.ts:87`) writes attempt 1 with `started_at = created_at`, before any review, so no false positive.
- Other places that could flip `verified` for a stale review: `task_reviews` is read only by `reviews.ts` and the scorecard (`company/routes.ts`, `scorecard.ts:105`). `src/company/dimensions.ts` does not exist in the base, so the c46 check is skipped. Reliability, departments and failures do not read reviews. The scorecard drops a stale latest review and does not fall back to an older accepted one. The web UI has no client-side "verified" computation.

### Plausible, low (F5)
Staleness is evaluated against the task's attempts now, not as of the window end. A scorecard for a past window can change after a later retry, which is the same as the existing "task is still passed" rule. The implementer already disclosed this. It is acceptable.

## 3. Vendor matching: the implementer's call on o2 and o5-o9 is right

Ran about 70 inputs through `modelFamily`. Results: `o1-mini`, `o3`, `o3-mini`, `o4-mini`, `o3:latest`, `o1_preview`, `openai/o3` all resolve to openai; `o10x`, `bo1`, `o3mini`, `o1x`, `o1.5`, `o2`, `o5` resolve to null. `anthropic/gpt-4`, `anthropic.gpt-4`, `openrouter/anthropic/gpt-4`, `google/claude-3`, `amazon/claude-3`, `mistral/gpt-4` and `Anthropic/GPT-4` resolve to null. Routers and consistent prefixes (`openrouter/openai/gpt-4o`, `bedrock/anthropic.claude-3`, `us.anthropic.claude-3`, `meta-llama/llama-3`, `x-ai/grok-2`) resolve correctly. No input produced a wrong non-null family.
- The brief says `o[1-9]`, but the table is frozen and versioned and lists only o1/o3/o4, and an existing assertion says `o2` has no family. Null means unknown, which fails closed (cannot review or be reviewed as a "different family"). So leaving `o2` and `o5-9` unknown is the safe direction: widening would assert a vendor for model names that do not exist as such. The pass threshold (`o1-mini` and `o3` match, `o10x` and `bo1` do not, `anthropic/gpt-4` is null) is met. Keep as is. This is a documented deviation from the brief wording, not a defect.

### Plausible, low (F6)
A path prefix that is not in `VENDOR_ALIAS` and not a known router is ignored, e.g. `moonshotai/gpt-4` resolves to openai. That is deliberate (router-style hosts), and the table remains the trust boundary. Mentioning it only so the owner knows contradiction detection covers the 16 aliases listed, not every possible prefix.

## 4. O2a

- Diffs of api-stage6, api-c06 and api-improve: only a `brief` object added to request bodies, plus one `fill()` of the `Acceptance criteria` textarea in the stage6 dialog step. No `check(...)` text, condition or expected status was touched. api-stage6 passes 94/94 and api-improve 107/107, so the unrun script is fine.
- The route check (`tasks/routes.ts:56`) runs after visibility (404 first) and before the state machine and target checks, as documented. `brief: null` counts as missing. The brief block always runs `createBrief` now. Tested: 400, owner unchanged, nothing audited.
- Inverted assertion in `delegation-brief.test.ts`: confirmed it is the intended O2a change. "Reassign without a brief still works" (expect 200) became expect 400 `BRIEF_REQUIRED`, and it also gained a check that the owner is unchanged. The existing "no brief row for T-c42b" check is kept. Nothing else in that file is weakened. The other test edits only add a `BRIEF` constant to reassign bodies, with their expected statuses unchanged. In `tasks.test.ts` the expected 422 and 409 cases now send a brief, so they still test target and state errors rather than `BRIEF_REQUIRED`.
- `instances.test.ts` trigger disable: scoped to a test-only wipe and re-enabled directly after the `delete from tasks`. `alter table ... disable trigger user` disables the user triggers on that table (the append-only guards), not the FK cascade. This matches the existing line for `mission_delegations` right next to it. Minor (F7): it is table-level DDL in a shared test database, and if the test throws between disable and enable the guard stays off in `axion_test`. That is an existing pattern, so I do not ask for a change.

## 5. Behaviour change: members lose reassign (F1, needs a UI fix)

Before c51, any user who could see the mission could reassign: the route's only gate is `visibleTask` (admin, mission owner, or `shared`). A member without a brief was allowed in c42. A member with a brief was already refused, because `createBrief` treats a task reassignment as a root brief ("Only an administrator or the mission owner can write a root brief", `delegation/service.ts:100`).

Probed live in a throw-away test (removed):

| Caller | Request | Result |
|---|---|---|
| Carol, member, not the owner of a shared mission | with a brief | 403 FORBIDDEN "Only an administrator or the mission owner can write a root brief." Owner unchanged, no delegation row, no audit row (rolled back cleanly). |
| Carol | without a brief | 400 BRIEF_REQUIRED |
| Bob, member who owns the mission | with a brief | 200 |

So after c51, reassign works for admins and the mission owner only. This is consistent with the c42 I4 rule and is a sensible authority rule (reassigning is writing a root brief, and a member in someone else's shared mission should not do that). The data is safe.

The UI is not honest:
- The Reassign button in the task drawer is unconditional (`web/src/dialogs/defs/missions.tsx`, the footer around line 407, `<button className="btn" onClick={() => openDialog('task-reassign', ...)}>Reassign</button>`).
- `TaskReassign` has no role check. A non-owner member sees it, fills the dialog, and the only feedback is an error toast ("Not reassigned") after the click. The control always fails for that person.
- A pattern to copy already exists in the same area: `features/mission/StaffingCard.tsx:25` uses `canRetry = !!me && (isAdmin(me) || me.id === m.ownerId)`. The `useMe` and `isAdmin` helpers are in `web/src/store/auth.ts`.

Recommendation: accept the behaviour (no owner decision needed) but fix the UI before merge. In api mode, hide or disable the Reassign button unless `isAdmin(me) || me.id === m.ownerId`. If disabled, give a title such as "Only an administrator or the mission owner can reassign". Also guard the dialog entry point for deep links. Add one api-mode browser assertion (a member sees no enabled Reassign). The reason to accept rather than ask: the server rule already existed (c42), the change closes the briefless path for everyone consistently, and a member can no longer corrupt delegation scope. The owner only needs to be told that members cannot reassign any more (the report says so, but it is not in the help text yet; add one sentence to `delegation.brief` or the hierarchy help).

## Findings by severity

### Confirmed
- **F1, medium (UI honesty).** `web/src/dialogs/defs/missions.tsx` (~line 407 and the `TaskReassign` dialog, ~line 316). A member who does not own a shared mission sees an enabled Reassign button. Scenario: Carol opens a task, clicks Reassign, fills the dialog, submits, and gets a 403 toast. Fix as in section 5.
- **F2, low (docs).** Report and brief disagree on the o-series rule (`o[1-9]` vs `o1/o3/o4`). The code and the frozen table are consistent with each other; add a line to the report or the backlog that the choice was deliberate, so a later cycle does not "fix" it.
- **F3, info.** `reviews.ts:70` stale check, `started_at is not null` guard. Correct and necessary; I could not construct a false stale or a false fresh.

### Plausible (not reproduced)
- **F4, low.** `reviews.ts:ownerHistory`: `rows === 0` is the only fail-closed condition. A history that is non-empty but does not end at the current owner (trigger disabled by DDL) would pass. Consider requiring that the last row matches the task's current owner.
- **F5, low.** Scorecard freshness is evaluated against current attempts, so a past window's "Tasks verified by review" can drop after a later retry. Same semantics as the existing `passed` rule.
- **F6, low.** Prefixes outside the alias table are treated as routers (e.g. `moonshotai/gpt-4` is openai).
- **F7, low.** `instances.test.ts` wipe: table-level trigger disable is not restored if the test throws in between (same as the existing `mission_delegations` pattern).

## What I did not find
No path found where a stale review verifies a task, no owner or assignee change path that the trigger misses (INSERT, UPDATE of either column, multi-row UPDATE, upsert), no way to UPDATE, DELETE or TRUNCATE the history outside the demo purge, no leak of the purge setting after commit, and no weakened assertion in the changed tests.
