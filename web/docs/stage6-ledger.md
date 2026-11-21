# SDD ledger — plan: /home/luca/AXION/web/docs/plan-2026-11-21_stage6.md

Spec: update/2026-11-20/AGENT_COMPANY_OS_MASTER_DESIGN_AND_CLAUDE_CODE_PLAN_2026-11-20.md (§10.5, §10.6, §11, §12.1, §15 Stage 6) + update/2026-11-20_u1.md.
Owner approval 2026-11-21: "yes. all continue, all start". Sole controller: session axion-53 (axion-9a confirmed it will not work here). Branch: main (as Stage 5).
Setup: Ruling: work on main, one commit per task — same as approved Stage 5 practice — cost if wrong: git revert per task.
Setup: live API on 127.0.0.1:5191 (pid 1842560, Stage 5 code, real `axion` DB, nobody signed in yet). Vite 5190 pid 1070217. Never touched until Task 8.
Setup: foreign commit noted from Stage 5: d4cfd12 "ui" (neither session). Check git log before each BASE.

## Pre-flight scan

| Rows | Produces / consumes | Finding | Ruling |
|---|---|---|---|
| T2 ↔ T3 | backfill writes threads; thread tables are T3 | ordering | T2 backfills nodes/edges/tasks only; T3 extends backfill with threads (plan says so) |
| T1 ↔ T2 | T2 pins `agent_instances.agent_version_id` to T1's `active_version_id` | consistent | — |
| T2 ↔ T4 | instance id `<missionId>:<agentId>` = web `inst()` in data/missions.ts:244 | consistent | — |
| T3 ↔ T4 | thread/message DTO = UI `Message` + `author`, `simulated` | consistent | — |
| T4 ↔ T5/T6/T7 | all extend `web/scripts/api-stage6.mjs` created in T4 | consistent | — |
| T6 ↔ Stage 5 stream | audience 'user' is delivered to every admin (stream.ts:108) → a member's private GM/agent channel would leak to admins | conflict with Review Focus 1 spirit | T6 adds migration `0009_direct_audience` allowing audience 'owner' (only audience_user, never admins); gm/agent channels use 'owner'; admin channels use 'user' |
| T1 self | seed in makeTestApp may change Stage 5 test counts | check | implementer runs the whole suite |
| T2 self | "presentation.agentIds no longer written" vs Stage 5 web reading presentation | consistent if mission view derives them | — |
| T3 self | honest note "once per thread" | consistent | — |
| T5 self | retry 409 while running (subnet-scout) vs machine legal edges | consistent (running→retry illegal) | — |
| T8 | controller-only; real DB | — | controller runs it, no subagent |

## Progress
Task 1: dispatched (BASE 618d2cc, implementer sonnet)
Task 1: ruling on concerns — 24 agents (u1 lineage added 6; plan's 18 stale) ok; POST appends org revision ok (new agent needs a graph place); web tsc run by controller: clean
Task 1: ⚠️ resolved — agent.* events get audience 'all' (hooks.ts:9, no missionId, not user.*) = correct; tenant t-1 inserted by 0001 migration before seedCompany (app.ts:74) = fine; execution-guard extension is stage-wide → assigned to Task 3 dispatch.
Task 1: complete (commits 618d2cc..42cbfe2, review clean; minors in task-1-review.md)
Task 2: dispatched (BASE 42cbfe2, implementer sonnet)
Task 2: DONE_WITH_CONCERNS (no clean RED; extra cols seq/task_count/pending/tasks.simulated; trigger allows cascade delete) → review on opus
Task 2: review ❌ — I1 derived executorId differs from Stage 5 executorOf for 9/13 demo missions; I2 real-mission backfill branch untested + no manager guard → one bad mission blocks startup.
Task 2: Ruling: extra columns (agent_instances.seq/task_count/pending, tasks.simulated) accepted — needed for fixture display parity — cost: none.
Task 2: Ruling: real-mission backfill uses agents that actually joined (not the full plan) — instances = actual joins; the sim keeps adding the rest — cost: none.
Task 2: Ruling: tighten append-only DELETE exception to a transaction-local flag set only by clearDemo (`set local axion.purge_demo='on'`), and protect task_attempts history the same way — spec "append-only as audit_events" — included in fix round 1.
Task 2: Ruling: also fix in round 1 (load-bearing for T4/T8): M2 reuse VISIBLE_SQL; M3 emit instance.created for the GM instance; M9 log backfill counts at startup.
Task 2: minor (deferred): M4 sim instances lack run_id; M5 setInstanceState untested; M6 event simulated flag disagreement on real missions; M7 presentation still partial source (stale agentIds ['gm']); M8 delegations.task_id no FK, manager_instance_id not same-mission constrained, listInstances truncates at 500, tasks count Math.max mix; M10 no RED run.
Task 2: fix round 1/5 (6 addressed, 0 open — I1 executor rule, I2 resilient tested backfill, R1 purge flag, R2 VISIBLE_SQL, R3 GM instance event, R4 backfill log; commits 009da4c..8e34be2)
Task 2: minor (deferred): 0007 edited in place; migrate.ts has no checksums — harmless here (only axion_test/axion_e2e applied it; both rebuilt per run; real axion still at 0005) — never edit an applied migration after Task 8.
Task 2: complete (commits 42cbfe2..8e34be2, review clean after 1 fix round)
Task 3: dispatched (BASE 8e34be2, implementer sonnet; includes execution-guard extension)
Task 3: DONE (concerns: paged DTO {messages,hasMore,nextBefore}; humans may post in agent-agent threads; GET writes thread_reads; uploads served for message attachments) → review opus
Task 3: review ❌ — I1 sim-close test asserts nothing (errors swallowed); I2 humans post into agent-agent threads (misaddressed honest/sim rows); I3 GET /uploads attachment path untested; I4 cross-tenant test missing (uses same-tenant member).
Task 3: Ruling: paged response {messages,hasMore,nextBefore} accepted — Task 4 reads .messages — cost: none.
Task 3: Ruling: read marker written on GET accepted — SameSite=Strict cookie blocks cross-site GET with session; side effect is per-user unread only — cost: a GET that mutates.
Task 3: Ruling (I2): humans may NOT post into agent↔agent threads → 422 THREAD_NOT_HUMAN; Task 4's composer under an agent↔agent thread sends to the human↔(selected agent) thread instead — keeps threads truthful — cost: one extra UI branch in T4.
Task 3: Ruling: also fix in round 1 (load-bearing for T4): M1 conversation/instance events need a non-'mission' subject kind (add emit option subjectKind; web handler refreshes missions only for kind 'mission'); M2 skip sim on idempotent replay + lock thread before dedupe reads; M3 messageCreated payload status must equal the HTTP response (queued on real missions); M5 honest-note dedupe by marker not body text; M6 paging test asserts hasMore/nextBefore incl. last page.
Task 3: minor (deferred): M4 replyTo not validated within thread; M7 unread counts own-triggered system note; M8 concurrent POST threads double audit row; M9 step-3 dedupe seq scan; M10 fixture human author 'owner'.
Task 3: minor (deferred): agent_definitions.id is global (not per tenant) → a 2nd tenant can't seed the same fixture ids; single-tenant today (Stage 5 deviation 'one company') — fix before multi-tenant (Stage 12).
Task 3: fix round 1/5 (9 addressed, 0 open — I1 sim-close test, I2 THREAD_NOT_HUMAN, I3 attachment tests, I4 cross-tenant, M1 subject kinds, M2 replay/lock, M3 status, M5 marker, M6 paging asserts; commits c3de5e0..be73306)
Task 3: minor (deferred): attachment test has unused `other`/`zoe`; reverse tenant direction (t-2 user → t-1) untested (same predicate).
Task 3: complete (commits 8e34be2..be73306, review clean after 1 fix round)
Task 4: dispatched (BASE be73306, implementer opus — broad web integration)
Task 4: DONE_WITH_CONCERNS (unread badge heuristic; private-mid-conv test holds GET via page.route; long thread e2e 132 msgs; unknown role shows as dev; fixture threads Simulated on every msg; server: event envelope missionId) → review opus
Task 4: review ❌ — I1 E8: real-mission Activity numbers untagged + growing on timer; I2 thread open tight-loop retry on failure; I3 failed first load of hierarchy/tasks/threads hidden + never retried; I4 failed send loses typed text, Send Command dialog claims success before POST; I5 reconnect gap >50 msgs never filled (+ openThread race); I6 404 on thread create treated as mission-gone.
Task 4: Ruling (I1): pre-existing code but E8 binds the stage → fix here: real (non-demo) missions show Activity as DEMO-tagged (or "not measured yet") with no growing timer; demo missions unchanged.
Task 4: Ruling: also fix in round 1 — M(gens reset across sessions), M(pending match by returned id/idempotency key), M(TaskFlow loading vs empty, with I3), M(unknown role shown as dev → show the server role/generic chip; T7 needs it), M(MissionHeader lead version = pinned instance version; Review Focus 3), M(useAgentsVersion.loaded reset on sign-out).
Task 4: minor (deferred): thread count drift (corrected on reconnect); stale scroll anchor on slow loadOlder; fetchPart/loadOlder 404 don't call missionGone; DEPTS import-time (T7 replaces); Live Instances DemoTag (T7); simulated previews untagged + partner unread heuristic; demo Results EmptyState change; dead code featuredAgents/threadMessages, HUMAN duplicated; e2e console filter hides 404s; no unit tests for upsert/laterStatus/onMissionControlEvent.
Task 4: fix round 1/5 (11 addressed, 0 open — I1 E8 activity, I2 thread retry backoff, I3 retryable loads, I4 draft restore + dialog waits, I5 reconnect gap reset, I6 404 confirm, R1–R5; commits ebdcbd1..3b80831)
Task 4: minor (deferred): reconnect-gap detection fooled by a live event in a 1-RTT window (no Last-Event-ID path); rereadThread vs in-flight loadOlder race; send continues after failed openThread (history never loads); failed hierarchy load reported as "not joined"; SendCommand closes silently on gone outside /missions; Retry e2e doesn't prove the button; no revokeObjectURL for restored files; thread list not virtualized; partner unread heuristic; team chips refresh only on mission.* events.
Task 4: carry to Task 7: Overview.tsx:306 "N tokens recorded" sums real missions untagged (E8) — tag/exclude.
Task 4: complete (commits be73306..3b80831, review clean after 1 fix round)
Task 5: dispatched (BASE 3b80831, implementer sonnet)
Task 5: DONE (migration 0009 = task_attempts.started_at nullable; edges de-duplicated; reassign to lead writes no delegation) → review sonnet. NOTE: Task 6's direct-audience migration is now 0010.
Task 5: ⚠️ resolved — execution guard walks server/src recursively (approvals.test.ts walk()) so tasks/ is scanned; mission-progress effects of cancel/retry not required by the brief.
Task 5: minor (deferred): task.delegated has two payload shapes (task vs instance subjectKind); reassign target instance state unchecked; tenant-bound test lacks other-tenant case; reassign/cancel replay untested; 0009 down disables trigger briefly.
Task 5: carry to Task 6: add 'task.stateChanged' to shared/contracts EventType union.
Task 5: carry to Task 7: "Request Verification" in api mode still toasts a fake "QA will verify" (E5) — make it honest.
Task 5: complete (commits 3b80831..53345ee, review clean)
Task 6: dispatched (BASE 53345ee, implementer sonnet; migration 0010_direct_audience; carries EventType fix)
Task 6: DONE (admin-answer notifications reach all admins via 'user' audience — admin channels are admin-visible anyway; gm/agent queued receipt not evented; /threads/:id/messages 404 for direct threads) → review opus
Task 6: review ✅ spec / quality needs fixes — I1 admin-answer notification goes to every admin (incl. the answering admin) with a link to their own line. ⚠️ report lacks verify-all + web tsc evidence.
Task 6: Ruling: narrow the pre-existing admin upload override (uploads.ts:102) — admins may open an upload only if they own it or it is attached in a mission they can see or in an admin channel; never in a member's private gm/agent channel — consistent with "private channels never reach admins" — cost: an admin can no longer open arbitrary uploads by id (no UI needs it).
Task 6: Ruling: also fix in round 1 — M3 decodeURIComponent on decoded param → 500 (drop it); M4 parseChannelKey rejects agent:admin/agent:human/reserved ids; M8 replay privacy test (admin replay skips member 'owner' events) + upload-in-gm-channel admin 404 test.
Task 6: minor (deferred): M1 read-mark throttle drops trailing call (phantom unread); M2 reconnect marks all loaded channels read; M5 post validation duplicated (routes.ts vs direct.ts); M6 replyTo unvalidated; M7 ?chat=admin handler drops whole query string; no e2e for Agent Profile direct chat.
Task 6: fix round 1/5 (6 addressed, 0 open — I1 owner-only notification (migration 0011), R1 admin upload narrowing, M3, M4, M8 replay test, evidence; commits b6a32cc..09e6d97)
Task 6: complete (commits 53345ee..09e6d97, review clean after 1 fix round)
Task 7: dispatched (BASE 09e6d97, implementer sonnet; carries Overview tokens E8 + honest Request Verification)
OWNER 2026-11-21 (in this session): (1) REMOVE the Overview token total and the "QA will verify" toast entirely (relayed to T7; done in bb7485e). (2) After Stage 6 completes: push to GitHub MexcSell/AXION (empty public repo), tag release_1.0.0 on main + GitHub Release. Then run a 30-hour continuous improvement loop BY CLAUDE CODE on the AXION code: study ways to improve company structure, company performance and agent performance → write the process down step by step → implement with tests + review → measure → commit; repeat for 30 hours, logging every cycle.
Task 7: DONE_WITH_CONCERNS (bb7485e): hierarchy keeps GM>dept>agent layout with org revision supplying heads/managers; provenance window 90d; added task.stateChanged subscription; member card-menu edit hiding not e2e-covered; final verify-all started before the two owner deletions → controller re-runs verify-all.
Task 7: review ❌ — I1 Hierarchy tree still built from agent.dept; org revision only crowns heads + label, reporting edges not drawn (brief: draw the active org revision). Owner removals verified gone.
Task 7: ⚠️ resolved — server returns fieldErrors {role:'taken'} / {duty:'taken'} (agents/routes.ts:54,56).
Task 7: Ruling: fix I1 (draw supervisor→subordinate edges from GET /organization/graph in api mode; demo layout unchanged); also fix AgentEdit stale rowVersion after 409, hide "New department" for members in api mode, drop debug console.log/waitForTimeout from api-stage6.mjs; provenance window 90d is correct (server/subnet-scout pattern) — plan's "30 days" superseded.
Task 7: minor (deferred): palette "New agent" + card-menu edit hiding untested for members; fragile "no DEMO tag" selector; Top 5 list empty when only unmeasured agents.
Task 7: controller verify-all on bb7485e (after owner deletions): exit 0, dialog smoke 104/0, help keys OK
Setup: Ruling: run the final whole-branch review + its one fix wave BEFORE Task 8 (real DB migration), so the real database is migrated only once, on reviewed code — cost: none. The ledger is copied to web/docs/stage6-ledger.md (as Stage 5 did) before the workspace is deleted.
Task 7: fix round 1/5 (4 addressed, 0 open — I1 org-revision edges, F1 409 rowVersion, F2 members no New department, F3 e2e waits; commits bb7485e..63f4d4d)
Task 7: complete (commits 09e6d97..63f4d4d, review clean after 1 fix round)
Final review: dispatched over 618d2cc..63f4d4d (opus)
Final review: ready with fixes, no Critical. I1 server tsc fails (web/src/data/types.ts import('@contracts') unresolved in server tsconfig); I2 Reports tab shows invented lead report on real missions untagged (E5, inv. 6); I3 real-mission instances stored/shown 'working' though nothing executes; I4 reconnect re-reads mark mission threads + channels read (with T6 M2). Must-fix minor: T6 M2.
Final review: real axion checked: schema version 5, 0 users, 0 missions. Backup taken 2026-11-21T10:23:44Z (axion-20261121T102344Z.dump) before any restart can migrate it.
Final review: Ruling: one fix wave for I1–I4 + T6 M2; any schema change goes in a NEW migration 0012 (0006–0011 frozen from now) — cost: none.
Final review: fix wave 26110a5 (I1–I4 + T6 M2; migration 0012 sets real-mission 'working' instances → idle, down no-op) → scoped re-review
Final review: fix wave re-review — I1, I2, I3, I4, T6 M2 all ADDRESSED; 0006–0011 byte-identical; 0012 no-op down accepted (data-only; rollback = backup dump). Final review clean.
Final review: minor (deferred): trailing read-mark timer fires if a channel closes within 1.5 s (chat.ts:452); hard-coded "Luca (Owner)" remains in AgentProfile and Notifications.
