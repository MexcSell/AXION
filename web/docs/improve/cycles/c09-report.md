# Cycle 9 report (lane w7): code health H1, server minors batch

## Result
Items 1-7 taken, each with a test that failed first. Server suite: 337 passed (25 files). Browser checks and verify-all: see the bottom table.

## RED / GREEN
`server/test/c09-minors.test.ts` (new, commit "test(c09): RED tests"): 6 tests, all 6 failed against the old code. After the fix commit the whole server suite is green (337/337, includes the 6).

| # | Item | Test | Result |
|---|---|---|---|
| 1 | `replyTo` must be a message of the same thread / channel, else 422 (`fieldErrors.replyTo`) | thread + channel tests (unknown, non-numeric, other-thread id) | PASS |
| 2 | One shared validator `conversations/post.ts` (`parsePost`, `assertReplyInThread`), used by `routes.ts` and `direct.ts` | unit test of `parsePost` | PASS |
| 3 | `task.delegated` payload unified: `{taskId?, fromInstance, toInstance, kind, ...}` for both subjects; type `TaskDelegatedPayload` in `shared/contracts/src/events.ts` | reads real events of both subject kinds | PASS |
| 4 | Reassign to an instance with `ended_at` or state `done` is 422 `TASK_TARGET_INVALID` | test | PASS |
| 5 | `GET /agent-instances?limit=&before=` keyset paging by `seq`, reply `{instances, truncated, nextBefore?}` (default 500, max 2000; bad values 400). The web hook `useAgentInstances` follows `nextBefore` until nothing is cut, so the Staffed Agents tile counts every instance | paging test (pages of 3 cover all rows exactly once) | PASS (tile logic checked by typecheck + api-improve check, see below) |
| 6 | Trailing read-mark timer cancelled when the channel view closes (`cancelChannelMark`, effect cleanup in `ChannelChat.tsx`) | no web unit-test harness exists; verified by typecheck and browser checks only | PASS (weak evidence) |
| 7 | "Luca (Owner)" in AgentProfile Identity and Notifications Decisions shows the signed-in user's name in api mode; demo mode unchanged | typecheck; no dedicated check | PASS (weak evidence) |

## Taken from the ledger / left
Taken: T3 M4, T6 M6, T6 M5, T5 delegated shapes, T5 reassign target, T2 M8 (truncate), final-review timer and owner-name minors.
Also: the web "Reply..." button now sends `replyTo: m.id` (the question itself) instead of `m.replyTo ?? m.id`, because a backfilled demo message's `replyTo` is a fixture id that is not a message id and would now correctly be refused.
Left (not one-line or not clearly safe): T2 M4/M5/M6/M7/M10 and the delegations FK / same-mission constraint (need a migration, not needed here), T3 M7/M8/M9/M10, agent_definitions.id global (Stage 12), T4 and T6 web items other than the timer, 0009 down. No migration 0018 was used.

## Files changed
server: `src/conversations/post.ts` (new), `routes.ts`, `direct.ts`, `src/instances/service.ts`, `routes.ts`, `src/tasks/routes.ts`, `test/c09-minors.test.ts` (new); shared: `contracts/src/events.ts`; web: `src/api/agents.ts`, `src/api/chat.ts`, `src/features/chat/ChannelChat.tsx`, `ChatView.tsx`, `src/pages/AgentProfile.tsx`, `Notifications.tsx`.

## Concerns
- Behaviour change: the `task.delegated` payload keys `from`, `to`, `toInstanceId` are gone (replaced by `fromInstance`, `toInstance`). Nothing in the repo read them (grep of server, shared, web, tests).
- Items 6 and 7 have no behavioural test (no web unit harness; avoided building one for this batch).
- No UI layout change, so no screenshots.

## Browser checks and verify-all
