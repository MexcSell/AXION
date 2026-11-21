# Cycle 9 review (independent)

Branch c09-server-minors, worktree /home/luca/AXION-w7. Read-only review of the diff; nothing was run.

## Verdicts
- Spec: PARTIAL. Items 1-5 are fixed on the server with tests. The replyTo change has a web follow-up that is incomplete (Important 1). Items 6 and 7 have no test.
- Quality: GOOD server side, one regression on the web side.

## Important
1. web/src/features/mission/Messenger.tsx:171 (and :191, :202) still sends `pendingQ?.replyTo ?? pendingQ?.id` in api mode. Backfilled demo questions carry a fixture `replyTo` of the form `APR-<mission>-1` (server/src/instances/backfill.ts:105 stores `x.replyTo`; web/src/data/missions.ts:303 creates it). `assertReplyInThread` (server/src/conversations/post.ts:31-33) accepts only a numeric id of a message in the thread, so replying through the Messenger composer to a backfilled question now returns 422. The implementer fixed only the ChatView "Reply..." button (ChatView.tsx:85). Fix: in `apiSend`, send `pendingQ.id` (a real message id in api mode), as ChatView now does. No test covers it: the new tests are server-only, and no browser check replies to a backfilled question.
   Side effects of the ChatView change: the dialog heading and "Waiting for your reply" label (missions.tsx:437, ChatView.tsx:84) show `props.replyTo`/`m.replyTo ?? m.id`, so the ChatView button now shows the numeric id in the dialog instead of the APR id. Cosmetic.

## Minor
- Items 6 and 7 have no test, against the brief's "each item has a test that failed first". The report admits it. The web has no unit harness. `cancelChannelMark` is a small pure function over module maps; a browser check could cover it.
- Item 6 tradeoff: the effect cleanup (ChannelChat.tsx, effect with deps `stored.length`) also runs on each new message, but the effect immediately re-runs `markChannelRead`, which re-arms the timer. That is fine. On a real close within 1.5 s of the newest message, the server read mark for that message is dropped (the local unread is already 0). Acceptable, but it is a small behaviour change.
- Item 7: "Owner" on AgentProfile and "approved by" on Notifications now show the signed-in viewer's name in api mode. That is the viewer, not necessarily the owner or the decider. It falls back to "Luca (Owner)" when `me` is null. Better than before, not exact.
- Paging: the web `fetchAllInstances` loop (agents.ts) is untested. The server test covers limit=3 paging. The Staffed Agents browser check reads only the first 500. The loop stops silently after 100 pages (50k rows) with no flag. Not reachable now.
- Ordering moved from `created_at desc, seq desc` to `seq desc` (service.ts:110). `seq` is a global bigserial (migration 0007), so it is a valid and stable keyset. Order is only different if created_at was ever backdated. Fine.
- Test 4 (c09-minors.test.ts) ends with a conditional live-target assertion (`if (live)`) that may never run. The two 422 cases are real and fail without the fix.
- api-improve.mjs:224 error message still says "must point at axion_e2e". Cosmetic.
- Orphaned JSDoc: the `markChannelRead` comment (chat.ts) now sits above `cancelChannelMark`; agents.ts has two stacked JSDoc blocks.

## Evidence for the declared items
- task.delegated keys: grep of server/src, shared, web/src, web/scripts finds no reader of `payload.from`, `payload.to` or `payload.toInstanceId`. web/src/api/events.ts:79 and :109 only switch on the event type. missionControl.ts:308 `toInstanceId` is the reassign request body, not the event. Audit detail keeps `toInstanceId` (tasks/routes.ts:55), which is not the event payload. Both emit sites (instances/service.ts:51, tasks/routes.ts:74) now use `fromInstance` and `toInstance`. The type `TaskDelegatedPayload` is in shared/contracts/src/events.ts:26. OK. Nothing enforces the type at the emit sites (`payload` is a loose record); a lighter guarantee, but the test reads both subject kinds.
- replyTo scope: the lookup is `messages where id=$1::bigint and thread_id=$2` (post.ts:33). `th.id` comes from `getThreadFor(c, ctx, ...)` (routes.ts:56, tenant and visibility checked) or `ensureDirectThread` with the session owner (direct.ts:52). No cross-thread or cross-tenant leak. The regex `^\d{1,18}$` avoids a bigint cast error (it fits in 63 bits). It runs inside `idempotent`, so a replay is unaffected. Stricter only; kind, text and `to` rules are unchanged (parsePost reproduces the old checks in the same order). Messages loaded by paging have real ids and are fine. Backfilled messages have real ids too; only their `replyTo` field is a fixture (Important 1).
- Reassign to an ended or done instance: the new 422 (tasks/routes.ts:47) comes after the not-in-mission check and before the already-owner check. The test covers both `ended_at` and `state='done'`, and checks ownership is unchanged. Stricter only.
- listInstancesPage: it fetches `limit+1`, sets `truncated`, and gives `nextBefore` as the last returned seq; bad values return 400; the limit is capped at 2000; the default reply is the same array plus two fields (extra fields do not break old readers). The Staffed Agents tile (CommandCenter.tsx:25), the Agents page and the profile all use `useAgentInstances`, which now follows pages. `listInstances` is kept as a wrapper.
- DB guard (api-improve.mjs:224): `/\/axion_e2e\d*(\?|$)/` accepts axion_e2e and axion_e2e7 (this lane's DB, per server/.env) and refuses `axion`, `axion_e2eX` and `axion_prod`. It matches server/src/cli/e2e-serve.ts:18. Note the LANES.md placeholder `axion_e2eL` is the lane number, not a letter.
- Nothing weakened: no check, test or assertion was removed. The fs-guard failure in verify-all is attributed to the lane override config; I did not verify that.
